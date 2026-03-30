#!/usr/bin/env node
/**
 * Jamf Docs MCP Server — Node.js entry point
 *
 * Builds a platform-specific ServerContext using Node.js implementations,
 * then delegates to the runtime-agnostic createMcpServer() factory.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createMcpServer } from './core/create-server.js';
import type { ServerContext } from './core/types/context.js';
import { createNodeConfig } from './platforms/node/config.js';
import { FileCache } from './platforms/node/cache.js';
import { NodeLoggerFactory } from './platforms/node/logger.js';
import { NodeMetadataStore } from './platforms/node/metadata.js';
import { createLogger } from './core/services/logging.js';
import { parseCliArgs } from './transport/index.js';

const log = createLogger('server');

// Build Node.js platform context
const config = createNodeConfig();
const logger = new NodeLoggerFactory();
const cache = new FileCache({
  ...(config.cache.dir !== undefined ? { cacheDir: config.cache.dir } : {}),
  maxEntries: config.cache.maxEntries,
  log: logger.createLogger('cache'),
});

// Build the complete ServerContext (use partial first, then attach metadata)
const ctx: ServerContext = {
  config,
  logger,
  cache,
  metadata: undefined as unknown as ServerContext['metadata'],
};
ctx.metadata = new NodeMetadataStore(ctx);

// Create the MCP server with all tools, resources, and prompts registered
const server = createMcpServer(ctx);

// Start server
async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));

  if (args.transport === 'http') {
    const { startHttpServer } = await import('./transport/http.js');
    await startHttpServer(server, args.port, args.host);
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);

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
