/**
 * The table-of-contents row list.
 *
 * `jamf_docs_get_toc` sends `structuredContent.entries` as the TOC flattened
 * into document order with every entry tagged by `depth` (0 at the root).
 * Order plus depth is the whole tree, not a hint at it: the tool pages over
 * top-level entries only, so a page is a sequence of complete subtrees, or one
 * top-level entry too large for the budget cut to the start of its subtree.
 * This module is what turns that back into something that reads as a tree —
 * before it, the one in-repo host of that payload drew every level of a
 * navigation structure as a sibling of every other.
 *
 * It also holds what paging needs: the arguments for the next page, and the
 * note for a page that was cut. Both are here rather than in app.ts for the
 * reason glossary.ts gives: importing app.ts throws outside a browser.
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
      // that says "section", which is the only ranking a flat list of several
      // hundred titles has.
      const top = steps === 0 ? ' data-top' : '';
      return (
        `<li><a class="row"${top} href="${esc(entry.url)}" data-url="${esc(entry.url)}"`
        + ` style="--depth:${String(steps)}">${esc(entry.title)}</a></li>`
      );
    })
    .join('');
}

/** A top-level entry too large for the budget on its own, as its page shows it. */
export interface TocTruncatedEntry {
  title: string;
  shownEntries: number;
  totalEntries: number;
  /** What the whole entry costs, in tokens. */
  estimatedTokens: number;
}

/** The part of the TOC payload paging reads. Unvalidated, like all of it. */
export interface TocPaging {
  productId?: string;
  publicationId?: string;
  /** The version asked for, or `current`. */
  version?: string;
  /** The language asked for; absent for the default. Older servers do not send it. */
  language?: string;
  page: number;
  /** False when there is no next page to ask for, even below `totalPages`. */
  hasMore?: boolean;
  /** The budget this page was cut to. Older servers do not send it. */
  maxTokens?: number;
  /** Present when this page is one top-level entry cut to fit. */
  truncatedEntry?: TocTruncatedEntry;
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

/**
 * The arguments that fetch the page after this one, or null when there is no
 * next page or the payload does not say what to ask for.
 *
 * Whichever id the response echoed back, under the name the request used. A
 * TOC addressed by publication reports `publicationId` and no `productId`,
 * and sending `product: undefined` instead is a validation error, which is how
 * "Load more" on a publication TOC once always failed.
 *
 * Everything else that decides where this page ends goes back too. A page
 * holds as many whole top-level entries as fit `maxTokens`, so the next page
 * starts right after this one only at the same budget, in the same tree:
 * asked for at the default budget, it started wherever the default's pages
 * do, and asked for without the version or language, it came from another
 * tree whose pages break elsewhere (live on 2026-09-26, page 1 of Jamf Pro
 * at `maxTokens: 1000` held 5 top-level entries in ja-JP and 4 in en-US).
 * Either way entries were skipped or repeated, with nothing on screen to say
 * so. `current` is what the server assumes without a version, so it is left
 * out.
 *
 * `hasMore` is false on the last page `page` accepts even when there are
 * more; asking past it is a validation error.
 */
export function nextTocPageArgs(view: TocPaging): { name: string; args: Record<string, unknown> } | null {
  const id = text(view.productId) ? view.productId : view.publicationId;
  if (!text(id) || view.hasMore === false) {
    return null;
  }
  const key = text(view.productId) ? 'product' : 'publication';
  const version = text(view.version) && view.version !== 'current' ? view.version : undefined;
  const language = text(view.language) ? view.language : undefined;
  const maxTokens = count(view.maxTokens);
  return {
    name: 'jamf_docs_get_toc',
    args: {
      [key]: id,
      ...(version !== undefined ? { version } : {}),
      ...(language !== undefined ? { language } : {}),
      page: view.page + 1,
      ...(maxTokens !== undefined ? { maxTokens } : {}),
    },
  };
}

/**
 * The note for a page that is one top-level entry cut to fit, or nothing.
 *
 * The reader of the panel does not set `maxTokens`, so this says what the page
 * leaves out and what the whole entry needs; the model reads the text channel,
 * which says what budget to ask for.
 */
export function tocBudgetNote(view: TocPaging): string | undefined {
  // Read as unknown: the payload is only cast to this shape, not checked.
  const raw: unknown = view.truncatedEntry;
  if (typeof raw !== 'object' || raw === null) {
    return undefined;
  }
  const cut = raw as Partial<Record<keyof TocTruncatedEntry, unknown>>;
  const shown = count(cut.shownEntries);
  const total = count(cut.totalEntries);
  const needs = count(cut.estimatedTokens);
  const name = text(cut.title) ? `“${cut.title}”` : 'This section';
  const part = shown !== undefined && total !== undefined
    ? `: showing ${String(shown)} of its ${String(total)} entries`
    : '';
  return `${name} is too long for the token budget this page was given${part}.${
    needs !== undefined ? ` The whole section needs ${String(needs)} tokens.` : ''
  }`;
}
