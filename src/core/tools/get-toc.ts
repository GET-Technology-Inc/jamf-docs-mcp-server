/**
 * jamf_docs_get_toc tool
 * Get the table of contents for a Jamf product's documentation.
 */

import type { McpServer } from '@modelcontextprotocol/server';
import type { ServerContext } from '../types/context.js';
import { appToolMeta } from '../apps/index.js';
import { GetTocInputSchema, type GetTocInput } from '../schemas/index.js';
import { reportProgress } from '../utils/progress.js';
import { TocOutputSchema } from '../schemas/output.js';
import type { ProductId, LocaleId } from '../constants.js';
import { ResponseFormat, OutputMode, JAMF_PRODUCTS, PRODUCT_ID_LIST, TOKEN_CONFIG, PAGINATION_CONFIG } from '../constants.js';
import type { ToolResult, TocResponse, TocEntry, PaginationInfo, TokenInfo } from '../types.js';
import { fetchTableOfContents, type TocSource } from '../services/toc-service.js';
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
  /** Nesting level, 0 for a top-level entry. See {@link flattenTocEntries}. */
  depth: number;
}

/**
 * Flatten nested TOC entries into a flat list, tagging each with its depth.
 *
 * `contentId` rides along: paired with the response-level `mapId` it is what
 * `jamf_docs_get_article` documents as obtainable "from search results or
 * TOC". Dropping it here made that workflow impossible to perform from the
 * structured output, even though the value was already resolved.
 *
 * `depth` rides along for the same reason: without it `structuredContent`
 * described a table of contents as an unordered list of titles, so "browse the
 * TOC to decide what to read" lost the one thing it browses by. The markdown
 * channel does not cover for it — a client that reads `structuredContent`
 * (which the MCP Apps host does) never sees `renderTocEntry`'s indentation, in
 * either `outputMode`.
 *
 * Depth plus this list's order is the whole tree, not a hint at it:
 * `fetchTableOfContents` paginates over top-level entries only
 * (`allToc.slice`) and `truncateListByTokens` drops whole top-level items, so
 * a page never begins part-way down a subtree — every page is a sequence of
 * complete subtrees, each starting at depth 0, which is exactly what a
 * stack-based outline reconstruction needs.
 *
 * That is also why there is no `parentContentId` beside it. It would name the
 * parent by a field the parents mostly do not have: `TocEntry.contentId` is
 * optional, and a `TocProvider` serving its own store builds interior nodes
 * without one (the Cloudflare worker's `buildTree` gives every *section* node
 * `{title, url, children}` and attaches `contentId` only to article leaves).
 * A link key that is absent on the parents links nothing, while depth is
 * derived here and therefore always present.
 */
function flattenTocEntries(entries: TocEntry[], depth = 0): FlatTocEntry[] {
  const flat: FlatTocEntry[] = [];
  for (const entry of entries) {
    flat.push({
      title: entry.title,
      url: entry.url,
      ...(entry.contentId !== undefined ? { contentId: entry.contentId } : {}),
      depth,
    });
    if (entry.children !== undefined && entry.children.length > 0) {
      flat.push(...flattenTocEntries(entry.children, depth + 1));
    }
  }
  return flat;
}

const TOOL_NAME = 'jamf_docs_get_toc';

const TOOL_DESCRIPTION = `Get the table of contents for Jamf documentation.

Browse the navigation structure of either a Jamf product or any single Jamf
publication - release notes, technical papers, courses, evaluation guides and
configuration guides all live on the publication axis rather than the product
one. Exactly one of \`product\` and \`publication\` is required.

Args:
  - product (string): Product ID - one of: ${PRODUCT_ID_LIST}
  - publication (string): Bundle family id of any single publication, e.g.
    "technical-paper-laps" or "jamf-pro-release-notes". Call
    jamf_docs_list_products for the available ids
  - version (string, optional): Specific version (defaults to latest)
  - page (number, optional): Page number for pagination 1-${PAGINATION_CONFIG.MAX_PAGE} (default: ${PAGINATION_CONFIG.DEFAULT_PAGE})
  - maxTokens (number, optional): Maximum tokens in response ${TOKEN_CONFIG.MIN_TOKENS}-${TOKEN_CONFIG.MAX_TOKENS_LIMIT} (default: ${TOKEN_CONFIG.DEFAULT_MAX_TOKENS})
  - outputMode ('full' | 'compact'): Output detail level (default: 'full'). Use 'compact' for flat list without nested children
  - responseFormat ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  For JSON format:
  {
    "product": string,
    "productId": string,      // present when addressed by product
    "publicationId": string,  // present when addressed by publication
    "version": string,
    "mapId": string,   // omitted when the map could not be resolved
    "toc": [...],      // each entry carries title, url and contentId
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
per-entry contentIds.
structuredContent.entries is the TOC flattened in document order and always
carries every descendant; each entry's depth (0 for top level) is what
restores the nesting. The markdown is not the same view: outputMode="full"
shows that nesting as indentation, while outputMode="compact" lists only the
top-level entries and shows no nesting at all.`;

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

/** A `get_toc` request that named something Fluid Topics can serve. */
interface ResolvedTocSource {
  source: TocSource;
  /** What to call it in prose. */
  sourceLabel: string;
  /** Versions the registry actually publishes for it, newest first. */
  availableVersions: string[];
}

/**
 * Turn `product` / `publication` into one addressable source, or say why not.
 *
 * The two parameters are one axis each — `product` names a Jamf product,
 * `publication` names a single document by its bundle family — and exactly
 * one is required. That pairing cannot be expressed in the object schema
 * without `.refine()` (which would make it a ZodEffects and break the tool's
 * JSON Schema derivation), so it is enforced here, where the message can also
 * say what to call instead.
 */
async function resolveTocSource(
  ctx: ServerContext,
  params: GetTocInput,
  version: string,
): Promise<ResolvedTocSource | { error: string }> {
  if ((params.product !== undefined) === (params.publication !== undefined)) {
    return {
      error: params.product === undefined
        ? 'Provide either `product` (one of the Jamf products) or `publication` (a bundle ' +
          'family id such as "technical-paper-laps"). Call jamf_docs_list_products to see both.'
        : 'Provide only one of `product` and `publication`, not both. `product` addresses a ' +
          'Jamf product; `publication` addresses any single document by its bundle family id.',
    };
  }

  if (params.product !== undefined) {
    if (!(params.product in JAMF_PRODUCTS)) {
      const valid = Object.entries(JAMF_PRODUCTS)
        .map(([id, p]) => `- \`${id}\`: ${p.name}`)
        .join('\n');
      return { error: `Invalid product ID: "${params.product}".\n\nValid options:\n${valid}` };
    }
    const productId = params.product as ProductId;
    return {
      source: productId,
      sourceLabel: JAMF_PRODUCTS[productId].name,
      availableVersions: await getAvailableVersions(ctx, productId),
    };
  }

  const publication = params.publication ?? '';

  // Not an enum: there are 97 families and the set is upstream's to change,
  // so the check is a registry lookup and a miss carries suggestions rather
  // than a wall of every id.
  if (!(await ctx.mapsRegistry.hasPublication(publication))) {
    const suggestions = await ctx.mapsRegistry.suggestPublications(publication);
    return {
      error: `Unknown publication: "${publication}".${
        suggestions.length > 0
          ? `\n\nDid you mean:\n${suggestions.map(id => `- \`${id}\``).join('\n')}`
          : '\n\nCall jamf_docs_list_products to see the available publications.'
      }`,
    };
  }

  const locale = params.language as LocaleId | undefined;

  return {
    source: publication,
    // The title of the map actually being served, not the family's latest:
    // versioned families put their version in the title, so reporting the
    // latest while serving an older one is wrong exactly where a reader looks.
    sourceLabel: await ctx.mapsRegistry.resolveTitle(
      publication,
      version !== 'current' ? version : undefined,
      locale,
    ) ?? publication,
    // A publication id is already the bundle stem the registry keys on.
    availableVersions: await ctx.mapsRegistry.getVersions(publication),
  };
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
        const version = params.version ?? 'current';
        const resolved = await resolveTocSource(ctx, params, version);
        if ('error' in resolved) {
          return { isError: true, content: [{ type: 'text', text: resolved.error }] };
        }
        const { source, sourceLabel, availableVersions } = resolved;

        // Validate version if specified
        if (params.version !== undefined && params.version !== '' && params.version !== 'current') {
          if (availableVersions.length > 0 && !availableVersions.includes(params.version)) {
            return {
              isError: true,
              content: [{
                type: 'text',
                text: `Version "${params.version}" not found for ${sourceLabel}.\n\nAvailable versions: ${availableVersions.length > 0 ? availableVersions.join(', ') : 'current'}`
              }]
            };
          }
        }

        await reportProgress(extra, { progress: 0, total: 4, message: 'Fetching TOC...' });

        const tocResult = await fetchTableOfContents(ctx, source, version, {
          ...(params.page !== undefined && { page: params.page }),
          maxTokens: params.maxTokens ?? TOKEN_CONFIG.DEFAULT_MAX_TOKENS,
          locale: params.language as LocaleId | undefined
        });

        await reportProgress(extra, { progress: 1, total: 4, message: 'Processing entries...' });

        const { toc, pagination, tokenInfo, paginationNote, mapId } = tocResult;

        // Build response
        const response: TocResponse = {
          product: sourceLabel,
          version,
          ...(mapId !== undefined ? { mapId } : {}),
          toc,
          tokenInfo,
          pagination
        };

        const structuredContent = {
          product: sourceLabel,
          // The ID, not just the display name: a client paging through this
          // TOC has to pass the same argument back, and `product` is an enum
          // of IDs. Sending only the name made "next page" impossible. For a
          // publication the id goes back under its own key, so a client can
          // tell which parameter to resend without matching against the enum.
          ...(params.product !== undefined ? { productId: params.product } : {}),
          ...(params.publication !== undefined ? { publicationId: params.publication } : {}),
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
          ? formatTocCompact(sourceLabel, toc, pagination)
          : formatTocFull({ productName: sourceLabel, version, mapId, toc, pagination, tokenInfo }))
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
