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
 * Hard ceiling on indent steps, whatever the panel measurement suggests.
 *
 * `depth` arrives over the wire from whatever server the host is talking to,
 * so an unbounded multiply is a layout the payload gets to choose: a depth of
 * 400 pushes every title past the right edge with no way to scroll back. The
 * *useful* cap is narrower still and is computed per panel width by
 * {@link indentCap}; this is only the value neither of them may exceed.
 */
export const MAX_TOC_INDENT = 8;

/**
 * How many indent steps a panel of this width can afford.
 *
 * The constant this replaced was a flat 6 whose comment guessed the panel was
 * "~320px". It is a measurement now because the same bundle renders in a
 * ~320px sidebar and a ~1000px fullscreen panel, and one number cannot be
 * right for both: six steps at 14px is 84px of a 320px panel, which is a
 * quarter of it spent on whitespace, and it is nothing at all at 1000px.
 *
 * The budget is 22% of the panel — enough that nesting reads as nesting, not
 * so much that a deep title has nowhere left to go.
 */
export function indentCap(panelWidth: number, indentPx: number): number {
  if (!Number.isFinite(panelWidth) || !Number.isFinite(indentPx) || indentPx <= 0) {
    return 4;
  }
  return Math.min(MAX_TOC_INDENT, Math.max(2, Math.floor((panelWidth * 0.22) / indentPx)));
}

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
 * The stylesheet also clamps with `min(var(--depth), var(--cap))`, so the two
 * guards are independent: neither a hostile payload nor a bug in this function
 * alone can push a row off the panel.
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
 * Render the entries as `<li><a class="row">` rows carrying their indent step.
 *
 * A real anchor with a real `href`, not the `<li role="button">` this replaced.
 * These open documents, so the affordance should not be a lie: a plain click
 * is intercepted and routed in-panel, while a modifier-click is left to the
 * host's own link handling. It also gets keyboard activation, the status-bar
 * URL preview and "copy link address" for free — three behaviours the previous
 * markup had to fake and only faked the first of.
 *
 * The step travels as a custom property rather than as a `padding-left` so the
 * one place that decides how wide a level is stays in the stylesheet, beside
 * the padding it adds to.
 */
export function renderTocItems(entries: TocEntry[]): string {
  return entries
    .map((entry) => {
      const steps = indentSteps(entry.depth);
      // `data-top` marks a root entry so the stylesheet can give it the weight
      // that says "section", which is the only ranking a flat list of 792
      // titles has.
      const top = steps === 0 ? ' data-top' : '';
      return (
        `<li><a class="row"${top} href="${esc(entry.url)}" data-url="${esc(entry.url)}"`
        + ` style="--depth:${String(steps)}">${esc(entry.title)}</a></li>`
      );
    })
    .join('');
}
