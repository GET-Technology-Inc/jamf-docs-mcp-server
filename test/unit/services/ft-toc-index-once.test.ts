/**
 * How often one article, and a burst of articles, load a map's TOC index.
 *
 * `fetchArticleFromFt` has three consumers of the topic's own map index: the
 * internal-link resolver, the breadcrumb fallback and the navigation block.
 * Each used to load it for itself, with nothing shared between them and
 * nothing shared between concurrent callers either (#339). Every answer was
 * still right, so nothing went red; what it cost was requests and time:
 *
 *   1. A `/toc` that times out or 5xxs is never cached, so each consumer
 *      retried it in turn: three timeouts and three warnings for one article.
 *   2. Concurrent articles in a cold map each missed the cache and fetched the
 *      TOC: three times at `batch_get_articles`' default concurrency, five at
 *      its maximum.
 *   3. An article-cache miss read the `ft-tocindex-v3` entry three times,
 *      which a serialising `CacheProvider` deserialises on every read.
 *
 * The existing "shares the TOC fetch" cases pin the sequential property. These
 * pin the concurrent one and the per-article one.
 *
 * The TOC answers on a timer and topics at once, because that is the shape of
 * the race. Measured live on 2026-09-26, the workers of a cold batch reached
 * `/toc` within 1-53 ms of each other and one download of it took 200-1340 ms,
 * so every one of them missed the cache.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/core/http-client.js', async () => {
  const actual = await import('../../../src/core/http-client.js');
  return {
    ...actual,
    httpGetJson: vi.fn(),
    httpGetText: vi.fn(),
    httpPostJson: vi.fn(),
  };
});

import { httpGetJson, httpGetText, HttpError } from '../../../src/core/http-client.js';
import {
  buildInternalLinkResolver,
  fetchTopicAncestors,
  fetchTopicNavigation,
} from '../../../src/core/services/ft-internal-link.js';
import { fetchArticleFromFt } from '../../../src/core/services/article-service.js';
import {
  createMockCache,
  createMockLogger,
  createTestHttpClient,
} from '../../helpers/mock-context.js';
import type { CacheProvider, Logger } from '../../../src/core/services/interfaces/index.js';
import type { FtTocNode, FtTopicInfo } from '../../../src/core/types.js';

const mockedGetJson = vi.mocked(httpGetJson);
const mockedGetText = vi.mocked(httpGetText);
const http = createTestHttpClient();

const MAP_ID = 'FtEgPHSd28ZhPyLlTkrYTA';
const OTHER_MAP_ID = 'Dpq4WYQPn8VQvKQZL~AxAA';

/** Long enough that every concurrent caller reaches the TOC before it lands. */
const TOC_LATENCY_MS = 20;

const CHILDREN: FtTocNode[] = Array.from({ length: 10 }, (_value, index) => ({
  tocId: `toc-${String(index)}`,
  contentId: `content-${String(index)}`,
  title: `Topic ${String(index)}`,
  prettyUrl: `/r/en-US/jamf-pro-documentation-current/Topic_${String(index)}`,
}));

const TOC: FtTocNode[] = [{
  tocId: 'toc-root',
  contentId: 'content-root',
  title: 'Computers',
  prettyUrl: '/r/en-US/jamf-pro-documentation-current/Computers',
  children: CHILDREN,
}];

const OTHER_TOC: FtTocNode[] = [{
  tocId: 'other-toc',
  contentId: 'other-content',
  title: 'Jamf School',
  prettyUrl: '/r/en-US/jamf-school-documentation/Jamf_School',
}];

const TOCS: Record<string, FtTocNode[]> = { [MAP_ID]: TOC, [OTHER_MAP_ID]: OTHER_TOC };

const link = (mapId: string, tocId: string, text: string): string =>
  `<span class="link ft-internal-link" data-mapid="${mapId}" data-tocid="${tocId}">${text}</span>`;

/** A body linking into its own map, and one external anchor. */
const LINKED_HTML = '<div class="body conbody"><p class="p">See '
  + `${link(MAP_ID, 'toc-1', 'Topic 1')}, or `
  + '<a class="link" href="https://support.apple.com/guide/x">Apple</a>.</p></div>';
const PLAIN_HTML = '<div class="body conbody"><p class="p">Body.</p></div>';
/** A body linking into its own map and into another one. */
const CROSS_MAP_HTML = `<div class="body conbody"><p class="p">${link(MAP_ID, 'toc-1', 'Topic 1')}`
  + ` and ${link(OTHER_MAP_ID, 'other-toc', 'Jamf School')}.</p></div>`;

let html: string;
/** Maps whose `/toc` answers 503. */
let failingMaps: Set<string>;
/** `/toc` requests awaiting their answer, and the most there have been at once. */
let tocsInFlight: number;
let maxTocsInFlight: number;

function topic(contentId: string): FtTopicInfo {
  return {
    title: `Title of ${contentId}`,
    id: contentId,
    contentApiEndpoint: `/api/khub/maps/${MAP_ID}/topics/${contentId}/content`,
    metadata: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  html = PLAIN_HTML;
  failingMaps = new Set();
  tocsInFlight = 0;
  maxTocsInFlight = 0;
  mockedGetJson.mockImplementation(async (url: string) => {
    const path = decodeURIComponent(new URL(url).pathname);
    const toc = /^\/api\/khub\/maps\/([^/]+)\/toc$/.exec(path);
    if (toc !== null) {
      maxTocsInFlight = Math.max(maxTocsInFlight, ++tocsInFlight);
      await new Promise((resolve) => setTimeout(resolve, TOC_LATENCY_MS));
      tocsInFlight--;
      if (failingMaps.has(toc[1])) {
        throw new HttpError(503, 'Service Unavailable', url);
      }
      return Object.hasOwn(TOCS, toc[1]) ? TOCS[toc[1]] : [];
    }
    await Promise.resolve();
    const id = /\/topics\/([^/]+)$/.exec(path)?.[1];
    if (id !== undefined) {
      return topic(id);
    }
    throw new Error(`Unexpected GET JSON: ${url}`);
  });
  mockedGetText.mockImplementation(async (url: string) => {
    await Promise.resolve();
    if (url.endsWith('/content')) {
      return html;
    }
    throw new Error(`Unexpected GET text: ${url}`);
  });
});

/** `GET /maps/{mapId}/toc` requests, per map. */
function tocFetches(mapId = MAP_ID): number {
  return mockedGetJson.mock.calls
    .filter(([url]) => decodeURIComponent(new URL(url).pathname) === `/api/khub/maps/${mapId}/toc`)
    .length;
}

/** Reads of the cached TOC index through this cache. */
function indexReads(cache: CacheProvider): number {
  return vi.mocked(cache.get).mock.calls.filter(([key]) => key.startsWith('ft-tocindex')).length;
}

function warnings(logger: Logger): string[] {
  return vi.mocked(logger.warning).mock.calls.map(([message]) => String(message));
}

// ─── The index itself, under concurrency ────────────────────────

describe('concurrent loads of one map TOC index', () => {
  it('fetches the TOC once for three cold lookups in flight together', async () => {
    const cache = createMockCache();

    const [resolve, ancestors, navigation] = await Promise.all([
      buildInternalLinkResolver({ http, cache, mapIds: [MAP_ID] }),
      fetchTopicAncestors({ http, cache, mapId: MAP_ID, contentId: 'content-1' }),
      fetchTopicNavigation({ http, cache, mapId: MAP_ID, contentId: 'content-1' }),
    ]);

    // Each still gets the whole answer, not a share of one.
    expect(resolve(MAP_ID, 'toc-1')).toBe('https://learn.jamf.com/r/en-US/jamf-pro-documentation-current/Topic_1');
    expect(ancestors).toEqual(['Computers']);
    expect(navigation?.parent?.title).toBe('Computers');
    expect(tocFetches()).toBe(1);
  });

  it('shares one failed attempt between the callers in flight, and the next load tries again', async () => {
    // The guard holds a load only while it is in flight. Keeping a settled
    // failure would make one blip at the upstream look permanent — the same
    // reason `TopicResolver.inflight` deletes its entry on settle.
    failingMaps.add(MAP_ID);
    const cache = createMockCache();
    const loggers = [createMockLogger(), createMockLogger(), createMockLogger()];

    const navigations = await Promise.all(loggers.map(async (logger) =>
      await fetchTopicNavigation({ http, cache, mapId: MAP_ID, contentId: 'content-1', logger })));

    expect(navigations).toEqual([undefined, undefined, undefined]);
    expect(tocFetches()).toBe(1);
    // Every caller still hears about the failure it degraded on.
    for (const logger of loggers) {
      expect(warnings(logger)).toHaveLength(1);
    }

    failingMaps.clear();
    const recovered = await fetchTopicNavigation({ http, cache, mapId: MAP_ID, contentId: 'content-1' });
    expect(recovered?.parent?.title).toBe('Computers');
    expect(tocFetches()).toBe(2);
  });

  // CONTROL. The guard is scoped to one cache, as TopicResolver's is to one
  // server, so it cannot hand one server's index to another. Two caches in
  // flight together each fetch their own.
  it('does not share a load between two caches', async () => {
    await Promise.all([createMockCache(), createMockCache()].map(async (cache) =>
      await fetchTopicNavigation({ http, cache, mapId: MAP_ID, contentId: 'content-1' })));

    expect(tocFetches()).toBe(2);
  });
});

// ─── An index the caller already settled ───────────────────────

describe('a settled index passed as `loaded`', () => {
  // It stands in for a load only of the map it was settled for. One settled
  // for another map, failed or not, says nothing about this one, so this map
  // is loaded as if nothing had been passed.
  it('is ignored when it was settled for another map', async () => {
    const cache = createMockCache();
    const logger = createMockLogger();
    const loaded = { mapId: OTHER_MAP_ID, index: undefined };

    const ancestors = await fetchTopicAncestors({ http, cache, mapId: MAP_ID, contentId: 'content-1', logger, loaded });
    const navigation = await fetchTopicNavigation({ http, cache, mapId: MAP_ID, contentId: 'content-1', logger, loaded });

    expect(ancestors).toEqual(['Computers']);
    expect(navigation?.parent?.title).toBe('Computers');
    expect(tocFetches(MAP_ID)).toBe(1);
    expect(tocFetches(OTHER_MAP_ID)).toBe(0);
    expect(warnings(logger)).toEqual([]);
  });
});

// ─── One article ────────────────────────────────────────────────

describe('fetchArticleFromFt reads its own map index once', () => {
  it.each([
    ['with internal links into it', LINKED_HTML],
    ['without internal links', PLAIN_HTML],
  ])('on an article-cache miss, %s', async (_label, body) => {
    const cache = createMockCache();
    // Warm the index, so what is counted is reads rather than fetches.
    await fetchTopicNavigation({ http, cache, mapId: MAP_ID, contentId: 'content-0' });
    vi.mocked(cache.get).mockClear();
    html = body;

    const article = await fetchArticleFromFt(cache, MAP_ID, 'content-1', '', { http });

    // All three consumers were served from that one read.
    expect(article.breadcrumb).toEqual(['Computers']);
    expect(article.navigation?.parent?.title).toBe('Computers');
    expect(indexReads(cache)).toBe(1);
  });

  it('on an article-cache hit', async () => {
    const cache = createMockCache();
    await fetchArticleFromFt(cache, MAP_ID, 'content-1', '', { http });
    vi.mocked(cache.get).mockClear();

    const article = await fetchArticleFromFt(cache, MAP_ID, 'content-1', '', { http });

    expect(article.navigation?.parent?.title).toBe('Computers');
    expect(indexReads(cache)).toBe(1);
  });

  // A link into another map needs that map's TOC, which is a different index:
  // one read of each, and one fetch of each when cold. It was four reads, three
  // of them the own map's. The two fetches overlap, as they did when the
  // resolver loaded both: loading the own map first and the other after it
  // would have a cold cross-map article wait for two `/toc` downloads in a row.
  it('and each other map it links into once more', async () => {
    const cache = createMockCache();
    html = CROSS_MAP_HTML;

    const article = await fetchArticleFromFt(cache, MAP_ID, 'content-1', '', { http });

    expect(article.content).toContain('(https://learn.jamf.com/r/en-US/jamf-pro-documentation-current/Topic_1)');
    expect(article.content).toContain('(https://learn.jamf.com/r/en-US/jamf-school-documentation/Jamf_School)');
    expect(indexReads(cache)).toBe(2);
    expect(tocFetches(MAP_ID)).toBe(1);
    expect(tocFetches(OTHER_MAP_ID)).toBe(1);
    expect(maxTocsInFlight).toBe(2);
  });
});

describe('fetchArticleFromFt with a map TOC that will not load', () => {
  /**
   * "A TOC that will not load costs its links, not the article" — and it was
   * costing the article three sequential attempts at it. With the default 15 s
   * request timeout and no retries, that is 45 s added to a reply whose topic
   * had already been fetched.
   */
  it('attempts it once, warns once, and still serves the article', async () => {
    failingMaps.add(MAP_ID);
    html = LINKED_HTML;
    const logger = createMockLogger();

    const article = await fetchArticleFromFt(createMockCache(), MAP_ID, 'content-1', '', { http, logger });

    expect(tocFetches()).toBe(1);
    expect(warnings(logger)).toHaveLength(1);
    // One warning for all three things the failure costs this article.
    expect(warnings(logger)[0]).toContain(`TOC index unavailable for map ${MAP_ID}, this article will have`
      + ' no breadcrumb or navigation, and its internal links into that map will render without a destination: ');
    // Degraded exactly as before: the link is text, the breadcrumb and the
    // navigation are absent, and the rest of the article is there.
    expect(article.title).toBe('Title of content-1');
    expect(article.content).toContain('Topic 1');
    expect(article.content).not.toContain('Topic_1');
    expect(article.content).toContain('[Apple](https://support.apple.com/guide/x)');
    expect(article.breadcrumb).toBeUndefined();
    expect(article.navigation).toBeUndefined();
  });

  // The warning names the links only when the topic has some into that map:
  // a topic without internal links, or with links only into another map, loses
  // its breadcrumb and navigation and nothing else.
  it.each([
    ['without internal links', PLAIN_HTML],
    ['linking only into another map',
      `<div class="body conbody"><p class="p">${link(OTHER_MAP_ID, 'other-toc', 'Jamf School')}.</p></div>`],
  ])('warns only of what it costs a topic %s', async (_label, body) => {
    failingMaps.add(MAP_ID);
    html = body;
    const logger = createMockLogger();

    await fetchArticleFromFt(createMockCache(), MAP_ID, 'content-1', '', { http, logger });

    expect(tocFetches()).toBe(1);
    expect(warnings(logger)).toHaveLength(1);
    expect(warnings(logger)[0]).toContain(
      `TOC index unavailable for map ${MAP_ID}, this article will have no breadcrumb or navigation: `,
    );
  });

  // Another map's TOC costs only the links into it. The own map still loads,
  // so the breadcrumb, the navigation and the links into the own map are all
  // there, and the one warning is about the other map.
  it('costs only the links into it when it is another map\'s', async () => {
    failingMaps.add(OTHER_MAP_ID);
    html = CROSS_MAP_HTML;
    const logger = createMockLogger();

    const article = await fetchArticleFromFt(createMockCache(), MAP_ID, 'content-1', '', { http, logger });

    expect(tocFetches(MAP_ID)).toBe(1);
    expect(tocFetches(OTHER_MAP_ID)).toBe(1);
    expect(warnings(logger)).toHaveLength(1);
    expect(warnings(logger)[0]).toContain(
      `TOC index unavailable for map ${OTHER_MAP_ID}, its internal links will render without a destination: `,
    );
    expect(article.content).toContain('(https://learn.jamf.com/r/en-US/jamf-pro-documentation-current/Topic_1)');
    expect(article.content).toContain('Jamf School');
    expect(article.content).not.toContain('Jamf_School');
    expect(article.breadcrumb).toEqual(['Computers']);
    expect(article.navigation?.parent?.title).toBe('Computers');
  });

  // Only navigation reads the index on an article-cache hit, so this was
  // already one attempt. Pinned so the change for the miss cannot add one.
  // That a cached article pays even this while `/toc` is down is #339's
  // out-of-scope note: nothing records the failure, by choice.
  it('attempts it once, and warns once, for a cached article too', async () => {
    failingMaps.add(MAP_ID);
    const cache = createMockCache();
    await fetchArticleFromFt(cache, MAP_ID, 'content-1', '', { http, logger: createMockLogger() });
    mockedGetJson.mockClear();
    mockedGetText.mockClear();
    const logger = createMockLogger();

    const article = await fetchArticleFromFt(cache, MAP_ID, 'content-1', '', { http, logger });

    expect(mockedGetText).not.toHaveBeenCalled();
    expect(article.title).toBe('Title of content-1');
    expect(article.navigation).toBeUndefined();
    expect(tocFetches()).toBe(1);
    expect(warnings(logger)).toHaveLength(1);
    expect(warnings(logger)[0]).toContain(`TOC index unavailable for map ${MAP_ID}, this article will have no navigation: `);
  });
});
