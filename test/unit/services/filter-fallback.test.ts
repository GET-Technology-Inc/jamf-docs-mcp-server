/**
 * Unit tests for search filter fallback mechanism
 *
 * Tests progressive filter relaxation in the search-service
 * when applied filters produce zero results.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/core/services/ft-client.js', () => ({
  search: vi.fn(),
  fetchMaps: vi.fn().mockResolvedValue([]),
  fetchMapTopics: vi.fn().mockResolvedValue([]),
}));

import { search as ftSearch } from '../../../src/core/services/ft-client.js';
import { searchDocumentation } from '../../../src/core/services/search-service.js';
import { createMockContext } from '../../helpers/mock-context.js';
import { makeFtSearchResponse } from '../../helpers/fixtures.js';

const ctx = createMockContext();

const mockedFtSearch = vi.mocked(ftSearch);

describe('Search filter fallback', () => {
  beforeEach(() => {
    // Call history AND implementation: the re-query tests below assert an exact
    // call count, and one of them installs a mockImplementation that must not
    // leak into the next test.
    mockedFtSearch.mockReset();
    vi.mocked(ctx.cache.get).mockResolvedValue(null);
    vi.mocked(ctx.cache.set).mockResolvedValue(undefined);
  });

  it('should relax docType first when multi-filter returns zero results', async () => {
    mockedFtSearch.mockResolvedValue(
      makeFtSearchResponse([
        {
          title: 'Jamf Pro MDM Article',
          mapId: 'jamf-pro-documentation',
          snippet: 'MDM enrollment configuration profile for device management',
          productLabel: 'product-pro',
          // Documentation and nothing else — a topic that really is only a
          // release note carries `content-releasenotes` here as well, and must
          // NOT be relaxed out of this search.
          contentLabels: ['content-techdocs'],
          contentType: 'Technical Documentation',
        },
      ])
    );

    // product=jamf-pro matches (mapId slug), but docType=release-notes does not
    const result = await searchDocumentation(ctx, {
      query: 'enrollment',
      product: 'jamf-pro',
      docType: 'release-notes',
    });

    expect(result.results).toHaveLength(1);
    expect(result.filterRelaxation).toBeDefined();
    expect(result.filterRelaxation!.removed).toContain('docType');
    expect(result.filterRelaxation!.original.docType).toBe('release-notes');
  });

  it('should relax single filter when it matches nothing', async () => {
    mockedFtSearch.mockResolvedValue(
      makeFtSearchResponse([
        {
          title: 'School Article',
          mapId: 'jamf-school-documentation',
          snippet: 'Jamf School education content',
          productLabel: 'product-school',
        },
      ])
    );

    const result = await searchDocumentation(ctx, {
      query: 'test',
      product: 'jamf-pro',
    });

    expect(result.results).toHaveLength(1);
    expect(result.filterRelaxation).toBeDefined();
    expect(result.filterRelaxation!.removed).toContain('product');
  });

  it('should NOT trigger fallback when no filters are applied', async () => {
    mockedFtSearch.mockResolvedValue(
      makeFtSearchResponse([])
    );

    const result = await searchDocumentation(ctx, { query: 'nonexistent-xyz' });

    expect(result.results).toHaveLength(0);
    expect(result.filterRelaxation).toBeUndefined();
  });

  it('should NOT trigger fallback when filters match results', async () => {
    mockedFtSearch.mockResolvedValue(
      makeFtSearchResponse([
        {
          title: 'Jamf Pro Config',
          mapId: 'jamf-pro-documentation',
          snippet: 'Configuration content',
          productLabel: 'product-pro',
        },
      ])
    );

    const result = await searchDocumentation(ctx, {
      query: 'config',
      product: 'jamf-pro',
    });

    expect(result.results).toHaveLength(1);
    expect(result.filterRelaxation).toBeUndefined();
  });

  it('should include filterRelaxation message with removed filters', async () => {
    mockedFtSearch.mockResolvedValue(
      makeFtSearchResponse([
        {
          title: 'Generic Article',
          mapId: 'jamf-school-documentation',
          snippet: 'Some generic content about various topics in device management',
          productLabel: 'product-school',
          contentType: 'Technical Documentation',
        },
      ])
    );

    const result = await searchDocumentation(ctx, {
      query: 'test',
      product: 'jamf-pro',
      docType: 'release-notes',
    });

    expect(result.filterRelaxation).toBeDefined();
    expect(result.filterRelaxation!.message).toContain('Removed filter');
    expect(result.filterRelaxation!.removed.length).toBeGreaterThan(0);
  });
  // Regression guard for the upstream half of the relaxation.
  //
  // docType is sent to FT as a `content-*` filter, so a product+docType pair
  // whose labels never co-occur (Jamf publishes no Jamf Protect solution
  // guides, for instance) comes back EMPTY from the API rather than coming
  // back broad for the post-filter to narrow. applyFiltersWithFallback is
  // client-side and cannot relax what was never fetched, so without the
  // re-query the user gets a bare "no results" that does not even name docType
  // as the cause. resolveSearchResults drops docType and asks again.
  it('re-queries upstream without docType when the filtered query returns nothing', async () => {
    const productOnly = makeFtSearchResponse([
      {
        title: 'Jamf Pro MDM Article',
        mapId: 'jamf-pro-documentation',
        snippet: 'MDM enrollment configuration profile for device management',
        productLabel: 'product-pro',
        contentLabels: ['content-techdocs'],
        contentType: 'Technical Documentation',
      },
    ]);

    // First call carries the docType label and comes back empty — exactly how
    // the live API behaves for a non-co-occurring pair; the retry does not.
    mockedFtSearch
      .mockResolvedValueOnce(makeFtSearchResponse([]))
      .mockResolvedValueOnce(productOnly);

    const result = await searchDocumentation(ctx, {
      query: 'enrollment',
      product: 'jamf-pro',
      docType: 'solution-guide',
    });

    expect(mockedFtSearch).toHaveBeenCalledTimes(2);
    const [first, second] = mockedFtSearch.mock.calls.map(c => c[0]);
    expect(first.filters?.some(f => f.values.includes('content-solutionguide'))).toBe(true);
    expect(second.filters?.some(f => f.values.some(v => v.startsWith('content-')))).toBe(false);
    // The product filter must survive the retry — only docType is relaxed.
    expect(second.filters?.some(f => f.values.includes('product-pro'))).toBe(true);

    expect(result.results).toHaveLength(1);
    expect(result.filterRelaxation?.removed).toContain('docType');
  });

  it('does not re-query when the filtered query already returned results', async () => {
    mockedFtSearch.mockResolvedValue(
      makeFtSearchResponse([
        {
          title: 'Jamf Pro Release Notes',
          mapId: 'jamf-pro-documentation',
          snippet: 'What changed in this release of Jamf Pro',
          productLabel: 'product-pro',
          contentLabels: ['content-techdocs', 'content-releasenotes'],
          contentType: 'Release Notes',
        },
      ])
    );

    const result = await searchDocumentation(ctx, {
      query: 'enrollment',
      product: 'jamf-pro',
      docType: 'release-notes',
    });

    expect(mockedFtSearch).toHaveBeenCalledTimes(1);
    expect(result.filterRelaxation).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Cached values must not depend on client-side-only params
// ---------------------------------------------------------------------------

describe('topic filtering across a warm cache', () => {
  // `matchedTopics` used to be computed only when the caller passed a topic,
  // which made the cached value a function of something that is not in the FT
  // request the key is derived from. A topic-less search wrote entries with
  // `matchedTopics: []`; the next search for the same query WITH a topic hit
  // that entry, matched nothing, and silently relaxed the topic filter it had
  // never run — the same question answered differently depending on cache
  // state. Sharing the entry is correct; relaxing the filter was not.
  it('runs the topic filter against an entry written by a topic-less search', async () => {
    const warmCtx = createMockContext();
    const store = new Map<string, unknown>();
    // Awaits a resolved promise so these stand in for real async calls — they
    // yield to the microtask queue the way the code they replace does. Same
    // shape as the cache mocks in metadata.test.ts.
    vi.mocked(warmCtx.cache.get).mockImplementation(async (k) => {
      await Promise.resolve();
      return (store.has(k) ? store.get(k) : null);
    });
    vi.mocked(warmCtx.cache.set).mockImplementation(async (k, v) => {
      await Promise.resolve();
      store.set(k, v);
    });

    mockedFtSearch.mockResolvedValue(makeFtSearchResponse([
      {
        title: 'Configuring FileVault disk encryption',
        mapId: 'jamf-pro-documentation',
        snippet: 'disk encryption FileVault policy configuration',
        productLabel: 'product-pro',
        contentLabels: ['content-techdocs'],
      },
    ]));

    // Populates the cache with no topic in play.
    await searchDocumentation(warmCtx, { query: 'encryption', language: 'en-US' });
    expect(store.size).toBe(1);

    // Same FT request, so the same entry is reused — that part is intended.
    const warm = await searchDocumentation(warmCtx, {
      query: 'encryption', topic: 'filevault', language: 'en-US',
    });

    expect(store.size, 'topic is client-side; it must not fork the cache').toBe(1);
    expect(warm.filterRelaxation, 'the topic filter must run, not be relaxed').toBeUndefined();
    expect(warm.results).toHaveLength(1);
  });
});
