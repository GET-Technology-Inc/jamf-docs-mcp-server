/**
 * Unit tests for LRU eviction logic in FileCache (src/services/cache.ts)
 *
 * FileCache is not directly exported; tests operate via the exported `cache`
 * singleton. fs/promises is fully mocked so no real disk I/O occurs.
 *
 * Coverage targets:
 *   - set/get round-trip (memory layer)
 *   - get() promotes entry to most-recently-used
 *   - Expired entries are removed on access (memory layer)
 *   - LRU eviction fires when maxEntries is reached (observable via stats)
 *   - delete() removes a single entry from memory and LRU list
 *   - clear() resets memory cache and LRU list to zero
 *   - stats() reflects memoryEntries accurately after mutations
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Mock fs/promises before any module under test is loaded.
vi.mock('fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
  writeFile: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue([]),
  stat: vi.fn().mockResolvedValue({ size: 0 }),
}));

import { FileCache } from '../../src/platforms/node/cache.js';
import { createDefaultConfig } from '../../src/core/config.js';
import { createMockLogger } from '../helpers/mock-context.js';

const CACHE_MAX_ENTRIES = createDefaultConfig().cache.maxEntries;
const cache = new FileCache({ maxEntries: CACHE_MAX_ENTRIES, log: createMockLogger() });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a unique key to avoid cross-test state leakage in the singleton. */
function uniqueKey(label: string): string {
  return `lru-test:${label}:${Math.random().toString(36).slice(2)}`;
}

/** Set N entries with a long TTL so they stay alive. Returns the keys in insertion order. */
async function fillCache(count: number, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  for (let i = 0; i < count; i++) {
    const key = `${prefix}:${i}`;
    await cache.set(key, i, 600_000);
    keys.push(key);
  }
  return keys;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LRU memory cache — basic set / get', () => {
  beforeEach(async () => {
    await cache.clear();
  });

  it('should return the stored value immediately after set', async () => {
    const key = uniqueKey('basic-set-get');
    await cache.set(key, { hello: 'world' }, 60_000);
    const result = await cache.get<{ hello: string }>(key);
    expect(result).toEqual({ hello: 'world' });
  });

  it('should store and retrieve a primitive string', async () => {
    const key = uniqueKey('string-value');
    await cache.set(key, 'jamf-pro', 60_000);
    expect(await cache.get<string>(key)).toBe('jamf-pro');
  });

  it('should store and retrieve a number', async () => {
    const key = uniqueKey('number-value');
    await cache.set(key, 42, 60_000);
    expect(await cache.get<number>(key)).toBe(42);
  });

  it('should store and retrieve a nested object', async () => {
    const key = uniqueKey('nested-object');
    const payload = { a: { b: [1, 2, 3] } };
    await cache.set(key, payload, 60_000);
    expect(await cache.get<typeof payload>(key)).toEqual(payload);
  });

  it('should return null for a key that was never set', async () => {
    const key = uniqueKey('never-set');
    expect(await cache.get<string>(key)).toBeNull();
  });

  it('should overwrite an existing entry when set is called twice with the same key', async () => {
    const key = uniqueKey('overwrite');
    await cache.set(key, 'first', 60_000);
    await cache.set(key, 'second', 60_000);
    expect(await cache.get<string>(key)).toBe('second');
  });
});

// ---------------------------------------------------------------------------

describe('LRU memory cache — TTL / expiry', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return null for an entry whose TTL has elapsed (memory layer)', async () => {
    const key = uniqueKey('expired-mem');
    const now = 1_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);

    await cache.set(key, 'alive', 500);

    // Advance past TTL — memory check uses strict `<` so elapsed === ttl is expired
    vi.spyOn(Date, 'now').mockReturnValue(now + 501);
    const result = await cache.get<string>(key);
    expect(result).toBeNull();
  });

  it('should return the value when elapsed time is strictly less than TTL', async () => {
    const key = uniqueKey('alive-mem');
    const now = 2_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);

    await cache.set(key, 'still-alive', 1_000);

    vi.spyOn(Date, 'now').mockReturnValue(now + 999); // 1 ms before expiry
    const result = await cache.get<string>(key);
    expect(result).toBe('still-alive');
  });

  it('should remove an expired entry from the LRU list on access', async () => {
    const key = uniqueKey('expired-removes-from-lru');
    const now = 3_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    await cache.set(key, 'data', 100);

    const statsBefore = await cache.stats();
    const countBefore = statsBefore.memoryEntries;

    vi.spyOn(Date, 'now').mockReturnValue(now + 200); // past TTL
    await cache.get<string>(key); // triggers eviction from memory + lruRemove

    const statsAfter = await cache.stats();
    // The expired entry must have been removed from memoryCache
    expect(statsAfter.memoryEntries).toBeLessThan(countBefore);
  });
});

// ---------------------------------------------------------------------------

describe('LRU memory cache — delete()', () => {
  beforeEach(async () => {
    await cache.clear();
  });

  it('should return null after a key is deleted', async () => {
    const key = uniqueKey('delete-returns-null');
    await cache.set(key, 'to-delete', 60_000);
    await cache.delete(key);
    expect(await cache.get<string>(key)).toBeNull();
  });

  it('should reduce memoryEntries count by one after delete', async () => {
    const key = uniqueKey('delete-reduces-count');
    await cache.set(key, 'value', 60_000);
    const before = (await cache.stats()).memoryEntries;

    await cache.delete(key);
    const after = (await cache.stats()).memoryEntries;

    expect(after).toBe(before - 1);
  });

  it('should not throw when deleting a key that does not exist', async () => {
    const key = uniqueKey('delete-nonexistent');
    await expect(cache.delete(key)).resolves.not.toThrow();
  });

  it('should leave other entries untouched after deleting one key', async () => {
    const keyA = uniqueKey('delete-sibling-a');
    const keyB = uniqueKey('delete-sibling-b');
    await cache.set(keyA, 'alpha', 60_000);
    await cache.set(keyB, 'beta', 60_000);

    await cache.delete(keyA);

    expect(await cache.get<string>(keyA)).toBeNull();
    expect(await cache.get<string>(keyB)).toBe('beta');
  });
});

// ---------------------------------------------------------------------------

describe('LRU memory cache — clear()', () => {
  it('should set memoryEntries to zero after clear', async () => {
    await cache.clear(); // start clean
    await cache.set(uniqueKey('c1'), 1, 60_000);
    await cache.set(uniqueKey('c2'), 2, 60_000);

    await cache.clear();
    const stats = await cache.stats();
    expect(stats.memoryEntries).toBe(0);
  });

  it('should make previously set keys return null after clear', async () => {
    const key = uniqueKey('cleared-key');
    await cache.set(key, 'persisted', 60_000);

    await cache.clear();
    expect(await cache.get<string>(key)).toBeNull();
  });

  it('should allow new entries to be added after clear', async () => {
    await cache.clear();
    const key = uniqueKey('after-clear');
    await cache.set(key, 'fresh', 60_000);
    expect(await cache.get<string>(key)).toBe('fresh');
  });
});

// ---------------------------------------------------------------------------

describe('LRU memory cache — stats() accuracy', () => {
  beforeEach(async () => {
    await cache.clear();
  });

  it('should report memoryEntries equal to the number of distinct keys set', async () => {
    const keys = await fillCache(5, 'stats-count');
    const stats = await cache.stats();
    // Because this is the shared singleton, other tests may have left entries.
    // We only assert that each key we set is accounted for; clearing ensures a clean baseline.
    expect(stats.memoryEntries).toBe(keys.length);
  });

  it('should not double-count when the same key is set twice', async () => {
    const key = uniqueKey('stats-double-count');
    await cache.set(key, 'v1', 60_000);
    await cache.set(key, 'v2', 60_000);

    const stats = await cache.stats();
    // Only one logical entry for this key
    expect(stats.memoryEntries).toBe(1);
  });

  it('should return memoryEntries as a non-negative integer', async () => {
    const stats = await cache.stats();
    expect(Number.isInteger(stats.memoryEntries)).toBe(true);
    expect(stats.memoryEntries).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------

describe('LRU memory cache — eviction at capacity', () => {
  afterEach(async () => {
    await cache.clear();
    vi.restoreAllMocks();
  });

  it('should not exceed CACHE_MAX_ENTRIES in the memory cache after filling beyond capacity', async () => {
    await cache.clear();
    // Insert one entry more than the configured limit
    const overflow = CACHE_MAX_ENTRIES + 1;
    await fillCache(overflow, 'eviction-capacity');

    const stats = await cache.stats();
    expect(stats.memoryEntries).toBeLessThanOrEqual(CACHE_MAX_ENTRIES);
  });

  it('should evict exactly one entry when adding the (maxEntries+1)-th unique key', async () => {
    await cache.clear();
    await fillCache(CACHE_MAX_ENTRIES, 'eviction-exact');

    const statsFull = await cache.stats();
    expect(statsFull.memoryEntries).toBe(CACHE_MAX_ENTRIES);

    // One more entry — this must trigger a single eviction
    await cache.set(uniqueKey('eviction-overflow'), 'overflow-value', 60_000);

    const statsAfter = await cache.stats();
    // Still at the cap (one evicted, one added)
    expect(statsAfter.memoryEntries).toBe(CACHE_MAX_ENTRIES);
  });

  it('should keep the most-recently-used entry when eviction occurs', async () => {
    await cache.clear();

    // Insert keys 0..maxEntries-1; key 0 is the oldest (LRU tail candidate)
    const keys = await fillCache(CACHE_MAX_ENTRIES, 'eviction-mru');

    // Promote key 0 to MRU by reading it — now the second-oldest is key 1
    await cache.get<number>(keys[0]);

    // Adding a new key must evict the current tail, which is key 1 (not key 0)
    const newKey = uniqueKey('eviction-mru-overflow');
    await cache.set(newKey, 'fresh', 60_000);

    // key 0 was recently used — it must still be in memory
    const result = await cache.get<number>(keys[0]);
    expect(result).not.toBeNull();
  });

  it('should evict the least-recently-used entry (LRU tail) on overflow', async () => {
    await cache.clear();

    // Insert maxEntries entries; key[0] is the first inserted → LRU tail
    const keys = await fillCache(CACHE_MAX_ENTRIES, 'eviction-lru-tail');

    // Do NOT access key[0] again — it remains the tail

    // Adding one more entry triggers eviction of the tail (key[0])
    await cache.set(uniqueKey('eviction-lru-tail-overflow'), 'new', 60_000);

    // key[0] should have been evicted from memory
    // File cache is mocked to throw ENOENT, so get() will return null
    const result = await cache.get<number>(keys[0]);
    expect(result).toBeNull();
  });

  it('should evict only one entry per insertion, not cascade-evict multiple', async () => {
    await cache.clear();
    await fillCache(CACHE_MAX_ENTRIES, 'eviction-single');

    // Add exactly one overflow entry
    await cache.set(uniqueKey('eviction-single-overflow'), 'x', 60_000);

    const stats = await cache.stats();
    // Exactly at the cap — not below it
    expect(stats.memoryEntries).toBe(CACHE_MAX_ENTRIES);
  });

  it('should allow inserting the same key at capacity without evicting any other key', async () => {
    await cache.clear();
    const keys = await fillCache(CACHE_MAX_ENTRIES, 'eviction-update');

    const statsBefore = await cache.stats();
    expect(statsBefore.memoryEntries).toBe(CACHE_MAX_ENTRIES);

    // Re-setting an existing key must NOT evict another entry
    await cache.set(keys[0], 'updated', 60_000);

    const statsAfter = await cache.stats();
    expect(statsAfter.memoryEntries).toBe(CACHE_MAX_ENTRIES);

    // The updated value is retrievable
    expect(await cache.get<string>(keys[0])).toBe('updated');
  });
});

// ---------------------------------------------------------------------------

describe('LRU memory cache — get() promotes to MRU', () => {
  afterEach(async () => {
    await cache.clear();
  });

  it('should keep an accessed entry alive when the cache is full and new entries are added', async () => {
    await cache.clear();

    // Fill to capacity; keys[0] is the LRU tail
    const keys = await fillCache(CACHE_MAX_ENTRIES, 'promote-mru');

    // Access keys[0] to move it to the MRU head
    await cache.get<number>(keys[0]);

    // Now add maxEntries more entries; keys[0] should survive all of them
    // because it keeps getting pushed away from the tail by each access here
    // (we just need one more entry to trigger eviction of the new tail)
    await cache.set(uniqueKey('promote-mru-extra'), 'extra', 60_000);

    // keys[0] is MRU — it must still be in cache
    const result = await cache.get<number>(keys[0]);
    expect(result).not.toBeNull();
  });

  it('should return the correct value after re-promotion via get', async () => {
    await cache.clear();
    const key = uniqueKey('re-promote');
    await cache.set(key, 'original', 60_000);

    // First get returns the value and promotes the entry
    const first = await cache.get<string>(key);
    // Second get should still return the same value
    const second = await cache.get<string>(key);

    expect(first).toBe('original');
    expect(second).toBe('original');
  });
});
