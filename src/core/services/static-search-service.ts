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

import Fuse, { type IFuseOptions } from 'fuse.js';
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
  const key = cacheKey('static-search-index-v2', { source: source.id, locale });
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
 * Per-server Fuse indexes, keyed `sourceId:locale`.
 *
 * Same shape as the glossary's: a WeakMap on the CacheProvider so each
 * ServerContext gets its own and it is collected with the context, rather
 * than a module-level map that would outlive a request in a runtime where
 * module scope persists.
 */
const indexByServer = new WeakMap<CacheProvider, Map<string, {
  source: StaticSearchEntry[];
  fuse: Fuse<StaticSearchEntry>;
}>>();

const FUSE_OPTIONS: IFuseOptions<StaticSearchEntry> = {
  keys: [{ name: 'title', weight: 1 }],
  threshold: 0.35,
  includeScore: true,
  ignoreLocation: true,
  minMatchCharLength: 3,
};

function fuseFor(ctx: ServerContext, key: string, entries: StaticSearchEntry[]): Fuse<StaticSearchEntry> {
  let perServer = indexByServer.get(ctx.cache);
  if (perServer === undefined) {
    perServer = new Map();
    indexByServer.set(ctx.cache, perServer);
  }
  const existing = perServer.get(key);
  // Rebuild when the underlying array is a different one — the cache TTL
  // expiring is what replaces it.
  if (existing?.source === entries) { return existing.fuse; }

  const fuse = new Fuse(entries, FUSE_OPTIONS);
  perServer.set(key, { source: entries, fuse });
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

  for (const source of Object.values(STATIC_DOC_SOURCES) as StaticDocSource[]) {
    const sourceLocale = source.locales[locale];
    if (sourceLocale === undefined) { continue; }

    try {
      const entries = await loadStaticIndex(ctx, source, sourceLocale);
      if (entries.length === 0) { continue; }
      const results = fuseFor(ctx, `${source.id}:${sourceLocale}`, entries).search(query, { limit });
      for (const result of results) {
        hits.push({ ...result.item, score: result.score ?? 1 });
      }
    } catch (error) {
      log.warning(`Could not search ${source.name}: ${String(error)}`);
    }
  }

  return hits;
}
