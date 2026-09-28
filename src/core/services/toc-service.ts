/**
 * TOC Service — fetch and transform Fluid Topics TOC into TocEntry[]
 *
 * Replaces the scraper-based TOC fetching with the FT API
 * via ft-client + MapsRegistry.
 */

import { fetchMapToc } from './ft-client.js';
import { buildDisplayUrl } from './topic-resolver.js';
import {
  JAMF_PRODUCTS,
  DEFAULT_LOCALE,
  PAGINATION_CONFIG,
  TOKEN_CONFIG,
} from '../constants.js';
import type { ProductId, LocaleId } from '../constants.js';
import type { ServerContext } from '../types/context.js';
import { cacheKey, type CacheKey } from './cache-key.js';
import { loadOnce } from './load-once.js';
import { paginateTocEntries } from './toc-helpers.js';
import { readTocProviderResult } from './provider-results.js';
import { askProvider } from './provider-error.js';
import type { FtTocNode, TocEntry, FetchTocOptions, FetchTocResult } from '../types.js';
import { JamfDocsError, JamfDocsErrorCode } from '../types.js';

// ─── Transform helpers ─────────────────────────────────────────

/**
 * Recursively convert FtTocNode[] → TocEntry[]
 *
 * Enriches each entry with:
 * - url: buildDisplayUrl(prettyUrl)
 * - contentId / tocId from the FT node
 * - recursively transformed children
 */
export function transformFtTocToTocEntries(nodes: FtTocNode[]): TocEntry[] {
  return nodes.map((node): TocEntry => {
    const entry: TocEntry = {
      // Matches the search path's fallback for the same missing field, so a
      // titleless node reads the same wherever it surfaces.
      title: node.title ?? 'Untitled',
      url: buildDisplayUrl(node.prettyUrl),
      contentId: node.contentId,
      tocId: node.tocId,
    };

    // Absent `children` means a leaf, the same as an empty list.
    const children = node.children ?? [];
    if (children.length > 0) {
      entry.children = transformFtTocToTocEntries(children);
    }

    return entry;
  });
}

// ─── Counting / serialisation helpers ──────────────────────────

// ─── Cached tree ───────────────────────────────────────────────

/**
 * What the `ft-toc-v2` cache holds for one table of contents: the tree, and
 * the map it was fetched from, with that map's locale.
 *
 * Until 2026-09-28 the cache (`ft-toc`) held the tree alone, and a hit named
 * it by asking the registry again. The tree is kept for `cacheTtl.toc`
 * (CACHE_TTL_TOC, 24 hours by default) and the registry's list of maps for
 * the TTL it was built with (CACHE_TTL_PRODUCTS in the Node server, 7 days
 * by default). The two are written at different times, so once the
 * registry named a newer map, after Jamf published a version, a tree fetched
 * from the old one was named with the new one: a `mapId` its entries were not
 * read from. A hit now names the map the tree was read from, and asks the
 * registry nothing.
 */
interface CachedToc {
  toc: TocEntry[];
  mapId: string;
  resolvedLocale: string;
}

// ─── Main fetch function ───────────────────────────────────────

/**
 * What a TOC request addresses.
 *
 * Either a {@link ProductId} — the twelve curated products — or a bundle
 * family stem such as `technical-paper-laps`, which is what Fluid Topics
 * actually keys a publication on. Both reduce to a bundle stem before the
 * registry sees them, because that is the only thing `resolveMapId` has ever
 * needed; binding this parameter to the product enum is what limited
 * reachable content to the handful of families the product enum names,
 * rather than everything Jamf publishes.
 *
 * Deliberately `string` rather than a discriminated union: every existing
 * caller passes a product id positionally, and a union would have rewritten
 * ~40 call sites to buy a distinction the resolution below does not need.
 */
export type TocSource = ProductId | (string & {});

/**
 * The bundle family a TOC source resolves to.
 *
 * A product id maps through its registry row; anything else is already a
 * bundle stem. Publication ids that collide with a product id resolve through
 * the product — the only such value is `jamf-app-catalog`, whose registry row
 * names that same stem, so the two paths agree.
 */
function bundleStemFor(source: TocSource): string {
  return source in JAMF_PRODUCTS
    ? JAMF_PRODUCTS[source as ProductId].bundleId
    : source;
}

/**
 * Fetch table of contents for a product or publication via the Fluid Topics API.
 *
 * Resolution order:
 *   1. ctx.tocProvider (if configured)
 *   2. MapsRegistry → mapId → ft-client.fetchMapToc
 *   3. Transform FtTocNode[] → TocEntry[]
 *
 * Results are cached under the `ft-toc-v2` namespace, keyed on locale, product
 * and version — see {@link CacheKeySpaces} — with the map they were fetched
 * from (see {@link CachedToc}), for `cacheTtl.toc`. Until 2026-09-28 that was
 * `cacheTtl.article`, and nothing read `cacheTtl.toc`, though the README
 * documents `CACHE_TTL_TOC`, which the Node server reads into it, as the TTL
 * of a table of contents.
 */
export async function fetchTableOfContents(
  ctx: ServerContext,
  source: TocSource,
  version = 'current',
  options: FetchTocOptions = {},
): Promise<FetchTocResult> {
  const { tocProvider } = ctx;
  if (tocProvider !== undefined) {
    // Read before anything reads it: see readTocProviderResult. What it throws
    // is tagged as its own: see ProviderError.
    const provided = readTocProviderResult(
      await askProvider('toc', async () => await tocProvider.getTableOfContents(source as ProductId, version, options)),
      ctx.logger.createLogger('toc-service'),
    );
    if (provided !== null) { return provided; }
  }

  const page = options.page ?? PAGINATION_CONFIG.DEFAULT_PAGE;
  const maxTokens = options.maxTokens ?? TOKEN_CONFIG.DEFAULT_MAX_TOKENS;
  const locale: LocaleId = options.locale ?? DEFAULT_LOCALE;
  const key = cacheKey('ft-toc-v2', { locale, product: source, version });

  // One request for the tree however many calls want it at once (load-once.ts).
  const cached = await loadOnce(ctx.cache, key, async () => await readTableOfContents(ctx, source, version, locale, key));

  // ─── Pagination & token truncation ───────────────────────────

  return {
    ...paginateTocEntries(cached.toc, page, maxTokens),
    mapId: cached.mapId,
    resolvedLocale: cached.resolvedLocale,
  };
}

/**
 * The cached tree, or the one the registry's map for it carries, fetched and
 * stored: the load {@link fetchTableOfContents} shares between calls.
 */
async function readTableOfContents(
  ctx: ServerContext,
  source: TocSource,
  version: string,
  locale: LocaleId,
  key: CacheKey,
): Promise<CachedToc> {
  let cached = await ctx.cache.get<CachedToc>(key);

  if (cached === null) {
    const resolved = await ctx.mapsRegistry.resolveMap(
      bundleStemFor(source),
      version !== 'current' ? version : undefined,
      locale,
    );

    if (resolved === null) {
      throw new JamfDocsError(
        `Could not resolve map for ${source} version ${version} locale ${locale}`,
        JamfDocsErrorCode.NOT_FOUND,
      );
    }

    const ftNodes = await fetchMapToc(ctx.http, resolved.mapId);

    // The locale that answered is kept with the tree: a cached English tree
    // served to a zh-TW request must still say it is English.
    cached = {
      toc: transformFtTocToTocEntries(ftNodes),
      mapId: resolved.mapId,
      resolvedLocale: resolved.resolvedLocale,
    };

    await ctx.cache.set(key, cached, ctx.config.cacheTtl.toc);
  }

  return cached;
}
