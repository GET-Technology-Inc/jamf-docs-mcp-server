/**
 * A CacheProvider that fails, or that answers a miss with `undefined`, does
 * not change what any tool or resource replies.
 *
 * The cache is an optimisation, and a reply is the same whether or not it held
 * anything. Until 2026-09-28 core called the provider it was given directly,
 * at sixteen `get` and seventeen `set` call sites in twelve files, and took
 * whatever it did as given. On the calls below, each made twice:
 *
 *  - A `get` that rejects, or throws without a promise: all 26 tool replies
 *    were `isError` ("Error fetching article: KV GET failed: …", "Error
 *    listing products: …"). Six of the eight resource reads threw, and the
 *    other two answered Jamf Pro's versions with the compiled-in fallback,
 *    `["current"]`.
 *  - A `set` that rejects or throws: the same 26 tool replies failed and the
 *    same six resource reads threw, each after its fetch had succeeded. The
 *    search said "this server hit an unexpected error while searching", and
 *    before #354 "No results found".
 *  - A `get` that answers `undefined` for a missing key, as a `Map` does: read
 *    as a hit. 22 of the 26 tool replies were `isError` ("Error fetching
 *    table of contents: Cannot read properties of undefined (reading
 *    'map')"), `list_products` said the maps registry on learn.jamf.com could
 *    not be read, and four resource reads threw.
 *
 * Each case here drives the whole server, as `createMcpServer` builds it, over
 * an in-memory MCP client that lists the tools first, so it checks every
 * `structuredContent` against the published outputSchema. Every backend is
 * served from fixtures. Each call is made twice, so the second one reads what
 * the first stored, and each reply must equal what a cache that behaves
 * answers, byte for byte.
 */

import { describe, it, expect, vi } from 'vitest';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createMcpServer } from '../../../src/core/create-server.js';
import { STATIC_DOC_SOURCES } from '../../../src/core/constants/sources.js';
import { MapsRegistry } from '../../../src/core/services/maps-registry.js';
import { TopicResolver } from '../../../src/core/services/topic-resolver.js';
import type { CacheProvider, LoggerFactory } from '../../../src/core/services/interfaces/index.js';
import type { HttpClient } from '../../../src/core/http-client.js';
import type { FtClusteredSearchResponse, FtMapInfo, FtMetadataEntry, FtTopicInfo } from '../../../src/core/types.js';
import type { ServerContext } from '../../../src/core/types/context.js';
import { createMockCache, createMockContext, createMockLogger } from '../../helpers/mock-context.js';
import { CCP, CCP_URL, POLICIES, POLICIES_URL, PRO_MAP, articleUpstream } from '../../helpers/article-upstream.js';
import { GLOSSARY_MAP_ID, LIVE_GLOSSARY_TOC, serveGlossaryContent } from '../../helpers/glossary-upstream.js';
import { CLUSTERED_SEARCH, CONCEPTS_SITEMAP, MAPS_LIST, PRESTAGE } from '../../helpers/search-upstream.js';
import { CONCEPTS_GUIDE_HTML, CONCEPTS_GUIDE_URL } from '../../fixtures/concepts-guide-page.js';
import { SUPPORT_COLLECTIONS_BY_LOCALE } from '../../fixtures/support-collections-by-locale.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

function meta(entries: Record<string, string[]>): FtMetadataEntry[] {
  return Object.entries(entries).map(([key, values]) => ({ key, label: key, values }));
}

/** Jamf Pro's current documentation map, with the classification its topics carry. */
const PRO_DOCS: FtMapInfo = {
  id: PRO_MAP,
  title: 'Jamf Pro Documentation 11.32.0',
  mapApiEndpoint: `/api/khub/maps/${PRO_MAP}`,
  metadata: meta({
    'version_bundle_stem': ['jamf-pro-documentation'],
    'bundle': ['jamf-pro-documentation-current'],
    'version': ['11.32.0'],
    'latestVersion': ['yes'],
    'ft:locale': ['en-US'],
    'jamf:portal': ['Jamf Pro'],
  }),
};

const GLOSSARY_MAP: FtMapInfo = {
  id: GLOSSARY_MAP_ID,
  title: 'Jamf Platform Technical Glossary',
  mapApiEndpoint: `/api/khub/maps/${GLOSSARY_MAP_ID}`,
  metadata: meta({ 'version_bundle_stem': ['jamf-technical-glossary'], 'ft:locale': ['en-US'] }),
};

/** `GET …/maps/{PRO_MAP}/topics`, which a legacy `…/page/<slug>.html` url is resolved through. */
const PRO_TOPICS: FtTopicInfo[] = [
  { id: POLICIES, title: 'Policies', contentApiEndpoint: `/api/khub/maps/${PRO_MAP}/topics/${POLICIES}/content`, metadata: [] },
  { id: CCP, title: 'Computer Configuration Profiles', contentApiEndpoint: `/api/khub/maps/${PRO_MAP}/topics/${CCP}/content`, metadata: [] },
];

const SUPPORT_ORIGIN = 'https://support.jamf.com';
/** Jamf Pro's support.jamf.com collection, as the en home page lists it. */
const SUPPORT_JAMF_PRO = SUPPORT_COLLECTIONS_BY_LOCALE.en?.find(c => c.id === '12369024');
/**
 * Every locale's home page, each listing that one collection. A listing that
 * reads one locale's home page reads `/en/`; one that reads each locale's
 * reads them all.
 */
const SUPPORT_HOMES = new Set(Object.values(STATIC_DOC_SOURCES['jamf-support'].locales)
  .map(code => `${SUPPORT_ORIGIN}/${code}/`));

/** An Intercom page, carrying `pageProps` the way its Next.js pages do. */
function intercomPage(pageProps: unknown): string {
  return `<html><body><script id="__NEXT_DATA__" type="application/json">${
    JSON.stringify({ props: { pageProps } })}</script></body></html>`;
}

function sitemap(...locs: string[]): string {
  return `<urlset>${locs.map(loc => `<url><loc>${loc}</loc></url>`).join('')}</urlset>`;
}

/**
 * Every backend the server reads, offline. Anything not served is an error
 * the reply would show, and the baseline below would not pass.
 */
function upstream(): HttpClient {
  const learn = articleUpstream();
  const glossaryContent = serveGlossaryContent(() => new Set());
  const collection = SUPPORT_JAMF_PRO;
  if (collection === undefined) { throw new Error('fixture: no en support collection'); }
  const collectionUrl = `${SUPPORT_ORIGIN}/en/collections/${collection.id}-${collection.slug}`;
  const home = intercomPage({
    home: {
      collections: [{
        id: collection.id, slug: collection.slug, name: collection.name, description: '',
        url: collectionUrl, articleCount: collection.entries,
      }],
    },
  });

  return {
    getJson: async <T>(url: string): Promise<T> => {
      const path = decodeURIComponent(new URL(url).pathname);
      if (url === MAPS_LIST) { return await Promise.resolve([PRO_DOCS, GLOSSARY_MAP] as T); }
      if (path === `/api/khub/maps/${PRO_MAP}/topics`) { return await Promise.resolve(PRO_TOPICS as T); }
      if (path === `/api/khub/maps/${GLOSSARY_MAP_ID}/toc`) { return await Promise.resolve(LIVE_GLOSSARY_TOC as T); }
      return await learn.getJson(url) as T;
    },
    getText: async (url) => {
      const path = decodeURIComponent(new URL(url).pathname);
      const glossary = new RegExp(`^/api/khub/maps/${GLOSSARY_MAP_ID}/topics/([^/]+)/content$`).exec(path);
      if (glossary !== null) { return await glossaryContent(undefined, GLOSSARY_MAP_ID, glossary[1]); }
      if (SUPPORT_HOMES.has(url)) { return home; }
      switch (url) {
        case CONCEPTS_SITEMAP:
          return sitemap('https://concepts.jamf.com/en/concepts/setup-manager', CONCEPTS_GUIDE_URL);
        case CONCEPTS_GUIDE_URL:
          return CONCEPTS_GUIDE_HTML;
        case `${SUPPORT_ORIGIN}/sitemap.xml`:
          return sitemap(collection.first.url);
        case collectionUrl:
          return intercomPage({
            collection: { articleSummaries: [{ title: collection.first.title, url: collection.first.url }] },
          });
        default:
          return await learn.getText(url);
      }
    },
    postJson: async <T>(url: string): Promise<T> => {
      if (url !== CLUSTERED_SEARCH) { throw new Error(`offline: no fixture for POST ${url}`); }
      const response: FtClusteredSearchResponse = {
        facets: [],
        announcements: [],
        paging: { currentPage: 1, isLastPage: true, totalResultsCount: 1, totalClustersCount: 1 },
        results: [{ metadataVariableAxis: 'version', entries: [PRESTAGE] }],
      };
      return await Promise.resolve(response as T);
    },
  };
}

// ── The caches ──────────────────────────────────────────────────────────────

/** A store that says "no such key" with `undefined`, as a `Map` does. */
function undefinedOnMiss(): CacheProvider {
  const store = new Map<string, unknown>();
  return {
    get: (async (key: string) => await Promise.resolve(store.get(key))) as CacheProvider['get'],
    set: async (key, value) => { store.set(key, value); await Promise.resolve(); },
    delete: async key => await Promise.resolve(store.delete(key)),
    clear: async () => { store.clear(); await Promise.resolve(); },
    stats: async () => await Promise.resolve({ memoryEntries: store.size, totalEntries: store.size }),
    prune: async () => await Promise.resolve(0),
  };
}

type Fault = 'get rejects' | 'get throws without a promise' | 'set rejects' | 'set throws without a promise' | 'get answers undefined on a miss';

function faultyCache(fault: Fault): CacheProvider {
  if (fault === 'get answers undefined on a miss') { return undefinedOnMiss(); }
  const cache = createMockCache();
  switch (fault) {
    case 'get rejects':
      vi.mocked(cache.get).mockRejectedValue(new Error('KV GET failed: 503 Service Unavailable'));
      break;
    case 'get throws without a promise':
      vi.mocked(cache.get).mockImplementation(() => { throw new Error('KV GET failed: 503 Service Unavailable'); });
      break;
    case 'set rejects':
      vi.mocked(cache.set).mockRejectedValue(new Error('KV PUT failed: 429 Too Many Requests'));
      break;
    case 'set throws without a promise':
      vi.mocked(cache.set).mockImplementation(() => { throw new Error('KV PUT failed: 429 Too Many Requests'); });
      break;
  }
  return cache;
}

const THROWING: Fault[] = ['get rejects', 'get throws without a promise', 'set rejects', 'set throws without a promise'];
const FAULTS: Fault[] = [...THROWING, 'get answers undefined on a miss'];

// ── The server ──────────────────────────────────────────────────────────────

interface Logged { logger: string; level: 'warning' | 'error'; message: string }

/**
 * A server as an embedder builds one: its own context, the registry and the
 * resolver constructed over the same cache, and `createMcpServer`.
 */
async function serve(cache: CacheProvider): Promise<{ client: Client; logged: Logged[]; close: () => Promise<void> }> {
  const logged: Logged[] = [];
  const logger: LoggerFactory = {
    createLogger: (name: string) => ({
      ...createMockLogger(),
      warning: (message: unknown) => { logged.push({ logger: name, level: 'warning', message: String(message) }); },
      error: (message: unknown) => { logged.push({ logger: name, level: 'error', message: String(message) }); },
    }),
  };
  const http = upstream();
  const mapsRegistry = new MapsRegistry(cache, undefined, undefined, undefined, http);
  const topicResolver = new TopicResolver(mapsRegistry, cache, undefined, undefined, http);
  const ctx: ServerContext = createMockContext({ cache, logger, http, mapsRegistry, topicResolver });

  const server = createMcpServer(ctx);
  const client = new Client({ name: 'test-client', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  await client.listTools();
  return {
    client,
    logged,
    close: async () => { await client.close(); await server.close(); },
  };
}

type Call =
  | { tool: string; args: Record<string, unknown> }
  | { resource: string };

const CALLS: [string, Call][] = [
  ['list_products', { tool: 'jamf_docs_list_products', args: {} }],
  ['list_products, JSON', { tool: 'jamf_docs_list_products', args: { responseFormat: 'json' } }],
  ['search', { tool: 'jamf_docs_search', args: { query: 'setup manager' } }],
  ['search, JSON', { tool: 'jamf_docs_search', args: { query: 'setup manager', responseFormat: 'json' } }],
  ['search by product', { tool: 'jamf_docs_search', args: { query: 'setup manager', product: 'jamf-pro' } }],
  ['get_article by url', { tool: 'jamf_docs_get_article', args: { url: POLICIES_URL } }],
  ['get_article by pair, JSON', { tool: 'jamf_docs_get_article', args: { mapId: PRO_MAP, contentId: CCP, responseFormat: 'json' } }],
  ['get_article on concepts.jamf.com', { tool: 'jamf_docs_get_article', args: { url: CONCEPTS_GUIDE_URL } }],
  ['get_toc by product', { tool: 'jamf_docs_get_toc', args: { product: 'jamf-pro' } }],
  ['get_toc of a support.jamf.com collection', { tool: 'jamf_docs_get_toc', args: { publication: 'jamf-support-jamf-pro' } }],
  ['glossary_lookup', { tool: 'jamf_docs_glossary_lookup', args: { term: 'MDM' } }],
  ['glossary_lookup, JSON', { tool: 'jamf_docs_glossary_lookup', args: { term: 'MDM', responseFormat: 'json' } }],
  ['batch_get_articles', { tool: 'jamf_docs_batch_get_articles', args: { urls: [POLICIES_URL, CCP_URL] } }],
  ['jamf://products', { resource: 'jamf://products' }],
  ['jamf://topics', { resource: 'jamf://topics' }],
  ['jamf://products/jamf-pro/toc', { resource: 'jamf://products/jamf-pro/toc' }],
  ['jamf://products/jamf-pro/versions', { resource: 'jamf://products/jamf-pro/versions' }],
];

/** What a client reads: every channel, or what the read threw. */
async function read(client: Client, call: Call): Promise<unknown> {
  try {
    if ('tool' in call) {
      const { isError, content, structuredContent } = await client.callTool({ name: call.tool, arguments: call.args });
      return { isError: isError ?? false, content, structuredContent };
    }
    const { contents } = await client.readResource({ uri: call.resource });
    // The one field that is the time of the read, not its answer.
    return contents.map(c => ('text' in c
      ? { ...c, text: c.text.replace(/"lastUpdated": "[^"]+"/g, '"lastUpdated": "…"') }
      : c));
  } catch (error) {
    return { threw: String(error) };
  }
}

/** The call made twice on one server: the second reads what the first stored. */
async function twice(cache: CacheProvider, call: Call): Promise<{ replies: unknown[]; logged: Logged[] }> {
  const { client, logged, close } = await serve(cache);
  try {
    return { replies: [await read(client, call), await read(client, call)], logged };
  } finally {
    await close();
  }
}

function isFailure(reply: unknown): boolean {
  if (typeof reply !== 'object' || reply === null) { return true; }
  if ('threw' in reply) { return true; }
  return 'isError' in reply && reply.isError === true;
}

describe.each(CALLS)('%s', (_label, call) => {
  it.each(FAULTS)('answers the same when the cache\'s %s', async (fault) => {
    const baseline = await twice(createMockCache(), call);
    // The fixtures answer everything the call reads: nothing failed, nothing
    // was logged. Otherwise this would compare two failures.
    expect(baseline.replies.filter(isFailure)).toEqual([]);
    expect(baseline.logged).toEqual([]);

    const { replies, logged } = await twice(faultyCache(fault), call);

    expect(replies).toEqual(baseline.replies);
    // Nothing but the cache itself says anything went wrong.
    expect(logged.filter(l => l.logger !== 'cache')).toEqual([]);
    const said = logged.map(l => `${l.level} ${l.message}`);
    if (THROWING.includes(fault)) {
      expect(said.length).toBeGreaterThan(0);
      const op = fault.startsWith('get') ? 'read' : 'write';
      for (const line of said) {
        expect(line).toMatch(new RegExp(`^warning Cache ${op} failed \\([a-z0-9-]+\\), `));
        expect(line).toMatch(/: Error: KV (GET|PUT) failed: /);
      }
    } else {
      // A miss is not a fault.
      expect(said).toEqual([]);
    }
  });
});
