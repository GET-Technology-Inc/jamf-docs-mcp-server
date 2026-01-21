/**
 * jamf_docs_get_toc tool
 * Get the table of contents for a Jamf product's documentation.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GetTocInputSchema } from '../schemas/index.js';
import type { ProductId } from '../constants.js';
import { ResponseFormat, JAMF_PRODUCTS, TOKEN_CONFIG } from '../constants.js';
import type { ToolResult, TocResponse } from '../types.js';
import { fetchTableOfContents } from '../services/scraper.js';

const TOOL_NAME = 'jamf_docs_get_toc';

const TOOL_DESCRIPTION = `Get the table of contents for a Jamf product's documentation.

This tool retrieves the navigation structure for a specific Jamf product,
allowing you to browse available documentation topics.

Args:
  - product (string, required): Product ID - one of: jamf-pro, jamf-school, jamf-connect, jamf-protect
  - version (string, optional): Specific version (defaults to latest)
  - page (number, optional): Page number for pagination 1-100 (default: 1)
  - maxTokens (number, optional): Maximum tokens in response 100-20000 (default: 5000)
  - responseFormat ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  For JSON format:
  {
    "product": string,
    "version": string,
    "toc": [...],
    "tokenInfo": {
      "tokenCount": number,
      "truncated": boolean,
      "maxTokens": number
    },
    "pagination": {
      "page": number,
      "pageSize": number,
      "totalPages": number,
      "totalItems": number,
      "hasNext": boolean,
      "hasPrev": boolean
    }
  }

  For Markdown format:
  A hierarchical list of documentation topics with pagination and token info.

Examples:
  - Browse Jamf Pro documentation: product="jamf-pro"
  - Get page 2 of TOC: product="jamf-pro", page=2
  - Limit response size: product="jamf-pro", maxTokens=2000

Errors:
  - "Invalid product ID" if the product is not recognized
  - "Version not found" if the specified version doesn't exist

Note: Use this to discover what topics are available before searching
or retrieving specific articles. Large TOCs are paginated.`;

export function registerGetTocTool(server: McpServer): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: 'Get Documentation Table of Contents',
      description: TOOL_DESCRIPTION,
      inputSchema: GetTocInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (args): Promise<ToolResult> => {
      // Parse and validate input
      const parseResult = GetTocInputSchema.safeParse(args);
      if (!parseResult.success) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Invalid input: ${parseResult.error.message}` }]
        };
      }
      const params = parseResult.data;

      try {
        // Validate product
        if (!(params.product in JAMF_PRODUCTS)) {
          return {
            isError: true,
            content: [{
              type: 'text',
              text: `Invalid product ID: "${params.product}".\n\nValid options:\n${Object.entries(JAMF_PRODUCTS).map(([id, p]) => `- \`${id}\`: ${p.name}`).join('\n')}`
            }]
          };
        }

        const productId = params.product as ProductId;
        const productInfo = JAMF_PRODUCTS[productId];
        const version = params.version ?? productInfo.latestVersion;

        // Validate version
        if (params.version && !(productInfo.versions as readonly string[]).includes(params.version)) {
          return {
            isError: true,
            content: [{
              type: 'text',
              text: `Version "${params.version}" not found for ${productInfo.name}.\n\nAvailable versions: ${productInfo.versions.join(', ')}`
            }]
          };
        }

        // Fetch TOC with pagination and token options
        const tocResult = await fetchTableOfContents(productId, version, {
          ...(params.page !== undefined && { page: params.page }),
          maxTokens: params.maxTokens ?? TOKEN_CONFIG.DEFAULT_MAX_TOKENS
        });

        const { toc, pagination, tokenInfo } = tocResult;

        // Build response
        const response: TocResponse = {
          product: productInfo.name,
          version,
          toc,
          tokenInfo,
          pagination
        };

        // Format output
        if (params.responseFormat === ResponseFormat.JSON) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(response, null, 2)
            }]
          };
        }

        // Markdown format with Context7 style
        let markdown = `# ${productInfo.name} Documentation\n\n`;
        markdown += `**Version**: ${version} | **Page ${pagination.page} of ${pagination.totalPages}** | ${tokenInfo.tokenCount.toLocaleString()} tokens\n\n`;
        markdown += '---\n\n';
        markdown += '## Table of Contents\n\n';

        // Recursive function to render TOC
        function renderTocEntry(entry: typeof toc[0], depth: number = 0): string {
          const indent = '  '.repeat(depth);
          let result = `${indent}- [${entry.title}](${entry.url})\n`;

          if (entry.children && entry.children.length > 0) {
            for (const child of entry.children) {
              result += renderTocEntry(child, depth + 1);
            }
          }

          return result;
        }

        for (const entry of toc) {
          markdown += renderTocEntry(entry);
        }

        // Pagination footer
        markdown += '\n---\n\n';
        markdown += `**Page ${pagination.page} of ${pagination.totalPages}** (${tokenInfo.tokenCount.toLocaleString()} tokens, ${pagination.totalItems} total entries)`;
        if (pagination.hasNext) {
          markdown += ` | Use \`page=${pagination.page + 1}\` for more`;
        }
        if (tokenInfo.truncated) {
          markdown += '\n*TOC truncated due to token limit. Use `page` parameter or increase `maxTokens`.*';
        }

        markdown += '\n\n*Use `jamf_docs_get_article` with any URL above to read the full content.*\n';

        return {
          content: [{
            type: 'text',
            text: markdown
          }]
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        return {
          isError: true,
          content: [{
            type: 'text',
            text: `Error fetching table of contents: ${errorMessage}`
          }]
        };
      }
    }
  );
}
