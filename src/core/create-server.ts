/**
 * Factory function to create and configure a fully-registered MCP server.
 *
 * This is runtime-agnostic: it accepts a ServerContext (already wired to
 * platform-specific cache, logger, and metadata implementations) and
 * returns a ready-to-connect McpServer.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerContext } from './types/context.js';
import { SERVER_ICON } from './constants.js';

import { registerListProductsTool } from './tools/list-products.js';
import { registerSearchTool } from './tools/search.js';
import { registerGetArticleTool } from './tools/get-article.js';
import { registerGetTocTool } from './tools/get-toc.js';
import { registerGlossaryLookupTool } from './tools/glossary-lookup.js';
import { registerBatchGetArticlesTool } from './tools/batch-get-articles.js';
import { registerResources } from './resources/index.js';
import { registerPrompts } from './prompts/index.js';

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
- Use the maxTokens parameter to control response size (default: 5000, max: 20000).
- Start with a lower maxTokens value and increase only when more detail is needed.
- Use summaryOnly: true on jamf_docs_get_article to get an article outline before fetching full content.

## Product Filtering
- When the target Jamf product is known, filter by product ID to narrow results: jamf-pro, jamf-school, jamf-connect, jamf-protect.
- Combine product and topic filters on jamf_docs_search for the most relevant results.`;

/**
 * Create a fully-configured MCP server with all tools, resources, and prompts.
 *
 * @param ctx - Platform-specific server context (cache, metadata, logger, config)
 * @returns An McpServer ready to be connected to a transport
 */
export function createMcpServer(ctx: ServerContext): McpServer {
  const server = new McpServer(
    {
      name: 'jamf-docs-mcp-server',
      version: ctx.config.version,
      icons: [{ src: SERVER_ICON, mimeType: 'image/png', sizes: ['32x32'] }],
    },
    {
      instructions: SERVER_INSTRUCTIONS,
      capabilities: {
        logging: {},
      },
    },
  );

  ctx.logger.setServer(server);

  // Register all tools
  registerListProductsTool(server, ctx);
  registerSearchTool(server, ctx);
  registerGetArticleTool(server, ctx);
  registerGetTocTool(server, ctx);
  registerGlossaryLookupTool(server, ctx);
  registerBatchGetArticlesTool(server, ctx);

  // Register resources
  registerResources(server, ctx);

  // Register prompts
  registerPrompts(server);

  return server;
}
