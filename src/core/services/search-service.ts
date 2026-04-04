/**
 * Search service — Fluid Topics powered search
 */

import type {
  SearchResult,
  SearchParams,
  SearchDocumentationResult,
  FtSearchEntry,
  FtSearchFilter,
  FtClusteredSearchResponse,
  FtMetadataEntry,
  FilterRelaxation,
  TruncatedContentInfo,
} from '../types.js';
import type { DocTypeId, TopicId } from '../constants.js';
import {
  JAMF_PRODUCTS,
  JAMF_TOPICS,
  DOC_TYPE_CONTENT_TYPE_MAP,
  DOC_TYPE_LABEL_MAP,
  CONTENT_LIMITS,
  TOKEN_CONFIG,
  PAGINATION_CONFIG,
  DEFAULT_LOCALE,
} from '../constants.js';
import type { ServerContext } from '../types/context.js';
import type { Logger } from './interfaces/index.js';
import { search as ftSearch } from './ft-client.js';
import { buildDisplayUrl } from './topic-resolver.js';
import { cleanSnippet } from './content-parser.js';
import type { ProductId } from '../constants.js';
import { getMetaValues, FT_META } from '../utils/ft-metadata.js';
import {
  estimateTokens,
  calculatePagination,
  truncateItemsToTokenLimit,
} from './tokenizer.js';

// ─── Types ─────────────────────────────────────────────────────

// Re-export for consumers that import from this module
export type { SearchDocumentationResult } from '../types.js';

type FilterName = 'product' | 'topic' | 'docType';

interface ActiveFilter {
  name: FilterName;
  value: string;
  apply: (results: SearchResultWithMeta[]) => SearchResultWithMeta[];
}

interface SearchResultWithMeta {
  result: SearchResult;
  bundleSlug: string | null;
  matchedTopics: TopicId[];
  labelKeys: string[];
}

// ─── Helpers ───────────────────────────────────────────────────

/** Pre-computed lowercase keywords per topic */
const TOPIC_KEYWORDS_LOWER: Record<TopicId, string[]> = Object.fromEntries(
  (Object.keys(JAMF_TOPICS) as TopicId[]).map(id => [
    id,
    JAMF_TOPICS[id].keywords.map(k => k.toLowerCase()),
  ])
) as Record<TopicId, string[]>;

const ALL_TOPIC_IDS = Object.keys(JAMF_TOPICS) as TopicId[];

function matchTopics(title: string, snippet: string): TopicId[] {
  const searchText = `${title} ${snippet}`.toLowerCase();
  return ALL_TOPIC_IDS.filter(
    topicId => TOPIC_KEYWORDS_LOWER[topicId].some(kw => searchText.includes(kw))
  );
}

/** Pre-computed reverse lookup: product display name → ProductId */
const PRODUCT_NAME_TO_ID: Record<string, ProductId> = Object.fromEntries(
  (Object.keys(JAMF_PRODUCTS) as ProductId[]).map(id => [JAMF_PRODUCTS[id].name, id])
) as Record<string, ProductId>;

/**
 * Resolve a product display name (e.g. 'Jamf Pro') to its ProductId
 * (e.g. 'jamf-pro'). Returns null when the name is unknown.
 */
function productNameToId(name: string | null): ProductId | null {
  if (name === null) { return null; }
  return PRODUCT_NAME_TO_ID[name] ?? null;
}

/**
 * Extract product ID (e.g. 'jamf-pro') from a legacy metadata value
 * like 'product-pro'. Falls back to scanning known searchLabel values.
 */
function extractProductFromZoominMeta(metadata: FtMetadataEntry[]): string | null {
  const values = getMetaValues(metadata, FT_META.ZOOMIN_METADATA);
  for (const val of values) {
    // Match against known searchLabels in JAMF_PRODUCTS
    const matched = Object.entries(JAMF_PRODUCTS).find(
      ([, product]) => product.searchLabel === val
    );
    if (matched !== undefined) {
      return matched[1].name;
    }
  }
  return null;
}

/**
 * Derive docType from FT metadata `jamf:contentType`.
 * Falls back to 'documentation'.
 *
 * Note: The FT API uses 'Technical Documentation' for multiple doc types
 * (documentation, training, solution-guide, getting-started). Because
 * DOC_TYPE_CONTENT_TYPE_MAP is iterated in insertion order, this reverse
 * lookup always returns 'documentation' for any of those types. This is
 * a known FT API limitation — there is no metadata to distinguish them.
 */
function docTypeFromFtMetadata(metadata: FtMetadataEntry[]): DocTypeId {
  const values = getMetaValues(metadata, FT_META.CONTENT_TYPE);
  if (values.length > 0) {
    // Reverse-lookup DOC_TYPE_CONTENT_TYPE_MAP
    for (const [docType, contentType] of Object.entries(DOC_TYPE_CONTENT_TYPE_MAP)) {
      if (values.includes(contentType)) {
        return docType as DocTypeId;
      }
    }
  }
  return 'documentation';
}

// ─── Filter Construction ───────────────────────────────────────

/**
 * Build Fluid Topics search filters from search params.
 *
 * - product → `zoominmetadata` filter using searchLabel
 * - docType → `jamf:contentType` filter using DOC_TYPE_CONTENT_TYPE_MAP
 * - version → `version` filter
 * - auto-adds `latestVersion=yes` when no version specified
 */
export function buildSearchFilters(
  params: Pick<SearchParams, 'product' | 'docType' | 'version'>
): FtSearchFilter[] {
  const filters: FtSearchFilter[] = [];

  // Product filter
  if (params.product !== undefined) {
    const productDef = JAMF_PRODUCTS[params.product];
    filters.push({
      key: FT_META.ZOOMIN_METADATA,
      values: [productDef.searchLabel],
    });
  }

  // Document type filter
  if (params.docType !== undefined) {
    const contentType = DOC_TYPE_CONTENT_TYPE_MAP[params.docType];
    if (contentType !== undefined) {
      filters.push({
        key: FT_META.CONTENT_TYPE,
        values: [contentType],
      });
    }
  }

  // Version handling
  if (params.version !== undefined && params.version !== '' && params.version !== 'current') {
    filters.push({
      key: FT_META.VERSION,
      values: [params.version],
    });
  } else {
    // Auto-add latestVersion filter when no specific version requested
    filters.push({
      key: FT_META.LATEST_VERSION,
      values: ['yes'],
    });
  }

  return filters;
}

// ─── Result Transformation ─────────────────────────────────────

/**
 * Transform a Fluid Topics search entry into an enriched SearchResult.
 */
export function transformFtSearchResult(
  entry: FtSearchEntry,
): SearchResult {
  if (entry.type === 'TOPIC' && entry.topic !== undefined) {
    return transformTopicEntry(entry);
  }

  if (entry.type === 'MAP' && entry.map !== undefined) {
    return transformMapEntry(entry);
  }

  // Fallback for unexpected entry shapes
  return {
    title: 'Untitled',
    url: '',
    snippet: '',
    product: null,
  };
}

/** Common fields extracted from either a TOPIC or MAP entry */
interface EntryFields {
  title: string;
  url: string;
  htmlExcerpt: string;
  metadata: FtMetadataEntry[];
  mapId: string;
  contentId?: string;
  breadcrumb?: string[];
  mapTitle?: string;
}

/**
 * Shared builder: turns the common fields of a TOPIC or MAP entry
 * into a fully-populated SearchResult.
 */
function buildSearchResult(fields: EntryFields): SearchResult {
  const { metadata } = fields;
  const title = fields.title !== '' ? fields.title : 'Untitled';
  const product = extractProductFromZoominMeta(metadata);
  const snippet = cleanSnippet(fields.htmlExcerpt, title, product);
  const versionValues = getMetaValues(metadata, FT_META.VERSION);
  const docType = docTypeFromFtMetadata(metadata);

  const result: SearchResult = {
    title,
    url: fields.url,
    snippet,
    product,
    docType,
    mapId: fields.mapId,
  };

  if (fields.contentId !== undefined) {
    result.contentId = fields.contentId;
  }

  const firstVersion = versionValues[0];
  if (firstVersion !== undefined) {
    result.version = firstVersion;
  }
  if (fields.breadcrumb !== undefined && fields.breadcrumb.length > 0) {
    result.breadcrumb = fields.breadcrumb;
  }
  if (fields.mapTitle !== undefined && fields.mapTitle !== '') {
    result.mapTitle = fields.mapTitle;
  }

  return result;
}

function resolveTopicUrl(topic: NonNullable<FtSearchEntry['topic']>): string {
  const prettyUrls = getMetaValues(topic.metadata, FT_META.PRETTY_URL);
  const rawPrettyUrl = prettyUrls[0];
  if (rawPrettyUrl !== undefined) {
    const normalizedPath = rawPrettyUrl.startsWith('/')
      ? rawPrettyUrl
      : `/r/${rawPrettyUrl}`;
    return buildDisplayUrl(normalizedPath);
  }
  return buildDisplayUrl(`/r/en-US/${topic.mapId}/${topic.contentId}`);
}

function resolveMapUrl(map: NonNullable<FtSearchEntry['map']>): string {
  if (map.readerUrl !== '') { return buildDisplayUrl(map.readerUrl); }
  if (map.mapUrl !== '') { return buildDisplayUrl(map.mapUrl); }
  return '';
}

function transformTopicEntry(entry: FtSearchEntry): SearchResult {
  const { topic } = entry;
  if (topic === undefined) {
    return { title: 'Untitled', url: '', snippet: '', product: null };
  }

  return buildSearchResult({
    title: topic.title,
    url: resolveTopicUrl(topic),
    htmlExcerpt: topic.htmlExcerpt,
    metadata: topic.metadata,
    mapId: topic.mapId,
    contentId: topic.contentId,
    breadcrumb: topic.breadcrumb,
    mapTitle: topic.mapTitle,
  });
}

function transformMapEntry(entry: FtSearchEntry): SearchResult {
  const { map } = entry;
  if (map === undefined) {
    return { title: 'Untitled', url: '', snippet: '', product: null };
  }

  return buildSearchResult({
    title: map.title,
    url: resolveMapUrl(map),
    htmlExcerpt: map.htmlExcerpt,
    metadata: map.metadata,
    mapId: map.mapId,
    mapTitle: map.title,
  });
}

// ─── Filter Relaxation ─────────────────────────────────────────

/**
 * Build active filters from search params for progressive relaxation.
 * These are client-side post-filters for topic matching (which FT
 * doesn't support server-side).
 */
function buildActiveFilters(params: SearchParams): ActiveFilter[] {
  const activeFilters: ActiveFilter[] = [];

  if (params.product !== undefined) {
    const productId = params.product;
    activeFilters.push({
      name: 'product',
      value: productId,
      apply: (results) => results.filter(r => r.bundleSlug === productId),
    });
  }

  if (params.topic !== undefined) {
    const topicFilter = params.topic;
    activeFilters.push({
      name: 'topic',
      value: topicFilter,
      apply: (results) => results.filter(r => r.matchedTopics.includes(topicFilter)),
    });
  }

  if (params.docType !== undefined) {
    const docTypeFilter = params.docType;
    const targetLabelKey = DOC_TYPE_LABEL_MAP[docTypeFilter] as string | undefined;
    if (targetLabelKey !== undefined) {
      activeFilters.push({
        name: 'docType',
        value: docTypeFilter,
        apply: (results) => results.filter(r => {
          if (r.labelKeys.length === 0) { return true; }
          return r.labelKeys.includes(targetLabelKey);
        }),
      });
    }
  }

  return activeFilters;
}

/**
 * Apply filters with progressive relaxation when results are zero.
 * Relaxation order: docType -> topic -> product
 */
function applyFiltersWithFallback(
  allResults: SearchResultWithMeta[],
  activeFilters: ActiveFilter[]
): { filtered: SearchResultWithMeta[]; relaxation?: FilterRelaxation } {
  let filtered = allResults;
  for (const filter of activeFilters) {
    filtered = filter.apply(filtered);
  }

  if (filtered.length > 0 || activeFilters.length === 0) {
    return { filtered };
  }

  // Progressive relaxation
  const relaxOrder: FilterName[] = ['docType', 'topic', 'product'];
  const removed: string[] = [];
  const original: Record<string, string> = {};

  for (const filterName of relaxOrder) {
    if (filtered.length > 0) { break; }

    const filterIndex = activeFilters.findIndex(f => f.name === filterName);
    if (filterIndex === -1) { continue; }

    const removedFilter = activeFilters[filterIndex];
    if (removedFilter === undefined) { continue; }
    removed.push(removedFilter.name);
    original[removedFilter.name] = removedFilter.value;
    activeFilters.splice(filterIndex, 1);

    // Re-apply remaining filters
    filtered = allResults;
    for (const filter of activeFilters) {
      filtered = filter.apply(filtered);
    }
  }

  if (removed.length > 0) {
    return {
      filtered,
      relaxation: {
        removed,
        original,
        message: `No results with all filters applied. Removed filter(s): ${removed.join(', ')}. Try broader search terms or fewer filters.`,
      },
    };
  }

  return { filtered };
}

// ─── Token Truncation ──────────────────────────────────────────

function resultToString(r: SearchResult): string {
  return `${r.title}\n${r.snippet}\n${r.url}`;
}

function truncateSearchResults(
  paginatedResults: SearchResult[],
  maxTokens: number
): {
  finalResults: SearchResult[];
  finalTokenCount: number;
  truncated: boolean;
  truncatedContent?: TruncatedContentInfo;
} {
  const { items, tokenInfo } = truncateItemsToTokenLimit(
    paginatedResults,
    maxTokens,
    resultToString,
    1,
    paginatedResults.length,
  );

  if (!tokenInfo.truncated) {
    return {
      finalResults: items,
      finalTokenCount: tokenInfo.tokenCount,
      truncated: false,
    };
  }

  const omittedResults = paginatedResults.slice(items.length);
  const truncatedContent: TruncatedContentInfo = {
    omittedCount: omittedResults.length,
    omittedItems: omittedResults.map(r => ({
      title: r.title,
      estimatedTokens: estimateTokens(resultToString(r)),
    })),
  };

  return {
    finalResults: items,
    finalTokenCount: tokenInfo.tokenCount,
    truncated: true,
    truncatedContent,
  };
}

// ─── Convert flat SearchResult to SearchResultWithMeta ─────────

function toSearchResultWithMeta(
  result: SearchResult,
  needsTopicMatching: boolean,
): SearchResultWithMeta {
  // Derive bundleSlug from the product display name (extracted from
  // zoominmetadata). Do NOT use result.mapId — FT API mapIds are
  // opaque hashes (e.g. 'uRhiWJWbjHyL1vegaHmj8g'), not readable
  // bundle stems.
  const bundleSlug = productNameToId(result.product);

  const labelKeys: string[] = result.docType !== undefined
    ? [DOC_TYPE_LABEL_MAP[result.docType]]
    : [];

  return {
    result,
    bundleSlug,
    matchedTopics: needsTopicMatching
      ? matchTopics(result.title, result.snippet)
      : [],
    labelKeys,
  };
}

// ─── Main Search Function ──────────────────────────────────────

/**
 * Search Jamf documentation using the Fluid Topics clustered-search API.
 *
 * 1. Checks SearchProvider first (custom backend injection).
 * 2. Calls ft-client.search() with constructed filters.
 * 3. Transforms results and applies post-processing pipeline:
 *    - Client-side topic/docType filtering with progressive relaxation
 *    - Pagination
 *    - Token truncation
 */
export async function searchDocumentation(
  ctx: ServerContext,
  params: SearchParams
): Promise<SearchDocumentationResult> {
  const log = ctx.logger.createLogger('search-service');
  const page = params.page ?? PAGINATION_CONFIG.DEFAULT_PAGE;
  const pageSize = params.limit ?? CONTENT_LIMITS.DEFAULT_SEARCH_RESULTS;
  const maxTokens = params.maxTokens ?? TOKEN_CONFIG.DEFAULT_MAX_TOKENS;

  let allResults: SearchResultWithMeta[];
  let searchError: string | undefined;

  try {
    allResults = await resolveSearchResults(ctx, params, log);
  } catch (error) {
    const message = String(error);
    log.error(`Search error: ${message}`);
    allResults = [];
    searchError = message;
  }

  // Build and apply filters with progressive relaxation
  const activeFilters = buildActiveFilters(params);
  const { filtered: filteredResults, relaxation: filterRelaxation } =
    applyFiltersWithFallback(allResults, activeFilters);

  // Calculate pagination
  const paginationInfo = calculatePagination(filteredResults.length, page, pageSize);

  // Get paginated results
  const paginatedResults = filteredResults
    .slice(paginationInfo.startIndex, paginationInfo.endIndex)
    .map(r => r.result);

  // Truncate results to fit within token budget
  const { finalResults, finalTokenCount, truncated, truncatedContent } =
    truncateSearchResults(paginatedResults, maxTokens);

  return {
    results: finalResults,
    pagination: {
      page: paginationInfo.page,
      pageSize: paginationInfo.pageSize,
      totalPages: paginationInfo.totalPages,
      totalItems: filteredResults.length,
      hasNext: paginationInfo.hasNext,
      hasPrev: paginationInfo.hasPrev,
    },
    tokenInfo: {
      tokenCount: finalTokenCount,
      truncated,
      maxTokens,
    },
    ...(filterRelaxation !== undefined ? { filterRelaxation } : {}),
    ...(truncatedContent !== undefined ? { truncatedContent } : {}),
    ...(searchError !== undefined ? { searchError } : {}),
  };
}

// ─── Internal: Resolve results from provider or FT API ─────────

/**
 * Build a deterministic cache key for FT search results.
 *
 * Derived from query + filters + locale (NOT page/limit, since
 * pagination is applied client-side after caching).
 */
function buildSearchCacheKey(
  query: string,
  filters: FtSearchFilter[],
  locale: string
): string {
  const sortedFilters = [...filters]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map(f => `${f.key}=${f.values.sort().join(',')}`)
    .join('|');
  return `ft-search:${locale}:${query}:${sortedFilters}`;
}

async function resolveSearchResults(
  ctx: ServerContext,
  params: SearchParams,
  log: Logger
): Promise<SearchResultWithMeta[]> {
  const needsTopicMatching = params.topic !== undefined;

  // 1. Try SearchProvider first (custom backend injection — no caching)
  if (ctx.searchProvider !== undefined) {
    const provided = await ctx.searchProvider.search(params);
    if (provided !== null) {
      return provided.map(r => toSearchResultWithMeta(r, needsTopicMatching));
    }
  }

  // 2. Build FT search request
  const locale = params.language ?? DEFAULT_LOCALE;
  const filters = buildSearchFilters(params);
  const cacheKey = buildSearchCacheKey(params.query, filters, locale);

  // 3. Check cache before hitting the FT API
  const cached = await ctx.cache.get<SearchResultWithMeta[]>(cacheKey);
  if (cached !== null) {
    log.debug(`Search cache hit: key="${cacheKey}", ${cached.length} results`);
    return cached;
  }

  const perPage = Math.min(
    CONTENT_LIMITS.MAX_SEARCH_RESULTS,
    CONTENT_LIMITS.FILTER_OVERFETCH_CAP
  );

  log.debug(
    `FT search: query="${params.query}", product=${params.product ?? 'all'}, ` +
    `locale=${locale}, filters=${JSON.stringify(filters)}`
  );

  const ftResponse: FtClusteredSearchResponse = await ftSearch({
    query: params.query,
    contentLocale: locale,
    paging: { perPage, page: 1 },
    filters,
  });

  // 4. Flatten clusters and transform entries
  const results: SearchResultWithMeta[] = [];
  for (const cluster of ftResponse.results) {
    for (const entry of cluster.entries) {
      const searchResult = transformFtSearchResult(entry);
      if (searchResult.url !== '') {
        results.push(toSearchResultWithMeta(searchResult, needsTopicMatching));
      }
    }
  }

  // 5. Cache the raw results (before client-side filtering)
  await ctx.cache.set(cacheKey, results, ctx.config.cacheTtl.search);

  log.debug(`FT search returned ${results.length} results (cached)`);
  return results;
}
