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
import { ResponseFormat, OutputMode, JAMF_PRODUCTS, PRODUCT_ID_LIST, TOKEN_CONFIG, PAGINATION_CONFIG, DEFAULT_LOCALE } from '../constants.js';
import type { ToolResult, TocResponse, TocEntry, TocTruncatedEntry, PaginationInfo, TokenInfo, FetchTocOptions, FetchTocResult } from '../types.js';
import { fetchTableOfContents, type TocSource } from '../services/toc-service.js';
import { fetchStaticToc } from '../services/sitemap-service.js';
import {
  staticSectionById,
  dynamicSectionId,
  DYNAMIC_SECTION_SOURCES,
  type StaticDocSource,
  type StaticSection,
} from '../constants/sources.js';
import {
  listIntercomCollections,
  fetchIntercomToc,
  type IntercomCollection,
} from '../services/intercom-service.js';
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
 * The `maxTokens` to name beside the next page, or nothing at the default.
 *
 * A page holds as many whole top-level entries as fit `maxTokens`, so page
 * N+1 follows page N only at the same budget. Both footers used to say only
 * which page came next: live on 2026-09-26, page 1 of Jamf Pro at
 * `maxTokens: 1000` holds its first 4 top-level entries, and page 2 asked for
 * as the footer said, at the default budget, starts at the 11th, so following
 * the footer skipped six. At the default, leaving the budget out asks for the
 * same pages, and the footer stays as it was.
 */
function budgetToResend(maxTokens: number): number | undefined {
  return maxTokens !== TOKEN_CONFIG.DEFAULT_MAX_TOKENS ? maxTokens : undefined;
}

/**
 * Format TOC as compact markdown
 */
function formatTocCompact(
  productName: string,
  toc: TocEntry[],
  pagination: PaginationInfo,
  maxTokens: number,
): string {
  let markdown = `## ${productName} TOC (${pagination.totalItems} entries)\n\n`;

  for (const entry of toc) {
    markdown += renderTocEntry(entry, 0, true);
  }

  markdown += `\n---\n*Page ${pagination.page}/${pagination.totalPages}`;
  if (pagination.hasNext) {
    const budget = budgetToResend(maxTokens);
    markdown += ` | page=${pagination.page + 1}${budget !== undefined ? `, maxTokens=${String(budget)}` : ''} for more`;
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
  truncatedEntry: TocTruncatedEntry | undefined;
  /** The budget the request asked for, which the footer names to resend. */
  maxTokens: number;
}

/**
 * The line under a page that was cut to fit `maxTokens`.
 *
 * It used to read "TOC truncated due to token limit. Use `page` parameter or
 * increase `maxTokens`." under every page the budget shortened, and `page`
 * could not reach what the cut dropped (see `paginateTocEntries`). Pages are
 * now cut to the budget, so the only cut left is one top-level entry larger
 * than `maxTokens` on its own, and the line says which, how much of it is
 * shown, and the budget that shows it whole — never one the schema rejects.
 * A `TocProvider` can report `truncated` without saying what it cut; that
 * gets the one piece of advice that holds for any cut.
 */
function truncationLine(tokenInfo: TokenInfo, truncatedEntry: TocTruncatedEntry | undefined): string {
  if (truncatedEntry === undefined) {
    return 'TOC truncated due to token limit: entries on this page were left out. Increase `maxTokens` to see them.';
  }
  const { title, shownEntries, totalEntries, estimatedTokens } = truncatedEntry;
  const cut = `"${sanitizeMarkdownText(title)}" is larger than \`maxTokens: ${String(tokenInfo.maxTokens)}\` on its own, ` +
    `so this page shows the first ${String(shownEntries)} of its ${String(totalEntries)} entries.`;
  return estimatedTokens <= TOKEN_CONFIG.MAX_TOKENS_LIMIT
    ? `${cut} Repeat with \`maxTokens: ${String(estimatedTokens)}\` or more to see it whole; ` +
      'pages are cut to `maxTokens`, so it may then be on a different page.'
    : `${cut} It needs ${String(estimatedTokens)} tokens, more than \`maxTokens\` allows (${String(TOKEN_CONFIG.MAX_TOKENS_LIMIT)}).`;
}

/**
 * Format TOC as full markdown
 */
function formatTocFull(input: TocFullFormatInput): string {
  const { productName, version, mapId, toc, pagination, tokenInfo, truncatedEntry, maxTokens } = input;
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
    const budget = budgetToResend(maxTokens);
    markdown += ` | Use \`page=${pagination.page + 1}\`${budget !== undefined ? ` with \`maxTokens: ${String(budget)}\`` : ''} for more`;
  }
  if (tokenInfo.truncated) {
    markdown += `\n*${truncationLine(tokenInfo, truncatedEntry)}*`;
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
 * `paginateTocEntries` pages over top-level entries only, so a page never
 * begins part-way down a subtree — every page is a sequence of complete
 * subtrees, each starting at depth 0, which is exactly what a stack-based
 * outline reconstruction needs. The one exception keeps that property: a
 * top-level entry larger than `maxTokens` on its own is alone on its page and
 * cut to a document-order prefix of its subtree, so the page still starts at
 * depth 0 and reads as the start of that entry.
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

/**
 * The JSON block used to list `productId` and `publicationId` as present "when
 * addressed by" each parameter. Only `structuredContent` has them — the JSON
 * text is `TocResponse`, which never did (checked through tools/call on
 * 2026-09-24: product, version, mapId, toc, tokenInfo, pagination). The Note
 * now says where they are instead.
 */
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
  - version (string, optional): Specific version (e.g., "11.13.0") or "current" (defaults to latest)
  - language (string, optional): Documentation language/locale (default: ${DEFAULT_LOCALE})
  - page (number, optional): Page number for pagination 1-${PAGINATION_CONFIG.MAX_PAGE} (default: ${PAGINATION_CONFIG.DEFAULT_PAGE})
  - maxTokens (number, optional): Maximum tokens in response ${TOKEN_CONFIG.MIN_TOKENS}-${TOKEN_CONFIG.MAX_TOKENS_LIMIT} (default: ${TOKEN_CONFIG.DEFAULT_MAX_TOKENS})
  - outputMode ('full' | 'compact'): Output detail level (default: 'full'). Use 'compact' for flat list without nested children
  - responseFormat ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  For JSON format:
  {
    "product": string,
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
    },
    "truncatedEntry"?: {  // only on a page cut to fit; see the Note
      "title": string,
      "shownEntries": number,
      "totalEntries": number,
      "estimatedTokens": number
    }
  }

  For Markdown format:
  A hierarchical list of documentation topics with pagination and token info.

Examples:
  - Browse Jamf Pro documentation: product="jamf-pro"
  - Get page 2 of TOC: product="jamf-pro", page=2
  - Limit response size: product="jamf-pro", maxTokens=2000

Errors:
  - "Invalid option: expected one of ..." (an input validation error) if product is not a known product ID
  - 'Version "<version>" not found', followed by the available versions, if that version is not published

Note: Use this to discover what topics are available before searching
or retrieving specific articles. Large TOCs are paginated by top-level
entry: a page holds up to 10 of them, each with everything under it, as many
as fit maxTokens, and the next page starts at the first that did not fit.
Every top-level entry is on exactly one page, but which page depends on
maxTokens, so keep maxTokens the same while paging; the markdown footer names
it beside the next page when it is not the default. A top-level entry larger
than maxTokens on its own is alone on its page, cut to the entries under it
that fit; only that page has tokenInfo.truncated, and
truncatedEntry.estimatedTokens is what the whole entry costs. If maxTokens
makes more pages than page accepts (${PAGINATION_CONFIG.MAX_PAGE}), page ${PAGINATION_CONFIG.MAX_PAGE} offers no next
page and paginationNote names a maxTokens that reaches the rest.
The response-level mapId and an entry's contentId together form the pair
jamf_docs_get_article accepts for a direct fetch. Markdown output shows the
mapId only; use responseFormat="json" (or read structuredContent) for the
per-entry contentIds.
structuredContent also carries what to send back for the next page:
productId (or publicationId), version, language (when one was asked for) and
maxTokens. The JSON text has no id or language, and has the budget as
tokenInfo.maxTokens.
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
  /** Set when Jamf does not publish this document in the requested language. */
  localeNote?: string | undefined;
}

/**
 * Say so when the answer is not in the language that was asked for.
 *
 * The registry has always fallen back to en-US, and Jamf genuinely does not
 * translate everything: most publication families are en-US only, and
 * `jamf-school-documentation` has no zh-TW map at all (de/en/es/fr/ja/nl). A
 * silent fallback presents English as though it were the translation, and the
 * reader has no way to tell that from a document that simply happens to have
 * English headings.
 */
function getLocaleNote(
  requested: string | undefined,
  resolved: string | undefined,
): string | undefined {
  if (requested === undefined || resolved === undefined) { return undefined; }
  if (requested === resolved) { return undefined; }
  return `Jamf does not publish this document in ${requested}. Showing the ` +
    `${resolved} edition instead.`;
}

/**
 * The notices that are actually set, as a plain bag ready to spread into
 * either the JSON response or `structuredContent`.
 */
function noticeFields(notices: TocNotices): Record<string, string> {
  return {
    ...(notices.versionNote !== undefined ? { versionNote: notices.versionNote } : {}),
    ...(notices.localeNote !== undefined ? { localeNote: notices.localeNote } : {}),
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
  if (notices.localeNote !== undefined) {
    rendered += `\n> **Language Note:** ${notices.localeNote}\n`;
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
  /**
   * Set when this names a section of a static source rather than a Fluid
   * Topics publication. Those have no maps, no versions and no TOC endpoint —
   * their tree comes from the sitemap.
   */
  staticSection?: {
    source: StaticDocSource;
    section: StaticSection;
    /** The source's own code for the requested locale, e.g. `ja` for ja-JP. */
    sourceLocale: string;
  };
  /** Set when this names one collection of an Intercom Help Center. */
  intercomCollection?: {
    source: StaticDocSource;
    collection: IntercomCollection;
    sourceLocale: string;
  };
}

/**
 * Resolve a publication id that names a runtime-discovered section.
 *
 * An Intercom Help Center's collections are content, not configuration —
 * pinning their ids in the registry would mean a code change whenever Jamf
 * adds one — so they are looked up. Tried before the Fluid Topics registry
 * for the same reason the declared static sections are: that registry would
 * report them unknown and suggest a bundle family instead.
 *
 * Returns null when the id names no dynamic source, so the caller falls
 * through to the Fluid Topics path.
 */
async function resolveDynamicSection(
  ctx: ServerContext,
  publication: string,
  locale: string,
): Promise<ResolvedTocSource | { error: string } | null> {
  for (const source of DYNAMIC_SECTION_SOURCES) {
    const prefix = source.dynamicSections?.idPrefix ?? source.id;
    if (!publication.startsWith(`${prefix}-`)) { continue; }

    const sourceLocale = source.locales[locale];
    if (sourceLocale === undefined) {
      return {
        error: `${source.name} does not publish in ${locale}. ` +
          `Available: ${Object.keys(source.locales).join(', ')}.`,
      };
    }

    const collections = await listIntercomCollections(ctx, source, sourceLocale);
    const match = collections.find(c => dynamicSectionId(source, c.slug) === publication);
    if (match === undefined) {
      const available = collections.map(c => `- \`${dynamicSectionId(source, c.slug)}\``);
      return {
        error: available.length > 0
          ? `Unknown ${source.name} collection: "${publication}".\n\nAvailable in ${locale}:\n${available.join('\n')}`
          : `Unknown ${source.name} collection: "${publication}".\n\n${source.name} publishes nothing in ${locale}.`,
      };
    }

    return {
      source: publication,
      sourceLabel: `${source.name}: ${match.name}`,
      availableVersions: [],
      intercomCollection: { source, collection: match, sourceLocale },
    };
  }
  return null;
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

  // Static sources first: their sections are publications too, and they are
  // not in the Fluid Topics maps registry, so asking it would report them as
  // unknown and suggest something else.
  const staticRow = staticSectionById(publication);
  if (staticRow !== undefined) {
    const locale = params.language ?? DEFAULT_LOCALE;
    const sourceLocale = staticRow.source.locales[locale];
    if (sourceLocale === undefined) {
      return {
        error: `${staticRow.source.name} does not publish in ${locale}. ` +
          `Available: ${Object.keys(staticRow.source.locales).join(', ')}.`,
      };
    }
    return {
      source: publication,
      sourceLabel: staticRow.section.title,
      availableVersions: [],
      staticSection: { ...staticRow, sourceLocale },
    };
  }

  const dynamic = await resolveDynamicSection(ctx, publication, params.language ?? DEFAULT_LOCALE);
  if (dynamic !== null) { return dynamic; }

  // Not an enum: the family set is upstream's to change and grows without
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

/**
 * Fetch the TOC from whichever kind of source the request resolved to.
 *
 * Three shapes of upstream — a Fluid Topics map, a sitemap tree, an Intercom
 * collection — behind one return type, so nothing downstream has to know
 * which answered. Each path applies the same pagination and truncation.
 */
async function fetchTocFor(
  ctx: ServerContext,
  resolved: ResolvedTocSource,
  version: string,
  options: FetchTocOptions,
): Promise<FetchTocResult> {
  if (resolved.intercomCollection !== undefined) {
    const { source, collection } = resolved.intercomCollection;
    return await fetchIntercomToc(ctx, source, collection, options);
  }
  if (resolved.staticSection !== undefined) {
    const { source, section, sourceLocale } = resolved.staticSection;
    return await fetchStaticToc(ctx, source, section, sourceLocale, options);
  }
  return await fetchTableOfContents(ctx, resolved.source, version, options);
}

/**
 * `structuredContent` for one page, before the notices are added.
 *
 * Its own function for the reason `buildStructuredContent` is in the glossary
 * tool: it keeps the handler under the lint complexity limit.
 */
function buildTocStructuredContent(
  params: GetTocInput,
  sourceLabel: string,
  version: string,
  result: FetchTocResult,
  maxTokens: number,
): Record<string, unknown> {
  const { toc, pagination, mapId, truncatedEntry } = result;
  return {
    product: sourceLabel,
    // The ID, not just the display name: a client paging through this
    // TOC has to pass the same argument back, and `product` is an enum
    // of IDs. Sending only the name made "next page" impossible. For a
    // publication the id goes back under its own key, so a client can
    // tell which parameter to resend without matching against the enum.
    ...(params.product !== undefined ? { productId: params.product } : {}),
    ...(params.publication !== undefined ? { publicationId: params.publication } : {}),
    version,
    // Resent with the next page like the id and the budget: a translation is
    // not the same size as the English, so its pages break elsewhere.
    ...(params.language !== undefined ? { language: params.language } : {}),
    // Pairs with each entry's `contentId` to form the direct-fetch pair
    // `jamf_docs_get_article` documents.
    ...(mapId !== undefined ? { mapId } : {}),
    totalEntries: pagination.totalItems,
    page: pagination.page,
    totalPages: pagination.totalPages,
    hasMore: pagination.hasNext,
    // Pages are cut to the budget, so the next page follows this one only
    // when it is asked for with the same `maxTokens`.
    maxTokens,
    entries: flattenTocEntries(toc),
    ...(truncatedEntry !== undefined ? { truncatedEntry } : {}),
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
        const { sourceLabel, availableVersions } = resolved;

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

        const tocOptions = {
          ...(params.page !== undefined && { page: params.page }),
          maxTokens: params.maxTokens ?? TOKEN_CONFIG.DEFAULT_MAX_TOKENS,
          locale: params.language as LocaleId | undefined,
        };

        const tocResult = await fetchTocFor(ctx, resolved, version, tocOptions);

        await reportProgress(extra, { progress: 1, total: 4, message: 'Processing entries...' });

        const { toc, pagination, tokenInfo, paginationNote, mapId, resolvedLocale, truncatedEntry } = tocResult;

        // Build response
        const response: TocResponse = {
          product: sourceLabel,
          version,
          ...(mapId !== undefined ? { mapId } : {}),
          toc,
          tokenInfo,
          pagination,
          ...(truncatedEntry !== undefined ? { truncatedEntry } : {}),
        };

        const structuredContent = buildTocStructuredContent(
          params, sourceLabel, version, tocResult, tocOptions.maxTokens,
        );

        const notices: TocNotices = {
          // Two arguments, not one: the note is only truthful when the version
          // asked for is absent from the maps Jamf actually publishes.
          versionNote: getVersionNote(params.version, availableVersions),
          localeNote: getLocaleNote(params.language, resolvedLocale),
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
          ? formatTocCompact(sourceLabel, toc, pagination, tocOptions.maxTokens)
          : formatTocFull({
            productName: sourceLabel, version, mapId, toc, pagination, tokenInfo, truncatedEntry,
            maxTokens: tocOptions.maxTokens,
          }))
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
