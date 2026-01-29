/**
 * Caching service for Jamf documentation
 *
 * Provides file-based caching with TTL support
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';

import { CACHE_TTL, CACHE_DIR } from '../constants.js';
import type { CacheEntry } from '../types.js';

/**
 * File-based cache implementation
 */
class FileCache {
  private readonly cacheDir: string;
  private readonly memoryCache = new Map<string, CacheEntry<unknown>>();

  constructor(cacheDir: string = CACHE_DIR) {
    this.cacheDir = cacheDir;
  }

  private static getCacheKey(key: string): string {
    return crypto.createHash('md5').update(key).digest('hex');
  }

  private getCachePath(key: string): string {
    return path.join(this.cacheDir, `${FileCache.getCacheKey(key)}.json`);
  }

  private async ensureCacheDir(): Promise<void> {
    await fs.mkdir(this.cacheDir, { recursive: true }).catch(() => { /* ignore if exists */ });
  }

  /**
   * Get a value from cache
   */
  async get<T>(key: string): Promise<T | null> {
    // Check memory cache first
    const memCached = this.memoryCache.get(key) as CacheEntry<T> | undefined;
    if (memCached !== undefined) {
      if (Date.now() - memCached.timestamp < memCached.ttl) {
        return memCached.data;
      }
      // Expired, remove from memory
      this.memoryCache.delete(key);
    }

    // Check file cache
    try {
      const cachePath = this.getCachePath(key);
      const content = await fs.readFile(cachePath, 'utf-8');
      const entry = JSON.parse(content) as CacheEntry<T>;

      // Check if expired
      if (Date.now() - entry.timestamp > entry.ttl) {
        await this.delete(key);
        return null;
      }

      // Store in memory cache for faster access
      this.memoryCache.set(key, entry);

      return entry.data;
    } catch {
      // File doesn't exist or is invalid
      return null;
    }
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

    // Store in memory
    this.memoryCache.set(key, entry);

    // Store in file
    try {
      const cachePath = this.getCachePath(key);
      await fs.writeFile(cachePath, JSON.stringify(entry), 'utf-8');
    } catch (error) {
      // Log but don't fail
      console.error(`[CACHE] Failed to write cache: ${String(error)}`);
    }
  }

  /**
   * Delete a cache entry
   */
  async delete(key: string): Promise<void> {
    this.memoryCache.delete(key);
    await fs.unlink(this.getCachePath(key)).catch(() => { /* ignore if not exists */ });
  }

  /**
   * Clear all cache entries
   */
  async clear(): Promise<void> {
    this.memoryCache.clear();
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
        pruned++;
      }
    }

    // Prune file cache
    try {
      const files = await fs.readdir(this.cacheDir);

      for (const file of files.filter(f => f.endsWith('.json'))) {
        try {
          const filePath = path.join(this.cacheDir, file);
          const content = await fs.readFile(filePath, 'utf-8');
          const entry = JSON.parse(content) as CacheEntry<unknown>;

          if (Date.now() - entry.timestamp > entry.ttl) {
            await fs.unlink(filePath);
            pruned++;
          }
        } catch {
          // Skip invalid files
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
