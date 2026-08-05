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
