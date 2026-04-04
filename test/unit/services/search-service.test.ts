/**
 * Unit tests for search-service — Fluid Topics powered search
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock ft-client before importing module under test
vi.mock('../../../src/core/services/ft-client.js', () => ({
  search: vi.fn(),
  fetchMaps: vi.fn().mockResolvedValue([]),
  fetchMapToc: vi.fn().mockResolvedValue([]),
  fetchMapTopics: vi.fn().mockResolvedValue([]),
  fetchTopicContent: vi.fn().mockResolvedValue(''),
  fetchTopicMetadata: vi.fn().mockResolvedValue([]),
}));

import { search as ftSearch } from '../../../src/core/services/ft-client.js';
import {
  buildSearchFilters,
  transformFtSearchResult,
  searchDocumentation,
} from '../../../src/core/services/search-service.js';
import { DOCS_BASE_URL, DOC_TYPE_CONTENT_TYPE_MAP } from '../../../src/core/constants.js';
import type {
  FtSearchEntry,
  FtSearchCluster,
  FtClusteredSearchResponse,
  FtMetadataEntry,
} from '../../../src/core/types.js';
import { createMockContext } from '../../helpers/mock-context.js';

const mockedFtSearch = vi.mocked(ftSearch);

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================================
// Helpers
// ============================================================================

function makeMetadata(entries: Record<string, string[]>): FtMetadataEntry[] {
  return Object.entries(entries).map(([key, values]) => ({
    key,
    label: key,
    values,
  }));
}

function makeTopicEntry(overrides?: {
  mapId?: string;
  contentId?: string;
  title?: string;
  htmlExcerpt?: string;
  mapTitle?: string;
  breadcrumb?: string[];
  metadata?: FtMetadataEntry[];
}): FtSearchEntry {
  return {
    type: 'TOPIC',
    missingTerms: [],
    topic: {
      mapId: overrides?.mapId ?? 'jamf-pro-documentation',
      contentId: overrides?.contentId ?? 'topic-123',
      tocId: 'toc-1',
      title: overrides?.title ?? 'Configuration Profiles',
      htmlTitle: overrides?.title ?? 'Configuration Profiles',
      mapTitle: overrides?.mapTitle ?? 'Jamf Pro Documentation',
      breadcrumb: overrides?.breadcrumb ?? ['Jamf Pro', 'Profiles'],
      htmlExcerpt: overrides?.htmlExcerpt ?? '<b>Learn</b> about configuration profiles in Jamf Pro for managing device settings.',
      metadata: overrides?.metadata ?? makeMetadata({
        'zoominmetadata': ['product-pro'],
        'ft:prettyUrl': ['/en-US/bundle/jamf-pro-documentation/page/Configuration_Profiles.html'],
        'version': ['11.5.0'],
        'jamf:contentType': ['Technical Documentation'],
      }),
    },
  };
}

function makeMapEntry(overrides?: {
  mapId?: string;
  title?: string;
  htmlExcerpt?: string;
  readerUrl?: string;
  mapUrl?: string;
  metadata?: FtMetadataEntry[];
}): FtSearchEntry {
  return {
    type: 'MAP',
    missingTerms: [],
    map: {
      mapId: overrides?.mapId ?? 'jamf-pro-documentation',
      mapUrl: overrides?.mapUrl ?? '/en-US/bundle/jamf-pro-documentation',
      readerUrl: overrides?.readerUrl ?? '/en-US/bundle/jamf-pro-documentation/page/index.html',
      title: overrides?.title ?? 'Jamf Pro Documentation',
      htmlTitle: overrides?.title ?? 'Jamf Pro Documentation',
      htmlExcerpt: overrides?.htmlExcerpt ?? 'Complete documentation for <b>Jamf Pro</b>.',
      metadata: overrides?.metadata ?? makeMetadata({
        'zoominmetadata': ['product-pro'],
        'version': ['current'],
        'jamf:contentType': ['Technical Documentation'],
      }),
      editorialType: 'STANDARD',
      openMode: 'reader',
    },
  };
}

function makeCluster(entries: FtSearchEntry[]): FtSearchCluster {
  return {
    metadataVariableAxis: 'publisher',
    entries,
  };
}

function makeFtResponse(
  clusters: FtSearchCluster[],
  totalResults = -1
): FtClusteredSearchResponse {
  const total = totalResults >= 0
    ? totalResults
    : clusters.reduce((sum, c) => sum + c.entries.length, 0);
  return {
    facets: [],
    results: clusters,
    announcements: [],
    paging: {
      currentPage: 0,
      isLastPage: true,
      totalResultsCount: total,
      totalClustersCount: clusters.length,
    },
  };
}

// ============================================================================
// buildSearchFilters()
// ============================================================================

describe('buildSearchFilters()', () => {
  it('should add latestVersion=yes when no version specified', () => {
    const filters = buildSearchFilters({});
    expect(filters).toEqual([
      { key: 'latestVersion', values: ['yes'] },
    ]);
  });

  it('should add latestVersion=yes when version is "current"', () => {
    const filters = buildSearchFilters({ version: 'current' });
    expect(filters).toEqual([
      { key: 'latestVersion', values: ['yes'] },
    ]);
  });

  it('should add latestVersion=yes when version is empty string', () => {
    const filters = buildSearchFilters({ version: '' });
    expect(filters).toEqual([
      { key: 'latestVersion', values: ['yes'] },
    ]);
  });

  it('should add version filter when specific version provided', () => {
    const filters = buildSearchFilters({ version: '11.5.0' });
    expect(filters).toEqual([
      { key: 'version', values: ['11.5.0'] },
    ]);
  });

  it('should map product to zoominmetadata filter', () => {
    const filters = buildSearchFilters({ product: 'jamf-pro' });
    expect(filters).toContainEqual({
      key: 'zoominmetadata',
      values: ['product-pro'],
    });
  });

  it('should map docType to jamf:contentType filter', () => {
    const filters = buildSearchFilters({ docType: 'release-notes' });
    expect(filters).toContainEqual({
      key: 'jamf:contentType',
      values: ['Release Notes'],
    });
  });

  it('should map documentation docType correctly', () => {
    const filters = buildSearchFilters({ docType: 'documentation' });
    expect(filters).toContainEqual({
      key: 'jamf:contentType',
      values: ['Technical Documentation'],
    });
  });

  it('should combine product, docType, and version filters', () => {
    const filters = buildSearchFilters({
      product: 'jamf-connect',
      docType: 'documentation',
      version: '2.30.0',
    });
    expect(filters).toHaveLength(3);
    expect(filters).toContainEqual({ key: 'zoominmetadata', values: ['product-connect'] });
    expect(filters).toContainEqual({ key: 'jamf:contentType', values: ['Technical Documentation'] });
    expect(filters).toContainEqual({ key: 'version', values: ['2.30.0'] });
  });

  it('should not add jamf:contentType when docType has no mapping', () => {
    // Use a hypothetical unmapped docType to verify the fallback behavior
    const filters = buildSearchFilters({ docType: 'unknown-type' as never });
    const contentTypeFilter = filters.find(f => f.key === 'jamf:contentType');
    expect(contentTypeFilter).toBeUndefined();
  });

  it('should map training docType to Technical Documentation', () => {
    const filters = buildSearchFilters({ docType: 'training' as never });
    const contentTypeFilter = filters.find(f => f.key === 'jamf:contentType');
    expect(contentTypeFilter).toEqual({
      key: 'jamf:contentType',
      values: ['Technical Documentation'],
    });
  });
});

// ============================================================================
// transformFtSearchResult()
// ============================================================================

describe('transformFtSearchResult()', () => {
  describe('TOPIC entries', () => {
    it('should extract title from topic.title', () => {
      const entry = makeTopicEntry({ title: 'My Custom Title' });
      const result = transformFtSearchResult(entry);
      expect(result.title).toBe('My Custom Title');
    });

    it('should build URL from ft:prettyUrl with DOCS_BASE_URL prefix', () => {
      const entry = makeTopicEntry();
      const result = transformFtSearchResult(entry);
      expect(result.url).toBe(
        `${DOCS_BASE_URL}/en-US/bundle/jamf-pro-documentation/page/Configuration_Profiles.html`
      );
    });

    it('should fallback to legacy URL when ft:prettyUrl is missing', () => {
      const entry = makeTopicEntry({
        mapId: 'jamf-pro-documentation',
        contentId: 'topic-456',
        metadata: makeMetadata({
          'zoominmetadata': ['product-pro'],
          'version': ['11.5.0'],
        }),
      });
      const result = transformFtSearchResult(entry);
      expect(result.url).toBe(
        `${DOCS_BASE_URL}/r/en-US/jamf-pro-documentation/topic-456`
      );
    });

    it('should clean HTML from htmlExcerpt snippet', () => {
      const entry = makeTopicEntry({
        htmlExcerpt: '<b>Learn</b> about <em>profiles</em> in Jamf Pro for managing device settings and security.',
      });
      const result = transformFtSearchResult(entry);
      expect(result.snippet).not.toContain('<b>');
      expect(result.snippet).not.toContain('<em>');
      expect(result.snippet).toContain('Learn');
    });

    it('should extract product from zoominmetadata', () => {
      const entry = makeTopicEntry({
        metadata: makeMetadata({
          'zoominmetadata': ['product-pro'],
          'ft:prettyUrl': ['/en-US/bundle/jamf-pro-documentation/page/test.html'],
        }),
      });
      const result = transformFtSearchResult(entry);
      expect(result.product).toBe('Jamf Pro');
    });

    it('should extract version from metadata', () => {
      const entry = makeTopicEntry();
      const result = transformFtSearchResult(entry);
      expect(result.version).toBe('11.5.0');
    });

    it('should set mapId from topic', () => {
      const entry = makeTopicEntry({ mapId: 'my-map-id' });
      const result = transformFtSearchResult(entry);
      expect(result.mapId).toBe('my-map-id');
    });

    it('should set contentId from topic', () => {
      const entry = makeTopicEntry({ contentId: 'my-content-id' });
      const result = transformFtSearchResult(entry);
      expect(result.contentId).toBe('my-content-id');
    });

    it('should set breadcrumb from topic', () => {
      const entry = makeTopicEntry({ breadcrumb: ['Level 1', 'Level 2', 'Level 3'] });
      const result = transformFtSearchResult(entry);
      expect(result.breadcrumb).toEqual(['Level 1', 'Level 2', 'Level 3']);
    });

    it('should omit breadcrumb when empty', () => {
      const entry = makeTopicEntry({ breadcrumb: [] });
      const result = transformFtSearchResult(entry);
      expect(result.breadcrumb).toBeUndefined();
    });

    it('should set mapTitle from topic', () => {
      const entry = makeTopicEntry({ mapTitle: 'Jamf Pro Documentation Guide' });
      const result = transformFtSearchResult(entry);
      expect(result.mapTitle).toBe('Jamf Pro Documentation Guide');
    });

    it('should omit mapTitle when empty', () => {
      const entry = makeTopicEntry({ mapTitle: '' });
      const result = transformFtSearchResult(entry);
      expect(result.mapTitle).toBeUndefined();
    });

    it('should derive docType from jamf:contentType metadata', () => {
      const entry = makeTopicEntry({
        metadata: makeMetadata({
          'zoominmetadata': ['product-pro'],
          'ft:prettyUrl': ['/en-US/bundle/jamf-pro-documentation/page/test.html'],
          'jamf:contentType': ['Release Notes'],
        }),
      });
      const result = transformFtSearchResult(entry);
      expect(result.docType).toBe('release-notes');
    });

    it('should default to documentation when jamf:contentType is unknown', () => {
      const entry = makeTopicEntry({
        metadata: makeMetadata({
          'zoominmetadata': ['product-pro'],
          'ft:prettyUrl': ['/en-US/bundle/jamf-pro-documentation/page/test.html'],
          'jamf:contentType': ['Unknown Type'],
        }),
      });
      const result = transformFtSearchResult(entry);
      expect(result.docType).toBe('documentation');
    });

    it('should handle Untitled when title is empty', () => {
      const entry = makeTopicEntry({ title: '' });
      const result = transformFtSearchResult(entry);
      expect(result.title).toBe('Untitled');
    });

    it('should return null product when zoominmetadata has no product match', () => {
      const entry = makeTopicEntry({
        metadata: makeMetadata({
          'zoominmetadata': ['some-unknown-label'],
          'ft:prettyUrl': ['/en-US/bundle/test/page/test.html'],
        }),
      });
      const result = transformFtSearchResult(entry);
      expect(result.product).toBeNull();
    });
  });

  describe('MAP entries', () => {
    it('should extract title from map', () => {
      const entry = makeMapEntry({ title: 'Jamf School Documentation' });
      const result = transformFtSearchResult(entry);
      expect(result.title).toBe('Jamf School Documentation');
    });

    it('should use readerUrl for URL', () => {
      const entry = makeMapEntry({
        readerUrl: '/en-US/bundle/jamf-school-documentation/page/index.html',
      });
      const result = transformFtSearchResult(entry);
      expect(result.url).toBe(
        `${DOCS_BASE_URL}/en-US/bundle/jamf-school-documentation/page/index.html`
      );
    });

    it('should fallback to mapUrl when readerUrl is empty', () => {
      const entry = makeMapEntry({
        readerUrl: '',
        mapUrl: '/en-US/bundle/jamf-pro-documentation',
      });
      const result = transformFtSearchResult(entry);
      expect(result.url).toBe(`${DOCS_BASE_URL}/en-US/bundle/jamf-pro-documentation`);
    });

    it('should set mapId from map', () => {
      const entry = makeMapEntry({ mapId: 'school-map-1' });
      const result = transformFtSearchResult(entry);
      expect(result.mapId).toBe('school-map-1');
    });

    it('should set mapTitle from map title', () => {
      const entry = makeMapEntry({ title: 'Jamf Protect Docs' });
      const result = transformFtSearchResult(entry);
      expect(result.mapTitle).toBe('Jamf Protect Docs');
    });
  });
});

// ============================================================================
// searchDocumentation()
// ============================================================================

describe('searchDocumentation()', () => {
  let ctx: ReturnType<typeof createMockContext>;

  beforeEach(() => {
    ctx = createMockContext();
  });

  it('should return results from FT API', async () => {
    const entry = makeTopicEntry();
    mockedFtSearch.mockResolvedValueOnce(
      makeFtResponse([makeCluster([entry])])
    );

    const result = await searchDocumentation(ctx, { query: 'profiles' });
    expect(result.results).toHaveLength(1);
    expect(result.results[0].title).toBe('Configuration Profiles');
    expect(result.pagination.totalItems).toBe(1);
  });

  it('should pass latestVersion filter when no version specified', async () => {
    mockedFtSearch.mockResolvedValueOnce(makeFtResponse([]));

    await searchDocumentation(ctx, { query: 'test' });

    expect(mockedFtSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: expect.arrayContaining([
          { key: 'latestVersion', values: ['yes'] },
        ]),
      })
    );
  });

  it('should pass version filter when version specified', async () => {
    mockedFtSearch.mockResolvedValueOnce(makeFtResponse([]));

    await searchDocumentation(ctx, { query: 'test', version: '11.5.0' });

    expect(mockedFtSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: expect.arrayContaining([
          { key: 'version', values: ['11.5.0'] },
        ]),
      })
    );
  });

  it('should pass product filter as zoominmetadata', async () => {
    mockedFtSearch.mockResolvedValueOnce(makeFtResponse([]));

    await searchDocumentation(ctx, { query: 'test', product: 'jamf-protect' });

    expect(mockedFtSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: expect.arrayContaining([
          { key: 'zoominmetadata', values: ['product-protect'] },
        ]),
      })
    );
  });

  it('should return empty results when API returns no clusters', async () => {
    mockedFtSearch.mockResolvedValueOnce(makeFtResponse([]));

    const result = await searchDocumentation(ctx, { query: 'nonexistent' });
    expect(result.results).toHaveLength(0);
    expect(result.pagination.totalItems).toBe(0);
  });

  it('should handle API errors gracefully', async () => {
    mockedFtSearch.mockRejectedValueOnce(new Error('Network timeout'));

    const result = await searchDocumentation(ctx, { query: 'test' });
    expect(result.results).toHaveLength(0);
  });

  it('should paginate results correctly', async () => {
    const entries = Array.from({ length: 15 }, (_, i) =>
      makeTopicEntry({
        title: `Result ${i + 1}`,
        contentId: `topic-${i}`,
        metadata: makeMetadata({
          'zoominmetadata': ['product-pro'],
          'ft:prettyUrl': [`/en-US/bundle/jamf-pro-documentation/page/page-${i}.html`],
          'version': ['11.5.0'],
        }),
      })
    );
    mockedFtSearch.mockResolvedValueOnce(
      makeFtResponse([makeCluster(entries)])
    );

    const result = await searchDocumentation(ctx, {
      query: 'test',
      limit: 5,
      page: 2,
    });

    expect(result.results).toHaveLength(5);
    expect(result.pagination.page).toBe(2);
    expect(result.pagination.totalPages).toBe(3);
    expect(result.pagination.hasNext).toBe(true);
    expect(result.pagination.hasPrev).toBe(true);
  });

  it('should prefer SearchProvider when available', async () => {
    const customResults = [
      {
        title: 'Custom Result',
        url: 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/custom.html',
        snippet: 'This is a custom search result from the provider with enough content to pass validation.',
        product: 'Jamf Pro',
      },
    ];

    const ctxWithProvider = createMockContext({
      searchProvider: {
        search: vi.fn().mockResolvedValue(customResults),
      },
    });

    const result = await searchDocumentation(ctxWithProvider, { query: 'test' });
    expect(result.results).toHaveLength(1);
    expect(result.results[0].title).toBe('Custom Result');
    expect(mockedFtSearch).not.toHaveBeenCalled();
  });

  it('should fall through to FT API when SearchProvider returns null', async () => {
    const entry = makeTopicEntry({ title: 'FT Result' });
    mockedFtSearch.mockResolvedValueOnce(
      makeFtResponse([makeCluster([entry])])
    );

    const ctxWithNullProvider = createMockContext({
      searchProvider: {
        search: vi.fn().mockResolvedValue(null),
      },
    });

    const result = await searchDocumentation(ctxWithNullProvider, { query: 'test' });
    expect(result.results).toHaveLength(1);
    expect(result.results[0].title).toBe('FT Result');
    expect(mockedFtSearch).toHaveBeenCalled();
  });

  it('should include tokenInfo in response', async () => {
    const entry = makeTopicEntry();
    mockedFtSearch.mockResolvedValueOnce(
      makeFtResponse([makeCluster([entry])])
    );

    const result = await searchDocumentation(ctx, { query: 'test', maxTokens: 5000 });
    expect(result.tokenInfo).toBeDefined();
    expect(result.tokenInfo.maxTokens).toBe(5000);
    expect(typeof result.tokenInfo.tokenCount).toBe('number');
    expect(typeof result.tokenInfo.truncated).toBe('boolean');
  });

  it('should pass locale as contentLocale to FT API', async () => {
    mockedFtSearch.mockResolvedValueOnce(makeFtResponse([]));

    await searchDocumentation(ctx, { query: 'test', language: 'ja-JP' });

    expect(mockedFtSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        contentLocale: 'ja-JP',
      })
    );
  });

  it('should flatten multiple clusters into results', async () => {
    const entry1 = makeTopicEntry({ title: 'Cluster 1 Result', contentId: 'c1' });
    const entry2 = makeTopicEntry({ title: 'Cluster 2 Result', contentId: 'c2' });
    mockedFtSearch.mockResolvedValueOnce(
      makeFtResponse([makeCluster([entry1]), makeCluster([entry2])])
    );

    const result = await searchDocumentation(ctx, { query: 'test' });
    expect(result.results).toHaveLength(2);
    expect(result.results[0].title).toBe('Cluster 1 Result');
    expect(result.results[1].title).toBe('Cluster 2 Result');
  });

  // ==========================================================================
  // Caching behaviour
  // ==========================================================================

  it('should cache FT API results and return cached on second call', async () => {
    const entry = makeTopicEntry({ title: 'Cached Result' });
    mockedFtSearch.mockResolvedValueOnce(
      makeFtResponse([makeCluster([entry])])
    );

    // First call — hits the FT API
    const first = await searchDocumentation(ctx, { query: 'cache-test' });
    expect(first.results).toHaveLength(1);
    expect(first.results[0].title).toBe('Cached Result');
    expect(mockedFtSearch).toHaveBeenCalledTimes(1);

    // Second call — should come from cache, no additional API call
    const second = await searchDocumentation(ctx, { query: 'cache-test' });
    expect(second.results).toHaveLength(1);
    expect(second.results[0].title).toBe('Cached Result');
    expect(mockedFtSearch).toHaveBeenCalledTimes(1); // still 1
  });

  it('should use different cache keys for different queries', async () => {
    const entryA = makeTopicEntry({ title: 'Result A', contentId: 'a' });
    const entryB = makeTopicEntry({ title: 'Result B', contentId: 'b' });
    mockedFtSearch
      .mockResolvedValueOnce(makeFtResponse([makeCluster([entryA])]))
      .mockResolvedValueOnce(makeFtResponse([makeCluster([entryB])]));

    const resultA = await searchDocumentation(ctx, { query: 'alpha' });
    const resultB = await searchDocumentation(ctx, { query: 'beta' });

    expect(resultA.results[0].title).toBe('Result A');
    expect(resultB.results[0].title).toBe('Result B');
    expect(mockedFtSearch).toHaveBeenCalledTimes(2);
  });

  it('should use different cache keys for different filters', async () => {
    const entryPro = makeTopicEntry({ title: 'Pro Result' });
    const entrySchool = makeTopicEntry({ title: 'School Result' });
    mockedFtSearch
      .mockResolvedValueOnce(makeFtResponse([makeCluster([entryPro])]))
      .mockResolvedValueOnce(makeFtResponse([makeCluster([entrySchool])]));

    const prResult = await searchDocumentation(ctx, {
      query: 'filter-test',
      product: 'jamf-pro',
    });
    const scResult = await searchDocumentation(ctx, {
      query: 'filter-test',
      product: 'jamf-school',
    });

    expect(prResult.results[0].title).toBe('Pro Result');
    expect(scResult.results[0].title).toBe('School Result');
    expect(mockedFtSearch).toHaveBeenCalledTimes(2);
  });

  it('should NOT cache results from SearchProvider', async () => {
    const customResults = [
      {
        title: 'Provider Result',
        url: 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/custom.html',
        snippet: 'Custom search result from provider.',
        product: 'Jamf Pro',
      },
    ];

    const ctxWithProvider = createMockContext({
      searchProvider: {
        search: vi.fn().mockResolvedValue(customResults),
      },
    });

    await searchDocumentation(ctxWithProvider, { query: 'provider-test' });

    // Cache should not have been written
    expect(ctxWithProvider.cache.set).not.toHaveBeenCalled();
  });

  it('should cache results keyed by locale', async () => {
    const entryEn = makeTopicEntry({ title: 'English Result' });
    const entryJa = makeTopicEntry({ title: 'Japanese Result' });
    mockedFtSearch
      .mockResolvedValueOnce(makeFtResponse([makeCluster([entryEn])]))
      .mockResolvedValueOnce(makeFtResponse([makeCluster([entryJa])]));

    await searchDocumentation(ctx, { query: 'locale-test', language: 'en-US' });
    await searchDocumentation(ctx, { query: 'locale-test', language: 'ja-JP' });

    // Both should call FT API since locale differs
    expect(mockedFtSearch).toHaveBeenCalledTimes(2);
  });

  it('should share cache across different page requests', async () => {
    const entries = Array.from({ length: 10 }, (_, i) =>
      makeTopicEntry({
        title: `Paged Result ${i + 1}`,
        contentId: `topic-pg-${i}`,
        metadata: makeMetadata({
          'zoominmetadata': ['product-pro'],
          'ft:prettyUrl': [`/en-US/bundle/jamf-pro-documentation/page/pg-${i}.html`],
          'version': ['11.5.0'],
        }),
      })
    );
    mockedFtSearch.mockResolvedValueOnce(
      makeFtResponse([makeCluster(entries)])
    );

    // Page 1
    const page1 = await searchDocumentation(ctx, {
      query: 'page-cache-test',
      limit: 5,
      page: 1,
    });
    expect(page1.results).toHaveLength(5);

    // Page 2 — should use cached results, no second API call
    const page2 = await searchDocumentation(ctx, {
      query: 'page-cache-test',
      limit: 5,
      page: 2,
    });
    expect(page2.results).toHaveLength(5);
    expect(mockedFtSearch).toHaveBeenCalledTimes(1);
  });

  it('should pass cacheTtl.search as TTL to cache.set', async () => {
    const entry = makeTopicEntry();
    mockedFtSearch.mockResolvedValueOnce(
      makeFtResponse([makeCluster([entry])])
    );

    await searchDocumentation(ctx, { query: 'ttl-test' });

    expect(ctx.cache.set).toHaveBeenCalledWith(
      expect.stringContaining('ft-search:'),
      expect.any(Array),
      ctx.config.cacheTtl.search,
    );
  });
});
