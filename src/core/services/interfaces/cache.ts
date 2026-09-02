/**
 * Cache interfaces for platform abstraction
 */

import type { CacheKey } from '../cache-key.js';

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
 *
 * Keys are {@link CacheKey}, not `string`: every service in this process
 * shares one provider instance (src/index.ts), so a key that is not an
 * injective function of the data it stands for serves one caller's results to
 * another. The brand makes a hand-assembled template literal a compile error,
 * which is what moves that invariant off ten separate call sites and into the
 * type system.
 *
 * BREAKING for callers, not for implementers. A `get(key: string)` method still
 * satisfies this interface — method parameters are bivariant — which is why
 * `FileCache` needed no change. But this interface is published (`./core`), and
 * an embedder holding a `ServerContext` who calls `ctx.cache.get('my-key')`
 * now gets TS2345: a plain string is no longer a `CacheKey`. That is the point
 * — it is the same mistake this exists to prevent — but it is a semver-major
 * change and the release notes have to say so. Such a caller mints a key with
 * {@link cacheKey}, or keeps its own store.
 */
export interface CacheProvider {
  get: <T>(key: CacheKey) => Promise<T | null>;
  set: (key: CacheKey, value: unknown, ttl?: number) => Promise<void>;
  delete: (key: CacheKey) => Promise<boolean>;
  clear: () => Promise<void>;
  stats: () => Promise<CacheStats>;
  prune: () => Promise<number>;
}
