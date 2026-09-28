/**
 * `loadOnce` (load-once.ts): one load of a cache entry at a time, per cache,
 * and the rule each reader that uses it keeps: read the entry inside the
 * load. What it saves the tools is
 * test/unit/tools/support-and-sitemap-fanout.test.ts.
 *
 * The cases about a reader do not wait on timers. The upstream answers when
 * the case says so, and a cache read or write the case holds is answered or
 * stored when it says so, so each call reaches the cache and the page in the
 * order the case names, however late a timer runs.
 */

import { describe, it, expect } from 'vitest';
import { loadOnce } from '../../../src/core/services/load-once.js';
import { fetchIntercomCollectionToc, listIntercomCollections } from '../../../src/core/services/intercom-service.js';
import { loadSitemap } from '../../../src/core/services/sitemap-service.js';
import { loadStaticIndex } from '../../../src/core/services/static-search-service.js';
import { loadListedTitles } from '../../../src/core/services/static-titles.js';
import { fetchStaticArticle } from '../../../src/core/services/static-article-service.js';
import { fetchTableOfContents } from '../../../src/core/services/toc-service.js';
import { cacheKey, type CacheKey } from '../../../src/core/services/cache-key.js';
import { STATIC_DOC_SOURCES, canonicalStaticUrl } from '../../../src/core/constants/sources.js';
import { HttpError, type HttpClient } from '../../../src/core/http-client.js';
import type { CacheProvider } from '../../../src/core/services/interfaces/cache.js';
import type { ServerContext } from '../../../src/core/types/context.js';
import type { FtTocNode } from '../../../src/core/types.js';
import { createMockCache, createMockContext, createStubMapsRegistry } from '../../helpers/mock-context.js';
import { collectionIn, createSupportUpstream, homeUrl, listedUrl, nextDataPage } from '../../helpers/support-upstream.js';
import { CONCEPTS_GUIDE_HTML, CONCEPTS_GUIDE_URL } from '../../fixtures/concepts-guide-page.js';
import { conceptsIndexPage, conceptsIndexUrl } from '../../helpers/concepts-index-pages.js';

const KEY = cacheKey('static-sitemap', { source: 'jamf-concepts' });
const OTHER_KEY = cacheKey('static-sitemap', { source: 'jamf-support' });

async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

/** A load that answers `value` after 20 ms, or fails, counting its runs. */
function counted<T>(value: T | Error): { load: () => Promise<T>; runs: () => number } {
  let runs = 0;
  return {
    load: async () => {
      runs++;
      await sleep(20);
      if (value instanceof Error) { throw value; }
      return value;
    },
    runs: () => runs,
  };
}

describe('loadOnce', () => {
  it('runs one load for the callers in flight together, and each gets its answer', async () => {
    const cache = createMockCache();
    const { load, runs } = counted(['entry']);

    const answers = await Promise.all([1, 2, 3].map(async () => await loadOnce(cache, KEY, load)));

    expect(answers).toEqual([['entry'], ['entry'], ['entry']]);
    expect(runs()).toBe(1);
  });

  it('shares a failure between the callers in flight, and the next call loads again', async () => {
    // Holding a settled failure would make one failed request look
    // permanent, where the cache stores nothing for it.
    const cache = createMockCache();
    const failing = counted<string>(new Error('503'));

    const settled = await Promise.allSettled([1, 2, 3].map(async () => await loadOnce(cache, KEY, failing.load)));

    expect(settled.map(result => result.status)).toEqual(['rejected', 'rejected', 'rejected']);
    expect(failing.runs()).toBe(1);

    const recovered = counted('entry');
    expect(await loadOnce(cache, KEY, recovered.load)).toBe('entry');
    expect(recovered.runs()).toBe(1);
  });

  it('runs a load again once the one before it has settled', async () => {
    // The cache is the only store: a load that stored nothing is run again.
    const cache = createMockCache();
    const { load, runs } = counted('entry');

    await loadOnce(cache, KEY, load);
    await loadOnce(cache, KEY, load);

    expect(runs()).toBe(2);
  });

  // CONTROL. The loads are scoped to one cache and one key: two caches, or
  // two keys, in flight together each run their own.
  it('does not share a load between two caches, or two keys', async () => {
    const [first, second] = [createMockCache(), createMockCache()];
    const { load, runs } = counted('entry');

    await Promise.all([
      loadOnce(first, KEY, load),
      loadOnce(second, KEY, load),
      loadOnce(first, OTHER_KEY, load),
    ]);

    expect(runs()).toBe(3);
  });
});

// ─── The readers ────────────────────────────────────────────────

const SUPPORT = STATIC_DOC_SOURCES['jamf-support'];
const CONCEPTS = STATIC_DOC_SOURCES['jamf-concepts'];
const JAMF_PRO = '12369024';
const MAP_ID = 'A4LI4vM0BILraYeOD89WGg';

const CONCEPTS_SITEMAP = `${CONCEPTS.baseUrl}/sitemap.xml`;
const MAP_TOC = `https://learn.jamf.com/api/khub/maps/${MAP_ID}/toc`;
const SUPPORT_ARTICLE = `${SUPPORT.baseUrl}/en/articles/11584648-grant-secure-token-to-enable-filevault`;

/** Jamf Pro's collection, as en's home page lists it. */
const JAMF_PRO_COLLECTION = {
  id: JAMF_PRO,
  slug: 'jamf-pro',
  name: 'Jamf Pro',
  description: '',
  url: listedUrl('en', collectionIn('en', JAMF_PRO)!),
  articleCount: 0,
};

const MAP_TOC_NODES: FtTocNode[] = [{
  tocId: 'toc-root',
  contentId: 'content-root',
  title: 'Managing Computers',
  prettyUrl: '/r/en-US/jamf-pro-documentation-current/Managing_Computers',
}];

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

function deferred(): Deferred {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

/** A context whose upstream and cache answer when the case says so. */
interface Held {
  ctx: ServerContext;
  /** Every page requested, in order. */
  requests: string[];
  /** Every key read, in order. */
  reads: CacheKey[];
  /** Every key written, in order. */
  writes: CacheKey[];
  /** Resolves once a page has been requested. */
  requested: Promise<void>;
  /** Answer every page requested so far, and each one after it at once. */
  answer: () => void;
  /**
   * Answer each later read of `key` with what the cache held when it was
   * read, but only once `until` resolves: a remote store that answers late.
   */
  holdReads: (key: CacheKey, until: Promise<void>) => void;
  /**
   * Store each later write of `key` only once `until` resolves. What it
   * returns resolves when the first such write is made.
   */
  holdWrites: (key: CacheKey, until: Promise<void>) => Promise<void>;
  /** support.jamf.com, whose `failing` makes a home page fail. */
  support: ReturnType<typeof createSupportUpstream>;
}

function held(): Held {
  const support = createSupportUpstream();
  const requests: string[] = [];
  const reads: CacheKey[] = [];
  const writes: CacheKey[] = [];
  const gate = deferred();
  const firstRequest = deferred();
  const heldReads = new Map<CacheKey, Promise<void>>();
  const heldWrites = new Map<CacheKey, { until: Promise<void>; taken: Deferred }>();

  const store = createMockCache();
  const cache: CacheProvider = {
    ...store,
    get: async <T>(key: CacheKey): Promise<T | null> => {
      reads.push(key);
      const value = await store.get<T>(key);
      const until = heldReads.get(key);
      if (until !== undefined) { await until; }
      return value;
    },
    set: async (key, value, ttl) => {
      writes.push(key);
      const hold = heldWrites.get(key);
      if (hold !== undefined) {
        hold.taken.resolve();
        await hold.until;
      }
      await store.set(key, value, ttl);
    },
  };

  const page = async (url: string): Promise<string> => {
    if (url === CONCEPTS_SITEMAP) {
      return `<urlset><url><loc>${CONCEPTS.baseUrl}/en/concepts/jamformer</loc></url></urlset>`;
    }
    if (url === CONCEPTS_GUIDE_URL) { return CONCEPTS_GUIDE_HTML; }
    if (url === conceptsIndexUrl('en', 'guides')) { return conceptsIndexPage('en', 'guides'); }
    if (url === conceptsIndexUrl('en', 'concepts')) { return conceptsIndexPage('en', 'concepts'); }
    if (url === SUPPORT_ARTICLE) {
      return nextDataPage({
        articleContent: { title: 'Grant Secure Token', blocks: [{ type: 'paragraph', text: 'Body.' }] },
        breadcrumbs: [{ label: 'Jamf Pro' }],
      });
    }
    return await support.http.getText(url);
  };
  const asked = async (url: string): Promise<void> => {
    requests.push(url);
    firstRequest.resolve();
    await gate.promise;
  };
  const http: HttpClient = {
    getText: async (url) => {
      await asked(url);
      return await page(url);
    },
    getJson: async <T>(url: string) => {
      await asked(url);
      if (url !== MAP_TOC) { throw new HttpError(404, 'Not Found', url); }
      return MAP_TOC_NODES as T;
    },
    postJson: async url => await Promise.reject(new HttpError(404, 'Not Found', url)),
  };

  const mapsRegistry = Object.assign(createStubMapsRegistry([]), {
    resolveMap: async () => await Promise.resolve({ mapId: MAP_ID, title: 'Jamf Pro Documentation', resolvedLocale: 'en-US' }),
  });

  return {
    ctx: createMockContext({ cache, http, mapsRegistry }),
    requests,
    reads,
    writes,
    requested: firstRequest.promise,
    answer: gate.resolve,
    holdReads: (key, until) => { heldReads.set(key, until); },
    holdWrites: async (key, until) => {
      const taken = deferred();
      heldWrites.set(key, { until, taken });
      await taken.promise;
    },
    support,
  };
}

interface Reader {
  name: string;
  /** Whether a key is the one of the entry this reader stores. */
  entry: (key: CacheKey) => boolean;
  /** The one page a cold read requests. */
  page: string;
  /** Pages a cold read requests besides, through readers of their own. */
  alsoRequests?: string[];
  read: (ctx: ServerContext) => Promise<unknown>;
}

function namespaceIs(namespace: string): (key: CacheKey) => boolean {
  return key => key.startsWith(`${namespace}:`);
}

const READERS: Reader[] = [
  {
    name: 'listIntercomCollections (a locale\'s listing)',
    entry: namespaceIs('intercom-collections'),
    page: homeUrl('en'),
    read: async ctx => await listIntercomCollections(ctx, SUPPORT, 'en'),
  },
  {
    name: 'fetchIntercomCollectionToc (a collection\'s tree)',
    entry: namespaceIs('intercom-collection-toc-v3'),
    page: canonicalStaticUrl(SUPPORT, JAMF_PRO_COLLECTION.url),
    read: async ctx => await fetchIntercomCollectionToc(ctx, SUPPORT, JAMF_PRO_COLLECTION),
  },
  {
    name: 'loadSitemap (concepts.jamf.com\'s sitemap)',
    entry: namespaceIs('static-sitemap'),
    page: CONCEPTS_SITEMAP,
    read: async ctx => await loadSitemap(ctx, CONCEPTS),
  },
  {
    // Built from the sitemap loadSitemap caches and the titles the section
    // index pages list, so a second build requests nothing, and only the
    // index's second write tells it from one build.
    name: 'loadStaticIndex (a locale\'s search title index)',
    entry: key => key.startsWith('static-search-index-'),
    page: CONCEPTS_SITEMAP,
    alsoRequests: [conceptsIndexUrl('en', 'guides'), conceptsIndexUrl('en', 'concepts')],
    read: async ctx => await loadStaticIndex(ctx, CONCEPTS, 'en'),
  },
  {
    name: 'loadListedTitles (a concepts.jamf.com section\'s index page)',
    entry: namespaceIs('static-section-titles'),
    page: conceptsIndexUrl('en', 'guides'),
    read: async ctx => await loadListedTitles(ctx, CONCEPTS, 'en', CONCEPTS.sections.slice(0, 1)),
  },
  {
    name: 'fetchStaticArticle (a concepts.jamf.com page)',
    entry: namespaceIs('static-article-v2'),
    page: CONCEPTS_GUIDE_URL,
    read: async ctx => await fetchStaticArticle(ctx, CONCEPTS, CONCEPTS_GUIDE_URL),
  },
  {
    name: 'fetchStaticArticle (a support.jamf.com article)',
    entry: namespaceIs('static-article-v2'),
    page: SUPPORT_ARTICLE,
    read: async ctx => await fetchStaticArticle(ctx, SUPPORT, SUPPORT_ARTICLE),
  },
  {
    name: 'fetchTableOfContents (a Fluid Topics map\'s tree)',
    entry: namespaceIs('ft-toc-v2'),
    page: MAP_TOC,
    read: async ctx => await fetchTableOfContents(ctx, 'jamf-pro'),
  },
];

describe('each reader that shares a load reads its entry inside the load', () => {
  // A call that read the entry before looking for a load could read it
  // before the first call stored it, and look after that call's load had
  // cleared: then it finds neither, and loads the entry again. Here the
  // second call starts while the first is waiting on its page, and any read
  // of the entry it makes outside a load is answered, with the miss it read,
  // only after the first call has settled.
  it.each(READERS)('$name', async ({ entry, page, alsoRequests = [], read }) => {
    const { ctx, requests, reads, writes, requested, answer, holdReads } = held();

    const first = read(ctx);
    await requested;
    const key = reads.find(entry);
    expect(key, 'the first call read its entry before it requested the page').toBeDefined();
    const firstSettled = deferred();
    holdReads(key!, firstSettled.promise);
    const second = read(ctx);
    answer();
    const answered = await first;
    firstSettled.resolve();

    expect(await second).toEqual(answered);
    expect([...requests].sort()).toEqual([page, ...alsoRequests].sort());
    expect(writes.filter(written => written === key)).toHaveLength(1);
  });
});

describe('listIntercomCollections, for the calls that remember a failure', () => {
  const FR = homeUrl('fr');
  const isFailure = namespaceIs('intercom-collections-failure');
  const UNAVAILABLE = `HTTP 503 Service Unavailable: ${FR}`;

  it('reads the failure inside the load, so a call that read it just before it was stored does not ask for the page', async () => {
    // Until 2026-09-28 a call read the failure before it looked for a
    // request in flight, and the failure was stored after the request had
    // cleared. A call between the two asked for the page again.
    const { ctx, requests, reads, requested, answer, holdReads, support } = held();
    support.failing.set('fr', '503');

    const first = listIntercomCollections(ctx, SUPPORT, 'fr', { rememberFailure: true });
    await requested;
    const failureKey = reads.find(isFailure);
    expect(failureKey, 'the first call read the failure before it requested the page').toBeDefined();
    const firstSettled = deferred();
    holdReads(failureKey!, firstSettled.promise);
    const second = listIntercomCollections(ctx, SUPPORT, 'fr', { rememberFailure: true });
    answer();
    await expect(first).rejects.toThrow(UNAVAILABLE);
    firstSettled.resolve();

    // The request's own failure: the second call joined the first one's load.
    await expect(second).rejects.toMatchObject({ message: UNAVAILABLE });
    expect(requests).toEqual([FR]);
  });

  it('stores the failure before the load settles, so a call that finds no load in flight reads it', async () => {
    // The first call's store of the failure is held: while it is, a call
    // either joins the load that is storing it, or, had the failure been
    // stored after the load cleared, would find no load and no failure.
    const { ctx, requests, reads, requested, answer, holdWrites, support } = held();
    support.failing.set('fr', '503');

    const first = listIntercomCollections(ctx, SUPPORT, 'fr', { rememberFailure: true });
    await requested;
    const failureKey = reads.find(isFailure);
    expect(failureKey).toBeDefined();
    const stored = deferred();
    const storing = holdWrites(failureKey!, stored.promise);
    answer();
    await storing;
    const second = listIntercomCollections(ctx, SUPPORT, 'fr', { rememberFailure: true });
    // Everything here answers within the microtask queue: let the second
    // call go as far as it can before the failure is stored.
    await new Promise(resolve => setImmediate(resolve));
    stored.resolve();

    await expect(first).rejects.toThrow(UNAVAILABLE);
    // The request's own failure: the second call joined the first one's load.
    await expect(second).rejects.toMatchObject({ message: UNAVAILABLE });
    expect(requests).toEqual([FR]);
  });

  it.each([
    ['list_products first', true],
    ['get_toc first', false],
  ])('with a failure remembered, a get_toc call made at once asks for the page, and reports its own failure (%s)', async (_, rememberingFirst) => {
    // get_toc does not remember a failure: it asks for its locale's page on
    // every call that finds no request for it in flight (#352). Only the
    // calls that remember one share the load that throws it again.
    const { ctx, requests, answer, support } = held();
    support.failing.set('fr', '503');
    answer();
    await expect(listIntercomCollections(ctx, SUPPORT, 'fr', { rememberFailure: true })).rejects.toThrow(UNAVAILABLE);
    requests.length = 0;

    const remembering = async (): Promise<unknown> =>
      await listIntercomCollections(ctx, SUPPORT, 'fr', { rememberFailure: true });
    const asking = async (): Promise<unknown> => await listIntercomCollections(ctx, SUPPORT, 'fr');
    const [first, second] = await Promise.allSettled(
      rememberingFirst ? [remembering(), asking()] : [asking(), remembering()],
    );
    const [remembered, asked] = rememberingFirst ? [first, second] : [second, first];

    expect(remembered).toMatchObject({
      status: 'rejected',
      reason: { message: `${UNAVAILABLE} (not asked again: it failed less than a minute ago)` },
    });
    expect(asked).toMatchObject({ status: 'rejected', reason: { message: UNAVAILABLE } });
    expect(requests).toEqual([FR]);
  });
});
