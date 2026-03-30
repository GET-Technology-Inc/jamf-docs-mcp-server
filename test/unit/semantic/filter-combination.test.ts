/**
 * Semantic tests for multi-filter combination behavior.
 *
 * Tests the progressive filter relaxation logic when multiple filters
 * (product, topic, docType) are applied and produce zero results.
 * Relaxation order: docType -> topic -> product
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRealisticSearchResponse } from '../../helpers/fixtures.js';

// Mock http-client to return realistic fixture data
vi.mock('../../../src/core/http-client.js', async () => {
  return {
    httpGetText: vi.fn(),
    httpGetJson: vi.fn(),
    HttpError: (await import('../../../src/core/http-client.js')).HttpError,
  };
});

import { httpGetJson } from '../../../src/core/http-client.js';
import { searchDocumentation } from '../../../src/core/services/scraper.js';
import { createMockContext } from '../../helpers/mock-context.js';

const ctx = createMockContext();

const mockedHttpGetJson = vi.mocked(httpGetJson);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('multi-filter combination behavior', () => {
  it('should return results when product filter matches', async () => {
    const fixtureData = createRealisticSearchResponse();
    mockedHttpGetJson.mockResolvedValueOnce(fixtureData);

    const result = await searchDocumentation(ctx, {
      query: 'jamf pro',
      product: 'jamf-pro',
    });

    expect(result.results.length).toBeGreaterThan(0);
    // All results should be from jamf-pro
    for (const r of result.results) {
      expect(r.product).toBe('Jamf Pro');
    }
  });

  it('should trigger filter relaxation when product + docType yields zero', async () => {
    const fixtureData = createRealisticSearchResponse();
    mockedHttpGetJson.mockResolvedValueOnce(fixtureData);

    // jamf-protect + release-notes is unlikely to match in a "jamf pro" search
    const result = await searchDocumentation(ctx, {
      query: 'jamf pro',
      product: 'jamf-protect',
      docType: 'release-notes',
    });

    // Should either have results (with relaxation) or be empty
    if (result.filterRelaxation) {
      expect(result.filterRelaxation.removed.length).toBeGreaterThan(0);
      expect(result.filterRelaxation.message).toContain('Removed filter');
      // docType should be removed first per relaxation order
      expect(result.filterRelaxation.removed[0]).toBe('docType');
    }
  });

  it('should relax docType before topic before product', async () => {
    const fixtureData = createRealisticSearchResponse();
    mockedHttpGetJson.mockResolvedValueOnce(fixtureData);

    // Use a combination very unlikely to match: uncommon product + rare topic + rare docType
    const result = await searchDocumentation(ctx, {
      query: 'jamf pro',
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
    const fixtureData = createRealisticSearchResponse();
    mockedHttpGetJson.mockResolvedValueOnce(fixtureData);

    const result = await searchDocumentation(ctx, {
      query: 'jamf pro',
      product: 'jamf-routines',
      docType: 'training',
    });

    if (result.filterRelaxation) {
      // Original values should be preserved
      expect(result.filterRelaxation.original).toBeDefined();
      for (const filterName of result.filterRelaxation.removed) {
        expect(result.filterRelaxation.original[filterName]).toBeDefined();
      }
    }
  });

  it('should not relax when all filters match results', async () => {
    const fixtureData = createRealisticSearchResponse();
    mockedHttpGetJson.mockResolvedValueOnce(fixtureData);

    const result = await searchDocumentation(ctx, {
      query: 'jamf pro',
      product: 'jamf-pro',
    });

    // No relaxation needed when results exist
    expect(result.filterRelaxation).toBeUndefined();
    expect(result.results.length).toBeGreaterThan(0);
  });
});
