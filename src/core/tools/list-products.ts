/**
 * jamf_docs_list_products tool
 * Lists all available Jamf products and their documentation versions.
 */

import type { McpServer } from '@modelcontextprotocol/server';
import type { ServerContext } from '../types/context.js';
import { ListProductsInputSchema } from '../schemas/index.js';
import { ProductListOutputSchema } from '../schemas/output.js';
import { JAMF_TOPICS, DOC_TYPES, ResponseFormat, OutputMode, TOKEN_CONFIG, DEFAULT_LOCALE } from '../constants.js';
import type { ToolResult } from '../types.js';
import { estimateTokens, createTokenInfo, truncateToTokenLimit } from '../services/tokenizer.js';
import { getProductAvailability, getProductsMetadata } from '../services/metadata.js';
import {
  STATIC_SECTIONS,
  DYNAMIC_SECTION_SOURCES,
  dynamicSectionId,
} from '../constants/sources.js';
import { listIntercomCollections } from '../services/intercom-service.js';
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
  - maxTokens (number, optional): Maximum tokens in response ${TOKEN_CONFIG.MIN_TOKENS}-${TOKEN_CONFIG.MAX_TOKENS_LIMIT} (default: ${TOKEN_CONFIG.CATALOGUE_MAX_TOKENS}, higher than other tools because this one answers with a whole catalogue)
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

/**
 * One publication as `list_products` reports it.
 *
 * The three classification fields are arrays, and absent rather than empty
 * when Jamf assigns none — see {@link PublicationInfo}.
 */
interface PublicationRow {
  id: string;
  title: string;
  portal?: string[];
  app?: string[];
  utility?: string[];
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
  // Static sources are compiled in, so they list whether or not the maps
  // registry answers — and they are the only way to discover that
  // concepts.jamf.com is reachable at all.
  const staticRows: PublicationRow[] = STATIC_SECTIONS.map(({ source, section }) => ({
    id: section.id,
    title: section.title,
    portal: [source.name],
    locales: Object.keys(source.locales).sort(),
    versions: [],
  }));

  // Sources whose sections come from the source itself. Best-effort per
  // source: an unreachable Help Center costs its own rows, not the list.
  for (const source of DYNAMIC_SECTION_SOURCES) {
    const locale = source.locales[DEFAULT_LOCALE];
    if (locale === undefined) { continue; }
    try {
      for (const collection of await listIntercomCollections(ctx, source, locale)) {
        staticRows.push({
          id: dynamicSectionId(source, collection.slug),
          title: `${source.name}: ${collection.name}`,
          portal: [source.name],
          locales: Object.keys(source.locales).sort(),
          versions: [],
        });
      }
    } catch (error) {
      ctx.logger.createLogger('list-products').warning(
        `Could not list ${source.name} collections: ${String(error)}`,
      );
    }
  }

  try {
    const pubs = await ctx.mapsRegistry.listPublications();
    return [...staticRows, ...pubs.map(pub => ({
      id: pub.id,
      title: pub.title,
      ...(pub.portal.length > 0 ? { portal: pub.portal } : {}),
      ...(pub.app.length > 0 ? { app: pub.app } : {}),
      ...(pub.utility.length > 0 ? { utility: pub.utility } : {}),
      locales: pub.locales,
      versions: pub.versions,
    }))];
  } catch (error) {
    ctx.logger.createLogger('list-products').warning(
      `Could not list publications: ${String(error)}`,
    );
    return staticRows;
  }
}

/** The heading a publication Jamf classifies under nothing is filed under. */
const UNCLASSIFIED_GROUP = 'Other';

/**
 * Every way Jamf files a publication, as display strings.
 *
 * `jamf:portal`, `jamf:app` and `jamf:utility` are three slots of one
 * taxonomy, and a publication can occupy several of them at once: 10 of the 97
 * families carry more than one value on a single axis and 11 carry more than
 * one axis. So this returns a list, not a first choice.
 *
 * Both of the old narrowings lost real classifications, and between them nine
 * headings never appeared at all. The `portal ?? app ?? utility` fallback
 * chain dropped whole axes, which alone hid seven — Title Editor, Jamf App
 * Catalog, Jamf Assessment, Jamf Reset, Jamf Remote Assist, Healthcare
 * Listener and Jamf AD CS Connector, each of them a publication that also
 * carries a portal. Jamf Setup and Jamf Trust needed both fixes, because Jamf
 * lists them second in `jamf:app` and `values[0]` had already discarded them
 * (#282).
 *
 * Order is Jamf's own within an axis, then portal, app, utility across them.
 * The dedupe has nothing to collapse today — the three axes draw on disjoint
 * vocabularies, 0 names shared between any pair of them across all 676 maps —
 * and is here because nothing upstream guarantees that, and the cost of Jamf
 * filing one name on two axes would be a group silently listing a row twice.
 */
function classificationsOf(pub: PublicationRow): string[] {
  const all = [...(pub.portal ?? []), ...(pub.app ?? []), ...(pub.utility ?? [])];
  return all.length > 0 ? [...new Set(all)] : [UNCLASSIFIED_GROUP];
}

/**
 * Publications grouped under every heading Jamf files them under.
 *
 * A publication Jamf classifies under two products appears under both, which
 * is the point: the Jamf 170 Course is Jamf's own answer to "what Jamf Protect
 * documentation is there", and it was not under that heading. Measured live,
 * the section goes from 108 rows in 24 groups to 131 appearances in 33 — 23
 * repeated rows bought against 9 headings nothing could reach.
 */
function groupByClassification(
  publications: PublicationRow[],
): [string, PublicationRow[]][] {
  const groups = new Map<string, PublicationRow[]>();
  for (const pub of publications) {
    for (const key of classificationsOf(pub)) {
      groups.set(key, [...(groups.get(key) ?? []), pub]);
    }
  }
  // 'Other' last; everything else alphabetical.
  return [...groups.entries()].sort(([a], [b]) =>
    a === UNCLASSIFIED_GROUP ? 1 : b === UNCLASSIFIED_GROUP ? -1 : a.localeCompare(b));
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

  const ordered = groupByClassification(publications);

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
  out += 'takes the product IDs above, not these. ';
  out += 'A document Jamf files under more than one product is listed under each, ';
  out += 'so the count above is of documents, not of the rows below.\n\n';

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
      const maxTokens = params.maxTokens ?? TOKEN_CONFIG.CATALOGUE_MAX_TOKENS;

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
