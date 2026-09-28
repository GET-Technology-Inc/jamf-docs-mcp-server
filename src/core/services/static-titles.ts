/**
 * The titles a static source gives its own pages, read from the pages that
 * list them.
 *
 * A sitemap names every page and none of its titles, so until 2026-09-28 the
 * search title index and concepts.jamf.com's tables of contents titled every
 * page from its slug (`titleFromSlug`). A slug loses a title's case and
 * accents, and concepts.jamf.com keeps its en slugs in every locale while it
 * translates the titles. Both sites list their pages' own titles on pages
 * that cost a few requests per locale:
 *
 * - support.jamf.com, on each collection page, which is also what
 *   `jamf_docs_get_toc` reads a collection's table of contents from. The 22
 *   collection pages of its six locales list all 894 articles its sitemap
 *   does, under the same URLs, and no other (2026-09-28).
 * - concepts.jamf.com, on each section's index page, `/{locale}/guides/` and
 *   `/{locale}/concepts/`, in the data the site's Next.js app streams into
 *   the page ({@link flightPayload}). Where each lists them is declared per
 *   section, as `StaticSection.titleList`.
 *
 * A page no listing names, or one whose listing could not be read, keeps the
 * title its slug gives. A listed title is shown as {@link listedTitle} makes
 * it.
 *
 * concepts.jamf.com's guides index also gives the order its sidebar lists the
 * guides in (`navOrder`), which `jamf_docs_get_toc` follows.
 */

import { cacheKey, type CacheKey } from './cache-key.js';
import { loadOnce } from './load-once.js';
import { fetchIntercomCollectionToc, listIntercomCollections } from './intercom-service.js';
import { canonicalStaticUrl, type StaticDocSource, type StaticSection } from '../constants/sources.js';
import type { ServerContext } from '../types/context.js';
import type { TocEntry } from '../types.js';
import { listedTitle } from '../utils/sanitize.js';

/** The titles one locale of a source lists, and where they could not be read. */
export interface ListedTitles {
  /** Each page's title, keyed by its URL as `canonicalStaticUrl` spells it. */
  titles: ReadonlyMap<string, string>;
  /**
   * Each page's place in the order the site lists it in, keyed as `titles`,
   * for a listing that gives an order: concepts.jamf.com's guides, by
   * `navOrder` (see {@link navTitles}). Only the places of pages under one
   * parent are meant to be compared. Empty for any other listing.
   */
  order: ReadonlyMap<string, number>;
  /** The listing pages that could not be read. Empty when every one was. */
  unread: readonly string[];
}

/**
 * How long a listing that could not be read is remembered, and how long a
 * search title index built without it is kept.
 *
 * A minute, as long as `list_products` remembers a support.jamf.com listing
 * it could not read (#360), and for the same reasons: a page that is back is
 * read again within the minute, and calls one after another while it is down
 * do not each wait on it, up to the request timeout. Until it is read, its
 * pages keep the titles their slugs give, which is what they had before
 * 2026-09-28.
 */
export const UNREAD_LISTING_TTL_MS = 60 * 1000;

/**
 * The titles `source` lists for its pages in one locale: every section's, or
 * those of `sections` alone.
 *
 * Never throws. A listing page that cannot be read is logged, named in
 * `unread`, and costs the titles it lists, not the others.
 *
 * @param locale the source's own locale code, e.g. `ja`
 * @param sections for a source whose sections are declared, the ones to read.
 *   A support.jamf.com locale is read whole: its collection pages list its
 *   articles.
 */
export async function loadListedTitles(
  ctx: ServerContext,
  source: StaticDocSource,
  locale: string,
  sections: readonly StaticSection[] = source.sections,
): Promise<ListedTitles> {
  if (source.dynamicSections?.kind === 'intercom-collections') {
    return await intercomTitles(ctx, source, locale);
  }
  const read = await Promise.all(sections
    .filter(section => section.titleList !== undefined)
    .map(async section => ({ section, ...await sectionTitles(ctx, source, section, locale) })));
  // A `nav` listing is read in the site's order; a `concepts` one states none.
  const order = new Map<string, number>();
  for (const { section, entries } of read) {
    if (section.titleList !== 'nav') { continue; }
    entries.forEach(([url], place) => { if (!order.has(url)) { order.set(url, place); } });
  }
  return {
    titles: new Map(read.flatMap(({ entries }) => entries)),
    order,
    unread: read.flatMap(({ unread }) => unread === undefined ? [] : [unread]),
  };
}

/** Log a listing page that could not be read, as `list_products` logs a listing it could not. */
function warnUnread(ctx: ServerContext, source: StaticDocSource, page: string, error: unknown): void {
  ctx.logger.createLogger('static-titles').warning(
    `Could not read the titles ${source.name} lists at ${page}, so its pages there ` +
      `keep the titles their slugs give: ${String(error)}`,
  );
}

// ─── support.jamf.com ───────────────────────────────────────────

/**
 * The title Intercom's collection pages give each article of one locale.
 *
 * Read through the listing and the collection trees `jamf_docs_get_toc` and
 * `jamf_docs_list_products` read and cache, so a tree either has read serves
 * this too. The listing is read as `list_products` reads it, remembering a
 * failure for a minute: these titles are not what the call is for.
 */
async function intercomTitles(ctx: ServerContext, source: StaticDocSource, locale: string): Promise<ListedTitles> {
  const home = `${source.baseUrl}/${locale}/`;
  let collections;
  try {
    collections = await listIntercomCollections(ctx, source, locale, { rememberFailure: true });
  } catch (error) {
    warnUnread(ctx, source, home, error);
    return { titles: new Map(), order: new Map(), unread: [home] };
  }

  const trees = await Promise.allSettled(collections.map(async collection =>
    await fetchIntercomCollectionToc(ctx, source, collection)));
  const titles = new Map<string, string>();
  const unread: string[] = [];
  trees.forEach((tree, index) => {
    if (tree.status === 'fulfilled') {
      addTocTitles(titles, tree.value);
      return;
    }
    const page = canonicalStaticUrl(source, collections[index]?.url ?? home);
    warnUnread(ctx, source, page, tree.reason);
    unread.push(page);
  });
  return { titles, order: new Map(), unread };
}

/**
 * What `fetchIntercomCollectionToc` titles an entry the collection page gives
 * no title, which is no title of the page's own.
 */
const UNTITLED = 'Untitled';

/**
 * Every entry of a tree, a subcollection's among them, by URL, under its
 * title as {@link listedTitle} makes it. An entry the page gives no title is
 * left out, so that its page keeps the title its slug gives rather than
 * showing as "Untitled".
 */
function addTocTitles(titles: Map<string, string>, entries: readonly TocEntry[]): void {
  for (const entry of entries) {
    const title = entry.title === UNTITLED ? undefined : listedTitle(entry.title);
    if (title !== undefined) { titles.set(entry.url, title); }
    addTocTitles(titles, entry.children ?? []);
  }
}

// ─── concepts.jamf.com ──────────────────────────────────────────

/** What one section's index page lists, as it is cached. */
interface CachedSectionTitles {
  /** `[url, title]`, in the order {@link titlesOnIndexPage} reads them in. */
  entries: [string, string][];
  /** Why the page could not be read, when it could not: see {@link UNREAD_LISTING_TTL_MS}. */
  failure?: string;
}

/**
 * The titles one section's index page lists, read once however many calls
 * want them at once (load-once.ts).
 */
async function sectionTitles(
  ctx: ServerContext,
  source: StaticDocSource,
  section: StaticSection,
  locale: string,
): Promise<{ entries: [string, string][]; unread?: string }> {
  const at: SectionAt = {
    source,
    section,
    locale,
    page: canonicalStaticUrl(source, `${source.baseUrl}/${locale}/${section.path}`),
    key: cacheKey('static-section-titles', { source: source.id, section: section.id, locale }),
  };
  const read = await loadOnce(ctx.cache, at.key, async () => await readSectionTitles(ctx, at));
  return read.failure === undefined ? { entries: read.entries } : { entries: [], unread: at.page };
}

/** One section's index page in one locale, and where what it lists is cached. */
interface SectionAt {
  source: StaticDocSource;
  section: StaticSection;
  locale: string;
  page: string;
  key: CacheKey;
}

/**
 * The cached titles, or those the index page lists, read and stored: what
 * {@link sectionTitles} shares.
 *
 * Kept for `cacheTtl.toc`, as the sitemap they title is. A page that could
 * not be read, or that lists none, as a maintenance page would not, is
 * remembered as such for {@link UNREAD_LISTING_TTL_MS}.
 */
async function readSectionTitles(ctx: ServerContext, at: SectionAt): Promise<CachedSectionTitles> {
  const { source, section, locale, page, key } = at;
  const cached = await ctx.cache.get<CachedSectionTitles>(key);
  if (cached !== null) { return cached; }

  let read: CachedSectionTitles;
  let ttl = ctx.config.cacheTtl.toc;
  try {
    const entries = titlesOnIndexPage(await ctx.http.getText(page), source, section, locale);
    if (entries.length === 0) { throw new Error('the page lists no titles'); }
    read = { entries };
  } catch (error) {
    warnUnread(ctx, source, page, error);
    read = { entries: [], failure: error instanceof Error ? error.message : String(error) };
    ttl = UNREAD_LISTING_TTL_MS;
  }
  await ctx.cache.set(key, read, ttl);
  return read;
}

/**
 * The `[url, title]` pairs a section's index page lists, where
 * `section.titleList` says it lists them: a `nav` tree in the order the
 * site lists it in, and a `concepts` list in the order the page gives it.
 *
 * Exported for the unit tests.
 */
export function titlesOnIndexPage(
  html: string,
  source: StaticDocSource,
  section: StaticSection,
  locale: string,
): [string, string][] {
  const payload = flightPayload(html);
  const urlOf = (path: readonly string[]): string =>
    canonicalStaticUrl(source, `${source.baseUrl}/${locale}/${section.path}/${path.join('/')}`);
  if (section.titleList === 'nav') { return navTitles(payload, urlOf); }
  if (section.titleList === 'concepts') { return listTitles(payload, 'concepts', urlOf); }
  return [];
}

/** The titles in a flat list of pages under `key`, each named by its slug. */
function listTitles(payload: string, key: string, urlOf: (path: readonly string[]) => string): [string, string][] {
  const out: [string, string][] = [];
  for (const list of valuesAt(payload, key)) {
    if (!Array.isArray(list)) { continue; }
    for (const item of list as unknown[]) {
      const { slug, title } = (item ?? {}) as { slug?: unknown; title?: unknown };
      const name = flightString(title);
      if (typeof slug === 'string' && slug !== '' && name !== undefined) { out.push([urlOf([slug]), name]); }
    }
  }
  return out;
}

/** One category of the guides' `nav` tree. */
interface NavCategory {
  id?: unknown;
  label?: unknown;
  guides?: unknown;
  children?: unknown;
}

/**
 * The titles in concepts.jamf.com's guides index, in the order its sidebar
 * lists them: the page's own guide, the section's overview, first; then each
 * category of the `nav` tree under the name the page links it by, followed by
 * its subcategories and then its guides, each under its category's path.
 * Categories and guides each go by their `navOrder`, and those of one
 * `navOrder` in the order `nav` lists them. That is the sidebar's order on
 * 2026-09-28, when every locale's `nav` was already in it: its one tie, Jamf
 * for Mobile and AI Governance at 8, is listed in that order.
 *
 * A category is linked by its name in the locale's `guideCategoryLabels`,
 * which names 11 of the 16, or else by its `label` in `nav`, which is in
 * English in every locale (2026-09-28). A category's own page can title
 * itself otherwise: the ja page for `platform-single-sign-on` is "macOS用
 * Platform SSO", where the index links it as "Platform SSO for macOS". Of
 * the 48 category pages in en, ja and fr, 34 have the title the index links
 * them by, and 22 the one their slug gives (their og:title, 2026-09-28).
 */
function navTitles(payload: string, urlOf: (path: readonly string[]) => string): [string, string][] {
  const labels = valuesAt(payload, 'guideCategoryLabels')
    .find((value): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)) ?? {};
  const out: [string, string][] = [];
  for (const guide of valuesAt(payload, 'guide')) {
    const { path, title } = (guide ?? {}) as { path?: unknown; title?: unknown };
    const guideTitle = flightString(title);
    if (typeof path === 'string' && path !== '' && guideTitle !== undefined) {
      out.push([urlOf(path.split('/').filter(Boolean)), guideTitle]);
    }
  }
  const walk = (categories: unknown, path: readonly string[]): void => {
    for (const item of inNavOrder(categories)) {
      if (typeof item !== 'object' || item === null) { continue; }
      const category = item as NavCategory;
      if (typeof category.id !== 'string' || category.id === '') { continue; }
      const here = [...path, category.id];
      const name = flightString(Object.hasOwn(labels, category.id) ? labels[category.id] : undefined)
        ?? flightString(category.label);
      if (name !== undefined) { out.push([urlOf(here), name]); }
      walk(category.children, here);
      for (const guide of inNavOrder(category.guides)) {
        const { slug, title } = (guide ?? {}) as { slug?: unknown; title?: unknown };
        const guideTitle = flightString(title);
        if (typeof slug === 'string' && slug !== '' && guideTitle !== undefined) {
          out.push([urlOf([...here, slug]), guideTitle]);
        }
      }
    }
  };
  for (const nav of valuesAt(payload, 'nav')) { walk(nav, []); }
  return out;
}

/**
 * The items of a `nav` list by their `navOrder`, and those of one `navOrder`,
 * or of none, in the order the list gives them. One with none goes last.
 */
function inNavOrder(items: unknown): unknown[] {
  if (!Array.isArray(items)) { return []; }
  const navOrder = (item: unknown): number => {
    const { navOrder: value } = (item ?? {}) as { navOrder?: unknown };
    return typeof value === 'number' && Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
  };
  // Array.prototype.sort is stable, so a tie keeps the list's order.
  return [...items as unknown[]].sort((a, b) => {
    const [x, y] = [navOrder(a), navOrder(b)];
    if (x === y) { return 0; }
    return x < y ? -1 : 1;
  });
}

// ─── Next.js page data ──────────────────────────────────────────

/**
 * The data a Next.js App Router page streams into itself: the React Server
 * Components payload, pushed onto `self.__next_f` a string at a time by the
 * page's inline scripts, joined in order.
 *
 * concepts.jamf.com is such an app. Its pages carry no `__NEXT_DATA__`, which
 * support.jamf.com's older Next.js pages do (intercom-service.ts), and it
 * publishes no other listing of its titles in each locale: its `feed.xml`
 * (30 tools) and `llms.txt` (the tools and guides, not their 16 categories)
 * are in English alone, and `/{locale}/llms.txt` is a 404 (2026-09-28).
 */
function flightPayload(html: string): string {
  let payload = '';
  for (const [, literal] of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) {
    try { payload += JSON.parse(literal ?? '""') as string; } catch { /* not one string: skip it */ }
  }
  return payload;
}

/**
 * Every array or object the payload holds under `"key":`, parsed.
 *
 * Found by scanning for the key rather than by splitting the payload into its
 * rows: a row is JSON, but a text row runs on for a byte count, not to a
 * line end, and nothing here needs a row's place in the tree. A value is
 * read to its closing bracket, past any bracket inside a string. What will
 * not parse is skipped.
 */
function valuesAt(payload: string, key: string): unknown[] {
  const values: unknown[] = [];
  const needle = `"${key}":`;
  for (let at = payload.indexOf(needle); at >= 0; at = payload.indexOf(needle, at + needle.length)) {
    const start = at + needle.length;
    const end = closingBracket(payload, start);
    if (end === undefined) { continue; }
    try { values.push(JSON.parse(payload.slice(start, end + 1))); } catch { /* not JSON: skip it */ }
  }
  return values;
}

/** Where the array or object that opens at `start` closes, if one opens there and closes. */
function closingBracket(text: string, start: number): number | undefined {
  if (text[start] !== '[' && text[start] !== '{') { return undefined; }
  let depth = 0;
  for (let at = start; at < text.length; at++) {
    const char = text[at];
    if (char === '"') {
      for (at++; at < text.length && text[at] !== '"'; at++) {
        if (text[at] === '\\') { at++; }
      }
    } else if (char === '[' || char === '{') {
      depth++;
    } else if (char === ']' || char === '}') {
      depth--;
      if (depth === 0) { return at; }
    }
  }
  return undefined;
}

/**
 * A string of the payload, as the page shows it and made fit to show as a
 * title ({@link listedTitle}), or undefined for one that is not text: empty,
 * or a reference to another row, which React writes as a string beginning
 * with `$`. React writes a string that begins with `$` as `$$…`.
 */
function flightString(value: unknown): string | undefined {
  if (typeof value !== 'string') { return undefined; }
  if (value.startsWith('$') && !value.startsWith('$$')) { return undefined; }
  return listedTitle(value.startsWith('$$') ? value.slice(1) : value);
}
