/**
 * Type definitions for Jamf Docs MCP Server
 */

import type { ResponseFormat, ProductId, TopicId, DocTypeId, LocaleId } from './constants.js';

// ============================================================================
// Context7-style Token and Pagination Types
// ============================================================================

/**
 * Token information for response size management
 */
export interface TokenInfo {
  tokenCount: number;
  truncated: boolean;
  maxTokens: number;
}

/**
 * Pagination information for paginated responses
 */
export interface PaginationInfo {
  page: number;
  pageSize: number;
  totalPages: number;
  totalItems: number;
  hasNext: boolean;
  hasPrev: boolean;
}

/**
 * Article section information for section filtering
 */
export interface ArticleSection {
  id: string;
  title: string;
  level: number;  // Heading level (1-6)
  tokenCount: number;
}

// Product types
export interface JamfProduct {
  id: ProductId;
  name: string;
  description: string;
  bundleId: string;
  latestVersion: string;
  versions: readonly string[];
}

export interface ProductInfo {
  id: string;
  name: string;
  description: string;
  currentVersion: string;
  availableVersions: string[];
  hasContent: boolean;
}

export interface ProductListResponse {
  products: ProductInfo[];
  tokenInfo: TokenInfo;
}

// Search types
export interface SearchParams {
  query: string;
  product?: ProductId | undefined;
  version?: string | undefined;
  topic?: TopicId | undefined;
  docType?: DocTypeId | undefined;
  language?: LocaleId | undefined;
  limit?: number | undefined;
  page?: number | undefined;
  maxTokens?: number | undefined;
  responseFormat?: ResponseFormat | undefined;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  product: string | null;  // API may return null for some results
  version?: string;
  docType?: DocTypeId;
  mapId?: string;
  contentId?: string;
  breadcrumb?: string[];
  mapTitle?: string;
  /**
   * Other versions of this same topic that the search collapsed away.
   *
   * Fluid Topics publishes one entry per product version, all sharing an
   * `ft:clusterId`; `dedupeToLatestVersions` keeps the newest so a broad
   * query does not return fifteen copies of one page. Listing what it
   * dropped is what makes that reversible: the reader can see the topic
   * exists in 11.26 and ask for it by version. Newest first; absent when
   * nothing was collapsed.
   */
  otherVersions?: string[];
}

export interface FilterRelaxation {
  removed: string[];
  original: Record<string, string>;
  message: string;
}

export interface TruncatedContentInfo {
  omittedCount: number;
  omittedItems: { title: string; estimatedTokens: number }[];
}

export interface SearchResponse {
  total: number;
  results: SearchResult[];
  query: string;
  filters?: {
    product?: string;
    version?: string;
    topic?: string;
  };
  tokenInfo: TokenInfo;
  pagination: PaginationInfo;
  filterRelaxation?: FilterRelaxation;
  versionNote?: string;
  relevanceNote?: string;
  /** Set when the requested page was clamped to the last available page. */
  paginationNote?: string;
  truncatedContent?: TruncatedContentInfo;
}

// Article fetch types

/**
 * Options for fetching articles
 */
export interface FetchArticleOptions {
  includeRelated?: boolean;
  section?: string;
  summaryOnly?: boolean;
  maxTokens?: number;
  locale?: LocaleId | undefined;
}

/**
 * Article result with token and section info
 */
export interface FetchArticleResult extends ParsedArticle {
  tokenInfo: TokenInfo;
  sections: ArticleSection[];
}

/**
 * Options for fetching table of contents
 */
export interface FetchTocOptions {
  page?: number;
  maxTokens?: number;
  locale?: LocaleId | undefined;
}

/**
 * TOC result with pagination and token info
 */
export interface FetchTocResult {
  toc: TocEntry[];
  pagination: PaginationInfo;
  tokenInfo: TokenInfo;
  /**
   * The Fluid Topics map the entries came from.
   *
   * Together with an entry's `contentId` this is the pair `jamf_docs_get_article`
   * documents as obtainable "from search results or TOC", so it is carried out
   * of here rather than staying an implementation detail of the fetch.
   *
   * Optional because a `TocProvider` serving its own cache need not know it,
   * and because a cached tree re-resolves it best-effort.
   */
  mapId?: string;
  /** Set when the requested page was clamped to the last available page. */
  paginationNote?: string;
}

/**
 * Search response with token and pagination info
 */
export interface SearchDocumentationResult {
  results: SearchResult[];
  pagination: PaginationInfo;
  tokenInfo: TokenInfo;
  filterRelaxation?: FilterRelaxation;
  versionNote?: string;
  truncatedContent?: TruncatedContentInfo;
  /** Set when the requested page was clamped to the last available page. */
  paginationNote?: string;
  /** Set when the upstream search call failed; results will be empty. */
  searchError?: string;
}

// Article types
export interface GetArticleParams {
  url: string;
  language?: LocaleId | undefined;
  includeRelated?: boolean;
  section?: string | undefined;
  maxTokens?: number | undefined;
  responseFormat?: ResponseFormat;
}

/** One table-of-contents neighbour, under the title the TOC gives it. */
export interface ArticleNavigationLink {
  title: string;
  url: string;
}

/**
 * Where an article sits in its product's table of contents.
 *
 * `siblingCount`/`childCount` are the totals in the tree, not the lengths of
 * the arrays above them: a provider caps those lists (a root page's siblings
 * are the product's ~20 top-level nodes), and a truncated list that does not
 * say so is a list a reader will treat as exhaustive.
 */
export interface ArticleNavigation {
  /** The node itself. */
  self: ArticleNavigationLink;
  parent?: ArticleNavigationLink | undefined;
  siblings: ArticleNavigationLink[];
  children: ArticleNavigationLink[];
  siblingCount: number;
  childCount: number;
}

/**
 * An article as a provider hands it over — and, `content` aside, exactly what
 * the structured channel publishes.
 *
 * This is the contract, not a superset of one: `buildArticleStructuredContent`
 * in tools/get-article.ts assigns every key here a disposition through a
 * `Record<keyof ParsedArticle, …>`, so adding a field below without deciding
 * what the structured channel does with it is a compile error. That is the
 * point of routing provider signals through this interface rather than through
 * an intersection type on the provider side — a field an `ArticleProvider`
 * returns that is not declared here is published on no channel and reported
 * nowhere.
 */
export interface ParsedArticle {
  title: string;
  content: string;
  url: string;
  product?: string | undefined;
  version?: string | undefined;
  lastUpdated?: string | undefined;
  breadcrumb?: string[] | undefined;
  relatedArticles?: {
    title: string;
    url: string;
  }[] | undefined;
  mapId?: string | undefined;
  contentId?: string | undefined;
  /**
   * Whether this copy came from the release upstream still flags as current.
   *
   * Absent means "not known" — no map, no cached map, or no flag on it — which
   * is three different silences, none of which is `'superseded'`.
   */
  versionStatus?: 'latest' | 'superseded' | undefined;
  /**
   * The language of the bytes in `content`.
   *
   * Not the requested locale and not the locale in `url`, both of which still
   * say e.g. `th-TH` when Jamf has no translation and served English.
   */
  contentLocale?: string | undefined;
  /** Where the page sits in its product's table of contents. */
  navigation?: ArticleNavigation | undefined;
}

export interface ArticleResponse extends ParsedArticle {
  format: ResponseFormat;
  tokenInfo: TokenInfo;
  sections: ArticleSection[];
}

// Glossary types
export interface GlossaryEntry {
  term: string;
  definition: string;
  url: string;
  product?: string | undefined;
}

export interface GlossaryLookupResult {
  entries: GlossaryEntry[];
  totalMatches: number;
  tokenInfo: TokenInfo;
}

// Fluid Topics API types

export interface FtTocNode {
  tocId: string;
  contentId: string;
  /**
   * Optional for the same reason as {@link FtTopicInfo.title}: this shape is a
   * bare cast over `response.json()` (`httpGetJson<FtTocNode | FtTocNode[]>`)
   * with no runtime validation behind it.
   */
  title?: string;
  prettyUrl: string;
  hasRating?: boolean;
  /**
   * Optional for the same reason as `title`. Fluid Topics omits the key
   * entirely on leaf nodes rather than sending `[]`. Declaring it required
   * told the compiler that `if (node.children && ...)` was dead code, and
   * removing that guard in 4.0.1 turned a leaf node into
   * `TypeError: Cannot read properties of undefined (reading 'length')`.
   */
  children?: FtTocNode[];
}

export interface FtMetadataEntry {
  key: string;
  label: string;
  values: string[];
}

export interface FtSearchTopic {
  mapId: string;
  contentId: string;
  tocId: string;
  /** Optional for the same reason as {@link FtTopicInfo.title}. */
  title?: string;
  htmlTitle: string;
  mapTitle: string;
  breadcrumb: string[];
  htmlExcerpt: string;
  /** Optional for the same reason as `title`; readers go through getMetaValue(s). */
  metadata?: FtMetadataEntry[];
}

export interface FtSearchMap {
  mapId: string;
  mapUrl: string;
  readerUrl: string;
  /** Optional for the same reason as {@link FtTopicInfo.title}. */
  title?: string;
  htmlTitle: string;
  htmlExcerpt: string;
  /** Optional for the same reason as `title`; readers go through getMetaValue(s). */
  metadata?: FtMetadataEntry[];
  editorialType: string;
  lastEditionDate?: string;
  lastPublicationDate?: string;
  openMode: string;
}

export interface FtSearchEntry {
  type: 'TOPIC' | 'MAP';
  missingTerms: string[];
  topic?: FtSearchTopic;
  map?: FtSearchMap;
}

export interface FtSearchCluster {
  metadataVariableAxis: string;
  entries: FtSearchEntry[];
}

export interface FtSearchPaging {
  currentPage: number;
  isLastPage: boolean;
  totalResultsCount: number;
  totalClustersCount: number;
}

export interface FtClusteredSearchResponse {
  facets: unknown[];
  results: FtSearchCluster[];
  announcements: unknown[];
  paging: FtSearchPaging;
}

export interface FtSearchFilter {
  key: string;
  values: string[];
}

export interface FtSearchRequest {
  query: string;
  contentLocale?: string;
  paging?: { perPage: number; page: number };
  filters?: FtSearchFilter[];
  sortId?: string;
}

export interface FtMapInfo {
  /** Optional for the same reason as {@link FtTopicInfo.title}. */
  title?: string;
  id: string;
  mapApiEndpoint: string;
  /** Optional for the same reason as `title`; readers go through getMetaValue(s). */
  metadata?: FtMetadataEntry[];
}

export interface FtTopicInfo {
  /**
   * Optional because this shape is a bare cast over `response.json()`
   * (`httpGetJson<FtTopicInfo>`) with no runtime validation behind it — it
   * describes what Fluid Topics usually sends, not what it is obliged to.
   * Declaring `title` required told the compiler a guard against a missing one
   * was dead code, and removing that guard was how a titleless payload started
   * producing an article with `undefined` for a title instead of falling back
   * to the parsed `<h1>`.
   */
  title?: string;
  id: string;
  contentApiEndpoint: string;
  readerUrl?: string;
  breadcrumb?: string[];
  /** Optional for the same reason as `title`; readers go through getMetaValue(s). */
  metadata?: FtMetadataEntry[];
}

// TOC types
export interface GetTocParams {
  product: ProductId;
  language?: LocaleId | undefined;
  version?: string;
  page?: number | undefined;
  maxTokens?: number | undefined;
}

export interface TocEntry {
  title: string;
  url: string;
  contentId?: string;
  tocId?: string;
  children?: TocEntry[];
}

export interface TocResponse {
  product: string;
  version: string;
  /** See {@link FetchTocResult.mapId}. Pairs with each entry's `contentId`. */
  mapId?: string;
  toc: TocEntry[];
  tokenInfo: TokenInfo;
  pagination: PaginationInfo;
  /** Set when the requested page was clamped to the last available page. */
  paginationNote?: string;
}

// Cache types
export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

export interface CacheOptions {
  ttl?: number;
  forceRefresh?: boolean;
}

// Error types
export class JamfDocsError extends Error {
  constructor(
    message: string,
    public readonly code: JamfDocsErrorCode,
    public readonly url?: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = 'JamfDocsError';
  }
}

export enum JamfDocsErrorCode {
  NOT_FOUND = 'NOT_FOUND',
  RATE_LIMITED = 'RATE_LIMITED',
  PARSE_ERROR = 'PARSE_ERROR',
  NETWORK_ERROR = 'NETWORK_ERROR',
  INVALID_URL = 'INVALID_URL',
  INVALID_PRODUCT = 'INVALID_PRODUCT',
  CACHE_ERROR = 'CACHE_ERROR',
  TIMEOUT = 'TIMEOUT'
}

// MCP Tool types - compatible with MCP SDK CallToolResult
export interface ToolResult {
  [key: string]: unknown;
  content: {
    type: 'text';
    text: string;
  }[];
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}
