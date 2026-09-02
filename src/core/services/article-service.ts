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
import type { FetchArticleResult, FetchArticleOptions, ArticleSection, FtMetadataEntry } from '../types.js';
import { buildDisplayUrl, parseUrl, type TopicResolverInput } from './topic-resolver.js';
import { fetchTopicContent, fetchTopicMetadata } from './ft-client.js';
import { parseArticle, type ParsedArticleContent } from './content-parser.js';
import { staticSourceForUrl } from '../constants/sources.js';
import { buildArticleView } from './article-view.js';
import { fetchStaticArticle } from './static-article-service.js';
import {
  buildInternalLinkResolver,
  collectInternalLinkMapIds,
  fetchTopicAncestors,
} from './ft-internal-link.js';
import type { Logger } from './interfaces/logger.js';
import { cacheKey } from './cache-key.js';
import { getMetaValue, bundleStemToDisplayName, FT_META } from '../utils/ft-metadata.js';
import { extractSections } from './tokenizer.js';

// ─── Shared article fetch ──────────────────────────────────────

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
}

/**
 * Options accepted by {@link fetchArticleFromFt}: the caller-facing article
 * options plus the cache TTL used when storing a freshly fetched article.
 */
export interface FetchArticleFromFtOptions extends FetchArticleOptions {
  /** TTL (seconds) for the cached article entry; undefined uses the cache default. */
  cacheTtl?: number;
  /** Used to report a TOC index that would not load; links degrade either way. */
  logger?: Logger | undefined;
}

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
      fetchTopicMetadata(mapId, contentId),
      fetchTopicContent(mapId, contentId),
    ]);

    const displayUrl = deriveDisplayUrl(topicMeta.readerUrl, articleUrl);
    const lastEdition = getMetaValue(topicMeta.metadata, FT_META.LAST_EDITION);
    const { product, version } = extractProductVersion(topicMeta.metadata);

    // FT's in-documentation links are hrefless spans addressed by TOC node id,
    // so placing them needs the TOC of whichever map(s) they point into. Scoped
    // to the maps this topic actually references: a topic with no internal
    // links collects nothing and the resolver does no I/O. The index is cached
    // per map, so the fetch is shared by every article in it.
    const resolveInternalLink = await buildInternalLinkResolver({
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
    };
    await cache.set(key, cached, options.cacheTtl);
  }

  const { title, parsed, displayUrl, product, version, lastUpdated } = cached;

  // Build base result (shared across all code paths)
  const allSections: ArticleSection[] = extractSections(parsed.content);
  const base = {
    title,
    url: displayUrl,
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
    return await fetchStaticArticle(ctx, staticSource, articleUrl, options);
  }

  // Step 1: Resolve mapId + contentId
  let { mapId, contentId } = input;
  let resolvedLocale: string | undefined;

  if (mapId === undefined || contentId === undefined) {
    const resolved = await topicResolver.resolve({
      url: articleUrl,
      locale: options.locale,
    });
    ({ mapId, contentId } = resolved);
    resolvedLocale = resolved.locale;
  } else if (options.locale !== undefined) {
    resolvedLocale = options.locale;
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
      cacheTtl: ctx.config.cacheTtl.article,
      logger: ctx.logger.createLogger('article-service'),
    }
  );

  if (resolvedLocale !== undefined && articleUrl !== '') {
    const urlLocale = extractLocaleFromUrl(articleUrl);
    if (urlLocale !== null && urlLocale !== resolvedLocale) {
      const note = `\n\n---\n*Note: Language "${resolvedLocale}" was requested`
        + ` but this article was resolved from a "${urlLocale}" URL.`
        + ' Content may be in the original language if a localized version'
        + ' is unavailable.*\n';
      return { ...result, content: result.content + note };
    }
  }

  return result;
}

// ─── Helpers ───────────────────────────────────────────────────

function extractLocaleFromUrl(url: string): string | null {
  return parseUrl(url)?.locale ?? null;
}

function deriveDisplayUrl(
  readerUrl: string | undefined,
  fallbackUrl: string
): string {
  const prettyUrl = readerUrl ?? '';
  return prettyUrl !== '' ? buildDisplayUrl(prettyUrl) : fallbackUrl;
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
