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
import { PAGINATION_CONFIG, TOKEN_CONFIG } from '../constants.js';
import { estimateTokens, buildPaginationNote } from './tokenizer.js';

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
 * Where each page starts, given what each top-level entry costs.
 *
 * A page takes its first entry whatever it costs, then each following entry
 * while it fits the budget and the page has room. So a page ends at the first
 * entry that does not fit, and that entry starts the next page. The pages
 * depend on `maxTokens` and on nothing else, so the same budget gives the same
 * pages on every request.
 */
function pageStarts(costs: number[], maxTokens: number, pageSize: number): number[] {
  const starts: number[] = [];
  let next = 0;
  while (next < costs.length) {
    starts.push(next);
    let used = costs[next] ?? 0;
    let held = 1;
    next++;
    while (next < costs.length && held < pageSize && used + (costs[next] ?? 0) <= maxTokens) {
      used += costs[next] ?? 0;
      held++;
      next++;
    }
  }
  return starts;
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
 * The note for a budget whose pages run past the last one `page` accepts, or
 * nothing.
 *
 * `page` stops at `PAGINATION_CONFIG.MAX_PAGE`, and a page holds as many whole
 * top-level entries as fit `maxTokens`, so a small budget over a tree with
 * many large top-level entries can need more pages than that. The entries on
 * those pages are reachable only at a larger budget, so the note names the
 * smallest one that fits the whole tree in pages `page` can ask for. No Jamf
 * source comes close: live on 2026-09-26 the most pages any needed was 24, at
 * `maxTokens: 100`, and the most top-level entries any had was 40.
 */
function pagesPastTheLastNote(costs: number[], maxTokens: number, totalPages: number): string | undefined {
  const { MAX_PAGE, DEFAULT_PAGE_SIZE } = PAGINATION_CONFIG;
  if (totalPages <= MAX_PAGE) {
    return undefined;
  }
  // A larger budget never gives more pages, so the smallest that gives few
  // enough can be found by halving.
  let enough: number | undefined;
  let low = maxTokens + 1;
  let high: number = TOKEN_CONFIG.MAX_TOKENS_LIMIT;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (pageStarts(costs, mid, DEFAULT_PAGE_SIZE).length <= MAX_PAGE) {
      enough = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }
  const over = `At \`maxTokens: ${String(maxTokens)}\` this table of contents needs ${String(totalPages)} pages, ` +
    `but \`page\` stops at ${String(MAX_PAGE)}, so the entries after page ${String(MAX_PAGE)} cannot be reached at this budget.`;
  return enough !== undefined
    ? `${over} Repeat with \`maxTokens: ${String(enough)}\` or more to page through all of it.`
    : `${over} Not even \`maxTokens: ${String(TOKEN_CONFIG.MAX_TOKENS_LIMIT)}\` fits it in ${String(MAX_PAGE)} pages.`;
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
 *
 * A top-level entry that costs more than `maxTokens` on its own gets a page to
 * itself, cut to the entries of its subtree that fit, in document order. That
 * page is the only one with `tokenInfo.truncated`, and `truncatedEntry` says
 * what was cut and what budget shows it whole. Skipping it instead would put
 * it on no page, which is the defect this replaced.
 *
 * `hasNext` stops at the last page `page` accepts (`PAGINATION_CONFIG.MAX_PAGE`)
 * even when the budget makes more, and `paginationNote` then names a
 * `maxTokens` that fits the tree in pages it can ask for.
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
    pagesPastTheLastNote(costs, maxTokens, totalPages),
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
