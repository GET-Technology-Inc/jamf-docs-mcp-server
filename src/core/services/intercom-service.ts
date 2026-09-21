/**
 * Reading an Intercom Help Center.
 *
 * support.jamf.com is a Next.js app whose every page embeds its own data as
 * JSON in `<script id="__NEXT_DATA__">`. That is the source of truth: the
 * rendered DOM is a view of it, and parsing the JSON avoids guessing at
 * class names that change with any theme update.
 *
 * The content model is a block list, not HTML, so it is rendered to Markdown
 * here rather than going through `content-parser`.
 */

import * as cheerio from 'cheerio';
import { cacheKey } from './cache-key.js';
import { paginateTocEntries } from './toc-helpers.js';
import type { StaticDocSource } from '../constants/sources.js';
import type { ServerContext } from '../types/context.js';
import type { FetchTocOptions, FetchTocResult, TocEntry } from '../types.js';
import { PAGINATION_CONFIG, TOKEN_CONFIG } from '../constants.js';

// ─── __NEXT_DATA__ ──────────────────────────────────────────────

/**
 * Pull the embedded page data out of an Intercom Help Center page.
 *
 * The opening tag carries a `nonce` attribute, so a regex anchored on
 * `<script id="__NEXT_DATA__" type="application/json">` misses every page.
 * Matching up to the first `>` is what makes it robust to attribute drift.
 */
export function parseNextData(html: string): Record<string, unknown> | null {
  const match = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (match?.[1] === undefined) { return null; }
  try {
    return JSON.parse(match[1]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** `props.pageProps`, or null when the page is not shaped like one. */
function pageProps(html: string): Record<string, unknown> | null {
  const data = parseNextData(html);
  const props = (data?.props as Record<string, unknown> | undefined)?.pageProps;
  return typeof props === 'object' && props !== null
    ? props as Record<string, unknown>
    : null;
}

/**
 * A JSON value read back as a string, or the fallback.
 *
 * `String(value)` on an `unknown` renders an object as "[object Object]" and
 * puts it straight into a title. These payloads come off the wire, so the
 * narrowing has to happen at the boundary rather than being asserted.
 */
function asString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') { return value; }
  if (typeof value === 'number') { return String(value); }
  return fallback;
}

// ─── Blocks → Markdown ──────────────────────────────────────────

interface IntercomBlock {
  type?: string;
  text?: string;
  items?: IntercomBlock[];
  content?: IntercomBlock[];
  /**
   * `collapsibleSection` — its label. Typed as a string here until 2026-09-14
   * and an object on all 42 live sections: a `subheading` or `subheading3`
   * block carrying the label in `text`.
   */
  summary?: string | IntercomBlock;
  url?: string;
  style?: string;
  /** `table` — one entry per row, each holding its own cells. */
  rows?: IntercomTableRow[];
  /**
   * `table` — presentation flags, declared because they are on the payload
   * and not read because Markdown has no equivalent. Every one of the 36 live
   * tables sends `container: false, responsive: false, stacked: true`.
   */
  container?: boolean;
  responsive?: boolean;
  stacked?: boolean;
  /** `code` — a fence hint. Present on 1 of the 149 live code blocks. */
  language?: string;
  /** `video` — the hosting service and its id. No text, no url. */
  provider?: string;
  id?: string;
}

/** One row of a `table` block. */
interface IntercomTableRow {
  cells?: IntercomTableCell[];
}

/**
 * One cell of a `table` row.
 *
 * `content` is a block array, not a string — the same shape a list item uses.
 * `style` carries presentation only (a background colour on header rows) and
 * is deliberately not read here.
 */
interface IntercomTableCell {
  content?: IntercomBlock[];
  style?: Record<string, string>;
}

/**
 * Inline HTML inside a block's `text`, flattened to Markdown-safe text.
 *
 * Anything not converted here is stripped by the closing `.text()`, so a tag
 * this does not know about is content lost without a trace. That is what
 * happened to inline images: 221 of them across 15 live articles, and for 212
 * the image was the entire paragraph, so the whole block rendered to nothing.
 */
function inlineText(html: string): string {
  const $ = cheerio.load(`<div>${html}</div>`);
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') ?? '';
    const label = $(el).text();
    if (href !== '' && label !== '') { $(el).replaceWith(`[${label}](${href})`); }
  });
  $('img[src]').each((_, el) => {
    const src = $(el).attr('src') ?? '';
    if (src !== '') { $(el).replaceWith(`![${$(el).attr('alt') ?? ''}](${src})`); }
  });
  $('code').each((_, el) => { $(el).replaceWith(`\`${$(el).text()}\``); });
  $('strong, b').each((_, el) => { $(el).replaceWith(`**${$(el).text()}**`); });
  $('em, i').each((_, el) => { $(el).replaceWith(`*${$(el).text()}*`); });
  return $('div').text().replace(/\s+/g, ' ').trim();
}

/**
 * The label of a `collapsibleSection`.
 *
 * Every live section carries `summary` as a block, not a string, so handing
 * it to {@link inlineText} interpolated it as "[object Object]" — and it is
 * the section's title, the one line telling a reader what is folded away.
 * 18 articles rendered that. The narrowing belongs here, at the boundary,
 * for exactly the reason {@link asString} gives further down.
 */
function summaryText(summary: string | IntercomBlock | undefined): string {
  if (typeof summary === 'string') { return inlineText(summary); }
  return inlineText(summary?.text ?? '');
}

/**
 * Render a `video` block as a link.
 *
 * `{provider, id}` — no `text` and no `url`, so this fell through to the
 * default arm, which returns '' for a block with no text. The video left no
 * trace at all. Only youtube occurs live (2 blocks); an unknown provider
 * keeps the identifiers rather than inventing a URL scheme for it.
 */
function renderVideo(block: IntercomBlock): string {
  const { provider, id } = block;
  if (id === undefined || id === '') { return ''; }
  return provider === 'youtube'
    ? `[Video](https://www.youtube.com/watch?v=${id})\n\n`
    : `Video (${provider ?? 'unknown source'}): ${id}\n\n`;
}

/**
 * The literal text of a `code` block.
 *
 * Upstream puts HTML in this field, so copying it into a fence verbatim
 * emitted one unusable line — `fdesetup list -extended<br>sysadminctl …` —
 * for exactly the content a reader means to copy. Measured across all 149
 * code blocks in the live corpus on 2026-09-14: 826 `<br>` tags, no other
 * tag, and `&lt;` / `&gt;` / `&amp;` as the only entities.
 *
 * `<br>` becomes a newline BEFORE the entities are decoded. The other order
 * would give a line break to a sample that legitimately contains the text
 * `&lt;br&gt;`, which plist and XML samples do.
 */
function codeText(html: string): string {
  const withBreaks = html.replace(/<\s*br\s*\/?\s*>/gi, '\n');
  return cheerio.load(`<div>${withBreaks}</div>`)('div').text();
}

/**
 * Wrap code in a fence long enough to survive its own content.
 *
 * No live sample carries a backtick run today. One that did would not just
 * break its own block — it would end the fence early and leave the rest of
 * the article inside code formatting, so the cheap guard is worth it.
 */
function fencedCode(text: string, language: string | undefined): string {
  const longest = [...text.matchAll(/`+/g)]
    .reduce((n, match) => Math.max(n, match[0].length), 0);
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}${language ?? ''}\n${text}\n${fence}\n\n`;
}

/**
 * One table cell, flattened to something a Markdown row can hold.
 *
 * A cell holds a block array, and 254 of the 1,118 live cells hold more than
 * one block — 45 contain a list, 17 an image. Markdown has nowhere to put
 * that, so the cell is rendered normally and then collapsed onto one line:
 * every word survives, the bullets do not.
 *
 * Escaping runs last, after the rendering that could introduce a pipe, and
 * backslashes go first: escaping only the pipe turns `a\|b` into `a\\|b`,
 * which renders as a literal backslash followed by a column break — the
 * escape defeated by the very character it is made of.
 */
function cellText(cell: IntercomTableCell | undefined): string {
  return renderBlocks(cell?.content ?? [])
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|');
}

/**
 * Render a `table` block as a Markdown table.
 *
 * This type was dropped entirely until 2026-09-14: it carries no `text`, so
 * it fell through to the default arm and returned the empty string, and a
 * whole table left no trace in the output.
 *
 * Markdown demands a header row and Intercom marks none. Of the 36 live
 * tables, 21 style their first row and 9 more bold it; the remaining 6 give
 * no signal either way. The first row becomes the header regardless — it is
 * the header wherever there is one, and for those 6 it costs presentation
 * rather than data, since the row is still rendered.
 *
 * Rows are uniform in every live table, but a ragged one is padded to the
 * widest rather than producing a table that renderers disagree about.
 */
function renderTable(block: IntercomBlock): string {
  const rows = (block.rows ?? []).filter(row => (row.cells ?? []).length > 0);
  const [header, ...body] = rows;
  if (header === undefined) { return ''; }

  const width = rows.reduce((n, row) => Math.max(n, (row.cells ?? []).length), 0);
  const line = (row: IntercomTableRow): string => {
    const cells = row.cells ?? [];
    return `| ${Array.from({ length: width }, (_, i) => cellText(cells[i])).join(' | ')} |\n`;
  };

  return `${line(header)}|${' --- |'.repeat(width)}\n${body.map(line).join('')}\n`;
}

/**
 * Render a nested list.
 *
 * A list item carries its text as a `content` block array — usually a single
 * `paragraph` — not as `text`. The block's own `text` is a pre-rendered
 * string of the whole list ("1. …\n2. …"), which is why reading `item.text`
 * produces empty bullets rather than an obvious error: every item has the
 * field, and it is undefined on all of them.
 *
 * Nested lists arrive as further list blocks inside that same `content`, so
 * they are rendered by recursing through {@link renderBlocks} with the depth
 * carried in the indent.
 */
function renderList(items: IntercomBlock[], ordered: boolean, depth: number): string {
  const indent = '  '.repeat(depth);
  return items
    .map((item, index) => {
      const bullet = ordered ? `${String(index + 1)}.` : '-';
      const body = item.content !== undefined && item.content.length > 0
        ? renderBlocks(item.content, depth + 1).trim()
        : inlineText(item.text ?? '');
      if (body === '') { return ''; }
      const [first = '', ...rest] = body.split('\n');
      const continuation = rest.map(line => `${indent}  ${line}`).join('\n');
      return `${indent}${bullet} ${first}\n${continuation === '' ? '' : `${continuation}\n`}`;
    })
    .join('');
}

/**
 * Every block type {@link renderBlock} has a case for.
 *
 * Exported so `test/integration/support-kb-contracts.test.ts` can hold the
 * live corpus to it once a week. Reviewing the switch by hand is what failed
 * twice — the docstring on renderBlock claimed a complete list while `table`,
 * `subheading3` and `video` were all live and unhandled — and the two
 * failures looked nothing alike: a table rendered to nothing, while a
 * subheading3 rendered to a perfectly ordinary paragraph. Only an inventory
 * check catches the second kind.
 *
 * Keep this in step with the switches below; a live type in neither is the
 * failure it exists to produce.
 */
export const HANDLED_BLOCK_TYPES: ReadonlySet<string> = new Set([
  'callout',
  'code',
  'collapsibleSection',
  'heading',
  'horizontalRule',
  'image',
  'orderedNestedList',
  'paragraph',
  'subheading',
  'subheading3',
  'table',
  'unorderedNestedList',
  'video',
]);

/**
 * One construct at three depths.
 *
 * Kept as a table rather than three switch arms because that is what the
 * upstream vocabulary is: `subheading3` was added after `subheading`, and was
 * rendered as a plain paragraph for as long as this was a list of cases. A
 * fourth level is now one line.
 */
const HEADING_PREFIX: Record<string, string> = {
  heading: '##',
  subheading: '###',
  subheading3: '####',
};

/**
 * The blocks that map to one Markdown construct each.
 *
 * Split from {@link renderBlock} so the types that need a helper — `callout`
 * and `collapsibleSection`, which recurse, and `table` — stay legible next to
 * each other rather than at the bottom of one long switch. Returns null for
 * anything it does not handle.
 */
function renderSimpleBlock(block: IntercomBlock, depth: number): string | null {
  const prefix = HEADING_PREFIX[block.type ?? ''];
  if (prefix !== undefined) {
    return `${prefix} ${inlineText(block.text ?? '')}\n\n`;
  }

  switch (block.type) {
    case 'paragraph': {
      const text = inlineText(block.text ?? '');
      return text === '' ? '' : `${text}\n\n`;
    }
    case 'orderedNestedList':
      return `${renderList(block.items ?? [], true, depth)}\n`;
    case 'unorderedNestedList':
      return `${renderList(block.items ?? [], false, depth)}\n`;
    case 'code':
      return fencedCode(codeText(block.text ?? ''), block.language);
    case 'horizontalRule':
      return '---\n\n';
    case 'image':
      return block.url !== undefined ? `![](${block.url})\n\n` : '';
    case 'video':
      return renderVideo(block);
    case undefined:
    default:
      return null;
  }
}

/**
 * Render one Intercom block.
 *
 * Thirteen types reach this function, measured over all 817 live articles on
 * 2026-09-14 and counting every path that arrives here: the article's own
 * block list, `callout` and `collapsibleSection` bodies, list item bodies,
 * and table cells. `callout` and `collapsibleSection` nest their body under
 * `content` rather than `text`.
 *
 * That count has been wrong twice, in the same direction both times, because
 * an unhandled type leaves no trace to notice: this comment claimed four,
 * then ten, while `table` (36 blocks), `subheading3` (34) and `video` (2)
 * were being dropped or flattened into body text. Counting by hand is what
 * failed, so it is no longer the mechanism —
 * `test/integration/support-kb-contracts.test.ts` asserts the inventory
 * against the live corpus, and a fourteenth type fails a check instead of
 * quietly costing content.
 */
export function renderBlock(block: IntercomBlock, depth = 0): string {
  const simple = renderSimpleBlock(block, depth);
  if (simple !== null) { return simple; }

  switch (block.type) {
    case 'callout':
      // Rendered as a blockquote: a callout is emphasis, and losing it would
      // turn "do not do this" into an ordinary sentence.
      return `${renderBlocks(block.content ?? [])
        .trimEnd()
        .split('\n')
        .map(line => `> ${line}`)
        .join('\n')}\n\n`;
    case 'collapsibleSection':
      return `**${summaryText(block.summary)}**\n\n${renderBlocks(block.content ?? [])}`;
    case 'table':
      return renderTable(block);
    case undefined:
    default:
      // Unknown type: keep whatever text it has rather than dropping the
      // block. Intercom adds types over time and silence is the worse
      // failure — a reader cannot tell a missing paragraph from one that was
      // never written.
      return block.text !== undefined ? `${inlineText(block.text)}\n\n` : '';
  }
}

export function renderBlocks(blocks: IntercomBlock[], depth = 0): string {
  return blocks.map(block => renderBlock(block, depth)).join('');
}

// ─── Articles ───────────────────────────────────────────────────

export interface IntercomArticle {
  title: string;
  content: string;
  description?: string;
  lastUpdated?: string;
  breadcrumb: string[];
}

/**
 * Parse one Help Center article page.
 *
 * `articleContent.markdown` exists on every article and is `null` on every
 * one measured — the body is in `blocks`. Reading the field that is named
 * for what you want is the trap here.
 */
export function parseIntercomArticle(html: string): IntercomArticle | null {
  const props = pageProps(html);
  const article = props?.articleContent as Record<string, unknown> | undefined;
  if (article === undefined) { return null; }

  const blocks = (article.blocks ?? []) as IntercomBlock[];
  // `breadcrumbs` is a sibling of `articleContent` under pageProps, not a key
  // of it.
  const crumbs = (props?.breadcrumbs ?? []) as { label?: string; name?: string }[];

  return {
    title: asString(article.title, 'Untitled'),
    content: renderBlocks(blocks).trim(),
    ...(typeof article.description === 'string' && article.description !== ''
      ? { description: article.description } : {}),
    ...(typeof article.lastUpdatedDate === 'string'
      ? { lastUpdated: article.lastUpdatedDate.slice(0, 10) } : {}),
    breadcrumb: crumbs
      .map(crumb => crumb.label ?? crumb.name ?? '')
      .filter(label => label !== ''),
  };
}

// ─── Collections ────────────────────────────────────────────────

export interface IntercomCollection {
  id: string;
  slug: string;
  name: string;
  description: string;
  url: string;
  articleCount: number;
}

interface RawCollection {
  id?: unknown;
  slug?: unknown;
  name?: unknown;
  description?: unknown;
  url?: unknown;
  articleCount?: unknown;
  articleSummaries?: { title?: unknown; url?: unknown }[];
  subcollections?: RawCollection[];
}

function slugFromUrl(url: string): string {
  const last = url.replace(/\/$/, '').split('/').pop() ?? '';
  // `/collections/12369024-jamf-pro` → `jamf-pro`. The numeric id is
  // Intercom's and changes if a collection is recreated; the slug is what a
  // reader recognises, so it is what publication ids are built from.
  return last.replace(/^\d+-/, '');
}

/** The Help Center's top-level collections for one locale. */
export async function listIntercomCollections(
  ctx: ServerContext,
  source: StaticDocSource,
  locale: string,
): Promise<IntercomCollection[]> {
  const key = cacheKey('intercom-collections', { source: source.id, locale });
  const cached = await ctx.cache.get<IntercomCollection[]>(key);
  if (cached !== null) { return cached; }

  const html = await ctx.http.getText(`${source.baseUrl}/${locale}/`);
  const props = pageProps(html);
  const home = props?.home as { collections?: RawCollection[] } | undefined;
  const collections = (home?.collections ?? []).map((collection): IntercomCollection => {
    const url = asString(collection.url);
    return {
      id: asString(collection.id),
      slug: typeof collection.slug === 'string' && collection.slug !== ''
        ? collection.slug
        : slugFromUrl(url),
      name: asString(collection.name),
      description: asString(collection.description),
      url,
      articleCount: typeof collection.articleCount === 'number' ? collection.articleCount : 0,
    };
  });

  await ctx.cache.set(key, collections, ctx.config.cacheTtl.products);
  return collections;
}

/**
 * The article tree of one collection.
 *
 * A collection page's `__NEXT_DATA__` carries the whole subtree —
 * subcollections and every article summary — so one request answers what
 * crawling 356 article pages would.
 */
export async function fetchIntercomCollectionToc(
  ctx: ServerContext,
  source: StaticDocSource,
  collection: IntercomCollection,
): Promise<TocEntry[]> {
  const key = cacheKey('intercom-collection-toc', { source: source.id, collection: collection.id });
  const cached = await ctx.cache.get<TocEntry[]>(key);
  if (cached !== null) { return cached; }

  const html = await ctx.http.getText(collection.url);
  const props = pageProps(html);
  const raw = props?.collection as RawCollection | undefined;

  const toEntries = (summaries: { title?: unknown; url?: unknown }[] | undefined): TocEntry[] =>
    (summaries ?? []).map(summary => ({
      title: asString(summary.title, 'Untitled'),
      url: asString(summary.url),
    }));

  const entries: TocEntry[] = [
    // Articles that sit directly in the collection come first: they are the
    // ones with no subcollection to file them under, and dropping them is
    // the easy mistake — Jamf Pro has 11 of them beside 24 subcollections.
    ...toEntries(raw?.articleSummaries),
    ...(raw?.subcollections ?? []).map((sub): TocEntry => {
      const children = toEntries(sub.articleSummaries);
      const entry: TocEntry = {
        title: asString(sub.name, 'Untitled'),
        url: asString(sub.url),
      };
      if (children.length > 0) { entry.children = children; }
      return entry;
    }),
  ];

  await ctx.cache.set(key, entries, ctx.config.cacheTtl.products);
  return entries;
}

/**
 * A `FetchTocResult` for one Intercom collection.
 *
 * Pagination and truncation match the other TOC paths, so a caller cannot
 * tell from the response shape which kind of source answered.
 */
export async function fetchIntercomToc(
  ctx: ServerContext,
  source: StaticDocSource,
  collection: IntercomCollection,
  options: FetchTocOptions = {},
): Promise<FetchTocResult> {
  const page = options.page ?? PAGINATION_CONFIG.DEFAULT_PAGE;
  const maxTokens = options.maxTokens ?? TOKEN_CONFIG.DEFAULT_MAX_TOKENS;

  const allToc = await fetchIntercomCollectionToc(ctx, source, collection);

  return paginateTocEntries(allToc, page, maxTokens);
}
