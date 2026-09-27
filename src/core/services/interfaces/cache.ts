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
 *
 * **What core makes of a provider.** The cache is an optimisation, and no
 * reply depends on what it does. Through `createMcpServer`, core never calls
 * the provider it is given directly: `createMcpServer` puts
 * `guardCache(ctx.cache)` in the context its tools and resources read, and
 * `MapsRegistry` and `TopicResolver` guard the provider they are constructed
 * with (see `cache-guard.ts`). So:
 *
 * - `get` may answer `null` or `undefined` for a miss.
 * - `get`, `set` and `delete` may throw or reject, a KV store's quota or a
 *   network error, say. Each failure is logged as a warning under `cache`. A
 *   failed read is a miss, a failed write is skipped, and a failed delete
 *   answers `false`.
 * - `clear`, `stats` and `prune` are not called by core, and are passed
 *   through as they are, failures included.
 *
 * Until 2026-09-28 each of those failed the reply, and `undefined` was read
 * as a hit. A caller that reaches past `createMcpServer`, such as one calling
 * a service's function with a context of its own, gets the provider it
 * passes, and can guard it with `guardCache` from
 * `core/services/cache-guard`.
 */
export interface CacheProvider {
  /**
   * The value stored under `key`, or `null` (or `undefined`) on a miss.
   *
   * Any other value is a hit, and is not checked: it is what core stored
   * under that key. A namespace whose value changes shape moves to a new
   * key, so a provider only has to hand back what it was given. One that
   * answers for a key with a value it was not given under it breaks core in
   * a way the guard cannot tell from a hit.
   */
  get: <T>(key: CacheKey) => Promise<T | null>;
  set: (key: CacheKey, value: unknown, ttl?: number) => Promise<void>;
  delete: (key: CacheKey) => Promise<boolean>;
  clear: () => Promise<void>;
  stats: () => Promise<CacheStats>;
  prune: () => Promise<number>;
}
