/**
 * jamf_docs_search tool
 * Search Jamf documentation for articles matching a query.
 */

import type { McpServer } from '@modelcontextprotocol/server';
import type { ServerContext } from '../types/context.js';
import { appToolMeta } from '../apps/index.js';
import { SearchInputSchema, type SearchInput } from '../schemas/index.js';
import { SearchOutputSchema, type SearchStructuredOutput } from '../schemas/output.js';
import type { ProductId, TopicId, DocTypeId, LocaleId } from '../constants.js';
import { ResponseFormat, OutputMode, JAMF_PRODUCTS, JAMF_TOPICS, COMMON_TOPIC_IDS, TOPIC_IDS, TOKEN_CONFIG, CONTENT_LIMITS, PAGINATION_CONFIG, DEFAULT_LOCALE } from '../constants.js';
import type {
  ToolResult,
  SearchResponse,
  SearchResult,
  SearchRanker,
  SearchDocumentationResult,
  SearchTruncatedResult,
  PaginationInfo,
  TokenInfo,
} from '../types.js';
import { searchDocumentation } from '../services/search-service.js';
import { generateSearchSuggestions, formatSearchSuggestions } from '../services/search-suggestions.js';
import { sanitizeMarkdownText, sanitizeMarkdownUrl } from '../utils/sanitize.js';
import { failureReason } from '../services/failure-reason.js';
import { reportProgress } from '../utils/progress.js';
import {
  searchStaticSources,
  type StaticSearchHit,
} from '../services/static-search-service.js';
import { NON_LATIN_LETTER, foreignWritingOf, type Writing } from '../utils/cjk.js';

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

/** One page of results, as the markdown renderers show it. */
interface SearchPageView {
  query: string;
  results: SearchResult[];
  filters: SearchFilters;
  pagination: PaginationInfo;
  tokenInfo: TokenInfo;
  /** How many results come before this page: see `SearchDocumentationResult.offset`. */
  offset: number;
  truncatedResult: SearchTruncatedResult | undefined;
}

/**
 * The `limit` and `maxTokens` to name beside the next page, each only when it
 * is not the default.
 *
 * A page holds as many whole results as fit `maxTokens`, and at most `limit`,
 * so page N+1 follows page N only when it is asked for with both the same.
 * Both footers used to say only which page came next. On 2026-09-28, page 1
 * of `query: "enrollment"` at `maxTokens: 1000` held its first 8 results, and
 * page 2 asked for as the footer said, at the default budget, starts at the
 * 11th, so following the footer skipped two. At the defaults, leaving both
 * out asks for the same pages, and the footer stays as it was.
 */
function pageShapeToResend(pagination: PaginationInfo, tokenInfo: TokenInfo): [string, number][] {
  return [
    ...(pagination.pageSize !== CONTENT_LIMITS.DEFAULT_SEARCH_RESULTS
      ? [['limit', pagination.pageSize] as [string, number]]
      : []),
    ...(tokenInfo.maxTokens !== TOKEN_CONFIG.DEFAULT_MAX_TOKENS
      ? [['maxTokens', tokenInfo.maxTokens] as [string, number]]
      : []),
  ];
}

/**
 * The line under a page that is one result cut to fit `maxTokens`.
 *
 * It used to read "Results truncated due to token limit. Use a smaller
 * `limit` or increase `maxTokens`." under every page the budget shortened
 * (`tokenInfo.truncated`), and `page` could not reach the results the cut
 * dropped (see `paginateSearchResults`). Pages are now cut to the budget, so
 * the only cut left is one result larger than `maxTokens` on its own, which
 * `truncatedResult` names, and the line says which, and the budget that shows
 * it whole — never one the schema rejects.
 */
function truncationLine(tokenInfo: TokenInfo, truncatedResult: SearchTruncatedResult): string {
  const { title, estimatedTokens } = truncatedResult;
  const cut = `"${sanitizeMarkdownText(title)}" is larger than \`maxTokens: ${String(tokenInfo.maxTokens)}\` on its own, ` +
    'so its snippet is cut to fit.';
  return estimatedTokens <= TOKEN_CONFIG.MAX_TOKENS_LIMIT
    ? `${cut} Repeat with \`maxTokens: ${String(estimatedTokens)}\` or more to see it whole; ` +
      'pages are cut to `maxTokens`, so it may then be on a different page.'
    : `${cut} It needs ${String(estimatedTokens)} tokens, more than \`maxTokens\` allows (${String(TOKEN_CONFIG.MAX_TOKENS_LIMIT)}).`;
}

function formatPaginationFooter(view: SearchPageView, compact = false): string {
  const { pagination, tokenInfo } = view;
  const resend = pageShapeToResend(pagination, tokenInfo);
  if (compact) {
    let footer = `\n---\n*Page ${pagination.page}/${pagination.totalPages}`;
    if (pagination.hasNext) {
      footer += ` | page=${pagination.page + 1}${resend.map(([name, value]) => `, ${name}=${String(value)}`).join('')} for more`;
    }
    footer += '*\n';
    return footer;
  }

  let footer = `**Page ${pagination.page} of ${pagination.totalPages}** (${tokenInfo.tokenCount.toLocaleString()} tokens)`;
  if (pagination.hasNext) {
    const shape = resend.length > 0
      ? ` with ${resend.map(([name, value]) => `\`${name}: ${String(value)}\``).join(', ')}`
      : '';
    footer += ` | Use \`page=${pagination.page + 1}\`${shape} for more results`;
  }
  if (view.truncatedResult !== undefined) {
    footer += `\n*${truncationLine(tokenInfo, view.truncatedResult)}*`;
  }
  footer += '\n\n*Use `jamf_docs_get_article` with any URL above — or with the `mapId` + `contentId` pair shown with a result — to read the full article.*\n';
  return footer;
}

/**
 * Format search result in compact mode (single line)
 *
 * `sharesUrl` marks a result whose url another result on the page has too.
 * Its line then ends with what tells it apart, since its title and link may
 * not: the breadcrumb entry above the result itself, and the `mapId` +
 * `contentId` pair, which is what fetches it. Jamf publishes some different
 * topics at one url, and the url fetches only one of them. Live on
 * 2026-09-28, en-US "technical articles" returned 19 technical-article
 * sections titled "Additional Information", all at
 * `/r/en-US/technical-articles/Additional_Information`, and a page holding
 * several of them showed as many lines of `[Additional Information](…)`,
 * told apart only by a cut snippet.
 */
function formatSearchResultCompact(result: SearchResult, index: number, sharesUrl = false): string {
  // Truncate snippet for compact display
  const snippetPreview = result.snippet.length > 80
    ? `${result.snippet.slice(0, 77)}...`
    : result.snippet;
  const apart = sharesUrl ? compactDistinction(result) : '';
  return `${index}. [${sanitizeMarkdownText(result.title)}](${sanitizeMarkdownUrl(result.url)}) - ${sanitizeMarkdownText(snippetPreview)}${apart}\n`;
}

/** ` (in {parent}; mapId=…, contentId=…)`, each part when the result has it, or ''. */
function compactDistinction(result: SearchResult): string {
  const trail = result.breadcrumb ?? [];
  // A topic's trail ends with its own title (all 16,750 topic entries in 70
  // searches on 2026-09-28), which is what these results may share.
  const parent = trail.at(-1) === result.title ? trail.at(-2) : trail.at(-1);
  const parts = [
    ...(parent !== undefined && parent !== '' ? [`in ${sanitizeMarkdownText(parent)}`] : []),
    ...(hasIds(result)
      ? [`mapId=${sanitizeMarkdownText(result.mapId)}, contentId=${sanitizeMarkdownText(result.contentId)}`]
      : []),
  ];
  return parts.length > 0 ? ` (${parts.join('; ')})` : '';
}

/** Whether both halves of the pair `jamf_docs_get_article` accepts are present. */
function hasIds(result: SearchResult): result is SearchResult & { mapId: string; contentId: string } {
  return result.mapId !== undefined && result.mapId !== ''
    && result.contentId !== undefined && result.contentId !== '';
}

/**
 * Format search results as compact markdown
 */
function formatSearchResultsAsCompact(view: SearchPageView): string {
  const { query, results, filters, pagination } = view;
  let markdown = `## "${query}" (${pagination.totalItems} results)\n`;
  markdown += formatFiltersLine(filters);
  markdown += '\n\n';

  const perUrl = new Map<string, number>();
  for (const r of results) {
    perUrl.set(r.url, (perUrl.get(r.url) ?? 0) + 1);
  }
  const sharesUrl = (r: SearchResult): boolean => (perUrl.get(r.url) ?? 0) > 1;

  // Numbered by rank across the whole result set. A page holds as many
  // results as fit `maxTokens`, so page 2 does not start at `limit` + 1.
  results.forEach((result, idx) => {
    markdown += formatSearchResultCompact(result, view.offset + idx + 1, sharesUrl(result));
  });

  markdown += formatPaginationFooter(view, true);

  // Compact is one line per result by design, so the mapId + contentId pair
  // stays out of it — printing both on every line roughly doubles the output
  // this mode exists to avoid. The full path renders them inline; say where
  // they are rather than leaving the documented workflow looking unavailable.
  // Same trade get_toc already makes for its per-entry contentIds. The
  // exception is a result that shares its url with another on the page
  // (see formatSearchResultCompact), and the note then says so.
  const omitted = results.some((r) => r.mapId !== undefined && r.contentId !== undefined && !(sharesUrl(r) && hasIds(r)));
  const shown = results.some((r) => sharesUrl(r) && hasIds(r));
  if (shown) {
    const others = omitted
      ? ' The other results\' pairs are omitted here; use `outputMode="full"` or read `structuredContent`.'
      : '';
    markdown +=
      '*Results that share a url show the `mapId` + `contentId` pair `jamf_docs_get_article` accepts: ' +
      `a url that several topics share fetches only one of them.${others}*\n`;
  } else if (omitted) {
    markdown +=
      '*The `mapId` + `contentId` pair `jamf_docs_get_article` accepts is omitted here; ' +
      'use `outputMode="full"` or read `structuredContent`.*\n';
  }

  return markdown;
}

function formatSearchResultsAsMarkdown(view: SearchPageView): string {
  const { query, results, filters, pagination, tokenInfo } = view;
  let markdown = `# Search Results for "${query}"\n\n`;
  markdown += `Found ${pagination.totalItems} result(s) | **Page ${pagination.page} of ${pagination.totalPages}** | ${tokenInfo.tokenCount.toLocaleString()} tokens`;
  markdown += formatFiltersLine(filters);
  markdown += '\n\n---\n\n';

  for (const result of results) {
    markdown += formatSearchResult(result);
  }

  markdown += formatPaginationFooter(view);
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
 *
 * "No results found" is listed as a note, not an error, because it never was
 * one: `isError` was always unset. Until 2026-09-28 it was also the reply to a
 * search that failed, so a client concluded the documentation had nothing on a
 * query that was never checked; a failed search is now the error above it, as
 * the glossary's failed read is (#324). `suggestions` joined the JSON shape
 * the same day, when a no-results reply's JSON text became JSON.
 *
 * Also until 2026-09-28, a page was `limit` results cut to `maxTokens`
 * afterwards, and the results the cut dropped were on no page (see
 * `paginateSearchResults`). The Note on paging and `truncatedResult` in the
 * JSON shape describe the pages that replaced them. That Note sends the reader
 * to `paginationNote`, which the JSON shape did not list, so the notes a JSON
 * reply can carry were listed the same day; each was already sent.
 *
 * `query` took 2-200 characters until 2026-09-28. One Chinese, Japanese or
 * Korean character is now enough, since one Han character can be a word (see
 * SearchInputSchema); the bullet says so, as the schema's description does.
 * The same day, `localeNote` began to be set in en-US too, for a query with
 * words in a script the documentation searched is not written in (see
 * `noResultsLocaleNote`), and its comment says so. Thai is such a script
 * since 2026-09-28 as well, when a Thai query began to be sent to th-TH, and
 * the comment names it.
 */
export const TOOL_DESCRIPTION = `Search Jamf documentation for articles matching your query.

This tool searches across all Jamf product documentation including Jamf Pro,
Jamf School, Jamf Connect, Jamf Protect, Jamf Now, Jamf Safe Internet, and more.
Results include article titles, snippets, and direct links.

Args:
  - query (string, required): Search keywords (2-200 characters, or one Chinese, Japanese or Korean character)
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
    // Set when a filter matched nothing and was removed, or could not be applied.
    "filterRelaxation"?: { "removed": [string], "original": { "<filter>": string }, "message": string },
    // Set when a result is at a version other than the one asked for.
    "versionNote"?: string,
    // Set when page was past the last page, and the last is shown instead, or when
    // limit and maxTokens make more pages than page accepts: it then says what
    // reaches the rest.
    "paginationNote"?: string,
    // How "results" are ordered, and by whom. Absent when "results" is empty.
    "relevanceNote"?: string,
    // Pages outside the product documentation, matched on title and ranked
    // separately from "results", which carry no score to rank them against.
    // Omitted when none matched.
    "otherSources"?: [{ "title": string, "url": string, "source": string }],
    // Queries to try instead, when "results" is empty.
    "suggestions"?: [string],
    // When "results" is empty and language is not ${DEFAULT_LOCALE}, as not all documentation is
    // in it, or the query has Chinese, Japanese, Korean or Thai words and the documentation in
    // language is not written in them: which documentation to search instead, and how.
    "localeNote"?: string,
    // Only on a page that is one result cut to fit; see the Note on paging.
    "truncatedResult"?: { "title": string, "estimatedTokens": number }
  }

  For Markdown format:
  A formatted list of search results with pagination and token info.

Examples (common query → recommended filters):
${EXAMPLES_BLOCK}

Errors:
  - "Search for "<query>" failed: ..." (isError) if the search could not be completed:
    learn.jamf.com could not be reached, timed out or answered with an error, or a configured
    search backend failed. This is not a "no results": the search did not complete, so the reply
    cannot say whether anything matches. The message says whether trying again may help. Pages
    outside the product documentation that did match follow it, in a second text block.
  - "Invalid option: expected one of ..." (an input validation error) if product, topic, docType or language is not one of the values the input schema lists

Note: "No results found" is not an error. It means the search ran and nothing in the product
documentation matched; in JSON that is "total": 0, with "suggestions" and any "otherSources".

Note: Results are ranked by relevance. Use filters and pagination to navigate large result sets.
A page holds up to limit results, as many as fit maxTokens, and the next page starts at the
first that did not fit. Every result is on exactly one page, but which page depends on limit
and maxTokens, so keep both the same while paging; the markdown footer names them beside the
next page when they are not the default, and structuredContent carries limit and maxTokens.
A result larger than maxTokens on its own is alone on its page with its snippet cut to fit;
only that page has tokenInfo.truncated, and truncatedResult.estimatedTokens is what the whole
result costs. If limit and maxTokens make more pages than page accepts (${PAGINATION_CONFIG.MAX_PAGE}), page ${PAGINATION_CONFIG.MAX_PAGE}
offers no next page and paginationNote says what reaches the rest.
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
 * What the other-source block says under its matches, by what the product
 * documentation search came to. The block is the same in all three replies;
 * only this line differs, because only it speaks of the results above it.
 */
const OTHER_SOURCES_CAVEAT = {
  ranked: '*Matched on title, ranked separately from the results above, '
    + 'which carry no score to rank them against.*',
  noResults: '*Matched on title. The product documentation had no results for this query.*',
  failed: '*Matched on title. These sources were searched on their own; the product '
    + 'documentation could not be searched (see above).*',
} as const;

/** The other-source hits under a heading, grouped by source, and `caveat`. */
function otherSourcesBlock(hits: StaticSearchHit[], caveat: string): string {
  const bySource = new Map<string, StaticSearchHit[]>();
  for (const hit of hits) {
    bySource.set(hit.source, [...(bySource.get(hit.source) ?? []), hit]);
  }

  let out = '## Also found outside the product documentation\n\n';
  for (const [source, sourceHits] of bySource) {
    out += `**${source}**\n\n`;
    for (const hit of sourceHits) {
      out += `- [${sanitizeMarkdownText(hit.title)}](${sanitizeMarkdownUrl(hit.url)})\n`;
    }
    out += '\n';
  }
  return `${out}${caveat}\n`;
}

/**
 * Render the other-source hits as a labelled trailer.
 *
 * Below the results and clearly separated, because these come from a
 * different ranking that shares no scale with the one above — and because
 * two of the three sources are not product documentation.
 */
function renderOtherSources(hits: StaticSearchHit[], caveat: string = OTHER_SOURCES_CAVEAT.ranked): string {
  return hits.length === 0 ? '' : `\n---\n\n${otherSourcesBlock(hits, caveat)}`;
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
 * `rankedBy` unset only on a failed search, which gets the error reply before
 * any note is built, so that default is for a result built without the field,
 * not a path the service reaches. A search with no results gets no note
 * either: it would describe the order of nothing.
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
 * One result as the structured channel publishes it.
 *
 * A field the result does not have is left out, not filled in with an empty
 * value, so "the backend did not say" stays distinct from any value it could
 * have said: no `mapTitle: ''`, no `crossFiled: false`. A `publish` field the
 * result does have is sent as it is. It is of the type `SearchOutputSchema`
 * declares: `buildSearchResult` builds a Fluid Topics result that way, taking
 * `mapTitle` only when it is a string, and a SearchProvider's results are read
 * against the same schema before the service does anything with them
 * (`readSearchProviderResults`), which reads a mistyped field as absent.
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
    maxTokens?: number | undefined;
    filterRelaxation?: { removed: string[]; original: Record<string, string>; message: string } | undefined;
    truncatedResult?: SearchTruncatedResult | undefined;
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
    // The budget this page was cut to. The next page follows this one only
    // when it is asked for with the same `limit` and `maxTokens`.
    ...(extras?.maxTokens !== undefined ? { maxTokens: extras.maxTokens } : {}),
    hasMore: pagination.hasNext,
    results: results.map(toStructuredResult),
    ...(extras?.filterRelaxation !== undefined ? { filterRelaxation: extras.filterRelaxation } : {}),
    ...(extras?.versionNote !== undefined ? { versionNote: extras.versionNote } : {}),
    ...(extras?.paginationNote !== undefined ? { paginationNote: extras.paginationNote } : {}),
    ...(extras?.truncatedResult !== undefined ? { truncatedResult: extras.truncatedResult } : {}),
    ...otherSourcesField(extras?.otherSources),
  };
}

/**
 * The reply to a search that ran and found nothing, in the format asked for.
 *
 * Until 2026-09-28 this was the markdown page below whatever the format, so a
 * `responseFormat: "json"` caller's `JSON.parse` threw on it (live on 6.0.12,
 * "xqzvbnmplk"), as the glossary's did until #346. It also dropped, on every
 * channel, what the other sources had matched and a product filter that could
 * not be applied. For a query the product documentation has nothing on, the
 * other sources can be all that matched: live, Fluid Topics had no result for
 * "jamformer", the title of a concepts.jamf.com page, and the reply did not
 * mention the page. Now the JSON text is the body the description documents,
 * with `total: 0`, and all three channels carry both.
 *
 * Not carried: `relevanceNote`, which would describe the order of nothing;
 * `paginationNote`, which with no results can only say that a page past the
 * end was clamped to "the last page" of none, as it always was;
 * `versionNote`, which the service sets only when a result is at another
 * version than the one asked for, so never with no results; and
 * `structuredContent.maxTokens`, which is there to ask for the next page with,
 * and there is none.
 */
function buildNoResultsResponse(
  params: SearchInput,
  found: Pick<SearchDocumentationResult, 'pagination' | 'tokenInfo' | 'filterRelaxation' | 'rankedBy'>,
  otherSources: StaticSearchHit[],
): ToolResult {
  const { query } = params;
  // Which backend found nothing says which queries can find something: Fluid
  // Topics matches a page on any one word of a query (see
  // generateSearchSuggestions). "current" is no version filter (see
  // buildSearchFilters).
  const suggestions = generateSearchSuggestions(
    query, params.product !== undefined, params.topic !== undefined, params.language,
    { searchedBy: found.rankedBy, hasVersionFilter: params.version !== undefined && params.version !== 'current' },
  );

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

  const { pagination, tokenInfo, filterRelaxation } = found;
  const structuredContent = {
    ...buildSearchStructuredContent(query, [], pagination, {
      filters: activeSearchFilters(params),
      limit: params.limit,
      filterRelaxation,
      otherSources,
    }),
    suggestions: suggestionTexts,
  };

  // The locale caveat is advice, so it rides the text channel with the rest of
  // the advice rather than being mixed into the runnable list above.
  const localeNote = noResultsLocaleNote(query, params.language);

  if (params.responseFormat === ResponseFormat.JSON) {
    // The JSON body of a search with results, with no results in it, the
    // runnable suggestions structuredContent carries, and the locale caveat:
    // until 2026-09-28 this reply was the markdown, which ends with it, and it
    // names another search to run. The rest of the prose advice stays in the
    // markdown, as the glossary's no-match tip does (#346).
    const body = {
      total: pagination.totalItems,
      query,
      results: [],
      filters: buildFilterSummary(params),
      tokenInfo,
      pagination,
      ...(filterRelaxation !== undefined ? { filterRelaxation } : {}),
      ...otherSourcesField(otherSources),
      suggestions: suggestionTexts,
      ...(localeNote !== undefined ? { localeNote } : {}),
    };
    return {
      content: [{ type: 'text', text: JSON.stringify(body, null, 2) }],
      structuredContent,
    };
  }

  const markdown = appendMarkdownNotices(
    `${formatSearchSuggestions(query, suggestions)}${localeNote !== undefined ? `\n\n${localeNote}` : ''}`,
    { filterRelaxation },
  ) + renderOtherSources(otherSources, OTHER_SOURCES_CAVEAT.noResults);

  return {
    content: [{ type: 'text', text: markdown }],
    structuredContent,
  };
}

/**
 * The locale caveat on a search with no results: which documentation to
 * search instead, or undefined when there is nothing to say.
 *
 * - A query with Chinese, Japanese, Korean or Thai words, in a language whose
 *   documentation is not written as they are (see `foreignWritingOf`), is
 *   told so, and sent to the English terms and to the languages whose
 *   documentation is written as they are. That includes en-US, the default:
 *   its documentation is in English. Until 2026-09-28 such a query had no
 *   note in en-US, and nothing said that its words were not in the
 *   documentation searched: live that day, 推送 證書 續約 ("push certificate
 *   renewal") had no results in en-US and 50 in zh-TW. Such a query is
 *   suggested its Latin words only there (see `generateSearchSuggestions`).
 *   Thai was not such a script until 2026-09-28: live that day, ใบรับรอง
 *   ("certificate") had no results and no note in en-US, and in de-DE was
 *   sent to the English terms alone.
 * - Otherwise, in a language other than en-US: not all documentation is in
 *   it, and the en-US documentation may have what it does not. A query with
 *   a letter of a script other than Latin is told to search that for the
 *   English terms, as its own words are not in English.
 */
function noResultsLocaleNote(query: string, language: string | undefined): string | undefined {
  const searched = language ?? DEFAULT_LOCALE;
  const writing = foreignWritingOf(query, searched);
  if (writing !== undefined) {
    return elsewhereNote(writing, searched, language === undefined);
  }
  if (searched === DEFAULT_LOCALE) { return undefined; }
  const unavailable = `Not all documentation is available in "${searched}".`;
  return NON_LATIN_LETTER.test(query)
    ? `${unavailable} The ${DEFAULT_LOCALE} documentation is in English: to search it, ` +
      `use the English terms, with language: "${DEFAULT_LOCALE}".`
    : `${unavailable} Try searching with language: "${DEFAULT_LOCALE}".`;
}

/**
 * The note for a query with words in `writing`, searched in `language`, whose
 * documentation is not written that way: the English terms, which en-US has,
 * and the languages whose documentation is written as the query is.
 */
function elsewhereNote(writing: Writing, language: string, byDefault: boolean): string {
  const has = `This query has words in ${writing.name}, and the documentation in "${language}"`;
  const english = language === DEFAULT_LOCALE
    ? `${has}${byDefault ? ' (the default language)' : ''} is in English, so it does not have them. ` +
      'Search it with the English terms.'
    : `${has} is not in ${writing.name}, so it does not have them. The ${DEFAULT_LOCALE} documentation is ` +
      `in English: to search it, use the English terms, with language: "${DEFAULT_LOCALE}".`;
  const elsewhere = writing.locales.length > 0
    ? `Or search with language: ${orList(writing.locales.map(locale => `"${locale}"`))}, ` +
      `where the documentation is in ${writing.name}.`
    : `Jamf publishes no documentation in ${writing.name}.`;
  return `${english} ${elsewhere}`;
}

/** `a`, `a or b`, `a, b or c`. */
function orList(items: readonly string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} or ${items.slice(-1).join('')}`;
}

/**
 * The reply to a search that could not be completed: the service's message,
 * as an error, in every format.
 *
 * No structuredContent, as no error this server returns has any: a client
 * does not check an error's structuredContent against the outputSchema, and
 * the MCP App would draw it as a search that ran.
 *
 * What the other sources matched is kept, in a second text block. They are
 * other sites, searched by requests of their own that did not fail, and a
 * failure elsewhere is no reason to discard them. They are not an answer to
 * the search, though, which is why the reply stays an error: the product
 * documentation was not searched. The glossary draws the same line (#324): it
 * answers from what it fetched only when that answers the question. The first
 * block is the error alone, and it is the block a client that shows one
 * message reads, the MCP App included.
 */
function buildSearchFailedResponse(message: string, otherSources: StaticSearchHit[]): ToolResult {
  return {
    isError: true,
    content: [
      { type: 'text', text: message },
      ...(otherSources.length > 0
        ? [{ type: 'text' as const, text: otherSourcesBlock(otherSources, OTHER_SOURCES_CAVEAT.failed) }]
        : []),
    ],
  };
}

/**
 * Append filter/version/pagination notices to markdown output.
 *
 * Until 2026-09-28 this also printed "N additional result(s) omitted due to
 * token limit." from `truncatedContent`, for results the budget left off a
 * page, which were on no page at all. Pages are now cut to `maxTokens` as they
 * are walked (see `paginateSearchResults`), the service no longer sets
 * `truncatedContent`, and the one cut left is named under the page's footer
 * (see truncationLine).
 */
function appendMarkdownNotices(
  markdown: string,
  notices: {
    filterRelaxation?: { message: string } | undefined;
    versionNote?: string | undefined;
    paginationNote?: string | undefined;
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
  return result;
}

/**
 * The JSON text's body for a search with results: the page as the service cut
 * it, with every note it carries. Not `truncatedContent`, which the service
 * has not set since 2026-09-28 (see `SearchDocumentationResult`).
 */
function buildJsonBody(query: string, filters: SearchFilters, found: SearchDocumentationResult): SearchResponse {
  const { results, pagination, tokenInfo, filterRelaxation, versionNote, paginationNote, truncatedResult } = found;
  return {
    total: pagination.totalItems,
    query,
    results,
    filters,
    tokenInfo,
    pagination,
    ...(filterRelaxation !== undefined ? { filterRelaxation } : {}),
    ...(versionNote !== undefined ? { versionNote } : {}),
    ...(paginationNote !== undefined ? { paginationNote } : {}),
    ...(truncatedResult !== undefined ? { truncatedResult } : {}),
  };
}

/**
 * One page as the markdown renderers show it.
 *
 * `offset` is absent only from a result `searchDocumentation` did not build;
 * such a result's pages are then taken to be `pageSize` long, as all pages
 * were until 2026-09-28.
 */
function pageView(query: string, filters: SearchFilters, found: SearchDocumentationResult): SearchPageView {
  const { results, pagination, tokenInfo, truncatedResult } = found;
  return {
    query,
    results,
    filters,
    pagination,
    tokenInfo,
    offset: found.offset ?? (pagination.page - 1) * pagination.pageSize,
    truncatedResult,
  };
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

        // A search that could not be completed is an error, in every format,
        // and never "No results found": its empty `results` say nothing about
        // what matches. See buildSearchFailedResponse.
        if (searchResult.searchErrorMessage !== undefined) {
          await reportProgress(extra, { progress: 3, total: 3 });
          return buildSearchFailedResponse(searchResult.searchErrorMessage, otherSources);
        }

        const {
          results, pagination, tokenInfo, filterRelaxation, versionNote,
          paginationNote, truncatedResult, rankedBy
        } = searchResult;

        // Build response
        const filters = buildFilterSummary(params);
        const response = buildJsonBody(params.query, filters, searchResult);

        await reportProgress(extra, { progress: 2, total: 3, message: 'Formatting output...' });

        // The search ran, and the product documentation had nothing.
        if (results.length === 0 && pagination.totalItems === 0) {
          await reportProgress(extra, { progress: 3, total: 3 });
          return buildNoResultsResponse(params, searchResult, otherSources);
        }

        const structuredContent = buildSearchStructuredContent(
          params.query, results, pagination,
          {
            filters: activeSearchFilters(params),
            limit: params.limit,
            maxTokens: tokenInfo.maxTokens,
            filterRelaxation,
            versionNote,
            paginationNote,
            truncatedResult,
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
          formatFn(pageView(params.query, filters, searchResult)),
          { filterRelaxation, versionNote, paginationNote }
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
            text: `Search error: ${failureReason(error)}\n\nPlease try again or use different search terms.`
          }]
        };
      }
    }
  );
}
