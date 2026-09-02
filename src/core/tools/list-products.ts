/**
 * jamf_docs_list_products tool
 * Lists all available Jamf products and their documentation versions.
 */

import type { McpServer } from '@modelcontextprotocol/server';
import type { ServerContext } from '../types/context.js';
import { ListProductsInputSchema } from '../schemas/index.js';
import { ProductListOutputSchema } from '../schemas/output.js';
import { JAMF_TOPICS, DOC_TYPES, ResponseFormat, OutputMode, TOKEN_CONFIG } from '../constants.js';
import type { ToolResult } from '../types.js';
import { estimateTokens, createTokenInfo, truncateToTokenLimit } from '../services/tokenizer.js';
import { getProductAvailability, getProductsMetadata } from '../services/metadata.js';
import { getSafeErrorMessage } from '../utils/sanitize.js';
import { reportProgress } from '../utils/progress.js';

const TOOL_NAME = 'jamf_docs_list_products';

const TOOL_DESCRIPTION = `List Jamf products, publications, topics, and documentation versions.

Returns two separate catalogues:
  - Products: the IDs the \`product\` filter in jamf_docs_search accepts, and the
    \`product\` parameter of jamf_docs_get_toc. Jamf Pro, Jamf School, Jamf Connect,
    Jamf Protect, Jamf Now, Jamf Safe Internet and more.
  - Publications: every document Jamf publishes - release notes, technical papers,
    courses, evaluation and configuration guides - grouped the way Jamf classifies
    them. Pass one of these IDs as the \`publication\` parameter of jamf_docs_get_toc.
    These are documents, not products, and the search \`product\` filter does not
    take them.

Also lists available topic and docType filters for search.

Args:
  - maxTokens (number, optional): Maximum tokens in response ${TOKEN_CONFIG.MIN_TOKENS}-${TOKEN_CONFIG.MAX_TOKENS_LIMIT} (default: ${TOKEN_CONFIG.DEFAULT_MAX_TOKENS})
  - outputMode ('full' | 'compact'): Output detail level (default: 'full'). Use 'compact' for brief list
  - responseFormat ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  For JSON format:
  {
    "products": [...],
    "publications": [...],   // omitted if the maps registry is unreachable
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
  - "Where are the Jamf Pro release notes?" → use this tool, then get_toc with the publication ID

Note: This is a read-only operation that does not modify any state.`;

/** One publication as `list_products` reports it. */
interface PublicationRow {
  id: string;
  title: string;
  portal?: string;
  app?: string;
  utility?: string;
  locales: string[];
  versions: string[];
}

/**
 * The publication axis, or null when the registry cannot answer.
 *
 * `products` and `topics` are compiled in; this needs a live `/api/khub/maps`.
 * Making the whole tool fail because the newest section could not load would
 * be a regression for every caller that only wanted the product list.
 */
async function listPublicationsQuietly(ctx: ServerContext): Promise<PublicationRow[] | null> {
  try {
    const pubs = await ctx.mapsRegistry.listPublications();
    return pubs.map(pub => ({
      id: pub.id,
      title: pub.title,
      ...(pub.portal !== '' ? { portal: pub.portal } : {}),
      ...(pub.app !== '' ? { app: pub.app } : {}),
      ...(pub.utility !== '' ? { utility: pub.utility } : {}),
      locales: pub.locales,
      versions: pub.versions,
    }));
  } catch (error) {
    ctx.logger.createLogger('list-products').warning(
      `Could not list publications: ${String(error)}`,
    );
    return null;
  }
}

/**
 * How Jamf files a publication, as one display string.
 *
 * `jamf:portal`, `jamf:app` and `jamf:utility` are three slots of one
 * taxonomy — a map carries at most one of each and most carry exactly one —
 * so they read as a single answer to "what is this about" rather than three
 * independent fields. Grouping by it is what keeps 97 rows navigable.
 */
function classificationOf(pub: PublicationRow): string {
  return pub.portal ?? pub.app ?? pub.utility ?? 'Other';
}

/**
 * Render the publication axis.
 *
 * Deliberately its own section rather than extra rows under Products: the
 * `product` search filter accepts the twelve above and nothing here, and
 * merging the two lists is exactly the dilution #239 asked to avoid.
 */
function renderPublications(publications: PublicationRow[] | null, mode: OutputMode): string {
  if (publications === null || publications.length === 0) { return ''; }

  const groups = new Map<string, PublicationRow[]>();
  for (const pub of publications) {
    const key = classificationOf(pub);
    groups.set(key, [...(groups.get(key) ?? []), pub]);
  }
  // 'Other' last; everything else alphabetical.
  const ordered = [...groups.entries()].sort(([a], [b]) =>
    a === 'Other' ? 1 : b === 'Other' ? -1 : a.localeCompare(b));

  if (mode === OutputMode.COMPACT) {
    let out = `\n## Publications (${String(publications.length)})\n`;
    for (const [group, rows] of ordered) {
      out += `\n### ${group}\n`;
      for (const pub of rows) { out += `- \`${pub.id}\`\n`; }
    }
    return out;
  }

  let out = '---\n\n';
  out += `# Publications (${String(publications.length)})\n\n`;
  out += 'Every document Jamf publishes, grouped the way Jamf classifies it. ';
  out += 'Pass an ID as the `publication` parameter of `jamf_docs_get_toc` to browse one. ';
  out += 'These are documents, not products — the `product` filter in `jamf_docs_search` ';
  out += 'takes the product IDs above, not these.\n\n';

  for (const [group, rows] of ordered) {
    out += `## ${group}\n\n`;
    for (const pub of rows) {
      const extras: string[] = [];
      if (pub.versions.length > 0) {
        extras.push(`${String(pub.versions.length)} versions, latest ${pub.versions[0] ?? ''}`);
      }
      if (pub.locales.length === 1) { extras.push(`${pub.locales[0] ?? ''} only`); }
      out += `- **\`${pub.id}\`**: ${pub.title}`;
      out += extras.length > 0 ? ` *(${extras.join('; ')})*\n` : '\n';
    }
    out += '\n';
  }
  return out;
}

export function registerListProductsTool(server: McpServer, ctx: ServerContext): void {
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
    async (args, extra): Promise<ToolResult> => {
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
        await reportProgress(extra, { progress: 0, total: 3, message: 'Fetching product info...' });

        // Fetch product availability (cached)
        const availability = await getProductAvailability(ctx);

        await reportProgress(extra, { progress: 1, total: 3, message: 'Processing availability...' });

        // Build product list — always include all known products.
        //
        // Versions come from getProductsMetadata, not from JAMF_PRODUCTS.
        // Every registry row declares `versions: ['current']`, which is true
        // of the unversioned majority and wrong for the five families Jamf
        // actually snapshots: this tool reported one version for
        // jamf-pro-documentation while the maps endpoint published nineteen.
        // getProductsMetadata already resolves those through MapsRegistry —
        // it is what `jamf://products` has been serving all along — so the
        // two views of the same catalogue now agree.
        const metadata = await getProductsMetadata(ctx);
        const products = metadata.map(product => ({
          id: product.id,
          name: product.name,
          description: product.description,
          currentVersion: product.latestVersion,
          availableVersions: product.availableVersions,
          hasContent: availability[product.id] ?? true
        }));

        // Build topics list
        const topics = Object.entries(JAMF_TOPICS).map(([id, topic]) => ({
          id,
          name: topic.name,
          keywords: topic.keywords
        }));

        // The publication axis. Best-effort: it needs the live maps registry,
        // and the products and topics above do not, so a registry that cannot
        // answer costs this section rather than the whole response.
        const publications = await listPublicationsQuietly(ctx);

        const structuredContent = {
          products,
          topics,
          ...(publications !== null ? { publications } : {}),
        };

        await reportProgress(extra, { progress: 2, total: 3, message: 'Formatting output...' });

        if (params.responseFormat === ResponseFormat.JSON) {
          const jsonData = JSON.stringify(structuredContent);
          const jsonOutput = JSON.stringify({
            ...structuredContent,
            tokenInfo: createTokenInfo(jsonData, maxTokens)
          }, null, 2);

          await reportProgress(extra, { progress: 3, total: 3 });

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
          markdown += renderPublications(publications, OutputMode.COMPACT);

          const compactResult = truncateToTokenLimit(markdown, maxTokens);
          await reportProgress(extra, { progress: 3, total: 3 });

          return {
            content: [{
              type: 'text',
              text: compactResult.content
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
          markdown += `- **Available Versions**: ${product.availableVersions.join(', ')}\n`;
          if (!product.hasContent) {
            markdown += '- **Status**: TOC unavailable (search and articles still work)\n';
          }
          markdown += '\n';
        }

        markdown += renderPublications(publications, OutputMode.FULL);

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

        const fullResult = truncateToTokenLimit(markdown, maxTokens);

        await reportProgress(extra, { progress: 3, total: 3 });

        return {
          content: [{
            type: 'text',
            text: fullResult.content
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
