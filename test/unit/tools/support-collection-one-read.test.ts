/**
 * One request for a support.jamf.com collection page, whichever of
 * `jamf_docs_get_toc` and `jamf_docs_get_article` reads it first: the
 * registered tools over MCP, with the real Intercom readers and cache, and
 * only the http client stubbed.
 *
 * `get_toc` reads a collection's tree from its page, and since #378
 * `get_article` reads the same page as the collection's list of articles.
 * Until 2026-09-28 each kept only what it read, so the other requested the
 * page again: live, `get_toc` on `jamf-support-jamf-pro` and then
 * `get_article` on its url requested the 551 KB page twice. The search title
 * index reads the tree through the same reader as `get_toc` (static-titles.ts).
 *
 * The list `get_article` reads shows each title fit to show, as the search
 * title index does (#380): 10 of the 894 titles on the 22 collection pages
 * hold a double space and one ends in a no-break space, and until 2026-09-28
 * the list showed them so.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { registerGetArticleTool } from '../../../src/core/tools/get-article.js';
import { registerGetTocTool } from '../../../src/core/tools/get-toc.js';
import { STATIC_DOC_SOURCES } from '../../../src/core/constants/sources.js';
import { createDefaultConfig } from '../../../src/core/config.js';
import { createMockContext, createStubMapsRegistry } from '../../helpers/mock-context.js';
import type { ServerContext } from '../../../src/core/types/context.js';
import { createStaticEditionsUpstream } from '../../helpers/static-editions-upstream.js';
import { nextDataPage } from '../../helpers/support-upstream.js';

interface TextContent { type: 'text'; text: string }

interface CallResult {
  isError?: boolean;
  content: unknown[];
  structuredContent?: Record<string, unknown>;
}

const SUPPORT = STATIC_DOC_SOURCES['jamf-support'];
const ORIGIN = SUPPORT.baseUrl;

const HOME = `${ORIGIN}/en/`;
const JAMF_PRO_URL = `${ORIGIN}/en/collections/12369024-jamf-pro`;
/** The same page by its id alone, which the site answers with it. */
const JAMF_PRO_SLUGLESS = `${ORIGIN}/en/collections/12369024`;

/** Three of Jamf Pro's live titles, as Intercom listed them on 2026-09-28. */
const DOUBLE_SPACE = 'Export Names of Applications to a .csv File  in Jamf Pro';
const TRAILING_NBSP = 'Unable to Export Patch Management Results to a .csv file\u00a0';
const PLAIN = 'Renew your MDM Push Notification Certificate in Jamf Pro';

/**
 * A TTL for each kind of entry, none equal to another, so a test can tell
 * which one an entry got: by default an article and a TOC are both kept for
 * 24 hours.
 */
const CACHE_TTL = { search: 1_000, article: 2_000_000, products: 3_000_000, toc: 4_000_000 };

const upstream = createStaticEditionsUpstream();
const { requests } = upstream;

let ctx: ServerContext;
let server: McpServer;
let client: Client;

beforeAll(async () => {
  ctx = createMockContext({
    http: upstream.http,
    mapsRegistry: createStubMapsRegistry([]),
    config: { ...createDefaultConfig(), cacheTtl: CACHE_TTL },
  });
  server = new McpServer({ name: 'test', version: '0.0.1' });
  registerGetArticleTool(server, ctx);
  registerGetTocTool(server, ctx);

  client = new Client({ name: 'test-client', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  // Listing the tools first is what makes the client check every
  // `structuredContent` against the published outputSchema.
  await client.listTools();
});

afterAll(async () => {
  await client.close();
  await server.close();
});

beforeEach(async () => {
  await ctx.cache.clear();
  upstream.reset();
  const page = nextDataPage({
    collection: {
      id: '12369024',
      name: 'Jamf Pro',
      description: 'Articles for managing devices using Jamf Pro.',
      url: JAMF_PRO_URL,
      articleSummaries: [
        { title: PLAIN, url: `${ORIGIN}/en/articles/11016634-renew-your-mdm-push-notification-certificate-in-jamf-pro` },
        { title: DOUBLE_SPACE, url: `${ORIGIN}/en/articles/11037754-export-names-of-applications-to-a-csv-file-in-jamf-pro` },
      ],
      subcollections: [{
        name: 'Licensing ',
        url: `${ORIGIN}/en/collections/12380200-licensing`,
        articleSummaries: [
          { title: TRAILING_NBSP, url: `${ORIGIN}/en/articles/11025145-unable-to-export-patch-management-results-to-a-csv-file` },
        ],
        subcollections: [],
      }],
    },
    breadcrumbs: [],
    localeLinks: [{ id: 'en', absoluteUrl: JAMF_PRO_URL, available: true, selected: true }],
  });
  upstream.pages.set(HOME, nextDataPage({
    home: {
      collections: [{
        id: '12369024', slug: 'jamf-pro', name: 'Jamf Pro', description: '', url: JAMF_PRO_URL, articleCount: 3,
      }],
    },
  }));
  upstream.pages.set(JAMF_PRO_URL, page);
  upstream.pages.set(JAMF_PRO_SLUGLESS, page);
});

async function call(name: string, args: Record<string, unknown>): Promise<CallResult> {
  const result = await client.callTool({ name, arguments: args }) as CallResult;
  expect(result.isError, (result.content[0] as TextContent).text).not.toBe(true);
  return result;
}

const toc = async (): Promise<unknown> =>
  (await call('jamf_docs_get_toc', { publication: 'jamf-support-jamf-pro', maxTokens: 50000 })).structuredContent;
const listing = async (url = JAMF_PRO_URL): Promise<unknown> =>
  (await call('jamf_docs_get_article', { url, maxTokens: 50000, responseFormat: 'json' })).structuredContent;

/** What each tool answers on a cold cache, with none of the other's entries. */
async function cold(): Promise<{ toc: unknown; listing: unknown }> {
  await ctx.cache.clear();
  const answers = { toc: await toc(), listing: await listing() };
  await ctx.cache.clear();
  requests.length = 0;
  return answers;
}

describe('a support.jamf.com collection page, read by get_toc and get_article', () => {
  it('is requested once when get_toc reads it first, and get_article answers as it would have', async () => {
    const expected = await cold();

    expect(await toc()).toEqual(expected.toc);
    expect(await listing()).toEqual(expected.listing);
    expect(requests).toEqual([HOME, JAMF_PRO_URL]);
  });

  it('is requested once when get_article reads it first, and get_toc answers as it would have', async () => {
    const expected = await cold();

    expect(await listing()).toEqual(expected.listing);
    expect(await toc()).toEqual(expected.toc);
    expect(requests).toEqual([JAMF_PRO_URL, HOME]);
  });

  it.each([
    ['get_toc', toc],
    ['get_article', async (): Promise<unknown> => await listing()],
  ])('is kept for each reader for its own TTL when %s reads it first', async (_, first) => {
    vi.mocked(ctx.cache.set).mockClear();
    await first();

    const kept = vi.mocked(ctx.cache.set).mock.calls
      .map(([key, , ttl]) => [key.split(':')[0], ttl])
      .filter(([namespace]) => namespace === 'static-article-v3' || namespace === 'intercom-collection-toc-v3');
    expect(kept.sort()).toEqual([
      ['intercom-collection-toc-v3', CACHE_TTL.toc],
      ['static-article-v3', CACHE_TTL.article],
    ]);
  });

  it('is kept for get_toc under the address the page gives as its own, not the one asked for', async () => {
    const expected = await cold();

    await listing(JAMF_PRO_SLUGLESS);
    expect(await toc()).toEqual(expected.toc);
    expect(requests).toEqual([JAMF_PRO_SLUGLESS, HOME]);
  });
});

describe('jamf_docs_get_article: a support.jamf.com collection\'s list of articles', () => {
  it('shows each title and subcollection name fit to show', async () => {
    const { content } = await listing() as { content: string };

    expect(content).toContain('[Export Names of Applications to a .csv File in Jamf Pro](');
    expect(content).toContain('[Unable to Export Patch Management Results to a .csv file](');
    expect(content).toContain('\n## Licensing\n');
    expect(content).not.toMatch(/ {2}|\u00a0| \]|Licensing \n/);
  });

  it('titles a collection by its name fit to show', async () => {
    const licensing = `${ORIGIN}/en/collections/12380200-licensing`;
    upstream.pages.set(licensing, nextDataPage({
      collection: { name: 'Licensing\u00a0 ', url: licensing, articleSummaries: [], subcollections: [] },
      localeLinks: [{ id: 'en', absoluteUrl: licensing, available: true, selected: true }],
    }));

    expect(await listing(licensing)).toMatchObject({ title: 'Licensing' });
  });
});
