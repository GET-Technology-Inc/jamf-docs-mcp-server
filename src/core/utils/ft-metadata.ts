/**
 * Shared utilities for working with Fluid Topics metadata entries.
 */
import type { FtMetadataEntry } from '../types.js';

// Well-known FT metadata keys used across the codebase
export const FT_META = {
  VERSION_BUNDLE_STEM: 'version_bundle_stem',
  VERSION: 'version',
  LATEST_VERSION: 'latestVersion',
  LOCALE: 'ft:locale',
  PRETTY_URL: 'ft:prettyUrl',
  BUNDLE: 'bundle',
  LEGACY_TOPICNAME: 'legacy_topicname',
  LEGACY_URL: 'legacy_url',
  ZOOMIN_METADATA: 'zoominmetadata',
  CONTENT_TYPE: 'jamf:contentType',
  /**
   * When this topic was last edited. Per-topic, unlike `ft:lastTechChange`,
   * which is the same date for every topic in a bundle and so says how old the
   * documentation *set* is rather than the page. Measured across 12 topics in
   * 7 products: lastEdition gave 9 distinct dates, lastTechChange gave 1.
   */
  LAST_EDITION: 'ft:lastEdition',
  CLUSTER_ID: 'ft:clusterId',
  PUBLICATION_ID: 'ft:publicationId',
  PRODNAME: 'prodname',

  /**
   * Jamf's own publication classification, present on all 662 maps.
   *
   * Unlike the `product-*` values inside `zoominmetadata` — a legacy Zoomin
   * vocabulary where one label covers many publications (`product-pro` alone
   * spans 38 bundle families) — these three name the platform, client app or
   * utility a publication documents, and each map carries at most one of
   * each. Measured across all 97 bundle families and 11 locales, every family
   * reports the same value in every locale: 0 disagreements. That is what
   * makes them usable as a stable classification rather than display text,
   * and it is the opposite of `jamf:contentType`, whose values ARE translated
   * (see DOC_TYPE_CONTENT_TYPE_MAP).
   *
   * Live distribution: portal 12 distinct values over 550 maps, app 9 over
   * 92, utility 9 over 25. A map may carry none of them.
   */
  PORTAL: 'jamf:portal',
  APP: 'jamf:app',
  UTILITY: 'jamf:utility',
} as const;

/**
 * `metadata` is optional on every FT payload type for the same reason their
 * `title` fields are: the shapes are bare casts over `response.json()` with no
 * runtime validation. Every metadata read in the codebase goes through these
 * two helpers, so tolerating an absent array here covers all of them at once —
 * and "no metadata at all" collapses naturally onto the same "key not found"
 * default they already return.
 */
export function getMetaValue(metadata: FtMetadataEntry[] | undefined, key: string): string {
  const entry = metadata?.find(m => m.key === key);
  return entry?.values[0] ?? '';
}

export function getMetaValues(metadata: FtMetadataEntry[] | undefined, key: string): string[] {
  const entry = metadata?.find(m => m.key === key);
  return entry?.values ?? [];
}

export function bundleStemToDisplayName(stem: string): string {
  return stem
    .replace(/-documentation$/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}
