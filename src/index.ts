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

// Create server instance
const server = new McpServer({
  name: 'jamf-docs-mcp-server',
  version: '1.0.0',
});

// Register all tools
registerListProductsTool(server);
registerSearchTool(server);
registerGetArticleTool(server);
registerGetTocTool(server);

// Register resources
registerResources(server);

// Start server
async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr (not stdout, which is used for MCP protocol)
  console.error('Jamf Docs MCP Server running on stdio');
  console.error('Available tools: jamf_docs_list_products, jamf_docs_search, jamf_docs_get_article, jamf_docs_get_toc');
  console.error('Available resources: jamf://products, jamf://topics');
}

main().catch((error: unknown) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
