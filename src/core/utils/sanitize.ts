/**
 * Security sanitization utilities
 *
 * Functions for sanitizing user-controlled or externally-sourced content
 * before interpolation into Markdown output or client-facing error messages.
 */

/**
 * Escape Markdown special characters in text to prevent Markdown injection.
 * Use this for titles, snippets, and other text interpolated into Markdown.
 *
 * `<` is escaped because CommonMark passes an HTML tag or comment in text
 * through as HTML, and an `&` that starts a named character reference
 * because CommonMark decodes the reference: the text "&lt;" would render as
 * "<". A numeric one (`&#60;`) is already broken by its escaped `#`. A
 * search snippet needs both since 2026-09-28: it now holds the excerpt's
 * text, which can quote a plist's `<key>`, where it used to drop every `<`
 * and keep the references undecoded.
 */
export function sanitizeMarkdownText(text: string): string {
  return text.replace(/[[\]()#*_`~<>!|\\]|&(?=[A-Za-z][A-Za-z0-9]*;)/g, '\\$&');
}

/**
 * Sanitize a URL for use in Markdown link syntax.
 * - Only allows https: protocol
 * - Percent-encodes parentheses to prevent breaking Markdown links
 * - Returns '#' for invalid or non-https URLs
 */
export function sanitizeMarkdownUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') {
      return '#';
    }
    return url.replace(/\(/g, '%28').replace(/\)/g, '%29');
  } catch {
    return '#';
  }
}

/**
 * Extract and sanitize an error message from an unknown thrown value.
 */
export function getSafeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : 'Unknown error occurred';
  return sanitizeErrorMessage(raw);
}

/**
 * Sanitize error messages before returning to clients.
 * - Removes absolute file paths
 * - Removes stack traces
 */
export function sanitizeErrorMessage(message: string): string {
  let sanitized = message;

  // Remove absolute file paths (Unix and Windows)
  sanitized = sanitized.replace(/(?<![:/\w.])\/[\w./-]+\.\w{1,4}/g, '<path>');
  sanitized = sanitized.replace(/[A-Z]:\\[\w.\\-]+\.\w{1,4}/g, '<path>');

  // Remove stack traces (lines starting with "at ")
  sanitized = sanitized.replace(/\n\s*at\s+.+/g, '');

  return sanitized;
}

/**
 * Characters a title must not carry: the controls, of which a newline would
 * end the Markdown list item a title is written into; the line and paragraph
 * separators; and the bidi marks, embeddings, overrides and isolates, which
 * reorder the text around them when it is displayed.
 *
 * A slug can spell any of them as an escape, which `titleFromSlug` keeps as
 * written. A title a static source lists for a page is stripped of them
 * ({@link listedTitle}), since 2026-09-28, when this moved here from
 * sitemap-service.ts. `sanitizeMarkdownText` removes none of them.
 */
export const UNSAFE_IN_TITLE = /[\p{Cc}\u061C\u200E\u200F\u2028\u2029\u202A-\u202E\u2066-\u2069]/gu;

/**
 * A title as a listing gives it, fit to show: each run of whitespace, a
 * newline or a no-break space among them, made one space; the characters no
 * title may carry ({@link UNSAFE_IN_TITLE}) removed; and trimmed. Undefined
 * for one that leaves nothing.
 *
 * `titleFromSlug` keeps such a character out of a title made from a slug, and
 * a listed title must not bring one in. Of support.jamf.com's 820 en titles,
 * 10 hold a double space and one ends in a no-break space (2026-09-28).
 *
 * Read by the search title index and concepts.jamf.com's tables of contents
 * (static-titles.ts), and, since 2026-09-28, when this moved here from there,
 * by a support.jamf.com collection's list of articles and an article's
 * related articles (intercom-service.ts).
 */
export function listedTitle(text: string): string | undefined {
  const title = text.replace(/\s+/g, ' ').replace(UNSAFE_IN_TITLE, '').replace(/ {2,}/g, ' ').trim();
  return title === '' ? undefined : title;
}
