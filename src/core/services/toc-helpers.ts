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

import type { TocEntry, TocTruncatedEntry, PaginationInfo, TokenInfo } from '../types.js';
import { PAGINATION_CONFIG } from '../constants.js';
import { estimateTokens, buildPaginationNote } from './tokenizer.js';
import { pageStarts, pagesPastTheLastNote } from './budget-pages.js';

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
  truncatedEntry?: TocTruncatedEntry;
}

/**
 * The first `count` entries of a subtree in document order, as a tree.
 *
 * Printed with `tocEntryToString`, the result is the first `count` lines of
 * the whole subtree's printout. Every field of a kept entry is kept.
 */
function firstEntriesOf(entry: TocEntry, count: number): TocEntry {
  let left = count;
  const copy = (node: TocEntry): TocEntry => {
    left--;
    const { children, ...fields } = node;
    const kept: TocEntry[] = [];
    for (const child of children ?? []) {
      if (left <= 0) { break; }
      kept.push(copy(child));
    }
    return kept.length > 0 ? { ...fields, children: kept } : fields;
  };
  return copy(entry);
}

/**
 * Cut one top-level entry to the entries, in document order, that fit.
 *
 * Only called for an entry with children that does not fit whole, so at
 * least one entry of the subtree is left out. The entry itself is always
 * kept, even if its own line were over budget: a page that shows nothing
 * reaches nothing.
 */
function cutToFit(
  entry: TocEntry,
  maxTokens: number,
): { entry: TocEntry; tokenCount: number; shownEntries: number } {
  const cost = (shown: TocEntry): number => estimateTokens(tocEntryToString(shown));
  let best = firstEntriesOf(entry, 1);
  let bestCount = 1;
  let bestCost = cost(best);
  // Adding a line never makes the printout cheaper, so the largest prefix
  // that fits can be found by halving.
  let low = 2;
  let high = countTocEntries([entry]) - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = firstEntriesOf(entry, mid);
    const candidateCost = cost(candidate);
    if (candidateCost <= maxTokens) {
      best = candidate;
      bestCount = mid;
      bestCost = candidateCost;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return { entry: best, tokenCount: bestCost, shownEntries: bestCount };
}

/**
 * Page a fetched TOC to a token budget.
 *
 * Callers differ only in what they add on top — `toc-service` carries `mapId`
 * and a resolved locale, `sitemap-service` a locale, `intercom-service`
 * neither — so they spread this result and append their own fields.
 *
 * A page is a run of whole top-level entries, each with everything under it:
 * as many as fit `maxTokens`, and at most `PAGINATION_CONFIG.DEFAULT_PAGE_SIZE`.
 * The next page starts at the first entry that did not fit. Until 2026-09-26 a
 * page was ten entries cut to the budget afterwards, and page N+1 still began
 * at entry 10·N, so an entry the cut dropped was on no page: live, Jamf Pro
 * reached 6 of its 20 top-level entries at `maxTokens: 1000` and 17 at the
 * default 5000, and the notice under each cut page advised `page`, which could
 * not reach them. Cutting while walking puts every entry on exactly one page.
 * The walk is `pageStarts` in budget-pages.ts, which the search's pages have
 * shared since 2026-09-28.
 *
 * A top-level entry that costs more than `maxTokens` on its own gets a page to
 * itself, cut to the entries of its subtree that fit, in document order. That
 * page is the only one with `tokenInfo.truncated`, and `truncatedEntry` says
 * what was cut and what budget shows it whole. Skipping it instead would put
 * it on no page, which is the defect this replaced.
 *
 * `hasNext` stops at the last page `page` accepts (`PAGINATION_CONFIG.MAX_PAGE`)
 * even when the budget makes more, and `paginationNote` then names a
 * `maxTokens` that fits the tree in pages it can ask for (see
 * `pagesPastTheLastNote` in budget-pages.ts).
 *
 * The two counts are not the same number and must not be made one: pages are
 * cut from top-level entries, because a page of a tree is a page of its roots,
 * while `totalItems` reports the whole tree so a client can see how much it is
 * paging through. All three call sites already did this; having it in one
 * place is what keeps them agreeing.
 */
export function paginateTocEntries(
  entries: TocEntry[],
  page: number,
  maxTokens: number,
): PaginatedToc {
  const pageSize = PAGINATION_CONFIG.DEFAULT_PAGE_SIZE;
  const costs = entries.map(entry => estimateTokens(tocEntryToString(entry)));
  const starts = pageStarts(costs, maxTokens, pageSize);
  const totalPages = starts.length;
  const current = Math.min(Math.max(1, page), Math.max(totalPages, 1));
  const start = starts[current - 1] ?? 0;
  const end = starts[current] ?? entries.length;

  let toc = entries.slice(start, end);
  let tokenCount = costs.slice(start, end).reduce((sum, cost) => sum + cost, 0);
  let truncatedEntry: TocTruncatedEntry | undefined;

  // A lone entry with nothing under it is shown whole even over budget: there
  // is nothing to cut, and a title alone over `MIN_TOKENS` is ~400 characters.
  const [only] = toc;
  if (toc.length === 1 && only !== undefined && tokenCount > maxTokens && (only.children?.length ?? 0) > 0) {
    const cut = cutToFit(only, maxTokens);
    truncatedEntry = {
      title: only.title,
      shownEntries: cut.shownEntries,
      totalEntries: countTocEntries([only]),
      estimatedTokens: tokenCount,
    };
    toc = [cut.entry];
    tokenCount = cut.tokenCount;
  }

  const notes = [
    buildPaginationNote({ pageWasClamped: current !== page, requestedPage: page, totalPages }),
    // A small budget over a tree with many large top-level entries can need
    // more pages than `page` accepts. No Jamf source comes close: live on
    // 2026-09-26 the most pages any needed was 24, at `maxTokens: 100`, and
    // the most top-level entries any had was 40.
    pagesPastTheLastNote(
      costs,
      { maxTokens, pageSize, totalPages },
      { name: 'this table of contents', plural: false, items: 'entries' },
    ),
  ].filter((note): note is string => note !== undefined);
  const paginationNote = notes.length > 0 ? notes.join(' ') : undefined;

  return {
    toc,
    pagination: {
      page: current,
      pageSize,
      totalPages,
      totalItems: countTocEntries(entries),
      // Not past the last page `page` accepts: pointing there would send the
      // caller to a request the input schema rejects.
      hasNext: current < Math.min(totalPages, PAGINATION_CONFIG.MAX_PAGE),
      hasPrev: current > 1,
    },
    tokenInfo: { tokenCount, truncated: truncatedEntry !== undefined, maxTokens },
    ...(paginationNote !== undefined ? { paginationNote } : {}),
    ...(truncatedEntry !== undefined ? { truncatedEntry } : {}),
  };
}
