/**
 * Guard: every CACHE_TTL_* variable the READMEs document is how long the
 * caches it describes are kept. Checked where a TTL takes effect, the TTL a
 * cache entry is written with, through the registered tools over MCP, on the
 * context the Node server builds (`createNodeContext`, with the config it
 * reads from the environment). Only the http client is stubbed, and the cache
 * is an in-memory one that records each write.
 *
 * README.md documented `CACHE_TTL_TOC` as the "TTL for table of contents
 * cache entries", and until 2026-09-28 no build read it, from the first
 * release (2026-01-21) on. Since 2.0.0 `createNodeConfig` has parsed it into
 * `cacheTtl.toc`, and nothing read that. In 6.0.12 a Fluid Topics table of
 * contents, and the map TOC index an article's breadcrumb, navigation and
 * internal links are read from, were kept for `CACHE_TTL_ARTICLE`, and the
 * concepts.jamf.com and support.jamf.com tables of contents for
 * `CACHE_TTL_PRODUCTS`. Live on 2026-09-28, with `CACHE_TTL_TOC=60000`, all
 * four were written with 24 hours or 7 days, and read from the cache 65
 * seconds later. The products and versions `jamf_docs_list_products` lists
 * were kept for `CACHE_TTL_ARTICLE`, though the README gives the product list
 * `CACHE_TTL_PRODUCTS`. They are now read on every call from the maps list,
 * which is kept for `CACHE_TTL_PRODUCTS`.
 *
 * env-vars-documented.test.ts passed throughout: it asks whether a documented
 * name appears in src/, and the parse in platforms/node/config.ts is where it
 * appears. So this asks what the value does.
 */

import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createMcpServer } from '../../src/core/create-server.js';
import { fetchArticleFromFt } from '../../src/core/services/article-service.js';
import { createNodeContext } from '../../src/platforms/node/context.js';
import { HttpError, type HttpClient } from '../../src/core/http-client.js';
import { CACHE_NAMESPACES } from '../../src/core/services/cache-key.js';
import type { CacheProvider } from '../../src/core/services/interfaces/index.js';
import { createMockCache, createMockLoggerFactory } from '../helpers/mock-context.js';
import { articleUpstream, CCP, CCP_URL, PRO_MAP } from '../helpers/article-upstream.js';
import { everySourceUpstream, SUPPORT_ARTICLE_URL } from '../helpers/every-source-upstream.js';
import { CONCEPTS_SITEMAP, MAPS_LIST } from '../helpers/search-upstream.js';
import { CONCEPTS_GUIDE_URL } from '../fixtures/concepts-guide-page.js';

const ROOT = path.resolve(__dirname, '../..');
const DOCS = ['README.md', 'docs/README.zh-TW.md'];

/** The CACHE_TTL_* variables either README lists in a configuration table. */
function documentedTtlVariables(): string[] {
  const names = DOCS.flatMap(doc => [
    ...fs.readFileSync(path.join(ROOT, doc), 'utf8')
      .matchAll(/^\| {0,2}`(CACHE_TTL_[A-Z0-9_]+)` {0,2}\|/gm),
  ].map(m => m[1]));
  return [...new Set(names)].sort();
}

const DOCUMENTED = documentedTtlVariables();

/**
 * A value for each variable that no other TTL in src/ has: 101 minutes and 7
 * seconds, 102 minutes and 7 seconds, and so on. Every one is in the range
 * the variables accept (1 minute to 30 days).
 */
const VALUE: Record<string, number> = Object.fromEntries(
  DOCUMENTED.map((name, i) => [name, (101 + i) * 60_000 + 7_000]),
);

const DAY = 24 * 60 * 60 * 1000;

// ── Harness ─────────────────────────────────────────────────────────────────

/** A cache write, as the provider received it. */
interface Write {
  namespace: string;
  ttl: number | undefined;
}

interface Running {
  client: Client;
  /** Every cache write, in order. Kept here rather than read off the mock, which is cleared between tests. */
  writes: Write[];
  requests: string[];
  close: () => Promise<void>;
}

/**
 * A server on the context the Node server builds, with its config read from
 * `env`. Every documented CACHE_TTL_* variable `env` does not set is unset, so
 * a shell or CI job that exports one cannot change what "unset" means here.
 */
async function start(env: Record<string, string>): Promise<Running> {
  for (const name of DOCUMENTED) { vi.stubEnv(name, undefined); }
  for (const [name, value] of Object.entries(env)) { vi.stubEnv(name, value); }

  const writes: Write[] = [];
  const store = createMockCache();
  const cache: CacheProvider = {
    ...store,
    set: async (key, value, ttl) => {
      writes.push({ namespace: key.split(':')[0] ?? '', ttl });
      await store.set(key, value, ttl);
    },
  };
  const { http, requests } = everySourceUpstream();
  const ctx = createNodeContext({ cache, http, logger: createMockLoggerFactory() });
  vi.unstubAllEnvs();

  const server = createMcpServer(ctx);
  const client = new Client({ name: 'test-client', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  // Listed first, so every structuredContent is checked against its schema.
  await client.listTools();

  return {
    client,
    writes,
    requests,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

interface CallResult {
  isError?: boolean;
  content: { type: string; text?: string }[];
}

async function call(running: Running, name: string, args: Record<string, unknown>): Promise<void> {
  const result = await running.client.callTool({ name, arguments: args }) as CallResult;
  expect(result.isError, `${name} ${JSON.stringify(args)}: ${result.content[0]?.text ?? ''}`).not.toBe(true);
}

/** A table of contents `jamf_docs_get_toc` serves, and the request its tree is read from. */
interface TocSource {
  label: string;
  args: Record<string, unknown>;
  /** Whether a request is the one the tree is read from. */
  readsTree: (url: string) => boolean;
}

const TOC_SOURCES: TocSource[] = [
  {
    label: 'Jamf Pro\'s, from its Fluid Topics map',
    args: { product: 'jamf-pro' },
    readsTree: url => new URL(url).pathname === `/api/khub/maps/${PRO_MAP}/toc`,
  },
  {
    label: 'concepts.jamf.com\'s guides, from its sitemap',
    args: { publication: 'jamf-concepts-guides' },
    readsTree: url => url === CONCEPTS_SITEMAP,
  },
  {
    label: 'support.jamf.com\'s Jamf Pro collection, from its collection page',
    args: { publication: 'jamf-support-jamf-pro' },
    readsTree: url => new URL(url).hostname === 'support.jamf.com'
      && new URL(url).pathname.startsWith('/en/collections/'),
  },
];

/** Every call a client makes here: each tool and resource that writes a cache a variable describes. */
async function exercise(running: Running): Promise<void> {
  for (const source of TOC_SOURCES) {
    await call(running, 'jamf_docs_get_toc', source.args);
  }
  await call(running, 'jamf_docs_get_article', { mapId: PRO_MAP, contentId: CCP });
  // Resolved through the map's topic index.
  await call(running, 'jamf_docs_get_article', { url: CCP_URL });
  await call(running, 'jamf_docs_get_article', { url: CONCEPTS_GUIDE_URL });
  await call(running, 'jamf_docs_get_article', { url: SUPPORT_ARTICLE_URL });
  await call(running, 'jamf_docs_search', { query: 'prestage' });
  await call(running, 'jamf_docs_glossary_lookup', { term: 'MDM' });
  await call(running, 'jamf_docs_list_products', {});
  await running.client.readResource({ uri: 'jamf://topics' });
}

/** A namespace less its version, so `ft-toc-v2` and a later `ft-toc-v3` are one cache. */
function cacheOf(namespace: string): string {
  return namespace.replace(/-v\d+$/, '');
}

/**
 * The variable each cache is kept for, as the READMEs describe it, by
 * namespace less its version ({@link cacheOf}). `null` for a TTL of its own
 * that no variable sets.
 */
const KEPT_FOR: Readonly<Record<string, string | null>> = {
  'ft-search': 'CACHE_TTL_SEARCH',
  // Each article, from any source, with the breadcrumb and internal links
  // built when it was fetched.
  'ft-article': 'CACHE_TTL_ARTICLE',
  'static-article': 'CACHE_TTL_ARTICLE',
  // The glossary's term list, although it is read from a map's table of
  // contents, is kept with its definitions.
  'glossary-toc': 'CACHE_TTL_ARTICLE',
  'glossary-content': 'CACHE_TTL_ARTICLE',
  // What a learn.jamf.com page url is resolved with.
  'ft-topic-index': 'CACHE_TTL_ARTICLE',
  'metadata-topics': 'CACHE_TTL_ARTICLE',
  // The product list: the maps list, which the products and versions
  // list_products and jamf://products list are read from on every call,
  // support.jamf.com's collections, and the search indexes of concepts.jamf.com
  // and support.jamf.com.
  'maps-registry': 'CACHE_TTL_PRODUCTS',
  'intercom-collections': 'CACHE_TTL_PRODUCTS',
  'static-search-index': 'CACHE_TTL_PRODUCTS',
  // Every table of contents get_toc and the TOC resource serve, and the map
  // TOC index an article's navigation is read from.
  'ft-toc': 'CACHE_TTL_TOC',
  'ft-tocindex': 'CACHE_TTL_TOC',
  'static-sitemap': 'CACHE_TTL_TOC',
  'intercom-collection-toc': 'CACHE_TTL_TOC',
  // A minute, and an hour.
  'intercom-collections-failure': null,
  'metadata-product-availability': null,
  // A minute: only a catalogue the registry outage forced is cached. A real
  // one was, for CACHE_TTL_ARTICLE, until 2026-09-28.
  'metadata-products': null,
};

// ── The variables, by what they are written with ───────────────────────────

describe('every documented CACHE_TTL_* variable is the TTL of the caches it describes', () => {
  let running: Running;

  beforeAll(async () => {
    running = await start(Object.fromEntries(DOCUMENTED.map(name => [name, String(VALUE[name])])));
    await exercise(running);
  });

  afterAll(async () => {
    await running.close();
  });

  it('finds the variables in the READMEs', () => {
    // A regex that silently stops matching would make every case below vacuous.
    // A variable documented later is checked below without a change here.
    expect(DOCUMENTED).toEqual(expect.arrayContaining(
      ['CACHE_TTL_ARTICLE', 'CACHE_TTL_PRODUCTS', 'CACHE_TTL_SEARCH', 'CACHE_TTL_TOC'],
    ));
  });

  // A variable documented later that this fails for may be read by a cache
  // `exercise` does not reach. Reach it there.
  it.each(DOCUMENTED)('%s is the TTL some cache entry is written with', name => {
    const written = running.writes.map(({ namespace, ttl }) => `${namespace} ${String(ttl)}`);
    expect(
      running.writes.filter(({ ttl }) => ttl === VALUE[name]),
      `${name}=${String(VALUE[name])} was set, and no cache entry was written with it. ` +
      `A documented TTL that nothing reads does nothing. Written: ${JSON.stringify(written)}`,
    ).not.toEqual([]);
  });

  it('knows what every cache is kept for', () => {
    // A cache added later is listed here, with the variable the READMEs say
    // it is kept for, and is then checked below.
    expect(CACHE_NAMESPACES.map(cacheOf).filter(cache => !Object.hasOwn(KEPT_FOR, cache))).toEqual([]);
    expect(Object.keys(KEPT_FOR).filter(cache => !CACHE_NAMESPACES.map(cacheOf).includes(cache))).toEqual([]);
  });

  it.each(Object.entries(KEPT_FOR).filter((entry): entry is [string, string] => entry[1] !== null))(
    '%s is kept for %s',
    (cache, variable) => {
      const ttls = running.writes.filter(write => cacheOf(write.namespace) === cache).map(write => write.ttl);
      expect(ttls, `${cache} was not written: reach it in exercise()`).not.toEqual([]);
      expect(ttls).toEqual(ttls.map(() => VALUE[variable]));
    },
  );

  it.each(Object.entries(KEPT_FOR).filter(([, variable]) => variable === null).map(([cache]) => cache))(
    '%s is kept for a TTL of its own, not a documented one',
    cache => {
      const documented = new Set(Object.values(VALUE));
      const ttls = running.writes.filter(write => cacheOf(write.namespace) === cache).map(write => write.ttl);
      expect(ttls.filter(ttl => ttl !== undefined && documented.has(ttl))).toEqual([]);
    },
  );
});

// ── What the TTL does ───────────────────────────────────────────────────────

describe('a table of contents is read again once it is older than CACHE_TTL_TOC, and not before', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Ask for `source` twice, `apart` ms apart, on a fresh server; how many times its tree was read. */
  async function treeReads(env: Record<string, string>, source: TocSource, apart: number): Promise<number> {
    vi.useFakeTimers({ toFake: ['Date'] });
    const running = await start(env);
    try {
      await call(running, 'jamf_docs_get_toc', source.args);
      vi.setSystemTime(Date.now() + apart);
      await call(running, 'jamf_docs_get_toc', source.args);
      return running.requests.filter(source.readsTree).length;
    } finally {
      await running.close();
    }
  }

  it.each(TOC_SOURCES)('CACHE_TTL_TOC=60000: read again after 61 s: $label', async (source) => {
    expect(await treeReads({ CACHE_TTL_TOC: '60000' }, source, 61_000)).toBe(2);
  });

  it.each(TOC_SOURCES)('CACHE_TTL_TOC=60000: not read again after 59 s: $label', async (source) => {
    expect(await treeReads({ CACHE_TTL_TOC: '60000' }, source, 59_000)).toBe(1);
  });

  it.each(TOC_SOURCES)(
    'CACHE_TTL_ARTICLE and CACHE_TTL_PRODUCTS at one minute do not expire it: $label',
    async (source) => {
      // The TTLs these were kept for until 2026-09-28. CACHE_TTL_TOC is unset,
      // so its default holds: 24 hours.
      const env = { CACHE_TTL_ARTICLE: '60000', CACHE_TTL_PRODUCTS: '60000' };
      expect(await treeReads(env, source, 61_000)).toBe(1);
      expect(await treeReads(env, source, DAY + 1_000)).toBe(2);
    },
  );
});

describe('list_products reads its products and versions from a maps list no older than CACHE_TTL_PRODUCTS', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Call list_products twice, `apart` ms apart, on a fresh server; how many times the maps list was read. */
  async function mapsListReads(env: Record<string, string>, apart: number): Promise<number> {
    vi.useFakeTimers({ toFake: ['Date'] });
    const running = await start(env);
    try {
      await call(running, 'jamf_docs_list_products', {});
      vi.setSystemTime(Date.now() + apart);
      await call(running, 'jamf_docs_list_products', {});
      return running.requests.filter(url => url === MAPS_LIST).length;
    } finally {
      await running.close();
    }
  }

  // That both halves of a reply follow the list read here, and a server
  // started late in its life, are in list-products-maps-list-age.test.ts.
  it('CACHE_TTL_PRODUCTS=60000: read again after 61 s, and not after 59 s', async () => {
    expect(await mapsListReads({ CACHE_TTL_PRODUCTS: '60000' }, 61_000)).toBe(2);
    expect(await mapsListReads({ CACHE_TTL_PRODUCTS: '60000' }, 59_000)).toBe(1);
  });

  it('CACHE_TTL_ARTICLE at one minute, which the products and versions were kept for until 2026-09-28, does not expire it', async () => {
    expect(await mapsListReads({ CACHE_TTL_ARTICLE: '60000' }, 61_000)).toBe(1);
  });
});

describe('an article\'s map TOC index is read again once it is older than CACHE_TTL_TOC', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('while the article itself is served from the cache', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const running = await start({ CACHE_TTL_TOC: '60000' });
    try {
      // The first call loads the index for the breadcrumb, the navigation and
      // the links. The next two find the article cached, and the navigation
      // loads the index for itself, each time after it has expired.
      for (let i = 0; i < 3; i++) {
        await call(running, 'jamf_docs_get_article', { mapId: PRO_MAP, contentId: CCP });
        vi.setSystemTime(Date.now() + 61_000);
      }
      const toc = `https://learn.jamf.com/api/khub/maps/${PRO_MAP}/toc`;
      const content = `https://learn.jamf.com/api/khub/maps/${PRO_MAP}/topics/${CCP}/content`;
      expect(running.requests.filter(url => url === toc)).toHaveLength(3);
      // CACHE_TTL_ARTICLE is unset: 24 hours.
      expect(running.requests.filter(url => url === content)).toHaveLength(1);
    } finally {
      await running.close();
    }
  });
});

// ── For an embedder ─────────────────────────────────────────────────────────

describe('fetchArticleFromFt, called with its own TTLs', () => {
  /** The TTL of each write, by namespace, after fetching Computer Configuration Profiles. */
  async function writesFor(ttls: { cacheTtl?: number; tocCacheTtl?: number }): Promise<Record<string, (number | undefined)[]>> {
    const store = createMockCache();
    const ft = articleUpstream();
    const http: HttpClient = {
      ...ft,
      getJson: async <T>(url: string) => await ft.getJson(url) as T,
      postJson: async (url) => await Promise.reject(new HttpError(404, 'Not Found', url)),
    };
    await fetchArticleFromFt(store, PRO_MAP, CCP, '', { http, ...ttls });
    const out: Record<string, (number | undefined)[]> = {};
    for (const [key, , ttl] of vi.mocked(store.set).mock.calls) {
      const namespace = key.split(':')[0] ?? '';
      out[namespace] = [...(out[namespace] ?? []), ttl];
    }
    return out;
  }

  it('keeps the map TOC index for tocCacheTtl, and the article for cacheTtl', async () => {
    expect(await writesFor({ cacheTtl: DAY, tocCacheTtl: 60_000 }))
      .toEqual({ 'ft-tocindex-v3': [60_000], 'ft-article-v3': [DAY] });
  });

  it('without tocCacheTtl, keeps the index for cacheTtl, as it did before tocCacheTtl existed', async () => {
    expect(await writesFor({ cacheTtl: DAY }))
      .toEqual({ 'ft-tocindex-v3': [DAY], 'ft-article-v3': [DAY] });
  });
});
