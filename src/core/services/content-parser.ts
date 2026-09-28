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
import { titleProductSnippet } from './snippet.js';

// Defined in snippet.ts, which loads neither cheerio nor Turndown.
export { titleProductSnippet };

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

/**
 * `<`, and the `&` that starts a character reference, named or numeric.
 * CommonMark reads both in text, and Turndown escapes neither.
 *
 * Turndown escapes each text node on its own, so a reference the page splits
 * across elements (`&amp;<span>lt;</span>`) is not seen, and is decoded.
 */
const MARKUP_IN_TEXT = /<|&(?=[A-Za-z][A-Za-z0-9]*;|#[0-9]+;|#[Xx][0-9A-Fa-f]+;)/g;

const escapeMarkdownSyntax = turndown.escape.bind(turndown);

/**
 * A page's text, escaped as Turndown escapes it, and its `<` and the `&` of
 * each character reference as well.
 *
 * Turndown escapes what would be Markdown syntax (`*`, `_`, `[`, a leading
 * `>` or `#`, …) but not `<` or `&`, and CommonMark passes a `<` that opens
 * something tag-shaped through as HTML and decodes `&lt;`, `&amp;` or
 * `&#60;`. The text is decoded by the time Turndown sees it, so until
 * 2026-09-28 a page that shows `<name>` or the text "&lt;" was written as
 * `<name>` and `&lt;`, which render as a tag, showing nothing, and as "<".
 * Live that day, the options `-target <target volume>` and `-name <name>` of
 * "Updating the Hostname and the Local Hostname Using a Policy" rendered as
 * `-target` and `-name`, and the table of "Entity Equivalents for Disallowed
 * XML Characters" gave `<` as the entity of `<`.
 *
 * Added after Turndown's escapes, which escape every backslash of the text,
 * so no backslash is escaped twice. Code is not text: Turndown hands the text
 * of a `<code>`, inline or in a `<pre>`, over unescaped, and CommonMark reads
 * neither escapes nor references in it. A `<pre>` with no `<code>` in it is
 * not code to Turndown, so its text is escaped like any other, inside the
 * fence the codeBlocks rule writes.
 *
 * GFM's extended autolinks (GitHub, micromark, marked) read a bare URL in
 * text up to a space or a `<`, backslashes and all. So a `\<` or `\&` right
 * after one gives the link its backslash, as Turndown's own `\_` in a bare
 * URL does, and a placeholder after it is read as a tag again. Writing the
 * `<` as `&lt;` instead does not help: the link takes that in too, and shows
 * it as written.
 */
turndown.escape = (text: string): string => escapeMarkdownSyntax(text).replace(MARKUP_IN_TEXT, '\\$&');

/**
 * A cell's Markdown, flattened onto one line and safe inside a pipe row.
 *
 * Cells are converted through Turndown again so inline markup survives — a
 * `<code>` in a settings table is half the reason the row is worth reading —
 * but a cell holding a nested table falls back to its text, escaped as
 * Turndown escapes a text node, because a table cannot be nested inside a
 * Markdown pipe row at all and the recursion would not terminate usefully.
 */
function cellMarkdown(cell: { innerHTML: string; textContent: string | null }): string {
  const nested = /<table[\s>]/i.test(cell.innerHTML);
  const markdown = nested ? turndown.escape(cell.textContent ?? '') : turndown.turndown(cell.innerHTML);
  return markdown
    // A pipe row is one line by definition, so paragraphs and list items in a
    // cell collapse to sentences rather than breaking the table apart.
    .replace(/\s*\n+\s*/g, ' ')
    // The pipe, and nothing else. Every backslash of the cell's text is
    // escaped already, as Turndown escaped it, so a `\|` the page shows is
    // `\\|` here and `\\\|` below: an escaped backslash, then an escaped
    // pipe. Until 2026-09-28 the backslashes were escaped again, which undid
    // Turndown's escapes: `*` and `\d` in the table of "Common Regex
    // Patterns" read `\\*` and `\\\\d`, which render as "\*" and "\\d". A
    // backslash in a code span is the page's own, and is left as it is: GFM
    // reads `\|` as `|` there too. So a span holding `\|` is `\\|` here, which
    // GitHub (cmark-gfm) and markdown-it show as `\|`; micromark and marked
    // read the `\\` as an escaped backslash and end the cell at the pipe.
    // Until that day the span read `\\\|`, which kept the row whole in every
    // renderer and showed `\\|` in each.
    //
    // So each pipe gains one backslash, and nothing else changes. The pattern
    // takes a backslash together with the character after it, so a pipe is
    // met either on its own or right after a backslash, and is escaped either
    // way; any other backslash pair is kept as it is.
    .replace(/\\[\s\S]|\|/g, escapeCellPipe)
    .trim();
}

/**
 * A pipe escaped: `|` as `\|`, and a code span's `\|` as `\\|`. Any other
 * backslash pair, an escape Turndown wrote or a code span's own, is returned
 * as it is.
 *
 * A replace of each pipe on its own writes the same, but CodeQL reads it as
 * escaping that leaves backslashes out (js/incomplete-sanitization), as it
 * read the first version of this rule. Here that is not so: every backslash
 * of a cell's text is Turndown's escape already, and until 2026-09-28 the
 * cell escaped them again, doubling each one.
 */
function escapeCellPipe(token: string): string {
  if (token === '|') { return '\\|'; }
  if (token === '\\|') { return '\\\\|'; }
  return token;
}

/**
 * Tables, as GFM pipe tables.
 *
 * Turndown's core has no table handling: left to itself it visits the cells as
 * ordinary block content and emits their text separated by blank lines, so a
 * two-column settings reference arrives as an alternating run of labels and
 * descriptions with nothing saying which belongs to which. It is not a
 * rendering problem a client can fix — the relationship is gone before the
 * markdown is written — and it reaches the model on the text channel and the
 * MCP App on the structured one identically.
 *
 * Jamf's admin guides are full of these: the repo's own captured article
 * fixture carries two tables and twenty-six rows.
 *
 * Written here rather than pulled from `turndown-plugin-gfm` because the
 * plugin brings strikethrough and task lists that this pipeline has no source
 * for, and because the header-row fallback below is specific to Jamf's markup,
 * which frequently omits `<thead>`.
 */
turndown.addRule('tables', {
  filter: 'table',
  replacement: (_content, node): string => {
    interface Row {
      children: ArrayLike<{ innerHTML: string; textContent: string | null; tagName: string }>;
      closest: (s: string) => unknown;
    }
    const table = node as unknown as { querySelectorAll: (s: string) => ArrayLike<Row> };

    // `querySelectorAll` is a descendant query, so on a table containing
    // another it returns the inner table's rows too — and they were emitted a
    // second time, as extra rows of the outer table. `closest` puts each row
    // back with the table it belongs to.
    const rows = Array.from(table.querySelectorAll('tr')).filter(
      (row) => row.closest('table') === node,
    );
    if (rows.length === 0) {
      return '';
    }

    const cells = rows.map((row) => Array.from(row.children).map(cellMarkdown));
    const width = Math.max(...cells.map((row) => row.length));
    if (width === 0) {
      return '';
    }

    const pad = (row: string[]): string =>
      `| ${[...row, ...Array<string>(width - row.length).fill('')].join(' | ')} |`;

    // A table whose first row is all `<th>` has a header; one that is not still
    // needs a divider, because a pipe table without one is not a table. An
    // empty header row is the honest rendering of "these columns are unlabelled".
    const firstRow = rows[0];
    const hasHeader =
      firstRow !== undefined &&
      Array.from(firstRow.children).length > 0 &&
      Array.from(firstRow.children).every((cell) => cell.tagName.toLowerCase() === 'th');

    const header = hasHeader ? (cells[0] ?? []) : Array<string>(width).fill('');
    const body = hasHeader ? cells.slice(1) : cells;
    const divider = `|${' --- |'.repeat(width)}`;

    return `\n\n${pad(header)}\n${divider}\n${body.map(pad).join('\n')}\n\n`;
  },
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

  // Read the breadcrumb BEFORE cleanHtml, which is the only order that works.
  // A static source's REMOVE list includes `nav` — a documentation shell is
  // mostly navigation, and leaving it in put a sidebar in every article — and
  // the breadcrumb trail is itself a `nav`, so extracting afterwards read an
  // element that had already been deleted. That is why concepts.jamf.com
  // returned `breadcrumb: []` for every page while the selector looked right
  // (#285): two independent causes, and fixing either one alone still yields
  // nothing. Verified on a live guide page — correct selector plus stripped
  // nav gives [], early extraction plus the old selector gives [], and only
  // both together give ["Guides", "AI Governance"].
  //
  // Nothing else moves with it. Only the breadcrumb is read this early, and it
  // reads text rather than hrefs, so it needs neither the link rewriting nor
  // the internal-link resolution that follow. The generic `SELECTORS.REMOVE`
  // does not list `nav` at all, so the Fluid Topics path is unaffected either
  // way — and `article-service` already documents that `parsed.breadcrumb` is
  // empty for every FT article and takes its trail from the map index instead.
  const breadcrumb = $(selectors.BREADCRUMB)
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean);

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
 * Clean an HTML search snippet: strip tags, clean breadcrumb prefixes, and
 * decode its character references, so what is returned is the excerpt's text.
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

  // Strip any raw angle bracket left by cut markup, such as a "<script" whose
  // `>` fell outside the excerpt. Only a raw one: a bracket the page shows as
  // text arrives as `&lt;` or `&gt;`, is decoded below, and is kept, so since
  // 2026-09-28 the snippet can hold "<script>" as text. Where it is written
  // into markdown, sanitizeMarkdownText escapes it, and the MCP App escapes
  // what it shows (esc() in app-ui).
  cleaned = cleaned.replace(/[<>]/g, '').trim();

  // Fluid Topics writes `'`, `"`, `&`, `<` and `>` in an excerpt as `&#x27;`,
  // `&quot;`, `&amp;`, `&lt;` and `&gt;`, and until 2026-09-28 they were
  // returned that way: 756 of the 3,584 results of 77 searches replayed that
  // day read "the organization&#x27;s" or "Devices &gt; Settings". Decoded
  // after the steps above, which work on the markup, so a `<` a page shows as
  // text is kept as text and not stripped as a tag. And decoded once, in one
  // pass: `&amp;lt;` is the text "&lt;" (see decodeEntities in
  // static-article-service.ts). The input holds no `<` by now, so the parser
  // can make no element of it, only the one text node.
  cleaned = cheerio.load(cleaned, null, false).text().trim();

  // Counted as decoded: the length a reader sees.
  if (cleaned.length < MIN_SNIPPET_LENGTH) {
    return titleProductSnippet(title, product);
  }

  return cleaned;
}

/**
 * Convert raw HTML to Markdown using the shared Turndown instance.
 */
export function htmlToMarkdown(html: string): string {
  return turndown.turndown(html);
}
