/**
 * jamf_docs_search tool
 * Search Jamf documentation for articles matching a query.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SearchInputSchema } from '../schemas/index.js';
import type { ProductId, TopicId } from '../constants.js';
import { ResponseFormat, OutputMode, JAMF_PRODUCTS, JAMF_TOPICS, TOKEN_CONFIG } from '../constants.js';
import type { ToolResult, SearchResponse, SearchResult, PaginationInfo, TokenInfo } from '../types.js';
import { searchDocumentation } from '../services/scraper.js';
import { generateSearchSuggestions, formatSearchSuggestions } from '../services/search-suggestions.js';

interface SearchFilters {
  product?: string;
  version?: string;
  topic?: string;
}

function formatFiltersLine(filters: SearchFilters): string {
  const parts: string[] = [];
  if (filters.product !== undefined) {
    parts.push(`product: ${filters.product}`);
  }
  if (filters.topic !== undefined) {
    parts.push(`topic: ${filters.topic}`);
  }
  if (filters.version !== undefined) {
    parts.push(`version: ${filters.version}`);
  }
  return parts.length > 0 ? `\n*Filtered by: ${parts.join(', ')}*` : '';
}

function formatSearchResult(result: SearchResult): string {
  let output = `### [${result.title}](${result.url})\n\n`;
  output += `> ${result.snippet}\n\n`;
  if (result.product !== '' || result.version !== undefined) {
    const meta: string[] = [];
    if (result.product !== '') {
      meta.push(`**Product**: ${result.product}`);
    }
    if (result.version !== undefined) {
      meta.push(`**Version**: ${result.version}`);
    }
    output += `${meta.join(' | ')}\n\n`;
  }
  output += '---\n\n';
  return output;
}

function formatPaginationFooter(pagination: PaginationInfo, tokenInfo: TokenInfo, compact = false): string {
  if (compact) {
    let footer = `\n---\n*Page ${pagination.page}/${pagination.totalPages}`;
    if (pagination.hasNext) {
      footer += ` | page=${pagination.page + 1} for more`;
    }
    footer += '*\n';
    return footer;
  }

  let footer = `**Page ${pagination.page} of ${pagination.totalPages}** (${tokenInfo.tokenCount.toLocaleString()} tokens)`;
  if (pagination.hasNext) {
    footer += ` | Use \`page=${pagination.page + 1}\` for more results`;
  }
  if (tokenInfo.truncated) {
    footer += '\n*Results truncated due to token limit. Use a smaller `limit` or increase `maxTokens`.*';
  }
  footer += '\n\n*Use `jamf_docs_get_article` with any URL above to read the full article.*\n';
  return footer;
}

/**
 * Format search result in compact mode (single line)
 */
function formatSearchResultCompact(result: SearchResult, index: number): string {
  // Truncate snippet for compact display
  const snippetPreview = result.snippet.length > 80
    ? `${result.snippet.slice(0, 77)}...`
    : result.snippet;
  return `${index}. [${result.title}](${result.url}) - ${snippetPreview}\n`;
}

/**
 * Format search results as compact markdown
 */
function formatSearchResultsAsCompact(
  query: string,
  results: SearchResult[],
  filters: SearchFilters,
  pagination: PaginationInfo,
  tokenInfo: TokenInfo
): string {
  let markdown = `## "${query}" (${pagination.totalItems} results)\n`;
  markdown += formatFiltersLine(filters);
  markdown += '\n\n';

  results.forEach((result, idx) => {
    markdown += formatSearchResultCompact(result, (pagination.page - 1) * pagination.pageSize + idx + 1);
  });

  markdown += formatPaginationFooter(pagination, tokenInfo, true);
  return markdown;
}

function formatSearchResultsAsMarkdown(
  query: string,
  results: SearchResult[],
  filters: SearchFilters,
  pagination: PaginationInfo,
  tokenInfo: TokenInfo
): string {
  let markdown = `# Search Results for "${query}"\n\n`;
  markdown += `Found ${pagination.totalItems} result(s) | **Page ${pagination.page} of ${pagination.totalPages}** | ${tokenInfo.tokenCount.toLocaleString()} tokens`;
  markdown += formatFiltersLine(filters);
  markdown += '\n\n---\n\n';

  for (const result of results) {
    markdown += formatSearchResult(result);
  }

  markdown += formatPaginationFooter(pagination, tokenInfo);
  return markdown;
}

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
  - outputMode ('full' | 'compact'): Output detail level (default: 'full'). Use 'compact' for brief, token-efficient output
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
        if (params.product !== undefined && !(params.product in JAMF_PRODUCTS)) {
          return {
            isError: true,
            content: [{
              type: 'text',
              text: `Invalid product ID: "${params.product}". Valid options: ${Object.keys(JAMF_PRODUCTS).join(', ')}`
            }]
          };
        }

        // Validate topic if provided
        if (params.topic !== undefined && !(params.topic in JAMF_TOPICS)) {
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
            ...(params.product !== undefined ? { product: params.product } : {}),
            ...(params.version !== undefined ? { version: params.version } : {}),
            ...(params.topic !== undefined ? { topic: params.topic } : {})
          },
          tokenInfo,
          pagination
        };

        // Handle no results with suggestions
        if (results.length === 0 && pagination.totalItems === 0) {
          const suggestions = generateSearchSuggestions(
            params.query,
            params.product !== undefined,
            params.topic !== undefined
          );

          return {
            content: [{
              type: 'text',
              text: formatSearchSuggestions(params.query, suggestions)
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

        // Markdown format (full or compact)
        const markdown = params.outputMode === OutputMode.COMPACT
          ? formatSearchResultsAsCompact(
              params.query,
              results,
              response.filters ?? {},
              pagination,
              tokenInfo
            )
          : formatSearchResultsAsMarkdown(
              params.query,
              results,
              response.filters ?? {},
              pagination,
              tokenInfo
            );

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
