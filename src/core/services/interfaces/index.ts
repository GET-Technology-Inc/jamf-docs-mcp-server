/**
 * Core service interfaces barrel file
 *
 * Re-exports all platform abstraction interfaces from domain-specific files.
 */

export type { CacheProvider, CacheStats } from './cache.js';
export type {
  ProductMetadata,
  TopicMetadata,
  TocEntry,
  TocData,
} from './metadata.js';
export type { Logger, LoggerFactory, WriteStderrFn } from './logger.js';
export type {
  SearchProvider,
  ArticleProvider,
  GlossaryProvider,
  TocProvider,
  MapsProvider,
} from './providers.js';
