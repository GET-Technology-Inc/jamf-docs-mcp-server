/**
 * Server context type
 *
 * Dependency injection container providing platform-agnostic
 * services to all tools and business logic.
 */

import type { CacheProvider, MetadataStore, LoggerFactory } from '../services/interfaces.js';
import type { ServerConfig } from '../config.js';

export interface ServerContext {
  cache: CacheProvider;
  metadata: MetadataStore;
  logger: LoggerFactory;
  config: ServerConfig;
}
