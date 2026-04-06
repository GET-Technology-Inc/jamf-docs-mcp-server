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
import { getMetaValue, bundleStemToDisplayName, FT_META } from '../utils/ft-metadata.js';
import {
  extractSections,
  extractSummary,
  extractSection,
  truncateToTokenLimit,
  createTokenInfo,
} from './tokenizer.js';

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
}

export async function fetchArticleFromFt(
  cache: CacheProvider,
  mapId: string,
  contentId: string,
  articleUrl: string,
  options: FetchArticleOptions,
  cacheTtl?: number
): Promise<FetchArticleResult> {
  const maxTokens = options.maxTokens ?? TOKEN_CONFIG.DEFAULT_MAX_TOKENS;

  const cacheKey = `ft:article:v3:${mapId}:${contentId}`;
  let cached = await cache.get<CachedArticle>(cacheKey);

  if (cached === null) {
    const [topicMeta, html] = await Promise.all([
      fetchTopicMetadata(mapId, contentId),
      fetchTopicContent(mapId, contentId),
    ]);

    const displayUrl = deriveDisplayUrl(topicMeta.readerUrl, articleUrl);
    const { product, version } = extractProductVersion(topicMeta.metadata);
    const parsed = parseArticle(html, displayUrl, { includeRelated: true });

    // Metadata title is authoritative; parseArticle h1 is only a fallback
    const title = (topicMeta.title !== undefined && topicMeta.title !== '')
      ? topicMeta.title
      : parsed.title;

    cached = { title, parsed, displayUrl, product, version };
    await cache.set(cacheKey, cached, cacheTtl);
  }

  const { title, parsed, displayUrl, product, version } = cached;

  // Build base result (shared across all code paths)
  const allSections: ArticleSection[] = extractSections(parsed.content);
  const base = {
    title,
    url: displayUrl,
    product,
    version,
    breadcrumb: parsed.breadcrumb.length > 0 ? parsed.breadcrumb : undefined,
    relatedArticles: options.includeRelated === true && parsed.relatedArticles.length > 0
      ? parsed.relatedArticles : undefined,
    mapId,
    contentId,
    sections: allSections,
  };

  // ── summaryOnly mode ──
  if (options.summaryOnly === true) {
    const summaryResult = extractSummary(parsed.content, title, maxTokens);
    let summaryContent = `## Summary\n\n${summaryResult.summary}\n\n`;
    summaryContent += `## Article Outline (${summaryResult.outline.length} sections)\n\n`;
    for (const section of summaryResult.outline) {
      const indent = '  '.repeat(Math.max(0, section.level - 1));
      summaryContent += `${indent}- ${section.title} (~${section.tokenCount} tokens)\n`;
    }
    summaryContent += `\n*Estimated read time: ${summaryResult.estimatedReadTime} min`
      + ` (${summaryResult.totalTokens.toLocaleString()} tokens)*\n`;

    return { ...base, content: summaryContent, tokenInfo: summaryResult.tokenInfo };
  }

  // ── Section extraction ──
  if (options.section !== undefined && options.section !== '') {
    const sectionResult = extractSection(parsed.content, options.section, maxTokens);
    if (sectionResult.section !== null) {
      return { ...base, content: sectionResult.content, tokenInfo: sectionResult.tokenInfo };
    }
    const sectionsList = allSections.map(s => `- ${s.title}`).join('\n');
    const notFoundMsg =
      `*Section "${options.section}" not found.*\n\n**Available sections:**\n${sectionsList}`;
    return { ...base, content: notFoundMsg, tokenInfo: createTokenInfo(notFoundMsg, maxTokens) };
  }

  // ── Full content with truncation ──
  const truncateResult = truncateToTokenLimit(parsed.content, maxTokens, allSections);
  return { ...base, content: truncateResult.content, tokenInfo: truncateResult.tokenInfo };
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

  // Step 1: Resolve mapId + contentId
  let mapId = input.mapId;
  let contentId = input.contentId;
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
    cache, mapId, contentId, articleUrl, options, ctx.config.cacheTtl.article
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
  metadata: FtMetadataEntry[]
): { product: string | undefined; version: string } {
  const stem = getMetaValue(metadata, FT_META.VERSION_BUNDLE_STEM);
  const product = stem !== '' ? bundleStemToDisplayName(stem) : undefined;
  const version = getMetaValue(metadata, FT_META.VERSION);
  return { product, version: version !== '' ? version : 'current' };
}
