/**
 * Every top-level entry of a table of contents is on some page, at any
 * `maxTokens` the schema accepts.
 *
 * Until 2026-09-26 `paginateTocEntries` cut a page of 10 top-level entries and
 * then dropped whatever of that page did not fit `maxTokens`. Page N+1 still
 * began at entry 10·N, so what the cut dropped was on no page at all. Offline,
 * 25 entries of 97–98 tokens at `maxTokens: 500` reached 15; live, Jamf Pro
 * reached 6 of its 20 at 1000, 1 at 100, and 17 at the default 5000. And the
 * notice under each cut page advised the `page` parameter, which could not
 * reach them.
 *
 * Pages are now cut to the budget as they are walked: each holds as many
 * whole top-level entries as fit, at most 10, and the next page starts at the
 * first one that did not. These tests walk every page at many budgets and
 * check the walk against the tree, not against a count.
 */

import { describe, it, expect } from 'vitest';

import { paginateTocEntries, tocEntryToString, countTocEntries } from '../../../src/core/services/toc-helpers.js';
import { estimateTokens } from '../../../src/core/services/tokenizer.js';
import { PAGINATION_CONFIG, TOKEN_CONFIG } from '../../../src/core/constants.js';
import type { TocEntry } from '../../../src/core/types.js';
import { JAMF_PRO_ROOT_COSTS, tocRootsCosting } from '../../helpers/toc-costs.js';

const cost = (entry: TocEntry): number => estimateTokens(tocEntryToString(entry));

/** The first `count` lines of an entry's printout, as `tocEntryToString` prints them. */
function firstLines(entry: TocEntry, count: number): string {
  const lines = tocEntryToString(entry).split('\n').slice(0, -1);
  return `${lines.slice(0, count).join('\n')}\n`;
}

/** A tree in document order: each entry's own fields, and how deep it sits. */
function documentOrder(entry: TocEntry, depth = 0): Record<string, unknown>[] {
  const { children, ...fields } = entry;
  return [{ ...fields, depth }, ...(children ?? []).flatMap(child => documentOrder(child, depth + 1))];
}

/** How many entries of a tree carry a `children` list with nothing in it. */
function emptyChildLists(entry: TocEntry): number {
  const own = entry.children?.length === 0 ? 1 : 0;
  return own + (entry.children ?? []).reduce((sum, child) => sum + emptyChildLists(child), 0);
}

/** A fixed-seed generator, so a failure names a tree that can be rebuilt. */
function seeded(seed: number): (n: number) => number {
  let state = seed;
  return (n: number): number => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state % n;
  };
}

/** Title words, some with the characters markdown escapes, some not ASCII. */
const WORDS = ['Managing', 'Computers', '*Macs*', '[beta]', 'Enrollment', 'Über', '設定', 'a_b', 'Self Service'];

/**
 * A random subtree up to `levels` deep. Leaves have no `children` key, as
 * Jamf's do once transformed; wide and deep ones are rare but come up.
 */
function randomEntry(random: (n: number) => number, levels: number, path: string): TocEntry {
  const words = Array.from({ length: 1 + random(6) }, () => WORDS[random(WORDS.length)]);
  const entry: TocEntry = { title: `${words.join(' ')} ${path}`, url: `https://example.test/${path}` };
  const fanOut = levels > 0 && random(3) !== 0 ? random(7) : 0;
  return fanOut === 0
    ? entry
    : { ...entry, children: Array.from({ length: fanOut }, (_, i) => randomEntry(random, levels - 1, `${path}.${String(i)}`)) };
}

/** Pages 1..totalPages at one budget, as a client paging through would get them. */
function walk(entries: TocEntry[], maxTokens: number): ReturnType<typeof paginateTocEntries>[] {
  const first = paginateTocEntries(entries, 1, maxTokens);
  const pages = [first];
  for (let page = 2; page <= first.pagination.totalPages; page++) {
    pages.push(paginateTocEntries(entries, page, maxTokens));
  }
  return pages;
}

/**
 * Everything a walk must satisfy, whatever the tree and the budget.
 *
 * Asserted as one function so every fixture below is held to all of it: a
 * reachability check alone would pass a paginator that put every entry on a
 * page of its own, and a budget check alone would pass the one this replaced.
 */
function expectAWalkThatReachesEveryRoot(entries: TocEntry[], maxTokens: number): void {
  const pages = walk(entries, maxTokens);
  const label = `maxTokens ${String(maxTokens)}`;
  const totalPages = pages[0]?.pagination.totalPages ?? 0;
  // Every walk here fits in the pages `page` accepts; the case past that is
  // tested on its own below.
  expect(totalPages).toBeLessThanOrEqual(PAGINATION_CONFIG.MAX_PAGE);

  // Every top-level entry, once, in document order.
  const seen = pages.flatMap(p => p.toc.map(e => e.url));
  expect(seen, label).toEqual(entries.map(e => e.url));

  let next = 0;
  pages.forEach((p, i) => {
    const page = i + 1;
    expect(p.pagination, `${label} page ${String(page)}`).toEqual({
      page,
      pageSize: PAGINATION_CONFIG.DEFAULT_PAGE_SIZE,
      totalPages,
      totalItems: countTocEntries(entries),
      hasNext: page < totalPages,
      hasPrev: page > 1,
    });
    expect(p.paginationNote).toBeUndefined();
    expect(p.toc.length).toBeGreaterThanOrEqual(1);
    expect(p.toc.length).toBeLessThanOrEqual(PAGINATION_CONFIG.DEFAULT_PAGE_SIZE);
    expect(p.tokenInfo.maxTokens).toBe(maxTokens);
    expect(p.tokenInfo.tokenCount, `${label} page ${String(page)}`).toBeLessThanOrEqual(maxTokens);

    const originals = entries.slice(next, next + p.toc.length);
    const [original] = originals;
    const oversized = p.toc.length === 1 && cost(original) > maxTokens;
    if (oversized) {
      // Alone on its page, cut to fit, and said so.
      const [shown] = p.toc;
      const shownEntries = countTocEntries([shown]);
      expect(p.tokenInfo.truncated).toBe(true);
      expect(p.tokenInfo.tokenCount).toBe(cost(shown));
      expect(p.truncatedEntry).toEqual({
        title: original.title,
        shownEntries,
        totalEntries: countTocEntries([original]),
        estimatedTokens: cost(original),
      });
      // The longest document-order prefix that fits: the first lines of the
      // whole entry's printout, each entry with every field it had, and one
      // more line would not have fitted.
      expect(tocEntryToString(shown)).toBe(firstLines(original, shownEntries));
      expect(documentOrder(shown)).toEqual(documentOrder(original).slice(0, shownEntries));
      expect(shownEntries).toBeLessThan(countTocEntries([original]));
      expect(estimateTokens(firstLines(original, shownEntries + 1)), `${label} page ${String(page)}`)
        .toBeGreaterThan(maxTokens);
      // An entry with nothing kept under it is a leaf, not an empty list.
      expect(emptyChildLists(shown)).toBe(0);
    } else {
      // Whole entries, charged what they cost.
      expect(p.toc).toEqual(originals);
      expect(p.tokenInfo.truncated).toBe(false);
      expect(p.truncatedEntry).toBeUndefined();
      expect(p.tokenInfo.tokenCount).toBe(originals.reduce((sum, e) => sum + cost(e), 0));
    }

    // No page ends early: the entry after it did not fit beside the whole
    // entries before it, or the page was full.
    const following = entries.at(next + p.toc.length);
    if (following !== undefined && p.toc.length < PAGINATION_CONFIG.DEFAULT_PAGE_SIZE) {
      const whole = originals.reduce((sum, e) => sum + cost(e), 0);
      expect(whole + cost(following), `${label} page ${String(page)}`).toBeGreaterThan(maxTokens);
    }
    next += p.toc.length;
  });
}

/** Budgets across the whole accepted range, and either side of the costs used below. */
const BUDGETS = [
  TOKEN_CONFIG.MIN_TOKENS, 101, 150, 196, 197, 250, 390, 391, 500, 757, 758, 1000,
  2000, 2365, 2366, TOKEN_CONFIG.DEFAULT_MAX_TOKENS, 20000, TOKEN_CONFIG.MAX_TOKENS_LIMIT,
];

describe('every top-level entry is on some page', () => {
  it('reaches all 25 entries of 97-98 tokens, where the 10-entry cut reached 15 at 500', () => {
    const entries = tocRootsCosting(Array.from({ length: 25 }, (_, i) => (i % 2 === 0 ? 97 : 98)));
    for (const maxTokens of BUDGETS) {
      expectAWalkThatReachesEveryRoot(entries, maxTokens);
    }
    // The case the review measured: five a page, all 25 on five pages.
    const pages = walk(entries, 500);
    expect(pages.map(p => p.toc.length)).toEqual([5, 5, 5, 5, 5]);
  });

  it('reaches all 20 of Jamf Pro\'s top-level entries at every budget, as priced live', () => {
    const entries = tocRootsCosting(JAMF_PRO_ROOT_COSTS);
    for (const maxTokens of BUDGETS) {
      expectAWalkThatReachesEveryRoot(entries, maxTokens);
    }
    // Live before 2026-09-26, 1000 gave 4 then 2 entries on 2 pages: 6 of 20.
    expect(walk(entries, 1000).map(p => p.toc.length)).toEqual([4, 1, 1, 4, 2, 1, 1, 3, 3]);
    // At 50000 nothing changes: two full pages of 10, as before.
    expect(walk(entries, 50000).map(p => p.toc.length)).toEqual([10, 10]);
  });

  it('holds for random one-level trees at random budgets', () => {
    const random = seeded(0x5eed);
    for (let round = 0; round < 300; round++) {
      const roots = 1 + random(45);
      // Mostly small entries, some far over any small budget.
      const costs = Array.from({ length: roots }, () => (random(5) === 0 ? 100 + random(3000) : 3 + random(120)));
      const entries = tocRootsCosting(costs);
      const maxTokens = TOKEN_CONFIG.MIN_TOKENS + random(4000);
      expectAWalkThatReachesEveryRoot(entries, maxTokens);
    }
  });

  it('holds for random trees up to six levels deep, so cuts land at any depth', () => {
    const random = seeded(0xdee9);
    let cuts = 0;
    for (let round = 0; round < 300; round++) {
      const entries = Array.from({ length: 1 + random(40) }, (_, i) => randomEntry(random, 1 + random(6), String(i)));
      // Half the budgets small, so most large entries are cut somewhere inside.
      const maxTokens = TOKEN_CONFIG.MIN_TOKENS + random(random(2) === 0 ? 300 : 4000);
      expectAWalkThatReachesEveryRoot(entries, maxTokens);
      cuts += walk(entries, maxTokens).filter(p => p.tokenInfo.truncated).length;
    }
    // Enough cuts that the checks on a cut page ran many times over.
    expect(cuts).toBeGreaterThan(100);
  });

  it('never needs more pages for a larger budget', () => {
    // What lets the note for too many pages find the smallest budget that
    // fits by halving.
    const random = seeded(0xb0d9e7);
    for (let round = 0; round < 100; round++) {
      const entries = Array.from({ length: 1 + random(40) }, (_, i) => randomEntry(random, 1 + random(4), String(i)));
      let previous = Number.POSITIVE_INFINITY;
      for (let maxTokens: number = TOKEN_CONFIG.MIN_TOKENS; maxTokens <= 3000; maxTokens += 1 + random(150)) {
        const { totalPages } = paginateTocEntries(entries, 1, maxTokens).pagination;
        expect(totalPages).toBeLessThanOrEqual(previous);
        previous = totalPages;
      }
    }
  });

  it('needs at most one page per top-level entry, so 40, the most Jamf publishes, fit in page\'s range', () => {
    // A page always holds at least one top-level entry, so the most pages a
    // tree can need is its count of top-level entries, reached when each is
    // over budget. 40 is the most any en-US Fluid Topics publication has
    // (jamf-pro-release-notes-videos, live 2026-09-26), and 40 < 100.
    const entries = tocRootsCosting(Array.from({ length: 40 }, () => 500));
    const pages = walk(entries, TOKEN_CONFIG.MIN_TOKENS);
    expect(pages).toHaveLength(entries.length);
    expect(pages.every(p => p.toc.length === 1)).toBe(true);
  });
});

describe('a budget that needs more pages than page accepts', () => {
  // 150 top-level entries of 60 tokens: one to a page below 120, two from 120.
  const entries = tocRootsCosting(Array.from({ length: 150 }, () => 60));
  const note = 'At `maxTokens: 100` this table of contents needs 150 pages, but `page` stops at 100, ' +
    'so the entries after page 100 cannot be reached at this budget. ' +
    'Repeat with `maxTokens: 120` or more to page through all of it.';

  it('offers no next page on the last page page accepts, and says what budget reaches the rest', () => {
    const last = paginateTocEntries(entries, PAGINATION_CONFIG.MAX_PAGE, 100);
    expect(last.pagination).toMatchObject({ page: 100, totalPages: 150, hasNext: false, hasPrev: true });
    expect(last.paginationNote).toBe(note);

    // Every page says so, so a client learns it before it has paged that far.
    const first = paginateTocEntries(entries, 1, 100);
    expect(first.pagination.hasNext).toBe(true);
    expect(first.paginationNote).toBe(note);
    expect(paginateTocEntries(entries, 99, 100).pagination.hasNext).toBe(true);
  });

  it('names the smallest budget that fits, which reaches every entry', () => {
    expect(paginateTocEntries(entries, 1, 119).pagination.totalPages).toBe(150);
    expect(walk(entries, 120)).toHaveLength(75);
    expectAWalkThatReachesEveryRoot(entries, 120);
  });

  it('names the smallest budget that fits in exactly 100 pages, and says nothing at it', () => {
    // 101 entries; the first two share a page from 111 tokens, and no two
    // others do below 120.
    const edge = tocRootsCosting([55, 56, ...Array.from({ length: 99 }, () => 60)]);
    expect(paginateTocEntries(edge, 1, 100).paginationNote).toContain('Repeat with `maxTokens: 111` or more');

    const fits = paginateTocEntries(edge, 100, 111);
    expect(fits.pagination).toMatchObject({ page: 100, totalPages: 100, hasNext: false });
    expect(fits.paginationNote).toBeUndefined();
  });

  it('says so when no budget fits the tree in page\'s range', () => {
    // Ten to a page at most, so 1010 top-level entries need 101 pages at any
    // budget.
    const many = tocRootsCosting(Array.from({ length: 1010 }, () => 3));
    const result = paginateTocEntries(many, 1, TOKEN_CONFIG.DEFAULT_MAX_TOKENS);
    expect(result.pagination.totalPages).toBe(101);
    expect(result.paginationNote).toBe(
      'At `maxTokens: 5000` this table of contents needs 101 pages, but `page` stops at 100, ' +
      'so the entries after page 100 cannot be reached at this budget. ' +
      'Not even `maxTokens: 50000` fits it in 100 pages.',
    );
    expect(paginateTocEntries(many, 100, TOKEN_CONFIG.DEFAULT_MAX_TOKENS).pagination.hasNext).toBe(false);
  });
});

describe('a top-level entry too large for maxTokens on its own', () => {
  /** A root with nested sections, so a cut can land at any depth. */
  const big: TocEntry = {
    title: 'Managing Computers',
    url: 'https://example.test/managing-computers',
    children: Array.from({ length: 6 }, (_section, i) => ({
      title: `Section ${String(i)} with a title long enough to cost a few tokens`,
      url: `https://example.test/section-${String(i)}`,
      children: Array.from({ length: 4 }, (_topic, j) => ({
        title: `Topic ${String(i)}.${String(j)} with a similarly long title`,
        url: `https://example.test/topic-${String(i)}-${String(j)}`,
      })),
    })),
  };
  const small = (n: number): TocEntry => ({ title: `Small ${String(n)}`, url: `https://example.test/small-${String(n)}` });
  const entries = [small(0), big, small(1)];

  it('gets a page of its own, cut to a prefix of its subtree that fits', () => {
    expect(cost(big)).toBeGreaterThan(TOKEN_CONFIG.MIN_TOKENS);
    const pages = walk(entries, TOKEN_CONFIG.MIN_TOKENS);

    expect(pages.map(p => p.toc.map(e => e.title))).toEqual([['Small 0'], ['Managing Computers'], ['Small 1']]);
    const [, cut] = pages as [unknown, ReturnType<typeof paginateTocEntries>];
    expect(cut.tokenInfo.truncated).toBe(true);
    expect(cut.tokenInfo.tokenCount).toBeLessThanOrEqual(TOKEN_CONFIG.MIN_TOKENS);

    // A document-order prefix: printed, it is the start of the whole root's
    // printout, line for line, and one more line would not have fitted.
    const whole = tocEntryToString(big).split('\n');
    const shown = tocEntryToString(cut.toc[0]).split('\n');
    expect(whole.slice(0, shown.length - 1)).toEqual(shown.slice(0, -1));
    const oneMore = `${whole.slice(0, shown.length).join('\n')}\n`;
    expect(estimateTokens(oneMore)).toBeGreaterThan(TOKEN_CONFIG.MIN_TOKENS);

    expect(cut.truncatedEntry).toEqual({
      title: 'Managing Computers',
      shownEntries: shown.length - 1,
      totalEntries: 31,
      estimatedTokens: cost(big),
    });
  });

  it('keeps every field of the entries it shows', () => {
    const withIds: TocEntry = {
      ...big,
      contentId: 'mc',
      tocId: 'mc-toc',
      children: (big.children ?? []).map((c, i) => ({ ...c, contentId: `c${String(i)}`, tocId: `t${String(i)}` })),
    };
    const [page] = walk([withIds], 150);
    const shown = page.toc[0];
    expect(shown.contentId).toBe('mc');
    expect(shown.tocId).toBe('mc-toc');
    expect(shown.children?.[0].contentId).toBe('c0');
  });

  it('is shown whole, over budget, when it has nothing under it to cut', () => {
    // A title alone over the smallest budget is ~400 characters; none of
    // Jamf's comes close, but a page must still reach it.
    const leaf: TocEntry = { title: 'x'.repeat(500), url: 'https://example.test/leaf' };
    const pages = walk([small(0), leaf, small(1)], TOKEN_CONFIG.MIN_TOKENS);

    expect(pages.map(p => p.toc)).toEqual([[small(0)], [leaf], [small(1)]]);
    expect(pages[1].tokenInfo).toEqual({ tokenCount: cost(leaf), truncated: false, maxTokens: TOKEN_CONFIG.MIN_TOKENS });
    expect(pages[1].truncatedEntry).toBeUndefined();
  });

  it('keeps a prefix that costs exactly maxTokens', () => {
    // Printed, the first 20 entries cost this much and the first 21 more.
    const exact = estimateTokens(firstLines(big, 20));
    expect(estimateTokens(firstLines(big, 21))).toBeGreaterThan(exact);
    const [page] = walk([big], exact);
    expect(page.tokenInfo.tokenCount).toBe(exact);
    expect(page.truncatedEntry?.shownEntries).toBe(20);
  });

  it('leaves out only the last line when only the last line does not fit', () => {
    const total = countTocEntries([big]);
    const [page] = walk([big], estimateTokens(firstLines(big, total - 1)));
    expect(page.truncatedEntry?.shownEntries).toBe(total - 1);
  });

  it('is cut to the longest prefix that fits at every budget below its cost', () => {
    for (let maxTokens = TOKEN_CONFIG.MIN_TOKENS; maxTokens < cost(big); maxTokens++) {
      expectAWalkThatReachesEveryRoot(entries, maxTokens);
    }
  });

  it('is whole at the maxTokens it reports, and cut one token below it', () => {
    const [, cut] = walk(entries, TOKEN_CONFIG.MIN_TOKENS);
    const needed = cut.truncatedEntry?.estimatedTokens ?? 0;

    const atFigure = walk(entries, needed).flatMap(p => p.toc);
    expect(atFigure.find(e => e.title === 'Managing Computers')).toEqual(big);

    const below = walk(entries, needed - 1).find(p => p.toc.some(e => e.title === 'Managing Computers'));
    expect(below?.tokenInfo.truncated).toBe(true);
  });
});

describe('what does not change', () => {
  it('an empty table of contents is one empty page, as before', () => {
    const result = paginateTocEntries([], 1, 5000);
    expect(result.toc).toEqual([]);
    expect(result.pagination).toEqual({
      page: 1, pageSize: 10, totalPages: 0, totalItems: 0, hasNext: false, hasPrev: false,
    });
    expect(result.tokenInfo).toEqual({ tokenCount: 0, truncated: false, maxTokens: 5000 });
  });

  it('a page past the end is clamped to the last page, and says so', () => {
    const entries = tocRootsCosting(JAMF_PRO_ROOT_COSTS);
    const last = walk(entries, 1000).at(-1);
    const clamped = paginateTocEntries(entries, 50, 1000);
    expect(clamped.toc).toEqual(last?.toc);
    expect(clamped.pagination.page).toBe(last?.pagination.page);
    expect(clamped.paginationNote).toBe(
      `Note: Requested page 50 exceeds total pages (${String(last?.pagination.totalPages)}). Showing last page.`,
    );
  });

  it('a tree that fits in ten-entry pages is paged exactly as before', () => {
    // 15 small entries at the default budget: 10 then 5, as the fixed-size
    // pages always gave.
    const entries = tocRootsCosting(Array.from({ length: 15 }, () => 5));
    expect(walk(entries, 5000).map(p => p.toc.length)).toEqual([10, 5]);
  });
});
