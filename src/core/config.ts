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
 */
export interface CacheTtlConfig {
  search: number;
  article: number;
  products: number;
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
