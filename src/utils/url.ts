/**
 * URL validation utilities
 *
 * Hostname allowlist and validation for Jamf documentation URLs.
 * Shared by both the schema layer and the scraper service.
 */

/** Allowed hostnames for URL validation. */
export const ALLOWED_HOSTNAMES = new Set([
  'learn.jamf.com',
  'learn-be.jamf.com',
  'docs.jamf.com',
]);

/** Check whether a URL string points to an allowed Jamf documentation hostname. */
export function isAllowedHostname(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    return ALLOWED_HOSTNAMES.has(url.hostname);
  } catch {
    return false;
  }
}
