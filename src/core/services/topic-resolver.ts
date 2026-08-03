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
import type { CacheProvider } from './interfaces/index.js';
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

async function fetchAndBuildIndex(
  mapId: string,
  cache: CacheProvider,
  cacheKey: string,
  fetchTopicsFn: typeof fetchMapTopics,
  cacheTtl: number,
): Promise<Map<string, string>> {
  const topics = await fetchTopicsFn(mapId);
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

  await cache.set(cacheKey, [...index.entries()], cacheTtl);
  return index;
}

// ─── Resolver ───────────────────────────────────────────────────

export class TopicResolver {
  /**
   * In-flight deduplication for fetchMapTopics calls.
   * Prevents thundering-herd when batch-get-articles fires N concurrent
   * workers that all need the topic index for the same mapId.
   *
   * Instance member (not module-level) so it is scoped to a single
   * server lifetime and doesn't leak across requests in runtimes
   * where module scope persists (e.g. Cloudflare Workers).
   */
  private readonly inflight = new Map<string, Promise<Map<string, string>>>();
  private readonly fetchMapTopicsFn: typeof fetchMapTopics;
  private readonly cacheTtl: number;

  constructor(
    private readonly registry: MapsRegistry,
    private readonly cache: CacheProvider,
    fetchMapTopicsFn?: typeof fetchMapTopics,
    cacheTtl?: number,
  ) {
    this.fetchMapTopicsFn = fetchMapTopicsFn ?? fetchMapTopics;
    this.cacheTtl = cacheTtl ?? DEFAULT_TOPICS_CACHE_TTL;
  }

  private async getTopicIndex(mapId: string): Promise<Map<string, string>> {
    const cacheKey = `topic-index:${mapId}`;
    const cached = await this.cache.get<[string, string][]>(cacheKey);
    if (cached !== null) {
      return new Map(cached);
    }

    // Return existing in-flight promise if one is already pending
    const pending = this.inflight.get(mapId);
    if (pending !== undefined) {
      return await pending;
    }

    const promise = fetchAndBuildIndex(
      mapId, this.cache, cacheKey, this.fetchMapTopicsFn, this.cacheTtl
    );
    this.inflight.set(mapId, promise);

    // Clean up the in-flight entry once the promise settles.
    //
    // This has to be a `try`/`finally` around the await rather than
    // `promise.finally(...)`. That call returns a *second* promise which
    // rejects whenever `promise` does, and nothing ever handles it — so a
    // single failed topic-index fetch became an unhandled rejection, which
    // Node terminates the process on by default. The caller catching its own
    // rejection does not help: the derived promise is a separate object with
    // its own unhandled state.
    //
    // Concurrent callers take the `pending` branch above and never reach here,
    // so the first caller owns the cleanup either way.
    try {
      return await promise;
    } finally {
      this.inflight.delete(mapId);
    }
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
      throw new JamfDocsError(
        `Cannot resolve bundleId: ${parsed.bundleId}`,
        JamfDocsErrorCode.NOT_FOUND
      );
    }

    const index = await this.getTopicIndex(mapId);
    const contentId = index.get(parsed.pageSlug);
    if (contentId === undefined) {
      throw new JamfDocsError(
        `Topic not found: ${parsed.pageSlug} in bundle ${parsed.bundleId}`,
        JamfDocsErrorCode.NOT_FOUND
      );
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
      throw new JamfDocsError(
        `Cannot resolve product: ${parsed.productSlug}`,
        JamfDocsErrorCode.NOT_FOUND
      );
    }

    const index = await this.getTopicIndex(mapId);
    const contentId = index.get(parsed.topicSlug);
    if (contentId === undefined) {
      throw new JamfDocsError(
        `Topic not found: ${parsed.topicSlug} in ${parsed.productSlug}`,
        JamfDocsErrorCode.NOT_FOUND
      );
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
