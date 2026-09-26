/**
 * Semantic tests for multi-filter combination behavior.
 *
 * Tests the progressive filter relaxation logic when multiple filters
 * (product, topic, docType) are applied and produce zero results.
 * Relaxation order: docType -> topic -> product
 *
 * The Fluid Topics stub here ignores the filters it is sent and always returns
 * the Jamf Pro fixture, which is what lets a product mismatch reach the local
 * filter at all: a real product search only returns documents Jamf files under
 * the product (see test/unit/tools/search-product-classification.test.ts).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/core/services/ft-client.js', () => ({
  search: vi.fn(),
  fetchMaps: vi.fn().mockResolvedValue([]),
  fetchMapTopics: vi.fn().mockResolvedValue([]),
}));

import { search as ftSearch } from '../../../src/core/services/ft-client.js';
import { searchDocumentation } from '../../../src/core/services/search-service.js';
import { createMockContext, createClassifyingMapsRegistry } from '../../helpers/mock-context.js';
import { makeFtSearchResponse } from '../../helpers/fixtures.js';

// Product-filtered searches resolve their classification axis through the
// registry, so it has to answer without reaching learn.jamf.com.
const ctx = createMockContext({ mapsRegistry: createClassifyingMapsRegistry() });

const mockedFtSearch = vi.mocked(ftSearch);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('multi-filter combination behavior', () => {
  it('should return results when product filter matches', async () => {
    mockedFtSearch.mockResolvedValueOnce(
      makeFtSearchResponse([
        { title: 'Config Profiles', mapId: 'jamf-pro-documentation', productLabel: 'product-pro' },
        { title: 'Smart Groups', mapId: 'jamf-pro-documentation', productLabel: 'product-pro' },
      ])
    );

    const result = await searchDocumentation(ctx, {
      query: 'jamf pro',
      product: 'jamf-pro',
    });

    expect(result.results.length).toBeGreaterThan(0);
    for (const r of result.results) {
      expect(r.product).toBe('Jamf Pro');
    }
  });

  it('should trigger filter relaxation when product + docType yields zero', async () => {
    mockedFtSearch.mockResolvedValueOnce(
      makeFtSearchResponse([
        {
          title: 'Jamf Pro Article',
          mapId: 'jamf-pro-documentation',
          productLabel: 'product-pro',
          contentType: 'Technical Documentation',
        },
      ])
    );

    // product=jamf-protect + docType=release-notes won't match jamf-pro + techdocs
    const result = await searchDocumentation(ctx, {
      query: 'test',
      product: 'jamf-protect',
      docType: 'release-notes',
    });

    // The fixture carries no `content-*` label, so docType lets it through and
    // the product is what excludes it. docType still goes first — relaxation
    // follows its order, not the culprit — and product second.
    expect(result.results.map(r => r.title)).toEqual(['Jamf Pro Article']);
    expect(result.filterRelaxation?.removed).toEqual(['docType', 'product']);
    expect(result.filterRelaxation?.message).toContain('Removed filter(s): docType, product.');
    // A relaxed product filter says nothing about the results, so they keep
    // their own product instead of being shown under the one asked for.
    expect(result.results.map(r => r.product)).toEqual(['Jamf Pro']);
  });

  it('should relax docType before topic before product', async () => {
    mockedFtSearch.mockResolvedValueOnce(
      makeFtSearchResponse([
        {
          title: 'Some Article',
          mapId: 'jamf-pro-documentation',
          productLabel: 'product-pro',
          contentType: 'Technical Documentation',
        },
      ])
    );

    // None of the three matches a Jamf Pro techdocs page about nothing in
    // particular. jamf-protect rather than jamf-routines: routines has no
    // classification to filter by, and this registry no map of its
    // publication, so it is reported up front instead of relaxed (next
    // test), and would not exercise this order.
    const result = await searchDocumentation(ctx, {
      query: 'test',
      product: 'jamf-protect',
      topic: 'graphql',
      docType: 'training',
    });

    expect(result.results.map(r => r.title)).toEqual(['Some Article']);
    expect(result.filterRelaxation?.removed).toEqual(['docType', 'topic', 'product']);
  });

  it('reports a product it cannot filter by up front, before relaxing anything', async () => {
    mockedFtSearch.mockResolvedValueOnce(
      makeFtSearchResponse([
        { title: 'Some Article', mapId: 'jamf-pro-documentation', productLabel: 'product-pro' },
      ])
    );

    // jamf-routines has no classification value, and createClassifying-
    // MapsRegistry has no map of its publication, so nothing was sent
    // upstream for it. It used to reach relaxation as an ordinary filter that
    // could never match, and was only removed after docType and topic.
    const result = await searchDocumentation(ctx, {
      query: 'test',
      product: 'jamf-routines',
      topic: 'graphql',
      docType: 'training',
    });

    const sentFilters = mockedFtSearch.mock.calls[0]?.[1].filters;
    expect(sentFilters).toEqual([{ key: 'zoominmetadata', values: ['content-training'] }]);
    expect(result.results.map(r => r.title)).toEqual(['Some Article']);
    expect(result.filterRelaxation?.removed).toEqual(['product', 'docType', 'topic']);
    expect(result.filterRelaxation?.message).toMatch(
      /^The product filter "jamf-routines" was not applied: .* No results with the remaining filters applied\. Removed filter\(s\): docType, topic\./,
    );
  });

  it('should include original filter values in relaxation info', async () => {
    mockedFtSearch.mockResolvedValueOnce(
      makeFtSearchResponse([
        { title: 'Generic Article', mapId: 'jamf-pro-documentation', productLabel: 'product-pro' },
      ])
    );

    const result = await searchDocumentation(ctx, {
      query: 'test',
      product: 'jamf-protect',
      docType: 'training',
    });

    expect(result.filterRelaxation?.removed).toEqual(['docType', 'product']);
    expect(result.filterRelaxation?.original).toEqual({ docType: 'training', product: 'jamf-protect' });
  });

  it('should not relax when all filters match results', async () => {
    mockedFtSearch.mockResolvedValueOnce(
      makeFtSearchResponse([
        { title: 'Config Profiles', mapId: 'jamf-pro-documentation', productLabel: 'product-pro' },
      ])
    );

    const result = await searchDocumentation(ctx, {
      query: 'jamf pro',
      product: 'jamf-pro',
    });

    expect(result.filterRelaxation).toBeUndefined();
    expect(result.results.length).toBeGreaterThan(0);
  });
});
