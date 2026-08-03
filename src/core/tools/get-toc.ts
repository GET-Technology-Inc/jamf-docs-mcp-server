/**
 * jamf_docs_get_toc tool
 * Get the table of contents for a Jamf product's documentation.
 */

import type { McpServer } from '@modelcontextprotocol/server';
import type { ServerContext } from '../types/context.js';
import { appToolMeta } from '../apps/index.js';
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

/** Everything the full markdown renderer needs, passed as one bag. */
interface TocFullFormatInput {
  productName: string;
  version: string;
  /** Absent when the map could not be resolved; the header line then omits it. */
  mapId: string | undefined;
  toc: TocEntry[];
  pagination: PaginationInfo;
  tokenInfo: TokenInfo;
}

/**
 * Format TOC as full markdown
 */
function formatTocFull(input: TocFullFormatInput): string {
  const { productName, version, mapId, toc, pagination, tokenInfo } = input;
  let markdown = `# ${productName} Documentation\n\n`;
  markdown += `**Version**: ${version} | **Page ${pagination.page} of ${pagination.totalPages}** | ${tokenInfo.tokenCount.toLocaleString()} tokens`;
  // Half of the `mapId` + `contentId` pair `jamf_docs_get_article` documents.
  // One line for the whole page, unlike the per-entry `contentId`s, which stay
  // out of markdown — see the footer note below.
  if (mapId !== undefined && mapId !== '') {
    markdown += ` | **Map ID**: ${sanitizeMarkdownText(mapId)}`;
  }
  markdown += '\n\n';
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
  // Per-entry `contentId`s are deliberately not rendered inline: at roughly a
  // line's worth of tokens each they would push a full page past `maxTokens`,
  // and the truncation budget upstream is computed from titles alone, so the
  // reported token count would understate what was actually sent. They are
  // carried in the JSON body and in `structuredContent.entries` instead.
  markdown += '*Each entry\'s `contentId` — the other half of the `mapId` + `contentId` pair — is in the structured output; request `responseFormat="json"` to see it inline.*\n';

  return markdown;
}

/** One entry of the flattened `structuredContent.entries` list. */
interface FlatTocEntry {
  title: string;
  url: string;
  contentId?: string;
}

/**
 * Flatten nested TOC entries into a flat list.
 *
 * `contentId` rides along: paired with the response-level `mapId` it is what
 * `jamf_docs_get_article` documents as obtainable "from search results or
 * TOC". Dropping it here made that workflow impossible to perform from the
 * structured output, even though the value was already resolved.
 */
function flattenTocEntries(entries: TocEntry[]): FlatTocEntry[] {
  const flat: FlatTocEntry[] = [];
  for (const entry of entries) {
    flat.push({
      title: entry.title,
      url: entry.url,
      ...(entry.contentId !== undefined ? { contentId: entry.contentId } : {}),
    });
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
    "mapId": string,
    "toc": [...],   // each entry carries title, url and contentId
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
or retrieving specific articles. Large TOCs are paginated.
The response-level mapId and an entry's contentId together form the pair
jamf_docs_get_article accepts for a direct fetch. Markdown output shows the
mapId only; use responseFormat="json" (or read structuredContent) for the
per-entry contentIds.`;

/**
 * Determine the version transparency note if a specific version was requested.
 *
 * This used to fire for every `version !== 'current'` request and claim that
 * "the Jamf documentation API only provides current version content". That is
 * false: Jamf publishes a distinct map per version — jamf-pro 11.15.0 has its
 * own mapId and serves its own content — and `fetchTableOfContents` resolves
 * the map for the requested version, or throws. So the note told callers the
 * versioned TOC they were holding was really current content, which is the
 * opposite of what happened.
 *
 * The note now depends on the versions upstream actually publishes rather than
 * on the requested string: if the requested version is one of them, the TOC is
 * genuinely that version's and there is nothing to disclose.
 */
function getVersionNote(
  requestedVersion: string | undefined,
  availableVersions: string[],
): string | undefined {
  if (requestedVersion === undefined || requestedVersion === '' || requestedVersion === 'current') {
    return undefined;
  }
  if (availableVersions.includes(requestedVersion)) {
    return undefined;
  }
  return `Version "${requestedVersion}" is not among the versions Jamf publishes as its own documentation map, so these results may come from a different version.`;
}

/**
 * Notices that ride alongside a TOC payload rather than inside it.
 *
 * Both are optional and both are declared on `TocOutputSchema`, so a client
 * reading `structuredContent` sees whatever the markdown says.
 */
interface TocNotices {
  versionNote?: string | undefined;
  /** Set when `page` was clamped to the last available page. */
  paginationNote?: string | undefined;
}

/**
 * The notices that are actually set, as a plain bag ready to spread into
 * either the JSON response or `structuredContent`.
 */
function noticeFields(notices: TocNotices): Record<string, string> {
  return {
    ...(notices.versionNote !== undefined ? { versionNote: notices.versionNote } : {}),
    ...(notices.paginationNote !== undefined ? { paginationNote: notices.paginationNote } : {}),
  };
}

/**
 * Render the notices as markdown blockquotes, in the order they are declared.
 */
function renderTocNotices(notices: TocNotices): string {
  let rendered = '';
  if (notices.versionNote !== undefined) {
    rendered += `\n> **Version Note:** ${notices.versionNote}\n`;
  }
  if (notices.paginationNote !== undefined) {
    rendered += `\n> **Pagination Note:** ${notices.paginationNote}\n`;
  }
  return rendered;
}

export function registerGetTocTool(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: 'Get Documentation Table of Contents',
      description: TOOL_DESCRIPTION,
      inputSchema: GetTocInputSchema,
      outputSchema: TocOutputSchema,
      // Hosts supporting the MCP Apps extension render this result in the
      // shared viewer; others ignore the metadata and get the markdown.
      _meta: appToolMeta(),
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

        const { toc, pagination, tokenInfo, paginationNote, mapId } = tocResult;

        // Build response
        const response: TocResponse = {
          product: productInfo.name,
          version,
          ...(mapId !== undefined ? { mapId } : {}),
          toc,
          tokenInfo,
          pagination
        };

        const structuredContent = {
          product: productInfo.name,
          // The ID, not just the display name: a client paging through this
          // TOC has to pass `product` back, and that parameter is an enum of
          // IDs. Sending only the name made "next page" impossible.
          productId: params.product,
          version,
          // Pairs with each entry's `contentId` to form the direct-fetch pair
          // `jamf_docs_get_article` documents.
          ...(mapId !== undefined ? { mapId } : {}),
          totalEntries: pagination.totalItems,
          page: pagination.page,
          totalPages: pagination.totalPages,
          hasMore: pagination.hasNext,
          entries: flattenTocEntries(toc)
        };

        const notices: TocNotices = {
          // Two arguments, not one: the note is only truthful when the version
          // asked for is absent from the maps Jamf actually publishes.
          versionNote: getVersionNote(params.version, availableVersions),
          paginationNote
        };

        await reportProgress(extra, { progress: 3, total: 4, message: 'Formatting output...' });

        if (params.responseFormat === ResponseFormat.JSON) {
          await reportProgress(extra, { progress: 4, total: 4 });
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ ...response, ...noticeFields(notices) }, null, 2)
            }],
            structuredContent: { ...structuredContent, ...noticeFields(notices) }
          };
        }

        // Format as markdown (compact or full)
        const markdown = (params.outputMode === OutputMode.COMPACT
          ? formatTocCompact(productInfo.name, toc, pagination)
          : formatTocFull({ productName: productInfo.name, version, mapId, toc, pagination, tokenInfo }))
          + renderTocNotices(notices);

        await reportProgress(extra, { progress: 4, total: 4 });
        return {
          content: [{
            type: 'text',
            text: markdown
          }],
          structuredContent: { ...structuredContent, ...noticeFields(notices) }
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
