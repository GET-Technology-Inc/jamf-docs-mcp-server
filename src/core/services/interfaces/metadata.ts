/**
 * Metadata interfaces for platform abstraction
 */

/**
 * Product metadata returned by the metadata store
 */
export interface ProductMetadata {
  id: string;
  name: string;
  description: string;
  bundleId: string;
  latestVersion: string;
  availableVersions: string[];
}

/**
 * Topic metadata returned by the metadata store
 */
export interface TopicMetadata {
  id: string;
  name: string;
  source: 'toc' | 'manual';
  articleCount?: number;
}
