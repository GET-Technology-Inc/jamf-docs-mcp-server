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
  CLUSTER_ID: 'ft:clusterId',
  PUBLICATION_ID: 'ft:publicationId',
} as const;

export function getMetaValue(metadata: FtMetadataEntry[], key: string): string {
  const entry = metadata.find(m => m.key === key);
  return entry?.values[0] ?? '';
}

export function getMetaValues(metadata: FtMetadataEntry[], key: string): string[] {
  const entry = metadata.find(m => m.key === key);
  return entry?.values ?? [];
}

export function bundleStemToDisplayName(stem: string): string {
  return stem
    .replace(/-documentation$/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}
