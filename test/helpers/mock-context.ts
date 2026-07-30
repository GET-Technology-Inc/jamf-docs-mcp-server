/**
 * Shared mock utilities for ServerContext dependency injection in tests.
 *
 * Provides factory functions for creating mock cache, metadata, logger,
 * and the full ServerContext needed by the refactored core modules.
 */

import { vi, type Mock } from 'vitest';
import type { ServerContext } from '../../src/core/types/context.js';
import type {
  FetchArticleResult,
  FetchArticleOptions,
} from '../../src/core/types.js';
import type {
  ArticleProvider,
  CacheProvider,
  LoggerFactory,
  Logger,
} from '../../src/core/services/interfaces/index.js';
import { createDefaultConfig } from '../../src/core/config.js';
import { MapsRegistry } from '../../src/core/services/maps-registry.js';
import { TopicResolver } from '../../src/core/services/topic-resolver.js';

export function createMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    notice: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    critical: vi.fn(),
    alert: vi.fn(),
    emergency: vi.fn(),
  };
}

export function createMockLoggerFactory(): LoggerFactory {
  return {
    createLogger: vi.fn(() => createMockLogger()),
  };
}

export function createMockCache(): CacheProvider {
  const store = new Map<string, { data: unknown; expires: number }>();

  // `CacheProvider.get` is generic (`<T>(key: string) => Promise<T | null>`),
  // but vitest's `Mock<T>` erases the type parameter — it describes the call
  // signature as `Promise<unknown>`, which no longer matches. The mock is
  // therefore written non-generically and widened back to the interface
  // signature here. Tests still reach it through `vi.mocked(ctx.cache.get)`.
  //
  // These mocks stand in for an async interface, so they have to hand back
  // thenables — dropping `async` would return bare values to callers that
  // `await` them. Their bodies are synchronous, though, so each one awaits an
  // already-resolved promise to be an honest async function rather than an
  // `async` keyword with nothing behind it.
  const get = vi.fn(async (key: string): Promise<unknown> => {
    const entry = store.get(key);
    if (entry === undefined || Date.now() > entry.expires) {
      return null;
    }
    return await Promise.resolve(entry.data);
  }) as CacheProvider['get'];

  return {
    get,
    set: vi.fn<CacheProvider['set']>(async (key, value, ttl = 60000) => {
      store.set(key, { data: value, expires: Date.now() + ttl });
      await Promise.resolve();
    }),
    delete: vi.fn(async (key: string): Promise<boolean> => await Promise.resolve(store.delete(key))),
    clear: vi.fn(async (): Promise<void> => {
      store.clear();
      await Promise.resolve();
    }),
    stats: vi.fn(async () => await Promise.resolve({ memoryEntries: store.size, totalEntries: store.size })),
    prune: vi.fn(async () => await Promise.resolve(0)),
  };
}

export function createMockContext(overrides?: Partial<ServerContext>): ServerContext {
  const cache = createMockCache();
  const mapsRegistry = new MapsRegistry(cache);
  const topicResolver = new TopicResolver(mapsRegistry, cache);
  return {
    cache,
    logger: createMockLoggerFactory(),
    config: createDefaultConfig(),
    mapsRegistry,
    topicResolver,
    ...overrides,
  };
}

/**
 * An `ArticleProvider` whose methods are vitest mocks, so tests can reach
 * `.mockClear()` / `.mockRejectedValueOnce()` on them without casting.
 * `getArticle` is optional on the interface but always present here.
 */
export interface MockArticleProvider extends ArticleProvider {
  getArticleByIds: Mock<ArticleProvider['getArticleByIds']>;
  getArticle: Mock<NonNullable<ArticleProvider['getArticle']>>;
}

/**
 * Build a mock ArticleProvider where getArticleByIds returns resultFn()
 * and getArticle always returns null.
 */
export function createMockArticleProvider(
  resultFn: () => FetchArticleResult | null
): MockArticleProvider {
  return {
    getArticle: vi.fn<NonNullable<ArticleProvider['getArticle']>>()
      .mockResolvedValue(null),
    getArticleByIds: vi.fn(
      async (
        _mapId: string,
        _contentId: string,
        _options?: FetchArticleOptions,
      ): Promise<FetchArticleResult | null> => await Promise.resolve(resultFn())
    ),
  };
}
