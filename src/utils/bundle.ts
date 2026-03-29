/**
 * Bundle ID utilities
 */

const BUNDLE_VERSION_REGEX = /-(\d+\.\d+\.\d+)$/;

/**
 * Extract version number from a bundle_id
 * e.g., "jamf-pro-documentation-11.25.0" -> "11.25.0"
 */
export function extractVersionFromBundleId(bundleId: string): string | null {
  const match = BUNDLE_VERSION_REGEX.exec(bundleId);
  return match?.[1] ?? null;
}
