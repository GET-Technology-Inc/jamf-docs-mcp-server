/**
 * jamf_docs_list_products tool
 * Lists all available Jamf products and their documentation versions.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ListProductsInputSchema } from '../schemas/index.js';
import { ProductListOutputSchema } from '../schemas/output.js';
import { JAMF_PRODUCTS, JAMF_TOPICS, DOC_TYPES, ResponseFormat, OutputMode, TOKEN_CONFIG } from '../constants.js';
import type { ToolResult } from '../types.js';
import { estimateTokens, createTokenInfo } from '../services/tokenizer.js';
import { getSafeErrorMessage } from '../utils/sanitize.js';

const TOOL_NAME = 'jamf_docs_list_products';

const TOOL_DESCRIPTION = `List all available Jamf products, topics, and their documentation versions.

This tool returns information about all Jamf products with available documentation,
including Jamf Pro, Jamf School, Jamf Connect, Jamf Protect, Jamf Now, Jamf Safe Internet,
and more. Also lists available topic and docType filters for search.

Args:
  - maxTokens (number, optional): Maximum tokens in response 100-20000 (default: 5000)
  - outputMode ('full' | 'compact'): Output detail level (default: 'full'). Use 'compact' for brief list
  - responseFormat ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  For JSON format:
  {
    "products": [...],
    "topics": [...],
    "tokenInfo": {
      "tokenCount": number,
      "truncated": boolean,
      "maxTokens": number
    }
  }

  For Markdown format:
  A formatted list of products and topics with their details.

Examples:
  - "What Jamf products are available?" → use this tool
  - "List all Jamf documentation" → use this tool
  - "What topics can I filter by?" → use this tool

Note: This is a read-only operation that does not modify any state.`;

export function registerListProductsTool(server: McpServer): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: 'List Jamf Products',
      description: TOOL_DESCRIPTION,
      inputSchema: ListProductsInputSchema,
      outputSchema: ProductListOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    (args): ToolResult => {
      // Parse and validate input
      const parseResult = ListProductsInputSchema.safeParse(args);
      if (!parseResult.success) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Invalid input: ${parseResult.error.message}` }]
        };
      }
      const params = parseResult.data;
      const maxTokens = params.maxTokens ?? TOKEN_CONFIG.DEFAULT_MAX_TOKENS;

      try {
        // Build product list
        const products = Object.values(JAMF_PRODUCTS).map(product => ({
          id: product.id,
          name: product.name,
          description: product.description,
          currentVersion: product.latestVersion,
          availableVersions: [...product.versions]
        }));

        // Build topics list
        const topics = Object.entries(JAMF_TOPICS).map(([id, topic]) => ({
          id,
          name: topic.name,
          keywords: topic.keywords
        }));

        const structuredContent = { products, topics };

        if (params.responseFormat === ResponseFormat.JSON) {
          const jsonData = JSON.stringify(structuredContent);
          const jsonOutput = JSON.stringify({
            ...structuredContent,
            tokenInfo: createTokenInfo(jsonData, maxTokens)
          }, null, 2);

          return {
            content: [{
              type: 'text',
              text: jsonOutput
            }],
            structuredContent
          };
        }

        // Compact mode: minimal output
        if (params.outputMode === OutputMode.COMPACT) {
          let markdown = '## Products\n';
          for (const product of products) {
            markdown += `- \`${product.id}\`: ${product.name}\n`;
          }
          markdown += '\n## Topics\n';
          for (const topic of topics) {
            markdown += `- \`${topic.id}\`: ${topic.name}\n`;
          }
          return {
            content: [{
              type: 'text',
              text: markdown
            }],
            structuredContent
          };
        }

        // Full markdown format
        let markdown = '# Jamf Documentation Products\n\n';

        for (const product of products) {
          markdown += `## ${product.name}\n\n`;
          markdown += `- **ID**: \`${product.id}\`\n`;
          markdown += `- **Description**: ${product.description}\n`;
          markdown += `- **Current Version**: ${product.currentVersion}\n`;
          markdown += `- **Available Versions**: ${product.availableVersions.join(', ')}\n\n`;
        }

        markdown += '---\n\n';
        markdown += '# Available Topics for Filtering\n\n';
        markdown += 'Use these topic IDs with the `topic` parameter in `jamf_docs_search`:\n\n';

        for (const topic of topics) {
          markdown += `- **\`${topic.id}\`**: ${topic.name}\n`;
          markdown += `  *Keywords: ${topic.keywords.slice(0, 4).join(', ')}${topic.keywords.length > 4 ? '...' : ''}*\n`;
        }

        markdown += '\n---\n\n';
        markdown += '# Document Types for Filtering\n\n';
        markdown += 'Use `docType` parameter in `jamf_docs_search` to filter by document type:\n\n';
        for (const [id, dt] of Object.entries(DOC_TYPES)) {
          markdown += `- **\`${id}\`**: ${dt.description}\n`;
        }

        markdown += '\n---\n\n';

        // Token info
        const tokenCount = estimateTokens(markdown);
        markdown += `*${tokenCount.toLocaleString()} tokens*\n\n`;

        markdown += '*Use `jamf_docs_search` to search within these products, ';
        markdown += 'or `jamf_docs_get_toc` to browse the table of contents.*\n';

        return {
          content: [{
            type: 'text',
            text: markdown
          }],
          structuredContent
        };
      } catch (error) {
        return {
          isError: true,
          content: [{
            type: 'text',
            text: `Error listing products: ${getSafeErrorMessage(error)}`
          }]
        };
      }
    }
  );
}
