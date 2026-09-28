/**
 * What calls made at once, and a table of contents and an article read one
 * after the other, cost learn.jamf.com on a cold cache: the registered tools
 * over MCP, with the real services and cache keys, and only the http client
 * stubbed.
 *
 * #370 gave the static sources' pages and a map's table of contents one load
 * for calls made at once, and #373 the glossary's. Until 2026-09-28 a Fluid
 * Topics article and a search had none, and a map's `/toc` was read once for
 * `jamf_docs_get_toc` and again for the index an article's links, breadcrumb
 * and navigation are read from. Measured offline, with every request
 * answering on a 20 ms timer:
 *
 * - five `jamf_docs_get_article` calls at once for one topic requested its
 *   metadata five times and its body five times;
 * - five `jamf_docs_search` calls at once for one query made five
 *   clustered-search requests;
 * - `jamf_docs_get_toc` for Jamf Pro and `jamf_docs_get_article` for one of
 *   its topics requested the map's `/toc` twice, in either order and at once;
 * - `jamf_docs_glossary_lookup` and `jamf_docs_get_article` for a term in the
 *   glossary requested the glossary's `/toc` twice, in either order and at
 *   once.
 *
 * Live on 2026-09-28 (`createMcpServer` over an empty `FileCache`, the real
 * http client counting requests), the same: 5 and 5 for five articles, 5
 * searches for five, and Jamf Pro's 188 KB `/toc` twice for a TOC and an
 * article, in each order and at once.
 *
 * Since then get_toc reads the tree, and the glossary its terms, from the
 * article's index, so the last cases also check that neither is served for
 * longer than CACHE_TTL_TOC after its download, as one cached for its own TTL
 * from the read would be.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { registerGetArticleTool } from '../../../src/core/tools/get-article.js';
import { registerBatchGetArticlesTool } from '../../../src/core/tools/batch-get-articles.js';
import { registerGetTocTool } from '../../../src/core/tools/get-toc.js';
import { registerSearchTool } from '../../../src/core/tools/search.js';
import { registerGlossaryLookupTool } from '../../../src/core/tools/glossary-lookup.js';
import { fetchArticleFromFt } from '../../../src/core/services/article-service.js';
import { loadMapToc } from '../../../src/core/services/ft-internal-link.js';
import { cacheKey } from '../../../src/core/services/cache-key.js';
import { HttpError, type HttpClient } from '../../../src/core/http-client.js';
import { createMockContext, createStubMapsRegistry } from '../../helpers/mock-context.js';
import { articleUpstream, CCP, CCP_URL, POLICIES, PRO_MAP } from '../../helpers/article-upstream.js';
import { CLUSTERED_SEARCH, PRESTAGE } from '../../helpers/search-upstream.js';
import { GLOSSARY_MAP_ID, LIVE_GLOSSARY_TOC, serveGlossaryContent } from '../../helpers/glossary-upstream.js';
import type { ServerContext } from '../../../src/core/types/context.js';
import type { Logger } from '../../../src/core/services/interfaces/index.js';
import type { FtClusteredSearchResponse, FtTopicInfo } from '../../../src/core/types.js';

interface TextContent { type: 'text'; text: string }

interface CallResult {
  isError?: boolean;
  content: unknown[];
  structuredContent?: Record<string, unknown>;
}

/** How long every request takes to answer. */
const LATENCY_MS = 20;

/** How many calls are made at once. */
const AT_ONCE = 5;

const MAP_TOC = `https://learn.jamf.com/api/khub/maps/${PRO_MAP}/toc`;
const topicMeta = (contentId: string): string => `https://learn.jamf.com/api/khub/maps/${PRO_MAP}/topics/${contentId}`;
const topicBody = (contentId: string): string => `${topicMeta(contentId)}/content`;

const GLOSSARY_PATH = `/api/khub/maps/${GLOSSARY_MAP_ID}`;
/** The glossary's term for `MDM`, which a lookup of it reads, as a topic of the glossary map. */
const MDM = 'mobile_device_management_MDM_';
const MDM_TITLE = 'mobile device management (MDM)';

/** Whether `url` is the glossary map's `/toc`. */
function isGlossaryToc(url: string): boolean {
  const { hostname, pathname } = new URL(url);
  return hostname === 'learn.jamf.com' && decodeURIComponent(pathname) === `${GLOSSARY_PATH}/toc`;
}

/** The glossary map's topic `url` names, if it names one, and what is asked of it. */
function glossaryTopic(url: string): { contentId: string; body: boolean } | undefined {
  const { hostname, pathname } = new URL(url);
  if (hostname !== 'learn.jamf.com') { return undefined; }
  const topic = new RegExp(`^${GLOSSARY_PATH}/topics/([^/]+)(/content)?$`).exec(decodeURIComponent(pathname));
  return topic === null ? undefined : { contentId: topic[1], body: topic[2] === '/content' };
}

/** A term's metadata, as learn.jamf.com answers for a topic. */
function glossaryTopicInfo(contentId: string): FtTopicInfo {
  const node = LIVE_GLOSSARY_TOC[0]?.children?.find(child => child.contentId === contentId);
  if (node?.title === undefined) { throw new HttpError(404, 'Not Found', `${GLOSSARY_PATH}/topics/${contentId}`); }
  return {
    title: node.title,
    id: contentId,
    contentApiEndpoint: `${GLOSSARY_PATH}/topics/${contentId}/content`,
    metadata: [
      { key: 'version_bundle_stem', label: 'version_bundle_stem', values: ['jamf-technical-glossary'] },
      { key: 'ft:locale', label: 'ft:locale', values: ['en-US'] },
      { key: 'ft:prettyUrl', label: 'ft:prettyUrl', values: [`en-US/jamf-technical-glossary/${contentId}`] },
    ],
  };
}

const glossaryBody = serveGlossaryContent(() => new Set());

const ft = articleUpstream();
/** Requests that fail, and how. */
const failing = new Map<string, Error>();
/** Every request to learn.jamf.com, in order. */
const requests: string[] = [];
/** Requests whose answer waits, before its latency, until a case lets it go. */
const held = new Map<string, Promise<void>>();
/** What a case is told when a request has answered, whether or not it failed. */
const onAnswered = new Map<string, () => void>();

async function answer<T>(url: string, read: () => Promise<T>): Promise<T> {
  requests.push(url);
  await held.get(url);
  await new Promise(resolve => setTimeout(resolve, LATENCY_MS));
  onAnswered.get(url)?.();
  const failure = failing.get(url);
  if (failure !== undefined) { throw failure; }
  return await read();
}

/** Learn.jamf.com's search, finding one topic. */
const ONE_RESULT: FtClusteredSearchResponse = {
  facets: [],
  announcements: [],
  paging: { currentPage: 1, isLastPage: true, totalResultsCount: 1, totalClustersCount: 1 },
  results: [{ metadataVariableAxis: 'version', entries: [PRESTAGE] }],
};

const http: HttpClient = {
  getJson: async <T>(url: string) => await answer(url, async () => {
    if (isGlossaryToc(url)) { return LIVE_GLOSSARY_TOC as T; }
    const topic = glossaryTopic(url);
    if (topic !== undefined) { return glossaryTopicInfo(topic.contentId) as T; }
    return await ft.getJson(url) as T;
  }),
  getText: async (url) => {
    // The other sites a search reads beside learn.jamf.com: none, here. Each
    // costs its own matches only, and they are not what is under test.
    if (new URL(url).hostname !== 'learn.jamf.com') { throw new HttpError(404, 'Not Found', url); }
    const topic = glossaryTopic(url);
    if (topic?.body === true) { return await answer(url, async () => await glossaryBody(http, GLOSSARY_MAP_ID, topic.contentId)); }
    return await answer(url, async () => await ft.getText(url));
  },
  postJson: async <T>(url: string) => {
    if (url !== CLUSTERED_SEARCH) { throw new HttpError(404, 'Not Found', url); }
    return await answer(url, async () => await Promise.resolve(ONE_RESULT as T));
  },
};

/** How many times each url was requested. */
function requestCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const url of requests) { counts[url] = (counts[url] ?? 0) + 1; }
  return counts;
}

/** A registry that resolves every family to Jamf Pro Documentation's map, and the glossary to its own. */
function mapsRegistry(): ServerContext['mapsRegistry'] {
  return Object.assign(createStubMapsRegistry([]), {
    resolveMap: async () => await Promise.resolve({ mapId: PRO_MAP, title: 'Jamf Pro Documentation', resolvedLocale: 'en-US' }),
    resolveGlossaryMapId: async () => await Promise.resolve(GLOSSARY_MAP_ID),
  });
}

function newContext(): ServerContext {
  const context = createMockContext({ http, mapsRegistry: mapsRegistry() });
  // Resolving a url is the topic resolver's job and has its own tests.
  context.topicResolver.resolve = vi.fn(async () => await Promise.resolve({ mapId: PRO_MAP, contentId: CCP, locale: 'en-US' as const }));
  return context;
}

/** A client of one server with the five tools, over `ctx`. */
async function clientOver(ctx: ServerContext): Promise<Client> {
  const server = new McpServer({ name: 'fanout-test', version: '0.0.1' });
  registerGetArticleTool(server, ctx);
  registerBatchGetArticlesTool(server, ctx);
  registerGetTocTool(server, ctx);
  registerSearchTool(server, ctx);
  registerGlossaryLookupTool(server, ctx);
  const client = new Client({ name: 'fanout-test', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  // The client checks structuredContent against each published outputSchema
  // only for the tools it has listed.
  await client.listTools();
  return client;
}

async function call(c: Client, name: string, args: Record<string, unknown>): Promise<CallResult> {
  return await c.callTool({ name, arguments: { responseFormat: 'json', ...args } }) as CallResult;
}

const getArticle = async (c: Client): Promise<CallResult> => await call(c, 'jamf_docs_get_article', { url: CCP_URL });
const getToc = async (c: Client): Promise<CallResult> => await call(c, 'jamf_docs_get_toc', { product: 'jamf-pro' });
const search = async (c: Client): Promise<CallResult> => await call(c, 'jamf_docs_search', { query: 'prestage' });
const lookUpMdm = async (c: Client): Promise<CallResult> => await call(c, 'jamf_docs_glossary_lookup', { term: 'MDM' });
const getMdmArticle = async (c: Client): Promise<CallResult> =>
  await call(c, 'jamf_docs_get_article', { mapId: GLOSSARY_MAP_ID, contentId: MDM });

async function atOnce(make: () => Promise<CallResult>): Promise<CallResult[]> {
  return await Promise.all(Array.from({ length: AT_ONCE }, make));
}

function textOf(result: CallResult): string {
  return (result.content[0] as TextContent).text;
}

/** What `make` answers on a cold cache when it is the only call. */
async function coldAlone(make: (c: Client) => Promise<CallResult>): Promise<CallResult> {
  const c = await clientOver(newContext());
  try {
    return await make(c);
  } finally {
    await c.close();
    requests.length = 0;
  }
}

/** Every warning the server logged, across its loggers. */
function warnings(): string[] {
  return vi.mocked(ctx.logger.createLogger).mock.results
    .flatMap(({ value }) => vi.mocked((value as Logger).warning).mock.calls)
    .map(([message]) => String(message));
}

let ctx: ServerContext;
let client: Client;

beforeEach(async () => {
  requests.length = 0;
  failing.clear();
  held.clear();
  onAnswered.clear();
  // A context per case, so each starts cold.
  ctx = newContext();
  client = await clientOver(ctx);
  return async () => { await client.close(); };
});

describe('jamf_docs_get_article on a Fluid Topics topic, called five times at once', () => {
  it('requests the topic\'s metadata and body once, and every call gets the answer one call gets', async () => {
    const alone = await coldAlone(async c => await call(c, 'jamf_docs_get_article', { mapId: PRO_MAP, contentId: CCP }));
    expect(alone.isError, textOf(alone)).not.toBe(true);

    const results = await atOnce(async () => await call(client, 'jamf_docs_get_article', { mapId: PRO_MAP, contentId: CCP }));

    expect(requestCounts()).toEqual({ [topicMeta(CCP)]: 1, [topicBody(CCP)]: 1, [MAP_TOC]: 1 });
    for (const result of results) {
      expect(result.structuredContent).toEqual(alone.structuredContent);
    }
  });

  it('shares a map TOC that will not load: one request, one warning, and every call gets the article without its navigation', async () => {
    failing.set(MAP_TOC, new HttpError(503, 'Service Unavailable', MAP_TOC));
    const alone = await coldAlone(async c => await call(c, 'jamf_docs_get_article', { mapId: PRO_MAP, contentId: CCP }));
    expect(alone.isError, textOf(alone)).not.toBe(true);
    expect(alone.structuredContent).not.toHaveProperty('navigation');

    const results = await atOnce(async () => await call(client, 'jamf_docs_get_article', { mapId: PRO_MAP, contentId: CCP }));

    expect(requestCounts()).toEqual({ [topicMeta(CCP)]: 1, [topicBody(CCP)]: 1, [MAP_TOC]: 1 });
    for (const result of results) {
      expect(result.structuredContent).toEqual(alone.structuredContent);
    }
    expect(warnings().filter(message => message.includes('TOC index unavailable'))).toHaveLength(1);
  });

  it('shares a topic that will not load: one request each, and every call reports it', async () => {
    failing.set(topicMeta(CCP), new HttpError(503, 'Service Unavailable', topicMeta(CCP)));
    const alone = await coldAlone(async c => await call(c, 'jamf_docs_get_article', { mapId: PRO_MAP, contentId: CCP }));
    expect(alone.isError).toBe(true);

    const results = await atOnce(async () => await call(client, 'jamf_docs_get_article', { mapId: PRO_MAP, contentId: CCP }));

    expect(requestCounts()).toEqual({ [topicMeta(CCP)]: 1, [topicBody(CCP)]: 1 });
    for (const result of results) {
      expect(result.isError).toBe(true);
      expect(textOf(result)).toBe(textOf(alone));
    }
    // A failure is not kept: the next call asks again.
    failing.clear();
    expect((await call(client, 'jamf_docs_get_article', { mapId: PRO_MAP, contentId: CCP })).isError).not.toBe(true);
    expect(requestCounts()[topicMeta(CCP)]).toBe(2);
  });

  it('requests each topic once for a batch that names it twice', async () => {
    const result = await call(client, 'jamf_docs_batch_get_articles', { urls: [CCP_URL, CCP_URL, CCP_URL], concurrency: 3 });

    expect((result.structuredContent as { summary: { succeeded: number } }).summary.succeeded).toBe(3);
    expect(requestCounts()).toEqual({ [topicMeta(CCP)]: 1, [topicBody(CCP)]: 1, [MAP_TOC]: 1 });
  });
});

describe('jamf_docs_search, called five times at once', () => {
  it('makes one clustered-search request, and every call gets the answer one call gets', async () => {
    const alone = await coldAlone(search);
    expect(alone.isError, textOf(alone)).not.toBe(true);

    const results = await atOnce(async () => await search(client));

    expect(requestCounts()).toEqual({ [CLUSTERED_SEARCH]: 1 });
    for (const result of results) {
      expect(result.structuredContent).toEqual(alone.structuredContent);
    }
  });

  it('shares a search that fails: one request, every call reports it, and the next call asks again', async () => {
    failing.set(CLUSTERED_SEARCH, new HttpError(503, 'Service Unavailable', CLUSTERED_SEARCH));
    const alone = await coldAlone(search);
    expect(alone.isError).toBe(true);

    const results = await atOnce(async () => await search(client));

    expect(requestCounts()).toEqual({ [CLUSTERED_SEARCH]: 1 });
    for (const result of results) {
      expect(result.isError).toBe(true);
      expect(result.content).toEqual(alone.content);
    }
    failing.clear();
    expect((await search(client)).isError).not.toBe(true);
    expect(requestCounts()).toEqual({ [CLUSTERED_SEARCH]: 2 });
  });

  it('shares nothing between two queries', async () => {
    await Promise.all([search(client), call(client, 'jamf_docs_search', { query: 'policies' })]);

    expect(requestCounts()).toEqual({ [CLUSTERED_SEARCH]: 2 });
  });
});

describe('a map\'s table of contents, read by jamf_docs_get_toc and by an article in the map', () => {
  it.each([
    ['get_toc, then get_article', async () => [await getToc(client), await getArticle(client)]],
    ['get_article, then get_toc', async () => [await getArticle(client), await getToc(client)].reverse()],
    ['both at once', async () => await Promise.all([getToc(client), getArticle(client)])],
  ])('is requested once: %s', async (_, calls) => {
    const tocAlone = await coldAlone(getToc);
    const articleAlone = await coldAlone(getArticle);
    expect(tocAlone.isError, textOf(tocAlone)).not.toBe(true);
    expect(articleAlone.isError, textOf(articleAlone)).not.toBe(true);
    // The whole tree, and the article placed in it.
    expect(JSON.stringify(tocAlone.structuredContent)).toContain('Payload Variables for Configuration Profiles');
    expect(articleAlone.structuredContent).toHaveProperty('navigation.self.title', 'Computer Configuration Profiles');

    const [toc, article] = await calls();

    expect(requestCounts()).toEqual({ [MAP_TOC]: 1, [topicMeta(CCP)]: 1, [topicBody(CCP)]: 1 });
    expect(toc.structuredContent).toEqual(tocAlone.structuredContent);
    expect(article.structuredContent).toEqual(articleAlone.structuredContent);
  });

  it('is requested once for a table of contents and two articles in the map', async () => {
    await getToc(client);
    await call(client, 'jamf_docs_get_article', { mapId: PRO_MAP, contentId: POLICIES });
    await getArticle(client);

    expect(requestCounts()[MAP_TOC]).toBe(1);
  });

  it('is requested once when it fails, by both calls at once, and each reports what it reports alone', async () => {
    failing.set(MAP_TOC, new HttpError(503, 'Service Unavailable', MAP_TOC));
    const tocAlone = await coldAlone(getToc);
    const articleAlone = await coldAlone(getArticle);
    expect(tocAlone.isError).toBe(true);
    expect(articleAlone.isError, textOf(articleAlone)).not.toBe(true);
    // A failure is not kept, so the two share the request only if both want
    // it while it is out. The article asks for its map's TOC once its topic
    // has answered, so the TOC answers only after that here: both then want
    // it while it is out, whichever reached it first, and however many steps
    // either takes to get there.
    held.set(MAP_TOC, new Promise(resolve => { onAnswered.set(topicBody(CCP), resolve); }));

    const [toc, article] = await Promise.all([getToc(client), getArticle(client)]);

    expect(requestCounts()[MAP_TOC]).toBe(1);
    expect(toc.isError).toBe(true);
    expect(textOf(toc)).toBe(textOf(tocAlone));
    expect(article.structuredContent).toEqual(articleAlone.structuredContent);
    // Nothing of the failure is kept: the next get_toc asks again, and is served.
    failing.clear();
    expect((await getToc(client)).isError).not.toBe(true);
    expect(requestCounts()[MAP_TOC]).toBe(2);
  });

  it('is not requested for a table of contents an earlier build cached, which says nothing of when it was downloaded', async () => {
    // Such a build downloaded the tree as it stored it, so the cache expires
    // it on time.
    const tocAlone = await coldAlone(getToc);
    const { toc, mapId, resolvedLocale } = {
      toc: [{ title: 'Cached by 6.0.13', url: 'https://learn.jamf.com/r/en-US/jamf-pro-documentation-current/Cached' }],
      mapId: PRO_MAP,
      resolvedLocale: 'en-US',
    };
    await ctx.cache.set(cacheKey('ft-toc-v2', { locale: 'en-US', product: 'jamf-pro', version: 'current' }), { toc, mapId, resolvedLocale });

    const served = await getToc(client);

    expect(requestCounts()).toEqual({});
    const titles = (reply: CallResult): unknown =>
      (reply.structuredContent?.entries as { title: string }[] | undefined)?.map(entry => entry.title);
    expect(titles(served)).toEqual(['Cached by 6.0.13']);
    expect(titles(tocAlone)).not.toEqual(titles(served));
  });

  it('is requested again for an index an earlier build cached, which holds no table of contents, and then not again', async () => {
    // What a build before 2026-09-28 stored: the index alone.
    await ctx.cache.set(cacheKey('ft-tocindex-v3', { mapId: PRO_MAP }), {
      urlByTocId: {}, ancestorsByContentId: {}, nodeByTocId: {}, childTocIds: {},
      parentTocId: {}, tocIdByContentId: {}, rootTocIds: [],
    });
    const tocAlone = await coldAlone(getToc);

    const toc = await getToc(client);
    await getArticle(client);

    expect(toc.structuredContent).toEqual(tocAlone.structuredContent);
    expect(requestCounts()[MAP_TOC]).toBe(1);
  });

  it('is requested again for an index an earlier build cached by a reader given no TTL, which has no age to compare', async () => {
    await ctx.cache.set(cacheKey('ft-tocindex-v3', { mapId: PRO_MAP }), {
      urlByTocId: {}, ancestorsByContentId: {}, nodeByTocId: {}, childTocIds: {},
      parentTocId: {}, tocIdByContentId: {}, rootTocIds: [],
    });

    const { nodes } = await loadMapToc({ http, cache: ctx.cache, mapId: PRO_MAP });

    expect(requestCounts()).toEqual({ [MAP_TOC]: 1 });
    expect(nodes).toEqual(await ft.getJson(MAP_TOC));
  });
});

describe('the glossary\'s table of contents, read by jamf_docs_glossary_lookup and by an article in the glossary', () => {
  const glossaryTocReads = (): number => requests.filter(isGlossaryToc).length;

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ['the lookup, then the article', async () => [await lookUpMdm(client), await getMdmArticle(client)]],
    ['the article, then the lookup', async () => [await getMdmArticle(client), await lookUpMdm(client)].reverse()],
    ['both at once', async () => await Promise.all([lookUpMdm(client), getMdmArticle(client)])],
  ])('is requested once: %s', async (_, calls) => {
    const lookupAlone = await coldAlone(lookUpMdm);
    const articleAlone = await coldAlone(getMdmArticle);
    expect(lookupAlone.isError, textOf(lookupAlone)).not.toBe(true);
    expect(articleAlone.isError, textOf(articleAlone)).not.toBe(true);
    // The term found, and the article placed in the glossary.
    expect(lookupAlone.structuredContent).toHaveProperty('entries.0.term', MDM_TITLE);
    expect(articleAlone.structuredContent).toHaveProperty('navigation.self.title', MDM_TITLE);

    const [lookup, article] = await calls();

    expect(glossaryTocReads()).toBe(1);
    expect(lookup.structuredContent).toEqual(lookupAlone.structuredContent);
    expect(article.structuredContent).toEqual(articleAlone.structuredContent);
  });

  it('is read again once the index an article cached is older than CACHE_TTL_TOC, though a lookup read its terms from it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    ctx.config.cacheTtl.toc = 60_000;
    const start = Date.now();
    expect((await getMdmArticle(client)).isError).not.toBe(true);
    for (const at of [50_000, 70_000]) {
      vi.setSystemTime(start + at);
      expect((await lookUpMdm(client)).isError).not.toBe(true);
    }

    // Kept for CACHE_TTL_ARTICLE, 24 hours, from the read at 50 s, the terms
    // would have been served at 70 s.
    expect(glossaryTocReads()).toBe(2);
  });
});

describe('a table of contents read from an index an article cached', () => {
  /** CACHE_TTL_TOC, as the server passes it on: one minute. */
  const TOC_TTL = 60_000;

  afterEach(() => {
    vi.useRealTimers();
  });

  /** get_article, then get_toc at each of `after` ms from it: how many times the map's `/toc` was read. */
  async function tocReads(after: number[]): Promise<number> {
    vi.useFakeTimers({ toFake: ['Date'] });
    ctx.config.cacheTtl.toc = TOC_TTL;
    const start = Date.now();
    expect((await getArticle(client)).isError).not.toBe(true);
    for (const at of after) {
      vi.setSystemTime(start + at);
      expect((await getToc(client)).isError).not.toBe(true);
    }
    return requests.filter(url => url === MAP_TOC).length;
  }

  it('is served from it while that index is younger than CACHE_TTL_TOC', async () => {
    expect(await tocReads([50_000, 59_000])).toBe(1);
  });

  it('is read again once that index is older than CACHE_TTL_TOC, though get_toc cached it only 20 s earlier', async () => {
    // Its age counts from the download, as the maps list's does: kept for
    // CACHE_TTL_TOC from get_toc's own read, it would be served until 110 s.
    expect(await tocReads([50_000, 70_000])).toBe(2);
  });

  it('is read again when that index is CACHE_TTL_TOC old to the millisecond', async () => {
    expect(await tocReads([50_000, TOC_TTL])).toBe(2);
  });

  it('is read again once older than CACHE_TTL_TOC, though an embedder kept the index for longer', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    ctx.config.cacheTtl.toc = TOC_TTL;
    const start = Date.now();
    await fetchArticleFromFt(ctx.cache, PRO_MAP, CCP, '', { http, tocCacheTtl: 24 * 60 * 60 * 1000 });
    vi.setSystemTime(start + 70_000);

    expect((await getToc(client)).isError).not.toBe(true);

    expect(requests.filter(url => url === MAP_TOC)).toHaveLength(2);
  });
});
