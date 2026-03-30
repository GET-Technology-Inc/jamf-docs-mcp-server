/**
 * Server context type
 *
 * Dependency injection container providing platform-agnostic
 * services to all tools and business logic.
 */

import type { CacheProvider, MetadataStore, LoggerFactory } from '../services/interfaces/index.js';
import type {
  SearchProvider,
  ArticleProvider,
  GlossaryProvider,
  TocProvider,
} from '../services/interfaces/index.js';
import type { ServerConfig } from '../config.js';

export interface ServerContext {
  cache: CacheProvider;
  metadata: MetadataStore;
  logger: LoggerFactory;
  config: ServerConfig;

  // Optional data-source providers — when provided, tools use these first,
  // falling back to the default implementation if the provider returns null.
  searchProvider?: SearchProvider;
  articleProvider?: ArticleProvider;
  glossaryProvider?: GlossaryProvider;
  tocProvider?: TocProvider;
}
