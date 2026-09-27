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
 * The index is titles, recovered from each source's sitemap. That is one
 * request per source for 808 support articles and 98 concepts pages, against
 * ~900 page fetches to read the real headings — and a title is what a
 * ranked pointer needs.
 */

import Fuse, { type FuseIndex, type FuseOptionKey, type IFuseOptions } from 'fuse.js';
import { cacheKey } from './cache-key.js';
import { parseSitemap, titleFromSlug, type SitemapEntry } from './sitemap-service.js';
import { STATIC_DOC_SOURCES, type StaticDocSource } from '../constants/sources.js';
import type { CacheProvider } from './interfaces/cache.js';
import type { ServerContext } from '../types/context.js';

/** One page of a static source, as the index holds it. */
export interface StaticSearchEntry {
  title: string;
  url: string;
  /** Display name of the source it belongs to. */
  source: string;
}

/** A hit, with the source that produced it. */
export interface StaticSearchHit extends StaticSearchEntry {
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
 * Turn a sitemap entry into an index entry.
 *
 * Intercom article slugs are prefixed with the numeric id
 * (`10631322-get-started-with-jamf-now`), which is stripped before casing —
 * leaving it in produces "10631322 Get Started With Jamf Now".
 */
function entryFor(source: StaticDocSource, entry: SitemapEntry, locale: string): StaticSearchEntry | null {
  const [entryLocale, section, ...rest] = entry.segments;
  if (entryLocale !== locale) { return null; }
  if (section === undefined || NON_ARTICLE_SEGMENTS.has(section)) { return null; }
  // A section index page is a container, not an article.
  if (rest.length === 0) { return null; }

  const slug = (rest[rest.length - 1] ?? '').replace(/^\d+-/, '');
  if (slug === '') { return null; }

  return { title: titleFromSlug(slug), url: entry.url, source: source.name };
}

/** Build one source's title index for a locale. */
export async function loadStaticIndex(
  ctx: ServerContext,
  source: StaticDocSource,
  locale: string,
): Promise<StaticSearchEntry[]> {
  const key = cacheKey('static-search-index-v3', { source: source.id, locale });
  const cached = await ctx.cache.get<StaticSearchEntry[]>(key);
  if (cached !== null) { return cached; }

  // The concepts.jamf.com TOC's own parse, and so the canonicaliser that the
  // support.jamf.com TOC (read off Intercom's collection pages) and
  // `get_article` apply too: a hit carries the URL `get_toc` and
  // `get_article` report for the same page. This used to scan for `<loc>`
  // itself and hand out each value as listed — slashless, which
  // concepts.jamf.com answers with a 301 — so a concepts page had one URL
  // here and another everywhere else.
  const xml = await ctx.http.getText(`${source.baseUrl}/sitemap.xml`);
  const entries: StaticSearchEntry[] = [];
  for (const sitemapEntry of parseSitemap(source, xml)) {
    const entry = entryFor(source, sitemapEntry, locale);
    if (entry !== null) { entries.push(entry); }
  }

  await ctx.cache.set(key, entries, ctx.config.cacheTtl.products);
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

const FUSE_KEYS: FuseOptionKey<StaticSearchEntry>[] = [{ name: 'title', weight: 1 }];

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

/** A Chinese, Japanese or Korean character: Han, Hiragana, Katakana or Hangul. */
const CJK_CHARACTER = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

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
 * which `jamf_docs_search`'s schema lets through only padded, is held to one
 * and matches the titles that hold it.
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
 */
export async function searchStaticSources(
  ctx: ServerContext,
  query: string,
  locale: string,
  limit = 3,
): Promise<StaticSearchHit[]> {
  const log = ctx.logger.createLogger('static-search');
  const hits: StaticSearchHit[] = [];
  const { pattern, minMatchCharLength } = fuseQueryFor(query);

  for (const source of Object.values(STATIC_DOC_SOURCES) as StaticDocSource[]) {
    const sourceLocale = source.locales[locale];
    if (sourceLocale === undefined) { continue; }

    try {
      const entries = await loadStaticIndex(ctx, source, sourceLocale);
      if (entries.length === 0) { continue; }
      const results = fuseFor(ctx, `${source.id}:${sourceLocale}`, entries, minMatchCharLength)
        .search(pattern, { limit });
      for (const result of results) {
        hits.push({ ...result.item, score: result.score ?? 1 });
      }
    } catch (error) {
      log.warning(`Could not search ${source.name}: ${String(error)}`);
    }
  }

  return hits;
}
