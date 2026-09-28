/**
 * `jamf_docs_search` reads learn.jamf.com's search and the other sites'
 * (concepts.jamf.com, support.jamf.com) side by side: the registered tool over
 * MCP, with the real search services, and only the http client stubbed.
 *
 * Until 2026-09-28 it awaited learn.jamf.com's search and only then started
 * on the other sites, so a cold search waited on the two in turn. Live that
 * day, over an empty `FileCache`, a cold en-US search for "enrollment" took
 * 3,979–4,132 ms in three runs: learn.jamf.com's search answered at 2.4–2.7 s,
 * and the other sites' 14 requests went out only then, and took another
 * 1.3–1.7 s. #380 added the pages those requests read titles from.
 *
 * Nothing else changed: a search that fails is still an error that lists what
 * the other sites matched (#354), other sites that fail still cost only their
 * own matches, and the reply is the one it was.
 *
 * A site whose sitemap fails is not searched, and since the same day its
 * listing pages are no longer read after that: with support.jamf.com's
 * sitemap answering 404, the nine collection pages its en listing names were
 * all requested after the search had replied without them.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

/**
 * What the other-site search is, for the one call a case sets it for. Not a
 * `vi.fn`: a spy handles each promise its function returns, to record how it
 * settled, and so would hide the unhandled rejection a case looks for.
 */
const otherSitesSearch = vi.hoisted(() => ({ once: undefined as (() => Promise<never>) | undefined }));

// The real other-site search, unless a case has set one for its call.
vi.mock('../../../src/core/services/static-search-service.js', async (importOriginal) => {
  const original = await importOriginal<typeof StaticSearchModule>();
  return {
    ...original,
    searchStaticSources: async (...args: Parameters<typeof original.searchStaticSources>) => {
      const { once } = otherSitesSearch;
      otherSitesSearch.once = undefined;
      return await (once === undefined ? original.searchStaticSources(...args) : once());
    },
  };
});

import { McpServer } from '@modelcontextprotocol/server';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { registerSearchTool } from '../../../src/core/tools/search.js';
import type * as StaticSearchModule from '../../../src/core/services/static-search-service.js';
import { STATIC_DOC_SOURCES } from '../../../src/core/constants/sources.js';
import { HttpError, type HttpClient } from '../../../src/core/http-client.js';
import { createMockContext } from '../../helpers/mock-context.js';
import { CLUSTERED_SEARCH, PRESTAGE } from '../../helpers/search-upstream.js';
import { createSupportUpstream, homeUrl } from '../../helpers/support-upstream.js';
import type { ServerContext } from '../../../src/core/types/context.js';
import type { Logger } from '../../../src/core/services/interfaces/index.js';
import type { FtClusteredSearchResponse } from '../../../src/core/types.js';

interface TextContent { type: 'text'; text: string }

interface CallResult {
  isError?: boolean;
  content: TextContent[];
  structuredContent?: Record<string, unknown>;
}

const CONCEPTS = STATIC_DOC_SOURCES['jamf-concepts'];
const CONCEPTS_SITEMAP = `${CONCEPTS.baseUrl}/sitemap.xml`;
const SETUP_MANAGER = `${CONCEPTS.baseUrl}/en/concepts/setup-manager/`;

/** How long a request the case does not hold takes to answer. */
const LATENCY_MS = 20;

/**
 * How long learn.jamf.com's search waits, at most, for the other sites to be
 * asked, in the case that holds it until they are. Only a search that asks
 * them after it waits this long; one that asks them alongside never does.
 */
const HOLD_LIMIT_MS = 500;

const ONE_RESULT: FtClusteredSearchResponse = {
  facets: [],
  announcements: [],
  paging: { currentPage: 1, isLastPage: true, totalResultsCount: 1, totalClustersCount: 1 },
  results: [{ metadataVariableAxis: 'version', entries: [PRESTAGE] }],
};

interface Upstream {
  /** learn.jamf.com's search is held until another site is asked for a page. */
  holdSearch: boolean;
  /** learn.jamf.com's search fails at once. */
  searchFails: boolean;
  /** Every other site fails at once. */
  othersFail: boolean;
  /**
   * support.jamf.com lists its collections, and serves their pages, each
   * LATENCY_MS after its sitemap has answered 404.
   */
  supportListed: boolean;
}

let upstream: Upstream;
/** What happened, in order. */
let events: string[];
let otherSiteAsked: () => void;
let otherSiteAskedOnce: Promise<void>;
/** Every page asked of the other sites, in order. */
let otherSitePages: string[];
/** support.jamf.com's listing and collection pages. */
let support: ReturnType<typeof createSupportUpstream>;
let supportListingAnswered: () => void;
let supportListingAnsweredOnce: Promise<void>;

async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

const http: HttpClient = {
  getText: async (url) => {
    events.push(`asked ${new URL(url).hostname}`);
    otherSitePages.push(url);
    otherSiteAsked();
    if (upstream.othersFail) { throw new HttpError(503, 'Service Unavailable', url); }
    if (upstream.supportListed && new URL(url).hostname === 'support.jamf.com' && new URL(url).pathname !== '/sitemap.xml') {
      await sleep(2 * LATENCY_MS);
      try {
        return await support.http.getText(url);
      } finally {
        if (url === homeUrl('en')) { supportListingAnswered(); }
      }
    }
    await sleep(LATENCY_MS);
    if (url === CONCEPTS_SITEMAP) {
      return `<urlset><url><loc>${CONCEPTS.baseUrl}/en/concepts/setup-manager</loc></url></urlset>`;
    }
    // support.jamf.com and the pages the sites list titles on: none, here.
    throw new HttpError(404, 'Not Found', url);
  },
  getJson: async url => await Promise.reject(new HttpError(404, 'Not Found', url)),
  postJson: async <T>(url: string) => {
    if (url !== CLUSTERED_SEARCH) { throw new HttpError(404, 'Not Found', url); }
    events.push('asked learn.jamf.com');
    if (upstream.searchFails) { throw new HttpError(503, 'Service Unavailable', url); }
    await (upstream.holdSearch
      ? Promise.race([otherSiteAskedOnce, sleep(HOLD_LIMIT_MS)])
      : sleep(LATENCY_MS));
    events.push('learn.jamf.com answered');
    return ONE_RESULT as T;
  },
};

let ctx: ServerContext;

async function searchFor(query: string, onprogress?: (progress: { progress: number; message?: string | undefined }) => void): Promise<CallResult> {
  const server = new McpServer({ name: 'search-test', version: '0.0.1' });
  registerSearchTool(server, ctx);
  const client = new Client({ name: 'search-test', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    // Listed first, so the client checks structuredContent against the outputSchema.
    await client.listTools();
    return await client.callTool(
      { name: 'jamf_docs_search', arguments: { query } },
      onprogress === undefined ? undefined : { onprogress },
    ) as CallResult;
  } finally {
    await client.close();
  }
}

function warnings(): string[] {
  return vi.mocked(ctx.logger.createLogger).mock.results
    .flatMap(({ value }) => vi.mocked((value as Logger).warning).mock.calls)
    .map(([message]) => String(message));
}

beforeEach(() => {
  upstream = { holdSearch: false, searchFails: false, othersFail: false, supportListed: false };
  otherSitesSearch.once = undefined;
  events = [];
  otherSitePages = [];
  otherSiteAskedOnce = new Promise((resolve) => { otherSiteAsked = resolve; });
  support = createSupportUpstream();
  supportListingAnsweredOnce = new Promise((resolve) => { supportListingAnswered = resolve; });
  // A context per case, so each starts cold.
  ctx = createMockContext({ http });
});

describe('jamf_docs_search on a cold cache', () => {
  it('asks the other sites before learn.jamf.com\'s search has answered', async () => {
    upstream.holdSearch = true;

    const reply = await searchFor('setup manager');

    expect(reply.isError, reply.content[0]?.text).not.toBe(true);
    const answered = events.indexOf('learn.jamf.com answered');
    const otherSiteFirstAsked = events.findIndex(event => event.startsWith('asked ') && event !== 'asked learn.jamf.com');
    expect(answered).toBeGreaterThan(-1);
    expect(otherSiteFirstAsked).toBeGreaterThan(-1);
    expect(otherSiteFirstAsked).toBeLessThan(answered);
    // And the reply is the whole one: learn.jamf.com's result, then the other sites'.
    const structured = reply.structuredContent as { results: { title: string }[]; otherSources?: { url: string }[] };
    expect(structured.results.map(r => r.title)).toEqual([PRESTAGE.topic?.title]);
    expect(structured.otherSources?.map(r => r.url)).toEqual([SETUP_MANAGER]);
    const text = reply.content[0]?.text ?? '';
    expect(text.indexOf('Computer PreStage Enrollments')).toBeGreaterThan(-1);
    expect(text.indexOf(SETUP_MANAGER)).toBeGreaterThan(text.indexOf('Computer PreStage Enrollments'));
  });

  it('reports its progress in the order it did', async () => {
    const progress: { progress: number; message?: string }[] = [];

    await searchFor('setup manager', (p) => { progress.push({ progress: p.progress, ...(p.message !== undefined ? { message: p.message } : {}) }); });

    expect(progress).toEqual([
      { progress: 0, message: 'Searching documentation...' },
      { progress: 1, message: 'Processing results...' },
      { progress: 2, message: 'Formatting output...' },
      { progress: 3 },
    ]);
  });

  it('that fails at once is still an error, and still lists what the other sites matched when they answer later (#354)', async () => {
    upstream.searchFails = true;

    const reply = await searchFor('setup manager');

    expect(reply.isError).toBe(true);
    expect(reply.content[0]?.text).toContain('Search for "setup manager" failed');
    expect(reply.structuredContent).toBeUndefined();
    expect(reply.content).toHaveLength(2);
    expect(reply.content[1]?.text).toContain(SETUP_MANAGER);
  });

  it('whose other sites fail at once is served learn.jamf.com\'s results when they answer later, and logs what failed', async () => {
    upstream.othersFail = true;

    const reply = await searchFor('setup manager');

    expect(reply.isError, reply.content[0]?.text).not.toBe(true);
    const structured = reply.structuredContent as { results: { title: string }[]; otherSources?: unknown[] };
    expect(structured.results.map(r => r.title)).toEqual([PRESTAGE.topic?.title]);
    expect(structured.otherSources ?? []).toEqual([]);
    expect(warnings().some(message => message.includes(`Could not search ${CONCEPTS.name}`))).toBe(true);
  });

  it('that fails, with other sites that fail too, is an error with nothing else in it', async () => {
    upstream.searchFails = true;
    upstream.othersFail = true;

    const reply = await searchFor('setup manager');

    expect(reply.isError).toBe(true);
    expect(reply.content).toHaveLength(1);
  });

  it('whose other-site search rejects while learn.jamf.com\'s is out is served without them, and nothing rejects unhandled', async () => {
    // The other-site search catches each site's failure, so this stands for
    // one it did not foresee. It rejects as it is called, and learn.jamf.com
    // answers LATENCY_MS later: until then only the catch it was given as it
    // started stands between it and an unhandled rejection.
    otherSitesSearch.once = async () => {
      events.push('the other-site search rejected');
      return await Promise.reject(new Error('the other sites could not be searched'));
    };
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled);

    let reply: CallResult;
    try {
      reply = await searchFor('setup manager');
      // Node reports an unhandled rejection once the microtasks have run.
      await sleep(0);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }

    expect(events.indexOf('the other-site search rejected')).toBeGreaterThan(-1);
    expect(events.indexOf('the other-site search rejected')).toBeLessThan(events.indexOf('learn.jamf.com answered'));
    expect(unhandled).toEqual([]);
    expect(reply.isError, reply.content[0]?.text).not.toBe(true);
    const structured = reply.structuredContent as { results: { title: string }[]; otherSources?: unknown[] };
    expect(structured.results.map(r => r.title)).toEqual([PRESTAGE.topic?.title]);
    expect(structured.otherSources ?? []).toEqual([]);
    expect(warnings()).toContain('Other-source search failed: Error: the other sites could not be searched');
  });

  it('whose support.jamf.com sitemap fails asks for none of the collection pages its listing then names', async () => {
    upstream.supportListed = true;

    const reply = await searchFor('setup manager');
    // Whenever the listing answers, and whatever it would lead to asking for.
    await supportListingAnsweredOnce;
    await sleep(LATENCY_MS);

    expect(otherSitePages.filter(url => new URL(url).hostname === 'support.jamf.com'))
      .toEqual([`${STATIC_DOC_SOURCES['jamf-support'].baseUrl}/sitemap.xml`, homeUrl('en')]);
    // And the reply is the one it was: support.jamf.com costs its own matches.
    expect(reply.isError, reply.content[0]?.text).not.toBe(true);
    const structured = reply.structuredContent as { otherSources?: { url: string }[] };
    expect(structured.otherSources?.map(r => r.url)).toEqual([SETUP_MANAGER]);
    expect(warnings().some(message => message.includes(`Could not search ${STATIC_DOC_SOURCES['jamf-support'].name}`))).toBe(true);
  });
});
