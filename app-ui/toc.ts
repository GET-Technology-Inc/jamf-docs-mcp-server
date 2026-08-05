/**
 * The table-of-contents row list.
 *
 * `jamf_docs_get_toc` sends `structuredContent.entries` as the TOC flattened
 * into document order with every entry tagged by `depth` (0 at the root).
 * Order plus depth is the whole tree, not a hint at it: the tool paginates and
 * token-truncates over top-level entries only, so a page is always a sequence
 * of complete subtrees. This module is what turns that back into something
 * that reads as a tree — before it, the one in-repo host of that payload drew
 * every level of a navigation structure as a sibling of every other.
 */

import { esc } from './escape.js';

export interface TocEntry {
  title: string;
  url: string;
  /**
   * Nesting level, 0 for a top-level entry. Optional because the field only
   * arrived in server 4.2.0: against an older server every entry renders
   * flush left, which is what this app did for all of them.
   */
  depth?: number;
}

/**
 * Deepest level that still earns an indent step; anything below renders at
 * this one.
 *
 * The cap is about panel width, not about TOC shape. Hosts give the app a
 * side panel that can be ~320px wide, and each step is 14px (see `.row` in
 * styles.ts), so six steps spend 84px of it. Depth arrives over the wire from
 * whatever server the host is talking to, so an unbounded multiply is a
 * layout the payload gets to choose: a depth of 400 pushes every title past
 * the right edge with no way to scroll back.
 */
export const MAX_TOC_INDENT = 6;

/**
 * How many indent steps an entry gets.
 *
 * `depth` is a `number` by declaration only. `classify()` in app.ts casts an
 * entirely unvalidated payload — the host's relayed `structuredContent`, or
 * `JSON.parse` of a text block — after checking two fields, so what lands here
 * is whatever was sent. The return type is what makes the caller safe: the
 * value is interpolated into a `style` attribute, and a string that carried a
 * `"` would close the attribute and leave the rest of it parsed as markup on
 * the same tag. Returning a bounded integer means there is nothing to escape.
 *
 * The out-of-range cases are all silent rather than loud, matching the other
 * guards in this bundle: a render that throws from `ontoolresult` is uncaught
 * and the panel just dies.
 */
export function indentSteps(depth: unknown): number {
  // `Number.isFinite` rejects NaN and both infinities. None of them names a
  // level a TOC can have, so all three render flush left rather than at the
  // cap; left raw they would reach `calc()`, which silently drops the whole
  // declaration for NaN and indents past the viewport for Infinity.
  if (typeof depth !== 'number' || !Number.isFinite(depth) || depth <= 0) {
    return 0;
  }
  return Math.min(Math.floor(depth), MAX_TOC_INDENT);
}

/**
 * Render the entries as `<li>` rows carrying their indent step.
 *
 * The step travels as a custom property rather than as a `padding-left` so the
 * one place that decides how wide a level is stays in the stylesheet, beside
 * the padding it adds to.
 */
export function renderTocItems(entries: TocEntry[]): string {
  return entries
    .map(
      (e) =>
        `<li class="row" data-url="${esc(e.url)}" style="--depth:${indentSteps(e.depth)}"`
        + ` tabindex="0" role="button">${esc(e.title)}</li>`,
    )
    .join('');
}
