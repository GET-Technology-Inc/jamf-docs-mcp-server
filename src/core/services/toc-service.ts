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
      title: node.title,
      url: buildDisplayUrl(node.prettyUrl),
      contentId: node.contentId,
      tocId: node.tocId,
    };

    if (node.children.length > 0) {
      entry.children = transformFtTocToTocEntries(node.children);
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

// ─── Main fetch function ───────────────────────────────────────

/**
 * Fetch table of contents for a product via the Fluid Topics API.
 *
 * Resolution order:
 *   1. ctx.tocProvider (if configured)
 *   2. MapsRegistry → mapId → ft-client.fetchMapToc
 *   3. Transform FtTocNode[] → TocEntry[]
 *
 * Results are cached under `ft-toc:{locale}:{product}:{version}`.
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
  const locale = options.locale ?? DEFAULT_LOCALE as LocaleId;
  const cacheKey = `ft-toc:${locale}:${product}:${version}`;

  let allToc = await ctx.cache.get<TocEntry[]>(cacheKey);

  if (allToc === null) {
    const productInfo = JAMF_PRODUCTS[product];
    const mapId = await ctx.mapsRegistry.resolveMapId(
      productInfo.bundleId,
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

    await ctx.cache.set(cacheKey, allToc, ctx.config.cacheTtl.article);
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
    ...(paginationNote !== undefined ? { paginationNote } : {}),
  };
}
