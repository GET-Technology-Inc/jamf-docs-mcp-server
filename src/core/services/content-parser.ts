/**
 * Content Parser — HTML → Markdown article structure
 *
 * Handles:
 * - HTML cleaning (remove scripts, fix relative URLs)
 * - HTML → Markdown conversion (Turndown)
 * - Article structure extraction (title, breadcrumb, related articles)
 * - Search snippet cleaning
 */

import * as cheerio from 'cheerio';
import TurndownService from 'turndown';
import { DOCS_BASE_URL, SELECTORS } from '../constants.js';
import type { SelectorSet } from '../constants/limits.js';
import { INTERNAL_LINK_SELECTOR, type InternalLinkResolver } from './ft-internal-link.js';

// ─── Turndown instance ──────────────────────────────────────────

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  emDelimiter: '*',
  strongDelimiter: '**',
});

turndown.addRule('codeBlocks', {
  filter: 'pre',
  replacement: (content, node) => {
    const nodeElement = node as unknown as {
      querySelector?: (s: string) => { className?: string } | null;
    };
    const codeElement = nodeElement.querySelector?.('code');
    const language = codeElement?.className?.replace('language-', '') ?? '';
    return `\n\`\`\`${language}\n${content.trim()}\n\`\`\`\n`;
  },
});

turndown.addRule('stripScripts', {
  filter: ['script', 'style', 'noscript'],
  replacement: (): string => '',
});

// ─── HTML cleaning ──────────────────────────────────────────────

/** Per-source overrides for {@link cleanHtml}; every field defaults to learn.jamf.com's. */
export interface CleanHtmlOptions {
  /** Selector set for this source. Defaults to {@link SELECTORS}. */
  selectors?: SelectorSet;
  /** Origin that root-relative hrefs and srcs resolve against. Defaults to {@link DOCS_BASE_URL}. */
  linkBase?: string;
}

/**
 * Clean HTML content: remove unwanted elements, fix relative URLs.
 *
 * Both the selector set and the link base are parameters with learn.jamf.com
 * defaults rather than module constants, so a caller reading a different site
 * gets that site's markup rules. Existing single-argument callers — the
 * glossary path among them — are unaffected.
 */
export function cleanHtml($: cheerio.CheerioAPI, options?: CleanHtmlOptions): void {
  const selectors = options?.selectors ?? SELECTORS;
  // Root-relative links resolve against the site they came from. Hard-coding
  // learn.jamf.com here is what would point every internal link and image of
  // a second source at the wrong host — silently, since both produce a valid
  // absolute URL.
  const linkBase = options?.linkBase ?? DOCS_BASE_URL;

  $(selectors.REMOVE).remove();

  $('a[href^="/"]').each((_, el) => {
    const href = $(el).attr('href');
    if (href !== undefined && href !== '') {
      $(el).attr('href', `${linkBase}${href}`);
    }
  });

  $('img[src^="/"]').each((_, el) => {
    const src = $(el).attr('src');
    if (src !== undefined && src !== '') {
      $(el).attr('src', `${linkBase}${src}`);
    }
  });
}

/**
 * Turn Fluid Topics' `<span class="ft-internal-link" data-mapid data-tocid>`
 * into a real `<a href>`.
 *
 * Doing this during cleaning rather than at each read site is what makes one
 * change fix both halves of the symptom: the anchor is what Turndown renders
 * as a Markdown link, *and* what `SELECTORS.RELATED` — which is anchor-based,
 * as every other related-link source on the site is — can finally see.
 *
 * Spans the resolver cannot place are left untouched, so they degrade to the
 * plain text they already were. `data-tocid` cannot be turned into a URL
 * without the map's TOC, so the only way to emit an href here regardless would
 * be to invent one.
 */
export function linkInternalSpans(
  $: cheerio.CheerioAPI,
  resolve: InternalLinkResolver,
): void {
  $(INTERNAL_LINK_SELECTOR).each((_, el) => {
    const span = $(el);
    const mapId = span.attr('data-mapid') ?? '';
    const tocId = span.attr('data-tocid') ?? '';
    if (mapId === '' || tocId === '') {
      return;
    }

    const href = resolve(mapId, tocId);
    if (href === undefined) {
      return;
    }

    span.replaceWith($('<a></a>').attr('href', href).html(span.html() ?? ''));
  });
}

// ─── Article parsing ────────────────────────────────────────────

export interface ParsedArticleContent {
  title: string;
  content: string;
  breadcrumb: string[];
  relatedArticles: { title: string; url: string }[];
}

export interface ParseArticleOptions {
  includeRelated?: boolean;
  /**
   * Lookup for `ft-internal-link` spans. Without one those links keep the
   * pre-resolution behaviour: text in the content, absent from
   * `relatedArticles`. See {@link linkInternalSpans}.
   */
  resolveInternalLink?: InternalLinkResolver | undefined;
  /**
   * Selector set for the source this HTML came from.
   *
   * Optional, defaulting to learn.jamf.com's, because `parseArticle` is a
   * published deep-import (`./core/*` is in the package export map) and
   * making it required would be a breaking change for embedders.
   */
  selectors?: SelectorSet;
  /** Origin that root-relative hrefs and srcs resolve against. */
  linkBase?: string;
}

/**
 * Parse HTML into article structure (title, markdown content, breadcrumb).
 */
export function parseArticle(
  html: string,
  displayUrl: string,
  options?: ParseArticleOptions
): ParsedArticleContent {
  const $ = cheerio.load(html);
  const selectors = options?.selectors ?? SELECTORS;
  cleanHtml($, {
    selectors,
    ...(options?.linkBase !== undefined ? { linkBase: options.linkBase } : {}),
  });

  // Before anything reads anchors: internal links are spans until this runs.
  const resolveInternalLink = options?.resolveInternalLink;
  if (resolveInternalLink !== undefined) {
    linkInternalSpans($, resolveInternalLink);
  }

  // Extract content — try FT API selectors first (most common path),
  // then fall back to generic page selectors.

  // 1. FT API returns HTML fragments wrapped in <div class="content-locale-...">
  let contentHtml = $('div[class*="content-locale"]').first().html() ?? '';

  // 2. Standard selectors for full HTML pages (article, .article-content, etc.)
  //    Checked before body wrappers because <article> is semantically broader
  //    and should take priority when both exist as siblings.
  if (contentHtml === '') {
    contentHtml = $(selectors.CONTENT).html() ?? '';
  }

  // 3. Common FT body wrappers (taskbody, conbody, refbody, etc.)
  if (contentHtml === '') {
    contentHtml = $('[class*="body"]').first().html() ?? '';
  }

  // 4. Fallback: inner HTML of <body> (cheerio wraps fragments in <html><body>)
  if (contentHtml === '') {
    contentHtml = $('body').html() ?? '';
  }

  // 5. Last resort: use raw HTML as-is
  if (contentHtml === '') {
    contentHtml = html;
  }

  const extractedTitle = $(selectors.TITLE).first().text().trim();
  const title = extractedTitle !== '' ? extractedTitle : 'Untitled';

  // Convert to Markdown and strip Turndown anchor artifacts from headings
  const content = turndown.turndown(contentHtml)
    .replace(/^(#{1,6}\s+)\[([^\]]*)\]\(#[^)]*\)/gm, '$1$2');

  // Extract breadcrumb
  const breadcrumb = $(selectors.BREADCRUMB)
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean);

  // Extract related articles
  const relatedArticles = options?.includeRelated === true
    ? $(selectors.RELATED).map((_, el) => {
        const rawHref = $(el).attr('href') ?? '';
        if (rawHref === '' || rawHref.startsWith('#')) {
          return { title: '', url: '' };
        }
        let resolvedUrl: string;
        try {
          resolvedUrl = new URL(rawHref, displayUrl).toString();
        } catch {
          resolvedUrl = rawHref;
        }
        return {
          title: $(el).text().trim(),
          url: resolvedUrl,
        };
      }).get().filter(r => r.title !== '' && r.url !== '')
    : [];

  return { title, content, breadcrumb, relatedArticles };
}

// ─── Snippet cleaning ───────────────────────────────────────────

const MIN_SNIPPET_LENGTH = 50;
const NAV_PATTERNS = [
  /^Home\s*>/i,
  /^[\w\s]+>\s*[\w\s]+>\s*[\w\s]+/,
];

/**
 * Clean an HTML search snippet: strip tags, clean breadcrumb prefixes.
 */
export function cleanSnippet(
  snippet: string,
  title: string,
  product: string | null
): string {
  // Strip HTML tags — loop until stable to handle nested/malformed fragments
  let cleaned = snippet;
  let prev: string;
  do {
    prev = cleaned;
    cleaned = cleaned.replace(/<[^>]*>?/g, '').trim();
  } while (cleaned !== prev);

  for (const pattern of NAV_PATTERNS) {
    cleaned = cleaned.replace(pattern, '').trim();
  }

  // As an extra safety step, strip any remaining angle brackets to avoid
  // residual fragments like "<script" from being interpreted as HTML.
  cleaned = cleaned.replace(/[<>]/g, '').trim();

  if (cleaned.length < MIN_SNIPPET_LENGTH) {
    const productSuffix =
      product !== null && product !== '' ? ` \u2014 ${product}` : '';
    return `${title}${productSuffix}`;
  }

  return cleaned;
}

/**
 * Convert raw HTML to Markdown using the shared Turndown instance.
 */
export function htmlToMarkdown(html: string): string {
  return turndown.turndown(html);
}
