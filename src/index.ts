#!/usr/bin/env node
/**
 * Jamf Docs MCP Server — Node.js entry point
 *
 * Builds a platform-specific ServerContext using Node.js implementations,
 * then delegates to the runtime-agnostic createMcpServer() factory.
 */

import { serveStdio } from '@modelcontextprotocol/server/stdio';

import { createMcpServer } from './core/create-server.js';
import type { ServerContext } from './core/types/context.js';
import { createNodeConfig } from './platforms/node/config.js';
import { FileCache } from './platforms/node/cache.js';
import { NodeLoggerFactory } from './platforms/node/logger.js';
import { MapsRegistry } from './core/services/maps-registry.js';
import { TopicResolver } from './core/services/topic-resolver.js';
import { createStderrLogger } from './core/services/logging.js';
import { parseCliArgs } from './transport/index.js';

const log = createStderrLogger('server');

// Build Node.js platform context
const config = createNodeConfig();
const logger = new NodeLoggerFactory();
const cache = new FileCache({
  ...(config.cache.dir !== undefined ? { cacheDir: config.cache.dir } : {}),
  maxEntries: config.cache.maxEntries,
  log: logger.createLogger('cache'),
});

// Build singleton services
const mapsRegistry = new MapsRegistry(
  cache, undefined, undefined, config.cacheTtl.products
);
const topicResolver = new TopicResolver(
  mapsRegistry, cache, undefined, config.cacheTtl.article
);

// Build the complete ServerContext
const ctx: ServerContext = {
  config,
  logger,
  cache,
  mapsRegistry,
  topicResolver,
};

/**
 * Reclaim disk the cache can no longer read back.
 *
 * `prune()` scans the cache directory rather than the LRU's in-memory keys,
 * so it is the only thing that can reach an entry written under a key format
 * this build no longer constructs. Nothing called it, which is why those
 * entries sat on disk indefinitely instead of expiring on their TTL.
 *
 * Startup is the right moment: it is exactly when a version that changed a
 * cache key has just replaced one that did not. Deliberately not awaited —
 * a slow or unreadable cache directory must not delay the server's first
 * response, and every failure inside `prune()` is already contained.
 */
function sweepCacheInBackground(): void {
  void cache.prune().then(
    (reclaimed) => {
      if (reclaimed > 0) { log.info(`Cache sweep reclaimed ${String(reclaimed)} stale entries`); }
    },
    (error: unknown) => { log.warning(`Cache sweep failed: ${String(error)}`); },
  );
}

// Start server
async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));

  sweepCacheInBackground();

  if (args.transport === 'http') {
    const { startHttpServer } = await import('./transport/http.js');
    // Stateless HTTP: build a fresh server per request, each with its own
    // logger binding, so concurrent connections never share a transport or
    // per-connection log-level state. Heavy providers (cache, registries)
    // stay shared via the captured ctx.
    await startHttpServer(
      () => createMcpServer({ ...ctx, logger: new NodeLoggerFactory() }),
      args.port,
      args.host,
    );
  } else {
    // stdio is a single long-lived connection. `serveStdio` owns the era
    // decision: the opening exchange picks 2026-07-28 or the 2025 handshake,
    // and one server from the factory is pinned for the connection lifetime.
    serveStdio(() => createMcpServer(ctx), {
      legacy: 'serve',
      onerror: (err) => { log.error(`stdio error: ${err.message}`); },
    });

    log.info('Jamf Docs MCP Server running on stdio');
    log.info('Available tools: jamf_docs_list_products, jamf_docs_search, jamf_docs_get_article, jamf_docs_get_toc, jamf_docs_glossary_lookup, jamf_docs_batch_get_articles');
    log.info('Available resources: jamf://products, jamf://topics');
    log.info('Available prompts: jamf_troubleshoot, jamf_setup_guide, jamf_compare_versions');
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? String(error) : String(error);
  log.emergency(`Fatal error: ${message}`);
  process.exit(1);
});
