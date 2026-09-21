/**
 * Shared TOC shaping, used by all three services that answer with a TOC.
 *
 * `toc-service` (Fluid Topics), `sitemap-service` (static sources) and
 * `intercom-service` (Help Centers) fetch from three unrelated upstreams and
 * then do the same thing with the result. These two helpers were written three
 * times — byte-identical in the first two, and inlined as `count`/`serialise`
 * closures in the third — and `sitemap-service` documented the duplication
 * rather than removing it ("Mirrors toc-service's own count").
 */

import type { TocEntry, PaginationInfo, TokenInfo } from '../types.js';
import { PAGINATION_CONFIG } from '../constants.js';
import {
  calculatePagination,
  truncateListByTokens,
  buildPaginationNote,
} from './tokenizer.js';

/**
 * Count TOC entries including nested children.
 *
 * Note this is the whole tree, while pagination runs on top-level entries
 * alone: `totalItems` and the page bounds are deliberately counting different
 * things, which is easy to conflate when the two live in separate copies.
 */
export function countTocEntries(entries: TocEntry[]): number {
  return entries.reduce(
    (count, entry) =>
      count + 1 + (entry.children !== undefined ? countTocEntries(entry.children) : 0),
    0,
  );
}

/** Serialise a single TOC entry for token estimation. */
export function tocEntryToString(entry: TocEntry, depth = 0): string {
  const indent = '  '.repeat(depth);
  const childrenStr = entry.children?.map(c => tocEntryToString(c, depth + 1)).join('') ?? '';
  return `${indent}- ${entry.title}\n${childrenStr}`;
}

/** The part of a `FetchTocResult` that does not depend on the upstream. */
export interface PaginatedToc {
  toc: TocEntry[];
  pagination: PaginationInfo;
  tokenInfo: TokenInfo;
  paginationNote?: string;
}

/**
 * Page a fetched TOC and truncate the page to a token budget.
 *
 * Callers differ only in what they add on top — `toc-service` carries `mapId`
 * and a resolved locale, `sitemap-service` a locale, `intercom-service`
 * neither — so they spread this result and append their own fields.
 *
 * The two counts are not the same number and must not be made one: pages are
 * cut from top-level entries (`entries.length`), because a page of a tree is a
 * page of its roots, while `totalItems` reports the whole tree so a client can
 * see how much it is paging through. All three call sites already did this;
 * having it in one place is what keeps them agreeing.
 */
export function paginateTocEntries(
  entries: TocEntry[],
  page: number,
  maxTokens: number,
): PaginatedToc {
  const calc = calculatePagination(
    entries.length,
    page,
    PAGINATION_CONFIG.DEFAULT_PAGE_SIZE,
  );

  const { items, tokenCount, truncated } = truncateListByTokens(
    entries.slice(calc.startIndex, calc.endIndex),
    maxTokens,
    tocEntryToString,
  );

  const paginationNote = buildPaginationNote(calc);

  return {
    toc: items,
    pagination: {
      page: calc.page,
      pageSize: calc.pageSize,
      totalPages: calc.totalPages,
      totalItems: countTocEntries(entries),
      hasNext: calc.hasNext,
      hasPrev: calc.hasPrev,
    },
    tokenInfo: { tokenCount, truncated, maxTokens },
    ...(paginationNote !== undefined ? { paginationNote } : {}),
  };
}
