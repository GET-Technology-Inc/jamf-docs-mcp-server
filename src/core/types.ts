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
  relevance?: number;
  docType?: DocTypeId;
  mapId?: string;
  contentId?: string;
  breadcrumb?: string[];
  mapTitle?: string;
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
  title: string;
  prettyUrl: string;
  hasRating?: boolean;
  children: FtTocNode[];
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
  title: string;
  htmlTitle: string;
  mapTitle: string;
  breadcrumb: string[];
  htmlExcerpt: string;
  metadata: FtMetadataEntry[];
}

export interface FtSearchMap {
  mapId: string;
  mapUrl: string;
  readerUrl: string;
  title: string;
  htmlTitle: string;
  htmlExcerpt: string;
  metadata: FtMetadataEntry[];
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
  title: string;
  id: string;
  mapApiEndpoint: string;
  metadata: FtMetadataEntry[];
}

export interface FtTopicInfo {
  title: string;
  id: string;
  contentApiEndpoint: string;
  readerUrl?: string;
  breadcrumb?: string[];
  metadata: FtMetadataEntry[];
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
  toc: TocEntry[];
  tokenInfo: TokenInfo;
  pagination: PaginationInfo;
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
