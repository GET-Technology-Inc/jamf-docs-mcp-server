/**
 * URL validation utilities
 *
 * Hostname allowlist and validation for Jamf documentation URLs.
 * Shared by both the schema layer and the scraper service.
 */

import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type LocaleId } from '../constants.js';

/** Allowed hostnames for URL validation. */
export const ALLOWED_HOSTNAMES = new Set([
  'learn.jamf.com',
  'docs.jamf.com',
]);

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
    // First segment is the locale (e.g., "en-US", "ja", "zh-Hans")
    const candidate = pathSegments[0];
    if (candidate !== undefined && candidate in SUPPORTED_LOCALES) {
      return candidate as LocaleId;
    }
  } catch {
    // Invalid URL, fall through
  }
  return DEFAULT_LOCALE;
}
