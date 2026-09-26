/**
 * Table-of-contents trees whose top-level entries cost an exact number of
 * tokens.
 *
 * `paginateTocEntries` charges a top-level entry what `estimateTokens` says its
 * whole subtree costs as `tocEntryToString` prints it, so a page is only as
 * predictable as those costs. Building roots to a stated cost is what lets a
 * test replay a shape measured on the live site: the costs of Jamf Pro's 20
 * top-level entries, say, without carrying its 794 titles as a fixture.
 *
 * The cost is met with plain ASCII, one character per quarter token, and no
 * code fences, which `estimateTokens` would charge at a different rate.
 */

import type { FtTocNode, TocEntry } from '../../src/core/types.js';

/**
 * The costs of the 20 top-level entries of Jamf Pro Documentation (en-US,
 * map `A4LI4vM0BILraYeOD89WGg`), in order, as `estimateTokens` prices each
 * subtree. Measured live on 2026-09-26; the tree has 794 entries in all.
 */
export const JAMF_PRO_ROOT_COSTS = [
  7, 178, 11, 67, 758, 963, 183, 447, 122, 148, 621, 48, 2366, 1036, 301, 93, 191, 628, 272, 7,
] as const;

/** A child line is at most this long, newline included. */
const LINE = 48;
/** `  - x\n`, the shortest child line `tocEntryToString` can print. */
const MIN_CHILD_LINE = 6;

/**
 * The titles of one root and its children, such that `tocEntryToString`
 * prints exactly `tokens * 4` characters for the subtree.
 */
function titlesFor(index: number, tokens: number): { title: string; children: string[] } {
  const target = tokens * 4;
  let title = `Root ${String(index)}`;
  // `- <title>\n`
  let rest = target - (title.length + 3);
  if (rest < 0) {
    throw new Error(`A root costs at least ${String(Math.ceil((title.length + 3) / 4))} tokens`);
  }
  // A remainder too short for a child line goes into the root's own title.
  const tail = rest % LINE;
  if (tail > 0 && tail < MIN_CHILD_LINE) {
    title += '.'.repeat(tail);
    rest -= tail;
  }
  const children: string[] = [];
  let n = 0;
  while (rest > 0) {
    const line = Math.min(LINE, rest);
    // `  - <title>\n`
    const prefix = `Child ${String(index)}.${String(n)} `;
    const width = line - 5;
    children.push((prefix + 'x'.repeat(Math.max(0, width - prefix.length))).slice(0, width));
    rest -= line;
    n++;
  }
  return { title, children };
}

/** Fluid Topics TOC nodes, one root per cost, as the `/toc` endpoint sends them. */
export function ftRootsCosting(costs: readonly number[], bundle = 'jamf-pro-documentation-current'): FtTocNode[] {
  return costs.map((tokens, i) => {
    const { title, children } = titlesFor(i, tokens);
    return {
      tocId: `toc-${String(i)}`,
      contentId: `content-${String(i)}`,
      title,
      prettyUrl: `/r/en-US/${bundle}/Root_${String(i)}`,
      children: children.map((childTitle, j) => ({
        tocId: `toc-${String(i)}-${String(j)}`,
        contentId: `content-${String(i)}-${String(j)}`,
        title: childTitle,
        prettyUrl: `/r/en-US/${bundle}/Root_${String(i)}_${String(j)}`,
        children: [],
      })),
    };
  });
}

/** The same trees as `TocEntry`s, for the shared helper itself. */
export function tocRootsCosting(costs: readonly number[]): TocEntry[] {
  return costs.map((tokens, i) => {
    const { title, children } = titlesFor(i, tokens);
    const url = `https://example.test/root-${String(i)}`;
    return children.length === 0
      ? { title, url }
      : {
        title,
        url,
        children: children.map((childTitle, j) => ({ title: childTitle, url: `${url}/${String(j)}` })),
      };
  });
}
