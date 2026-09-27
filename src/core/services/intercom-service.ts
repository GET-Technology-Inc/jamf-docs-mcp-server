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
import { canonicalStaticUrl, type StaticDocSource } from '../constants/sources.js';
import type { ServerContext } from '../types/context.js';
import { JamfDocsError, JamfDocsErrorCode, type FetchTocOptions, type FetchTocResult, type TocEntry } from '../types.js';
import { DEFAULT_LOCALE, PAGINATION_CONFIG, TOKEN_CONFIG } from '../constants.js';

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

/**
 * One top-level collection, as one locale's home page lists it.
 *
 * `id` is Intercom's, and the same in every locale that publishes the
 * collection. `slug`, `name` and `url` are the locale's own: Jamf Pro is
 * 12369024 in all six of support.jamf.com's locales, and `jamf-pro-相關` in
 * zh-TW.
 */
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

/**
 * How long {@link listIntercomCollections} remembers a listing it could not
 * read, for a caller that asks it to ({@link ListCollectionsOptions}).
 *
 * A minute, as long as #345 keeps an answer the registry outage forced
 * (`FALLBACK_TTL_MS` in metadata.ts), and for the same reason. Not longer,
 * because a page that is back should be read again within the minute
 * `incomplete` tells a client to wait. Not zero, because a burst of calls
 * during an outage would each wait on a page that has just failed, up to the
 * request timeout (15 s by default).
 */
const FAILED_LISTING_TTL_MS = 60 * 1000;

/** How {@link listIntercomCollections} treats a listing it could not read. */
export interface ListCollectionsOptions {
  /**
   * Remember a failure to read the listing for a minute
   * ({@link FAILED_LISTING_TTL_MS}), and while it is remembered, throw it
   * again without a request. A listing in the cache is served first either
   * way, so one that another caller has read since is not reported unread.
   *
   * `jamf_docs_list_products` asks this of the listings it reads only for
   * its rows' `locales`. `jamf_docs_get_toc` does not: a call in one locale
   * needs that locale's page, and asks for it every time (#352).
   */
  rememberFailure?: boolean;
}

/** A listing that could not be read, as it is remembered. */
interface FailedListing {
  message: string;
  code: JamfDocsErrorCode;
}

function isFailedListing(value: unknown): value is FailedListing {
  if (typeof value !== 'object' || value === null) { return false; }
  const { message, code } = value as { message?: unknown; code?: unknown };
  return typeof message === 'string' && Object.values<unknown>(JamfDocsErrorCode).includes(code);
}

/**
 * The Help Center's top-level collections for one locale.
 *
 * Throws, and caches nothing, when the home page carries no collection list:
 * no `__NEXT_DATA__`, as on a maintenance page, or no `home` in it. That is
 * how a 503 has always been treated, and each caller reports both alike. An
 * empty list is an answer, that the locale publishes nothing, which is how
 * support.jamf.com serves `nl` and `th` (2026-09-28), and it is cached like
 * any other. Except in the default locale: `jamf_docs_list_products` builds
 * its rows and their ids from that listing, so an empty one would list no
 * section of the source without saying any is missing. There it throws too.
 *
 * Until 2026-09-28 any page without a collection list was cached as an empty
 * list for `cacheTtl.products`, 7 days by default, and read as a locale that
 * publishes nothing. For the en page, `list_products` listed no
 * `jamf-support-*` publication and did not say any was missing, and
 * `jamf_docs_get_toc` answered that the site publishes nothing in en-US. For
 * another locale's page, `get_toc` served the en-US edition with a note that
 * Jamf does not publish the collection in that locale. An empty default-locale
 * entry an earlier build cached is read as a miss. Another locale's cannot be
 * told from one that publishes nothing, so it is served until it expires.
 */
export async function listIntercomCollections(
  ctx: ServerContext,
  source: StaticDocSource,
  locale: string,
  options: ListCollectionsOptions = {},
): Promise<IntercomCollection[]> {
  const isDefault = locale === source.locales[DEFAULT_LOCALE];
  const key = cacheKey('intercom-collections', { source: source.id, locale });
  const cached = await ctx.cache.get<IntercomCollection[]>(key);
  if (cached !== null && (cached.length > 0 || !isDefault)) { return cached; }

  const home = `${source.baseUrl}/${locale}/`;
  const failureKey = cacheKey('intercom-collections-failure', { source: source.id, locale });
  if (options.rememberFailure === true) {
    const failed = await ctx.cache.get<unknown>(failureKey);
    if (isFailedListing(failed)) {
      throw new JamfDocsError(`${failed.message} (not asked again: it failed less than a minute ago)`, failed.code, home);
    }
  }

  let listed: unknown[];
  try {
    listed = collectionsOn(await ctx.http.getText(home), source, home, isDefault);
  } catch (error) {
    if (options.rememberFailure === true) {
      const failure: FailedListing = {
        message: error instanceof Error ? error.message : String(error),
        code: error instanceof JamfDocsError ? error.code : JamfDocsErrorCode.NETWORK_ERROR,
      };
      await ctx.cache.set(failureKey, failure, FAILED_LISTING_TTL_MS);
    }
    throw error;
  }

  const collections = (listed as RawCollection[]).map((collection): IntercomCollection => {
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
 * The collection list a home page carries, or a `PARSE_ERROR` naming the page
 * when it carries none, or when `required` and it lists none (see
 * {@link listIntercomCollections}).
 */
function collectionsOn(html: string, source: StaticDocSource, home: string, required: boolean): unknown[] {
  const listed = (pageProps(html)?.home as { collections?: unknown } | undefined)?.collections;
  if (Array.isArray(listed) && (listed.length > 0 || !required)) { return listed; }
  throw new JamfDocsError(
    `Could not read the ${source.name} collections at ${home}: the page ${
      Array.isArray(listed) ? 'lists none' : 'carries no collection list'}.`,
    JamfDocsErrorCode.PARSE_ERROR,
    home,
  );
}

/**
 * The article tree of one collection.
 *
 * A collection page's `__NEXT_DATA__` carries the whole subtree —
 * subcollections and every article summary — so one request answers what
 * crawling 356 article pages would.
 *
 * The tree is one locale's: the one `collection` was listed in, which its
 * `url` names. Its `id` is the same in every locale that publishes it.
 *
 * Throws a `PARSE_ERROR` naming the page, and caches nothing, when the page
 * carries no `collection`, as a maintenance page does. Until 2026-09-28 that
 * was cached as an empty tree for `cacheTtl.products`, 7 days by default, so
 * `jamf_docs_get_toc` listed 0 entries without an error for that long. Since
 * #352 serves the en-US edition for a locale without its own, one such page
 * for an en-only collection emptied its TOC in all six locales. An empty
 * tree is not cached, and one an earlier build cached is read as a miss. So
 * a collection with no articles costs a request per call, and none of the 22
 * locale editions support.jamf.com published on 2026-09-28 was empty.
 */
export async function fetchIntercomCollectionToc(
  ctx: ServerContext,
  source: StaticDocSource,
  collection: IntercomCollection,
): Promise<TocEntry[]> {
  const url = canonicalStaticUrl(source, collection.url);
  const key = cacheKey('intercom-collection-toc-v3', { source: source.id, url });
  const cached = await ctx.cache.get<TocEntry[]>(key);
  if (cached !== null && cached.length > 0) { return cached; }

  const html = await ctx.http.getText(url);
  const raw = pageProps(html)?.collection;
  if (typeof raw !== 'object' || raw === null) {
    throw new JamfDocsError(
      `Could not read the ${source.name} collection at ${url}: the page carries no collection.`,
      JamfDocsErrorCode.PARSE_ERROR,
      url,
    );
  }
  const { articleSummaries, subcollections } = raw as RawCollection;

  // Every URL in the tree goes out in the source's spelling, the one
  // `get_article` reports and fetches. Intercom already lists them slashless
  // (0 of 849 article URLs in en, ja and zh-TW end in `/`, 2026-09-26), but
  // it lists a non-ASCII slug raw, so until #338 those pages — 29 ja and
  // zh-TW articles — had one URL here and a percent-encoded one in the
  // article.
  const toEntries = (summaries: { title?: unknown; url?: unknown }[] | undefined): TocEntry[] =>
    (summaries ?? []).map(summary => ({
      title: asString(summary.title, 'Untitled'),
      url: canonicalStaticUrl(source, asString(summary.url)),
    }));

  const entries: TocEntry[] = [
    // Articles that sit directly in the collection come first: they are the
    // ones with no subcollection to file them under, and dropping them is
    // the easy mistake — Jamf Pro has 11 of them beside 24 subcollections.
    ...toEntries(articleSummaries),
    ...(subcollections ?? []).map((sub): TocEntry => {
      const children = toEntries(sub.articleSummaries);
      const entry: TocEntry = {
        title: asString(sub.name, 'Untitled'),
        url: canonicalStaticUrl(source, asString(sub.url)),
      };
      if (children.length > 0) { entry.children = children; }
      return entry;
    }),
  ];

  if (entries.length > 0) { await ctx.cache.set(key, entries, ctx.config.cacheTtl.products); }
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
