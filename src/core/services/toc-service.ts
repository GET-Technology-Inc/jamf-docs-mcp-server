/**
 * TOC Service — fetch and transform Fluid Topics TOC into TocEntry[]
 *
 * Replaces the scraper-based TOC fetching with the FT API
 * via ft-client + MapsRegistry.
 */

import { fetchMapToc } from './ft-client.js';
import { buildDisplayUrl } from './topic-resolver.js';
import {
  calculatePagination,
  truncateListByTokens,
  buildPaginationNote,
} from './tokenizer.js';
import {
  JAMF_PRODUCTS,
  DEFAULT_LOCALE,
  PAGINATION_CONFIG,
  TOKEN_CONFIG,
} from '../constants.js';
import type { ProductId, LocaleId } from '../constants.js';
import type { ServerContext } from '../types/context.js';
import { cacheKey } from './cache-key.js';
import type { FtTocNode, TocEntry, PaginationInfo, FetchTocOptions, FetchTocResult } from '../types.js';
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

/**
 * Count total TOC entries including nested children
 */
function countTocEntries(entries: TocEntry[]): number {
  return entries.reduce(
    (count, entry) =>
      count + 1 + (entry.children !== undefined ? countTocEntries(entry.children) : 0),
    0,
  );
}

/**
 * Serialise a single TOC entry for token estimation
 */
function tocEntryToString(entry: TocEntry, depth = 0): string {
  const indent = '  '.repeat(depth);
  const childrenStr = entry.children?.map(c => tocEntryToString(c, depth + 1)).join('') ?? '';
  return `${indent}- ${entry.title}\n${childrenStr}`;
}

// ─── Map id resolution ─────────────────────────────────────────

/**
 * Resolve the map id for a product without letting the registry take the
 * request down with it.
 *
 * Used on the cache-hit path, where the TOC is already in hand: the cached
 * tree is stored without the id it was fetched under, so the id has to be
 * re-resolved, and a registry that cannot answer should cost the caller the
 * `mapId` field only — not the table of contents it already has.
 */
async function resolveMapIdQuietly(
  ctx: ServerContext,
  bundleId: string,
  version: string,
  locale: LocaleId,
): Promise<string | null> {
  try {
    return await ctx.mapsRegistry.resolveMapId(
      bundleId,
      version !== 'current' ? version : undefined,
      locale,
    );
  } catch (error) {
    ctx.logger.createLogger('toc-service').warning(
      `Could not resolve mapId for a cached TOC (${bundleId}/${version}/${locale}): ${String(error)}`,
    );
    return null;
  }
}

// ─── Main fetch function ───────────────────────────────────────

/**
 * Fetch table of contents for a product via the Fluid Topics API.
 *
 * Resolution order:
 *   1. ctx.tocProvider (if configured)
 *   2. MapsRegistry → mapId → ft-client.fetchMapToc
 *   3. Transform FtTocNode[] → TocEntry[]
 *
 * Results are cached under the `ft-toc` namespace, keyed on locale, product
 * and version — see {@link CacheKeySpaces}.
 */
export async function fetchTableOfContents(
  ctx: ServerContext,
  product: ProductId,
  version = 'current',
  options: FetchTocOptions = {},
): Promise<FetchTocResult> {
  if (ctx.tocProvider !== undefined) {
    const provided = await ctx.tocProvider.getTableOfContents(product, version, options);
    if (provided !== null) { return provided; }
  }

  const page = options.page ?? PAGINATION_CONFIG.DEFAULT_PAGE;
  const maxTokens = options.maxTokens ?? TOKEN_CONFIG.DEFAULT_MAX_TOKENS;
  const locale: LocaleId = options.locale ?? DEFAULT_LOCALE;
  const key = cacheKey('ft-toc', { locale, product, version });

  const { bundleId } = JAMF_PRODUCTS[product];

  let allToc = await ctx.cache.get<TocEntry[]>(key);
  let mapId: string | null;

  if (allToc === null) {
    mapId = await ctx.mapsRegistry.resolveMapId(
      bundleId,
      version !== 'current' ? version : undefined,
      locale,
    );

    if (mapId === null) {
      throw new JamfDocsError(
        `Could not resolve map for ${product} version ${version} locale ${locale}`,
        JamfDocsErrorCode.NOT_FOUND,
      );
    }

    const ftNodes = await fetchMapToc(mapId);

    allToc = transformFtTocToTocEntries(ftNodes);

    await ctx.cache.set(key, allToc, ctx.config.cacheTtl.article);
  } else {
    // The cache stores the tree, not the id it came from. Re-resolve so a
    // caller reading a cached TOC gets the same `mapId` a cold one would —
    // it is half of the pair `jamf_docs_get_article` documents.
    mapId = await resolveMapIdQuietly(ctx, bundleId, version, locale);
  }

  // ─── Pagination & token truncation ───────────────────────────

  const totalItems = countTocEntries(allToc);
  const topLevelCount = allToc.length;
  const pageSize = PAGINATION_CONFIG.DEFAULT_PAGE_SIZE;
  const paginationCalc = calculatePagination(topLevelCount, page, pageSize);

  const paginatedToc = allToc.slice(paginationCalc.startIndex, paginationCalc.endIndex);

  const { items: finalToc, tokenCount, truncated } =
    truncateListByTokens(paginatedToc, maxTokens, tocEntryToString);

  const tokenInfo = { tokenCount, truncated, maxTokens };

  const pagination: PaginationInfo = {
    page: paginationCalc.page,
    pageSize: paginationCalc.pageSize,
    totalPages: paginationCalc.totalPages,
    totalItems,
    hasNext: paginationCalc.hasNext,
    hasPrev: paginationCalc.hasPrev,
  };

  const paginationNote = buildPaginationNote(paginationCalc);

  return {
    toc: finalToc,
    pagination,
    tokenInfo,
    ...(mapId !== null ? { mapId } : {}),
    ...(paginationNote !== undefined ? { paginationNote } : {}),
  };
}
