/**
 * Core configuration types and defaults
 *
 * Platform-agnostic configuration that can be used across
 * different runtimes without Node.js-specific dependencies.
 */

// ============================================================================
// Configuration Interfaces
// ============================================================================

/**
 * Cache TTL configuration (in milliseconds)
 *
 * The Node server reads each from the environment variable named with it
 * (platforms/node/config.ts). A cache none of them names has a fixed TTL.
 */
export interface CacheTtlConfig {
  /** Search results from learn.jamf.com (CACHE_TTL_SEARCH). */
  search: number;
  /**
   * Articles (CACHE_TTL_ARTICLE): each article `jamf_docs_get_article` and
   * `jamf_docs_batch_get_articles` fetch, from any source, with the
   * breadcrumb and internal links built when it was fetched; the glossary's
   * term list and definitions; each map's topic index, which a learn.jamf.com
   * page URL is resolved with; and the `jamf://topics` list.
   */
  article: number;
  /**
   * The product list (CACHE_TTL_PRODUCTS): the list of learn.jamf.com maps,
   * support.jamf.com's list of collections, and the title indexes
   * concepts.jamf.com and support.jamf.com are searched with. The product
   * catalogue `jamf_docs_list_products` and `jamf://products` serve is read
   * from the maps list on every call, so it is as old as the list; until
   * 2026-09-28 it was cached apart from it, for `article`.
   *
   * The maps list's age is counted from when it was fetched, also by a
   * process that reads it from the cache. Until 2026-09-28 such a process
   * counted from its read, and could keep a list up to twice this long.
   */
  products: number;
  /**
   * Tables of contents (CACHE_TTL_TOC): each one `jamf_docs_get_toc` and
   * `jamf://products/{productId}/toc` serve, whichever source it is read
   * from (a Fluid Topics map, concepts.jamf.com's sitemap, a support.jamf.com
   * collection page), and the map TOC index an article's navigation is read
   * from. The breadcrumb and internal links built from that index are stored
   * with the article, for `article`. The glossary's term list is read from a
   * map's table of contents too, and kept with its definitions, for `article`.
   *
   * Until 2026-09-28 nothing read this, though the Node server has parsed
   * `CACHE_TTL_TOC` since the first release. In 6.0.12 the Fluid Topics
   * trees and the map TOC index were kept for `article`, and the
   * concepts.jamf.com and support.jamf.com tables of contents for `products`.
   */
  toc: number;
}

/**
 * Outbound HTTP request configuration.
 *
 * Every default here is what the client already did before these became
 * settable, so turning them on changed nothing:
 *  - `maxRetries: 0` — the shipped behaviour. The README used to claim 3.
 *  - `rateLimitDelay: 0` — there was no politeness delay, and defaulting to
 *    one would stagger every parallel batch fetch.
 * The exception is `userAgent`: not sending one at all was the defect, so it
 * has no "current behaviour" worth preserving.
 */
export interface RequestConfig {
  /** Per-attempt timeout in ms. */
  timeout: number;
  /** Retry attempts after the first. 0 disables retrying. */
  maxRetries: number;
  /** Base for the exponential backoff between retries, in ms. */
  retryDelay: number;
  /** Minimum gap between outbound requests from one client, in ms. */
  rateLimitDelay: number;
  /** Sent as the User-Agent header on every request. */
  userAgent: string;
}

/**
 * Cache storage configuration
 */
export interface CacheConfig {
  maxEntries: number;
  dir?: string;
}

/**
 * Combined server configuration
 */
export interface ServerConfig {
  version: string;
  cacheTtl: CacheTtlConfig;
  request: RequestConfig;
  cache: CacheConfig;
}

// ============================================================================
// Default Configuration
// ============================================================================

/** Identifies this client to the documentation hosts it fetches from. */
export function defaultUserAgent(version: string): string {
  return `jamf-docs-mcp-server/${version} (+https://github.com/GET-Technology-Inc/jamf-docs-mcp-server)`;
}

/**
 * Create a ServerConfig with sensible defaults, allowing partial overrides.
 */
export function createDefaultConfig(overrides?: Partial<ServerConfig>): ServerConfig {
  const version = overrides?.version ?? '1.0.0';
  const defaults: ServerConfig = {
    version,
    cacheTtl: {
      search: 30 * 60 * 1000,          // 30 minutes
      article: 24 * 60 * 60 * 1000,    // 24 hours
      products: 7 * 24 * 60 * 60 * 1000, // 7 days
      toc: 24 * 60 * 60 * 1000,        // 24 hours
    },
    request: {
      timeout: 15000,
      maxRetries: 0,
      retryDelay: 1000,
      rateLimitDelay: 0,
      userAgent: defaultUserAgent(version),
    },
    cache: {
      maxEntries: 500,
    },
  };

  if (overrides === undefined) {
    return defaults;
  }

  const merged: ServerConfig = {
    version: overrides.version ?? defaults.version,
    cacheTtl: {
      ...defaults.cacheTtl,
      ...overrides.cacheTtl,
    },
    request: {
      ...defaults.request,
      ...overrides.request,
    },
    cache: {
      ...defaults.cache,
      ...overrides.cache,
    },
  };

  return merged;
}
