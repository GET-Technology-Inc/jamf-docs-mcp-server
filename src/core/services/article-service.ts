/**
 * Shared article-fetch service
 *
 * Consolidates the duplicated fetch-parse-tokenize pipeline that was in
 * both get-article.ts and batch-get-articles.ts into a single function.
 *
 * Key optimization: metadata and content are fetched in parallel via
 * Promise.all when the cache misses.
 */

import type { CacheProvider } from './interfaces/cache.js';
import type { ServerContext } from '../types/context.js';
import { TOKEN_CONFIG } from '../constants.js';
import type {
  ArticleSection,
  FetchArticleOptions,
  FetchArticleResult,
  FtMetadataEntry,
  FtTopicInfo,
} from '../types.js';
import {
  buildDisplayUrl,
  buildDisplayUrlFromPrettyUrlMeta,
  parseUrl,
  type TopicResolverInput,
} from './topic-resolver.js';
import { fetchTopicContent, fetchTopicMetadata } from './ft-client.js';
import { parseArticle, type ParsedArticleContent } from './content-parser.js';
import { staticSourceForUrl } from '../constants/sources.js';
import { buildArticleView } from './article-view.js';
import { fetchStaticArticle } from './static-article-service.js';
import {
  buildInternalLinkResolver,
  collectInternalLinkMapIds,
  fetchTopicAncestors,
  fetchTopicNavigation,
} from './ft-internal-link.js';
import type { Logger } from './interfaces/logger.js';
import { cacheKey } from './cache-key.js';
import { getMetaValue, bundleStemToDisplayName, FT_META } from '../utils/ft-metadata.js';
import { extractSections } from './tokenizer.js';
import type { HttpClient } from '../http-client.js';

// ─── Shared article fetch ──────────────────────────────────────

/**
 * Cached article data.
 *
 * Metadata-sourced fields (title, displayUrl, product, version) live at the
 * top level.  HTML-only fields (markdown content, breadcrumb, relatedArticles)
 * stay inside `parsed`.
 */
interface CachedArticle {
  title: string;
  parsed: ParsedArticleContent;
  displayUrl: string;
  product: string | undefined;
  version: string;
  /**
   * Per-topic edition date, cached alongside the parse because it comes from
   * the same metadata fetch. Optional so an entry written before this field
   * existed still reads back — those simply have no date, which is the same
   * thing a topic that publishes none produces.
   */
  lastUpdated?: string | undefined;
  /**
   * The topic's own address, from its metadata: `readerUrl` when present,
   * otherwise `ft:prettyUrl`. Unlike `displayUrl` it never falls back to the
   * caller's url. Optional for the same reason as `lastUpdated`; an entry
   * without it is labelled from the TOC instead.
   */
  ownUrl?: string | undefined;
}

/**
 * Options accepted by {@link fetchArticleFromFt}: the caller-facing article
 * options plus the cache TTL used when storing a freshly fetched article.
 */
export interface FetchArticleFromFtOptions extends FetchArticleOptions {
  /** Bound to ServerConfig.request; carried here because this takes a cache, not a ctx. */
  http: HttpClient;
  /** TTL (seconds) for the cached article entry; undefined uses the cache default. */
  cacheTtl?: number;
  /** Used to report a TOC index that would not load; links degrade either way. */
  logger?: Logger | undefined;
  /**
   * Whether `articleUrl` is the address this topic was resolved from.
   *
   * True when the url alone chose `mapId`/`contentId`, so it names this very
   * topic and is a fair label for it. False when something else chose them —
   * a `mapId` + `contentId` pair, or a `language` that moved the lookup to
   * another locale's map — because then `articleUrl` may name a different
   * page, and the article is labelled with its own reader URL instead.
   * Defaults to `articleUrl !== ''`.
   */
  articleUrlNamesTopic?: boolean;
}

/**
 * Fetch, parse, and tokenize a single article from the FT API.
 *
 * This function handles the full pipeline:
 *   1. Parallel fetch of topic metadata + content (on cache miss)
 *   2. HTML parsing via content-parser
 *   3. Section extraction, summaryOnly, section filter, token truncation
 *
 * Both `get-article` and `batch-get-articles` delegate to this function
 * after resolving mapId/contentId and exhausting provider shortcuts.
 */
export async function fetchArticleFromFt(
  cache: CacheProvider,
  mapId: string,
  contentId: string,
  articleUrl: string,
  options: FetchArticleFromFtOptions
): Promise<FetchArticleResult> {
  const maxTokens = options.maxTokens ?? TOKEN_CONFIG.DEFAULT_MAX_TOKENS;

  const key = cacheKey('ft-article-v3', { mapId, contentId, articleUrl });
  let cached = await cache.get<CachedArticle>(key);

  if (cached === null) {
    const [topicMeta, html] = await Promise.all([
      fetchTopicMetadata(options.http, mapId, contentId),
      fetchTopicContent(options.http, mapId, contentId),
    ]);

    const displayUrl = deriveDisplayUrl(topicMeta.readerUrl, articleUrl);
    const ownUrl = topicOwnUrl(topicMeta);
    const lastEdition = getMetaValue(topicMeta.metadata, FT_META.LAST_EDITION);
    const { product, version } = extractProductVersion(topicMeta.metadata);

    // FT's in-documentation links are hrefless spans addressed by TOC node id,
    // so placing them needs the TOC of whichever map(s) they point into. Scoped
    // to the maps this topic actually references: a topic with no internal
    // links collects nothing and the resolver does no I/O. The index is cached
    // per map, so the fetch is shared by every article in it.
    const resolveInternalLink = await buildInternalLinkResolver({
      http: options.http,
      cache,
      mapIds: collectInternalLinkMapIds(html),
      ttl: options.cacheTtl,
      logger: options.logger,
    });
    const parsed = parseArticle(html, displayUrl, {
      includeRelated: true,
      resolveInternalLink,
    });

    // The `/content` fragment is the article body, and a breadcrumb belongs to
    // the reader shell around it, so `parsed.breadcrumb` is empty for every FT
    // topic — the selector has nothing to match. The hierarchy exists only in
    // the map's TOC, which is already fetched and cached here for internal
    // links, so the fallback is a second lookup rather than a second fetch.
    // Still a fallback and not a replacement: a page served as full HTML does
    // have a breadcrumb in its markup, and that one is what the site itself
    // renders.
    const breadcrumb = parsed.breadcrumb.length > 0
      ? parsed.breadcrumb
      : await fetchTopicAncestors({
          http: options.http,
          cache,
          mapId,
          contentId,
          ttl: options.cacheTtl,
          logger: options.logger,
        });

    // Metadata title is authoritative; parseArticle h1 is only a fallback
    const title = (topicMeta.title !== undefined && topicMeta.title !== '')
      ? topicMeta.title
      : parsed.title;

    cached = {
      title,
      parsed: { ...parsed, breadcrumb },
      displayUrl,
      product,
      version,
      // `getMetaValue` answers a missing key with '', and an empty string
      // would travel as a present-but-blank date. Absent has to stay absent:
      // two of twelve sampled topics publish no edition date at all.
      lastUpdated: lastEdition !== '' ? lastEdition : undefined,
      ownUrl,
    };
    await cache.set(key, cached, options.cacheTtl);
  }

  const { title, parsed, displayUrl, product, version, lastUpdated, ownUrl } = cached;

  // Read off the same cached map index the breadcrumb came from, so this is a
  // second lookup rather than a second fetch — and read outside the article
  // cache entry on purpose: the index has its own TTL, and burying navigation
  // inside `CachedArticle` would freeze one map's tree into every article
  // cached from it until each of those entries expired separately.
  //
  // Why it is worth having: the Fluid Topics API serves one topic per call
  // while the website concatenates a topic and its children into one page, so
  // every `<h2>` a reader sees on learn.jamf.com is a separate topic here.
  // Without this the structured channel says nothing about where a page sits,
  // and a client showing "Computer Configuration Profiles" has no route to the
  // nine procedures that page consists of on the site.
  const navigation = await fetchTopicNavigation({
    http: options.http,
    cache,
    mapId,
    contentId,
    ...(options.cacheTtl !== undefined ? { ttl: options.cacheTtl } : {}),
    logger: options.logger,
  });

  // Build base result (shared across all code paths)
  const allSections: ArticleSection[] = extractSections(parsed.content);
  const base = {
    title,
    url: labelUrl(
      displayUrl,
      ownUrl ?? navigation?.self.url,
      options.articleUrlNamesTopic ?? articleUrl !== '',
    ),
    product,
    version,
    // `ParsedArticle` has declared `lastUpdated` and `formatFullMetadata` has
    // rendered a "**Last Updated**" line for it all along; nothing ever set it,
    // so the line never appeared and the field was always undefined. Sampled
    // across the live corpus, pages range from 2023-06-01 to 2026-05-14 — a
    // caller answering from a two-year-old page had no way to know.
    lastUpdated,
    breadcrumb: parsed.breadcrumb.length > 0 ? parsed.breadcrumb : undefined,
    relatedArticles: options.includeRelated === true && parsed.relatedArticles.length > 0
      ? parsed.relatedArticles : undefined,
    mapId,
    contentId,
    navigation,
    sections: allSections,
  };

  return buildArticleView(base, parsed.content, options, maxTokens, allSections);
}

// ─── Resolve + fetch (shared by get-article & batch-get-articles) ──

/**
 * Full article retrieval pipeline:
 *   1. Resolve mapId + contentId (skip if already provided)
 *   2. Try provider shortcuts (articleProvider)
 *   3. Fall back to FT API via fetchArticleFromFt
 *
 * Both get-article and batch-get-articles delegate here.
 *
 * `url` and a `mapId` + `contentId` pair may arrive together — a search
 * result carries all three — and neither is rejected. Which one decides
 * depends on the host: a static-source url is fetched by url and the pair is
 * ignored (a Fluid Topics pair cannot name a concepts.jamf.com page); on
 * learn.jamf.com the pair is fetched and the url is not resolved at all. Either
 * way the result is labelled with the address of what was fetched, and a note
 * says when an argument went unused.
 */
export async function resolveAndFetchArticle(
  ctx: ServerContext,
  input: TopicResolverInput,
  options: FetchArticleOptions
): Promise<FetchArticleResult> {
  const { topicResolver, cache, articleProvider } = ctx;
  const articleUrl = input.url ?? '';

  // Step 0: Non-Fluid-Topics sources, before anything tries to parse the URL
  // as a Fluid Topics one.
  //
  // `topicResolver.parseUrl` only recognises `/{locale}/bundle/…/page/…` and
  // `/r/{locale}/…`, so a concepts.jamf.com URL threw INVALID_URL at step 1 —
  // before `articleProvider.getArticle`, the documented URL fallback, was
  // ever reached. Dispatching on hostname first is what makes a second source
  // reachable at all; for a Fluid Topics URL this is one Set lookup and the
  // flow below is unchanged.
  const staticSource = staticSourceForUrl(articleUrl);
  if (staticSource !== undefined) {
    const article = await fetchStaticArticle(ctx, staticSource, articleUrl, options);
    // The pair used to vanish here without a word (measured 2026-09-24: the
    // AI Governance guide url with a Jamf Pro pair returned AI Governance, and
    // no mapId or contentId). The article is right; the silence was not.
    const ignored = [
      ...(input.mapId !== undefined ? ['mapId'] : []),
      ...(input.contentId !== undefined ? ['contentId'] : []),
    ];
    return ignored.length > 0
      ? appendNote(article, `${ignored.join(' and ')} ${ignored.length > 1 ? 'were' : 'was'} ignored:`
        + ' they address learn.jamf.com (Fluid Topics) topics, and a'
        + ` ${staticSource.hostname} url is fetched by url alone.`)
      : article;
  }

  // Step 1: Resolve mapId + contentId
  let { mapId, contentId } = input;
  const pairGiven = mapId !== undefined && contentId !== undefined;
  // Whether the url alone chose the topic, and so names it. See
  // `FetchArticleFromFtOptions.articleUrlNamesTopic`.
  let articleUrlNamesTopic = false;

  if (mapId === undefined || contentId === undefined) {
    const resolved = await topicResolver.resolve({
      url: articleUrl,
      locale: options.locale,
    });
    ({ mapId, contentId } = resolved);
    // `language` moves the lookup to another locale's map, and the topic
    // found there is not the page the url names: `language: "ja-JP"` on the
    // en-US Policies.html fetches ポリシー, published at /r/ja-JP/….
    articleUrlNamesTopic = parseUrl(articleUrl)?.locale === resolved.locale;
  }

  // Step 2: Try provider shortcuts (ID-based is primary, URL-based is fallback)
  let article: FetchArticleResult | null = null;

  if (articleProvider !== undefined) {
    article = await articleProvider.getArticleByIds(mapId, contentId, options);
  }

  if (article === null && articleProvider?.getArticle !== undefined && articleUrl !== '') {
    article = await articleProvider.getArticle(articleUrl, options);
  }

  if (article !== null) {
    return { ...article, mapId, contentId };
  }

  // Step 3: Default — fetch from FT API + parse
  const result = await fetchArticleFromFt(
    cache, mapId, contentId, articleUrl,
    {
      ...options,
      http: ctx.http,
      cacheTtl: ctx.config.cacheTtl.article,
      logger: ctx.logger.createLogger('article-service'),
      articleUrlNamesTopic,
    }
  );

  const note = resolutionNote(result, articleUrl, pairGiven, options.locale);
  return note !== undefined ? appendNote(result, note) : result;
}

// ─── Helpers ───────────────────────────────────────────────────

function deriveDisplayUrl(
  readerUrl: string | undefined,
  fallbackUrl: string
): string {
  const prettyUrl = readerUrl ?? '';
  return prettyUrl !== '' ? buildDisplayUrl(prettyUrl) : fallbackUrl;
}

/**
 * The topic's own reader URL, from its metadata, or `undefined`.
 *
 * `readerUrl` is declared on `FtTopicInfo` but the single-topic endpoint does
 * not send it: the payload is `title, id, contentApiEndpoint, metadata`. The
 * address is in that metadata as `ft:prettyUrl`, without the `/r/` route.
 * Sampled 2026-09-24, 129 topics across seven maps (Jamf Pro en-US and ja-JP,
 * School, Connect, Protect, Technical Articles, the LAPS paper): every one
 * carried it, and `/r/` + it equalled the map TOC's `prettyUrl` every time.
 */
function topicOwnUrl(topicMeta: FtTopicInfo): string | undefined {
  const readerUrl = topicMeta.readerUrl ?? '';
  if (readerUrl !== '') {
    return buildDisplayUrl(readerUrl);
  }
  const prettyUrl = getMetaValue(topicMeta.metadata, FT_META.PRETTY_URL);
  return prettyUrl !== '' ? buildDisplayUrlFromPrettyUrlMeta(prettyUrl) : undefined;
}

/**
 * The address to label a Fluid Topics article with: the page it is.
 *
 * `displayUrl` is the caller's url in practice (see {@link topicOwnUrl}). That
 * is a fair label while the url is what chose the topic, and was wrong
 * whenever something else did. Measured 2026-09-24: a Policies.html url with
 * the Computer Configuration Profiles pair returned Computer Configuration
 * Profiles under a Policies.html Source link, on every channel and in the MCP
 * App's outbound link; a pair alone returned `url: ""` and the footer
 * `*Source: [](#)*`; and `language: "ja-JP"` on the en-US Policies.html
 * returned the Japanese ポリシー under the en-US link.
 *
 * So when the url did not choose the topic, the label is the topic's own
 * address — from its metadata, else from the map TOC — and the caller's url
 * only when neither is known, which is still right for the 46 of 48 sampled
 * search results whose url resolves to their own pair.
 */
function labelUrl(
  displayUrl: string,
  ownUrl: string | undefined,
  articleUrlNamesTopic: boolean,
): string {
  return articleUrlNamesTopic ? displayUrl : ownUrl ?? displayUrl;
}

/** A trailing note, set off from the article the way the other notes are. */
function appendNote(result: FetchArticleResult, note: string): FetchArticleResult {
  return { ...result, content: `${result.content}\n\n---\n*Note: ${note}*\n` };
}

/**
 * What to tell the caller about how a Fluid Topics article was resolved, or
 * `undefined` when the result speaks for itself.
 *
 * It used to take its locale from the url in every case. With a pair the url
 * plays no part in the fetch, so `language: "ja-JP"`, the Policies.html url and
 * the Computer Configuration Profiles pair produced `Language "ja-JP" was
 * requested but this article was resolved from a "en-US" URL` — about a url
 * that resolved nothing (measured 2026-09-24).
 */
function resolutionNote(
  result: FetchArticleResult,
  articleUrl: string,
  pairGiven: boolean,
  requested: string | undefined,
): string | undefined {
  // The article's own address, when it is known to be that. `result.url` is
  // the caller's url when nothing better was found, and reading the locale off
  // that is the very claim this replaces — so a label equal to the caller's
  // url is only trusted when the TOC vouches for it.
  const ownUrl = result.url !== articleUrl && result.url !== ''
    ? result.url
    : result.navigation?.self.url;

  if (pairGiven) {
    const notes: string[] = [];
    // A search result carries url, mapId and contentId together and a client
    // passes all three, so both is normal and is not rejected. Two of 48
    // sampled results have a url that resolves to a *different* topic (the
    // LAPS technical paper publishes two topics under each of `Using_LAPS`
    // and `Implementing_LAPS`), which is why the pair, not the url, decides.
    // Comparing page slugs keeps those quiet: their url's slug is their own.
    if (articleUrl !== '' && ownUrl !== undefined && pageSlug(articleUrl) !== pageSlug(ownUrl)) {
      notes.push(
        'This article was fetched by its mapId + contentId. The url passed with them'
        + ' does not match its address and was not used: with both, a learn.jamf.com'
        + ' fetch follows the pair.'
      );
    }
    if (requested !== undefined) {
      const mapLocale = ownUrl !== undefined ? parseUrl(ownUrl)?.locale : undefined;
      const prefix = `Language "${requested}" was requested, but \`language\` has no effect`
        + ' on a mapId + contentId pair: this article comes from the pair\'s map,';
      if (mapLocale === undefined) {
        notes.push(`${prefix} which is in one language.`);
      } else if (mapLocale !== requested) {
        notes.push(`${prefix} which is "${mapLocale}".`);
      }
    }
    return notes.length > 0 ? notes.join(' ') : undefined;
  }

  // `?? null` is load-bearing, and the reason this is not the identically
  // named export from utils/url.ts: that one falls back to DEFAULT_LOCALE,
  // which would make the guard below always true and attach a
  // language-mismatch note to every en-US article.
  const urlLocale = parseUrl(articleUrl)?.locale ?? null;
  if (requested !== undefined && urlLocale !== null && urlLocale !== requested) {
    return `Language "${requested}" was requested but this article was resolved from a "${urlLocale}" URL.`
      + ' Content may be in the original language if a localized version is unavailable.';
  }
  return undefined;
}

/** The page part of a Fluid Topics URL, in either of its two spellings. */
function pageSlug(url: string): string | undefined {
  const parsed = parseUrl(url);
  if (parsed === null) {
    return undefined;
  }
  return parsed.type === 'legacy' ? parsed.pageSlug : parsed.topicSlug;
}

function extractProductVersion(
  metadata: FtMetadataEntry[] | undefined
): { product: string | undefined; version: string } {
  const stem = getMetaValue(metadata, FT_META.VERSION_BUNDLE_STEM);
  // Versioned products (Jamf Pro family) carry version_bundle_stem; non-Pro
  // products are unversioned and only expose `prodname` (e.g. "Jamf School").
  let product: string | undefined;
  if (stem !== '') {
    product = bundleStemToDisplayName(stem);
  } else {
    const prodname = getMetaValue(metadata, FT_META.PRODNAME);
    product = prodname !== '' ? prodname : undefined;
  }
  const version = getMetaValue(metadata, FT_META.VERSION);
  return { product, version: version !== '' ? version : 'current' };
}
