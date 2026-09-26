/**
 * jamf_docs_search tool
 * Search Jamf documentation for articles matching a query.
 */

import type { McpServer } from '@modelcontextprotocol/server';
import type { ServerContext } from '../types/context.js';
import { appToolMeta } from '../apps/index.js';
import { SearchInputSchema } from '../schemas/index.js';
import { SearchOutputSchema, type SearchStructuredOutput } from '../schemas/output.js';
import type { ProductId, TopicId, DocTypeId, LocaleId } from '../constants.js';
import { ResponseFormat, OutputMode, JAMF_PRODUCTS, JAMF_TOPICS, COMMON_TOPIC_IDS, TOPIC_IDS, TOKEN_CONFIG, CONTENT_LIMITS, PAGINATION_CONFIG, DEFAULT_LOCALE } from '../constants.js';
import type { ToolResult, SearchResponse, SearchResult, SearchRanker, PaginationInfo, TokenInfo } from '../types.js';
import { searchDocumentation } from '../services/search-service.js';
import { generateSearchSuggestions, formatSearchSuggestions } from '../services/search-suggestions.js';
import { sanitizeMarkdownText, sanitizeMarkdownUrl, getSafeErrorMessage } from '../utils/sanitize.js';
import { reportProgress } from '../utils/progress.js';
import {
  searchStaticSources,
  type StaticSearchHit,
} from '../services/static-search-service.js';

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

/**
 * The `mapId` + `contentId` pair, rendered for the markdown path.
 *
 * `jamf_docs_get_article` documents this pair as obtainable "from search
 * results", and markdown is the default `responseFormat` — printing it only in
 * `structuredContent` would leave the documented workflow unreachable for any
 * client that reads the text content. Returns `''` unless both halves are
 * present, because either one alone cannot address an article.
 */
function formatResultIds(result: SearchResult): string {
  const { mapId, contentId } = result;
  if (mapId === undefined || mapId === '' || contentId === undefined || contentId === '') {
    return '';
  }
  return `**IDs**: mapId=${sanitizeMarkdownText(mapId)}, contentId=${sanitizeMarkdownText(contentId)}`;
}

/**
 * The result's place in its product's table of contents, rendered above the
 * snippet.
 *
 * Page slugs collide across this corpus — `Overview`, `Policies`,
 * `Getting-Started` and `Release-History` each exist under several products —
 * so a page of ten same-titled hits cannot be told apart from title and snippet
 * alone. `SearchOutputSchema` has always declared `breadcrumb` and
 * `buildSearchResult` has always populated it from the Fluid Topics topic; both
 * output paths dropped it, so the one field that separates those hits reached
 * no caller.
 *
 * Rendered with the same `*A > B > C*` shape `formatArticleFull` uses, so the
 * trail reads the same whichever tool produced it. Returns `''` for an absent
 * or empty trail rather than an empty italic line.
 */
function formatResultBreadcrumb(result: SearchResult): string {
  const { breadcrumb } = result;
  if (breadcrumb === undefined || breadcrumb.length === 0) {
    return '';
  }
  return `*${breadcrumb.map(sanitizeMarkdownText).join(' > ')}*\n\n`;
}

function formatSearchResult(result: SearchResult): string {
  let output = `### [${sanitizeMarkdownText(result.title)}](${sanitizeMarkdownUrl(result.url)})\n\n`;
  output += formatResultBreadcrumb(result);
  output += `> ${sanitizeMarkdownText(result.snippet)}\n\n`;
  const meta: string[] = [];
  if (result.product !== null && result.product !== '') {
    meta.push(`**Product**: ${result.product}`);
  }
  // A product search shows every result under the product searched for, and
  // Jamf files some documents under several. Where the product would pass one
  // off as its own — a topic titled "Windows" from the Jamf Trust release
  // notes, shown as Jamf Protect — name the publication. Only then: on every
  // result it would cost tokens to repeat what the product already says.
  if (result.crossFiled === true && result.mapTitle !== undefined) {
    meta.push(`**Publication**: ${sanitizeMarkdownText(result.mapTitle)}`);
  }
  if (result.version !== undefined) {
    meta.push(`**Version**: ${result.version}`);
  }
  // Say what was collapsed, and how to get it. Naming the newest few rather
  // than all of them keeps a release-notes hit readable — one topic can span
  // forty-three versions — while still proving the older ones exist.
  if (result.otherVersions !== undefined && result.otherVersions.length > 0) {
    const shown = result.otherVersions.slice(0, 3).join(', ');
    const rest = result.otherVersions.length - 3;
    meta.push(
      `**Also in**: ${shown}${rest > 0 ? ` +${String(rest)} more` : ''}` +
      ' (pass `version` to fetch one)'
    );
  }
  const ids = formatResultIds(result);
  if (ids !== '') {
    meta.push(ids);
  }
  if (meta.length > 0) {
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
  footer += '\n\n*Use `jamf_docs_get_article` with any URL above — or with the `mapId` + `contentId` pair shown with a result — to read the full article.*\n';
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

  // Compact is one line per result by design, so the mapId + contentId pair
  // stays out of it — printing both on every line roughly doubles the output
  // this mode exists to avoid. The full path renders them inline; say where
  // they are rather than leaving the documented workflow looking unavailable.
  // Same trade get_toc already makes for its per-entry contentIds.
  if (results.some((r) => r.mapId !== undefined && r.contentId !== undefined)) {
    markdown +=
      '*The `mapId` + `contentId` pair `jamf_docs_get_article` accepts is omitted here; ' +
      'use `outputMode="full"` or read `structuredContent`.*\n';
  }

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

// Topic hint derived from COMMON_TOPIC_IDS — see constants/topics.ts. Keeping
// this dynamic prevents the description from drifting away from the enum.
const TOPIC_HINT = `Filter by topic. Common: ${COMMON_TOPIC_IDS.join(', ')}. See jamf_docs_list_products for the full list of ${TOPIC_IDS.length} topic IDs.`;

/**
 * Worked examples surfaced in TOOL_DESCRIPTION to nudge LLMs toward
 * (query + filter) combinations that maximise recall.
 *
 * Typing `product` as `ProductId` and `topic` as `TopicId` makes the compiler
 * reject any ID that does not exist in JAMF_PRODUCTS / JAMF_TOPICS. The
 * `SEARCH_EXAMPLES are valid` test in search-examples.test.ts is the runtime
 * belt-and-braces guard.
 */
interface SearchExample {
  /** Plain-English query an admin might ask */
  label: string;
  /** Search keywords passed as `query` */
  query: string;
  product?: ProductId;
  topic?: TopicId;
  /** Optional page (used for the pagination demo) */
  page?: number;
}

export const SEARCH_EXAMPLES: readonly SearchExample[] = [
  { label: 'Configure SSO with Okta in Jamf Connect', query: 'SSO Okta', product: 'jamf-connect', topic: 'sso' },
  { label: 'Set up FileVault encryption', query: 'FileVault encryption', product: 'jamf-pro', topic: 'filevault' },
  { label: 'Patch macOS apps', query: 'patch policy', product: 'jamf-pro', topic: 'patch' },
  { label: 'Smart group criteria', query: 'smart group criteria', product: 'jamf-pro', topic: 'reports' },
  { label: 'Automated Device Enrollment workflow', query: 'ADE prestage', product: 'jamf-pro', topic: 'enrollment' },
  { label: 'Shared iPad in a classroom', query: 'shared iPad classroom', product: 'jamf-school', topic: 'education' },
  { label: 'Jamf Protect custom analytic', query: 'custom analytic', product: 'jamf-protect', topic: 'protect-analytics' },
  { label: 'Jamf Pro REST API authentication', query: 'API role bearer token', product: 'jamf-pro', topic: 'api' },
  { label: 'Extension attribute scripts', query: 'extension attribute script', product: 'jamf-pro', topic: 'extension-attributes' },
  { label: 'Paginate through results', query: 'policy', page: 2 },
];

function formatSearchExample(ex: SearchExample): string {
  const parts: string[] = [`query="${ex.query}"`];
  if (ex.product !== undefined) {
    parts.push(`product="${ex.product}"`);
  }
  if (ex.topic !== undefined) {
    parts.push(`topic="${ex.topic}"`);
  }
  if (ex.page !== undefined) {
    parts.push(`page=${ex.page}`);
  }
  return `  - "${ex.label}" → ${parts.join(', ')}`;
}

const EXAMPLES_BLOCK = SEARCH_EXAMPLES.map(formatSearchExample).join('\n');

/**
 * The `version` example is one learn.jamf.com serves. The two it replaced, both
 * from the initial release, did not work: VersionSchema rejects "10.x", and
 * "11.5.0" passes the schema but finds nothing, because Jamf Pro documentation
 * is published for 11.13.0 through 11.32.0 only. Live on 2026-09-24,
 * `query: "policy"` returned 0 results with 11.5.0 and 50 with 11.13.0. The
 * schema's own `.describe()` was fixed in #246; this copy was missed, and
 * `language` never had a bullet. The "Invalid product ID" error listed here is
 * the handler's, which the schema's enum pre-empts: a client sees the SDK's
 * "Invalid option: expected one of".
 *
 * `otherSources` joined the JSON shape on 2026-09-26, when the JSON text began
 * to carry it. The comment on it is the caveat the markdown prints under the
 * same matches (see renderOtherSources): the JSON reply's relevanceNote
 * speaks of "Results", and these are not ranked with them.
 */
export const TOOL_DESCRIPTION = `Search Jamf documentation for articles matching your query.

This tool searches across all Jamf product documentation including Jamf Pro,
Jamf School, Jamf Connect, Jamf Protect, Jamf Now, Jamf Safe Internet, and more.
Results include article titles, snippets, and direct links.

Args:
  - query (string, required): Search keywords (2-200 characters)
  - product (string, optional): Filter by product ID (use jamf_docs_list_products to see all)
  - topic (string, optional): ${TOPIC_HINT}
  - docType (string, optional): Filter by document type: documentation, release-notes, training, solution-guide, glossary, getting-started
  - version (string, optional): Filter by version (e.g., "11.13.0") or "current"
  - language (string, optional): Documentation language/locale (default: ${DEFAULT_LOCALE})
  - limit (number, optional): Maximum results per page 1-${CONTENT_LIMITS.MAX_SEARCH_RESULTS} (default: ${CONTENT_LIMITS.DEFAULT_SEARCH_RESULTS})
  - page (number, optional): Page number for pagination 1-${PAGINATION_CONFIG.MAX_PAGE} (default: ${PAGINATION_CONFIG.DEFAULT_PAGE})
  - maxTokens (number, optional): Maximum tokens in response ${TOKEN_CONFIG.MIN_TOKENS}-${TOKEN_CONFIG.MAX_TOKENS_LIMIT} (default: ${TOKEN_CONFIG.DEFAULT_MAX_TOKENS})
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
    },
    // Pages outside the product documentation, matched on title and ranked
    // separately from "results", which carry no score to rank them against.
    // Omitted when none matched.
    "otherSources"?: [{ "title": string, "url": string, "source": string }]
  }

  For Markdown format:
  A formatted list of search results with pagination and token info.

Examples (common query → recommended filters):
${EXAMPLES_BLOCK}

Errors:
  - "No results found" if search returns empty
  - "Invalid option: expected one of ..." (an input validation error) if product, topic, docType or language is not one of the values the input schema lists

Note: Results are ranked by relevance. Use filters and pagination to navigate large result sets.
Most results carry a mapId + contentId pair; pass both to jamf_docs_get_article
to fetch that article directly instead of resolving its URL. The pair is omitted
when a result comes from a source that does not resolve one — fall back to the
URL in that case.`;

/**
 * The filters a result set was produced under.
 *
 * Echoed back in `structuredContent` so a client can request the next page of
 * the *same* search. `product`, `docType` and `version` are sent upstream to
 * Fluid Topics and `product`/`topic` are re-applied locally, so a page-2
 * request that omits them queries a different population — silently, since it
 * still returns plausible-looking results.
 *
 * `limit` is deliberately not here: it is the page size, reported alongside
 * `page` and `totalPages` where it belongs, and it always has a value because
 * the schema defaults it.
 */
interface ActiveSearchFilters {
  product?: string;
  topic?: string;
  version?: string;
  docType?: string;
  language?: string;
}

function activeSearchFilters(params: {
  product?: string | undefined;
  topic?: string | undefined;
  version?: string | undefined;
  docType?: string | undefined;
  language?: string | undefined;
}): ActiveSearchFilters | undefined {
  const filters: ActiveSearchFilters = {
    ...(params.product !== undefined && { product: params.product }),
    ...(params.topic !== undefined && { topic: params.topic }),
    ...(params.version !== undefined && { version: params.version }),
    ...(params.docType !== undefined && { docType: params.docType }),
    ...(params.language !== undefined && { language: params.language }),
  };

  return Object.keys(filters).length > 0 ? filters : undefined;
}

/**
 * Render the other-source hits as a labelled trailer.
 *
 * Below the results and clearly separated, because these come from a
 * different ranking that shares no scale with the one above — and because
 * two of the three sources are not product documentation.
 */
function renderOtherSources(hits: StaticSearchHit[]): string {
  if (hits.length === 0) { return ''; }

  const bySource = new Map<string, StaticSearchHit[]>();
  for (const hit of hits) {
    bySource.set(hit.source, [...(bySource.get(hit.source) ?? []), hit]);
  }

  let out = '\n---\n\n## Also found outside the product documentation\n\n';
  for (const [source, sourceHits] of bySource) {
    out += `**${source}**\n\n`;
    for (const hit of sourceHits) {
      out += `- [${sanitizeMarkdownText(hit.title)}](${sanitizeMarkdownUrl(hit.url)})\n`;
    }
    out += '\n';
  }
  out += '*Matched on title, ranked separately from the results above, '
    + 'which carry no score to rank them against.*\n';
  return out;
}

/**
 * The JSON reply's sentence on ordering, naming the backend that ranked.
 *
 * Neither wording promises a score. The one this replaced said "relevance
 * scores ... higher values indicate stronger keyword matches", but Fluid
 * Topics returns no score of any kind — a clustered-search entry carries only
 * `type`, `missingTerms` and the topic/map payload, with no score, rank or
 * weight field anywhere in the response — and no result this server emits has
 * ever carried a numeric relevance. Both carry the words "no numeric relevance
 * score", in lower case: clients match on them, and at least one downstream
 * test does so case-sensitively on the provider path.
 *
 * Fluid Topics is named only when the service says it ranked the results. Its
 * ordering is real: `sortId: 'relevance'` is sent explicitly (see
 * resolveSearchResults). A SearchProvider answers before any Fluid Topics
 * request is built, and core keeps its order but cannot see how it was
 * reached, so that branch says whose order it is and nothing about the
 * method. It is also the wording when nothing says who ranked: crediting
 * Fluid Topics needs Fluid Topics to have answered. The service leaves
 * `rankedBy` unset only on a failed search, which has no results and gets the
 * no-results reply before any note is built, so that default is for a result
 * built without the field, not a path the service reaches.
 */
function relevanceNote(rankedBy: SearchRanker | undefined): string {
  return rankedBy === 'fluid-topics'
    ? 'Results are ordered by relevance, as ranked by the Fluid Topics search API. '
      + 'The API returns no numeric relevance score, so none is included.'
    : 'Results are in the order the configured search backend ranked them; '
      + 'no numeric relevance score is included.';
}

/** What the structured channel does with one field of a search result. */
type SearchResultFieldDisposition =
  /** Copied through verbatim when the result has it. */
  | 'publish'
  /** Emitted, but not verbatim: see {@link toStructuredResult}. */
  | 'replace'
  /** Deliberately not on this channel. No field is, today. */
  | 'withhold';

/**
 * Every field of {@link SearchResult}, and what the structured channel does
 * with it.
 *
 * The guard `ARTICLE_FIELD_DISPOSITION` puts on get-article, for the defect it
 * was put there for. This builder used to list the result fields it copied
 * one by one, and a field left off the list was dropped with no error
 * anywhere: `mapId` and `contentId` until #200, `breadcrumb` until #216, and
 * `mapTitle` until 2026-09-26. `SearchOutputSchema` had declared `mapTitle`
 * since #78 and the JSON text carried it, so the channel a program reads was
 * the one that could not say which publication a result came from. That
 * mattered most for the results #343 marks `crossFiled`, which the schema
 * never declared at all. Live, jamf-protect + "install" named the publication
 * of 27 of its 44 results in markdown; the JSON text carried `mapTitle` on
 * all 44 and `crossFiled` on 27, and structuredContent carried neither.
 *
 * So `satisfies Record<keyof SearchResult, …>` stops this compiling when a
 * field is added to `SearchResult`, until someone says what happens to it.
 * The two checks below compare this table, not what the builder returns,
 * with the result keys `SearchOutputSchema` declares: a key the table
 * publishes or replaces that the schema does not declare fails `tsc`, and so
 * does a declared key the table does not publish or replace.
 * `toStructuredResult` copies every `publish` field in a loop, so none of
 * those can be left off. Whether it emits the `replace` fields, and with
 * values of the declared types, is for the tests to check:
 * test/unit/tools/search-structured-output.test.ts does.
 */
const SEARCH_RESULT_FIELD_DISPOSITION = {
  title: 'publish',
  url: 'publish',
  snippet: 'publish',
  version: 'publish',
  docType: 'publish',
  // `jamf_docs_get_article` tells callers to take these "from search results
  // or TOC".
  mapId: 'publish',
  contentId: 'publish',
  mapTitle: 'publish',
  crossFiled: 'publish',
  otherVersions: 'publish',
  // `null` when Fluid Topics sends no classification, and the schema declares
  // a string.
  product: 'replace',
  // Slugs collide across products, so this is the field that tells ten
  // `Overview` hits apart. Omitted, not emitted as `[]`: "no trail known" and
  // "a trail with no steps in it" are different, and only the first is true.
  breadcrumb: 'replace',
} as const satisfies Record<keyof SearchResult, SearchResultFieldDisposition>;

type SearchResultField = keyof typeof SEARCH_RESULT_FIELD_DISPOSITION;

/** The `SearchResult` keys the table sends to the structured channel, verbatim or replaced. */
type EmittedSearchResultField = {
  [K in SearchResultField]: (typeof SEARCH_RESULT_FIELD_DISPOSITION)[K] extends 'withhold' ? never : K
}[SearchResultField];

type StructuredSearchResult = SearchStructuredOutput['results'][number];

type KeysWithin<All, Some extends All> = Some;

/**
 * Compile error if the table publishes or replaces a key that
 * `SearchOutputSchema` does not declare. Its result items allow no other key,
 * so the client's check of the reply against the published schema would
 * reject every search that carried it.
 */
export type EmittedSearchResultFieldsAreDeclared = KeysWithin<
  keyof StructuredSearchResult,
  EmittedSearchResultField
>;

/**
 * Compile error if `SearchOutputSchema` declares a result key that the table
 * does not publish or replace. In this table the `mapTitle` drop would have
 * been `mapTitle: 'withhold'`, and would not have compiled.
 */
export type DeclaredSearchResultFieldsAreEmitted = KeysWithin<
  EmittedSearchResultField,
  keyof StructuredSearchResult
>;

/**
 * `result` without a `mapTitle` that is not a string or a `crossFiled` that is
 * not a boolean.
 *
 * `SearchResult` types both, but a SearchProvider's results are taken as
 * given, and a provider that builds them from untyped rows can hand over a
 * database `NULL` as `mapTitle: null`. Until 2026-09-26 neither field reached
 * structuredContent, so a value like that did no harm there. Published as is,
 * it fails the client's check against `SearchOutputSchema`, and the whole
 * search becomes an output validation error. Read as absent, it still says
 * what the provider said: no publication named, not marked cross-filed.
 *
 * Applied before any channel is built, so the markdown, the JSON text and
 * structuredContent agree, and the markdown's publication note is never asked
 * to escape a `null` title, which threw. A well-typed result is returned as it
 * came.
 */
function withWellTypedPublication(result: SearchResult): SearchResult {
  const { mapTitle, crossFiled }: { mapTitle?: unknown; crossFiled?: unknown } = result;
  const mapTitleFits = mapTitle === undefined || typeof mapTitle === 'string';
  const crossFiledFits = crossFiled === undefined || typeof crossFiled === 'boolean';
  if (mapTitleFits && crossFiledFits) {
    return result;
  }
  const kept = { ...result };
  if (!mapTitleFits) {
    delete kept.mapTitle;
  }
  if (!crossFiledFits) {
    delete kept.crossFiled;
  }
  return kept;
}

/**
 * One result as the structured channel publishes it.
 *
 * A field the result does not have is left out, not filled in with an empty
 * value, so "the backend did not say" stays distinct from any value it could
 * have said: no `mapTitle: ''`, no `crossFiled: false`. A `publish` field the
 * result does have is sent as it is; {@link withWellTypedPublication} has
 * already dropped a mistyped `mapTitle` or `crossFiled`.
 */
function toStructuredResult(r: SearchResult): Record<string, unknown> {
  const published: Record<string, unknown> = {};
  for (const [field, disposition] of Object.entries(SEARCH_RESULT_FIELD_DISPOSITION)) {
    if (disposition !== 'publish') {
      continue;
    }
    const value = r[field as SearchResultField];
    if (value !== undefined) {
      published[field] = value;
    }
  }

  return {
    ...published,
    product: r.product ?? '',
    ...(r.breadcrumb !== undefined && r.breadcrumb.length > 0 ? { breadcrumb: r.breadcrumb } : {}),
  };
}

/**
 * The other-source matches, as both JSON channels carry them.
 *
 * Omitted rather than emitted empty: "nothing matched elsewhere" and "the
 * other sources were not reachable" are different answers, and an empty array
 * would claim the first.
 */
function otherSourcesField(
  hits: StaticSearchHit[] | undefined,
): { otherSources?: { title: string; url: string; source: string }[] } {
  return hits !== undefined && hits.length > 0
    ? { otherSources: hits.map(hit => ({ title: hit.title, url: hit.url, source: hit.source })) }
    : {};
}

function buildSearchStructuredContent(
  query: string,
  results: SearchResult[],
  pagination: PaginationInfo,
  extras?: {
    filters?: ActiveSearchFilters | undefined;
    limit?: number | undefined;
    filterRelaxation?: { removed: string[]; original: Record<string, string>; message: string } | undefined;
    truncatedContent?: { omittedCount: number; omittedItems: { title: string; estimatedTokens: number }[] } | undefined;
    versionNote?: string | undefined;
    paginationNote?: string | undefined;
    otherSources?: StaticSearchHit[] | undefined;
  }
): Record<string, unknown> {
  return {
    query,
    ...(extras?.filters !== undefined ? { filters: extras.filters } : {}),
    totalResults: pagination.totalItems,
    page: pagination.page,
    totalPages: pagination.totalPages,
    ...(extras?.limit !== undefined ? { limit: extras.limit } : {}),
    hasMore: pagination.hasNext,
    results: results.map(toStructuredResult),
    ...(extras?.filterRelaxation !== undefined ? { filterRelaxation: extras.filterRelaxation } : {}),
    ...(extras?.versionNote !== undefined ? { versionNote: extras.versionNote } : {}),
    ...(extras?.paginationNote !== undefined ? { paginationNote: extras.paginationNote } : {}),
    ...(extras?.truncatedContent !== undefined ? { truncatedContent: extras.truncatedContent } : {}),
    ...otherSourcesField(extras?.otherSources),
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

  /**
   * Queries a client can run, and nothing else.
   *
   * `generateSearchSuggestions` already separates what is runnable
   * (`simplifiedQuery`, `alternativeKeywords`) from what is advice (`tips`,
   * and the locale note below), and this array used to flatten all of it
   * together. A structured client cannot tell the two apart afterwards, so
   * the MCP App rendered "Try removing filters to broaden your search" as a
   * clickable search and, when clicked, searched Jamf for that sentence. The
   * `Try: ` prefix had the same fault one step earlier: it made the one
   * genuinely runnable entry un-runnable, because the prefix went into the
   * query too.
   *
   * Nothing is lost by dropping the prose here. The advice reaches the model
   * through `formatSearchSuggestions` on the text channel below, which is the
   * channel prose belongs on; `structuredContent.suggestions` is read only by
   * clients that are going to *do* something with each entry.
   */
  const suggestionTexts = [
    ...(suggestions.simplifiedQuery !== null ? [suggestions.simplifiedQuery] : []),
    ...suggestions.alternativeKeywords
  ];

  // The locale caveat is advice, so it rides the text channel with the rest of
  // the advice rather than being mixed into the runnable list above.
  const localeNote =
    locale !== undefined && locale !== DEFAULT_LOCALE
      ? `\n\nNot all documentation is available in "${locale}". Try searching with language: "${DEFAULT_LOCALE}".`
      : '';

  return {
    content: [{
      type: 'text',
      text: `${formatSearchSuggestions(query, suggestions)}${localeNote}`
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
 * Append filter/version/pagination/truncation notices to markdown output
 */
function appendMarkdownNotices(
  markdown: string,
  notices: {
    filterRelaxation?: { message: string } | undefined;
    versionNote?: string | undefined;
    paginationNote?: string | undefined;
    truncatedContent?: { omittedCount: number } | undefined;
  }
): string {
  let result = markdown;
  if (notices.filterRelaxation !== undefined) {
    result += `\n> **Note:** ${notices.filterRelaxation.message}\n`;
  }
  if (notices.versionNote !== undefined) {
    result += `\n> **Version Note:** ${notices.versionNote}\n`;
  }
  if (notices.paginationNote !== undefined) {
    result += `\n> **Pagination Note:** ${notices.paginationNote}\n`;
  }
  if (notices.truncatedContent !== undefined && notices.truncatedContent.omittedCount > 0) {
    result += `\n*${notices.truncatedContent.omittedCount} additional result(s) omitted due to token limit.*\n`;
  }
  return result;
}

/**
 * Build a display-level filter summary from search params.
 */
function buildFilterSummary(params: { product?: string | undefined; version?: string | undefined; topic?: string | undefined }): SearchFilters {
  return {
    ...(params.product !== undefined ? { product: params.product } : {}),
    ...(params.version !== undefined ? { version: params.version } : {}),
    ...(params.topic !== undefined ? { topic: params.topic } : {})
  };
}

export function registerSearchTool(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: 'Search Jamf Documentation',
      description: TOOL_DESCRIPTION,
      inputSchema: SearchInputSchema,
      outputSchema: SearchOutputSchema,
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

        await reportProgress(extra, { progress: 0, total: 3, message: 'Searching documentation...' });

        // Perform search
        const searchResult = await searchDocumentation(ctx, {
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

        await reportProgress(extra, { progress: 1, total: 3, message: 'Processing results...' });

        // The non-Fluid-Topics sources, as their own block.
        //
        // Deliberately not merged into the ranking above. A SearchResult
        // carries no score: Fluid Topics returns none (see relevanceNote),
        // and the type has no field in which a SearchProvider could pass one
        // on. So there is nothing on either side to fuse two orderings on.
        // Interleaving them on an invented number would look authoritative
        // and would not be. Never allowed to fail the search it runs beside.
        const otherSources = await searchStaticSources(
          ctx, params.query, params.language ?? DEFAULT_LOCALE,
        ).catch((error: unknown) => {
          ctx.logger.createLogger('search').warning(
            `Other-source search failed: ${String(error)}`,
          );
          return [];
        });

        const {
          pagination, tokenInfo, filterRelaxation, versionNote,
          paginationNote, truncatedContent, rankedBy
        } = searchResult;
        // Before any channel is built, so all three read the same fields.
        const results = searchResult.results.map(withWellTypedPublication);

        // Build response
        const filters = buildFilterSummary(params);
        const response: SearchResponse = {
          total: pagination.totalItems,
          query: params.query,
          results,
          filters,
          tokenInfo,
          pagination,
          ...(filterRelaxation !== undefined ? { filterRelaxation } : {}),
          ...(versionNote !== undefined ? { versionNote } : {}),
          ...(paginationNote !== undefined ? { paginationNote } : {}),
          ...(truncatedContent !== undefined ? { truncatedContent } : {})
        };

        await reportProgress(extra, { progress: 2, total: 3, message: 'Formatting output...' });

        // Handle no results with suggestions
        if (results.length === 0 && pagination.totalItems === 0) {
          await reportProgress(extra, { progress: 3, total: 3 });
          return buildNoResultsResponse(
            params.query,
            params.product !== undefined,
            params.topic !== undefined,
            params.language as LocaleId | undefined
          );
        }

        const structuredContent = buildSearchStructuredContent(
          params.query, results, pagination,
          {
            filters: activeSearchFilters(params),
            limit: params.limit,
            filterRelaxation,
            versionNote,
            paginationNote,
            truncatedContent,
            otherSources,
          }
        );

        if (params.responseFormat === ResponseFormat.JSON) {
          // Add relevance note only in JSON format. It states the ordering and
          // who produced it, and nothing more — see relevanceNote.
          const jsonResponse = {
            ...response,
            // The markdown lists these below the results, and structuredContent
            // has carried them since #266. Until 2026-09-26 this text did not.
            // The caveat the markdown prints under them is in TOOL_DESCRIPTION.
            ...otherSourcesField(otherSources),
            relevanceNote: relevanceNote(rankedBy)
          };
          await reportProgress(extra, { progress: 3, total: 3 });
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
          { filterRelaxation, versionNote, paginationNote, truncatedContent }
        ) + renderOtherSources(otherSources);

        await reportProgress(extra, { progress: 3, total: 3 });
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
