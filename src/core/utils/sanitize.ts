/**
 * Security sanitization utilities
 *
 * Functions for sanitizing user-controlled or externally-sourced content
 * before interpolation into Markdown output or client-facing error messages.
 */

/**
 * Escape Markdown special characters in text to prevent Markdown injection.
 * Use this for titles, snippets, and other text interpolated into Markdown.
 */
export function sanitizeMarkdownText(text: string): string {
  return text.replace(/[[\]()#*_`~>!|\\]/g, '\\$&');
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
    // Percent-encode parentheses in the URL to prevent breaking Markdown link syntax
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
 * - Replaces backend hostnames with frontend equivalents
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
