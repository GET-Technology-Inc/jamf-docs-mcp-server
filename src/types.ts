/**
 * Type definitions for Jamf Docs MCP Server
 */

import { ResponseFormat, ProductId, TopicId } from './constants.js';

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
  urlPattern: string;
  bundleId: string;
  latestVersion: string;
  versions: readonly string[];
}

export interface ProductListResponse {
  products: Array<{
    id: string;
    name: string;
    description: string;
    currentVersion: string;
    availableVersions: string[];
  }>;
  tokenInfo: TokenInfo;
}

// Search types
export interface SearchParams {
  query: string;
  product?: ProductId | undefined;
  version?: string | undefined;
  topic?: TopicId | undefined;
  limit?: number | undefined;
  page?: number | undefined;
  maxTokens?: number | undefined;
  responseFormat?: ResponseFormat | undefined;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  product: string;
  version?: string;
  relevance?: number;
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
}

// Article types
export interface GetArticleParams {
  url: string;
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
  relatedArticles?: Array<{
    title: string;
    url: string;
  }> | undefined;
}

export interface ArticleResponse extends ParsedArticle {
  format: ResponseFormat;
  tokenInfo: TokenInfo;
  sections: ArticleSection[];
}

// TOC types
export interface GetTocParams {
  product: ProductId;
  version?: string;
  page?: number | undefined;
  maxTokens?: number | undefined;
}

export interface TocEntry {
  title: string;
  url: string;
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

// HTTP types
export interface HttpRequestOptions {
  timeout?: number;
  headers?: Record<string, string>;
  retries?: number;
  retryDelay?: number;
}

// MCP Tool types - compatible with MCP SDK CallToolResult
export interface ToolResult {
  [key: string]: unknown;
  content: Array<{
    type: 'text';
    text: string;
  }>;
  isError?: boolean;
}

// Zoomin API types (learn-be.jamf.com)
export interface ZoominSearchResponse {
  status: string;
  Results: ZoominSearchResultWrapper[];
  Pagination?: ZoominPagination;
}

export interface ZoominSearchResultWrapper {
  leading_result: ZoominLeadingResult;
  follower_result?: ZoominLeadingResult[];
  bundle_data?: unknown;
}

export interface ZoominLeadingResult {
  title: string;
  url: string;
  snippet: string;  // HTML snippet with <b> tags
  bundle_id: string;
  page_id: string;
  publication_title: string;
  score?: number;
  labels?: ZoominLabel[];
}

export interface ZoominLabel {
  key: string;
  navtitle: string;
}

export interface ZoominPagination {
  CurrentPage: number;
  TotalPages: number;
  ResultsPerPage: number;
  TotalResults: number;
}

// Utility types
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};
