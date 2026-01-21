/**
 * jamf_docs_search tool
 * Search Jamf documentation for articles matching a query.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SearchInputSchema } from '../schemas/index.js';
import type { ProductId, TopicId } from '../constants.js';
import { ResponseFormat, JAMF_PRODUCTS, JAMF_TOPICS, TOKEN_CONFIG } from '../constants.js';
import type { ToolResult, SearchResponse } from '../types.js';
import { searchDocumentation } from '../services/scraper.js';

const TOOL_NAME = 'jamf_docs_search';

const TOOL_DESCRIPTION = `Search Jamf documentation for articles matching your query.

This tool searches across all Jamf product documentation including Jamf Pro,
Jamf School, Jamf Connect, and Jamf Protect. Results include article titles,
snippets, and direct links.

Args:
  - query (string, required): Search keywords (2-200 characters)
  - product (string, optional): Filter by product ID (jamf-pro, jamf-school, jamf-connect, jamf-protect)
  - topic (string, optional): Filter by topic (enrollment, profiles, security, inventory, policies, smart-groups, apps, identity, api, network)
  - version (string, optional): Filter by version (e.g., "11.5.0", "10.x")
  - limit (number, optional): Maximum results per page 1-50 (default: 10)
  - page (number, optional): Page number for pagination 1-100 (default: 1)
  - maxTokens (number, optional): Maximum tokens in response 100-20000 (default: 5000)
  - responseFormat ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  For JSON format:
  {
    "total": number,
    "query": string,
    "results": [...],
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
  A formatted list of search results with pagination and token info.

Examples:
  - "How to configure SSO" → query="SSO configuration"
  - "MDM enrollment steps" → query="MDM enrollment", topic="enrollment"
  - "Jamf Pro configuration profiles" → query="configuration profile", product="jamf-pro", topic="profiles"
  - Get page 2 of results → query="policy", page=2

Errors:
  - "No results found" if search returns empty
  - "Invalid product ID" if product parameter is not recognized

Note: Results are ranked by relevance. Use filters and pagination to navigate large result sets.`;

export function registerSearchTool(server: McpServer): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: 'Search Jamf Documentation',
      description: TOOL_DESCRIPTION,
      inputSchema: SearchInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (args): Promise<ToolResult> => {
      // Parse and validate input
      const parseResult = SearchInputSchema.safeParse(args);
      if (!parseResult.success) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Invalid input: ${parseResult.error.message}` }]
        };
      }
      const params = parseResult.data;

      try {
        // Validate product if provided
        if (params.product && !(params.product in JAMF_PRODUCTS)) {
          return {
            isError: true,
            content: [{
              type: 'text',
              text: `Invalid product ID: "${params.product}". Valid options: ${Object.keys(JAMF_PRODUCTS).join(', ')}`
            }]
          };
        }

        // Validate topic if provided
        if (params.topic && !(params.topic in JAMF_TOPICS)) {
          return {
            isError: true,
            content: [{
              type: 'text',
              text: `Invalid topic ID: "${params.topic}". Valid options: ${Object.keys(JAMF_TOPICS).join(', ')}`
            }]
          };
        }

        // Perform search with new parameters
        const searchResult = await searchDocumentation({
          query: params.query,
          product: params.product as ProductId | undefined,
          topic: params.topic as TopicId | undefined,
          version: params.version,
          limit: params.limit,
          page: params.page,
          maxTokens: params.maxTokens ?? TOKEN_CONFIG.DEFAULT_MAX_TOKENS
        });

        const { results, pagination, tokenInfo } = searchResult;

        // Build response
        const response: SearchResponse = {
          total: pagination.totalItems,
          query: params.query,
          results,
          filters: {
            ...(params.product && { product: params.product }),
            ...(params.version && { version: params.version }),
            ...(params.topic && { topic: params.topic })
          },
          tokenInfo,
          pagination
        };

        // Handle no results
        if (results.length === 0 && pagination.totalItems === 0) {
          const filterInfo: string[] = [];
          if (params.product) {filterInfo.push(`product: ${JAMF_PRODUCTS[params.product as ProductId].name}`);}
          if (params.topic) {filterInfo.push(`topic: ${JAMF_TOPICS[params.topic as TopicId].name}`);}
          const filterStr = filterInfo.length > 0 ? ` (filtered by ${filterInfo.join(', ')})` : '';

          return {
            content: [{
              type: 'text',
              text: `No results found for "${params.query}"${filterStr}.\n\nTry:\n- Using different keywords\n- Removing filters\n- Checking spelling`
            }]
          };
        }

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
        let markdown = `# Search Results for "${params.query}"\n\n`;
        markdown += `Found ${pagination.totalItems} result(s) | **Page ${pagination.page} of ${pagination.totalPages}** | ${tokenInfo.tokenCount.toLocaleString()} tokens`;

        if (response.filters?.product || response.filters?.version || response.filters?.topic) {
          const filters: string[] = [];
          if (response.filters.product) {filters.push(`product: ${response.filters.product}`);}
          if (response.filters.topic) {filters.push(`topic: ${response.filters.topic}`);}
          if (response.filters.version) {filters.push(`version: ${response.filters.version}`);}
          markdown += `\n*Filtered by: ${filters.join(', ')}*`;
        }
        markdown += '\n\n---\n\n';

        for (const result of results) {
          markdown += `### [${result.title}](${result.url})\n\n`;
          markdown += `> ${result.snippet}\n\n`;
          if (result.product || result.version) {
            const meta: string[] = [];
            if (result.product) {meta.push(`**Product**: ${result.product}`);}
            if (result.version) {meta.push(`**Version**: ${result.version}`);}
            markdown += `${meta.join(' | ')}\n\n`;
          }
          markdown += '---\n\n';
        }

        // Pagination footer
        markdown += `**Page ${pagination.page} of ${pagination.totalPages}** (${tokenInfo.tokenCount.toLocaleString()} tokens)`;
        if (pagination.hasNext) {
          markdown += ` | Use \`page=${pagination.page + 1}\` for more results`;
        }
        if (tokenInfo.truncated) {
          markdown += '\n*Results truncated due to token limit. Use a smaller `limit` or increase `maxTokens`.*';
        }

        markdown += '\n\n*Use `jamf_docs_get_article` with any URL above to read the full article.*\n';

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
            text: `Search error: ${errorMessage}\n\nPlease try again or use different search terms.`
          }]
        };
      }
    }
  );
}
