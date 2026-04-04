/**
 * jamf_docs_get_toc tool
 * Get the table of contents for a Jamf product's documentation.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerContext } from '../types/context.js';
import { GetTocInputSchema } from '../schemas/index.js';
import { reportProgress } from '../utils/progress.js';
import { TocOutputSchema } from '../schemas/output.js';
import type { ProductId, LocaleId } from '../constants.js';
import { ResponseFormat, OutputMode, JAMF_PRODUCTS, TOKEN_CONFIG } from '../constants.js';
import type { ToolResult, TocResponse, TocEntry, PaginationInfo, TokenInfo } from '../types.js';
import { fetchTableOfContents } from '../services/toc-service.js';
import { getAvailableVersions } from '../services/metadata.js';
import { sanitizeMarkdownText, sanitizeMarkdownUrl, getSafeErrorMessage } from '../utils/sanitize.js';

/**
 * Render a single TOC entry as markdown
 */
function renderTocEntry(entry: TocEntry, depth = 0, compact = false): string {
  const indent = '  '.repeat(depth);
  let result = `${indent}- [${sanitizeMarkdownText(entry.title)}](${sanitizeMarkdownUrl(entry.url)})\n`;

  if (!compact && entry.children !== undefined && entry.children.length > 0) {
    for (const child of entry.children) {
      result += renderTocEntry(child, depth + 1, compact);
    }
  }

  return result;
}

/**
 * Format TOC as compact markdown
 */
function formatTocCompact(
  productName: string,
  toc: TocEntry[],
  pagination: PaginationInfo
): string {
  let markdown = `## ${productName} TOC (${pagination.totalItems} entries)\n\n`;

  for (const entry of toc) {
    markdown += renderTocEntry(entry, 0, true);
  }

  markdown += `\n---\n*Page ${pagination.page}/${pagination.totalPages}`;
  if (pagination.hasNext) {
    markdown += ` | page=${pagination.page + 1} for more`;
  }
  markdown += '*\n';

  return markdown;
}

/**
 * Format TOC as full markdown
 */
function formatTocFull(
  productName: string,
  version: string,
  toc: TocEntry[],
  pagination: PaginationInfo,
  tokenInfo: TokenInfo
): string {
  let markdown = `# ${productName} Documentation\n\n`;
  markdown += `**Version**: ${version} | **Page ${pagination.page} of ${pagination.totalPages}** | ${tokenInfo.tokenCount.toLocaleString()} tokens\n\n`;
  markdown += '---\n\n';
  markdown += '## Table of Contents\n\n';

  for (const entry of toc) {
    markdown += renderTocEntry(entry);
  }

  markdown += '\n---\n\n';
  markdown += `**Page ${pagination.page} of ${pagination.totalPages}** (${tokenInfo.tokenCount.toLocaleString()} tokens, ${pagination.totalItems} total entries)`;
  if (pagination.hasNext) {
    markdown += ` | Use \`page=${pagination.page + 1}\` for more`;
  }
  if (tokenInfo.truncated) {
    markdown += '\n*TOC truncated due to token limit. Use `page` parameter or increase `maxTokens`.*';
  }
  markdown += '\n\n*Use `jamf_docs_get_article` with any URL above to read the full content.*\n';

  return markdown;
}

/**
 * Flatten nested TOC entries into a flat list
 */
function flattenTocEntries(entries: TocEntry[]): { title: string; url: string }[] {
  const flat: { title: string; url: string }[] = [];
  for (const entry of entries) {
    flat.push({ title: entry.title, url: entry.url });
    if (entry.children !== undefined && entry.children.length > 0) {
      flat.push(...flattenTocEntries(entry.children));
    }
  }
  return flat;
}

const TOOL_NAME = 'jamf_docs_get_toc';

const TOOL_DESCRIPTION = `Get the table of contents for a Jamf product's documentation.

This tool retrieves the navigation structure for a specific Jamf product,
allowing you to browse available documentation topics.

Args:
  - product (string, required): Product ID - one of: jamf-pro, jamf-school, jamf-connect, jamf-protect
  - version (string, optional): Specific version (defaults to latest)
  - page (number, optional): Page number for pagination 1-100 (default: 1)
  - maxTokens (number, optional): Maximum tokens in response 100-50000 (default: 5000)
  - outputMode ('full' | 'compact'): Output detail level (default: 'full'). Use 'compact' for flat list without nested children
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

/**
 * Determine the version transparency note if a specific version was requested
 */
function getVersionNote(requestedVersion: string | undefined): string | undefined {
  if (requestedVersion !== undefined && requestedVersion !== '' && requestedVersion !== 'current') {
    return 'The Jamf documentation API only provides current version content. Results shown are from the latest version.';
  }
  return undefined;
}

/**
 * Attach versionNote to structured content if present
 */
function withVersionNote<T extends object>(content: T, versionNote: string | undefined): T & { versionNote?: string } {
  if (versionNote !== undefined) {
    return { ...content, versionNote };
  }
  return content as T & { versionNote?: string };
}

export function registerGetTocTool(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: 'Get Documentation Table of Contents',
      description: TOOL_DESCRIPTION,
      inputSchema: GetTocInputSchema,
      outputSchema: TocOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (args, extra): Promise<ToolResult> => {
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

        // Get available versions dynamically
        const availableVersions = await getAvailableVersions(ctx, productId);
        const version = params.version ?? 'current';

        // Validate version if specified
        if (params.version !== undefined && params.version !== '' && params.version !== 'current') {
          if (availableVersions.length > 0 && !availableVersions.includes(params.version)) {
            return {
              isError: true,
              content: [{
                type: 'text',
                text: `Version "${params.version}" not found for ${productInfo.name}.\n\nAvailable versions: ${availableVersions.length > 0 ? availableVersions.join(', ') : 'current'}`
              }]
            };
          }
        }

        await reportProgress(extra, { progress: 0, total: 4, message: 'Fetching TOC...' });

        const tocResult = await fetchTableOfContents(ctx, productId, version, {
          ...(params.page !== undefined && { page: params.page }),
          maxTokens: params.maxTokens ?? TOKEN_CONFIG.DEFAULT_MAX_TOKENS,
          locale: params.language as LocaleId | undefined
        });

        await reportProgress(extra, { progress: 1, total: 4, message: 'Processing entries...' });

        const { toc, pagination, tokenInfo } = tocResult;

        // Build response
        const response: TocResponse = {
          product: productInfo.name,
          version,
          toc,
          tokenInfo,
          pagination
        };

        const structuredContent = {
          product: productInfo.name,
          version,
          totalEntries: pagination.totalItems,
          page: pagination.page,
          totalPages: pagination.totalPages,
          hasMore: pagination.hasNext,
          entries: flattenTocEntries(toc)
        };

        const versionNote = getVersionNote(params.version);

        await reportProgress(extra, { progress: 3, total: 4, message: 'Formatting output...' });

        if (params.responseFormat === ResponseFormat.JSON) {
          await reportProgress(extra, { progress: 4, total: 4 });
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(withVersionNote(response, versionNote), null, 2)
            }],
            structuredContent: withVersionNote(structuredContent, versionNote)
          };
        }

        // Format as markdown (compact or full)
        let markdown = params.outputMode === OutputMode.COMPACT
          ? formatTocCompact(productInfo.name, toc, pagination)
          : formatTocFull(productInfo.name, version, toc, pagination, tokenInfo);

        if (versionNote !== undefined) {
          markdown += `\n> **Version Note:** ${versionNote}\n`;
        }

        await reportProgress(extra, { progress: 4, total: 4 });
        return {
          content: [{
            type: 'text',
            text: markdown
          }],
          structuredContent: withVersionNote(structuredContent, versionNote)
        };
      } catch (error) {
        return {
          isError: true,
          content: [{
            type: 'text',
            text: `Error fetching table of contents: ${getSafeErrorMessage(error)}`
          }]
        };
      }
    }
  );
}
