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

/**
 * Clean HTML content: remove unwanted elements, fix relative URLs.
 */
export function cleanHtml($: cheerio.CheerioAPI): void {
  $(SELECTORS.REMOVE).remove();

  $('a[href^="/"]').each((_, el) => {
    const href = $(el).attr('href');
    if (href !== undefined && href !== '') {
      $(el).attr('href', `${DOCS_BASE_URL}${href}`);
    }
  });

  $('img[src^="/"]').each((_, el) => {
    const src = $(el).attr('src');
    if (src !== undefined && src !== '') {
      $(el).attr('src', `${DOCS_BASE_URL}${src}`);
    }
  });
}

// ─── Article parsing ────────────────────────────────────────────

export interface ParsedArticleContent {
  title: string;
  content: string;
  breadcrumb: string[];
  relatedArticles: { title: string; url: string }[];
}

/**
 * Parse HTML into article structure (title, markdown content, breadcrumb).
 */
export function parseArticle(
  html: string,
  displayUrl: string,
  options?: { includeRelated?: boolean }
): ParsedArticleContent {
  const $ = cheerio.load(html);
  cleanHtml($);

  // Extract content — try FT API selectors first (most common path),
  // then fall back to generic page selectors.

  // 1. FT API returns HTML fragments wrapped in <div class="content-locale-...">
  let contentHtml = $('div[class*="content-locale"]').first().html() ?? '';

  // 2. Common FT body wrappers (taskbody, conbody, refbody, etc.)
  if (contentHtml === '') {
    contentHtml = $('[class*="body"]').first().html() ?? '';
  }

  // 3. Standard selectors for full HTML pages (article, .article-content, etc.)
  if (contentHtml === '') {
    contentHtml = $(SELECTORS.CONTENT).html() ?? '';
  }

  // 4. Fallback: inner HTML of <body> (cheerio wraps fragments in <html><body>)
  if (contentHtml === '') {
    contentHtml = $('body').html() ?? '';
  }

  // 5. Last resort: use raw HTML as-is
  if (contentHtml === '') {
    contentHtml = html;
  }

  const extractedTitle = $(SELECTORS.TITLE).first().text().trim();
  const title = extractedTitle !== '' ? extractedTitle : 'Untitled';

  // Convert to Markdown and strip Turndown anchor artifacts from headings
  const content = turndown.turndown(contentHtml)
    .replace(/^(#{1,6}\s+)\[([^\]]*)\]\(#[^)]*\)/gm, '$1$2');

  // Extract breadcrumb
  const breadcrumb = $(SELECTORS.BREADCRUMB)
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean);

  // Extract related articles
  const relatedArticles = options?.includeRelated === true
    ? $(SELECTORS.RELATED).map((_, el) => {
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
