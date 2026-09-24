/**
 * Node.js file-based cache implementation
 *
 * Provides file-based caching with TTL support and LRU memory eviction.
 * All Node.js built-in imports (fs, path, crypto) are isolated here.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';

import type { CacheProvider, CacheStats, Logger } from '../../core/services/interfaces/index.js';
import type { CacheEntry } from '../../core/types.js';

// Imported, not re-declared. This file used to carry its own byte-identical
// copy while core/services/cache.ts carried the one the tests asserted against,
// so the guard protecting the disk read and the guard under test were two
// different objects that only happened to agree. Re-exported because it was
// exported from here before, and `./platforms/node` is a published path.
import { CacheEntrySchema } from '../../core/services/cache.js';

export { CacheEntrySchema };

/**
 * Doubly-linked list node for LRU tracking
 */
interface LruNode {
  key: string;
  prev: LruNode | null;
  next: LruNode | null;
}

/**
 * How long an abandoned `.tmp` write must sit before `prune()` reclaims it.
 *
 * `set()` writes `<hash>.json.tmp.<pid>` and renames it into place; the gap
 * between the two calls is sub-millisecond. Anything still present an hour
 * later belongs to a process that died mid-write, so the margin is four
 * orders of magnitude wider than a live write ever needs while still bounding
 * the residue. It has to be a time check rather than a liveness check on the
 * embedded pid: pids are recycled, and on a shared cache directory the owning
 * process may not even be on this host.
 */
const TMP_WRITE_GRACE_MS = 60 * 60 * 1000;

/**
 * The file names this cache writes, and so the only ones it may count or delete.
 *
 * `CACHE_DIR` is whatever directory the operator names, and nothing makes it
 * ours alone. Until 2026-09-24 `prune()`, `clear()` and `stats()` treated every
 * `*.json` in it as an entry, and `prune()` runs on every start (#253). Started
 * with `CACHE_DIR=.` in a project root, v6.0.4 deleted package.json and
 * tsconfig.json before the first tool call: they fail `CacheEntrySchema`, so
 * they read as corrupt entries, and the log called them "stale entries". A
 * directory shared with other tools lost their state files the same way.
 * Matching on our own names means a mis-aimed `CACHE_DIR` can gain hash-named
 * files but never lose one it already had.
 *
 * - Entries are `<sha256 hex>.json` (`getCachePath`) since v1.2.0. v1.0.0 and
 *   v1.1.0 named them by md5, 32 hex digits. Those still match so the startup
 *   sweep reclaims them: they are exactly the orphans #253 set out to reclaim.
 * - In-flight writes are `<sha256 hex>.json.tmp.<pid>`. The write-then-rename
 *   arrived in v1.2.0 together with sha256, so no md5-named one ever existed.
 */
const ENTRY_FILE = /^(?:[0-9a-f]{32}|[0-9a-f]{64})\.json$/;
const TMP_WRITE_FILE = /^[0-9a-f]{64}\.json\.tmp\.\d+$/;

/**
 * What a directory entry is to this cache: an entry, an in-flight write, or
 * someone else's file (`null`), which nothing in this class may touch.
 *
 * The one predicate `prune()`, `clear()` and `stats()` share. Each used to
 * carry its own filter, and each was wrong the same way.
 */
function ownFileKind(file: string): 'entry' | 'tmp-write' | null {
  if (ENTRY_FILE.test(file)) { return 'entry'; }
  if (TMP_WRITE_FILE.test(file)) { return 'tmp-write'; }
  return null;
}

export class FileCache implements CacheProvider {
  private readonly cacheDir: string;
  private readonly maxEntries: number;
  private readonly defaultTtl: number;
  private readonly log: Logger;
  private readonly memoryCache = new Map<string, CacheEntry<unknown>>();
  private readonly lruMap = new Map<string, LruNode>();
  // Sentinels. Most recently used sits behind lruHead, least recently used in
  // front of lruTail — which is the whole reason lruEvictLeast reads
  // `lruTail.prev`. Neither sentinel ever holds an entry.
  private readonly lruHead: LruNode = { key: '__head__', prev: null, next: null };
  private readonly lruTail: LruNode = { key: '__tail__', prev: null, next: null };
  private dirCreated = false;

  constructor(options: {
    cacheDir?: string;
    maxEntries?: number;
    defaultTtl?: number;
    log: Logger;
  }) {
    this.cacheDir = options.cacheDir ?? '.cache';
    this.maxEntries = options.maxEntries ?? 500;
    this.defaultTtl = options.defaultTtl ?? 24 * 60 * 60 * 1000;
    this.log = options.log;
    this.lruHead.next = this.lruTail;
    this.lruTail.prev = this.lruHead;
  }

  private static getCacheKey(key: string): string {
    return crypto.createHash('sha256').update(key).digest('hex');
  }

  private getCachePath(key: string): string {
    return path.join(this.cacheDir, `${FileCache.getCacheKey(key)}.json`);
  }

  private async ensureCacheDir(): Promise<void> {
    if (this.dirCreated) { return; }
    await fs.mkdir(this.cacheDir, { recursive: true }).catch(() => { /* ignore if exists */ });
    this.dirCreated = true;
  }

  private lruMoveToFront(node: LruNode): void {
    // Remove from current position
    if (node.prev !== null) { node.prev.next = node.next; }
    if (node.next !== null) { node.next.prev = node.prev; }
    // Insert after head
    node.next = this.lruHead.next;
    node.prev = this.lruHead;
    if (this.lruHead.next !== null) { this.lruHead.next.prev = node; }
    this.lruHead.next = node;
  }

  private lruAdd(key: string): void {
    const existing = this.lruMap.get(key);
    if (existing !== undefined) {
      this.lruMoveToFront(existing);
      return;
    }
    const node: LruNode = { key, prev: null, next: null };
    this.lruMap.set(key, node);
    this.lruMoveToFront(node);
  }

  private lruRemove(key: string): void {
    const node = this.lruMap.get(key);
    if (node === undefined) { return; }
    if (node.prev !== null) { node.prev.next = node.next; }
    if (node.next !== null) { node.next.prev = node.prev; }
    node.prev = null;
    node.next = null;
    this.lruMap.delete(key);
  }

  private lruEvictLeast(): void {
    const leastNode = this.lruTail.prev;
    if (leastNode === null || leastNode === this.lruHead) { return; }
    this.memoryCache.delete(leastNode.key);
    this.lruRemove(leastNode.key);
  }

  async get<T>(key: string): Promise<T | null> {
    const memCached = this.memoryCache.get(key) as CacheEntry<T> | undefined;
    if (memCached !== undefined) {
      if (Date.now() - memCached.timestamp < memCached.ttl) {
        this.lruAdd(key); // Promote in LRU
        return memCached.data;
      }
      // Expired, remove from memory
      this.memoryCache.delete(key);
      this.lruRemove(key);
    }

    try {
      const cachePath = this.getCachePath(key);
      const content = await fs.readFile(cachePath, 'utf-8');
      const raw: unknown = JSON.parse(content);

      const parsed = CacheEntrySchema.safeParse(raw);
      if (!parsed.success) {
        await this.delete(key);
        return null;
      }

      const entry = parsed.data as CacheEntry<T>;

      if (Date.now() - entry.timestamp > entry.ttl) {
        await this.delete(key);
        return null;
      }

      this.memoryCacheSet(key, entry);

      return entry.data;
    } catch {
      // File doesn't exist or is invalid
      return null;
    }
  }

  private memoryCacheSet(key: string, entry: CacheEntry<unknown>): void {
    if (!this.memoryCache.has(key) && this.memoryCache.size >= this.maxEntries) {
      this.lruEvictLeast();
    }
    this.memoryCache.set(key, entry);
    this.lruAdd(key);
  }

  async set(key: string, value: unknown, ttl?: number): Promise<void> {
    await this.ensureCacheDir();

    const entry: CacheEntry<unknown> = {
      data: value,
      timestamp: Date.now(),
      ttl: ttl ?? this.defaultTtl
    };

    this.memoryCacheSet(key, entry);

    // Store in file atomically (write to .tmp then rename)
    try {
      const cachePath = this.getCachePath(key);
      const tmpPath = `${cachePath}.tmp.${process.pid}`;
      await fs.writeFile(tmpPath, JSON.stringify(entry), 'utf-8');
      await fs.rename(tmpPath, cachePath);
    } catch (error) {
      // Log but don't fail
      this.log.error(`Failed to write cache: ${String(error)}`);
    }
  }

  async delete(key: string): Promise<boolean> {
    const existed = this.memoryCache.has(key);
    this.memoryCache.delete(key);
    this.lruRemove(key);
    await fs.unlink(this.getCachePath(key)).catch(() => { /* ignore if not exists */ });
    return existed;
  }

  async clear(): Promise<void> {
    this.memoryCache.clear();
    this.lruMap.clear();
    this.lruHead.next = this.lruTail;
    this.lruTail.prev = this.lruHead;
    try {
      const files = await fs.readdir(this.cacheDir);
      // Includes in-flight `.tmp` writes: `clear()` is an explicit "drop
      // everything", and leaving them behind is how the directory grows a
      // residue that nothing else looks at. "Everything" is everything we
      // wrote, not everything in the directory.
      const ours = files.filter(f => ownFileKind(f) !== null);
      await Promise.all(
        ours.map(async f => { await fs.unlink(path.join(this.cacheDir, f)).catch(() => { /* raced */ }); })
      );
    } catch {
      // Directory may not exist
    }
  }

  async stats(): Promise<CacheStats> {
    let totalEntries = 0;
    let totalSize = 0;

    try {
      const files = await fs.readdir(this.cacheDir);
      const entryFiles = files.filter(f => ownFileKind(f) === 'entry');
      totalEntries = entryFiles.length;

      for (const file of entryFiles) {
        const stat = await fs.stat(path.join(this.cacheDir, file));
        totalSize += stat.size;
      }
    } catch {
      // Directory may not exist
    }

    return {
      memoryEntries: this.memoryCache.size,
      totalEntries,
      totalSize
    };
  }

  /**
   * Whether an in-flight write is old enough to be certainly abandoned.
   *
   * A file we cannot stat is treated as not stale: deleting on a failed stat
   * would turn a transient fs error into data loss for a write still in
   * progress.
   */
  private async isStaleTmp(file: string): Promise<boolean> {
    try {
      const { mtimeMs } = await fs.stat(path.join(this.cacheDir, file));
      return Date.now() - mtimeMs > TMP_WRITE_GRACE_MS;
    } catch {
      return false;
    }
  }

  /**
   * Reclaim everything on disk that can no longer be read back.
   *
   * Three populations, only one of which the LRU can see:
   *
   *  - expired entries, tracked or not. The scan is by directory listing, so
   *    an entry written under a cache key this build no longer constructs —
   *    every namespace changed shape in 5.0.0 — is reclaimed on its TTL like
   *    any other. It is orphaned, not immortal;
   *  - corrupt or schema-invalid entries, deleted on sight;
   *  - abandoned `.tmp` writes, which the old `.json` filter never matched and
   *    which nothing bounded before this.
   *
   * All three are recognised by name first (`ownFileKind`); a file with any
   * other name is never read, whatever it contains.
   *
   * Callers get the count so a startup sweep can say what it reclaimed.
   */
  async prune(): Promise<number> {
    let pruned = 0;

    // Prune memory cache
    for (const [key, entry] of this.memoryCache.entries()) {
      if (Date.now() - entry.timestamp > entry.ttl) {
        this.memoryCache.delete(key);
        this.lruRemove(key);
        pruned++;
      }
    }

    // Prune file cache
    try {
      const files = await fs.readdir(this.cacheDir);

      for (const file of files) {
        const kind = ownFileKind(file);
        // Not ours, whatever it contains. A file that fails the schema below
        // is only "corrupt" if we wrote it.
        if (kind === null) { continue; }
        if (kind === 'tmp-write') {
          if (await this.isStaleTmp(file)) {
            await fs.unlink(path.join(this.cacheDir, file)).catch(() => { /* raced */ });
            pruned++;
          }
          continue;
        }
        const filePath = path.join(this.cacheDir, file);
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          let raw: unknown;
          try {
            raw = JSON.parse(content);
          } catch {
            // Corrupt JSON — delete the file
            await fs.unlink(filePath);
            pruned++;
            continue;
          }

          const parsed = CacheEntrySchema.safeParse(raw);
          if (!parsed.success) {
            await fs.unlink(filePath);
            pruned++;
            continue;
          }

          const entry = parsed.data;
          if (Date.now() - entry.timestamp > entry.ttl) {
            await fs.unlink(filePath);
            pruned++;
          }
        } catch {
          // Skip files that cannot be read or unlinked
        }
      }
    } catch {
      // Directory may not exist
    }

    return pruned;
  }
}
