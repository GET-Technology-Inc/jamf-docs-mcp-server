/**
 * Article retrieval for documentation sources outside Fluid Topics.
 *
 * The Fluid Topics path addresses a topic by `mapId` + `contentId` and gets
 * an HTML fragment back. A static site has neither: the address is the URL,
 * and the response is a whole page whose navigation has to be stripped before
 * anything else. Everything downstream of that — sections, summaries,
 * truncation — is shared with the FT path through
 * {@link buildArticleView}, so the two cannot drift on what a caller sees.
 */

import { parseArticle } from './content-parser.js';
import { buildArticleView, type ArticleViewOptions } from './article-view.js';
import { extractSections } from './tokenizer.js';
import { cacheKey } from './cache-key.js';
import { TOKEN_CONFIG } from '../constants.js';
import { canonicalStaticUrl, type StaticDocSource } from '../constants/sources.js';
import type { ServerContext } from '../types/context.js';
import { JamfDocsError, JamfDocsErrorCode } from '../types.js';
import type { FetchArticleOptions, FetchArticleResult } from '../types.js';
import { parseIntercomArticle } from './intercom-service.js';
import type { ParsedArticleContent } from './content-parser.js';

// Exported from here until #338 moved it next to the registry it reads.
// `./core/*` is a published path, so an embedder's import of it from here
// keeps resolving.
export { canonicalStaticUrl };

/** What gets cached: the parse, not the rendered view. */
interface CachedStaticArticle {
  title: string;
  parsed: ParsedArticleContent;
  displayUrl: string;
  /** Only Intercom publishes one; the static pages carry no date. */
  lastUpdated?: string;
}

/**
 * The page's own title, preferring Open Graph over `<title>`.
 *
 * `<title>` on these sites carries a site-name suffix ("API Utility | Jamf
 * Concepts"); `og:title` is the same string without it, so it is tried first
 * and the suffix trimmed only as a fallback.
 */
export function extractDocumentTitle(html: string): string | undefined {
  const og = /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i.exec(html)
    ?? /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i.exec(html);
  if (og?.[1] !== undefined && og[1].trim() !== '') { return decodeEntities(og[1].trim()); }

  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  if (title?.[1] === undefined) { return undefined; }
  const trimmed = title[1].split('|')[0]?.trim() ?? '';
  return trimmed !== '' ? decodeEntities(trimmed) : undefined;
}

const TITLE_ENTITIES: Readonly<Record<string, string>> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'",
};

/**
 * The handful of entities that survive into a title attribute, decoded in one
 * pass. Chained replaces decoded `&amp;` first and then read its output again,
 * so a page writing the literal text "&lt;" (`&amp;lt;`) got "<" (CodeQL
 * js/double-escaping, alert #13, open since 2026-09-02).
 */
function decodeEntities(text: string): string {
  return text.replace(/&(?:amp|lt|gt|quot|#39|#x27);/g, entity => TITLE_ENTITIES[entity] ?? entity);
}

/**
 * Fetch and parse one article from a static documentation source.
 *
 * @param source the registry row for the hostname in `url`
 * @param options `note` is one line to end the reply with, within `maxTokens`
 */
export async function fetchStaticArticle(
  ctx: ServerContext,
  source: StaticDocSource,
  url: string,
  options: FetchArticleOptions & Pick<ArticleViewOptions, 'note'> = {},
): Promise<FetchArticleResult> {
  const maxTokens = options.maxTokens ?? TOKEN_CONFIG.DEFAULT_MAX_TOKENS;
  // One spelling for the fetch, the cache key and the reported `url`, so
  // either spelling a caller passes is one request to the form the site
  // serves, one cache entry, and one name for the page.
  const displayUrl = canonicalStaticUrl(source, url);
  const key = cacheKey('static-article', { source: source.id, url: displayUrl });

  let cached = await ctx.cache.get<CachedStaticArticle>(key);

  if (cached === null) {
    const html = await ctx.http.getText(displayUrl);

    // An Intercom Help Center's body is a block list in `__NEXT_DATA__`, not
    // markup — no selector set can read it, so the parser is chosen per
    // source rather than per page.
    if (source.parser === 'intercom') {
      const article = parseIntercomArticle(html);
      if (article === null) {
        throw new JamfDocsError(
          `Could not read a ${source.name} article at ${displayUrl}`,
          JamfDocsErrorCode.PARSE_ERROR,
        );
      }
      cached = {
        title: article.title,
        parsed: {
          title: article.title,
          content: article.content,
          breadcrumb: article.breadcrumb,
          relatedArticles: [],
        },
        displayUrl,
        ...(article.lastUpdated !== undefined ? { lastUpdated: article.lastUpdated } : {}),
      };
      await ctx.cache.set(key, cached, ctx.config.cacheTtl.article);
      return renderStaticArticle(cached, source, options, maxTokens);
    }

    const documentTitle = extractDocumentTitle(html);
    const parsed = parseArticle(html, displayUrl, {
      // The source's own markup rules. Parsing a static page with Fluid
      // Topics' selectors finds no content wrapper and falls through to
      // <body>, which is the whole site chrome.
      selectors: source.selectors,
      // Root-relative links belong to this source, not learn.jamf.com.
      linkBase: source.baseUrl,
      ...(options.includeRelated !== undefined ? { includeRelated: options.includeRelated } : {}),
    });
    // `parseArticle` reads the first match for the source's TITLE selector
    // that survives cleaning. On a static site the page heading often lives
    // outside the content wrapper: concepts.jamf.com's tool pages put their
    // only <h1> in the stripped header, so every one of the 37 came back
    // "Untitled", and its TITLE is scoped to the article so that a guide's
    // hero <h1> is never taken as the title (see sources.ts). So most pages
    // there — 800 of 990, measured 2026-09-24 — reach this line with no title
    // of their own. The document's own title is the reliable answer when the
    // body has none; Fluid Topics never needs this because its titles arrive
    // as metadata.
    const title = parsed.title !== 'Untitled' ? parsed.title : documentTitle ?? parsed.title;
    cached = { title, parsed, displayUrl };
    await ctx.cache.set(key, cached, ctx.config.cacheTtl.article);
  }

  return renderStaticArticle(cached, source, options, maxTokens);
}

/** Assemble the response from a parsed page, whichever parser produced it. */
function renderStaticArticle(
  cached: CachedStaticArticle,
  source: StaticDocSource,
  options: FetchArticleOptions & Pick<ArticleViewOptions, 'note'>,
  maxTokens: number,
): FetchArticleResult {
  const { title, parsed } = cached;

  // Provenance is part of the content, not metadata: it has to survive
  // section extraction and truncation, both of which slice `content`, and a
  // reader who asked for one section still needs to know what they are
  // reading.
  const content = source.provenance !== undefined
    ? `${parsed.content}\n\n---\n\n*${source.provenance}*\n`
    : parsed.content;

  const allSections = extractSections(content);

  return buildArticleView(
    {
      title,
      url: cached.displayUrl,
      product: source.name,
      ...(cached.lastUpdated !== undefined ? { lastUpdated: cached.lastUpdated } : {}),
      breadcrumb: parsed.breadcrumb.length > 0 ? parsed.breadcrumb : undefined,
      relatedArticles: options.includeRelated === true && parsed.relatedArticles.length > 0
        ? parsed.relatedArticles
        : undefined,
      sections: allSections,
    },
    content,
    options,
    maxTokens,
    allSections,
  );
}
