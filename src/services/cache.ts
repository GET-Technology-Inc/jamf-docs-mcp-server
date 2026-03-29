/**
 * Caching service for Jamf documentation
 *
 * Provides file-based caching with TTL support and LRU memory eviction
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';

import { z } from 'zod';
import { CACHE_TTL, CACHE_DIR, CACHE_MAX_ENTRIES } from '../constants.js';
import type { CacheEntry } from '../types.js';
import { createLogger } from './logging.js';

const log = createLogger('cache');

/**
 * Zod schema for validating cache entries read from disk
 */
export const CacheEntrySchema = z.object({
  data: z.unknown(),
  timestamp: z.number(),
  ttl: z.number()
});

/**
 * Doubly-linked list node for LRU tracking
 */
interface LruNode {
  key: string;
  prev: LruNode | null;
  next: LruNode | null;
}

/**
 * File-based cache implementation with LRU-bounded memory cache
 */
class FileCache {
  private readonly cacheDir: string;
  private readonly maxEntries: number;
  private readonly memoryCache = new Map<string, CacheEntry<unknown>>();
  private readonly lruMap = new Map<string, LruNode>();
  private readonly lruHead: LruNode = { key: '__head__', prev: null, next: null };
  private readonly lruTail: LruNode = { key: '__tail__', prev: null, next: null };
  private dirCreated = false;

  constructor(cacheDir: string = CACHE_DIR, maxEntries: number = CACHE_MAX_ENTRIES) {
    this.cacheDir = cacheDir;
    this.maxEntries = maxEntries;
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

  /**
   * Move a node to the front of the LRU list (most recently used)
   */
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

  /**
   * Add a key to the LRU list (at front)
   */
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

  /**
   * Remove a key from the LRU list
   */
  private lruRemove(key: string): void {
    const node = this.lruMap.get(key);
    if (node === undefined) { return; }
    if (node.prev !== null) { node.prev.next = node.next; }
    if (node.next !== null) { node.next.prev = node.prev; }
    node.prev = null;
    node.next = null;
    this.lruMap.delete(key);
  }

  /**
   * Evict the least recently used entry from memory cache
   */
  private lruEvictLeast(): void {
    const leastNode = this.lruTail.prev;
    if (leastNode === null || leastNode === this.lruHead) { return; }
    this.memoryCache.delete(leastNode.key);
    this.lruRemove(leastNode.key);
  }

  /**
   * Get a value from cache
   */
  async get<T>(key: string): Promise<T | null> {
    // Check memory cache first
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

    // Check file cache
    try {
      const cachePath = this.getCachePath(key);
      const content = await fs.readFile(cachePath, 'utf-8');
      const raw: unknown = JSON.parse(content);

      // Validate cache entry structure
      const parsed = CacheEntrySchema.safeParse(raw);
      if (!parsed.success) {
        await this.delete(key);
        return null;
      }

      const entry = parsed.data as CacheEntry<T>;

      // Check if expired
      if (Date.now() - entry.timestamp > entry.ttl) {
        await this.delete(key);
        return null;
      }

      // Store in memory cache with LRU eviction
      this.memoryCacheSet(key, entry);

      return entry.data;
    } catch {
      // File doesn't exist or is invalid
      return null;
    }
  }

  /**
   * Store in memory cache, evicting LRU entry if at capacity
   */
  private memoryCacheSet(key: string, entry: CacheEntry<unknown>): void {
    if (!this.memoryCache.has(key) && this.memoryCache.size >= this.maxEntries) {
      this.lruEvictLeast();
    }
    this.memoryCache.set(key, entry);
    this.lruAdd(key);
  }

  /**
   * Set a value in cache
   */
  async set(key: string, data: unknown, ttl: number = CACHE_TTL.ARTICLE_CONTENT): Promise<void> {
    await this.ensureCacheDir();

    const entry: CacheEntry<unknown> = {
      data,
      timestamp: Date.now(),
      ttl
    };

    // Store in memory with LRU
    this.memoryCacheSet(key, entry);

    // Store in file atomically (write to .tmp then rename)
    try {
      const cachePath = this.getCachePath(key);
      const tmpPath = `${cachePath}.tmp.${process.pid}`;
      await fs.writeFile(tmpPath, JSON.stringify(entry), 'utf-8');
      await fs.rename(tmpPath, cachePath);
    } catch (error) {
      // Log but don't fail
      log.error(`Failed to write cache: ${String(error)}`);
    }
  }

  /**
   * Delete a cache entry
   */
  async delete(key: string): Promise<void> {
    this.memoryCache.delete(key);
    this.lruRemove(key);
    await fs.unlink(this.getCachePath(key)).catch(() => { /* ignore if not exists */ });
  }

  /**
   * Clear all cache entries
   */
  async clear(): Promise<void> {
    this.memoryCache.clear();
    this.lruMap.clear();
    this.lruHead.next = this.lruTail;
    this.lruTail.prev = this.lruHead;
    try {
      const files = await fs.readdir(this.cacheDir);
      const jsonFiles = files.filter(f => f.endsWith('.json'));
      await Promise.all(
        jsonFiles.map(async f => { await fs.unlink(path.join(this.cacheDir, f)); })
      );
    } catch {
      // Directory may not exist
    }
  }

  /**
   * Get cache statistics
   */
  async stats(): Promise<{ memoryEntries: number; fileEntries: number; totalSize: number }> {
    let fileEntries = 0;
    let totalSize = 0;

    try {
      const files = await fs.readdir(this.cacheDir);
      const jsonFiles = files.filter(f => f.endsWith('.json'));
      fileEntries = jsonFiles.length;

      for (const file of jsonFiles) {
        const stat = await fs.stat(path.join(this.cacheDir, file));
        totalSize += stat.size;
      }
    } catch {
      // Directory may not exist
    }

    return {
      memoryEntries: this.memoryCache.size,
      fileEntries,
      totalSize
    };
  }

  /**
   * Prune expired entries
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

      for (const file of files.filter(f => f.endsWith('.json'))) {
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

// Export singleton instance
export const cache = new FileCache();
