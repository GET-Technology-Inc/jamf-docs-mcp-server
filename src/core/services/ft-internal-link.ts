/**
 * Fluid Topics internal-link resolution
 *
 * FT does not emit anchors for links that stay inside the documentation. It
 * emits a span with the target encoded in data attributes:
 *
 *   <span class="link ft-internal-link"
 *         data-mapid="FtEgPHSd28ZhPyLlTkrYTA"
 *         data-tocid="8Tflt44ylUo_Jo99tcQj5w">Computer Reports</span>
 *
 * and lets the reader SPA rebuild the href client-side. Anything that consumes
 * the raw topic HTML — this server included — sees text with no destination.
 *
 * `data-tocid` is a TOC **node** id, not a topic `contentId`. It is not
 * interchangeable with one: `/api/khub/maps/{mapId}/topics/{tocId}` and
 * `/api/khub/maps/{mapId}/toc/{tocId}` both 404, and no tocId in a map
 * collides with any contentId in it. The one place the two are tied together
 * is the map's own TOC, where every node carries `tocId`, `contentId` and
 * `prettyUrl` side by side — so resolving a tocId means holding that map's TOC.
 *
 * Hence the shape here: fetch `GET /maps/{mapId}/toc` once per map, reduce it
 * to a `tocId -> display URL` index, cache the index, and hand the article
 * parser a synchronous lookup. The same index also carries the breadcrumb and
 * the navigation, so every article reads its own map's, once, and hands it to
 * all three lookups; another map's TOC is fetched only when the topic links
 * into it. The index is shared by every article in the map, and a burst of
 * articles in a cold map shares one load of it, so the amortised cost is one
 * TOC fetch per map per cache TTL.
 *
 * When the TOC cannot be loaded the lookup returns `undefined` and the parser
 * leaves the span as plain text. That is deliberate: a tocId cannot be turned
 * into a URL by string manipulation, so the alternatives to "no link" are all
 * fabricated ones.
 */

import { fetchMapToc } from './ft-client.js';
import type { HttpClient } from '../http-client.js';
import { buildDisplayUrl } from './topic-resolver.js';
import type { CacheProvider } from './interfaces/cache.js';
import type { Logger } from './interfaces/logger.js';
import { cacheKey } from './cache-key.js';
import type { ArticleNavigation, ArticleNavigationLink, FtTocNode } from '../types.js';

// ─── Markup constants ──────────────────────────────────────────

/** Class FT puts on every link that stays inside the documentation. */
export const INTERNAL_LINK_CLASS = 'ft-internal-link';

/**
 * Spans carrying a resolvable destination. Both attributes are required:
 * without them there is nothing to resolve, and rewriting such a span to an
 * anchor would only produce a dead link.
 */
export const INTERNAL_LINK_SELECTOR =
  `span.${INTERNAL_LINK_CLASS}[data-mapid][data-tocid]`;

/**
 * Synchronous `(mapId, tocId) -> absolute URL` lookup.
 * Returns `undefined` when the pair cannot be resolved.
 */
export type InternalLinkResolver = (mapId: string, tocId: string) => string | undefined;

/** A resolver that knows nothing — every span stays plain text. */
export const NO_INTERNAL_LINKS: InternalLinkResolver = () => undefined;

// ─── Map id collection ─────────────────────────────────────────

const TAG_PATTERN = /<[a-zA-Z][^>]*>/g;
const MAP_ID_PATTERN = /\bdata-mapid\s*=\s*["']([^"']+)["']/;
const TOC_ID_PATTERN = /\bdata-tocid\s*=\s*["']([^"']+)["']/;

/**
 * Which maps a topic's internal links point into.
 *
 * Usually just the topic's own map, but FT does emit cross-map links, so this
 * reads the attribute rather than assuming. Scanning the raw HTML keeps the
 * caller from having to parse the document a second time only to find out
 * whether a TOC fetch is needed at all — the common case is "no links, no
 * fetch", and that answer costs one `String.includes`.
 */
export function collectInternalLinkMapIds(html: string): string[] {
  if (!html.includes(INTERNAL_LINK_CLASS)) {
    return [];
  }

  const mapIds = new Set<string>();
  for (const match of html.matchAll(TAG_PATTERN)) {
    const tag = match[0];
    if (!tag.includes(INTERNAL_LINK_CLASS) || TOC_ID_PATTERN.exec(tag) === null) {
      continue;
    }
    const mapId = MAP_ID_PATTERN.exec(tag)?.[1];
    if (mapId !== undefined) {
      mapIds.add(mapId);
    }
  }
  return [...mapIds];
}

// ─── TOC index ─────────────────────────────────────────────────

/**
 * What one map's TOC is reduced to.
 *
 * Two lookups over a single fetch. The TOC is the only place that ties a tocId
 * to a URL, and also the only place that says where a topic sits in the
 * hierarchy — the topic's own HTML and metadata carry neither. Indexing both
 * in one pass keeps that to one fetch per map rather than two.
 *
 * Cached under the `ft-tocindex-v3` namespace. The version is load-bearing:
 * entries written under an older shape hold only the fields that shape had, so
 * they answer a newer lookup with nothing — a v1 entry makes every topic look
 * parentless, and a v2 entry makes every topic look like a leaf with no
 * siblings. Bump it whenever a field is added.
 */
interface MapTocIndex {
  /** `tocId -> absolute display URL`, for placing internal links. */
  urlByTocId: Record<string, string>;
  /** `contentId -> ancestor titles`, nearest root first, excluding the topic. */
  ancestorsByContentId: Record<string, string[]>;

  /**
   * The tree, flattened into three lookups keyed by `tocId`.
   *
   * Keyed by `tocId` rather than `contentId` because a grouping heading has an
   * empty `contentId` — it is a rung in the hierarchy that nothing addresses as
   * a topic — and keying by contentId would detach every child of one from its
   * siblings.
   *
   * Stored as ids rather than as a per-topic `{parent, siblings, children}`
   * record on purpose: siblings are shared by every member of a sibling set, so
   * materialising them per topic would store the same ~20 links twenty times.
   * For Jamf Pro's 792-node map that is the difference between a small index
   * and a multi-megabyte one, in a cache entry every article fetch reads.
   */
  nodeByTocId: Record<string, { title: string; url: string }>;
  /** `tocId -> its children's tocIds`, in document order. */
  childTocIds: Record<string, string[]>;
  /** `tocId -> its parent's tocId`. Absent for a root node. */
  parentTocId: Record<string, string>;
  /** `contentId -> tocId`, the way in from an article's own identifiers. */
  tocIdByContentId: Record<string, string>;
  /** The tocIds of the roots, so a root topic still has siblings. */
  rootTocIds: string[];
}

function indexTocNodes(
  nodes: readonly FtTocNode[],
  into: MapTocIndex,
  ancestors: readonly string[],
  parent?: string,
): void {
  for (const node of nodes) {
    // Only a node a reader could actually open joins the navigation tree: it
    // needs an id to key on, a contentId to be addressed by, a URL to go to and
    // a title to be labelled with. A node missing any of those is a grouping
    // heading, and putting one in the tree would mean publishing a link to
    // nothing and counting it among a page's neighbours.
    //
    // Note this is a *stricter* test than the ancestry index below applies. A
    // breadcrumb rung is text, so an unopenable one is harmless and Jamf's own
    // grouping titles belong there; a navigation entry is a destination, and an
    // unopenable one is a dead end. Different requirement, different rule.
    //
    // Measured against the live Jamf Pro map: 0 of 792 nodes are missing any of
    // the four, so in practice nothing takes this branch. It is here because
    // `FtTocNode` is a bare cast over `response.json()` with no validation
    // behind it, and because a future map that does group its topics should
    // lose the grouping, not the topics under it.
    const openable =
      node.tocId !== '' && node.contentId !== '' && node.prettyUrl !== '' && (node.title ?? '') !== '';
    if (openable) {
      into.nodeByTocId[node.tocId] = {
        title: node.title ?? '',
        url: buildDisplayUrl(node.prettyUrl),
      };
      if (parent === undefined) {
        into.rootTocIds.push(node.tocId);
      } else {
        into.parentTocId[node.tocId] = parent;
        (into.childTocIds[parent] ??= []).push(node.tocId);
      }
      into.tocIdByContentId[node.contentId] = node.tocId;
    }
    // Both fields are declared required, but `FtTocNode` is a bare cast over
    // `response.json()` with no runtime validation behind it — the same reason
    // `title` and `children` are optional on that type. An empty value here
    // would index a link to nowhere, so it is skipped rather than stored.
    if (node.tocId !== '' && node.prettyUrl !== '') {
      into.urlByTocId[node.tocId] = buildDisplayUrl(node.prettyUrl);
    }
    // A node with an empty contentId is a grouping heading: it still
    // contributes a title to its children's chain, but nothing addresses it as
    // a topic. Checked the same way as `tocId`/`prettyUrl` above, for the same
    // reason — `FtTocNode` is a bare cast over `response.json()`.
    if (node.contentId !== '' && ancestors.length > 0) {
      into.ancestorsByContentId[node.contentId] = [...ancestors];
    }
    // A titleless node would put a blank rung in every descendant's chain, so
    // it is skipped as an ancestor while its children are still walked.
    const title = node.title ?? '';
    const childAncestors = title === '' ? ancestors : [...ancestors, title];
    // Absent `children` means a leaf, the same as an empty list.
    // A node that did not join the tree passes its own parent down, so its
    // children attach one rung higher rather than being orphaned under an id
    // nothing can reach.
    indexTocNodes(node.children ?? [], into, childAncestors, openable ? node.tocId : parent);
  }
}

/**
 * Loads of a map's TOC index still in flight, per cache and then per map.
 *
 * Collapses a burst of loads of one map into one. `batch_get_articles` runs up
 * to five articles at once, and in a cold map every one of them missed the
 * cache and fetched the TOC for itself: the workers start together and fetch
 * their topics in about the same time, so they reach the index within
 * milliseconds of each other, well inside one `/toc` download (#339).
 * `TopicResolver.inflight` and `MapsRegistry.buildPromise` guard the topic
 * index and the map list against the same fan-out.
 *
 * Keyed by the `CacheProvider` rather than module-level, for the reason
 * `TopicResolver.inflight` is an instance member: a guard scoped to one server
 * cannot reach across requests in a runtime where module scope persists
 * (Cloudflare Workers). The glossary's and the static sources' Fuse indexes are
 * scoped the same way. It holds a load only while it runs and nothing after
 * it settles, so it can neither serve a stale index nor pin a failure: the
 * cache stays the only store of the index.
 */
const loadsInFlight = new WeakMap<CacheProvider, Map<string, Promise<MapTocIndex>>>();

async function loadMapTocIndex(
  http: HttpClient,
  cache: CacheProvider,
  mapId: string,
  ttl: number | undefined,
): Promise<MapTocIndex> {
  let inFlight = loadsInFlight.get(cache);
  if (inFlight === undefined) {
    inFlight = new Map();
    loadsInFlight.set(cache, inFlight);
  }
  // A caller that joins gets the load as the first caller started it, with the
  // first caller's client and TTL. Both come from one server's config.
  const pending = inFlight.get(mapId);
  if (pending !== undefined) {
    return await pending;
  }

  const load = readOrBuildMapTocIndex(http, cache, mapId, ttl);
  inFlight.set(mapId, load);
  // Cleaned up in a `finally` around the await, not with `load.finally(...)`:
  // that returns a second promise which rejects along with `load` and which
  // nothing handles, and an unhandled rejection terminates the process. It is
  // the bug test/unit/services/topic-resolver-crash.test.ts pins.
  try {
    return await load;
  } finally {
    inFlight.delete(mapId);
  }
}

/**
 * The cached index, or one built from a fresh fetch and stored.
 *
 * The cache read is inside the guarded load, not ahead of it. A caller that
 * read the cache first and checked the guard second could miss both, reading
 * before the index was written and checking after the load had cleared, and
 * fetch the TOC again.
 */
async function readOrBuildMapTocIndex(
  http: HttpClient,
  cache: CacheProvider,
  mapId: string,
  ttl: number | undefined,
): Promise<MapTocIndex> {
  const key = cacheKey('ft-tocindex-v3', { mapId });
  const cached = await cache.get<MapTocIndex>(key);
  if (cached !== null) {
    return cached;
  }

  const index: MapTocIndex = {
    urlByTocId: {},
    ancestorsByContentId: {},
    nodeByTocId: {},
    childTocIds: {},
    parentTocId: {},
    tocIdByContentId: {},
    rootTocIds: [],
  };
  indexTocNodes(await fetchMapToc(http, mapId), index, []);
  await cache.set(key, index, ttl);
  return index;
}

// ─── Loading once per article ──────────────────────────────────

/**
 * One map's TOC index, loaded and settled: the index, or `undefined` when the
 * TOC would not load, in which case the failure has already been reported.
 *
 * What lets one article load its map's index once and hand it to every lookup
 * that needs it. Each lookup used to load it for itself, and a failure is never
 * cached, so a `/toc` that timed out was attempted, and warned about, once per
 * lookup, one after another: up to three timeouts on one article (#339).
 */
export interface SettledTocIndex {
  readonly mapId: string;
  readonly index: MapTocIndex | undefined;
}

export interface SettledTocIndexOptions {
  http: HttpClient;
  cache: CacheProvider;
  mapId: string;
  /** TTL for the cached index; `undefined` uses the cache default. */
  ttl?: number | undefined;
  logger?: Logger | undefined;
  /**
   * What the caller goes without when the TOC will not load, which finishes
   * the warning: "this article will have no navigation", say.
   */
  consequence: string;
}

/**
 * Load one map's TOC index and settle it. Never rejects: a TOC that will not
 * load is reported once, here, and comes back as `index: undefined`.
 */
export async function loadSettledTocIndex(
  options: SettledTocIndexOptions,
): Promise<SettledTocIndex> {
  const { http, cache, mapId, ttl, logger, consequence } = options;
  try {
    return { mapId, index: await loadMapTocIndex(http, cache, mapId, ttl) };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger?.warning(`ft-internal-link: TOC index unavailable for map ${mapId}, ${consequence}: ${reason}`);
    return { mapId, index: undefined };
  }
}

/**
 * The index for `options.mapId`: the one the caller already settled when it is
 * for that map, and otherwise loaded and settled here.
 */
async function settledIndexFor(
  options: SettledTocIndexOptions,
  loaded: SettledTocIndex | undefined,
): Promise<MapTocIndex | undefined> {
  if (loaded?.mapId === options.mapId) {
    return loaded.index;
  }
  return (await loadSettledTocIndex(options)).index;
}

// ─── Resolver construction ─────────────────────────────────────

export interface InternalLinkResolverOptions {
  http: HttpClient;
  cache: CacheProvider;
  /** Maps to index, normally from {@link collectInternalLinkMapIds}. */
  mapIds: readonly string[];
  /** TTL for the cached index; `undefined` uses the cache default. */
  ttl?: number | undefined;
  logger?: Logger | undefined;
  /**
   * Indexes the caller has already settled with {@link loadSettledTocIndex}.
   * A map among them is not loaded again, and one that failed is not reported
   * again: its links stay plain text.
   */
  loaded?: readonly SettledTocIndex[] | undefined;
}

/**
 * Load the TOC index for each map and return a lookup over all of them.
 *
 * An empty `mapIds` performs no I/O, which is what makes it safe to call this
 * on every article: topics without internal links pay nothing.
 */
export async function buildInternalLinkResolver(
  options: InternalLinkResolverOptions,
): Promise<InternalLinkResolver> {
  const { http, cache, mapIds, ttl, logger, loaded } = options;

  if (mapIds.length === 0) {
    return NO_INTERNAL_LINKS;
  }

  const indexes = new Map<string, MapTocIndex>();
  await Promise.all(
    mapIds.map(async (mapId): Promise<void> => {
      // A TOC that will not load costs its links, not the article. The map
      // stays unindexed, every link into it stays plain text, and the rest
      // of the topic is served exactly as before.
      const index = await settledIndexFor(
        { http, cache, mapId, ttl, logger, consequence: 'its internal links will render without a destination' },
        loaded?.find((settled) => settled.mapId === mapId),
      );
      if (index !== undefined) {
        indexes.set(mapId, index);
      }
    }),
  );

  return (mapId, tocId): string | undefined => indexes.get(mapId)?.urlByTocId[tocId];
}

// ─── Topic ancestry ────────────────────────────────────────────

/**
 * Where a topic sits in its map, nearest root first, excluding the topic
 * itself. Empty when the map's TOC will not load or does not list the topic.
 *
 * This exists because the breadcrumb is not in the topic payload. FT's
 * `/content` fragment is the article body only — a breadcrumb is part of the
 * reader shell — and the topic metadata endpoint has no ancestry field either
 * (it has `dita:topicPath`, which is a source-file path, not the published
 * hierarchy, and does not match what a reader sees). The map's TOC is the one
 * place the hierarchy exists, and an article fetch loads its index once and
 * hands it to this lookup, the navigation and the internal links, so the
 * breadcrumb costs a lookup over that index rather than a load of its own.
 *
 * Failure is an empty chain, never a partial or invented one: a breadcrumb
 * missing its middle would read as a real path to somewhere that does not
 * exist.
 */
export interface TopicAncestryOptions {
  http: HttpClient;
  cache: CacheProvider;
  /** The topic's own map — ancestry is only defined within it. */
  mapId: string;
  contentId: string;
  /** TTL for the cached index; `undefined` uses the cache default. */
  ttl?: number | undefined;
  logger?: Logger | undefined;
  /**
   * The index the caller has already settled with {@link loadSettledTocIndex}.
   * Used when it is for `mapId`: nothing is loaded, and a failure is not
   * reported again.
   */
  loaded?: SettledTocIndex | undefined;
}

/**
 * How many neighbours a navigation list carries.
 *
 * The counts alongside them are the totals, so a capped list still says how
 * much it is not showing. The cap exists because the sibling set of a
 * top-level page is every top-level page — for Jamf Pro that is twenty-odd
 * links, on the structured channel, on every article fetch.
 */
const MAX_NAV_LINKS = 8;

/**
 * Where a topic sits among its neighbours in its map.
 *
 * The complement of {@link fetchTopicAncestors}: that answers "what is above
 * this page", this answers "what is beside and below it". Both read the same
 * index, which an article fetch loads once and hands to each, so an article
 * that already resolved a breadcrumb pays nothing for this.
 *
 * It exists because the Fluid Topics API serves one topic per call while the
 * website concatenates a topic and its children into a single page. Nine of
 * the nine `<h2>` sections on the rendered "Computer Configuration Profiles"
 * page are separate topics in the map — measured, not assumed. A reader who
 * opens that page in a viewer gets the parent's introduction and no route to
 * the nine procedures underneath it unless something publishes the tree, and
 * the tree is only in the TOC.
 *
 * Returns `undefined` rather than an empty shape when the topic is not in the
 * index: absent means "this map does not place it", which is different from
 * "it has no neighbours".
 */
export async function fetchTopicNavigation(
  options: TopicAncestryOptions,
): Promise<ArticleNavigation | undefined> {
  const { contentId, loaded } = options;

  const index = await settledIndexFor(
    { ...options, consequence: 'this article will have no navigation' },
    loaded,
  );
  if (index === undefined) {
    return undefined;
  }

  const tocId = index.tocIdByContentId[contentId];
  if (tocId === undefined) {
    return undefined;
  }
  const self = index.nodeByTocId[tocId];
  if (self === undefined) {
    return undefined;
  }

  // Constructed field by field, not returned by reference.
  //
  // The index is a cache entry, so what comes back is whatever shape was
  // written when it was stored — including fields a later version of this file
  // dropped. `NavigationLinkSchema` is strict, so one stale extra key fails
  // output validation for the whole tool and the article does not render at
  // all. Naming the two fields makes the published shape independent of how
  // the index happens to be stored, which is the property that actually needs
  // to hold; the namespace version protects against a *missing* field, and
  // cannot protect against an extra one.
  const link = (id: string): ArticleNavigationLink | undefined => {
    const node = index.nodeByTocId[id];
    return node === undefined ? undefined : { title: node.title, url: node.url };
  };

  const parentId = index.parentTocId[tocId];
  const parent = parentId !== undefined ? link(parentId) : undefined;

  // A root topic's siblings are the other roots — which is why `rootTocIds` is
  // indexed at all. Without it every top-level page in a product reported no
  // neighbours, which is the opposite of true.
  const siblingIds = (parentId !== undefined ? index.childTocIds[parentId] : index.rootTocIds) ?? [];
  const siblings = siblingIds.filter((id) => id !== tocId).map(link).filter(isLink);
  const children = (index.childTocIds[tocId] ?? []).map(link).filter(isLink);

  return {
    self: { title: self.title, url: self.url },
    ...(parent !== undefined ? { parent } : {}),
    siblings: siblings.slice(0, MAX_NAV_LINKS),
    children: children.slice(0, MAX_NAV_LINKS),
    // The totals, not the array lengths. A truncated list that does not say so
    // is one a reader will treat as exhaustive.
    siblingCount: siblings.length,
    childCount: children.length,
  };
}

/** Narrows away an id that is somehow not in the node table. */
function isLink(value: ArticleNavigationLink | undefined): value is ArticleNavigationLink {
  return value !== undefined;
}

export async function fetchTopicAncestors(
  options: TopicAncestryOptions,
): Promise<string[]> {
  const { contentId, loaded } = options;
  const index = await settledIndexFor(
    { ...options, consequence: 'this article will have no breadcrumb' },
    loaded,
  );
  return index?.ancestorsByContentId[contentId] ?? [];
}
