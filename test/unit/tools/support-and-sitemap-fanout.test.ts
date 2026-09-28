/**
 * What calls made at once cost support.jamf.com, concepts.jamf.com and a
 * Fluid Topics map's table of contents on a cold cache: the registered tools
 * over MCP, with the real readers and cache keys, and only the http client
 * stubbed.
 *
 * Until 2026-09-28 nothing shared a request for one of those pages while it
 * was in flight, so every call that reached a page before the first had
 * cached it requested the page again. Measured offline, with every page
 * answering on a 20 ms timer, five calls at once made:
 *
 * - `jamf_docs_list_products`: 30 requests, each of the six home pages five
 *   times;
 * - `jamf_docs_get_toc` for `jamf-support-jamf-pro` in ja-JP: 15, the ja and
 *   en home pages and the collection page five times each;
 * - `get_toc` for a concepts.jamf.com section: its sitemap five times;
 * - `get_toc` for `jamf-pro`: the map's table of contents five times;
 * - `jamf_docs_get_article` for a concepts.jamf.com or support.jamf.com page:
 *   the page five times;
 * - `jamf_docs_search`: each site's sitemap five times.
 *
 * Two calls made twice as many requests as one. And each language's search
 * title index requested a site's whole sitemap for itself, apart from the one
 * `get_toc` reads, even one after another. Live on 2026-09-28, three calls at
 * once through `createMcpServer` over an empty `FileCache` made 18 home page
 * requests for `list_products` and 9 for that `get_toc`, three searches for
 * different words downloaded the two sitemaps five times, and three
 * `get_toc` calls for `jamf-pro` downloaded its 188 KB table of contents
 * three times. Those pages took 0.24 to 1.25 s each, and a collection page
 * was 551 KB and a sitemap 208 to 253 KB. #341 closed the same fan-out for a
 * map's TOC index (#339).
 *
 * Every page answers on a timer, as the TOC does in
 * article-toc-index-fanout.test.ts: calls made at once reach each page
 * within a few milliseconds of each other, well inside one request.
 *
 * Since 2026-09-28 a search title index and a concepts.jamf.com table of
 * contents also read the pages the sites list their titles on
 * (static-titles.ts), and calls made at once share those requests too.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createMcpServer } from '../../../src/core/create-server.js';
import { registerGetArticleTool } from '../../../src/core/tools/get-article.js';
import { registerGetTocTool } from '../../../src/core/tools/get-toc.js';
import { registerListProductsTool } from '../../../src/core/tools/list-products.js';
import { registerSearchTool } from '../../../src/core/tools/search.js';
import { STATIC_DOC_SOURCES, canonicalStaticUrl } from '../../../src/core/constants/sources.js';
import { HttpError, type HttpClient } from '../../../src/core/http-client.js';
import { createMockContext, createMockLoggerFactory, createStubMapsRegistry } from '../../helpers/mock-context.js';
import type { ServerContext } from '../../../src/core/types/context.js';
import type { Logger } from '../../../src/core/services/interfaces/index.js';
import type { FtClusteredSearchResponse, FtTocNode } from '../../../src/core/types.js';
import { collectionIn, createSupportUpstream, homeUrl, listedUrl, nextDataPage } from '../../helpers/support-upstream.js';
import { CONCEPTS_GUIDE_HTML, CONCEPTS_GUIDE_URL } from '../../fixtures/concepts-guide-page.js';
import { SUPPORT_COLLECTIONS_BY_LOCALE } from '../../fixtures/support-collections-by-locale.js';
import { conceptsIndexPages, conceptsIndexUrl } from '../../helpers/concepts-index-pages.js';

interface TextContent { type: 'text'; text: string }

interface CallResult {
  isError?: boolean;
  content: unknown[];
  structuredContent?: Record<string, unknown>;
}

interface Incomplete { unavailable: string[]; message: string }

const SUPPORT = STATIC_DOC_SOURCES['jamf-support'];
const CONCEPTS = STATIC_DOC_SOURCES['jamf-concepts'];
const JAMF_PRO = '12369024';
const JAMF_ACCOUNT = '11814179';

const CONCEPTS_SITEMAP = `${CONCEPTS.baseUrl}/sitemap.xml`;
const SUPPORT_SITEMAP = `${SUPPORT.baseUrl}/sitemap.xml`;
const CLUSTERED_SEARCH = 'https://learn.jamf.com/api/khub/clustered-search';

/** Jamf Pro Documentation's map, and its table of contents. */
const MAP_ID = 'A4LI4vM0BILraYeOD89WGg';
const MAP_TOC = `https://learn.jamf.com/api/khub/maps/${MAP_ID}/toc`;
const MAP_TOC_NODES: FtTocNode[] = [{
  tocId: 'toc-root',
  contentId: 'content-root',
  title: 'Managing Computers',
  prettyUrl: '/r/en-US/jamf-pro-documentation-current/Managing_Computers',
}];

const SUPPORT_ARTICLE = `${SUPPORT.baseUrl}/en/articles/11584648-grant-secure-token-to-enable-filevault`;

/** How long a page takes to answer, unless `slow` names it. */
const LATENCY_MS = 20;

/** How many calls are made at once. */
const AT_ONCE = 5;

function sitemap(locs: string[]): string {
  return `<urlset>${locs.map(loc => `<url><loc>${loc}</loc></url>`).join('')}</urlset>`;
}

/** A few of the live pages (2026-09-28), in each section of each site, in three of their languages. */
const SITEMAPS: Readonly<Record<string, string>> = {
  [CONCEPTS_SITEMAP]: sitemap(['en', 'ja', 'de'].flatMap(code => [
    `${CONCEPTS.baseUrl}/${code}/guides/ai-governance`,
    `${CONCEPTS.baseUrl}/${code}/concepts/jamformer`,
    `${CONCEPTS.baseUrl}/${code}/concepts/setup-manager`,
  ])),
  [SUPPORT_SITEMAP]: sitemap(['en', 'ja', 'de'].map(code =>
    `${SUPPORT.baseUrl}/${code}/articles/11584648-grant-secure-token-to-enable-filevault`)),
};

/** The two static articles, as their sites serve them. */
const ARTICLES: Readonly<Record<string, string>> = {
  [CONCEPTS_GUIDE_URL]: CONCEPTS_GUIDE_HTML,
  [SUPPORT_ARTICLE]: nextDataPage({
    articleContent: {
      title: 'Grant Secure Token to Enable FileVault',
      blocks: [{ type: 'paragraph', text: 'Grant a secure token before enabling FileVault.' }],
      lastUpdatedDate: '2026-09-01T00:00:00Z',
    },
    breadcrumbs: [{ label: 'Jamf Pro' }],
  }),
};

/** The pages served here rather than by support.jamf.com's stub, concepts.jamf.com's index pages among them. */
const PAGES: Readonly<Record<string, string>> = {
  ...SITEMAPS,
  ...ARTICLES,
  ...Object.fromEntries(conceptsIndexPages()),
};

/** Learn.jamf.com's search, finding nothing: the other sites' matches are what is under test. */
const NO_RESULTS: FtClusteredSearchResponse = {
  facets: [],
  announcements: [],
  paging: { currentPage: 1, isLastPage: true, totalResultsCount: 0, totalClustersCount: 0 },
  results: [],
};

const upstream = createSupportUpstream();
/** Pages that take longer than {@link LATENCY_MS} to answer, and how long. */
const slow = new Map<string, number>();
/** Every page requested, in order. Learn.jamf.com's search is not counted. */
const requests: string[] = [];

const http: HttpClient = {
  getText: async (url) => {
    requests.push(url);
    await new Promise(resolve => setTimeout(resolve, slow.get(url) ?? LATENCY_MS));
    return PAGES[url] ?? await upstream.http.getText(url);
  },
  getJson: async <T>(url: string) => {
    if (url !== MAP_TOC) { throw new HttpError(404, 'Not Found', url); }
    requests.push(url);
    await new Promise(resolve => setTimeout(resolve, LATENCY_MS));
    return MAP_TOC_NODES as T;
  },
  postJson: async <T>(url: string) => {
    if (url !== CLUSTERED_SEARCH) { throw new HttpError(404, 'Not Found', url); }
    return await Promise.resolve(NO_RESULTS as T);
  },
};

/** How many times each page was requested. */
function requestCounts(): Map<string, number> {
  const counts = new Map<string, number>();
  for (const url of requests) { counts.set(url, (counts.get(url) ?? 0) + 1); }
  return counts;
}

/** A registry that resolves every family to Jamf Pro Documentation's map. */
function mapsRegistry(): ServerContext['mapsRegistry'] {
  return Object.assign(createStubMapsRegistry([]), {
    resolveMap: async () => await Promise.resolve({ mapId: MAP_ID, title: 'Jamf Pro Documentation', resolvedLocale: 'en-US' }),
  });
}

function newContext(): ServerContext {
  return createMockContext({ http, mapsRegistry: mapsRegistry() });
}

async function connect(server: McpServer): Promise<Client> {
  const client = new Client({ name: 'fanout-test', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  // The client checks structuredContent against each published outputSchema
  // only for the tools it has listed.
  await client.listTools();
  return client;
}

/** A client of one server with the four tools, over `ctx`. */
async function clientOver(ctx: ServerContext): Promise<Client> {
  const server = new McpServer({ name: 'fanout-test', version: '0.0.1' });
  registerListProductsTool(server, ctx);
  registerGetTocTool(server, ctx);
  registerSearchTool(server, ctx);
  registerGetArticleTool(server, ctx);
  return await connect(server);
}

async function call(client: Client, name: string, args: Record<string, unknown>): Promise<CallResult> {
  return await client.callTool({ name, arguments: { responseFormat: 'json', ...args } }) as CallResult;
}

async function listProducts(client: Client): Promise<CallResult> {
  return await call(client, 'jamf_docs_list_products', {});
}

async function getToc(client: Client, publication: string, language = 'en-US'): Promise<CallResult> {
  return await call(client, 'jamf_docs_get_toc', { publication, language });
}

async function search(c: Client, language = 'en-US'): Promise<CallResult> {
  return await call(c, 'jamf_docs_search', { query: 'jamformer', language });
}

async function atOnce(make: () => Promise<CallResult>): Promise<CallResult[]> {
  return await Promise.all(Array.from({ length: AT_ONCE }, make));
}

/** A collection's page as the reader requests it: the slug percent-encoded. */
function collectionPage(code: string, id: string): string {
  return canonicalStaticUrl(SUPPORT, listedUrl(code, collectionIn(code, id)!));
}

/**
 * The pages a search index in one language lists its titles from
 * (static-titles.ts): support.jamf.com's home page and every collection page
 * it lists, and concepts.jamf.com's two section index pages.
 */
function titleListings(code: string): string[] {
  return [
    homeUrl(code),
    ...(SUPPORT_COLLECTIONS_BY_LOCALE[code] ?? []).map(collection => collectionPage(code, collection.id)),
    conceptsIndexUrl(code, 'guides'),
    conceptsIndexUrl(code, 'concepts'),
  ];
}

/** Every warning the server logged, across its loggers. */
function warnings(): string[] {
  return vi.mocked(ctx.logger.createLogger).mock.results
    .flatMap(({ value }) => vi.mocked((value as Logger).warning).mock.calls)
    .map(([message]) => String(message));
}

function textOf(result: CallResult): string {
  return (result.content[0] as TextContent).text;
}

function incompleteOf(result: CallResult): Incomplete | undefined {
  return result.structuredContent?.incomplete as Incomplete | undefined;
}

/** What `make` answers on a cold cache when it is the only call. */
async function coldAlone(make: (client: Client) => Promise<CallResult>): Promise<CallResult> {
  const client = await clientOver(newContext());
  try {
    return await make(client);
  } finally {
    await client.close();
    requests.length = 0;
  }
}

let ctx: ServerContext;
let client: Client;

beforeEach(async () => {
  upstream.reset();
  requests.length = 0;
  slow.clear();
  // A context per case, so each starts cold.
  ctx = newContext();
  client = await clientOver(ctx);
  return async () => { await client.close(); };
});

describe('jamf_docs_list_products, called five times at once', () => {
  it('requests each of the six home pages once, and every call gets the answer one call gets', async () => {
    const alone = await coldAlone(listProducts);

    const results = await atOnce(async () => await listProducts(client));

    expect(Object.fromEntries(requestCounts())).toEqual(
      Object.fromEntries(Object.values(SUPPORT.locales).map(code => [homeUrl(code), 1])),
    );
    for (const result of results) {
      expect(result.structuredContent).toEqual(alone.structuredContent);
    }
    expect(alone.structuredContent).not.toHaveProperty('incomplete');
  });

  it('requests a home page that fails once, and every call reports it', async () => {
    upstream.failing.set('fr', '503');

    const results = await atOnce(async () => await listProducts(client));

    expect(requestCounts().get(homeUrl('fr'))).toBe(1);
    for (const result of results) {
      expect(incompleteOf(result)?.unavailable).toEqual(['jamf-support']);
      expect(incompleteOf(result)?.message).toContain('could not be read in fr-FR');
    }
  });

  it('requests an en home page without its list once, and every call reports it', async () => {
    upstream.failing.set('en', 'no-next-data');

    const results = await atOnce(async () => await listProducts(client));

    expect(Object.fromEntries(requestCounts())).toEqual({ [homeUrl('en')]: 1 });
    for (const result of results) {
      expect(incompleteOf(result)?.unavailable).toEqual(['jamf-support']);
    }
  });
});

describe('jamf_docs_get_toc on a support.jamf.com collection, called five times at once', () => {
  it.each([
    ['en-US', 'en', [homeUrl('en')]],
    ['ja-JP', 'ja', [homeUrl('ja'), homeUrl('en')]],
    ['zh-TW', 'zh-TW', [homeUrl('zh-TW'), homeUrl('en')]],
  ])('%s: requests each page once, and every call gets the answer one call gets', async (language, code, homes) => {
    const alone = await coldAlone(async c => await getToc(c, 'jamf-support-jamf-pro', language));
    expect(alone.isError, textOf(alone)).not.toBe(true);

    const results = await atOnce(async () => await getToc(client, 'jamf-support-jamf-pro', language));

    expect(Object.fromEntries(requestCounts())).toEqual(
      Object.fromEntries([...homes, collectionPage(code, JAMF_PRO)].map(url => [url, 1])),
    );
    for (const result of results) {
      expect(result.structuredContent).toEqual(alone.structuredContent);
    }
  });

  it('requests each page once for two collections in one locale', async () => {
    const results = await Promise.all([JAMF_PRO, JAMF_ACCOUNT].flatMap(id => {
      const publication = `jamf-support-${collectionIn('en', id)!.slug}`;
      return Array.from({ length: AT_ONCE }, async () => await getToc(client, publication, 'ja-JP'));
    }));

    expect(results.filter(result => result.isError === true)).toEqual([]);
    expect(Object.fromEntries(requestCounts())).toEqual({
      [homeUrl('ja')]: 1,
      [homeUrl('en')]: 1,
      [collectionPage('ja', JAMF_PRO)]: 1,
      [collectionPage('ja', JAMF_ACCOUNT)]: 1,
    });
  });

  it('requests an en home page that fails once, and every ja-JP call falls back to ja\'s own slugs and says so', async () => {
    // #352's fallback: ids are read from the locale's own listing, with a
    // warning, when the en one cannot be read.
    upstream.failing.set('en', '503');

    const results = await atOnce(async () => await getToc(client, 'jamf-support-jamf-pro', 'ja-JP'));

    expect(requestCounts().get(homeUrl('en'))).toBe(1);
    for (const result of results) {
      expect(result.isError, textOf(result)).not.toBe(true);
      expect(result.structuredContent?.localeNote).toBeUndefined();
    }
    const fallbacks = warnings().filter(message => message.includes(`Could not list ${SUPPORT.name} collections in en`));
    expect(fallbacks).toHaveLength(AT_ONCE);
  });

  it('requests a collection page that fails once, and asks for it again on the next call', async () => {
    upstream.failingCollections.set(`en/${JAMF_PRO}`, '503');
    const page = collectionPage('en', JAMF_PRO);

    const results = await atOnce(async () => await getToc(client, 'jamf-support-jamf-pro'));

    expect(requestCounts().get(page)).toBe(1);
    for (const result of results) {
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('503');
    }

    // Nothing of a failure is kept: once the page answers, the next call is
    // served.
    upstream.failingCollections.clear();
    const recovered = await getToc(client, 'jamf-support-jamf-pro');
    expect(recovered.isError, textOf(recovered)).not.toBe(true);
    expect(requestCounts().get(page)).toBe(2);
  });
});

describe('jamf_docs_list_products and jamf_docs_get_toc at once, with a home page failing', () => {
  it('share its request: list_products remembers the failure, and get_toc reports it and asks again next time', async () => {
    // Slower than the en page list_products reads first, so its read of fr
    // arrives while get_toc's is still in flight.
    upstream.failing.set('fr', '503');
    slow.set(homeUrl('fr'), LATENCY_MS * 3);

    const [products, toc] = await Promise.all([
      listProducts(client),
      getToc(client, 'jamf-support-jamf-pro', 'fr-FR'),
    ]);

    expect(requestCounts().get(homeUrl('fr'))).toBe(1);
    expect(incompleteOf(products)?.message).toContain('could not be read in fr-FR');
    expect(toc.isError).toBe(true);
    expect(textOf(toc)).toContain(homeUrl('fr'));
    // The page's own failure, not one remembered from another call.
    expect(textOf(toc)).not.toContain('not asked again');

    // list_products remembers a listing it could not read for a minute
    // (#360), whichever call made the request.
    const again = await listProducts(client);
    expect(incompleteOf(again)?.message).toContain('could not be read in fr-FR');
    expect(requestCounts().get(homeUrl('fr'))).toBe(1);

    // get_toc asks for its locale's page each time (#352).
    await getToc(client, 'jamf-support-jamf-pro', 'fr-FR');
    expect(requestCounts().get(homeUrl('fr'))).toBe(2);
  });

  it('with its failure remembered: get_toc asks for the page itself, and reports that request\'s failure', async () => {
    upstream.failing.set('fr', '503');
    expect(incompleteOf(await listProducts(client))?.message).toContain('could not be read in fr-FR');
    requests.length = 0;

    const [products, toc] = await Promise.all([
      listProducts(client),
      getToc(client, 'jamf-support-jamf-pro', 'fr-FR'),
    ]);

    // One request, get_toc's: list_products does not ask again for a minute
    // (#360), and get_toc does not join the load that says so.
    expect(requestCounts().get(homeUrl('fr'))).toBe(1);
    expect(incompleteOf(products)?.message).toContain('could not be read in fr-FR');
    expect(toc.isError).toBe(true);
    expect(textOf(toc)).toContain(homeUrl('fr'));
    expect(textOf(toc)).not.toContain('not asked again');
  });
});

describe('jamf_docs_get_toc on a Fluid Topics product, called five times at once', () => {
  it('requests the map\'s table of contents once, and every call gets the answer one call gets', async () => {
    const alone = await coldAlone(async c => await call(c, 'jamf_docs_get_toc', { product: 'jamf-pro' }));
    expect(alone.isError, textOf(alone)).not.toBe(true);

    const results = await atOnce(async () => await call(client, 'jamf_docs_get_toc', { product: 'jamf-pro' }));

    expect(Object.fromEntries(requestCounts())).toEqual({ [MAP_TOC]: 1 });
    for (const result of results) {
      expect(result.structuredContent).toEqual(alone.structuredContent);
    }
  });
});

describe('jamf_docs_get_article on a static page, called five times at once', () => {
  it.each([
    ['concepts.jamf.com', CONCEPTS_GUIDE_URL],
    ['support.jamf.com', SUPPORT_ARTICLE],
  ])('%s: requests the page once, and every call gets the answer one call gets', async (_, url) => {
    const alone = await coldAlone(async c => await call(c, 'jamf_docs_get_article', { url }));
    expect(alone.isError, textOf(alone)).not.toBe(true);

    const results = await atOnce(async () => await call(client, 'jamf_docs_get_article', { url }));

    expect(Object.fromEntries(requestCounts())).toEqual({ [url]: 1 });
    for (const result of results) {
      expect(result.structuredContent).toEqual(alone.structuredContent);
    }
  });
});

describe('two servers over one context, as src/index.ts builds one per HTTP request', () => {
  it('share a request in flight', async () => {
    const shared = newContext();
    const clients = await Promise.all([
      connect(createMcpServer({ ...shared, logger: createMockLoggerFactory() })),
      connect(createMcpServer({ ...shared, logger: createMockLoggerFactory() })),
    ]);

    try {
      await Promise.all(clients.map(async c => await listProducts(c)));

      expect(Object.fromEntries(requestCounts())).toEqual(
        Object.fromEntries(Object.values(SUPPORT.locales).map(code => [homeUrl(code), 1])),
      );
    } finally {
      await Promise.all(clients.map(async (c) => { await c.close(); }));
    }
  });
});

describe('a sitemap', () => {
  it('is requested once by five jamf_docs_get_toc calls at once on each concepts.jamf.com section', async () => {
    const sections = CONCEPTS.sections.map(section => section.id);
    const alone = new Map<string, CallResult>();
    for (const section of sections) {
      alone.set(section, await coldAlone(async c => await getToc(c, section)));
    }

    const results = await Promise.all(sections.map(async section =>
      [section, await atOnce(async () => await getToc(client, section))] as const));

    // And each section's index page, where its titles are listed.
    expect(Object.fromEntries(requestCounts())).toEqual({
      [CONCEPTS_SITEMAP]: 1,
      [conceptsIndexUrl('en', 'guides')]: 1,
      [conceptsIndexUrl('en', 'concepts')]: 1,
    });
    for (const [section, replies] of results) {
      expect(alone.get(section)?.isError, section).not.toBe(true);
      for (const reply of replies) {
        expect(reply.structuredContent).toEqual(alone.get(section)?.structuredContent);
      }
    }
  });

  it('is requested once per site by five jamf_docs_search calls at once', async () => {
    const alone = await coldAlone(search);
    expect(JSON.stringify(alone.structuredContent)).toContain(`${CONCEPTS.baseUrl}/en/concepts/jamformer/`);

    const results = await atOnce(async () => await search(client));

    // Every page the index lists its titles from, once too.
    expect(Object.fromEntries(requestCounts())).toEqual(Object.fromEntries(
      [CONCEPTS_SITEMAP, SUPPORT_SITEMAP, ...titleListings('en')].map(url => [url, 1])));
    for (const result of results) {
      expect(result.structuredContent).toEqual(alone.structuredContent);
    }
  });

  const LANGUAGES: readonly [string, string][] = [['en-US', 'en'], ['ja-JP', 'ja'], ['de-DE', 'de']];

  it('is requested once per site by searches in three languages at once, and each finds its own language\'s page', async () => {
    const alone = new Map<string, CallResult>();
    for (const [language] of LANGUAGES) {
      alone.set(language, await coldAlone(async c => await search(c, language)));
    }

    const results = await Promise.all(LANGUAGES.map(async ([language]) => [language, await search(client, language)] as const));

    // And each language's title listings once: concepts.jamf.com has no de
    // index page here, which costs only its titles.
    expect(Object.fromEntries(requestCounts())).toEqual(Object.fromEntries(
      [CONCEPTS_SITEMAP, SUPPORT_SITEMAP, ...LANGUAGES.flatMap(([, code]) => titleListings(code))].map(url => [url, 1])));
    for (const [language, result] of results) {
      const code = LANGUAGES.find(([id]) => id === language)?.[1] ?? '';
      expect(JSON.stringify(result.structuredContent)).toContain(`${CONCEPTS.baseUrl}/${code}/concepts/jamformer/`);
      expect(result.structuredContent).toEqual(alone.get(language)?.structuredContent);
    }
  });

  it('is requested once per site by searches in three languages and a concepts get_toc, one after another', async () => {
    // Each language's title index is built from the sitemap get_toc's tree
    // is, as cached. Until 2026-09-28 each requested it for itself: the
    // concepts.jamf.com sitemap four times here, and support.jamf.com's
    // three.
    for (const [language] of LANGUAGES) {
      expect((await search(client, language)).isError).not.toBe(true);
    }
    expect((await getToc(client, 'jamf-concepts-guides')).isError).not.toBe(true);

    // The get_toc reads nothing the en search has not: the sitemap, and the
    // guides index page its titles are listed on.
    expect(Object.fromEntries(requestCounts())).toEqual(Object.fromEntries(
      [CONCEPTS_SITEMAP, SUPPORT_SITEMAP, ...LANGUAGES.flatMap(([, code]) => titleListings(code))].map(url => [url, 1])));
  });
});
