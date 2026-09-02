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
import { httpGetText } from '../http-client.js';
import { cacheKey } from './cache-key.js';
import type { StaticDocSource } from '../constants/sources.js';
import type { ServerContext } from '../types/context.js';
import type { FetchTocOptions, FetchTocResult, TocEntry } from '../types.js';
import { PAGINATION_CONFIG, TOKEN_CONFIG } from '../constants.js';
import {
  calculatePagination,
  truncateListByTokens,
  buildPaginationNote,
} from './tokenizer.js';

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
  summary?: string;
  url?: string;
  style?: string;
}

/** Inline HTML inside a block's `text`, flattened to Markdown-safe text. */
function inlineText(html: string): string {
  const $ = cheerio.load(`<div>${html}</div>`);
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') ?? '';
    const label = $(el).text();
    if (href !== '' && label !== '') { $(el).replaceWith(`[${label}](${href})`); }
  });
  $('code').each((_, el) => { $(el).replaceWith(`\`${$(el).text()}\``); });
  $('strong, b').each((_, el) => { $(el).replaceWith(`**${$(el).text()}**`); });
  $('em, i').each((_, el) => { $(el).replaceWith(`*${$(el).text()}*`); });
  return $('div').text().replace(/\s+/g, ' ').trim();
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
 * The blocks that map to one Markdown construct each.
 *
 * Split from {@link renderBlock} so the two nesting types — `callout` and
 * `collapsibleSection`, which recurse — stay legible next to each other
 * rather than at the bottom of one long switch. Returns null for anything it
 * does not handle.
 */
function renderSimpleBlock(block: IntercomBlock, depth: number): string | null {
  switch (block.type) {
    case 'heading':
      return `## ${inlineText(block.text ?? '')}\n\n`;
    case 'subheading':
      return `### ${inlineText(block.text ?? '')}\n\n`;
    case 'paragraph': {
      const text = inlineText(block.text ?? '');
      return text === '' ? '' : `${text}\n\n`;
    }
    case 'orderedNestedList':
      return `${renderList(block.items ?? [], true, depth)}\n`;
    case 'unorderedNestedList':
      return `${renderList(block.items ?? [], false, depth)}\n`;
    case 'code':
      return `\`\`\`\n${block.text ?? ''}\n\`\`\`\n\n`;
    case 'horizontalRule':
      return '---\n\n';
    case 'image':
      return block.url !== undefined ? `![](${block.url})\n\n` : '';
    case undefined:
    default:
      return null;
  }
}

/**
 * Render one Intercom block.
 *
 * Ten types occur across the live corpus, not the four the integration notes
 * listed. `callout` and `collapsibleSection` nest their body under `content`
 * rather than `text`, and `subheading`, `unorderedNestedList`,
 * `collapsibleSection`, `image`, `code` and `horizontalRule` would all be
 * dropped by a renderer that only knew the four — silently, since a missing
 * block leaves no trace in the output.
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
      return `**${inlineText(block.summary ?? '')}**\n\n${renderBlocks(block.content ?? [])}`;
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

  const html = await httpGetText(`${source.baseUrl}/${locale}/`);
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

  const html = await httpGetText(collection.url);
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

  const count = (entries: TocEntry[]): number => entries.reduce(
    (total, entry) => total + 1 + (entry.children !== undefined ? count(entry.children) : 0), 0);
  const serialise = (entry: TocEntry, depth = 0): string => {
    const indent = '  '.repeat(depth);
    const children = entry.children?.map(child => serialise(child, depth + 1)).join('') ?? '';
    return `${indent}- ${entry.title}\n${children}`;
  };

  const calc = calculatePagination(allToc.length, page, PAGINATION_CONFIG.DEFAULT_PAGE_SIZE);
  const { items, tokenCount, truncated } = truncateListByTokens(
    allToc.slice(calc.startIndex, calc.endIndex), maxTokens, serialise);
  const paginationNote = buildPaginationNote(calc);

  return {
    toc: items,
    pagination: {
      page: calc.page,
      pageSize: calc.pageSize,
      totalPages: calc.totalPages,
      totalItems: count(allToc),
      hasNext: calc.hasNext,
      hasPrev: calc.hasPrev,
    },
    tokenInfo: { tokenCount, truncated, maxTokens },
    ...(paginationNote !== undefined ? { paginationNote } : {}),
  };
}
