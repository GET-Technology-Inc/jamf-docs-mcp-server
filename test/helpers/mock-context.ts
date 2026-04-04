/**
 * Shared mock utilities for ServerContext dependency injection in tests.
 *
 * Provides factory functions for creating mock cache, metadata, logger,
 * and the full ServerContext needed by the refactored core modules.
 */

import { vi } from 'vitest';
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
    setServer: vi.fn(),
  };
}

export function createMockCache(): CacheProvider {
  const store = new Map<string, { data: unknown; expires: number }>();
  return {
    get: vi.fn(async <T>(key: string): Promise<T | null> => {
      const entry = store.get(key);
      if (!entry || Date.now() > entry.expires) return null;
      return entry.data as T;
    }),
    set: vi.fn(async (key: string, value: unknown, ttl = 60000): Promise<void> => {
      store.set(key, { data: value, expires: Date.now() + ttl });
    }),
    delete: vi.fn(async (key: string): Promise<boolean> => store.delete(key)),
    clear: vi.fn(async (): Promise<void> => { store.clear(); }),
    stats: vi.fn(async () => ({ memoryEntries: store.size, totalEntries: store.size })),
    prune: vi.fn(async () => 0),
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
 * Build a mock ArticleProvider where getArticleByIds returns resultFn()
 * and getArticle always returns null.
 */
export function createMockArticleProvider(
  resultFn: () => FetchArticleResult | null
): ArticleProvider {
  return {
    getArticle: vi.fn().mockResolvedValue(null),
    getArticleByIds: vi.fn(
      async (
        _mapId: string,
        _contentId: string,
        _options?: FetchArticleOptions,
      ): Promise<FetchArticleResult | null> => resultFn()
    ),
  };
}
