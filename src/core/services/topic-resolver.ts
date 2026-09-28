/**
 * Topic Resolver — URL/ID → {mapId, contentId} resolution
 *
 * Supports three input formats:
 * 1. Direct IDs: {mapId, contentId} passthrough (from search/TOC results)
 * 2. Legacy bundle URL: /bundle/{bundleId}/page/{page}.html
 * 3. FT prettyUrl: /r/{locale}/{product}/{page}
 *
 * A url's page is looked up in its map's topic index (`readOrBuildIndex`).
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
 * The page of a reader address as Jamf spells it: `segment` with its
 * percent-escapes decoded, or as it is when they do not decode.
 *
 * Jamf publishes some pages at an address that is not ASCII, and spells it
 * raw: the Jamf School topic "Jamf School から管理者データを削除する" is at
 * `/r/ja-JP/jamf-school-documentation/Jamf-School-から管理者テータを削除する`,
 * in its `readerUrl` and in the TOC alike, and no `readerUrl` of the six
 * publications measured holds a percent-escape (2026-09-28). `new URL`
 * percent-encodes a pathname, so until 2026-09-28 the url
 * `jamf_docs_get_toc` lists for that page was looked up as
 * `Jamf-School-%E3%81%8B…` and matched nothing. A browser copies it encoded
 * as well. Both spellings now read the same.
 */
function decodePage(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

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
 *
 * The page is the rest of the path, `/` and all. Jamf publishes "And/Or
 * Groupings", which the Jamf Pro TOC lists four times, at
 * `/r/en-US/jamf-pro-documentation-current/And/Or-Groupings` (2026-09-28),
 * and until that day its url was not recognised as a Fluid Topics url at all.
 */
function parsePrettyUrl(pathname: string): ParsedPrettyUrl | null {
  const match = /^\/r\/([a-z]{2}-[A-Z]{2})\/([^/]+)\/([^?#]+)$/.exec(pathname);
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
    topicSlug: decodePage(topicSlug),
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
 * The page of a topic's `readerUrl`, read as a url's page is, so that the two
 * cannot disagree: `Configuring-the-Branding-Settings` for
 * `/r/en-US/jamf-pro-documentation-current/Configuring-the-Branding-Settings`.
 * '' for a topic Fluid Topics sent without one.
 */
function readerPage(readerUrl: unknown): string {
  if (typeof readerUrl !== 'string') {
    return '';
  }
  const parsed = parseUrl(readerUrl);
  return parsed?.type === 'pretty' ? parsed.topicSlug : '';
}

/**
 * The cached index, or one built from the map's topics, fetched and stored:
 * the load `TopicResolver.getTopicIndex` shares between calls.
 *
 * A page is looked up by three keys, each one only where no stronger one
 * names that page:
 *
 *  1. `legacy_topicname`, the page of the topic's legacy url,
 *     `/bundle/{bundle}/page/{legacy_topicname}.html`.
 *  2. The page of the topic's `readerUrl`, its address on the site. A TOC
 *     entry's `prettyUrl` is that address, and a search result's
 *     `ft:prettyUrl` is too, without the `/r/`: the `/topics` list is the TOC
 *     flattened, entry for entry, in the 2,742 TOC entries of Jamf Pro, Jamf
 *     Connect, Jamf School, Jamf Protect and Technical Articles in en-US and
 *     the 428 of Jamf School in ja-JP (2026-09-28).
 *  3. The topic's title with each run of spaces made `_`.
 *
 * Until 2026-09-28 the index held only 1 and 3, and a topic Jamf publishes
 * without a `legacy_topicname`, at an address that is not its title so
 * spelled, could not be opened by its url: `jamf_docs_get_article` answered
 * "Topic not found: Configuring-the-Branding-Settings in
 * jamf-pro-documentation-current" for a url `jamf_docs_get_toc` lists. Live,
 * 49 of the 2,579 urls those five en-US TOCs list could not be opened, and 1
 * of the 427 of Jamf School in ja-JP (test/unit/tools/get-article-toc-urls.test.ts).
 * The address is read as Jamf spells it, not derived: Jamf Connect publishes
 * one "General Requirements" at `General_Requirements` and another at
 * `General-Requirements`, and the Jamf School page in {@link decodePage} is at
 * テータ where its title reads データ.
 *
 * A `legacy_topicname` comes first, so a key one gave names the topic it
 * named before. Jamf publishes some topics at one shared address, and a url
 * cannot say which of them it means (the `mapId` + `contentId` pair can):
 * Jamf Connect's two topics at `Troubleshooting` are one with that
 * `legacy_topicname` and one with none, and the url still opens the first.
 *
 * An address comes before a title, so it can displace a title key, and that
 * is what the urls a TOC lists need. The first of five Technical Articles
 * topics titled 追加情報 in ja-JP is published at `Additional_Information`,
 * and the fifth at `追加情報`; were titles first, the url of that address
 * would open the first, which the TOC does not list there. Measured on the
 * topics served on 2026-09-28: of the 4,278 keys the indexes of seven
 * publications held until then, the six above among them, no title key was
 * displaced; in Jamf Connect and Technical Articles in ja-JP and zh-TW, 9
 * were, 追加情報 among them, none of them ASCII. No url reached those 9
 * before, as a url's page was looked up percent-encoded.
 *
 * Where several topics share one key of a kind, a legacy name names the last
 * of them in the list and a title the first, as before, and an address the
 * last, as a legacy name does.
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
  const byLegacyName = new Map<string, string>();
  const byAddress = new Map<string, string>();
  const byTitle = new Map<string, string>();

  for (const topic of topics) {
    const legacyName = getMetaValue(topic.metadata, FT_META.LEGACY_TOPICNAME);
    if (legacyName !== '') {
      byLegacyName.set(legacyName, topic.id);
    }

    const address = readerPage(topic.readerUrl);
    if (address !== '') {
      byAddress.set(address, topic.id);
    }

    // A topic Fluid Topics sent without a title simply has no title key — it
    // is still reachable by the keys above. Reading through blindly would
    // throw and lose the entire index for that map, taking every other topic
    // in it down with the one bad entry.
    if (topic.title !== undefined) {
      const titleKey = topic.title.replace(/\s+/g, '_');
      if (!byTitle.has(titleKey)) {
        byTitle.set(titleKey, topic.id);
      }
    }
  }

  // Of two entries for one key, the later one's value is kept.
  const index = new Map([...byTitle, ...byAddress, ...byLegacyName]);
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
    const key = cacheKey('ft-topic-index-v2', { mapId });
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
