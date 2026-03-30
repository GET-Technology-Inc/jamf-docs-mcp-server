/**
 * Core barrel file — public API for the runtime-agnostic core.
 *
 * Platform adapters (e.g. src/platforms/node/) and the entry-point
 * (src/index.ts) should import from here rather than reaching into
 * internal modules.
 */

// Factory
export { createMcpServer } from './create-server.js';
export type { CreateServerOptions } from './create-server.js';

// ============================================================================
// Interfaces (platform adapters implement these)
// ============================================================================

export type {
  CacheProvider,
  CacheStats,
  MetadataStore,
  ProductMetadata,
  TopicMetadata,
  TocEntry as TocEntryInterface,
  TocData,
  Logger,
  LoggerFactory,
  SearchProvider,
  ArticleProvider,
  GlossaryProvider,
  TocProvider,
} from './services/interfaces/index.js';

// ============================================================================
// Configuration
// ============================================================================

export type {
  ServerConfig,
  CacheTtlConfig,
  RequestConfig,
  CacheConfig,
  CorsConfig,
} from './config.js';
export { createDefaultConfig } from './config.js';

// Context
export type { ServerContext } from './types/context.js';

// ============================================================================
// HTTP Client (runtime-agnostic, uses global fetch)
// ============================================================================

export { httpGetText, httpGetJson, HttpError } from './http-client.js';
export type { HttpGetOptions } from './http-client.js';

// ============================================================================
// Constants (static, no runtime dependencies)
// ============================================================================

export {
  DOCS_BASE_URL,
  DOCS_API_URL,
  JAMF_PRODUCTS,
  JAMF_TOPICS,
  DOC_TYPES,
  DOC_TYPE_LABEL_MAP,
  LABEL_TO_DOC_TYPE,
  PRODUCT_IDS,
  TOPIC_IDS,
  DOC_TYPE_IDS,
  SELECTORS,
  SERVER_ICON,
  SUPPORTED_LOCALES,
  SUPPORTED_LOCALE_IDS,
  DEFAULT_LOCALE,
  ResponseFormat,
  OutputMode,
  CONTENT_LIMITS,
  TOKEN_CONFIG,
  PAGINATION_CONFIG,
  buildDocUrl,
  buildUrlPattern,
} from './constants.js';

export type {
  ProductId,
  TopicId,
  DocTypeId,
  LocaleId,
} from './constants.js';

// ============================================================================
// Tool registration (for selective registration by platform adapters)
// ============================================================================

export { registerSearchTool } from './tools/search.js';
export { registerGetArticleTool } from './tools/get-article.js';
export { registerListProductsTool } from './tools/list-products.js';
export { registerGetTocTool } from './tools/get-toc.js';
export { registerGlossaryLookupTool } from './tools/glossary-lookup.js';
export { registerBatchGetArticlesTool } from './tools/batch-get-articles.js';

// ============================================================================
// Service result / option types (for provider implementations)
// ============================================================================

export type {
  SearchDocumentationResult,
  FetchArticleResult,
  FetchArticleOptions,
  FetchTocResult,
  FetchTocOptions,
} from './services/scraper.js';

// ============================================================================
// Domain types (for consumers that need response / param shapes)
// ============================================================================

export type {
  TokenInfo,
  PaginationInfo,
  ArticleSection,
  JamfProduct,
  ProductInfo,
  ProductListResponse,
  SearchParams,
  SearchResult,
  SearchResponse,
  FilterRelaxation,
  TruncatedContentInfo,
  GetArticleParams,
  ParsedArticle,
  ArticleResponse,
  GlossaryEntry,
  GlossaryLookupResult,
  GetTocParams,
  TocEntry,
  TocResponse,
  CacheEntry,
  CacheOptions,
  ToolResult,
} from './types.js';

export {
  JamfDocsError,
  JamfDocsErrorCode,
} from './types.js';
