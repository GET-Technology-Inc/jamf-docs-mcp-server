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
 * HTTP request configuration
 */
export interface RequestConfig {
  timeout: number;
  maxRetries: number;
  retryDelay: number;
  rateLimitDelay: number;
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
 * CORS configuration for HTTP transport
 */
export interface CorsConfig {
  allowedOrigins: string[];
}

/**
 * Combined server configuration
 */
export interface ServerConfig {
  version: string;
  cacheTtl: CacheTtlConfig;
  request: RequestConfig;
  cache: CacheConfig;
  cors?: CorsConfig;
}

// ============================================================================
// Default Configuration
// ============================================================================

/**
 * Create a ServerConfig with sensible defaults, allowing partial overrides.
 *
 * @param overrides - Partial config to merge over defaults
 * @returns Complete ServerConfig
 */
export function createDefaultConfig(overrides?: Partial<ServerConfig>): ServerConfig {
  const defaults: ServerConfig = {
    version: '1.0.0',
    cacheTtl: {
      search: 30 * 60 * 1000,          // 30 minutes
      article: 24 * 60 * 60 * 1000,    // 24 hours
      products: 7 * 24 * 60 * 60 * 1000, // 7 days
      toc: 24 * 60 * 60 * 1000,        // 24 hours
    },
    request: {
      timeout: 15000,
      maxRetries: 3,
      retryDelay: 1000,
      rateLimitDelay: 500,
      userAgent: 'JamfDocsMCP/1.0 (https://github.com/GET-Technology-Inc/jamf-docs-mcp-server)',
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

  if (overrides.cors !== undefined) {
    merged.cors = overrides.cors;
  }

  return merged;
}
