/**
 * Core service interfaces barrel file
 *
 * Re-exports all platform abstraction interfaces from domain-specific files.
 */

export type { CacheProvider, CacheStats } from './cache.js';
export type {
  MetadataStore,
  ProductMetadata,
  TopicMetadata,
  TocEntry,
  TocData,
} from './metadata.js';
export type { Logger, LoggerFactory } from './logger.js';
export type {
  SearchProvider,
  ArticleProvider,
  GlossaryProvider,
  TocProvider,
} from './providers.js';
