/**
 * Core service interfaces for platform abstraction
 *
 * These interfaces decouple business logic from Node.js-specific implementations,
 * enabling deployment to different runtimes (e.g., Cloudflare Workers).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// ============================================================================
// Cache Interfaces
// ============================================================================

/**
 * Cache statistics
 */
export interface CacheStats {
  memoryEntries: number;
  totalEntries: number;
  totalSize?: number;
}

/**
 * Platform-agnostic cache provider
 */
export interface CacheProvider {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttl?: number): Promise<void>;
  delete(key: string): Promise<boolean>;
  clear(): Promise<void>;
  stats(): Promise<CacheStats>;
  prune(): Promise<number>;
}

// ============================================================================
// Metadata Interfaces
// ============================================================================

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

// ============================================================================
// Logging Interfaces
// ============================================================================

/**
 * Logger instance bound to a specific module name
 */
export interface Logger {
  debug(data: unknown): void;
  info(data: unknown): void;
  notice(data: unknown): void;
  warning(data: unknown): void;
  error(data: unknown): void;
  critical(data: unknown): void;
  alert(data: unknown): void;
  emergency(data: unknown): void;
}

/**
 * Factory for creating named logger instances
 */
export interface LoggerFactory {
  createLogger(name: string): Logger;
  setServer(server: McpServer): void;
}
