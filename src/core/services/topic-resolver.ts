/**
 * Topic Resolver — URL/ID → {mapId, contentId} resolution
 *
 * Supports three input formats:
 * 1. Direct IDs: {mapId, contentId} passthrough (from search/TOC results)
 * 2. Legacy bundle URL: /bundle/{bundleId}/page/{page}.html
 * 3. FT prettyUrl: /r/{locale}/{product}/{page}
 */

import { DOCS_BASE_URL, DEFAULT_LOCALE, type LocaleId } from '../constants.js';
import { toValidLocale } from '../constants/locales.js';
import { JamfDocsError, JamfDocsErrorCode } from '../types.js';
import type { MapsRegistry } from './maps-registry.js';
import { fetchMapTopics } from './ft-client.js';
import { createHttpClient, type HttpClient } from '../http-client.js';
import { createDefaultConfig } from '../config.js';
import type { CacheProvider } from './interfaces/index.js';
import { cacheKey, type CacheKey } from './cache-key.js';
import { guardCache } from './cache-guard.js';
import { loadOnce } from './load-once.js';
import { getMetaValue, FT_META } from '../utils/ft-metadata.js';
import { isAllowedHostname } from '../utils/url.js';
import {
  extractVersionFromBundleId,
  stripCurrentSuffix,
  stripVersionSuffix,
} from '../utils/bundle.js';

// ─── Types ──────────────────────────────────────────────────────

export interface ResolvedTopic {
  mapId: string;
  contentId: string;
  locale: LocaleId;
}

export interface TopicResolverInput {
  url?: string;
  mapId?: string;
  contentId?: string;
  /** Optional locale override — takes precedence over locale extracted from URL */
  locale?: string | undefined;
}

/**
 * A learn.jamf.com url that names no topic this resolver can find: the maps
 * list has no map for its publication, or for that publication in its
 * version ("Cannot resolve bundleId", "Cannot resolve product"), or that
 * map's topic index has no key for its page ("Topic not found").
 *
 * A JamfDocsError (`NOT_FOUND`) with the message it always had, in its own
 * class so that `jamf_docs_get_article` can advise on it: until 2026-09-28
 * these failures got no advice, while a 404 of the article's own request got
 * "The article may have been moved or deleted".
 *
 * Neither kind says the page is gone, only that it is not in what this
 * resolver reads. The maps list is a copy kept for the registry's TTL
 * (`CACHE_TTL_PRODUCTS`, 7 days by default, on Node), or what an embedder's
 * MapsProvider gives, and it can be empty: a publication Jamf has published
 * since, or one a MapsProvider leaves out, is not in it. A map's topic index
 * is kept for this resolver's TTL (`CACHE_TTL_ARTICLE`, a day, on Node) and
 * holds only the keys `readOrBuildIndex` makes. A `language` naming another
 * locale looks the page up in that locale's map, where Jamf can publish it
 * at another address. And live on 2026-09-28, with the index keyed by
 * `legacy_topicname` and by title alone, the urls of 26 of the 794 entries
 * in `jamf_docs_get_toc`'s Jamf Pro contents and 91 of the 697 in Technical
 * Articles' answered "Topic not found", `…/Configuring-the-Branding-Settings`
 * among them. Each of those entries has a `contentId`, and by the pair the
 * Branding page read whole that day. So both kinds get the same advice,
 * which names the pair.
 */
export class TopicNotFoundError extends JamfDocsError {
  constructor(message: string) {
    super(message, JamfDocsErrorCode.NOT_FOUND);
  }
}

// ─── URL Parsers ────────────────────────────────────────────────

interface ParsedLegacyUrl {
  type: 'legacy';
  locale: string;
  bundleId: string;
  pageSlug: string;
}

interface ParsedPrettyUrl {
  type: 'pretty';
  locale: string;
  productSlug: string;
  topicSlug: string;
}

type ParsedUrl = ParsedLegacyUrl | ParsedPrettyUrl;

/**
 * Parse a legacy bundle URL:
 * /en-US/bundle/jamf-pro-documentation-current/page/MDM_Profile_Settings.html
 */
function parseLegacyUrl(pathname: string): ParsedLegacyUrl | null {
  const match = /^\/([a-z]{2}-[A-Z]{2})\/bundle\/([^/]+)\/page\/([^/?#]+?)(?:\.html)?$/.exec(pathname);
  if (match === null) {return null;}
  const locale = match[1];
  const bundleId = match[2];
  const pageSlug = match[3];
  if (locale === undefined || locale === '') {return null;}
  if (bundleId === undefined || bundleId === '') {return null;}
  if (pageSlug === undefined || pageSlug === '') {return null;}
  return {
    type: 'legacy',
    locale,
    bundleId,
    pageSlug,
  };
}

/**
 * Parse a FT prettyUrl:
 * /r/en-US/jamf-pro-documentation/MDM_Profile_Settings
 */
function parsePrettyUrl(pathname: string): ParsedPrettyUrl | null {
  const match = /^\/r\/([a-z]{2}-[A-Z]{2})\/([^/]+)\/([^/?#]+)$/.exec(pathname);
  if (match === null) {return null;}
  const locale = match[1];
  const productSlug = match[2];
  const topicSlug = match[3];
  if (locale === undefined || locale === '') {return null;}
  if (productSlug === undefined || productSlug === '') {return null;}
  if (topicSlug === undefined || topicSlug === '') {return null;}
  return {
    type: 'pretty',
    locale,
    productSlug,
    topicSlug,
  };
}

export function parseUrl(url: string): ParsedUrl | null {
  try {
    const parsed = new URL(url);
    return parseLegacyUrl(parsed.pathname) ?? parsePrettyUrl(parsed.pathname);
  } catch {
    // Try as pathname only
    return parseLegacyUrl(url) ?? parsePrettyUrl(url);
  }
}

// ─── Topic Index (slug → contentId) ────────────────────────────

const DEFAULT_TOPICS_CACHE_TTL = 24 * 60 * 60 * 1000;

interface BuildIndexOptions {
  mapId: string;
  cache: CacheProvider;
  key: CacheKey;
  fetchTopicsFn: typeof fetchMapTopics;
  cacheTtl: number;
  http: HttpClient;
}

/**
 * The cached index, or one built from the map's topics, fetched and stored:
 * the load `TopicResolver.getTopicIndex` shares between calls.
 */
async function readOrBuildIndex(
  options: BuildIndexOptions,
): Promise<Map<string, string>> {
  const { mapId, cache, key, fetchTopicsFn, cacheTtl, http } = options;
  const cached = await cache.get<[string, string][]>(key);
  if (cached !== null) {
    return new Map(cached);
  }

  const topics = await fetchTopicsFn(http, mapId);
  const index = new Map<string, string>();

  for (const topic of topics) {
    // Index by legacy_topicname metadata
    const legacyName = getMetaValue(topic.metadata, FT_META.LEGACY_TOPICNAME);
    if (legacyName !== '') {
      index.set(legacyName, topic.id);
    }

    // Also index by title (normalized). A topic Fluid Topics sent without one
    // simply has no title key — it is still reachable by `legacy_topicname`
    // above. Reading through blindly would throw and lose the entire index for
    // that map, taking every other topic in it down with the one bad entry.
    if (topic.title !== undefined) {
      const titleKey = topic.title.replace(/\s+/g, '_');
      if (!index.has(titleKey)) {
        index.set(titleKey, topic.id);
      }
    }
  }

  await cache.set(key, [...index.entries()], cacheTtl);
  return index;
}

// ─── Resolver ───────────────────────────────────────────────────

export class TopicResolver {
  private readonly fetchMapTopicsFn: typeof fetchMapTopics;
  private readonly cacheTtl: number;
  private readonly cache: CacheProvider;

  private readonly http: HttpClient;

  constructor(
    private readonly registry: MapsRegistry,
    cache: CacheProvider,
    fetchMapTopicsFn?: typeof fetchMapTopics,
    cacheTtl?: number,
    http?: HttpClient,
  ) {
    // As the registry does: built before any server, so guarded here too.
    this.cache = guardCache(cache);
    this.http = http ?? createHttpClient(createDefaultConfig().request);
    this.fetchMapTopicsFn = fetchMapTopicsFn ?? fetchMapTopics;
    this.cacheTtl = cacheTtl ?? DEFAULT_TOPICS_CACHE_TTL;
  }

  /**
   * A map's topic index, which a page URL is resolved with: one request for
   * the map's topics however many calls want them at once (load-once.ts), as
   * `batch_get_articles` does for up to five URLs in one map.
   *
   * Until 2026-09-28 this read the cache first and looked for a load in
   * flight second, in a map this resolver kept for itself (#78), and the load
   * did not read the cache again. With a cache that answers late, a call
   * could read the index before the first call stored it, look for that
   * call's load after it had cleared, and request the topics again: measured
   * offline, with the index's reads answering 50 ms late and the topics
   * taking 100 ms, twenty `jamf_docs_get_article` calls 10 ms apart requested
   * them twice (test/unit/tools/cache-answering-late.test.ts). Live, Jamf Pro
   * Documentation's topics weighed 2.16 MB and took 2.2 s (2026-09-28).
   */
  private async getTopicIndex(mapId: string): Promise<Map<string, string>> {
    const key = cacheKey('ft-topic-index', { mapId });
    return await loadOnce(this.cache, key, async () => await readOrBuildIndex({
      mapId,
      cache: this.cache,
      key,
      fetchTopicsFn: this.fetchMapTopicsFn,
      cacheTtl: this.cacheTtl,
      http: this.http,
    }));
  }

  /**
   * Resolve input to {mapId, contentId, locale}.
   *
   * Accepts:
   * - Direct IDs: {mapId, contentId} — passthrough, zero cost
   * - URL string: legacy bundle URL or FT prettyUrl
   * - Combined: {url, mapId?, contentId?} — IDs preferred if present
   */
  async resolve(input: TopicResolverInput): Promise<ResolvedTopic> {
    // Direct IDs — zero cost passthrough
    if (
      input.mapId !== undefined && input.mapId !== '' &&
      input.contentId !== undefined && input.contentId !== ''
    ) {
      const locale = input.locale !== undefined && input.locale !== ''
        ? toValidLocale(input.locale)
        : DEFAULT_LOCALE;
      return {
        mapId: input.mapId,
        contentId: input.contentId,
        locale,
      };
    }

    if (input.url === undefined || input.url === '') {
      throw new JamfDocsError(
        'Either url or both mapId and contentId must be provided',
        JamfDocsErrorCode.INVALID_URL
      );
    }

    const parsed = parseUrl(input.url);
    if (parsed === null) {
      throw new JamfDocsError(
        `Unrecognized URL format: ${input.url}`,
        JamfDocsErrorCode.INVALID_URL,
        input.url
      );
    }

    const localeOverride = input.locale !== undefined && input.locale !== ''
      ? toValidLocale(input.locale)
      : undefined;

    if (parsed.type === 'legacy') {
      return await this.resolveLegacy(parsed, localeOverride);
    }

    return await this.resolvePretty(parsed, localeOverride);
  }

  private async resolveLegacy(
    parsed: ParsedLegacyUrl,
    localeOverride?: LocaleId,
  ): Promise<ResolvedTopic> {
    const locale = localeOverride ?? toValidLocale(parsed.locale);

    const mapId = await this.registry.resolveFromBundleId(parsed.bundleId, locale);
    if (mapId === null) {
      throw new TopicNotFoundError(`Cannot resolve bundleId: ${parsed.bundleId}`);
    }

    const index = await this.getTopicIndex(mapId);
    const contentId = index.get(parsed.pageSlug);
    if (contentId === undefined) {
      throw new TopicNotFoundError(`Topic not found: ${parsed.pageSlug} in bundle ${parsed.bundleId}`);
    }

    return { mapId, contentId, locale };
  }

  private async resolvePretty(
    parsed: ParsedPrettyUrl,
    localeOverride?: LocaleId,
  ): Promise<ResolvedTopic> {
    const locale = localeOverride ?? toValidLocale(parsed.locale);

    // The slug in a pretty URL is a bundle id, not a bare stem — `toc-service`
    // builds these from Fluid Topics' own `node.prettyUrl`, so a versioned TOC
    // hands back `/r/en-US/jamf-pro-documentation-11.15.0/<Slug>`. Passing that
    // straight to `resolveMapId` only ever stripped `-current`, and
    // `bundleStem` is version-stripped, so the version stayed glued to the stem
    // and matched nothing: every versioned pretty URL threw, while the legacy
    // `/bundle/{bundleId}/page/{slug}.html` spelling of the same page resolved.
    // Split the version off and forward it, exactly as `resolveFromBundleId`
    // does for the legacy shape.
    //
    // Two things this deliberately does not do:
    //  - rewrite the slug to `-current`. A version with no map of its own is an
    //    error, not an invitation to serve current content under the requested
    //    version's name.
    //  - delegate to `resolveFromBundleId`. Its first branch matches a map by
    //    raw `bundle` metadata, and `{stem}-current` is not exclusive to the
    //    current map: every jamf-pro-release-notes map carries
    //    `jamf-pro-release-notes-current` in its bundle values, so that branch
    //    answers a `-current` slug with whatever map the API listed first
    //    (measured: 11.30.2, while `latestVersion=yes` is 11.30.0).
    //    `resolveMapId` picks by the `latestVersion` flag instead.
    const strippedSlug = stripCurrentSuffix(parsed.productSlug);
    const version = extractVersionFromBundleId(strippedSlug);
    const mapId = await this.registry.resolveMapId(
      version !== null ? stripVersionSuffix(strippedSlug) : strippedSlug,
      version ?? undefined,
      locale,
    );
    if (mapId === null) {
      throw new TopicNotFoundError(`Cannot resolve product: ${parsed.productSlug}`);
    }

    const index = await this.getTopicIndex(mapId);
    const contentId = index.get(parsed.topicSlug);
    if (contentId === undefined) {
      throw new TopicNotFoundError(`Topic not found: ${parsed.topicSlug} in ${parsed.productSlug}`);
    }

    return { mapId, contentId, locale };
  }
}

// ─── Display URL ────────────────────────────────────────────────

/**
 * Build a full display URL from a FT prettyUrl path.
 * Validates that absolute URLs point to known Jamf hostnames.
 */
export function buildDisplayUrl(prettyUrl: string): string {
  if (isAllowedHostname(prettyUrl)) {
    return prettyUrl;
  }
  return `${DOCS_BASE_URL}${prettyUrl.startsWith('/') ? '' : '/'}${prettyUrl}`;
}

/**
 * Build a display URL from a topic's `ft:prettyUrl` metadata value.
 *
 * Fluid Topics writes that value without the reader route —
 * `en-US/jamf-pro-documentation-current/Policies` — while the map TOC's
 * `prettyUrl` for the same topic is `/r/en-US/jamf-pro-documentation-current/Policies`.
 * Shared by search results and articles, so an article fetched by the
 * `mapId` + `contentId` a search result carries is labelled with that
 * result's url.
 */
export function buildDisplayUrlFromPrettyUrlMeta(value: string): string {
  return buildDisplayUrl(value.startsWith('/') ? value : `/r/${value}`);
}
