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

import { httpGetText } from '../http-client.js';
import { parseArticle } from './content-parser.js';
import { buildArticleView } from './article-view.js';
import { extractSections } from './tokenizer.js';
import { cacheKey } from './cache-key.js';
import { TOKEN_CONFIG } from '../constants.js';
import type { StaticDocSource } from '../constants/sources.js';
import type { ServerContext } from '../types/context.js';
import type { FetchArticleOptions, FetchArticleResult } from '../types.js';
import type { ParsedArticleContent } from './content-parser.js';

/** What gets cached: the parse, not the rendered view. */
interface CachedStaticArticle {
  title: string;
  parsed: ParsedArticleContent;
  displayUrl: string;
}

/**
 * Canonicalise a URL for a static site.
 *
 * concepts.jamf.com's sitemap emits paths without a trailing slash while the
 * site itself redirects to the slashed form — all 990 entries, so fetching
 * them as listed is 990 redirects. Adding the slash up front is one line here
 * and saves a round trip per article. Paths that look like a file (`.html`,
 * `.json`) are left alone, as is anything with a query or fragment.
 */
export function canonicalStaticUrl(urlStr: string): string {
  try {
    const url = new URL(urlStr);
    const last = url.pathname.split('/').pop() ?? '';
    if (!url.pathname.endsWith('/') && !last.includes('.')) {
      url.pathname = `${url.pathname}/`;
    }
    return url.toString();
  } catch {
    return urlStr;
  }
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

/** The handful of entities that survive into a title attribute. */
function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(?:39|x27);/g, "'");
}

/**
 * Fetch and parse one article from a static documentation source.
 *
 * @param source the registry row for the hostname in `url`
 */
export async function fetchStaticArticle(
  ctx: ServerContext,
  source: StaticDocSource,
  url: string,
  options: FetchArticleOptions = {},
): Promise<FetchArticleResult> {
  const maxTokens = options.maxTokens ?? TOKEN_CONFIG.DEFAULT_MAX_TOKENS;
  const displayUrl = canonicalStaticUrl(url);
  const key = cacheKey('static-article', { source: source.id, url: displayUrl });

  let cached = await ctx.cache.get<CachedStaticArticle>(key);

  if (cached === null) {
    const html = await httpGetText(displayUrl);
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
    // `parseArticle` reads the first surviving <h1>. On a static site the
    // page heading often lives in a hero section outside the content wrapper,
    // and stripping the chrome takes it with it — concepts.jamf.com's tool
    // pages put their only <h1> there, so every one of the 37 came back
    // "Untitled". The document's own title is the reliable answer when the
    // body has none of its own; Fluid Topics never needs this because its
    // titles arrive as metadata.
    const title = parsed.title !== 'Untitled' ? parsed.title : documentTitle ?? parsed.title;
    cached = { title, parsed, displayUrl };
    await ctx.cache.set(key, cached, ctx.config.cacheTtl.article);
  }

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
