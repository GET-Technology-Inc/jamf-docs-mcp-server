/**
 * Every result of a search is on exactly one page, whatever `maxTokens` and
 * `limit` are: the real `searchDocumentation`, on the Fluid Topics path and on
 * the SearchProvider path, with only the backends stubbed.
 *
 * Until 2026-09-28 a page was `limit` results cut to `maxTokens` afterwards
 * (`truncateSearchResults`), and page N+1 still began at result `limit`·N, so
 * a result the cut dropped was on no page. `truncatedContent` listed it as
 * "omitted due to token limit", and the footer advised `page`, which could
 * not reach it. Live on 2026-09-28, paging `query: "enrollment"` (50 results)
 * reached 45 of them at the default budget with `limit: 50`, 42 at
 * `maxTokens: 1000` with the default `limit: 10`, and none at 100: every page
 * came back empty.
 *
 * Each walk is held to one invariant: every result once, in rank order; the
 * pagination fields true on every page; each page within budget, whole
 * results only, except one result larger than `maxTokens` on its own, alone
 * on its page with its snippet cut to the longest start that fits; and no page
 * ending before the budget or `limit` does.
 */

import { describe, it, expect } from 'vitest';
import { searchDocumentation } from '../../../src/core/services/search-service.js';
import { titleProductSnippet } from '../../../src/core/services/snippet.js';
import { PAGINATION_CONFIG, TOKEN_CONFIG } from '../../../src/core/constants.js';
import type { SearchDocumentationResult, SearchParams, SearchResult } from '../../../src/core/types.js';
import type { ServerContext } from '../../../src/core/types/context.js';
import { searchUpstream } from '../../helpers/search-upstream.js';
import {
  ENROLLMENT_COSTS,
  fieldsCosting,
  ftEntriesCosting,
  providerResultsCosting,
  resultCost,
  seededCosts,
} from '../../helpers/search-costs.js';

type Whole = Pick<SearchResult, 'title' | 'url' | 'snippet'>;
type Backend = 'fluid-topics' | 'provider';

/** A harness answering every search with results of these costs. */
function backendCosting(backend: Backend, costs: readonly number[]): ReturnType<typeof searchUpstream> {
  return backend === 'provider'
    ? searchUpstream({ provider: providerResultsCosting(costs) })
    : searchUpstream({ clusteredSearch: () => ftEntriesCosting(costs) });
}

type PageArgs = Omit<SearchParams, 'query' | 'page'>;

/** Page 1 onwards until `hasNext` is false, each asked for as the first was. */
async function walkOn(ctx: ServerContext, args: PageArgs): Promise<SearchDocumentationResult[]> {
  const pages: SearchDocumentationResult[] = [];
  for (let page = 1; ; page++) {
    const result = await searchDocumentation(ctx, { query: 'enrollment', page, ...args });
    expect(result.searchError).toBeUndefined();
    pages.push(result);
    if (!result.pagination.hasNext) { return pages; }
    expect(page).toBeLessThan(PAGINATION_CONFIG.MAX_PAGE);
  }
}

/** {@link walkOn} a backend answering with results of these costs. */
async function walk(backend: Backend, costs: readonly number[], args: PageArgs): Promise<SearchDocumentationResult[]> {
  return await walkOn(backendCosting(backend, costs).ctx, args);
}

/**
 * The snippet a cut result shows is `whole.slice(0, n).trimEnd()` and `…`, for
 * the largest `n` that fits; returns that `n`.
 */
function keptLength(whole: string, shown: string): number {
  expect(shown.endsWith('…')).toBe(true);
  const kept = shown.slice(0, -1);
  expect(whole.startsWith(kept)).toBe(true);
  let n = kept.length;
  while (n < whole.length && /\s/.test(whole.charAt(n))) { n++; }
  return n;
}

function expectPages(
  pages: SearchDocumentationResult[],
  whole: Whole[],
  limit: number,
  maxTokens: number,
): void {
  const costs = whole.map(resultCost);

  // Every result once, in rank order.
  expect(pages.flatMap(p => p.results.map(r => r.url))).toEqual(whole.map(w => w.url));

  let index = 0;
  pages.forEach((p, i) => {
    const at = `page ${String(i + 1)} of ${String(pages.length)} at maxTokens ${String(maxTokens)}, limit ${String(limit)}`;
    expect(p.pagination, at).toEqual({
      page: i + 1,
      pageSize: limit,
      totalPages: pages.length,
      totalItems: whole.length,
      hasNext: i + 1 < pages.length,
      hasPrev: i > 0,
    });
    expect(p.truncatedContent, at).toBeUndefined();
    expect(p.paginationNote, at).toBeUndefined();
    expect(p.results.length, at).toBeGreaterThan(0);
    expect(p.results.length, at).toBeLessThanOrEqual(limit);

    const shown = whole.slice(index, index + p.results.length);
    const cost = costs.slice(index, index + p.results.length).reduce((sum, c) => sum + c, 0);

    if (p.truncatedResult === undefined) {
      // Whole results, uncut, within budget.
      expect(p.results.map(r => r.snippet), at).toEqual(shown.map(w => w.snippet));
      expect(p.tokenInfo, at).toEqual({ tokenCount: cost, truncated: false, maxTokens });
      expect(cost, at).toBeLessThanOrEqual(maxTokens);
    } else {
      // One result larger than the budget on its own, alone, and cut.
      const [result] = p.results;
      const [original] = shown;
      expect(p.results, at).toHaveLength(1);
      expect(cost, at).toBeGreaterThan(maxTokens);
      expect(p.truncatedResult, at).toEqual({ title: original.title, estimatedTokens: cost });
      expect(result.title, at).toBe(original.title);
      expect(result.url, at).toBe(original.url);
      expect(p.tokenInfo, at).toEqual({ tokenCount: resultCost(result), truncated: true, maxTokens });
      expect(p.tokenInfo.tokenCount, at).toBeLessThanOrEqual(maxTokens);
      // Ended with the ellipsis, not with the space the cut fell after.
      expect(result.snippet, at).not.toMatch(/\s…$/);
      // The longest start of the snippet that fits: one character more does not.
      const n = keptLength(original.snippet, result.snippet);
      expect(n, at).toBeLessThan(original.snippet.length);
      const longer = `${original.snippet.slice(0, n + 1).trimEnd()}…`;
      expect(resultCost({ ...result, snippet: longer }), at).toBeGreaterThan(maxTokens);
    }

    // No page ends while the next result would still fit and there is room.
    const next = index + p.results.length;
    if (next < costs.length && p.results.length < limit && p.truncatedResult === undefined) {
      expect(cost + costs[next], at).toBeGreaterThan(maxTokens);
    }
    index += p.results.length;
  });
}

const wholeOf = (costs: readonly number[]): Whole[] => costs.map((c, i) => fieldsCosting(i, c));

describe('paging a search reaches every result', () => {
  const BUDGETS = [100, 101, 114, 115, 150, 200, 300, 500, 1000, 2000, 5000, 50000];

  describe.each(['fluid-topics', 'provider'] as const)('on the %s path', (backend) => {
    it.each(BUDGETS)('the 50 live "enrollment" results at maxTokens %i, 10 to a page at most', async (maxTokens) => {
      const pages = await walk(backend, ENROLLMENT_COSTS, { maxTokens });
      expectPages(pages, wholeOf(ENROLLMENT_COSTS), 10, maxTokens);
    });

    it.each(BUDGETS)('the 50 live "enrollment" results at maxTokens %i, 50 to a page at most', async (maxTokens) => {
      const pages = await walk(backend, ENROLLMENT_COSTS, { maxTokens, limit: 50 });
      expectPages(pages, wholeOf(ENROLLMENT_COSTS), 50, maxTokens);
    });

    it('one result to a page', async () => {
      const pages = await walk(backend, ENROLLMENT_COSTS, { maxTokens: 5000, limit: 1 });
      expect(pages).toHaveLength(50);
      expectPages(pages, wholeOf(ENROLLMENT_COSTS), 1, 5000);
    });
  });

  it('holds for 150 seeded result sets at seeded budgets and limits, on both paths', async () => {
    for (let seed = 1; seed <= 150; seed++) {
      const [count, limit, maxTokens] = seededCosts(seed * 7919, 3, 0, 1_000_000);
      const costs = seededCosts(seed, 1 + (count % 50), 40, 400);
      const shape = { limit: 1 + (limit % 50), maxTokens: 100 + (maxTokens % 2000) };
      const backend: Backend = seed % 2 === 0 ? 'provider' : 'fluid-topics';
      const pages = await walk(backend, costs, shape);
      expectPages(pages, wholeOf(costs), shape.limit, shape.maxTokens);
    }
  });

  it('says where each page starts, for numbering results across pages', async () => {
    const pages = await walk('fluid-topics', ENROLLMENT_COSTS, { maxTokens: 1000 });
    let index = 0;
    for (const p of pages) {
      expect(p.offset).toBe(index);
      index += p.results.length;
    }
    expect(index).toBe(50);
  });

  it('never needs more pages at a larger budget', async () => {
    let before = Number.POSITIVE_INFINITY;
    for (const maxTokens of [100, 120, 200, 229, 230, 400, 1000, 5000]) {
      const pages = await walk('fluid-topics', ENROLLMENT_COSTS, { maxTokens });
      expect(pages.length).toBeLessThanOrEqual(before);
      before = pages.length;
    }
  });
});

describe('results shown under the product searched for', () => {
  it('are priced as shown, after a stand-in snippet is rebuilt with the longer name', async () => {
    // A SearchProvider result with no snippet of its own gets a stand-in: its
    // title and its product, "… — Jamf Reset". Searched as jamf-setup-reset,
    // it is shown as "Jamf Setup and Reset", and the stand-in is rebuilt with
    // that name, 10 characters longer. A page is cut to what it shows, so it
    // is priced after that, or a page could run over `maxTokens` and
    // `tokenCount` would not be what it shows.
    const results: SearchResult[] = Array.from({ length: 30 }, (_, i) => {
      const title = `Reset step ${String(i + 1)} ${'w'.repeat(20 + (i * 7) % 30)}`;
      return {
        title,
        url: `https://learn.jamf.com/r/en-US/jamf-setup-reset-configuration-guide/Step_${String(i + 1)}`,
        snippet: titleProductSnippet(title, 'Jamf Reset'),
        product: 'Jamf Reset',
      };
    });
    const shown = results.map(r => ({ ...r, snippet: titleProductSnippet(r.title, 'Jamf Setup and Reset') }));
    const { ctx } = searchUpstream({ provider: results });

    for (const maxTokens of [100, 101, 150, 200, 250, 500]) {
      for (const limit of [3, 10]) {
        const pages = await walkOn(ctx, { product: 'jamf-setup-reset', limit, maxTokens });
        expect(pages[0].filterRelaxation).toBeUndefined();
        expect(pages.flatMap(p => p.results.map(r => r.product))).toEqual(shown.map(() => 'Jamf Setup and Reset'));
        expectPages(pages, shown, limit, maxTokens);
      }
    }
  });
});

describe('what does not change', () => {
  it('pages results that fit ten to a page as before: page N is results 10(N-1)+1 to 10N', async () => {
    const pages = await walk('fluid-topics', ENROLLMENT_COSTS, {});
    const urls = wholeOf(ENROLLMENT_COSTS).map(w => w.url);
    expect(pages).toHaveLength(5);
    pages.forEach((p, i) => {
      expect(p.results.map(r => r.url)).toEqual(urls.slice(i * 10, i * 10 + 10));
      expect(p.tokenInfo.truncated).toBe(false);
    });
  });

  it('clamps a page past the end to the last page, and says so', async () => {
    const { ctx } = backendCosting('fluid-topics', ENROLLMENT_COSTS);
    const last = await searchDocumentation(ctx, { query: 'enrollment', page: 99, maxTokens: 1000 });
    // At 1000 the pages start at results 1, 9, 18, 26, 35 and 44.
    expect(last.pagination).toMatchObject({ page: 6, totalPages: 6, hasNext: false, hasPrev: true });
    expect(last.paginationNote).toBe('Note: Requested page 99 exceeds total pages (6). Showing last page.');
    expect(last.results.map(r => r.url)).toEqual(wholeOf(ENROLLMENT_COSTS).slice(43).map(w => w.url));
  });

  it('answers a search with no results with one empty page', async () => {
    const { ctx } = backendCosting('fluid-topics', []);
    const result = await searchDocumentation(ctx, { query: 'enrollment', maxTokens: 100 });
    expect(result.results).toEqual([]);
    expect(result.pagination).toEqual({
      page: 1, pageSize: 10, totalPages: 0, totalItems: 0, hasNext: false, hasPrev: false,
    });
    expect(result.tokenInfo).toEqual({ tokenCount: 0, truncated: false, maxTokens: 100 });
    expect(result.truncatedResult).toBeUndefined();
  });
});

describe('a result larger than maxTokens on its own', () => {
  it('is cut at a character, never inside one', async () => {
    const snippet = 'Configure the 設定 for 🍎 devices. '.repeat(40);
    const result: SearchResult = {
      title: 'Wide characters', url: 'https://learn.jamf.com/r/en-US/x/Wide', snippet, product: 'Jamf Pro',
    };
    const { ctx } = searchUpstream({ provider: [result] });
    for (let maxTokens = 100; maxTokens < resultCost(result); maxTokens += 7) {
      const page = await searchDocumentation(ctx, { query: 'wide', maxTokens });
      const [shown] = page.results;
      expect(page.truncatedResult).toEqual({ title: 'Wide characters', estimatedTokens: resultCost(result) });
      // No lone surrogate: every code point of the cut is one of the original's.
      expect(shown.snippet).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
      expect(snippet.startsWith(shown.snippet.slice(0, -1))).toBe(true);
      expect(shown.snippet).not.toMatch(/\s…$/);
      expect(page.tokenInfo.tokenCount).toBeLessThanOrEqual(maxTokens);
    }
  });

  it('keeps all but the last character when only that must go', async () => {
    // `…` is one UTF-16 unit and 🍎 two, so leaving out the last character
    // alone saves one: with the whole result at 4k+1 units, that is a token.
    const title = 'Last character';
    const url = 'https://learn.jamf.com/r/en-US/x/Last';
    const units = (n: number): number => title.length + url.length + 2 + n + 2;
    let n = 400;
    while (units(n) % 4 !== 1) { n++; }
    const result: SearchResult = { title, url, snippet: `${'a'.repeat(n)}🍎`, product: 'Jamf Pro' };
    const { ctx } = searchUpstream({ provider: [result] });

    const page = await searchDocumentation(ctx, { query: 'last', maxTokens: resultCost(result) - 1 });

    expect(page.results[0].snippet).toBe(`${'a'.repeat(n)}…`);
    expect(page.tokenInfo).toEqual({ tokenCount: resultCost(result) - 1, truncated: true, maxTokens: resultCost(result) - 1 });
  });

  it('is shown with its title and URL even when they alone are over budget', async () => {
    // Nothing a Jamf source serves comes close: a title and URL of 400
    // characters between them, at the smallest budget.
    const url = `https://learn.jamf.com/r/en-US/x/${'Long_'.repeat(90)}`;
    const result: SearchResult = { title: 'Long address', url, snippet: 'A snippet that cannot fit at all.', product: 'Jamf Pro' };
    const { ctx } = searchUpstream({ provider: [result, providerResultsCosting([50])[0]] });

    const first = await searchDocumentation(ctx, { query: 'long', maxTokens: 100 });

    expect(first.results).toEqual([{ ...result, snippet: '…' }]);
    expect(first.tokenInfo).toEqual({ tokenCount: resultCost({ ...result, snippet: '…' }), truncated: true, maxTokens: 100 });
    expect(first.tokenInfo.tokenCount).toBeGreaterThan(100);
    expect(first.truncatedResult).toEqual({ title: 'Long address', estimatedTokens: resultCost(result) });
    expect(first.pagination).toMatchObject({ page: 1, totalPages: 2, hasNext: true });
  });

  it('with no snippet to cut, is shown whole and not marked cut', async () => {
    const url = `https://learn.jamf.com/r/en-US/x/${'Long_'.repeat(90)}`;
    const result: SearchResult = { title: 'Long address', url, snippet: '', product: 'Jamf Pro' };
    const { ctx } = searchUpstream({ provider: [result] });

    const page = await searchDocumentation(ctx, { query: 'long', maxTokens: 100 });

    expect(page.results).toEqual([result]);
    expect(page.tokenInfo).toEqual({ tokenCount: resultCost(result), truncated: false, maxTokens: 100 });
    expect(page.truncatedResult).toBeUndefined();
  });
});

describe('more pages than `page` accepts', () => {
  const { MAX_PAGE } = PAGINATION_CONFIG;

  it('stops offering a next page at page 100 and names the maxTokens that reaches the rest', async () => {
    // 150 results of 60 tokens: at 100, one to a page; from 120, two.
    const costs = Array.from({ length: 150 }, () => 60);
    const { ctx } = backendCosting('provider', costs);
    const note = 'At `maxTokens: 100` and `limit: 10` these 150 results need 150 pages, but `page` stops at 100, ' +
      'so the results after page 100 cannot be reached this way. ' +
      'Repeat with `maxTokens: 120` or more to page through all of them.';

    const first = await searchDocumentation(ctx, { query: 'q', maxTokens: 100 });
    const penultimate = await searchDocumentation(ctx, { query: 'q', maxTokens: 100, page: MAX_PAGE - 1 });
    const last = await searchDocumentation(ctx, { query: 'q', maxTokens: 100, page: MAX_PAGE });

    expect(first.pagination).toMatchObject({ page: 1, totalPages: 150, hasNext: true });
    expect(first.paginationNote).toBe(note);
    expect(penultimate.pagination).toMatchObject({ page: 99, hasNext: true });
    expect(last.pagination).toMatchObject({ page: 100, totalPages: 150, hasNext: false, hasPrev: true });
    expect(last.paginationNote).toBe(note);

    const pages = await walk('provider', costs, { maxTokens: 120 });
    expectPages(pages, wholeOf(costs), 10, 120);
    expect(pages).toHaveLength(75);
  });

  it('names the budget that makes exactly 100 pages, the most `page` reaches', async () => {
    // 1000 results at 10 a page are 100 pages at any budget that fits ten of
    // them: 600, at 60 tokens each.
    const costs = Array.from({ length: 1000 }, () => 60);
    const { ctx } = backendCosting('provider', costs);

    const first = await searchDocumentation(ctx, { query: 'q', maxTokens: 100 });
    expect(first.paginationNote).toBe(
      'At `maxTokens: 100` and `limit: 10` these 1000 results need 1000 pages, but `page` stops at 100, ' +
      'so the results after page 100 cannot be reached this way. ' +
      'Repeat with `maxTokens: 600` or more to page through all of them.',
    );

    const last = await searchDocumentation(ctx, { query: 'q', maxTokens: 600, page: MAX_PAGE });
    expect(last.pagination).toMatchObject({ page: 100, totalPages: 100, hasNext: false });
    expect(last.paginationNote).toBeUndefined();
    expect(last.offset).toBe(990);
  });

  it('names `limit: 50` too when no budget fits at this limit', async () => {
    // 1200 results need 120 pages at 10 a page, whatever the budget; at 50 a
    // page, 12 of 40 tokens (480) fit them in exactly 100.
    const costs = Array.from({ length: 1200 }, () => 40);
    const { ctx } = backendCosting('provider', costs);

    const first = await searchDocumentation(ctx, { query: 'q', maxTokens: 100 });
    expect(first.paginationNote).toBe(
      'At `maxTokens: 100` and `limit: 10` these 1200 results need 600 pages, but `page` stops at 100, ' +
      'so the results after page 100 cannot be reached this way. ' +
      'Repeat with `limit: 50` and `maxTokens: 480` or more to page through all of them.',
    );

    const edge = await searchDocumentation(ctx, { query: 'q', maxTokens: 480, limit: 50, page: MAX_PAGE });
    expect(edge.pagination).toMatchObject({ page: 100, totalPages: 100, hasNext: false });
    expect(edge.paginationNote).toBeUndefined();
    expect(edge.offset).toBe(1200 - edge.results.length);
    const under = await searchDocumentation(ctx, { query: 'q', maxTokens: 479, limit: 50 });
    expect(under.pagination.totalPages).toBeGreaterThan(MAX_PAGE);
  });

  it('names `limit: 50` alone when this budget already fits at it', async () => {
    const costs = Array.from({ length: 1200 }, () => 40);
    const { ctx } = backendCosting('provider', costs);

    const first = await searchDocumentation(ctx, { query: 'q', maxTokens: 5000, limit: 10 });
    expect(first.paginationNote).toBe(
      'At `maxTokens: 5000` and `limit: 10` these 1200 results need 120 pages, but `page` stops at 100, ' +
      'so the results after page 100 cannot be reached this way. ' +
      'Repeat with `limit: 50` to page through all of them.',
    );
  });

  it('says so when not even the largest limit and budget reach them all', async () => {
    const costs = Array.from({ length: 5001 }, () => 40);
    const { ctx } = backendCosting('provider', costs);

    const first = await searchDocumentation(ctx, { query: 'q', maxTokens: 100, limit: 50 });
    expect(first.pagination).toMatchObject({ totalPages: 2501, hasNext: true });
    expect(first.paginationNote).toBe(
      'At `maxTokens: 100` and `limit: 50` these 5001 results need 2501 pages, but `page` stops at 100, ' +
      'so the results after page 100 cannot be reached this way. ' +
      `Not even \`limit: 50\` and \`maxTokens: ${String(TOKEN_CONFIG.MAX_TOKENS_LIMIT)}\` fit them in 100 pages.`,
    );
  });
});
