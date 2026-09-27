/**
 * What the panel shows for a tool result the server marked as failed.
 *
 * An error result carries no `structuredContent`, and its text is prose, not
 * JSON, so it classified as nothing: from the host it was dropped, which left
 * the panel on the loading skeleton the tool call had put up, and from the
 * panel's own call it read "returned nothing renderable". That was true of
 * every tool's errors. Until 2026-09-28 a failed search was not one: it came
 * back as a structured search with no results and drew "Nothing matched",
 * which was the defect. Now that it is an error, it needs a view.
 *
 * Kept out of app.ts so it can be tested on its own, as toc.ts is: importing
 * app.ts runs its top-level wiring and throws outside a browser.
 */

/** The part of a tool result this reads. Unvalidated, like all of it. */
export interface ToolResultLike {
  isError?: unknown;
  content?: unknown;
}

/** Said when an error result has no text: an error is still not a result. */
export const UNEXPLAINED_ERROR = 'The tool reported an error without saying what went wrong.';

/**
 * The message of a failed tool result, or nothing for one that did not fail.
 *
 * The first text block only. A failed search can add a second, listing what
 * other sites matched, and the first is the error on its own.
 */
export function toolErrorText(result: ToolResultLike): string | undefined {
  if (result.isError !== true) {
    return undefined;
  }
  const blocks = Array.isArray(result.content) ? (result.content as unknown[]) : [];
  const first = blocks.find(
    (block): block is { type: 'text'; text: string } =>
      typeof block === 'object' && block !== null
      && (block as { type?: unknown }).type === 'text'
      && typeof (block as { text?: unknown }).text === 'string',
  );
  const text = first?.text.trim() ?? '';
  return text === '' ? UNEXPLAINED_ERROR : text;
}
