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
import {
  getProductAvailability,
  getProductsMetadata,
  type DegradationStatus,
} from '../services/metadata.js';
import {
  STATIC_SECTIONS,
  DYNAMIC_SECTION_SOURCES,
  dynamicSectionId,
  type StaticDocSource,
} from '../constants/sources.js';
import { listIntercomCollections } from '../services/intercom-service.js';
import { getSafeErrorMessage } from '../utils/sanitize.js';
import { reportProgress } from '../utils/progress.js';

const TOOL_NAME = 'jamf_docs_list_products';

/**
 * What `incomplete.unavailable` calls learn.jamf.com's `/api/khub/maps`.
 *
 * The one Fluid Topics read this tool depends on, and both halves of it do:
 * the publication axis is built from it, and so are the products' versions
 * and `hasContent`. "maps registry" is also what this tool's contract has
 * always called it. Every other value is the id of a source in
 * {@link DYNAMIC_SECTION_SOURCES}, and the message names the publication ids
 * that source contributes, so a client can tell which rows are missing.
 */
const MAPS_REGISTRY = 'maps-registry';

/** The publication ids a runtime-discovered source contributes, as a pattern. */
function sectionIdPattern(source: StaticDocSource): string {
  return `${source.dynamicSections?.idPrefix ?? source.id}-*`;
}

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
    "publications": [...],
    "topics": [...],
    "incomplete"?: { "unavailable": string[], "message": string },
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

Note: This is a read-only operation that does not modify any state.

If a source could not be read, the reply lists what it could and says so. "incomplete" then
names each unavailable source, its "message" says what that cost, and the Markdown reply
says the same at the top. "${MAPS_REGISTRY}" is learn.jamf.com, where the publication list
and the product versions both come from: either can then be missing or a compiled-in default.
${DYNAMIC_SECTION_SOURCES.map(source =>
    `"${source.id}" is ${source.hostname}, whose ${sectionIdPattern(source)} publications are then missing.`,
  ).join('\n')}
This may be temporary: try again in a minute. No "incomplete" means every source answered.`;

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

/** The publication axis, and what it could not be built from. */
interface PublicationListing {
  rows: PublicationRow[];
  /**
   * Each source that could not be read, as `incomplete.unavailable` names it:
   * {@link MAPS_REGISTRY}, then dynamic sources in declaration order. Empty
   * when every source answered.
   */
  unavailable: string[];
}

/**
 * The publication axis, from every source that answers.
 *
 * `products` and `topics` are compiled in; this needs a live `/api/khub/maps`
 * and a live support.jamf.com. Making the whole tool fail because one of them
 * could not be read would be a regression for every caller that only wanted
 * the product list, so each source costs its own rows and no more. Since 5.7.0
 * (#264) that means the list is never empty: the static sections are compiled
 * in. So the rows cannot say whether anything is missing, and `unavailable`
 * does.
 */
async function listPublicationsQuietly(ctx: ServerContext): Promise<PublicationListing> {
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

  const unreadSources: string[] = [];

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
      unreadSources.push(source.id);
    }
  }

  let registryRows: PublicationRow[] | null = null;
  try {
    const pubs = await ctx.mapsRegistry.listPublications();
    registryRows = pubs.map(pub => ({
      id: pub.id,
      title: pub.title,
      ...(pub.portal.length > 0 ? { portal: pub.portal } : {}),
      ...(pub.app.length > 0 ? { app: pub.app } : {}),
      ...(pub.utility.length > 0 ? { utility: pub.utility } : {}),
      locales: pub.locales,
      versions: pub.versions,
    }));
  } catch (error) {
    ctx.logger.createLogger('list-products').warning(
      `Could not list publications: ${String(error)}`,
    );
  }

  return {
    rows: [...staticRows, ...(registryRows ?? [])],
    unavailable: [...(registryRows === null ? [MAPS_REGISTRY] : []), ...unreadSources],
  };
}

/** What a reply that could not read every source carries. */
interface Incomplete {
  unavailable: string[];
  message: string;
}

/**
 * Which parts of the product list are the compiled-in stand-in for an
 * unreachable registry. Each comes from its own cache entry, so each is
 * reported by its own {@link DegradationStatus}.
 */
interface ProductFallbacks {
  /** `currentVersion` and `availableVersions`, from getProductsMetadata. */
  versions: boolean;
  /** `hasContent`, from getProductAvailability, which assumes true for all. */
  availability: boolean;
}

/**
 * The `incomplete` note, or undefined when every source answered.
 *
 * The registry's sentences name only what is actually a stand-in, because the
 * three can differ. Each is cached on its own clock: the product catalogue for
 * a day, the availability map for an hour. When the registry's own entry
 * lapses (after 7 days on Node) and cannot be rebuilt, each of the two turns
 * into a fallback only as it expires in turn, the availability map first.
 */
function describeIncomplete(
  publicationsUnavailable: readonly string[],
  fallback: ProductFallbacks,
): Incomplete | undefined {
  const registryPublicationsMissing = publicationsUnavailable.includes(MAPS_REGISTRY);
  const registryUnavailable = registryPublicationsMissing || fallback.versions || fallback.availability;
  const unreadSources = DYNAMIC_SECTION_SOURCES.filter(s => publicationsUnavailable.includes(s.id));
  if (!registryUnavailable && unreadSources.length === 0) { return undefined; }

  const sentences: string[] = [];
  if (registryUnavailable) {
    sentences.push('The maps registry on learn.jamf.com could not be read.');
  }
  if (registryPublicationsMissing) {
    sentences.push('The publication list has none of the documents published there.');
  }
  if (fallback.versions) {
    sentences.push('Product versions are compiled-in defaults.');
  }
  if (fallback.availability) {
    sentences.push('Every product is assumed to have a table of contents.');
  }
  for (const source of unreadSources) {
    sentences.push(sectionsLost(source));
  }
  sentences.push('This may be temporary: try again in a minute.');

  return {
    unavailable: [...(registryUnavailable ? [MAPS_REGISTRY] : []), ...unreadSources.map(s => s.id)],
    message: sentences.join(' '),
  };
}

/** The sentence for a runtime-discovered source that could not be read. */
function sectionsLost(source: StaticDocSource): string {
  return `The ${source.name} on ${source.hostname} could not be read, so the publication list ` +
    `has none of its sections (\`${sectionIdPattern(source)}\`).`;
}

/**
 * `head` whole, then `body` cut to what `maxTokens` leaves after it.
 *
 * `head` carries the `incomplete` note, and a maxTokens cut must not take it:
 * the shorter the reply, the less of the catalogue it shows, and the more its
 * reader needs to know that even the whole of it is partial. So the note is
 * charged to the budget but never cut. The reply stays within `maxTokens`
 * whenever the note leaves room for the truncation notice. When it does not,
 * which takes both sources down and a budget near the 100-token minimum, the
 * reply goes over by what the note needs rather than drop it, as
 * `jamf_docs_glossary_lookup` keeps its own `incomplete` note out of its budget.
 */
function truncateAfter(head: string, body: string, maxTokens: number): string {
  return head + truncateToTokenLimit(body, Math.max(0, maxTokens - estimateTokens(head))).content;
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
 * vocabularies, sharing 0 names between any pair of them —
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
 * documentation is there", and it was not under that heading. The cost is a
 * repeated row for every extra product a document is filed under, bought
 * against headings that nothing could reach at all. Measured 2026-09-15, when
 * this landed: 108 rows in 24 groups became 131 appearances in 33.
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
 *
 * `partial` is set when a source could not be read. The rows are then some of
 * what Jamf publishes, and the preamble must not call them all of it: during
 * a registry outage that claim headed the two Jamf Concepts sections (#335).
 */
function renderPublications(publications: PublicationRow[], mode: OutputMode, partial: boolean): string {
  if (publications.length === 0) { return ''; }

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
  out += partial
    ? 'The documents that could be listed, which are not all of them (see the note at the top), ' +
      'grouped the way Jamf classifies them. '
    : 'Every document Jamf publishes, grouped the way Jamf classifies it. ';
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

        // The publication axis first. Best-effort: it needs the live maps
        // registry and support.jamf.com, and the products and topics below do
        // not, so a source that cannot answer costs its own rows rather than
        // the whole response.
        //
        // First because it is also the one read that says whether the
        // registry is answering now: `MapsRegistry` does not cache a failure,
        // so this succeeds only if the registry is built and in memory. When
        // it is, a fallback the product half cached during an outage is stale
        // and costs nothing to rebuild, and serving it would pair the
        // registry's publications with the fallback's product versions in
        // one reply, as #335 reproduced.
        const listing = await listPublicationsQuietly(ctx);
        const publications = listing.rows;
        const readOptions = { revalidateFallback: !listing.unavailable.includes(MAPS_REGISTRY) };

        // Each set when its part of the product half is the compiled-in
        // stand-in for an unreachable registry, cached or not. Two, because
        // the two entries expire on their own clocks and the note names only
        // the one that is a stand-in.
        const versionsStatus: DegradationStatus = { degraded: false };
        const availabilityStatus: DegradationStatus = { degraded: false };

        // Product availability and versions, both cached. Asked for together
        // so that when neither is cached they share one registry request
        // (MapsRegistry deduplicates a build in flight) rather than making two
        // in a row, which during an outage is two waits on a failing endpoint.
        //
        // Versions come from getProductsMetadata, not from JAMF_PRODUCTS.
        // Every registry row declares `versions: ['current']`, which is true
        // of the unversioned majority and wrong for the five families Jamf
        // actually snapshots: this tool reported one version for
        // jamf-pro-documentation while the maps endpoint published nineteen.
        // getProductsMetadata already resolves those through MapsRegistry —
        // it is what `jamf://products` has been serving all along — so the
        // two views of the same catalogue now agree.
        const [availability, metadata] = await Promise.all([
          getProductAvailability(ctx, availabilityStatus, readOptions),
          getProductsMetadata(ctx, versionsStatus, readOptions),
        ]);

        await reportProgress(extra, { progress: 1, total: 3, message: 'Processing availability...' });

        // Build product list — always include all known products.
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

        // `tools/call` has no cache or degradation channel, so the result body
        // is the only place a fallback can be reported.
        const incomplete = describeIncomplete(listing.unavailable, {
          versions: versionsStatus.degraded,
          availability: availabilityStatus.degraded,
        });
        const incompleteNote = incomplete !== undefined
          ? `> **This catalogue is incomplete.** ${incomplete.message}\n\n`
          : '';
        const publicationsPartial = listing.unavailable.length > 0;

        const structuredContent = {
          products,
          topics,
          publications,
          ...(incomplete !== undefined ? { incomplete } : {}),
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
          markdown += renderPublications(publications, OutputMode.COMPACT, publicationsPartial);

          const compactText = truncateAfter(incompleteNote, markdown, maxTokens);
          await reportProgress(extra, { progress: 3, total: 3 });

          return {
            content: [{
              type: 'text',
              text: compactText
            }],
            structuredContent
          };
        }

        // Full markdown format. The heading and the note are kept whole, and
        // only what follows them is cut to fit (see truncateAfter).
        const head = `# Jamf Documentation Products\n\n${incompleteNote}`;
        let markdown = '';

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

        markdown += renderPublications(publications, OutputMode.FULL, publicationsPartial);

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
        const tokenCount = estimateTokens(head + markdown);
        markdown += `*${tokenCount.toLocaleString()} tokens*\n\n`;

        markdown += '*Use `jamf_docs_search` to search within these products, ';
        markdown += 'or `jamf_docs_get_toc` to browse the table of contents.*\n';

        const fullText = truncateAfter(head, markdown, maxTokens);

        await reportProgress(extra, { progress: 3, total: 3 });

        return {
          content: [{
            type: 'text',
            text: fullText
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
