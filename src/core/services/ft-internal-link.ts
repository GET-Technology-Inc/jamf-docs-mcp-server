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
 * parser a synchronous lookup. The fetch happens only when the topic HTML
 * actually contains internal links, and the index is shared by every article
 * in the map, so the amortised cost is one TOC fetch per map per cache TTL.
 *
 * When the TOC cannot be loaded the lookup returns `undefined` and the parser
 * leaves the span as plain text. That is deliberate: a tocId cannot be turned
 * into a URL by string manipulation, so the alternatives to "no link" are all
 * fabricated ones.
 */

import { fetchMapToc } from './ft-client.js';
import { buildDisplayUrl } from './topic-resolver.js';
import type { CacheProvider } from './interfaces/cache.js';
import type { Logger } from './interfaces/logger.js';
import { cacheKey } from './cache-key.js';
import type { FtTocNode } from '../types.js';

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
 */
/**
 * Cached under the `ft-tocindex-v2` namespace. The `v2` is load-bearing:
 * entries written under the v1 shape hold only `urlByTocId`, so they would
 * answer an ancestry lookup with nothing and make a topic look parentless.
 */
interface MapTocIndex {
  /** `tocId -> absolute display URL`, for placing internal links. */
  urlByTocId: Record<string, string>;
  /** `contentId -> ancestor titles`, nearest root first, excluding the topic. */
  ancestorsByContentId: Record<string, string[]>;
}

function indexTocNodes(
  nodes: readonly FtTocNode[],
  into: MapTocIndex,
  ancestors: readonly string[],
): void {
  for (const node of nodes) {
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
    indexTocNodes(node.children ?? [], into, childAncestors);
  }
}

async function loadMapTocIndex(
  cache: CacheProvider,
  mapId: string,
  ttl: number | undefined,
): Promise<MapTocIndex> {
  const key = cacheKey('ft-tocindex-v2', { mapId });
  const cached = await cache.get<MapTocIndex>(key);
  if (cached !== null) {
    return cached;
  }

  const index: MapTocIndex = { urlByTocId: {}, ancestorsByContentId: {} };
  indexTocNodes(await fetchMapToc(mapId), index, []);
  await cache.set(key, index, ttl);
  return index;
}

// ─── Resolver construction ─────────────────────────────────────

export interface InternalLinkResolverOptions {
  cache: CacheProvider;
  /** Maps to index, normally from {@link collectInternalLinkMapIds}. */
  mapIds: readonly string[];
  /** TTL for the cached index; `undefined` uses the cache default. */
  ttl?: number | undefined;
  logger?: Logger | undefined;
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
  const { cache, mapIds, ttl, logger } = options;

  if (mapIds.length === 0) {
    return NO_INTERNAL_LINKS;
  }

  const indexes = new Map<string, MapTocIndex>();
  await Promise.all(
    mapIds.map(async (mapId): Promise<void> => {
      try {
        indexes.set(mapId, await loadMapTocIndex(cache, mapId, ttl));
      } catch (error) {
        // A TOC that will not load costs its links, not the article. The map
        // stays unindexed, every link into it stays plain text, and the rest
        // of the topic is served exactly as before.
        const reason = error instanceof Error ? error.message : String(error);
        logger?.warning(
          `ft-internal-link: TOC index unavailable for map ${mapId},` +
          ` its internal links will render without a destination: ${reason}`,
        );
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
 * place the hierarchy exists, and it is already fetched and cached for
 * internal-link resolution, so this is a second lookup over the same index
 * rather than a second fetch.
 *
 * Failure is an empty chain, never a partial or invented one: a breadcrumb
 * missing its middle would read as a real path to somewhere that does not
 * exist.
 */
export interface TopicAncestryOptions {
  cache: CacheProvider;
  /** The topic's own map — ancestry is only defined within it. */
  mapId: string;
  contentId: string;
  /** TTL for the cached index; `undefined` uses the cache default. */
  ttl?: number | undefined;
  logger?: Logger | undefined;
}

export async function fetchTopicAncestors(
  options: TopicAncestryOptions,
): Promise<string[]> {
  const { cache, mapId, contentId, ttl, logger } = options;
  try {
    const index = await loadMapTocIndex(cache, mapId, ttl);
    return index.ancestorsByContentId[contentId] ?? [];
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger?.warning(
      `ft-internal-link: TOC index unavailable for map ${mapId},` +
      ` this article will have no breadcrumb: ${reason}`,
    );
    return [];
  }
}
