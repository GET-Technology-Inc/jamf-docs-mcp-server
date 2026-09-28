/**
 * The ServerContext the Node server runs on.
 *
 * Built here rather than in src/index.ts, which starts the server when it is
 * imported, so a test can build the context the server builds. Until
 * 2026-09-28 src/index.ts built it inline, and the TTL each singleton service
 * is given could only be copied into a test, not checked there.
 *
 * Not exported from the `./platforms/node` barrel, a published path: this is
 * the server's own wiring, not an API.
 */

import { createNodeConfig } from './config.js';
import { FileCache } from './cache.js';
import { NodeLoggerFactory } from './logger.js';
import type { ServerConfig } from '../../core/config.js';
import { createHttpClient, type HttpClient } from '../../core/http-client.js';
import { MapsRegistry } from '../../core/services/maps-registry.js';
import { TopicResolver } from '../../core/services/topic-resolver.js';
import type { CacheProvider, LoggerFactory } from '../../core/services/interfaces/index.js';
import type { ServerContext } from '../../core/types/context.js';

/** What the context is built on. Each part left out is the one the server uses. */
export interface NodeContextParts {
  /** Default: {@link createNodeConfig}, read from the environment. */
  config?: ServerConfig;
  /** Default: a {@link NodeLoggerFactory}. */
  logger?: LoggerFactory;
  /** Default: a {@link FileCache} in `config.cache.dir`. */
  cache?: CacheProvider;
  /** Default: a client bound to `config.request`. */
  http?: HttpClient;
}

export function createNodeContext(parts: NodeContextParts = {}): ServerContext {
  const config = parts.config ?? createNodeConfig();
  const logger = parts.logger ?? new NodeLoggerFactory();
  const cache = parts.cache ?? new FileCache({
    ...(config.cache.dir !== undefined ? { cacheDir: config.cache.dir } : {}),
    maxEntries: config.cache.maxEntries,
    log: logger.createLogger('cache'),
  });

  // One client for the process, bound to the request settings. Everything that
  // reaches a documentation host goes through it, so the User-Agent and the
  // timeout/retry/politeness settings apply everywhere rather than per call site.
  const http = parts.http ?? createHttpClient(config.request);

  // The maps list is the product list, so it is kept for CACHE_TTL_PRODUCTS.
  // Each map's topic index, which a learn.jamf.com page URL is resolved with,
  // is kept with the articles, for CACHE_TTL_ARTICLE.
  const mapsRegistry = new MapsRegistry(
    cache, undefined, undefined, config.cacheTtl.products, http
  );
  const topicResolver = new TopicResolver(
    mapsRegistry, cache, undefined, config.cacheTtl.article, http
  );

  return { config, logger, cache, http, mapsRegistry, topicResolver };
}
