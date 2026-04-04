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
    expect(result.filterRelaxation!.original['docType']).toBe('release-notes');
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
});
