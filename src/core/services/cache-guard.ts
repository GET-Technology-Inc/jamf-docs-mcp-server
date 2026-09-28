/**
 * The one way core reads and writes an injected {@link CacheProvider}.
 *
 * The cache is an optimisation: a reply is the same whether or not it held
 * anything, so nothing a cache does may decide one. Until 2026-09-28 core
 * called the provider it was handed directly, at sixteen `get` and seventeen
 * `set` call sites in twelve files, and took whatever it did as given
 * (measured offline over MCP, test/unit/tools/cache-provider-faults.test.ts):
 *
 * - A `get` or a `set` that threw failed the reply, a `set` after the fetch it
 *   was storing had succeeded. Every tool call was an error ("Error fetching
 *   article: KV PUT failed: …"), three of the four resources threw, and the
 *   fourth answered its compiled-in fallback. The search said "this server
 *   hit an unexpected error", and before #354 "No results found".
 * - A `get` that answered `undefined` for a missing key, as a `Map` does, was
 *   read as a hit, because each call site tests for `null`. Every tool but
 *   `list_products` failed ("Cannot read properties of undefined (reading
 *   'map')"), and `list_products` said the maps registry on learn.jamf.com
 *   could not be read.
 *
 * `FileCache` does neither: it catches its own disk errors and answers a miss
 * with `null`. A provider an embedder injects, over a KV store or a database,
 * need not, and one written in plain JavaScript can throw without a promise.
 *
 * So, through `createMcpServer`, core never holds the provider it was given.
 * `createMcpServer` puts {@link guardCache}'s answer in the context every tool
 * and resource reads, and `MapsRegistry` and `TopicResolver` guard the
 * provider they are constructed with. A new call site is covered by reading
 * `ctx.cache`, with nothing to remember. A caller that hands a service
 * function a context of its own gets the provider in it, unless it guards
 * that provider itself.
 *
 * What the guard does not check is the shape of a hit. A value under a key
 * is what core stored there: a namespace whose value changes shape moves to a
 * new key (`cache-key.ts`, `ft-search-v3` and the other `-vN`), unless its
 * reader tells the shapes apart itself, as since 2026-09-28 the map TOC
 * index does (`ft-tocindex-v3`, read as a miss without the `/toc` it now
 * keeps) and a table of contents does (`ft-toc-v2`, whose download time is
 * optional). The two entries that can hold a stand-in answer, the product
 * catalogue and its availability, check what they read already. A store that
 * hands back something core did not store under that key is broken in a way
 * no guard can tell from a hit.
 */

import type { CacheKey } from './cache-key.js';
import type { CacheProvider, CacheStats } from './interfaces/cache.js';
import type { Logger, LoggerFactory } from './interfaces/logger.js';
import { createStderrLogger } from './logging.js';

/** Where the guard logs until a server's logger is handed to it. */
const FALLBACK_LOG = createStderrLogger('cache');

/**
 * The namespace a key is in: every key starts with one (`cacheKey`). The
 * rest can be a search query or a URL, and the namespace is what says which
 * cache failed.
 */
function namespaceOf(key: CacheKey): string {
  const colon = key.indexOf(':');
  return colon === -1 ? key : key.slice(0, colon);
}

class GuardedCache implements CacheProvider {
  private loggers: LoggerFactory | undefined;
  private log: Logger | undefined;

  constructor(private readonly inner: CacheProvider) {}

  /**
   * Log through `loggers` from now on, unless an earlier caller named some.
   *
   * The first server's wins. On Node every per-request server gets a
   * `NodeLoggerFactory` writing to the same stderr, so which one it is does
   * not matter. Until one is named, as for a `MapsRegistry` read before any
   * server is created, the guard writes to stderr as `createStderrLogger`
   * does.
   */
  adopt(loggers: LoggerFactory): void {
    this.loggers ??= loggers;
  }

  private warn(message: string): void {
    if (this.log === undefined && this.loggers !== undefined) {
      this.log = this.loggers.createLogger('cache');
    }
    (this.log ?? FALLBACK_LOG).warning(message);
  }

  /**
   * The stored value, or `null` for a miss: `undefined` is one too, and so is
   * a read that failed.
   */
  async get<T>(key: CacheKey): Promise<T | null> {
    try {
      return (await this.inner.get<T>(key)) ?? null;
    } catch (error) {
      this.warn(`Cache read failed (${namespaceOf(key)}), read as a miss: ${String(error)}`);
      return null;
    }
  }

  /** Never throws: the reply goes on with what it fetched, uncached. */
  async set(key: CacheKey, value: unknown, ttl?: number): Promise<void> {
    try {
      // The TTL is passed only when there is one, so a provider that counts
      // its arguments sees the call core made.
      await (ttl === undefined ? this.inner.set(key, value) : this.inner.set(key, value, ttl));
    } catch (error) {
      this.warn(`Cache write failed (${namespaceOf(key)}), the reply goes on without it: ${String(error)}`);
    }
  }

  /** Never throws: `false`, as for a key that was not there. */
  async delete(key: CacheKey): Promise<boolean> {
    try {
      return await this.inner.delete(key);
    } catch (error) {
      this.warn(`Cache delete failed (${namespaceOf(key)}): ${String(error)}`);
      return false;
    }
  }

  // Not called by core. They belong to whoever runs the server, who is told
  // what they throw: src/index.ts logs a failed `prune()` itself.
  async clear(): Promise<void> {
    await this.inner.clear();
  }

  async stats(): Promise<CacheStats> {
    return await this.inner.stats();
  }

  async prune(): Promise<number> {
    return await this.inner.prune();
  }
}

/** The guard of each provider, so a provider is guarded by one object only. */
const guards = new WeakMap<CacheProvider, GuardedCache>();

/**
 * `cache`, read and written so that nothing it does can fail a reply or pass
 * for a hit:
 *
 * - `get` answers `null` for `undefined` as well, and for a read that throws
 *   or rejects, which it logs as a warning.
 * - `set` and `delete` that throw or reject are logged, and the caller goes
 *   on; `delete` answers `false`.
 * - `clear`, `stats` and `prune` are the provider's own.
 *
 * One provider always gets the same guard, and a guard is its own. That
 * matters: the glossary's and the static sources' Fuse indexes, and the
 * loads in flight of load-once.ts, are kept per `CacheProvider`, and
 * src/index.ts creates a server per HTTP request over one context.
 * `loggers`, when given, is where the guard logs; see
 * {@link GuardedCache.adopt}.
 */
export function guardCache(cache: CacheProvider, loggers?: LoggerFactory): CacheProvider {
  let guard = cache instanceof GuardedCache ? cache : guards.get(cache);
  if (guard === undefined) {
    guard = new GuardedCache(cache);
    guards.set(cache, guard);
  }
  if (loggers !== undefined) { guard.adopt(loggers); }
  return guard;
}
