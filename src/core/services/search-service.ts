/**
 * Search service — Fluid Topics powered search
 */

import type {
  SearchResult,
  SearchParams,
  SearchDocumentationResult,
  FtSearchEntry,
  FtSearchCluster,
  FtSearchFilter,
  FtSearchRequest,
  FtClusteredSearchResponse,
  FtMetadataEntry,
  FilterRelaxation,
  TruncatedContentInfo,
} from '../types.js';
import type { DocTypeId, TopicId } from '../constants.js';
import {
  JAMF_PRODUCTS,
  JAMF_TOPICS,
  DOC_TYPE_LABEL_MAP,
  DOC_TYPE_PRECEDENCE,
  LABEL_KEY_DOC_TYPE_MAP,
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
import { getMetaValue, getMetaValues, FT_META } from '../utils/ft-metadata.js';
import { compareVersions } from '../utils/bundle.js';
import {
  estimateTokens,
  calculatePagination,
  truncateListByTokens,
  buildPaginationNote,
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
);

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
function extractProductFromZoominMeta(metadata: FtMetadataEntry[] | undefined): string | null {
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

/** The metadata array of whichever payload an FT search entry actually carries. */
function entryMetadata(entry: FtSearchEntry): FtMetadataEntry[] | undefined {
  return entry.type === 'MAP' ? entry.map?.metadata : entry.topic?.metadata;
}

/**
 * Collect every docType label key a topic carries.
 *
 * Fluid Topics ships them under `zoominmetadata` as `content-*` values, whose
 * vocabulary is exactly DOC_TYPES' labelKey set. A topic legitimately carries
 * several — every Jamf Pro release note is tagged both `content-techdocs` and
 * `content-releasenotes` — so all of them are kept and the docType post-filter
 * matches on any one of them.
 *
 * This replaces a reverse lookup through DOC_TYPE_CONTENT_TYPE_MAP, which is
 * many-to-one ('Technical Documentation' covers four docTypes) and was walked
 * in object-literal insertion order: a release note matched `documentation`
 * first, was labelled `content-techdocs`, and was then dropped by its own
 * `docType: 'release-notes'` filter.
 */
function docTypeLabelKeys(metadata: FtMetadataEntry[] | undefined): string[] {
  return getMetaValues(metadata, FT_META.ZOOMIN_METADATA)
    .filter(value => LABEL_KEY_DOC_TYPE_MAP[value] !== undefined);
}

/**
 * Collapse label keys to the single most specific docType.
 *
 * Returns undefined when the topic carries no recognised `content-*` label
 * (Jamf's glossary topics ship with no metadata at all). "Unknown" must stay
 * unknown: reporting `documentation` there is a positive assertion nothing
 * backs, and it makes the docType filter drop the topic from every search
 * except `docType: 'documentation'`.
 */
function docTypeFromLabelKeys(labelKeys: string[]): DocTypeId | undefined {
  return DOC_TYPE_PRECEDENCE.find(
    docType => labelKeys.includes(DOC_TYPE_LABEL_MAP[docType])
  );
}

// ─── Filter Construction ───────────────────────────────────────

/**
 * Build Fluid Topics search filters from search params.
 *
 * - product → `zoominmetadata` filter using searchLabel
 * - docType → `zoominmetadata` filter using DOC_TYPE_LABEL_MAP
 * - version → `version` filter (only when a specific version is requested)
 *
 * Both `zoominmetadata` filters are pushed as *separate* entries. Fluid Topics
 * intersects filter objects and unions the values inside one, measured against
 * the live API on a zh-TW corpus: `product-protect` alone matched 1182 topics
 * and `content-releasenotes` alone 940, two filter objects matched 387 (the
 * intersection) and one object holding both values matched 1735 (the union,
 * exactly 1182 + 940 − 387). Merging them into a single entry would therefore
 * widen a product+docType search instead of narrowing it.
 *
 * NOTE: we intentionally do NOT add `latestVersion=yes` when no version is given.
 * Jamf migrated all non-Pro products (School, Connect, Protect, Now, …) to an
 * unversioned documentation model with no `latestVersion` metadata, so that filter
 * silently dropped every non-Pro product from results (and returned zero results
 * for product-filtered non-Pro searches). Jamf Pro's many version snapshots are
 * instead collapsed client-side via {@link dedupeToLatestVersions}.
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

  // Document type filter.
  //
  // Filters on the `content-*` label rather than `jamf:contentType`, because
  // the latter's *values* are translated per locale while its key is not:
  // `jamf:contentType = 'Release Notes'` matched 1323 topics under en-US and 0
  // under zh-TW, where the same topics carry '版本資訊' (940) — and ja-JP
  // 'リリースノート' (1207), de-DE 'Versionshinweise', and so on for every
  // locale this server supports. Sending the English string therefore returned
  // an empty upstream result for seven of the eight supported locales, and
  // because that emptiness arrives from the API, the client-side relaxation in
  // {@link applyFiltersWithFallback} has nothing left to relax.
  //
  // The `content-*` vocabulary is locale-invariant (`content-releasenotes`:
  // 1323 en-US / 940 zh-TW / 1207 ja-JP / 1207 de-DE) and is already what the
  // docType post-filter matches on, so both ends now agree on one vocabulary.
  if (params.docType !== undefined) {
    // Widened deliberately: DOC_TYPE_LABEL_MAP is total over DocTypeId, so the
    // type says this cannot miss — but params reach here from a JSON-RPC
    // payload, and a docType outside the enum would otherwise push
    // `values: [undefined]` upstream. Same idiom as the docType post-filter.
    const labelKey = DOC_TYPE_LABEL_MAP[params.docType] as string | undefined;
    if (labelKey !== undefined) {
      filters.push({
        key: FT_META.ZOOMIN_METADATA,
        values: [labelKey],
      });
    }
  }

  // Version handling — only filter when a specific version is requested.
  // See the function doc above for why `latestVersion=yes` is no longer auto-added.
  if (params.version !== undefined && params.version !== '' && params.version !== 'current') {
    filters.push({
      key: FT_META.VERSION,
      values: [params.version],
    });
  }

  return filters;
}

/**
 * Collapse Fluid Topics version snapshots to a single result per topic.
 *
 * Jamf Pro documentation publishes a separate search entry for every product
 * version (11.13 … 11.29), all sharing the same `ft:clusterId`. We keep only the
 * highest-versioned entry per cluster so the user sees one (latest) result per
 * topic. Non-versioned products (Jamf School, Connect, Protect, …) carry a single
 * entry per topic and a distinct `ft:clusterId`, so they pass through untouched.
 * Entries with no `ft:clusterId` cannot be version-deduped and are each kept.
 *
 * First-seen (relevance) order is preserved.
 */
export function dedupeToLatestVersions(
  clusters: FtSearchCluster[]
): FtSearchEntry[] {
  const order: string[] = [];
  const best = new Map<string, { entry: FtSearchEntry; version: string }>();
  let anonCount = 0;

  for (const cluster of clusters) {
    for (const entry of cluster.entries) {
      const metadata = entry.topic?.metadata ?? entry.map?.metadata ?? [];
      const clusterId = getMetaValue(metadata, FT_META.CLUSTER_ID);
      const version = getMetaValue(metadata, FT_META.VERSION);
      // Entries without a cluster id can't be version-deduped — keep each.
      const key = clusterId !== '' ? clusterId : `anon-${anonCount++}`;
      const existing = best.get(key);
      if (existing === undefined) {
        order.push(key);
        best.set(key, { entry, version });
      } else if (compareVersions(version, existing.version) > 0) {
        best.set(key, { entry, version });
      }
    }
  }

  return order
    .map(key => best.get(key)?.entry)
    .filter((entry): entry is FtSearchEntry => entry !== undefined);
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
  /** Absent when Fluid Topics sent the entry without one — see FtSearchTopic.title. */
  title?: string | undefined;
  url: string;
  htmlExcerpt: string;
  metadata?: FtMetadataEntry[] | undefined;
  mapId: string;
  contentId?: string;
  breadcrumb?: string[];
  /** A MAP entry reuses its own (optional) title here. Guarded at the use site. */
  mapTitle?: string | undefined;
}

/**
 * Shared builder: turns the common fields of a TOPIC or MAP entry
 * into a fully-populated SearchResult.
 */
function buildSearchResult(fields: EntryFields): SearchResult {
  const { metadata } = fields;
  // Both the absent and the empty case fall back, matching how the article
  // path picks its title (article-service.ts). Testing only `!== ''` let
  // `undefined` through, because `undefined !== ''` is true.
  const title = (fields.title !== undefined && fields.title !== '')
    ? fields.title
    : 'Untitled';
  const product = extractProductFromZoominMeta(metadata);
  const snippet = cleanSnippet(fields.htmlExcerpt, title, product);
  const versionValues = getMetaValues(metadata, FT_META.VERSION);
  const docType = docTypeFromLabelKeys(docTypeLabelKeys(metadata));

  const result: SearchResult = {
    title,
    url: fields.url,
    snippet,
    product,
    mapId: fields.mapId,
    // Omitted rather than set to undefined when the topic carries no
    // `content-*` label — `docType` is declared optional and the config has
    // exactOptionalPropertyTypes on.
    ...(docType !== undefined ? { docType } : {}),
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
  const { items: finalResults, tokenCount: finalTokenCount, truncated } =
    truncateListByTokens(paginatedResults, maxTokens, resultToString);

  if (!truncated) {
    return { finalResults, finalTokenCount, truncated: false };
  }

  const omittedResults = paginatedResults.slice(finalResults.length);
  const truncatedContent: TruncatedContentInfo = {
    omittedCount: omittedResults.length,
    omittedItems: omittedResults.map(r => ({
      title: r.title,
      estimatedTokens: estimateTokens(resultToString(r)),
    })),
  };

  return { finalResults, finalTokenCount, truncated: true, truncatedContent };
}

// ─── Convert flat SearchResult to SearchResultWithMeta ─────────

/**
 * `matchedTopics` is computed unconditionally, not only when the caller asked
 * for a topic filter.
 *
 * It used to be gated on `params.topic !== undefined`, which made the cached
 * value a function of something that is not in — and cannot be in — the FT
 * request the cache is keyed on. A topic-less search wrote entries carrying
 * `matchedTopics: []`, and the next search for the same query WITH a topic hit
 * that entry, found nothing matching, and silently relaxed the topic filter it
 * had never actually run. Same question, different answer depending on cache
 * state; verified against the live path before this change.
 *
 * Computing it always costs 284 substring checks per result on a cache miss —
 * 40 topics' keyword lists, and only on the write path — which is the cheaper
 * half of the trade by a wide margin.
 */
function toSearchResultWithMeta(
  result: SearchResult,
  ftLabelKeys?: string[],
): SearchResultWithMeta {
  // Derive bundleSlug from the product display name (extracted from
  // zoominmetadata). Do NOT use result.mapId — FT API mapIds are
  // opaque hashes (e.g. 'uRhiWJWbjHyL1vegaHmj8g'), not readable
  // bundle stems.
  const bundleSlug = productNameToId(result.product);

  // Prefer the full label set read off FT metadata: a topic carries several
  // and `result.docType` is only the most specific one, so re-deriving from it
  // would narrow a release note back down to release-notes alone. A
  // SearchProvider hands us a flat SearchResult with no metadata to read, so
  // there the single docType is all there is.
  const labelKeys: string[] = ftLabelKeys ?? (
    result.docType !== undefined ? [DOC_TYPE_LABEL_MAP[result.docType]] : []
  );

  return {
    result,
    bundleSlug,
    matchedTopics: matchTopics(result.title, result.snippet),
    labelKeys,
  };
}

// ─── Version Transparency ──────────────────────────────────────

/** A `version` value that asks for a specific snapshot rather than "whatever is current". */
function isSpecificVersion(version: string | undefined): version is string {
  return version !== undefined && version !== '' && version !== 'current';
}

/**
 * Explain a `version` filter that was asked for but demonstrably not applied.
 *
 * On the Fluid Topics path the filter goes upstream ({@link buildSearchFilters}),
 * so the API enforces it. On the SearchProvider path nothing here enforces
 * anything — the provider is handed `params` and its results are taken as
 * given. When such a result set contains an article stamped with a *different*
 * version, the filter provably did not hold, and staying silent means the tool
 * echoes `filters.version` back as though it had: a claim about the result set
 * that is false.
 *
 * Only a positive mismatch counts. Results with no version metadata are the
 * normal shape for the unversioned products (School, Connect, Protect, …) and
 * say nothing either way, so they must not raise the note.
 */
function buildVersionNote(
  requestedVersion: string | undefined,
  fromProvider: boolean,
  results: SearchResultWithMeta[],
): string | undefined {
  if (!fromProvider || !isSpecificVersion(requestedVersion)) {
    return undefined;
  }

  const mismatched = results.some(
    r => r.result.version !== undefined && r.result.version !== requestedVersion
  );
  if (!mismatched) {
    return undefined;
  }

  return `Version "${requestedVersion}" was not available for some results. `
    + 'The search backend returned articles from other versions; they are shown as-is.';
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
  let fromProvider = false;
  let searchError: string | undefined;

  try {
    const resolved = await resolveSearchResults(ctx, params, log);
    allResults = resolved.results;
    fromProvider = resolved.fromProvider;
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

  const paginatedResults = filteredResults
    .slice(paginationInfo.startIndex, paginationInfo.endIndex)
    .map(r => r.result);

  const { finalResults, finalTokenCount, truncated, truncatedContent } =
    truncateSearchResults(paginatedResults, maxTokens);

  const paginationNote = buildPaginationNote(paginationInfo);
  const versionNote = buildVersionNote(params.version, fromProvider, filteredResults);

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
    ...(paginationNote !== undefined ? { paginationNote } : {}),
    ...(versionNote !== undefined ? { versionNote } : {}),
    ...(filterRelaxation !== undefined ? { filterRelaxation } : {}),
    ...(truncatedContent !== undefined ? { truncatedContent } : {}),
    ...(searchError !== undefined ? { searchError } : {}),
  };
}

// ─── Internal: Resolve results from provider or FT API ─────────

/**
 * Build a deterministic cache key for FT search results.
 *
 * Keyed off the *actual request object* rather than a hand-assembled string,
 * which buys two properties the previous projection did not have.
 *
 * **Injective.** The old key was `ft-search:{locale}:{query}:{k}={v}|{k}={v}`
 * with none of `: | = ,` escaped, while both `query` and `version` are
 * caller-supplied free text. Searching `{product: 'jamf-pro', version: '11.5'}`
 * and `{version: '11.5|zoominmetadata=product-pro'}` produced the byte-identical
 * key `ft-search:en-US:FileVault:version=11.5|zoominmetadata=product-pro` while
 * sending different filters upstream, so whichever ran first served its results
 * to the other for the whole TTL. One `FileCache` is shared per process
 * (src/index.ts), so under `--transport http` that crosses clients. JSON escapes
 * the delimiters, so no input can forge a neighbouring key.
 *
 * **Total.** Every field of the request is in the key — `sortId` included — so
 * a relevance-sorted and a last_update-sorted query cannot come to share one
 * entry the moment sort becomes configurable.
 *
 * That holds only while the cached value is a function of this request and
 * nothing else. `params.topic` is deliberately NOT here: it selects a
 * client-side post-filter, and `matchedTopics` is computed unconditionally
 * (see {@link toSearchResultWithMeta}) precisely so the stored value does not
 * vary with it. It used to, and a topic-less search then served its entry to a
 * topic search that silently relaxed the filter it never ran. Anything added to
 * the cached value that comes from `SearchParams` rather than from this request
 * reopens that hole and belongs in the key instead.
 *
 * `paging` is part of the keyed object but constant in practice: this layer
 * always fetches one over-fetched page and paginates client-side.
 */
export function buildSearchCacheKey(request: FtSearchRequest): string {
  const canonical = {
    query: request.query,
    // `?? null` rather than letting `undefined` through: `JSON.stringify`
    // omits undefined properties entirely, so an absent locale would encode
    // identically to a present one that happened to sort last.
    contentLocale: request.contentLocale ?? null,
    sortId: request.sortId ?? null,
    perPage: request.paging?.perPage ?? null,
    page: request.paging?.page ?? null,
    // Sorted into a canonical form: a filter list is a set upstream, but
    // the encoding must not reorder arrays in general — `['a','b']` and
    // `['b','a']` are different data in general, and a helper that collapsed
    // them would be the very non-injectivity this replaces. Compared by
    // UTF-16 code unit on the serialized tuple, not `localeCompare` — a total
    // order and it does not vary with the runtime's ICU locale.
    filters: [...(request.filters ?? [])]
      .map(f => [f.key, [...f.values].sort()] as [string, readonly string[]])
      .sort((a, b) => {
        const left = JSON.stringify(a);
        const right = JSON.stringify(b);
        if (left < right) { return -1; }
        return left > right ? 1 : 0;
      }),
  };
  return `ft-search:${JSON.stringify(canonical)}`;
}

/**
 * Where a result set came from. `fromProvider` is what tells the caller whether
 * the upstream `version` filter was applied — see {@link buildVersionNote}.
 */
interface ResolvedSearchResults {
  results: SearchResultWithMeta[];
  fromProvider: boolean;
}

async function resolveSearchResults(
  ctx: ServerContext,
  params: SearchParams,
  log: Logger
): Promise<ResolvedSearchResults> {
  // 1. Try SearchProvider first (custom backend injection — no caching)
  if (ctx.searchProvider !== undefined) {
    const provided = await ctx.searchProvider.search(params);
    if (provided !== null) {
      return {
        results: provided.map(r => toSearchResultWithMeta(r)),
        fromProvider: true,
      };
    }
  }

  // 2. Build FT search request
  const locale = params.language ?? DEFAULT_LOCALE;

  const perPage = Math.min(
    CONTENT_LIMITS.MAX_SEARCH_RESULTS,
    CONTENT_LIMITS.FILTER_OVERFETCH_CAP
  );

  /** One cached round-trip to FT for a given filter set. */
  const fetchFiltered = async (filters: FtSearchFilter[]): Promise<SearchResultWithMeta[]> => {
    const request: FtSearchRequest = {
      query: params.query,
      contentLocale: locale,
      // Sent explicitly even though it matches Fluid Topics' default, so the
      // ordering this server promises its callers is a stated request
      // parameter rather than an undocumented upstream default that could
      // change under us. Verified identical to omitting it, and clearly
      // distinct from `last_update`, against the live corpus.
      sortId: 'relevance',
      paging: { perPage, page: 1 },
      filters,
    };
    const key = buildSearchCacheKey(request);

    const cached = await ctx.cache.get<SearchResultWithMeta[]>(key);
    if (cached !== null) {
      log.debug(`Search cache hit: key="${key}", ${cached.length} results`);
      return cached;
    }

    log.debug(
      `FT search: query="${params.query}", product=${params.product ?? 'all'}, ` +
      `locale=${locale}, filters=${JSON.stringify(filters)}`
    );

    const ftResponse: FtClusteredSearchResponse = await ftSearch(request);

    // Collapse version snapshots to the latest per topic, then transform.
    // Deduping before transform avoids running cleanSnippet etc. over every
    // Jamf Pro version variant (a broad query can return ~15 snapshots/topic).
    const out: SearchResultWithMeta[] = [];
    for (const entry of dedupeToLatestVersions(ftResponse.results)) {
      const searchResult = transformFtSearchResult(entry);
      if (searchResult.url !== '') {
        out.push(toSearchResultWithMeta(
          searchResult,
          docTypeLabelKeys(entryMetadata(entry)),
        ));
      }
    }

    // Cache the raw results (before client-side filtering)
    await ctx.cache.set(key, out, ctx.config.cacheTtl.search);
    log.debug(`FT search returned ${out.length} results (cached)`);
    return out;
  };

  let results = await fetchFiltered(buildSearchFilters(params));

  // 3. Re-query without docType when narrowing by it emptied the result set
  //    upstream.
  //
  //    docType is now a `content-*` filter on the API rather than a value of
  //    the much broader `jamf:contentType`, so a product+docType pair whose
  //    two labels never co-occur returns nothing at all instead of returning
  //    the product's topics for the post-filter to narrow. Measured on the
  //    live corpus for query "enrollment": `content-solutionguide` matches 40
  //    topics and `product-protect` 35, but their intersection is 0 — Jamf
  //    publishes no Jamf Protect solution guides.
  //
  //    {@link applyFiltersWithFallback} is a *client-side* relaxation: it can
  //    only re-filter what was fetched, so an empty upstream response leaves it
  //    nothing to relax and the caller reports a bare "no results" that does not
  //    even name docType as the cause. Dropping the filter here restores the
  //    fetch the relaxation expects — the post-filter then empties it again and
  //    the existing relaxation reports `removed: ['docType']`, which is what the
  //    user needs to see.
  if (results.length === 0 && params.docType !== undefined) {
    log.debug(`Empty upstream result with docType="${params.docType}"; re-querying without it`);
    results = await fetchFiltered(buildSearchFilters({
      product: params.product,
      version: params.version,
    }));
  }

  return { results, fromProvider: false };
}
