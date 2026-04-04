/**
 * Bundle ID utilities
 */

import { JAMF_PRODUCTS, type ProductId } from '../constants.js';

const BUNDLE_VERSION_REGEX = /-(\d+\.\d+(?:\.\d+)?)$/;

/**
 * Compare two version strings. Returns positive if a > b, negative if a < b, 0 if equal.
 * "current" is always treated as the maximum value.
 */
export function compareVersions(a: string, b: string): number {
  if (a === b) { return 0; }
  if (a === 'current') { return 1; }
  if (b === 'current') { return -1; }

  const partsA = a.split('.').map(Number);
  const partsB = b.split('.').map(Number);
  const len = Math.max(partsA.length, partsB.length);

  for (let i = 0; i < len; i++) {
    const numA = partsA[i] ?? 0;
    const numB = partsB[i] ?? 0;
    if (isNaN(numA) || isNaN(numB)) {
      return a.localeCompare(b);
    }
    if (numA !== numB) { return numA - numB; }
  }
  return 0;
}

/**
 * Extract version number from a bundle_id (2-part or 3-part).
 * e.g., "jamf-pro-documentation-11.25.0" -> "11.25.0"
 *       "jamf-school-documentation-2.45"  -> "2.45"
 */
export function extractVersionFromBundleId(bundleId: string): string | null {
  const match = BUNDLE_VERSION_REGEX.exec(bundleId);
  return match?.[1] ?? null;
}

/**
 * Return the bundleId with its version suffix removed.
 * e.g., "jamf-pro-documentation-11.25.0" -> "jamf-pro-documentation"
 *       "jamf-pro-documentation"         -> "jamf-pro-documentation"
 */
export function stripVersionSuffix(bundleId: string): string {
  return bundleId.replace(BUNDLE_VERSION_REGEX, '');
}

/**
 * Strip the "-current" suffix from a bundle identifier.
 * e.g., "jamf-pro-documentation-current" -> "jamf-pro-documentation"
 *       "jamf-pro-documentation"         -> "jamf-pro-documentation"
 */
export function stripCurrentSuffix(s: string): string {
  return s.replace(/-current$/, '');
}

// Product IDs sorted by length descending to match longest prefix first
// (e.g., "jamf-protect" before "jamf-pro")
const SORTED_PRODUCT_IDS: ProductId[] = (Object.keys(JAMF_PRODUCTS) as ProductId[])
  .sort((a, b) => b.length - a.length);

/**
 * Extract product slug from any bundle_id format.
 * Matches against known product IDs so it works for documentation, release-notes, etc.
 *
 * e.g., "jamf-pro-documentation"           -> "jamf-pro"
 *       "jamf-pro-release-notes-11.25.0"   -> "jamf-pro"
 *       "jamf-protect-documentation"        -> "jamf-protect"
 *       "jamf-app-catalog"                  -> "jamf-app-catalog"
 */
export function extractProductSlug(bundleId: string): ProductId | null {
  for (const pid of SORTED_PRODUCT_IDS) {
    if (bundleId === pid || bundleId.startsWith(`${pid}-`)) {
      return pid;
    }
  }
  return null;
}
