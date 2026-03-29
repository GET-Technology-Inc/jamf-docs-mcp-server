/**
 * jamf_docs_search tool
 * Search Jamf documentation for articles matching a query.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SearchInputSchema } from '../schemas/index.js';
import { SearchOutputSchema } from '../schemas/output.js';
import type { ProductId, TopicId, DocTypeId, LocaleId } from '../constants.js';
import { ResponseFormat, OutputMode, JAMF_PRODUCTS, JAMF_TOPICS, TOKEN_CONFIG, DEFAULT_LOCALE } from '../constants.js';
import type { ToolResult, SearchResponse, SearchResult, PaginationInfo, TokenInfo } from '../types.js';
import { searchDocumentation } from '../services/scraper.js';
import { generateSearchSuggestions, formatSearchSuggestions } from '../services/search-suggestions.js';
import { sanitizeMarkdownText, sanitizeMarkdownUrl, getSafeErrorMessage } from '../utils/sanitize.js';

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
  let output = `### [${sanitizeMarkdownText(result.title)}](${sanitizeMarkdownUrl(result.url)})\n\n`;
  output += `> ${sanitizeMarkdownText(result.snippet)}\n\n`;
  if ((result.product !== null && result.product !== '') || result.version !== undefined) {
    const meta: string[] = [];
    if (result.product !== null && result.product !== '') {
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
  return `${index}. [${sanitizeMarkdownText(result.title)}](${sanitizeMarkdownUrl(result.url)}) - ${sanitizeMarkdownText(snippetPreview)}\n`;
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
Jamf School, Jamf Connect, Jamf Protect, Jamf Now, Jamf Safe Internet, and more.
Results include article titles, snippets, and direct links.

Args:
  - query (string, required): Search keywords (2-200 characters)
  - product (string, optional): Filter by product ID (use jamf_docs_list_products to see all)
  - topic (string, optional): Filter by topic (enrollment, profiles, security, inventory, policies, smart-groups, apps, identity, api, network)
  - docType (string, optional): Filter by document type: documentation, release-notes, training, solution-guide, glossary, getting-started
  - version (string, optional): Filter by version (e.g., "11.5.0", "10.x")
  - limit (number, optional): Maximum results per page 1-50 (default: 10)
  - page (number, optional): Page number for pagination 1-100 (default: 1)
  - maxTokens (number, optional): Maximum tokens in response 100-50000 (default: 5000)
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

/**
 * Build structured content for a search result set
 */
function buildSearchStructuredContent(
  query: string,
  results: SearchResult[],
  pagination: PaginationInfo,
  extras?: {
    filterRelaxation?: { removed: string[]; original: Record<string, string>; message: string } | undefined;
    truncatedContent?: { omittedCount: number; omittedItems: { title: string; estimatedTokens: number }[] } | undefined;
  }
): Record<string, unknown> {
  return {
    query,
    totalResults: pagination.totalItems,
    page: pagination.page,
    totalPages: pagination.totalPages,
    hasMore: pagination.hasNext,
    results: results.map(r => ({
      title: r.title,
      url: r.url,
      snippet: r.snippet,
      product: r.product ?? '',
      ...(r.version !== undefined ? { version: r.version } : {}),
      ...(r.docType !== undefined ? { docType: r.docType } : {})
    })),
    ...(extras?.filterRelaxation !== undefined ? { filterRelaxation: extras.filterRelaxation } : {}),
    ...(extras?.truncatedContent !== undefined ? { truncatedContent: extras.truncatedContent } : {})
  };
}

/**
 * Build no-results response with suggestions
 */
function buildNoResultsResponse(
  query: string,
  hasProductFilter: boolean,
  hasTopicFilter: boolean,
  locale: LocaleId | undefined
): ToolResult {
  const suggestions = generateSearchSuggestions(query, hasProductFilter, hasTopicFilter);

  const suggestionTexts = [
    ...(locale !== undefined && locale !== DEFAULT_LOCALE
      ? [`Not all documentation is available in "${locale}". Try searching with language: "${DEFAULT_LOCALE}".`]
      : []),
    ...(suggestions.simplifiedQuery !== null ? [`Try: ${suggestions.simplifiedQuery}`] : []),
    ...suggestions.alternativeKeywords,
    ...suggestions.tips
  ];

  return {
    content: [{
      type: 'text',
      text: formatSearchSuggestions(query, suggestions)
    }],
    structuredContent: {
      query,
      totalResults: 0,
      page: 1,
      totalPages: 0,
      hasMore: false,
      results: [],
      suggestions: suggestionTexts
    }
  };
}

/**
 * Append filter/version/truncation notices to markdown output
 */
function appendMarkdownNotices(
  markdown: string,
  filterRelaxation?: { message: string },
  versionNote?: string,
  truncatedContent?: { omittedCount: number }
): string {
  let result = markdown;
  if (filterRelaxation !== undefined) {
    result += `\n> **Note:** ${filterRelaxation.message}\n`;
  }
  if (versionNote !== undefined) {
    result += `\n> **Version Note:** ${versionNote}\n`;
  }
  if (truncatedContent !== undefined && truncatedContent.omittedCount > 0) {
    result += `\n*${truncatedContent.omittedCount} additional result(s) omitted due to token limit.*\n`;
  }
  return result;
}

/**
 * Build search filters from params
 */
function buildSearchFilters(params: { product?: string | undefined; version?: string | undefined; topic?: string | undefined }): SearchFilters {
  return {
    ...(params.product !== undefined ? { product: params.product } : {}),
    ...(params.version !== undefined ? { version: params.version } : {}),
    ...(params.topic !== undefined ? { topic: params.topic } : {})
  };
}

export function registerSearchTool(server: McpServer): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: 'Search Jamf Documentation',
      description: TOOL_DESCRIPTION,
      inputSchema: SearchInputSchema,
      outputSchema: SearchOutputSchema,
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
        if (params.product !== undefined && !(params.product in JAMF_PRODUCTS)) {
          return {
            isError: true,
            content: [{
              type: 'text',
              text: `Invalid product ID: "${params.product}". Valid options: ${Object.keys(JAMF_PRODUCTS).join(', ')}`
            }]
          };
        }

        if (params.topic !== undefined && !(params.topic in JAMF_TOPICS)) {
          return {
            isError: true,
            content: [{
              type: 'text',
              text: `Invalid topic ID: "${params.topic}". Valid options: ${Object.keys(JAMF_TOPICS).join(', ')}`
            }]
          };
        }

        // Perform search
        const searchResult = await searchDocumentation({
          query: params.query,
          product: params.product as ProductId | undefined,
          topic: params.topic as TopicId | undefined,
          docType: params.docType as DocTypeId | undefined,
          language: params.language as LocaleId | undefined,
          version: params.version,
          limit: params.limit,
          page: params.page,
          maxTokens: params.maxTokens ?? TOKEN_CONFIG.DEFAULT_MAX_TOKENS
        });

        const { results, pagination, tokenInfo, filterRelaxation, versionNote, truncatedContent } = searchResult;

        // Build response
        const filters = buildSearchFilters(params);
        const response: SearchResponse = {
          total: pagination.totalItems,
          query: params.query,
          results,
          filters,
          tokenInfo,
          pagination,
          ...(filterRelaxation !== undefined ? { filterRelaxation } : {}),
          ...(versionNote !== undefined ? { versionNote } : {}),
          ...(truncatedContent !== undefined ? { truncatedContent } : {})
        };

        // Handle no results with suggestions
        if (results.length === 0 && pagination.totalItems === 0) {
          return buildNoResultsResponse(
            params.query,
            params.product !== undefined,
            params.topic !== undefined,
            params.language as LocaleId | undefined
          );
        }

        const structuredContent = buildSearchStructuredContent(
          params.query, results, pagination,
          { filterRelaxation, truncatedContent }
        );

        if (params.responseFormat === ResponseFormat.JSON) {
          // Add relevance note only in JSON format
          const jsonResponse = {
            ...response,
            relevanceNote: 'Relevance scores are provided by the Zoomin Search API based on text matching. Higher values indicate stronger keyword matches.'
          };
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(jsonResponse, null, 2)
            }],
            structuredContent: {
              ...structuredContent,
              relevanceNote: jsonResponse.relevanceNote
            }
          };
        }

        // Markdown format (full or compact)
        const formatFn = params.outputMode === OutputMode.COMPACT
          ? formatSearchResultsAsCompact
          : formatSearchResultsAsMarkdown;
        const markdown = appendMarkdownNotices(
          formatFn(params.query, results, filters, pagination, tokenInfo),
          filterRelaxation, versionNote, truncatedContent
        );

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
            text: `Search error: ${getSafeErrorMessage(error)}\n\nPlease try again or use different search terms.`
          }]
        };
      }
    }
  );
}
