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
  labelKey: string;
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

/**
 * Table of contents entry (recursive tree structure)
 */
export interface TocEntry {
  title: string;
  url: string;
  children?: TocEntry[];
}

/**
 * Structured table of contents data for a product
 */
export interface TocData {
  entries: TocEntry[];
  product: string;
  version: string;
}

/**
 * Platform-agnostic metadata store for Jamf documentation
 */
export interface MetadataStore {
  getProducts(): Promise<ProductMetadata[]>;
  getTopics(): Promise<TopicMetadata[]>;
  getToc(productId: string, bundleId: string): Promise<TocData>;
  getBundleIdForVersion(productId: string, version?: string): Promise<string | null>;
  getAvailableVersions(productId: string): Promise<string[]>;
}
