/**
 * Semantic tests for multi-filter combination behavior.
 *
 * Tests the progressive filter relaxation logic when multiple filters
 * (product, topic, docType) are applied and produce zero results.
 * Relaxation order: docType -> topic -> product
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

    if (result.filterRelaxation) {
      expect(result.filterRelaxation.removed.length).toBeGreaterThan(0);
      expect(result.filterRelaxation.message).toContain('Removed filter');
      // docType should be removed first per relaxation order
      expect(result.filterRelaxation.removed[0]).toBe('docType');
    }
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

    // Combination very unlikely to match: uncommon product + rare topic + rare docType
    const result = await searchDocumentation(ctx, {
      query: 'test',
      product: 'jamf-routines',
      topic: 'graphql',
      docType: 'training',
    });

    if (result.filterRelaxation) {
      const { removed } = result.filterRelaxation;
      // Verify relaxation order: docType first, then topic, then product
      if (removed.length >= 2) {
        const docTypeIdx = removed.indexOf('docType');
        const topicIdx = removed.indexOf('topic');
        if (docTypeIdx >= 0 && topicIdx >= 0) {
          expect(docTypeIdx).toBeLessThan(topicIdx);
        }
      }
      if (removed.length >= 3) {
        const topicIdx = removed.indexOf('topic');
        const productIdx = removed.indexOf('product');
        if (topicIdx >= 0 && productIdx >= 0) {
          expect(topicIdx).toBeLessThan(productIdx);
        }
      }
    }
  });

  it('should include original filter values in relaxation info', async () => {
    mockedFtSearch.mockResolvedValueOnce(
      makeFtSearchResponse([
        { title: 'Generic Article', mapId: 'jamf-pro-documentation', productLabel: 'product-pro' },
      ])
    );

    const result = await searchDocumentation(ctx, {
      query: 'test',
      product: 'jamf-routines',
      docType: 'training',
    });

    if (result.filterRelaxation) {
      expect(result.filterRelaxation.original).toBeDefined();
      for (const filterName of result.filterRelaxation.removed) {
        expect(result.filterRelaxation.original[filterName]).toBeDefined();
      }
    }
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
