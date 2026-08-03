/**
 * Factory function to create and configure a fully-registered MCP server.
 *
 * This is runtime-agnostic: it accepts a ServerContext (already wired to
 * platform-specific cache, logger, and metadata implementations) and
 * returns a ready-to-connect McpServer.
 */

import { McpServer } from '@modelcontextprotocol/server';
import type { ServerContext } from './types/context.js';
import { SERVER_ICON, PRODUCT_ID_LIST, TOKEN_CONFIG } from './constants.js';

import { registerListProductsTool } from './tools/list-products.js';
import { registerSearchTool } from './tools/search.js';
import { registerGetArticleTool } from './tools/get-article.js';
import { registerGetTocTool } from './tools/get-toc.js';
import { registerGlossaryLookupTool } from './tools/glossary-lookup.js';
import { registerBatchGetArticlesTool } from './tools/batch-get-articles.js';
import { registerResources } from './resources/index.js';
import { registerApps, UI_EXTENSION_ID, APP_MIME_TYPE } from './apps/index.js';
import { registerPrompts } from './prompts/index.js';

/**
 * Options for createMcpServer
 */
export interface CreateServerOptions {
  /**
   * Tool name whitelist. When provided, only listed tools are registered.
   *
   * Explicitly `| undefined` so callers can forward an optional value —
   * `createMcpServer(ctx, { tools: argv.tools })` — under the
   * `exactOptionalPropertyTypes` this project compiles with.
   */
  tools?: string[] | undefined;
}

/**
 * Tool registration order.
 *
 * `tools/list` results are emitted in registration order, and protocol
 * revision 2026-07-28 asks servers to keep that order deterministic so clients
 * can cache the list and LLM prompt caches keep hitting. An ordered array (not
 * an object literal) makes the guarantee explicit and testable.
 */
export const TOOL_ORDER = [
  'jamf_docs_list_products',
  'jamf_docs_search',
  'jamf_docs_get_article',
  'jamf_docs_get_toc',
  'jamf_docs_glossary_lookup',
  'jamf_docs_batch_get_articles',
] as const;

/** A tool this server knows how to register. */
export type ToolName = (typeof TOOL_ORDER)[number];

/**
 * Tool name → registration function mapping.
 *
 * Keyed by {@link ToolName} rather than `string` so the two structures cannot
 * drift: registration walks `TOOL_ORDER`, so an entry that exists only here
 * would never be registered and nothing would say so. With this type, omitting
 * a name is a missing-property error and adding an unlisted one is an excess-
 * property error — both at compile time.
 */
const TOOL_REGISTRY: Record<
  ToolName,
  (server: McpServer, ctx: ServerContext) => void
> = {
  jamf_docs_list_products: registerListProductsTool,
  jamf_docs_search: registerSearchTool,
  jamf_docs_get_article: registerGetArticleTool,
  jamf_docs_get_toc: registerGetTocTool,
  jamf_docs_glossary_lookup: registerGlossaryLookupTool,
  jamf_docs_batch_get_articles: registerBatchGetArticlesTool,
};

/**
 * Cache hints emitted on the `CacheableResult` operations of protocol
 * revision 2026-07-28 (`ttlMs` / `cacheScope`).
 *
 * Everything this server returns is public Jamf documentation — there is no
 * per-user or per-tenant content — so `public` is correct throughout and lets
 * shared intermediaries cache alongside the client.
 *
 * The listing surfaces (tools, prompts, resources) only change when a new
 * version of this package is deployed, so they get the full hour. Resource
 * reads track upstream documentation and get the same hour, which is well
 * inside the cadence at which Jamf publishes changes.
 *
 * These are the *healthy-path* defaults. A handler that answers with something
 * it would not want frozen in a shared cache for an hour — an error body, or
 * data it had to fall back to static constants for — returns its own
 * `ttlMs` / `cacheScope` on the result, which the SDK prefers over anything
 * configured here.
 *
 * Without these the SDK emits the conservative default (`ttlMs: 0`,
 * `cacheScope: 'private'`), i.e. no caching at all.
 */
const ONE_HOUR_MS = 3_600_000;

const CACHE_HINTS = {
  'tools/list': { ttlMs: ONE_HOUR_MS, cacheScope: 'public' },
  'prompts/list': { ttlMs: ONE_HOUR_MS, cacheScope: 'public' },
  'resources/list': { ttlMs: ONE_HOUR_MS, cacheScope: 'public' },
  'resources/templates/list': { ttlMs: ONE_HOUR_MS, cacheScope: 'public' },
  'resources/read': { ttlMs: ONE_HOUR_MS, cacheScope: 'public' },
  'server/discover': { ttlMs: ONE_HOUR_MS, cacheScope: 'public' },
} as const;

const SERVER_INSTRUCTIONS = `This server provides access to Jamf official documentation (learn.jamf.com) for Jamf Pro, Jamf School, Jamf Connect, and Jamf Protect.

## Tool Usage Order
1. Use jamf_docs_list_products to discover available products and versions.
2. Use jamf_docs_search to find relevant articles by keyword. Always search before fetching a full article.
3. Use jamf_docs_get_article to retrieve full content of a specific article found via search.
4. Use jamf_docs_get_toc to browse the table of contents for a product.
5. Use jamf_docs_glossary_lookup to quickly look up Jamf terminology and definitions.

## Output Modes
- Use outputMode: "compact" when browsing or listing results to save tokens.
- Use outputMode: "full" when reading a specific article in detail.

## Token Management
- Use the maxTokens parameter to control response size (default: ${TOKEN_CONFIG.DEFAULT_MAX_TOKENS}, max: ${TOKEN_CONFIG.MAX_TOKENS_LIMIT}).
- Start with a lower maxTokens value and increase only when more detail is needed.
- Use summaryOnly: true on jamf_docs_get_article to get an article outline before fetching full content.

## Product Filtering
- When the target Jamf product is known, filter by product ID to narrow results: ${PRODUCT_ID_LIST}.
- Combine product and topic filters on jamf_docs_search for the most relevant results.`;

/**
 * Create a fully-configured MCP server with all tools, resources, and prompts.
 *
 * @param ctx - Platform-specific server context (cache, metadata, logger, config)
 * @param options - Optional configuration (e.g., tool whitelist)
 * @returns An McpServer ready to be connected to a transport
 */
export function createMcpServer(ctx: ServerContext, options?: CreateServerOptions): McpServer {
  const server = new McpServer(
    {
      name: 'jamf-docs-mcp-server',
      version: ctx.config.version,
      icons: [{ src: SERVER_ICON, mimeType: 'image/png', sizes: ['32x32'] }],
    },
    {
      instructions: SERVER_INSTRUCTIONS,
      cacheHints: CACHE_HINTS,
      capabilities: {
        // MCP Apps (SEP-2133 extensions framework). Hosts that negotiate this
        // render search results, tables of contents and articles in the
        // `ui://` viewer; hosts that do not simply get the markdown.
        extensions: {
          [UI_EXTENSION_ID]: { mimeTypes: [APP_MIME_TYPE] },
        },
      },
    },
  );

  // The `logging` capability is deliberately not declared: SEP-2577 deprecated
  // the Logging feature in protocol revision 2026-07-28. Logs go to stderr on
  // Node and to the platform log sink on Workers; request-scoped progress
  // notifications are unaffected and still flow on the response stream.

  // Register tools in a fixed order (all by default, or filtered by whitelist)
  const toolWhitelist = options?.tools;
  for (const name of TOOL_ORDER) {
    if (toolWhitelist === undefined || toolWhitelist.includes(name)) {
      TOOL_REGISTRY[name](server, ctx);
    }
  }

  // Register resources
  registerResources(server, ctx);

  // Register the MCP Apps viewer the tools above reference
  registerApps(server);

  // Register prompts
  registerPrompts(server);

  return server;
}
