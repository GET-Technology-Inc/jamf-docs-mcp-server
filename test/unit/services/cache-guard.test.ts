/**
 * `guardCache`, the one way core reads and writes an injected CacheProvider:
 * what it makes of each thing a provider can do, which object guards which
 * provider, and where it logs.
 *
 * What each tool and resource replies over a failing cache is in
 * test/unit/tools/cache-provider-faults.test.ts.
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { guardCache } from '../../../src/core/services/cache-guard.js';
import { cacheKey } from '../../../src/core/services/cache-key.js';
import { createMcpServer } from '../../../src/core/create-server.js';
import { MapsRegistry } from '../../../src/core/services/maps-registry.js';
import { TopicResolver } from '../../../src/core/services/topic-resolver.js';
import { FileCache } from '../../../src/platforms/node/cache.js';
import type { CacheProvider, Logger, LoggerFactory } from '../../../src/core/services/interfaces/index.js';
import type { FtMapInfo } from '../../../src/core/types.js';
import { createMockCache, createMockContext, createMockLogger } from '../../helpers/mock-context.js';

/** A key whose payload is a query, which the log must not carry. */
const SEARCH_KEY = cacheKey('ft-search-v3', {
  query: 'setup manager', contentLocale: 'en-US', sortId: 'relevance', perPage: 50, page: 1, filters: [],
});
const TOPICS_KEY = cacheKey('metadata-topics');

const KV_DOWN = new Error('KV GET failed: 503 Service Unavailable');

/** A logger factory that keeps every warning, by logger name. */
function recordingLoggers(): { loggers: LoggerFactory; warnings: string[]; created: string[] } {
  const warnings: string[] = [];
  const created: string[] = [];
  return {
    warnings,
    created,
    loggers: {
      createLogger: (name: string): Logger => {
        created.push(name);
        return { ...createMockLogger(), warning: (m: unknown) => { warnings.push(`[${name}] ${String(m)}`); } };
      },
    },
  };
}

/** A guard over `cache` that logs into the returned list. */
function guarded(cache: CacheProvider): { guard: CacheProvider; warnings: string[] } {
  const { loggers, warnings } = recordingLoggers();
  return { guard: guardCache(cache, loggers), warnings };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('get', () => {
  it('reads a read that rejects as a miss, and says which cache failed, not what was looked up', async () => {
    const cache = createMockCache();
    vi.mocked(cache.get).mockRejectedValue(KV_DOWN);
    const { guard, warnings } = guarded(cache);

    await expect(guard.get(SEARCH_KEY)).resolves.toBeNull();

    expect(warnings).toEqual([
      '[cache] Cache read failed (ft-search-v3), read as a miss: Error: KV GET failed: 503 Service Unavailable',
    ]);
  });

  it('reads a read that throws without a promise as a miss', async () => {
    const cache = createMockCache();
    vi.mocked(cache.get).mockImplementation(() => { throw KV_DOWN; });
    const { guard, warnings } = guarded(cache);

    await expect(guard.get(TOPICS_KEY)).resolves.toBeNull();

    expect(warnings).toEqual([
      '[cache] Cache read failed (metadata-topics), read as a miss: Error: KV GET failed: 503 Service Unavailable',
    ]);
  });

  it('reads a rejection that is not an Error as a miss', async () => {
    const cache = createMockCache();
    vi.mocked(cache.get).mockRejectedValue(undefined);
    const { guard, warnings } = guarded(cache);

    await expect(guard.get(TOPICS_KEY)).resolves.toBeNull();
    expect(warnings).toEqual(['[cache] Cache read failed (metadata-topics), read as a miss: undefined']);
  });

  it('reads undefined as a miss, and does not log it: it is how a Map says "no such key"', async () => {
    const cache = createMockCache();
    vi.mocked(cache.get).mockResolvedValue(undefined);
    const { guard, warnings } = guarded(cache);

    await expect(guard.get(TOPICS_KEY)).resolves.toBeNull();
    expect(warnings).toEqual([]);
  });

  it.each([0, '', false, [], {}])('hands back a stored %j as it is', async (value) => {
    const cache = createMockCache();
    const { guard } = guarded(cache);
    await guard.set(TOPICS_KEY, value);

    await expect(guard.get(TOPICS_KEY)).resolves.toEqual(value);
  });

  it('hands back what the provider holds, the same object', async () => {
    const value = { products: [], degraded: false };
    const cache = createMockCache();
    vi.mocked(cache.get).mockResolvedValue(value);

    await expect(guardCache(cache).get(TOPICS_KEY)).resolves.toBe(value);
  });
});

describe('set', () => {
  it('goes on when a write rejects, and says which cache it could not write', async () => {
    const cache = createMockCache();
    vi.mocked(cache.set).mockRejectedValue(new Error('KV PUT failed: 429 Too Many Requests'));
    const { guard, warnings } = guarded(cache);

    await expect(guard.set(SEARCH_KEY, [], 1000)).resolves.toBeUndefined();

    expect(warnings).toEqual([
      '[cache] Cache write failed (ft-search-v3), the reply goes on without it: ' +
      'Error: KV PUT failed: 429 Too Many Requests',
    ]);
  });

  it('goes on when a write throws without a promise', async () => {
    const cache = createMockCache();
    vi.mocked(cache.set).mockImplementation(() => { throw new Error('quota exceeded'); });
    const { guard, warnings } = guarded(cache);

    await expect(guard.set(TOPICS_KEY, [])).resolves.toBeUndefined();
    expect(warnings).toHaveLength(1);
  });

  it('passes the TTL only when the caller gave one', async () => {
    const cache = createMockCache();
    const guard = guardCache(cache);

    await guard.set(TOPICS_KEY, 'a');
    await guard.set(TOPICS_KEY, 'b', 5000);

    expect(vi.mocked(cache.set).mock.calls).toEqual([[TOPICS_KEY, 'a'], [TOPICS_KEY, 'b', 5000]]);
  });
});

describe('delete', () => {
  it('answers false when the provider fails, as for a key that was not there', async () => {
    const cache = createMockCache();
    vi.mocked(cache.delete).mockRejectedValue(new Error('KV DELETE failed'));
    const { guard, warnings } = guarded(cache);

    await expect(guard.delete(TOPICS_KEY)).resolves.toBe(false);
    expect(warnings).toEqual(['[cache] Cache delete failed (metadata-topics): Error: KV DELETE failed']);
  });

  it('answers what the provider answers', async () => {
    const cache = createMockCache();
    const guard = guardCache(cache);
    await guard.set(TOPICS_KEY, 1);

    await expect(guard.delete(TOPICS_KEY)).resolves.toBe(true);
    await expect(guard.delete(TOPICS_KEY)).resolves.toBe(false);
  });
});

describe('clear, stats and prune', () => {
  it('are the provider\'s own, failures included: core calls none of them', async () => {
    const cache = createMockCache();
    vi.mocked(cache.stats).mockResolvedValue({ memoryEntries: 3, totalEntries: 7, totalSize: 99 });
    vi.mocked(cache.prune).mockResolvedValue(4);
    const { guard, warnings } = guarded(cache);

    await expect(guard.stats()).resolves.toEqual({ memoryEntries: 3, totalEntries: 7, totalSize: 99 });
    await expect(guard.prune()).resolves.toBe(4);
    await expect(guard.clear()).resolves.toBeUndefined();
    expect(cache.clear).toHaveBeenCalledOnce();

    vi.mocked(cache.prune).mockRejectedValue(new Error('EACCES'));
    vi.mocked(cache.clear).mockRejectedValue(new Error('EACCES'));
    vi.mocked(cache.stats).mockRejectedValue(new Error('EACCES'));
    await expect(guard.prune()).rejects.toThrow('EACCES');
    await expect(guard.clear()).rejects.toThrow('EACCES');
    await expect(guard.stats()).rejects.toThrow('EACCES');
    expect(warnings).toEqual([]);
  });
});

describe('one guard per provider', () => {
  it('gives a provider the same guard every time, and a guard is its own', () => {
    const cache = createMockCache();
    const guard = guardCache(cache);

    expect(guardCache(cache)).toBe(guard);
    expect(guardCache(guard)).toBe(guard);
    expect(guardCache(createMockCache())).not.toBe(guard);
  });

  it('is the one a MapsRegistry and a TopicResolver hold, and logs through the first server\'s logger', async () => {
    // What src/index.ts does over HTTP: one context, a server per request.
    // The glossary's and the static sources' Fuse indexes and the loads in
    // flight (the map TOC's, and those of load-once.ts) are kept per
    // CacheProvider, so a guard per server would rebuild them on every
    // request. That the servers' tools read this same guard is
    // test/unit/core/create-server-context.test.ts.
    const cache = createMockCache();
    vi.mocked(cache.get).mockRejectedValue(KV_DOWN);
    const { loggers, warnings, created } = recordingLoggers();
    const mapsRegistry = new MapsRegistry(cache, async () => await Promise.resolve([]));
    const topicResolver = new TopicResolver(mapsRegistry, cache);
    const ctx = createMockContext({ cache, logger: loggers, mapsRegistry, topicResolver });

    const servers = [createMcpServer(ctx), createMcpServer({ ...ctx, logger: recordingLoggers().loggers })];
    // The caller's context is left as it was given.
    expect(ctx.cache).toBe(cache);
    expect(Reflect.get(mapsRegistry, 'cache')).toBe(guardCache(cache));
    expect(Reflect.get(topicResolver, 'cache')).toBe(guardCache(cache));

    // The registry was built before any server, and still logs through the
    // first server's logger, because it holds the same guard.
    await mapsRegistry.ensureBuilt();
    expect(warnings).toEqual([
      '[cache] Cache read failed (maps-registry-v4), read as a miss: Error: KV GET failed: 503 Service Unavailable',
    ]);
    expect(created.filter(name => name === 'cache')).toEqual(['cache']);
    await Promise.all(servers.map(async s => { await s.close(); }));
  });
});

describe('where it logs', () => {
  it('writes to stderr until a server names a logger, and creates that logger only when it has something to say', async () => {
    const cache = createMockCache();
    vi.mocked(cache.get).mockRejectedValue(KV_DOWN);
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const guard = guardCache(cache);

    await guard.get(TOPICS_KEY);
    expect(stderr.mock.calls).toEqual([[
      '[WARNING] [cache] Cache read failed (metadata-topics), read as a miss: ' +
      'Error: KV GET failed: 503 Service Unavailable',
    ]]);

    const { loggers, warnings, created } = recordingLoggers();
    guardCache(cache, loggers);
    expect(created).toEqual([]);

    await guard.get(TOPICS_KEY);
    await guard.get(TOPICS_KEY);
    expect(warnings).toHaveLength(2);
    expect(created).toEqual(['cache']);
    expect(stderr).toHaveBeenCalledOnce();
  });

  it('keeps the first logger it was given', async () => {
    const cache = createMockCache();
    vi.mocked(cache.get).mockRejectedValue(KV_DOWN);
    const first = recordingLoggers();
    const second = recordingLoggers();
    guardCache(cache, first.loggers);
    const guard = guardCache(cache, second.loggers);

    await guard.get(TOPICS_KEY);

    expect(first.warnings).toHaveLength(1);
    expect(second.warnings).toEqual([]);
  });
});

describe('over FileCache', () => {
  it('adds nothing to what FileCache logs itself when it cannot write, and reads its misses as misses', async () => {
    // A cache directory under a regular file: mkdir and every write fail
    // with ENOTDIR. FileCache logs that and goes on; nothing reaches the
    // guard, so nothing is logged twice.
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cache-guard-'));
    const blocker = path.join(tmp, 'not-a-directory');
    await fs.writeFile(blocker, '');
    const fileLog = { ...createMockLogger() };
    const file = new FileCache({ cacheDir: path.join(blocker, 'cache'), log: fileLog });
    const { guard, warnings } = guarded(file);

    try {
      await guard.set(TOPICS_KEY, ['a'], 60_000);
      await guard.set(SEARCH_KEY, ['b'], 60_000);

      expect(warnings).toEqual([]);
      // "Cannot create cache directory" once, "Failed to write cache" per write.
      expect(vi.mocked(fileLog.error).mock.calls.map(([m]) => String(m).split(':')[0])).toEqual([
        `Cannot create cache directory "${path.join(blocker, 'cache')}"`,
        'Failed to write cache',
        'Failed to write cache',
      ]);
      // Still served from memory, as FileCache always did.
      await expect(guard.get(TOPICS_KEY)).resolves.toEqual(['a']);
      await expect(guard.get(cacheKey('ft-topic-index', { mapId: 'none' }))).resolves.toBeNull();
      expect(warnings).toEqual([]);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});

describe('the maps registry over a provider that answers undefined', () => {
  it('builds from learn.jamf.com instead of reading undefined as its maps', async () => {
    const store = new Map<string, unknown>();
    const cache: CacheProvider = {
      ...createMockCache(),
      get: (async (key: string) => await Promise.resolve(store.get(key))) as CacheProvider['get'],
      set: async (key, value) => { store.set(key, value); await Promise.resolve(); },
    };
    const map: FtMapInfo = {
      id: 'map-1', title: 'Jamf Pro Documentation', mapApiEndpoint: '/api/khub/maps/map-1',
      metadata: [
        { key: 'version_bundle_stem', label: 'version_bundle_stem', values: ['jamf-pro-documentation'] },
        { key: 'ft:locale', label: 'ft:locale', values: ['en-US'] },
      ],
    };
    const fetchMaps = vi.fn(async () => await Promise.resolve([map]));
    const registry = new MapsRegistry(cache, fetchMaps);

    // Until 2026-09-28: "this.entries is not iterable".
    await expect(registry.getProducts()).resolves.toEqual([
      expect.objectContaining({ bundleStem: 'jamf-pro-documentation' }),
    ]);
    expect(fetchMaps).toHaveBeenCalledOnce();
  });
});
