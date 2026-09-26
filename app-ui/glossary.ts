/**
 * What the glossary view says about definitions the token budget left out,
 * and where the list layout puts it.
 *
 * `jamf_docs_glossary_lookup` cuts its matches to `maxTokens` in rank order and
 * stops at the first that does not fit, with no floor of one. A leading
 * definition over budget therefore arrives as no entries beside a nonzero
 * `totalMatches`, and the view drew that as "1 definition" over an empty list
 * with a note that "some" definitions were omitted. With one entry in hand and
 * more omitted, the single-definition layout dropped the note altogether, so
 * the one that fitted read as the whole answer.
 *
 * Kept out of app.ts so it can be tested on its own, as toc.ts is: importing
 * app.ts runs its top-level wiring and throws outside a browser.
 */

/** The part of the glossary payload this reads. Unvalidated, like all of it. */
export interface GlossaryBudget {
  totalMatches: number;
  entries: unknown[];
  truncated: boolean;
  /** Each left-out entry and its estimated tokens, in rank order. */
  truncatedContent?: { omittedCount: number; omittedItems: { title: string; estimatedTokens: number }[] };
}

/** A count the payload actually carries, or nothing. */
function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/**
 * The note for a truncated glossary answer, or nothing when none was cut.
 *
 * The reader of the panel does not set `maxTokens`, so this says what was left
 * out and, when nothing fits, what the first definition needs. The model reads
 * the text channel, which says what budget to ask for.
 */
export function budgetNote(view: GlossaryBudget): string | undefined {
  if (!view.truncated) {
    return undefined;
  }
  const total = count(view.totalMatches);
  const shown = Array.isArray(view.entries) ? view.entries.length : 0;
  if (total === undefined || total <= shown) {
    return 'Some definitions were omitted to fit the token budget.';
  }
  if (shown > 0) {
    const more = total - shown;
    return `${String(more)} more definition${more === 1 ? '' : 's'} omitted to fit the token budget.`;
  }
  const items = view.truncatedContent?.omittedItems;
  const needs = count(Array.isArray(items) ? (items[0] as { estimatedTokens?: unknown } | undefined)?.estimatedTokens : undefined);
  if (total === 1) {
    return `The definition is too long for the token budget this lookup was given${
      needs !== undefined ? `: it needs ${String(needs)} tokens` : ''
    }.`;
  }
  return `${String(total)} definitions match, but none fits in the token budget this lookup was given${
    needs !== undefined ? `: the first needs ${String(needs)} tokens` : ''
  }.`;
}

/**
 * The list layout under its header: the definitions that fitted, then the
 * note on what the budget left out.
 *
 * No list when none fitted. The layout drew an empty `<ol>` there, under a
 * heading that counts the matches; the note is then the whole answer, and it
 * says why none of them is shown. `rows` are the rendered `<li>`s and `note`
 * the rendered notice, empty when nothing was cut.
 */
export function renderGlossaryList(rows: readonly string[], note: string): string {
  const list = rows.length > 0 ? `<ol class="list list-hits">${rows.join('')}</ol>` : '';
  return `${list}
    ${note}`;
}
