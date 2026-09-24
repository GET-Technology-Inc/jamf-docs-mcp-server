/**
 * Unit tests for cache service
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock fs/promises before any imports that use it.
//
// The mocks are typed to the overloads FileCache actually calls, not to the
// widest signature of each fs function: it reads with `readFile(path, 'utf-8')`
// (a string, not a Buffer), lists with `readdir(dir)` (plain names, not
// Dirent[]), and touches only `.size` on a stat result. `vi.mocked()` on the
// real module resolves an overloaded function to its last signature instead,
// which is why every string fixture below used to need an `as unknown as
// Buffer` cast to type-check — a cast that described the opposite of what the
// code under test receives.
const fs = vi.hoisted(() => ({
  mkdir: vi.fn<(path: string, options?: { recursive?: boolean }) => Promise<string | undefined>>()
    .mockResolvedValue(undefined),
  readFile: vi.fn<(path: string, encoding: 'utf-8') => Promise<string>>(),
  writeFile: vi.fn<(path: string, data: string, encoding: 'utf-8') => Promise<void>>()
    .mockResolvedValue(undefined),
  unlink: vi.fn<(path: string) => Promise<void>>().mockResolvedValue(undefined),
  readdir: vi.fn<(path: string) => Promise<string[]>>().mockResolvedValue([]),
  // `mtimeMs` as well as `size`: prune() dates abandoned `.tmp` writes by it,
  // and a mock without it makes that branch untestable.
  stat: vi.fn<(path: string) => Promise<{ size: number; mtimeMs: number }>>(),
  // `set()` writes to `<path>.tmp.<pid>` and renames it into place. Without a
  // `rename` mock every write threw "No \"rename\" export is defined on the
  // \"fs/promises\" mock", and `set()` catches and logs rather than rethrowing —
  // so every disk write in this file silently failed while the memory cache
  // carried the assertions. See the round-trip test at the bottom.
  rename: vi.fn<(from: string, to: string) => Promise<void>>().mockResolvedValue(undefined)
}));

vi.mock('fs/promises', () => fs);

// Import after mocks are set up
// FileCache is in platforms/node
import { FileCache } from '../../../src/platforms/node/cache.js';
import { createMockLogger } from '../../helpers/mock-context.js';

const cache = new FileCache({ log: createMockLogger() });

/**
 * A file name the cache itself would write: `<sha256 hex>.json`.
 *
 * Since 2026-09-24 FileCache counts and deletes only names of that shape, so a
 * fixture called `abc123.json` is now someone else's file, which it must leave
 * alone. The digit just keeps names within one test apart.
 */
const entryFile = (digit: string): string => `${digit.repeat(64)}.json`;

// ============================================================================
// Concurrent access tests
// ============================================================================

describe('concurrent access', () => {
  beforeEach(() => {
    fs.writeFile.mockResolvedValue(undefined);
    fs.mkdir.mockResolvedValue(undefined);
    fs.readFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    fs.unlink.mockResolvedValue(undefined);
  });

  it('should handle concurrent set operations on the same key without throwing', async () => {
    const key = 'concurrent:set:same-key';
    const writes = Array.from({ length: 10 }, async (_, i) =>
      { await cache.set(key, { value: i }, 60000); }
    );
    await expect(Promise.all(writes)).resolves.not.toThrow();
  });

  it('should return a value after concurrent sets on the same key', async () => {
    const key = 'concurrent:set:read-after';
    const writes = Array.from({ length: 5 }, async (_, i) =>
      { await cache.set(key, { value: i }, 60000); }
    );
    await Promise.all(writes);
    // Memory cache should hold the last write
    const result = await cache.get<{ value: number }>(key);
    expect(result).not.toBeNull();
    expect(typeof result!.value).toBe('number');
  });

  it('should handle concurrent get operations on the same key without throwing', async () => {
    const key = 'concurrent:get:same-key';
    await cache.set(key, 'shared-value', 60000);
    const reads = Array.from({ length: 10 }, async () =>
      await cache.get<string>(key)
    );
    const results = await Promise.all(reads);
    // All reads should return the cached value consistently
    for (const r of results) {
      expect(r).toBe('shared-value');
    }
  });

  it('should handle concurrent delete operations on the same key without throwing', async () => {
    const key = 'concurrent:delete:same-key';
    await cache.set(key, 'to-be-deleted', 60000);
    const deletes = Array.from({ length: 5 }, async () => await cache.delete(key));
    await expect(Promise.all(deletes)).resolves.not.toThrow();
  });

  it('should handle interleaved set and get on the same key without throwing', async () => {
    const key = 'concurrent:interleaved:key';
    const ops = [
      cache.set(key, 'val-a', 60000),
      cache.get<string>(key),
      cache.set(key, 'val-b', 60000),
      cache.get<string>(key),
      cache.delete(key),
      cache.get<string>(key)
    ];
    await expect(Promise.all(ops)).resolves.not.toThrow();
  });
});

// ============================================================================
// Disk error handling tests
// ============================================================================

describe('disk error handling', () => {
  beforeEach(() => {
    fs.mkdir.mockResolvedValue(undefined);
    fs.unlink.mockResolvedValue(undefined);
  });

  it('should not throw when writeFile rejects with ENOSPC', async () => {
    const enospc = Object.assign(new Error('no space left on device'), { code: 'ENOSPC' });
    fs.writeFile.mockRejectedValue(enospc);

    const key = 'disk-error:enospc:write';
    await expect(cache.set(key, { data: 'test' }, 60000)).resolves.not.toThrow();
  });

  it('should still store value in memory cache even when file write fails', async () => {
    const enospc = Object.assign(new Error('no space left on device'), { code: 'ENOSPC' });
    fs.writeFile.mockRejectedValue(enospc);

    const key = 'disk-error:enospc:memory-fallback';
    await cache.set(key, 'memory-only-value', 60000);

    // Memory cache should still work; get will return the in-memory value
    // (file read won't be hit because memory cache is checked first)
    const result = await cache.get<string>(key);
    expect(result).toBe('memory-only-value');
  });

  it('should return null when readFile rejects with EACCES', async () => {
    // Make memory cache miss by using a key not previously set
    const key = `disk-error:eacces:read-unique-${  Date.now()}`;

    const eacces = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    fs.readFile.mockRejectedValue(eacces);
    fs.writeFile.mockResolvedValue(undefined);

    const result = await cache.get<string>(key);
    expect(result).toBeNull();
  });

  it('should not throw when readFile rejects with EACCES', async () => {
    const key = `disk-error:eacces:no-throw-unique-${  Date.now()  }-b`;
    const eacces = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    fs.readFile.mockRejectedValue(eacces);

    await expect(cache.get<string>(key)).resolves.not.toThrow();
  });

  it('should not throw when writeFile rejects with EPERM', async () => {
    const eperm = Object.assign(new Error('operation not permitted'), { code: 'EPERM' });
    fs.writeFile.mockRejectedValue(eperm);

    const key = 'disk-error:eperm:write';
    await expect(cache.set(key, 'value', 60000)).resolves.not.toThrow();
  });
});

// ============================================================================
// TTL boundary tests
// ============================================================================

describe('TTL boundary behavior', () => {
  beforeEach(() => {
    fs.mkdir.mockResolvedValue(undefined);
    fs.writeFile.mockResolvedValue(undefined);
    fs.unlink.mockResolvedValue(undefined);
  });

  it('should return data from memory cache when elapsed time is less than TTL', async () => {
    const key = 'ttl:boundary:mem-active';
    const ttl = 10000;

    // Set entry; timestamp will be Date.now() at time of set
    await cache.set(key, 'alive', ttl);

    // Elapsed is 0ms — well within TTL
    const result = await cache.get<string>(key);
    expect(result).toBe('alive');
  });

  it('should return null from memory cache when elapsed equals TTL (strict < comparison)', async () => {
    // Source: line 44 uses Date.now() - memCached.timestamp < memCached.ttl
    // When elapsed === ttl, the condition is false → returns null
    const key = 'ttl:boundary:mem-exactly-equal';
    const ttl = 1000;
    const now = Date.now();

    // Manually inject an entry with timestamp such that elapsed === ttl
    // We do this by calling set() and then faking Date.now
    vi.spyOn(Date, 'now').mockReturnValue(now);
    await cache.set(key, 'boundary-mem', ttl);

    // Advance time by exactly ttl — now elapsed === ttl
    vi.spyOn(Date, 'now').mockReturnValue(now + ttl);

    const result = await cache.get<string>(key);
    // Memory cache uses strict `<`, so elapsed === ttl → expired → null
    // (File cache fallback will also not find valid data because it uses `>`,
    //  meaning at exactly equal it would NOT expire — but since the write
    //  was mocked out, readFile will throw, so we still get null)
    expect(result).toBeNull();

    vi.restoreAllMocks();
  });

  it('documents asymmetric TTL boundary: memory cache expires AT ttl, file cache does NOT expire AT ttl', async () => {
    // This test documents the behavioral difference between the two cache layers:
    // - Memory cache (line 44): Date.now() - timestamp < ttl  → at equal, EXPIRED
    // - File cache   (line 58): Date.now() - timestamp > ttl  → at equal, NOT expired
    //
    // This is a documented asymmetry / potential bug. The test captures current behavior.

    const ttl = 1000;
    const now = Date.now();
    const entry = { data: 'file-boundary-data', timestamp: now, ttl };

    const fileEntryJson = JSON.stringify(entry);

    vi.spyOn(Date, 'now').mockReturnValue(now + ttl); // elapsed === ttl

    // Simulate: memory cache miss (key not set), file cache has the entry
    const key = `ttl:boundary:asymmetry-${  now}`;
    fs.readFile.mockResolvedValue(fileEntryJson);
    fs.writeFile.mockResolvedValue(undefined);

    // At elapsed === ttl:
    // - Memory: not in memory (never set in this test)
    // - File: uses `>`, so elapsed === ttl is NOT > ttl → data returned
    const result = await cache.get<string>(key);

    // File cache returns the data (not expired at exact boundary)
    expect(result).toBe('file-boundary-data');

    vi.restoreAllMocks();
  });

  it('should expire file cache entry when elapsed is strictly greater than TTL', async () => {
    const ttl = 1000;
    const now = Date.now();
    const entry = { data: 'stale-file-data', timestamp: now, ttl };

    vi.spyOn(Date, 'now').mockReturnValue(now + ttl + 1); // elapsed > ttl

    const key = `ttl:boundary:file-expired-${  now}`;
    fs.readFile.mockResolvedValue(JSON.stringify(entry));
    fs.writeFile.mockResolvedValue(undefined);

    const result = await cache.get<string>(key);
    expect(result).toBeNull();

    vi.restoreAllMocks();
  });
});

// ============================================================================
// Schema validation edge cases
// ============================================================================

describe('schema validation edge cases', () => {
  beforeEach(() => {
    fs.mkdir.mockResolvedValue(undefined);
    fs.writeFile.mockResolvedValue(undefined);
    fs.unlink.mockResolvedValue(undefined);
  });

  it('should return null for valid JSON missing the timestamp field', async () => {
    const invalidEntry = JSON.stringify({ data: 'some-data', ttl: 60000 }); // no timestamp
    fs.readFile.mockResolvedValue(invalidEntry);

    const key = `schema:missing-timestamp-${  Date.now()}`;
    // CacheEntrySchema requires timestamp, so the entry never reaches the
    // NaN arithmetic this used to hand-wave about — safeParse rejects first.
    expect(await cache.get<unknown>(key)).toBeNull();
  });

  it('should return null for valid JSON missing the ttl field', async () => {
    const invalidEntry = JSON.stringify({ data: 'some-data', timestamp: Date.now() }); // no ttl
    fs.readFile.mockResolvedValue(invalidEntry);

    const key = `schema:missing-ttl-${  Date.now()}`;
    expect(await cache.get<unknown>(key)).toBeNull();
  });

  it('should return null for valid JSON missing the data field', async () => {
    const invalidEntry = JSON.stringify({ timestamp: Date.now(), ttl: 60000 }); // no data
    fs.readFile.mockResolvedValue(invalidEntry);

    const key = `schema:missing-data-${  Date.now()}`;
    const result = await cache.get<unknown>(key);
    // data is undefined; the cache returns undefined which is treated as "no value"
    // The test just verifies no exception is thrown and result is not an object with data
    expect(result === null || result === undefined).toBe(true);
  });

  it('should return null for completely invalid JSON in file', async () => {
    fs.readFile.mockResolvedValue('not-valid-json{{{');

    const key = `schema:invalid-json-${  Date.now()}`;
    const result = await cache.get<unknown>(key);
    expect(result).toBeNull();
  });

  it('should return null for valid JSON that is an array instead of an object', async () => {
    fs.readFile.mockResolvedValue('[1, 2, 3]');

    const key = `schema:json-array-${  Date.now()}`;
    expect(await cache.get<unknown>(key)).toBeNull();
  });

  it('should return null for valid JSON null value in file', async () => {
    fs.readFile.mockResolvedValue('null');

    const key = `schema:json-null-${  Date.now()}`;
    expect(await cache.get<unknown>(key)).toBeNull();
  });
});

// ============================================================================
// clear() tests
// ============================================================================

describe('clear()', () => {
  beforeEach(() => {
    fs.mkdir.mockResolvedValue(undefined);
    fs.writeFile.mockResolvedValue(undefined);
    fs.unlink.mockResolvedValue(undefined);
    fs.readdir.mockResolvedValue([]);
  });

  it('should clear memory cache so subsequent get returns null', async () => {
    fs.readFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    const key = `clear:mem-${  Date.now()}`;
    await cache.set(key, 'mem-value', 999999);

    await cache.clear();

    const result = await cache.get<string>(key);
    expect(result).toBeNull();
  });

  it('should delete JSON files found in the cache directory', async () => {
    const fileName1 = entryFile('a');
    const fileName2 = entryFile('b');
    fs.readdir.mockResolvedValue([fileName1, fileName2]);
    fs.unlink.mockResolvedValue(undefined);

    await cache.clear();

    const unlinked = fs.unlink.mock.calls.map(c => c[0]);
    expect(unlinked.some(p => p.endsWith(fileName1))).toBe(true);
    expect(unlinked.some(p => p.endsWith(fileName2))).toBe(true);
  });

  it('should not delete non-JSON files from the cache directory', async () => {
    fs.readdir.mockResolvedValue(['cache.json', 'readme.txt', 'data.csv']);
    fs.unlink.mockResolvedValue(undefined);

    await cache.clear();

    const unlinked = fs.unlink.mock.calls.map(c => c[0]);
    expect(unlinked.every(p => !p.endsWith('readme.txt') && !p.endsWith('data.csv'))).toBe(true);
  });

  it('should not throw when cache directory does not exist', async () => {
    fs.readdir.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    await expect(cache.clear()).resolves.not.toThrow();
  });

  it('should resolve successfully even when directory listing fails', async () => {
    fs.readdir.mockRejectedValue(new Error('permission denied'));

    await expect(cache.clear()).resolves.toBeUndefined();
  });
});

// ============================================================================
// stats() tests
// ============================================================================

describe('stats()', () => {
  beforeEach(() => {
    fs.readdir.mockResolvedValue([]);
    fs.stat.mockResolvedValue({ size: 0, mtimeMs: Date.now() });
  });

  it('should return fileEntries=0 and totalSize=0 for an empty directory', async () => {
    fs.readdir.mockResolvedValue([]);

    const stats = await cache.stats();
    expect(stats.totalEntries).toBe(0);
    expect(stats.totalSize).toBe(0);
  });

  it('should count only JSON files in the directory', async () => {
    fs.readdir.mockResolvedValue([entryFile('a'), entryFile('b'), 'c.txt']);
    fs.stat.mockResolvedValue({ size: 512, mtimeMs: Date.now() });

    const stats = await cache.stats();
    expect(stats.totalEntries).toBe(2);
  });

  it('should sum file sizes for all JSON files', async () => {
    fs.readdir.mockResolvedValue([entryFile('a'), entryFile('b')]);
    fs.stat.mockResolvedValue({ size: 1024, mtimeMs: Date.now() });

    const stats = await cache.stats();
    expect(stats.totalSize).toBe(2048); // 2 * 1024
  });

  it('should return memoryEntries as a non-negative number', async () => {
    const stats = await cache.stats();
    expect(typeof stats.memoryEntries).toBe('number');
    expect(stats.memoryEntries).toBeGreaterThanOrEqual(0);
  });

  it('should return zeros when directory does not exist (readdir throws)', async () => {
    fs.readdir.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    const stats = await cache.stats();
    expect(stats.totalEntries).toBe(0);
    expect(stats.totalSize).toBe(0);
  });
});

// ============================================================================
// prune() tests
// ============================================================================

describe('prune()', () => {
  beforeEach(() => {
    fs.readdir.mockResolvedValue([]);
    fs.readFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    fs.unlink.mockResolvedValue(undefined);
    fs.writeFile.mockResolvedValue(undefined);
    fs.mkdir.mockResolvedValue(undefined);
  });

  it('should return a non-negative number (count of pruned entries)', async () => {
    const pruned = await cache.prune();
    expect(typeof pruned).toBe('number');
    expect(pruned).toBeGreaterThanOrEqual(0);
  });

  it('should prune expired file cache entries and delete them', async () => {
    const expiredEntry = {
      data: 'expired-data',
      timestamp: Date.now() - 999999,
      ttl: 1000
    };
    fs.readdir.mockResolvedValue([entryFile('e')]);
    fs.readFile.mockResolvedValue(JSON.stringify(expiredEntry));

    const pruned = await cache.prune();
    expect(pruned).toBeGreaterThan(0);
    const unlinkedPaths = fs.unlink.mock.calls.map(c => c[0]);
    expect(unlinkedPaths.some(p => p.endsWith(entryFile('e')))).toBe(true);
  });

  it('should NOT prune fresh file cache entries', async () => {
    const freshEntry = {
      data: 'fresh-data',
      timestamp: Date.now(),
      ttl: 999999
    };
    fs.readdir.mockResolvedValue([entryFile('f')]);
    fs.readFile.mockResolvedValue(JSON.stringify(freshEntry));
    fs.unlink.mockClear();

    await cache.prune();

    const unlinkedPaths = fs.unlink.mock.calls.map(c => c[0]);
    expect(unlinkedPaths.some(p => p.endsWith(entryFile('f')))).toBe(false);
  });

  it('should prune corrupt (invalid JSON) file cache entries', async () => {
    fs.readdir.mockResolvedValue([entryFile('c')]);
    fs.readFile.mockResolvedValue('{{invalid-json}}');

    const pruned = await cache.prune();
    expect(pruned).toBeGreaterThan(0);
  });

  it('should prune file entries with invalid schema (missing required fields)', async () => {
    const invalidEntry = { foo: 'bar' }; // no timestamp/ttl/data
    fs.readdir.mockResolvedValue([entryFile('d')]);
    fs.readFile.mockResolvedValue(JSON.stringify(invalidEntry));

    const pruned = await cache.prune();
    expect(pruned).toBeGreaterThan(0);
  });

  it('should not throw when directory does not exist during prune', async () => {
    fs.readdir.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    await expect(cache.prune()).resolves.not.toThrow();
  });

  it('should prune expired memory cache entries when time is advanced', async () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    fs.mkdir.mockResolvedValue(undefined);
    fs.writeFile.mockResolvedValue(undefined);

    const key = `prune:expired-mem-${  now}`;
    await cache.set(key, 'old-value', 100); // TTL = 100ms

    // Advance time well past TTL so this entry expires
    vi.spyOn(Date, 'now').mockReturnValue(now + 100000);
    fs.readdir.mockResolvedValue([]);

    const pruned = await cache.prune();
    expect(pruned).toBeGreaterThanOrEqual(1);

    vi.restoreAllMocks();
  });
});

// ============================================================================
// Cache directory creation
// ============================================================================

describe('cache directory creation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fs.mkdir.mockResolvedValue(undefined);
    fs.writeFile.mockResolvedValue(undefined);
    fs.rename.mockResolvedValue(undefined);
  });

  it('should say once why the directory cannot be created, and keep trying', async () => {
    // What cwd `/` on macOS gives the default `.cache` (measured 2026-09-24).
    // mkdir's error used to be swallowed as "ignore if exists" and the
    // directory marked created, so it was never tried again.
    const log = createMockLogger();
    const isolated = new FileCache({ cacheDir: '/.cache', log });
    const enoent = Object.assign(new Error("ENOENT: no such file or directory, mkdir '/.cache'"), { code: 'ENOENT' });
    fs.mkdir.mockRejectedValue(enoent);

    await isolated.set('dir:one', 1, 60000);
    await isolated.set('dir:two', 2, 60000);

    const dirErrors = vi.mocked(log.error).mock.calls.map(([m]) => String(m))
      .filter(m => m.includes('Cannot create cache directory'));
    expect(dirErrors).toHaveLength(1);
    expect(dirErrors[0]).toContain('"/.cache"');
    expect(dirErrors[0]).toContain('ENOENT');

    // Tried again on the next write, and once it succeeds, not again.
    fs.mkdir.mockResolvedValue(undefined);
    await isolated.set('dir:three', 3, 60000);
    await isolated.set('dir:four', 4, 60000);
    expect(fs.mkdir).toHaveBeenCalledTimes(3);
    // Memory still serves every value.
    expect(await isolated.get<number>('dir:one')).toBe(1);
  });

  it('should stay quiet when the directory already exists', async () => {
    // recursive: true resolves for an existing directory; nothing to report.
    const log = createMockLogger();
    const isolated = new FileCache({ log });

    await isolated.set('dir:existing:a', 'a', 60000);
    await isolated.set('dir:existing:b', 'b', 60000);

    expect(log.error).not.toHaveBeenCalled();
    expect(fs.mkdir).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// Atomic-write round trip
// ============================================================================

describe('atomic disk write', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fs.mkdir.mockResolvedValue(undefined);
    fs.writeFile.mockResolvedValue(undefined);
    fs.rename.mockResolvedValue(undefined);
  });

  it('should complete the write-then-rename without logging a failure', async () => {
    const log = createMockLogger();
    const isolated = new FileCache({ log });

    await isolated.set('atomic:round-trip', { hello: 'world' }, 60000);

    // Regression guard. `set()` catches everything and only logs, so a missing
    // fs mock made this whole file assert against the memory cache alone while
    // every disk write failed. Asserting the logger stayed quiet is what makes
    // the mock's completeness observable.
    expect(log.error).not.toHaveBeenCalled();

    expect(fs.writeFile).toHaveBeenCalledTimes(1);
    expect(fs.rename).toHaveBeenCalledTimes(1);

    const [tmpPath, payload] = fs.writeFile.mock.calls[0];
    const [renameFrom, renameTo] = fs.rename.mock.calls[0];

    // Written to a pid-scoped temp path, then moved into place — two
    // concurrent processes must never share the same in-flight file.
    expect(tmpPath).toContain(`.tmp.${process.pid}`);
    expect(renameFrom).toBe(tmpPath);
    expect(renameTo).toBe(tmpPath.split('.tmp.')[0]);
    expect(JSON.parse(payload).data).toEqual({ hello: 'world' });
  });
});

// ============================================================================
// Orphan and abandoned-write reclamation
// ============================================================================

describe('prune reclamation', () => {
  const hash = 'a'.repeat(64);

  beforeEach(() => {
    vi.clearAllMocks();
    fs.mkdir.mockResolvedValue(undefined);
    fs.writeFile.mockResolvedValue(undefined);
    fs.rename.mockResolvedValue(undefined);
    fs.unlink.mockResolvedValue(undefined);
  });

  it('should reclaim an expired entry it never tracked in memory', async () => {
    // The orphan case from #248: written under a cache key this build no
    // longer constructs, so nothing will ever `get()` it and the LRU — which
    // only knows keys it put in memory itself — cannot evict it. prune()
    // lists the directory, so it reaches the file anyway.
    const isolated = new FileCache({ log: createMockLogger() });
    fs.readdir.mockResolvedValue([`${hash}.json`]);
    fs.readFile.mockResolvedValue(
      JSON.stringify({ data: 'orphan', timestamp: Date.now() - 90_000, ttl: 60_000 })
    );

    expect(await isolated.prune()).toBe(1);
    expect(fs.unlink).toHaveBeenCalledWith(expect.stringContaining(`${hash}.json`));
  });

  it('should keep an unexpired entry it never tracked in memory', async () => {
    const isolated = new FileCache({ log: createMockLogger() });
    fs.readdir.mockResolvedValue([`${hash}.json`]);
    fs.readFile.mockResolvedValue(
      JSON.stringify({ data: 'orphan', timestamp: Date.now(), ttl: 60_000 })
    );

    expect(await isolated.prune()).toBe(0);
    expect(fs.unlink).not.toHaveBeenCalled();
  });

  it('should reclaim a .tmp write left behind by a dead process', async () => {
    const isolated = new FileCache({ log: createMockLogger() });
    fs.readdir.mockResolvedValue([`${hash}.json.tmp.99999`]);
    fs.stat.mockResolvedValue({ size: 12, mtimeMs: Date.now() - 2 * 60 * 60 * 1000 });

    expect(await isolated.prune()).toBe(1);
    expect(fs.unlink).toHaveBeenCalledWith(expect.stringContaining('.json.tmp.99999'));
  });

  it('should leave a .tmp write from an in-flight save alone', async () => {
    const isolated = new FileCache({ log: createMockLogger() });
    fs.readdir.mockResolvedValue([`${hash}.json.tmp.${process.pid}`]);
    fs.stat.mockResolvedValue({ size: 12, mtimeMs: Date.now() });

    expect(await isolated.prune()).toBe(0);
    expect(fs.unlink).not.toHaveBeenCalled();
  });

  it('should leave a .tmp write alone when it cannot be stat-ed', async () => {
    // A failed stat must not become data loss for a write still in progress.
    const isolated = new FileCache({ log: createMockLogger() });
    fs.readdir.mockResolvedValue([`${hash}.json.tmp.4242`]);
    fs.stat.mockRejectedValue(Object.assign(new Error('EIO'), { code: 'EIO' }));

    expect(await isolated.prune()).toBe(0);
    expect(fs.unlink).not.toHaveBeenCalled();
  });

  it('should ignore directory entries that are neither entries nor our writes', async () => {
    const isolated = new FileCache({ log: createMockLogger() });
    fs.readdir.mockResolvedValue(['README.md', 'nested', `${hash}.json.tmp.notapid`]);

    expect(await isolated.prune()).toBe(0);
    expect(fs.unlink).not.toHaveBeenCalled();
  });

  it('should reclaim an expired md5-named entry left by v1.0.0 or v1.1.0', async () => {
    // Those versions named entries `<md5 hex>.json`, 32 digits. They are the
    // oldest orphans on disk, so the name filter must keep reaching them.
    const isolated = new FileCache({ log: createMockLogger() });
    const md5 = 'b'.repeat(32);
    fs.readdir.mockResolvedValue([`${md5}.json`]);
    fs.readFile.mockResolvedValue(
      JSON.stringify({ data: 'v1.1.0', timestamp: Date.now() - 90_000, ttl: 60_000 })
    );

    expect(await isolated.prune()).toBe(1);
    expect(fs.unlink).toHaveBeenCalledWith(expect.stringContaining(`${md5}.json`));
  });

  // Names the cache has never written. The first three are what the startup
  // sweep deleted on 2026-09-24 with CACHE_DIR pointed at a project root and
  // at a directory shared with another tool; the rest are near misses.
  const FOREIGN = [
    'package.json',
    'tsconfig.json',
    'other-tool.json',
    `${'a'.repeat(63)}.json`,
    `${'a'.repeat(65)}.json`,
    `${'a'.repeat(40)}.json`,
    `${'A'.repeat(64)}.json`,
    `x${hash}.json`,
    `${hash}.json.bak`,
    // md5 names predate the .tmp write, so no such file was ever ours.
    `${'b'.repeat(32)}.json.tmp.1234`,
  ];

  it('should never read or delete a file it did not write, even one shaped like an expired entry', async () => {
    const isolated = new FileCache({ log: createMockLogger() });
    fs.readdir.mockResolvedValue(FOREIGN);
    // Every read would come back as an expired, schema-valid entry, and the
    // .tmp look-alike is hours old: only the name keeps them.
    fs.readFile.mockResolvedValue(JSON.stringify({ data: 'theirs', timestamp: 0, ttl: 1 }));
    fs.stat.mockResolvedValue({ size: 12, mtimeMs: Date.now() - 2 * 60 * 60 * 1000 });

    expect(await isolated.prune()).toBe(0);
    expect(fs.readFile).not.toHaveBeenCalled();
    expect(fs.unlink).not.toHaveBeenCalled();
  });

  it('should leave files it did not write in place on clear()', async () => {
    const isolated = new FileCache({ log: createMockLogger() });
    fs.readdir.mockResolvedValue([...FOREIGN, `${hash}.json`]);

    await isolated.clear();

    expect(fs.unlink.mock.calls.map(([p]) => p)).toEqual([expect.stringContaining(`${hash}.json`)]);
  });

  it('should count only its own entries in stats()', async () => {
    const isolated = new FileCache({ log: createMockLogger() });
    fs.readdir.mockResolvedValue([...FOREIGN, `${hash}.json`, `${'b'.repeat(32)}.json`]);
    fs.stat.mockResolvedValue({ size: 100, mtimeMs: Date.now() });

    const stats = await isolated.stats();
    expect(stats.totalEntries).toBe(2);
    expect(stats.totalSize).toBe(200);
  });

  it('should remove abandoned .tmp writes on clear()', async () => {
    const isolated = new FileCache({ log: createMockLogger() });
    fs.readdir.mockResolvedValue([`${hash}.json`, `${hash}.json.tmp.777`, 'unrelated.txt']);

    await isolated.clear();

    const removed = fs.unlink.mock.calls.map(([p]) => p);
    expect(removed).toHaveLength(2);
    expect(removed.some(p => p.endsWith(`${hash}.json`))).toBe(true);
    expect(removed.some(p => p.endsWith('.json.tmp.777'))).toBe(true);
    expect(removed.some(p => p.endsWith('unrelated.txt'))).toBe(false);
  });
});
