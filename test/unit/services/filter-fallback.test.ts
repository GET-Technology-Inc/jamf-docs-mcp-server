/**
 * Unit tests for search filter fallback mechanism
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { searchDocumentation } from '../../../src/services/scraper.js';
import { cache } from '../../../src/services/cache.js';

vi.mock('axios');
vi.mock('../../../src/services/cache.js', () => ({
  cache: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
  },
}));

function makeSearchResponse(results: { title: string; url: string; snippet: string; bundle_id: string; score?: number }[]): object {
  return {
    status: 'OK',
    Results: results.map(r => ({
      leading_result: {
        title: r.title,
        url: r.url,
        snippet: r.snippet,
        bundle_id: r.bundle_id,
        page_id: 'page-1',
        publication_title: 'Jamf Docs',
        score: r.score ?? 1.0,
      },
    })),
    Pagination: { CurrentPage: 1, TotalPages: 1, ResultsPerPage: 50, TotalResults: results.length },
  };
}

describe('Search filter fallback', () => {
  beforeEach(() => {
    vi.mocked(cache.get).mockResolvedValue(null);
    vi.mocked(cache.set).mockResolvedValue(undefined);
  });

  it('should relax docType first when multi-filter returns zero results', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: makeSearchResponse([
        {
          title: 'Jamf Pro MDM Article',
          url: 'https://learn-be.jamf.com/article.html',
          snippet: 'MDM enrollment configuration profile for device management',
          bundle_id: 'jamf-pro-documentation',
        },
      ]),
    });

    // product=jamf-pro matches, but docType=release-notes does not
    const result = await searchDocumentation({
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
    vi.mocked(axios.get).mockResolvedValue({
      data: makeSearchResponse([
        {
          title: 'School Article',
          url: 'https://learn-be.jamf.com/school.html',
          snippet: 'Jamf School education content',
          bundle_id: 'jamf-school-documentation',
        },
      ]),
    });

    const result = await searchDocumentation({
      query: 'test',
      product: 'jamf-pro',
    });

    expect(result.results).toHaveLength(1);
    expect(result.filterRelaxation).toBeDefined();
    expect(result.filterRelaxation!.removed).toContain('product');
  });

  it('should NOT trigger fallback when no filters are applied', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: makeSearchResponse([]),
    });

    const result = await searchDocumentation({ query: 'nonexistent-xyz' });

    expect(result.results).toHaveLength(0);
    expect(result.filterRelaxation).toBeUndefined();
  });

  it('should NOT trigger fallback when filters match results', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: makeSearchResponse([
        {
          title: 'Jamf Pro Config',
          url: 'https://learn-be.jamf.com/pro.html',
          snippet: 'Configuration content',
          bundle_id: 'jamf-pro-documentation',
        },
      ]),
    });

    const result = await searchDocumentation({
      query: 'config',
      product: 'jamf-pro',
    });

    expect(result.results).toHaveLength(1);
    expect(result.filterRelaxation).toBeUndefined();
  });

  it('should include filterRelaxation message with removed filters', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: makeSearchResponse([
        {
          title: 'Generic Article',
          url: 'https://learn-be.jamf.com/gen.html',
          snippet: 'Some generic content about various topics in device management',
          bundle_id: 'jamf-school-documentation',
        },
      ]),
    });

    const result = await searchDocumentation({
      query: 'test',
      product: 'jamf-pro',
      docType: 'release-notes',
    });

    expect(result.filterRelaxation).toBeDefined();
    expect(result.filterRelaxation!.message).toContain('Removed filter');
    expect(result.filterRelaxation!.removed.length).toBeGreaterThan(0);
  });
});
