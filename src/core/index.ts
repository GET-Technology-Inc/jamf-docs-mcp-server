/**
 * Core barrel file — public API for the runtime-agnostic core.
 *
 * Platform adapters (e.g. src/platforms/node/) and the entry-point
 * (src/index.ts) should import from here rather than reaching into
 * internal modules.
 *
 * Internal helpers (FT client functions, content-parser utilities,
 * tool registration functions, etc.) are intentionally NOT re-exported.
 * Consumers that need them can import from the specific module via
 * the "jamf-docs-mcp/core/*" export map.
 */

// ============================================================================
// Factory
// ============================================================================

export { createMcpServer } from './create-server.js';
export type { CreateServerOptions } from './create-server.js';

// ============================================================================
// Interfaces (platform adapters implement these)
// ============================================================================

export type {
  CacheProvider,
  CacheStats,
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
  MapsProvider,
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

// ============================================================================
// Context
// ============================================================================

export type { ServerContext } from './types/context.js';

// ============================================================================
// Constants (consumer-facing)
// ============================================================================

export {
  DOCS_BASE_URL,
  JAMF_PRODUCTS,
  JAMF_TOPICS,
  DOC_TYPES,
} from './constants.js';

export type {
  ProductId,
  TopicId,
  DocTypeId,
  LocaleId,
} from './constants.js';

// ============================================================================
// Service classes (needed to construct ServerContext)
// ============================================================================

export { MapsRegistry } from './services/maps-registry.js';
export type { MapEntry, RegistryProductInfo } from './services/maps-registry.js';

export { TopicResolver } from './services/topic-resolver.js';
export type { ResolvedTopic, TopicResolverInput } from './services/topic-resolver.js';

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
  FetchArticleResult,
  FetchArticleOptions,
  FetchTocResult,
  FetchTocOptions,
  SearchDocumentationResult,
} from './types.js';

export {
  JamfDocsError,
  JamfDocsErrorCode,
} from './types.js';
