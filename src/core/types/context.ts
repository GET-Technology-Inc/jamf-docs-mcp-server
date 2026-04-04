/**
 * Server context type
 *
 * Dependency injection container providing platform-agnostic
 * services to all tools and business logic.
 */

import type { CacheProvider, LoggerFactory } from '../services/interfaces/index.js';
import type {
  SearchProvider,
  ArticleProvider,
  GlossaryProvider,
  TocProvider,
} from '../services/interfaces/index.js';
import type { ServerConfig } from '../config.js';
import type { MapsRegistry } from '../services/maps-registry.js';
import type { TopicResolver } from '../services/topic-resolver.js';

export interface ServerContext {
  cache: CacheProvider;
  logger: LoggerFactory;
  config: ServerConfig;
  mapsRegistry: MapsRegistry;
  topicResolver: TopicResolver;

  // Optional data-source providers — when provided, tools use these first,
  // falling back to the default implementation if the provider returns null.
  searchProvider?: SearchProvider;
  articleProvider?: ArticleProvider;
  glossaryProvider?: GlossaryProvider;
  tocProvider?: TocProvider;
}
