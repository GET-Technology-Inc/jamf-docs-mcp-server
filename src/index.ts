#!/usr/bin/env node
/**
 * Jamf Docs MCP Server
 *
 * An MCP server that provides access to Jamf documentation (docs.jamf.com)
 * for AI assistants like Claude.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { registerSearchTool } from './tools/search.js';
import { registerGetArticleTool } from './tools/get-article.js';
import { registerListProductsTool } from './tools/list-products.js';
import { registerGetTocTool } from './tools/get-toc.js';
import { registerResources } from './resources/index.js';
import { registerPrompts } from './prompts/index.js';
import { SERVER_ICON, SERVER_VERSION } from './constants.js';
import { parseCliArgs } from './transport/index.js';

// Server instructions for AI clients
const SERVER_INSTRUCTIONS = `This server provides access to Jamf official documentation (learn.jamf.com) for Jamf Pro, Jamf School, Jamf Connect, and Jamf Protect.

## Tool Usage Order
1. Use jamf_docs_list_products to discover available products and versions.
2. Use jamf_docs_search to find relevant articles by keyword. Always search before fetching a full article.
3. Use jamf_docs_get_article to retrieve full content of a specific article found via search.
4. Use jamf_docs_get_toc to browse the table of contents for a product.

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

// Create server instance
const server = new McpServer(
  {
    name: 'jamf-docs-mcp-server',
    version: SERVER_VERSION,
    icons: [{ src: SERVER_ICON, mimeType: 'image/png', sizes: ['32x32'] }],
  },
  {
    instructions: SERVER_INSTRUCTIONS,
  },
);

// Register all tools
registerListProductsTool(server);
registerSearchTool(server);
registerGetArticleTool(server);
registerGetTocTool(server);

// Register resources
registerResources(server);

// Register prompts
registerPrompts(server);

// Start server
async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));

  if (args.transport === 'http') {
    const { startHttpServer } = await import('./transport/http.js');
    await startHttpServer(server, args.port, args.host);
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);

    console.error('Jamf Docs MCP Server running on stdio');
    console.error('Available tools: jamf_docs_list_products, jamf_docs_search, jamf_docs_get_article, jamf_docs_get_toc');
    console.error('Available resources: jamf://products, jamf://topics');
    console.error('Available prompts: jamf_troubleshoot, jamf_setup_guide, jamf_compare_versions');
  }
}

main().catch((error: unknown) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
