/**
 * URL validation utilities
 *
 * Hostname allowlist and validation for Jamf documentation URLs.
 * Shared by both the schema layer and the scraper service.
 */

import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type LocaleId } from '../constants.js';
import { STATIC_SOURCE_HOSTNAMES } from '../constants/sources.js';

/**
 * Allowed hostnames for URL validation.
 *
 * The two Fluid Topics hosts plus every registered non-FT source. Derived
 * rather than listed so that adding a source is one row in
 * {@link STATIC_DOC_SOURCES} and cannot be half-done: a hostname that the
 * article path knows how to parse but this set rejects would fail with a
 * "must be from" error that names the wrong problem.
 */
export const ALLOWED_HOSTNAMES = new Set<string>([
  'learn.jamf.com',
  'docs.jamf.com',
  ...STATIC_SOURCE_HOSTNAMES,
]);

/**
 * The hostnames a rejection message may name, derived from
 * {@link ALLOWED_HOSTNAMES} so it can never name fewer than the guard accepts.
 *
 * It did: concepts.jamf.com and support.jamf.com became fetchable when the
 * static sources landed, but every message still read "docs.jamf.com or
 * learn.jamf.com" — so a caller passing a valid concepts URL was told it was
 * invalid, which is the "names the wrong problem" failure the comment above
 * already warns about.
 */
export const ALLOWED_HOSTNAME_LIST = [...ALLOWED_HOSTNAMES].join(', ');

/** Keeps the "must be from" prefix the error-path tests match on. */
export const ALLOWED_HOSTNAME_MESSAGE = `URL must be from ${ALLOWED_HOSTNAME_LIST}`;

/** Check whether a URL string points to an allowed Jamf documentation hostname with HTTPS. */
export function isAllowedHostname(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    return url.protocol === 'https:' && ALLOWED_HOSTNAMES.has(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Extract locale segment from a Jamf documentation URL.
 * Returns the locale if found and supported, otherwise DEFAULT_LOCALE.
 *
 * URL structure: learn.jamf.com/{locale}/bundle/{bundleId}/page/{page}.html
 */
export function extractLocaleFromUrl(urlStr: string): LocaleId {
  try {
    const url = new URL(urlStr);
    const pathSegments = url.pathname.split('/').filter(Boolean);
    // First segment is the locale (e.g., "en-US", "ja-JP", "zh-TW")
    const candidate = pathSegments[0];
    if (candidate !== undefined && candidate in SUPPORTED_LOCALES) {
      return candidate as LocaleId;
    }
  } catch {
    // Invalid URL, fall through
  }
  return DEFAULT_LOCALE;
}
