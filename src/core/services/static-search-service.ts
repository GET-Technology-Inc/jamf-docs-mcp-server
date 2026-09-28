/**
 * Searching the non-Fluid-Topics sources.
 *
 * These results are kept in their own block rather than merged into the
 * main results' ranking. `SearchResult` has no score field and Fluid Topics
 * does not return one — `search.ts` says so where it builds a result — so
 * there is nothing on either side to fuse two orderings on. Inventing a
 * comparable number would produce an interleaving that looks authoritative
 * and is not. A labelled second block says exactly what it is: other places
 * this query matched.
 *
 * The index is titles: every page each source's sitemap lists, 820
 * support.jamf.com articles in en (894 over its six locales) and 93
 * concepts.jamf.com pages in each locale (2026-09-28), under the title the
 * source lists it by (static-titles.ts), or else the one its slug gives. A
 * title is what a ranked pointer needs, and the listings are a few requests
 * per locale, against one per page to read each page's own.
 */

import Fuse, { type FuseIndex, type FuseOptionKey, type IFuseOptions } from 'fuse.js';
import { cacheKey, type CacheKey } from './cache-key.js';
import { loadOnce } from './load-once.js';
import { loadSitemap, titleFromSlug, type SitemapEntry } from './sitemap-service.js';
import { loadListedTitles, UNREAD_LISTING_TTL_MS } from './static-titles.js';
import { STATIC_DOC_SOURCES, type StaticDocSource } from '../constants/sources.js';
import { CJK_CHARACTER } from '../utils/cjk.js';
import type { CacheProvider } from './interfaces/cache.js';
import type { ServerContext } from '../types/context.js';

/** One page of a static source, as the index holds it. */
export interface StaticSearchEntry {
  /** The title the source lists the page by, or else the one its slug gives. */
  title: string;
  url: string;
  /** Display name of the source it belongs to. */
  source: string;
  /**
   * The title the page's slug gives, where the source lists it by another:
   * searched too, at half the weight of `title`, so that a query in the
   * slug's words finds the page it found before its listed title was read.
   * Those words are English in every locale of concepts.jamf.com, and
   * support.jamf.com's without their accents. Where it is unset, `title` is
   * searched in its place (see `FUSE_KEYS`). See `loadStaticIndex`.
   */
  slugTitle?: string;
}

/** A hit, with the source that produced it. It carries the title it is shown by, not the slug's. */
export interface StaticSearchHit extends Omit<StaticSearchEntry, 'slugTitle'> {
  /** Fuse's distance, 0 = exact. Comparable within this block only. */
  score: number;
}

/**
 * Path segments that are not articles.
 *
 * `browse` is in concepts.jamf.com's sitemap (ten entries, one per locale)
 * and is a JS-only shell — thirteen characters once tags are stripped. The
 * integration notes claimed these were absent from the sitemap and therefore
 * excluded for free; they are not.
 */
const NON_ARTICLE_SEGMENTS = new Set(['browse', 'about', 'ecosystem', 'collections']);

/**
 * Turn a sitemap entry into an index entry, titled as `titles` lists it.
 *
 * A page `titles` does not list is titled from its slug. Intercom article
 * slugs are prefixed with the numeric id (`10631322-get-started-with-jamf-now`),
 * which is stripped before casing — leaving it in produces "10631322 Get
 * Started With Jamf Now".
 */
function entryFor(
  source: StaticDocSource,
  entry: SitemapEntry,
  locale: string,
  titles: ReadonlyMap<string, string>,
): StaticSearchEntry | null {
  const [entryLocale, section, ...rest] = entry.segments;
  if (entryLocale !== locale) { return null; }
  if (section === undefined || NON_ARTICLE_SEGMENTS.has(section)) { return null; }
  // A section index page is a container, not an article.
  if (rest.length === 0) { return null; }

  const slug = (rest[rest.length - 1] ?? '').replace(/^\d+-/, '');
  const fromSlug = slug === '' ? undefined : titleFromSlug(slug, source.slugLocale ?? locale);
  const listed = titles.get(entry.url);
  if (listed === undefined) {
    return fromSlug === undefined ? null : { title: fromSlug, url: entry.url, source: source.name };
  }
  return {
    title: listed,
    url: entry.url,
    source: source.name,
    ...(fromSlug !== undefined && fromSlug !== listed ? { slugTitle: fromSlug } : {}),
  };
}

/**
 * Build one source's title index for a locale, once however many searches in
 * that locale want it at once (load-once.ts).
 *
 * Built from the source's sitemap as `loadSitemap` caches it, which lists
 * every locale and which concepts.jamf.com's tables of contents are built
 * from too. So one request for it serves every locale's index and those
 * tables of contents until the entry expires. Until 2026-09-28 each locale's
 * index requested the whole sitemap for itself: searches in en-US, ja-JP and
 * de-DE and then a concepts.jamf.com `get_toc`, one after another, requested
 * concepts.jamf.com's sitemap four times and support.jamf.com's three,
 * offline and live. Live, those are 208 KB and 253 KB (2026-09-28).
 *
 * Each page is titled as the source lists it in that locale
 * (`loadListedTitles`): support.jamf.com's from the locale's listing and
 * collection pages, which `jamf_docs_get_toc` and `jamf_docs_list_products`
 * read and cache too, and concepts.jamf.com's from its two section index
 * pages. Until 2026-09-28 every title was made from the page's slug, which
 * wrote support.jamf.com's de, es and fr titles without their accents,
 * "Verknupft" for "verknüpft", and concepts.jamf.com's in every locale in
 * English, "Threat and Risk Management" for ja-JP's 脅威とリスク管理.
 */
export async function loadStaticIndex(
  ctx: ServerContext,
  source: StaticDocSource,
  locale: string,
): Promise<StaticSearchEntry[]> {
  const key = cacheKey('static-search-index-v5', { source: source.id, locale });
  return await loadOnce(ctx.cache, key, async () => await readStaticIndex(ctx, source, locale, key));
}

/**
 * The cached index, or one built from the sitemap and the listed titles and
 * stored: what {@link loadStaticIndex} shares.
 */
async function readStaticIndex(
  ctx: ServerContext,
  source: StaticDocSource,
  locale: string,
  key: CacheKey,
): Promise<StaticSearchEntry[]> {
  const cached = await ctx.cache.get<StaticSearchEntry[]>(key);
  if (cached !== null) { return cached; }

  // The concepts.jamf.com TOC's own parse, and so the canonicaliser that the
  // support.jamf.com TOC (read off Intercom's collection pages) and
  // `get_article` apply too: a hit carries the URL `get_toc` and
  // `get_article` report for the same page. This used to scan for `<loc>`
  // itself and hand out each value as listed — slashless, which
  // concepts.jamf.com answers with a 301 — so a concepts page had one URL
  // here and another everywhere else. The listed titles are keyed by the
  // same canonical URL.
  //
  // Read side by side, so a cold index waits on the slower of the two, not
  // on both. The listings never throw; a sitemap that cannot be read fails
  // the index, as it always has, and from then on no listing page is asked
  // for that has not been already. Until 2026-09-28 the listings went on
  // being read after the search had replied without them: with
  // support.jamf.com's sitemap answering 404, offline, the nine collection
  // pages its en listing names were all requested after the reply.
  const sitemapFailed = new AbortController();
  const [sitemap, listed] = await Promise.all([
    loadSitemap(ctx, source).catch((error: unknown) => {
      sitemapFailed.abort();
      throw error;
    }),
    loadListedTitles(ctx, source, locale, source.sections, sitemapFailed.signal),
  ]);
  const entries: StaticSearchEntry[] = [];
  for (const sitemapEntry of sitemap) {
    const entry = entryFor(source, sitemapEntry, locale, listed.titles);
    if (entry !== null) { entries.push(entry); }
  }

  // An index built while a listing could not be read holds titles made from
  // slugs where it would have held the listed ones, so it is kept only as
  // long as that failure is remembered, and built again after it.
  const ttl = listed.unread.length === 0 ? ctx.config.cacheTtl.products : UNREAD_LISTING_TTL_MS;
  await ctx.cache.set(key, entries, ttl);
  return entries;
}

// ─── Fuse index, per server ─────────────────────────────────────

/**
 * Per-server Fuse indexes, keyed `sourceId:locale`: one index of the titles,
 * and a Fuse on it for each `minMatchCharLength` a query has asked for (see
 * `fuseQueryFor`).
 *
 * Same shape as the glossary's: a WeakMap on the CacheProvider so each
 * ServerContext gets its own and it is collected with the context, rather
 * than a module-level map that would outlive a request in a runtime where
 * module scope persists.
 */
const indexByServer = new WeakMap<CacheProvider, Map<string, {
  source: StaticSearchEntry[];
  index: FuseIndex<StaticSearchEntry>;
  fuses: Map<number, Fuse<StaticSearchEntry>>;
}>>();

/**
 * A page is matched on its title and, at half the weight, on the one its
 * slug gives (`StaticSearchEntry.slugTitle`), so a match on its listed title
 * ranks it above one on its slug's words alone.
 *
 * Every page is matched on both keys: where the slug gives the same title,
 * the second key reads the listed one. Fuse multiplies a page's score over
 * the keys it matched on, so a page matched on one key alone scores worse
 * than one that matches its query as well on two. Without the fallback, a
 * page whose slug title differed only in case, as 218 of support.jamf.com's
 * 820 en ones do, outranked a page whose slug gave its title exactly.
 *
 * The title alone until 2026-09-28, when the listed titles replaced those
 * made from slugs. Measured offline that day over the live pages, with 16,201
 * queries taken from both builds' titles (each title, each word and each pair
 * of adjacent words, in all eight locales): 14,891 found a page before. With
 * the listed titles alone, 14,720 did, and 1,252 of the 14,891 found none,
 * 1,217 of them queries that had found only concepts.jamf.com pages, whose
 * titles are translated or reworded where their slugs are not. With both
 * keys, 15,972 do, and none of the 14,891 finds nothing. Where one source's
 * top 3 for a query is not what it was, a page among them has a title whose
 * words changed, in each of the 5,116 cases; without the fallback, 690 of
 * 9,344 had none.
 */
const FUSE_KEYS: FuseOptionKey<StaticSearchEntry>[] = [
  { name: 'title', weight: 1 },
  { name: 'slugTitle', weight: 0.5, getFn: (entry: StaticSearchEntry) => entry.slugTitle ?? entry.title },
];

/**
 * Carries no `minMatchCharLength`, so on its own it leaves Fuse's default of
 * one: a Fuse built from these alone matches a single character. `fuseFor`
 * adds the one `fuseQueryFor` chooses for the query.
 */
const FUSE_OPTIONS: IFuseOptions<StaticSearchEntry> = {
  keys: FUSE_KEYS,
  threshold: 0.35,
  includeScore: true,
  ignoreLocation: true,
};

/**
 * The shortest run of matched characters, for a query with no Chinese,
 * Japanese or Korean character in it, and the cap for one with.
 */
const MIN_MATCH_CHAR_LENGTH = 3;

/**
 * What Fuse is asked for `query`: the pattern, and its `minMatchCharLength`,
 * the shortest run of characters in a row that a title must match.
 *
 * Three, for a query with no Chinese, Japanese or Korean character in it,
 * which is every Latin one, and that query is passed on as typed. Fuse matches
 * anywhere in a title, not word by word, and two Latin letters are mostly
 * part of a longer word: `id` is in 78 of the 913 en titles and is the word
 * ID in only 15. In the rest it is part of Provider, Android and the like
 * (2026-09-28).
 *
 * A query with such a character in it is held to its own length, up to that
 * three. Two of those characters are a word: 密碼 is "password", 憑證
 * "certificate", 認証 "authentication". Such a word can only match as a run
 * of two, so until 2026-09-28 every two-character query matched nothing, even
 * a title that holds it verbatim. Measured live over `jamf_docs_search` that
 * day, 20 of 20 two-character ja-JP and zh-TW queries returned no
 * other-source match, while Fluid Topics answered 18 of them.
 *
 * Such a query is trimmed of whitespace first, the ideographic space (U+3000)
 * a Chinese or Japanese keyboard types included. Padded, 密碼 is three
 * characters long and so held to three, a run it has only where a title
 * happens to have a space beside the word: live, `密碼 ` found nothing in
 * zh-TW where 密碼 found one (2026-09-28). Lengths are UTF-16 code units, as
 * Fuse and the tool's schema both count them. So one character such as 鎖,
 * which `jamf_docs_search`'s schema has accepted on its own since 2026-09-28
 * (until then, only padded), is held to one and matches the titles that hold
 * it.
 *
 * Capped at the query's length, not lowered to two for every such query.
 * Measured over the live titles on 2026-09-28, with queries taken from the ja
 * and zh-TW ones: two for all of them also changed 96 of the 965 queries of
 * three characters or more. Fuse allows a three-character pattern one error,
 * so a run of two was enough, and what it added was mostly a shared ending
 * (付ける found サポートを受ける) or, in a mixed query, two Latin letters
 * (IDを found Android Enterprise).
 *
 * So, by construction rather than by measurement, two kinds of query get the
 * pattern and options they got before, and so the same matches: one with no
 * such character, and an unpadded one of three characters or more. A shorter
 * one now matches; at two characters the threshold allows no error, so it
 * matches exactly the titles that hold it. A padded one is searched without
 * its padding.
 */
function fuseQueryFor(query: string): { pattern: string; minMatchCharLength: number } {
  if (!CJK_CHARACTER.test(query)) {
    return { pattern: query, minMatchCharLength: MIN_MATCH_CHAR_LENGTH };
  }
  const pattern = query.trim();
  return { pattern, minMatchCharLength: Math.min(MIN_MATCH_CHAR_LENGTH, pattern.length) };
}

function fuseFor(
  ctx: ServerContext,
  key: string,
  entries: StaticSearchEntry[],
  minMatchCharLength: number,
): Fuse<StaticSearchEntry> {
  let perServer = indexByServer.get(ctx.cache);
  if (perServer === undefined) {
    perServer = new Map();
    indexByServer.set(ctx.cache, perServer);
  }
  let indexed = perServer.get(key);
  // Rebuild when the underlying array is a different one — the cache TTL
  // expiring is what replaces it. The index and every Fuse built on the old
  // array go with it.
  if (indexed?.source !== entries) {
    indexed = { source: entries, index: Fuse.createIndex(FUSE_KEYS, entries), fuses: new Map() };
    perServer.set(key, indexed);
  }
  // Fuse fixes its options when it is built, so each minimum has its own: one
  // built for a two-character query must not answer a Latin one. They share
  // the index, which only the keys shape.
  let fuse = indexed.fuses.get(minMatchCharLength);
  if (fuse === undefined) {
    fuse = new Fuse(entries, { ...FUSE_OPTIONS, minMatchCharLength }, indexed.index);
    indexed.fuses.set(minMatchCharLength, fuse);
  }
  return fuse;
}

/**
 * Search every static source that publishes the requested locale.
 *
 * Best-effort per source: one unreachable sitemap costs its own hits, not
 * the block, and never the Fluid Topics results this runs alongside.
 *
 * The sources are searched side by side, and their hits returned in the
 * order the sources are declared. Until 2026-09-28 one was searched after
 * the other, so a search with both indexes cold waited on the two builds in
 * turn, which since that day read the pages the titles are listed on as well.
 */
export async function searchStaticSources(
  ctx: ServerContext,
  query: string,
  locale: string,
  limit = 3,
): Promise<StaticSearchHit[]> {
  const log = ctx.logger.createLogger('static-search');
  const { pattern, minMatchCharLength } = fuseQueryFor(query);

  const perSource = await Promise.all((Object.values(STATIC_DOC_SOURCES) as StaticDocSource[]).map(async source => {
    const sourceLocale = source.locales[locale];
    if (sourceLocale === undefined) { return []; }

    try {
      const entries = await loadStaticIndex(ctx, source, sourceLocale);
      if (entries.length === 0) { return []; }
      return fuseFor(ctx, `${source.id}:${sourceLocale}`, entries, minMatchCharLength)
        .search(pattern, { limit })
        .map(({ item, score }): StaticSearchHit =>
          ({ title: item.title, url: item.url, source: item.source, score: score ?? 1 }));
    } catch (error) {
      log.warning(`Could not search ${source.name}: ${String(error)}`);
      return [];
    }
  }));

  return perSource.flat();
}
