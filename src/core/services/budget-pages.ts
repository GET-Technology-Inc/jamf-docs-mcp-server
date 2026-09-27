/**
 * Pages cut to a token budget as they are walked, shared by the table of
 * contents (`paginateTocEntries` in toc-helpers.ts) and the search
 * (`paginateSearchResults` in search-service.ts).
 *
 * Both used to take a page of a fixed number of items and cut it to
 * `maxTokens` afterwards, so an item the cut dropped was on no page. #351
 * replaced that for the TOC on 2026-09-26 and the search followed on
 * 2026-09-28. The walk, the search for the smallest budget that fits and the
 * note for pages past the last one `page` accepts were written once for each;
 * they live here so the two cannot drift apart.
 */

import { PAGINATION_CONFIG, TOKEN_CONFIG } from '../constants.js';

/**
 * Where each page starts, given what each item costs.
 *
 * A page takes its first item whatever it costs, then each following one
 * while it fits the budget and the page holds fewer than `pageSize`. So a page
 * ends at the first item that does not fit, and that item starts the next
 * page. The pages depend on `maxTokens`, `pageSize` and the costs alone, so
 * the same request gives the same pages every time.
 */
export function pageStarts(costs: readonly number[], maxTokens: number, pageSize: number): number[] {
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
 * The smallest `maxTokens`, from `from` up, at which these costs fit in the
 * pages `page` accepts at this page size, or nothing if not even
 * `TOKEN_CONFIG.MAX_TOKENS_LIMIT` does. A larger budget never gives more
 * pages, so it can be found by halving.
 */
export function smallestBudgetFitting(costs: readonly number[], pageSize: number, from: number): number | undefined {
  const { MAX_PAGE } = PAGINATION_CONFIG;
  let high: number = TOKEN_CONFIG.MAX_TOKENS_LIMIT;
  if (from > high || pageStarts(costs, high, pageSize).length > MAX_PAGE) {
    return undefined;
  }
  let low = from;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (pageStarts(costs, mid, pageSize).length <= MAX_PAGE) {
      high = mid;
    } else {
      low = mid + 1;
    }
  }
  return high;
}

/** How a note names what is paged. */
export interface PagedWhole {
  /** The whole, as the subject of "needs N pages": "this table of contents", "these 150 results". */
  name: string;
  /** Whether `name` is plural, for the verb and the pronoun that agree with it. */
  plural: boolean;
  /** What a page holds: "entries", "results". */
  items: string;
}

/** A budget and page size, and how many pages they cut the items into. */
export interface BudgetCut {
  maxTokens: number;
  pageSize: number;
  totalPages: number;
  /**
   * The largest `limit` a caller may ask for, when the page size is the
   * caller's to choose (the search's). Absent when it is fixed (the TOC's).
   */
  widestPageSize?: number;
}

/**
 * The note for a budget and page size whose pages run past the last one
 * `page` accepts, or nothing.
 *
 * `page` stops at `PAGINATION_CONFIG.MAX_PAGE`, and a page holds as many whole
 * items as fit `maxTokens`, at most the page size, so the items on the pages
 * after it are reachable only with a larger budget or page size. The note
 * names the smallest budget that reaches them at this page size, and failing
 * that, when the caller can choose the page size, what does at the widest.
 */
export function pagesPastTheLastNote(costs: readonly number[], cut: BudgetCut, whole: PagedWhole): string | undefined {
  const { MAX_PAGE } = PAGINATION_CONFIG;
  const { MAX_TOKENS_LIMIT } = TOKEN_CONFIG;
  const { maxTokens, pageSize, totalPages, widestPageSize } = cut;
  if (totalPages <= MAX_PAGE) {
    return undefined;
  }
  // When the page size is the caller's too, the budget alone is not what
  // stops it, so the note names both.
  const choosesSize = widestPageSize !== undefined;
  const at = choosesSize
    ? `\`maxTokens: ${String(maxTokens)}\` and \`limit: ${String(pageSize)}\``
    : `\`maxTokens: ${String(maxTokens)}\``;
  const over = `At ${at} ${whole.name} ${whole.plural ? 'need' : 'needs'} ${String(totalPages)} pages, ` +
    `but \`page\` stops at ${String(MAX_PAGE)}, so the ${whole.items} after page ${String(MAX_PAGE)} ` +
    `cannot be reached ${choosesSize ? 'this way' : 'at this budget'}.`;
  const them = whole.plural ? 'them' : 'it';

  const budget = smallestBudgetFitting(costs, pageSize, maxTokens + 1);
  if (budget !== undefined) {
    return `${over} Repeat with \`maxTokens: ${String(budget)}\` or more to page through all of ${them}.`;
  }
  const wide = choosesSize && pageSize < widestPageSize
    ? smallestBudgetFitting(costs, widestPageSize, maxTokens)
    : undefined;
  if (wide !== undefined) {
    const more = wide > maxTokens ? ` and \`maxTokens: ${String(wide)}\` or more` : '';
    return `${over} Repeat with \`limit: ${String(widestPageSize)}\`${more} to page through all of ${them}.`;
  }
  const largest = choosesSize
    ? `\`limit: ${String(widestPageSize)}\` and \`maxTokens: ${String(MAX_TOKENS_LIMIT)}\` fit`
    : `\`maxTokens: ${String(MAX_TOKENS_LIMIT)}\` fits`;
  return `${over} Not even ${largest} ${them} in ${String(MAX_PAGE)} pages.`;
}
