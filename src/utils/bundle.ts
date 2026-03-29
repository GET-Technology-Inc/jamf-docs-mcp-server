/**
 * Bundle ID utilities
 */

import { JAMF_PRODUCTS, type ProductId } from '../constants.js';

const BUNDLE_VERSION_REGEX = /-(\d+\.\d+\.\d+)$/;

/**
 * Extract version number from a bundle_id
 * e.g., "jamf-pro-documentation-11.25.0" -> "11.25.0"
 */
export function extractVersionFromBundleId(bundleId: string): string | null {
  const match = BUNDLE_VERSION_REGEX.exec(bundleId);
  return match?.[1] ?? null;
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
