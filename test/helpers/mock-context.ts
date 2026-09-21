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
import { httpGetText, httpGetJson, httpPostJson, type HttpClient } from '../../src/core/http-client.js';
import type { PublicationInfo } from '../../src/core/services/maps-registry.js';
import { MapsRegistry } from '../../src/core/services/maps-registry.js';
import { TopicResolver } from '../../src/core/services/topic-resolver.js';
import { JAMF_PRODUCTS, classificationValuesFor, type ProductId } from '../../src/core/constants.js';
import type { FtMapInfo } from '../../src/core/types.js';
import { CLASSIFICATION_AXIS } from './fixtures.js';

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

/**
 * A `MapsRegistry` stand-in that answers from a fixed publication list.
 *
 * `createMockContext` builds a real `MapsRegistry`, which is right for tests
 * that mock the http client underneath it — but a unit test that exercises a
 * tool reading the publication axis without such a mock will reach
 * learn.jamf.com for real. That failure is swallowed (the tools degrade
 * gracefully by design), so it shows up as a slow, network-dependent test
 * rather than a red one. Pass this instead.
 */
export function createStubMapsRegistry(
  publications: PublicationInfo[] = [],
): ServerContext['mapsRegistry'] {
  const find = (id: string): PublicationInfo | undefined =>
    publications.find(pub => pub.id === id);

  return {
    listPublications: vi.fn(async () => await Promise.resolve(publications)),
    hasPublication: vi.fn(async (id: string) => await Promise.resolve(find(id) !== undefined)),
    suggestPublications: vi.fn(async () => await Promise.resolve([])),
    getVersions: vi.fn(async (id: string) => await Promise.resolve(find(id)?.versions ?? [])),
    resolveTitle: vi.fn(async (id: string) => await Promise.resolve(find(id)?.title ?? null)),
    resolveMapId: vi.fn(async () => await Promise.resolve(null)),
    resolveFromBundleId: vi.fn(async () => await Promise.resolve(null)),
    resolveGlossaryMapId: vi.fn(async () => await Promise.resolve(null)),
    getProducts: vi.fn(async () => await Promise.resolve([])),
    ensureBuilt: vi.fn(async () => { await Promise.resolve(); }),
    reset: vi.fn(),
  } as unknown as ServerContext['mapsRegistry'];
}

/**
 * A `MapsRegistry` that answers offline, one map per product carrying Jamf's
 * own classification for it.
 *
 * Opt-in rather than the default for `createMockContext`, which deliberately
 * builds a provider-less registry so a test can mock the http client
 * *underneath* it — that is how the TOC tests drive map resolution, and
 * injecting a provider by default silently took their fixtures away.
 *
 * Pass this where a test exercises something that resolves a product's
 * classification axis, which today means any product-filtered search.
 */
export function createClassifyingMapsRegistry(): MapsRegistry {
  const maps = fixtureMaps();
  return new MapsRegistry(createMockCache(), undefined, {
    getMaps: async () => await Promise.resolve(maps),
  });
}

function fixtureMaps(): FtMapInfo[] {
  return (Object.keys(JAMF_PRODUCTS) as ProductId[]).flatMap((id, i) => {
    const values = classificationValuesFor(id);
    if (values.length === 0) { return []; }
    const axis = CLASSIFICATION_AXIS[values[0] ?? ''] ?? 'jamf:portal';
    const product = JAMF_PRODUCTS[id];
    return [{
      id: `fixture-map-${String(i)}`,
      title: product.name,
      mapApiEndpoint: `/api/khub/maps/fixture-map-${String(i)}`,
      metadata: [
        { key: 'version_bundle_stem', label: 'version_bundle_stem', values: [product.bundleId] },
        { key: 'ft:locale', label: 'ft:locale', values: ['en-US'] },
        { key: 'bundle', label: 'bundle', values: [product.bundleId] },
        { key: 'jamf:portal', label: 'jamf:portal', values: axis === 'jamf:portal' ? [...values] : [] },
        { key: 'jamf:app', label: 'jamf:app', values: axis === 'jamf:app' ? [...values] : [] },
        { key: 'jamf:utility', label: 'jamf:utility', values: axis === 'jamf:utility' ? [...values] : [] },
      ],
    }];
  });
}

/**
 * An HttpClient that forwards straight to the http-client primitives.
 *
 * Deliberately not `createHttpClient(...)`. Nine suites replace that module
 * with a factory that exports only the three primitives, so the real factory
 * is not there to call — and where it is, it closes over the unmocked helpers
 * and would bypass the very mocks the suite asserts on. Forwarding resolves
 * against whatever the module currently exports, mocked or not.
 *
 * The bound-config behaviour (User-Agent, timeout, retries, politeness) is
 * covered directly in test/unit/core/http-client-factory.test.ts.
 */
export function createTestHttpClient(): HttpClient {
  return {
    // `options` is omitted rather than forwarded as undefined: the suites that
    // mock these assert `toHaveBeenCalledWith(url)`, and a trailing undefined
    // is a different call as far as those assertions are concerned.
    getText: async (url, options) => options === undefined
      ? await httpGetText(url)
      : await httpGetText(url, options),
    getJson: async (url, options) => options === undefined
      ? await httpGetJson(url)
      : await httpGetJson(url, options),
    postJson: async (url, body, options) => options === undefined
      ? await httpPostJson(url, body)
      : await httpPostJson(url, body, options),
  };
}

export function createMockContext(overrides?: Partial<ServerContext>): ServerContext {
  const cache = createMockCache();
  const config = createDefaultConfig();
  const http = createTestHttpClient();
  const mapsRegistry = new MapsRegistry(cache, undefined, undefined, undefined, http);
  const topicResolver = new TopicResolver(mapsRegistry, cache, undefined, undefined, http);
  return {
    cache,
    logger: createMockLoggerFactory(),
    config,
    http,
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
