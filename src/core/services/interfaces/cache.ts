/**
 * Cache interfaces for platform abstraction
 */

/**
 * Cache statistics
 */
export interface CacheStats {
  memoryEntries: number;
  totalEntries: number;
  totalSize?: number;
}

/**
 * Platform-agnostic cache provider
 */
export interface CacheProvider {
  get: <T>(key: string) => Promise<T | null>;
  set: <T>(key: string, value: T, ttl?: number) => Promise<void>;
  delete: (key: string) => Promise<boolean>;
  clear: () => Promise<void>;
  stats: () => Promise<CacheStats>;
  prune: () => Promise<number>;
}
