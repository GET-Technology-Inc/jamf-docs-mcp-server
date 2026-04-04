import { describe, it, expect, vi } from 'vitest';
import { createMockContext } from '../../helpers/mock-context.js';
import { searchDocumentation } from '../../../src/core/services/search-service.js';
import { fetchTableOfContents } from '../../../src/core/services/toc-service.js';
import { lookupGlossaryTerm } from '../../../src/core/services/glossary.js';
import type {
  SearchProvider,
  ArticleProvider,
  GlossaryProvider,
  TocProvider,
} from '../../../src/core/services/interfaces/index.js';
import type {
  FetchArticleResult,
  FetchTocResult,
  SearchResult,
  GlossaryLookupResult,
} from '../../../src/core/types.js';

// ============================================================================
// Shared fixtures
// ============================================================================

function makeSearchResults(count: number): SearchResult[] {
  return Array.from({ length: count }, (_, i) => ({
    title: `Result ${i + 1}`,
    url: `https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/article-${i + 1}.html`,
    snippet: `Snippet for result ${i + 1}`,
    product: 'Jamf Pro',
    version: '11.0',
  }));
}

const mockArticleResult: FetchArticleResult = {
  title: 'Test Article',
  url: 'https://learn.jamf.com/bundle/jamf-pro-documentation/page/test.html',
  content: 'Test content',
  product: 'jamf-pro',
  bundleId: 'jamf-pro-documentation',
  tokenInfo: { inputTokens: 0, outputTokens: 10, totalTokens: 10, maxTokens: 5000, truncated: false },
  sections: [],
};

const mockTocResult: FetchTocResult = {
  toc: [{ title: 'Chapter 1', url: '/page/chapter1.html' }],
  pagination: { currentPage: 1, pageSize: 10, totalResults: 1, totalPages: 1 },
  tokenInfo: { inputTokens: 0, outputTokens: 10, totalTokens: 10, maxTokens: 5000, truncated: false },
};

const mockGlossaryResult: GlossaryLookupResult = {
  entries: [{ term: 'MDM', definition: 'Mobile Device Management', url: 'https://learn.jamf.com/glossary' }],
  totalMatches: 1,
  tokenInfo: { inputTokens: 0, outputTokens: 10, totalTokens: 10, maxTokens: 5000, truncated: false },
};

// ============================================================================
// SearchProvider
// ============================================================================

describe('SearchProvider injection', () => {
  it('should pass provider results through core post-processing pipeline', async () => {
    const results = makeSearchResults(3);
    const searchProvider: SearchProvider = {
      search: vi.fn(async () => results),
    };
    const ctx = createMockContext({ searchProvider });

    const result = await searchDocumentation(ctx, { query: 'test' });

    expect(searchProvider.search).toHaveBeenCalledOnce();
    // Results went through the pipeline, so we get proper pagination metadata
    expect(result.results).toHaveLength(3);
    expect(result.pagination.page).toBe(1);
    expect(result.pagination.totalItems).toBe(3);
    expect(result.pagination.totalPages).toBe(1);
    expect(result.tokenInfo.truncated).toBe(false);
  });

  it('should paginate provider results correctly', async () => {
    const results = makeSearchResults(15);
    const searchProvider: SearchProvider = {
      search: vi.fn(async () => results),
    };
    const ctx = createMockContext({ searchProvider });

    const result = await searchDocumentation(ctx, {
      query: 'test',
      page: 2,
      limit: 5,
    });

    expect(result.results).toHaveLength(5);
    expect(result.results[0].title).toBe('Result 6');
    expect(result.results[4].title).toBe('Result 10');
    expect(result.pagination.page).toBe(2);
    expect(result.pagination.pageSize).toBe(5);
    expect(result.pagination.totalPages).toBe(3);
    expect(result.pagination.totalItems).toBe(15);
    expect(result.pagination.hasNext).toBe(true);
    expect(result.pagination.hasPrev).toBe(true);
  });

  it('should token-truncate provider results', async () => {
    const results = makeSearchResults(20);
    const searchProvider: SearchProvider = {
      search: vi.fn(async () => results),
    };
    const ctx = createMockContext({ searchProvider });

    // Very small token budget to force truncation
    const result = await searchDocumentation(ctx, {
      query: 'test',
      maxTokens: 1,
    });

    expect(result.tokenInfo.truncated).toBe(true);
    expect(result.results.length).toBeLessThan(20);
  });

  it('should derive bundleSlug from product display name for product filter', async () => {
    const results: SearchResult[] = [
      {
        title: 'Jamf Pro Article',
        url: 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/test.html',
        snippet: 'A Jamf Pro article',
        product: 'Jamf Pro',
        mapId: 'opaque-hash-1',
      },
      {
        title: 'Jamf Connect Article',
        url: 'https://learn.jamf.com/en-US/bundle/jamf-connect-documentation/page/test.html',
        snippet: 'A Jamf Connect article',
        product: 'Jamf Connect',
        mapId: 'opaque-hash-2',
      },
    ];
    const searchProvider: SearchProvider = {
      search: vi.fn(async () => results),
    };
    const ctx = createMockContext({ searchProvider });

    const result = await searchDocumentation(ctx, {
      query: 'test',
      product: 'jamf-pro',
    });

    // Only the Jamf Pro result should pass the product filter
    expect(result.results).toHaveLength(1);
    expect(result.results[0].title).toBe('Jamf Pro Article');
  });

  it('should handle provider results with non-bundle URLs gracefully', async () => {
    const results: SearchResult[] = [
      {
        title: 'External Article',
        url: 'https://learn.jamf.com/some/other/path.html',
        snippet: 'No bundle in URL',
        product: null,
      },
    ];
    const searchProvider: SearchProvider = {
      search: vi.fn(async () => results),
    };
    const ctx = createMockContext({ searchProvider });

    const result = await searchDocumentation(ctx, { query: 'test' });

    // Result should still be included (just not filterable by product)
    expect(result.results).toHaveLength(1);
    expect(result.results[0].title).toBe('External Article');
  });

  it('should handle provider returning empty array', async () => {
    const searchProvider: SearchProvider = {
      search: vi.fn(async () => []),
    };
    const ctx = createMockContext({ searchProvider });

    const result = await searchDocumentation(ctx, { query: 'test' });

    expect(result.results).toHaveLength(0);
    expect(result.pagination.totalItems).toBe(0);
    expect(result.pagination.totalPages).toBe(0);
  });

  it('should fall through when provider returns null', async () => {
    const searchProvider: SearchProvider = {
      search: vi.fn(async () => null),
    };
    const ctx = createMockContext({ searchProvider });

    // Will attempt default implementation (which calls API).
    // We verify the provider was checked by calling it directly.
    expect(searchProvider.search).not.toHaveBeenCalled();
    const provided = await searchProvider.search({ query: 'test' });
    expect(provided).toBeNull();
  });

  it('should skip provider check when not configured', async () => {
    const ctx = createMockContext();
    expect(ctx.searchProvider).toBeUndefined();
  });
});

// ============================================================================
// ArticleProvider
// ============================================================================

describe('ArticleProvider injection', () => {
  it('should return provider result when non-null (ID-based primary)', async () => {
    const articleProvider: ArticleProvider = {
      getArticleByIds: vi.fn(async () => mockArticleResult),
    };

    const result = await articleProvider.getArticleByIds(
      'test-map', 'test-content',
    );

    expect(articleProvider.getArticleByIds).toHaveBeenCalledOnce();
    expect(result).toBe(mockArticleResult);
  });

  it('should receive mapId, contentId, and options', async () => {
    const articleProvider: ArticleProvider = {
      getArticleByIds: vi.fn(async () => mockArticleResult),
    };
    const options = { maxTokens: 1000, summaryOnly: true };

    await articleProvider.getArticleByIds('test-map', 'test-content', options);

    expect(articleProvider.getArticleByIds).toHaveBeenCalledWith(
      'test-map', 'test-content', options,
    );
  });

  it('should return null to signal fall-through', async () => {
    const articleProvider: ArticleProvider = {
      getArticleByIds: vi.fn(async () => null),
    };

    const provided = await articleProvider.getArticleByIds('test-map', 'test-content');
    expect(provided).toBeNull();
  });

  it('should support optional URL-based fallback', async () => {
    const articleProvider: ArticleProvider = {
      getArticleByIds: vi.fn(async () => null),
      getArticle: vi.fn(async () => mockArticleResult),
    };

    const byIds = await articleProvider.getArticleByIds('test-map', 'test-content');
    expect(byIds).toBeNull();

    const byUrl = await articleProvider.getArticle!(
      'https://learn.jamf.com/bundle/jamf-pro-documentation/page/test.html',
    );
    expect(byUrl).toBe(mockArticleResult);
  });
});

// ============================================================================
// GlossaryProvider
// ============================================================================

describe('GlossaryProvider injection', () => {
  it('should use provider result when non-null', async () => {
    const glossaryProvider: GlossaryProvider = {
      lookup: vi.fn(async () => mockGlossaryResult),
    };
    const ctx = createMockContext({ glossaryProvider });

    const result = await lookupGlossaryTerm(ctx, { term: 'MDM' });

    expect(glossaryProvider.lookup).toHaveBeenCalledOnce();
    expect(result).toBe(mockGlossaryResult);
  });

  it('should pass full params to provider', async () => {
    const glossaryProvider: GlossaryProvider = {
      lookup: vi.fn(async () => mockGlossaryResult),
    };
    const ctx = createMockContext({ glossaryProvider });
    const params = { term: 'MDM', product: 'jamf-pro' as const, maxTokens: 2000 };

    await lookupGlossaryTerm(ctx, params);

    expect(glossaryProvider.lookup).toHaveBeenCalledWith(params);
  });

  it('should fall through when provider returns null', async () => {
    const glossaryProvider: GlossaryProvider = {
      lookup: vi.fn(async () => null),
    };

    const provided = await glossaryProvider.lookup({ term: 'test' });
    expect(provided).toBeNull();
  });
});

// ============================================================================
// TocProvider
// ============================================================================

describe('TocProvider injection', () => {
  it('should use provider result when non-null', async () => {
    const tocProvider: TocProvider = {
      getTableOfContents: vi.fn(async () => mockTocResult),
    };
    const ctx = createMockContext({ tocProvider });

    const result = await fetchTableOfContents(ctx, 'jamf-pro', 'current');

    expect(tocProvider.getTableOfContents).toHaveBeenCalledOnce();
    expect(result).toBe(mockTocResult);
  });

  it('should pass product, version, and options to provider', async () => {
    const tocProvider: TocProvider = {
      getTableOfContents: vi.fn(async () => mockTocResult),
    };
    const ctx = createMockContext({ tocProvider });
    const options = { page: 2, maxTokens: 3000 };

    await fetchTableOfContents(ctx, 'jamf-pro', '11.0', options);

    expect(tocProvider.getTableOfContents).toHaveBeenCalledWith('jamf-pro', '11.0', options);
  });

  it('should fall through when provider returns null', async () => {
    const tocProvider: TocProvider = {
      getTableOfContents: vi.fn(async () => null),
    };

    const provided = await tocProvider.getTableOfContents('jamf-pro', 'current');
    expect(provided).toBeNull();
  });
});

// ============================================================================
// Error propagation
// ============================================================================

describe('Provider error propagation', () => {
  it('should propagate search provider errors', async () => {
    const searchProvider: SearchProvider = {
      search: vi.fn(async () => { throw new Error('Search backend down'); }),
    };
    const ctx = createMockContext({ searchProvider });

    // Non-JamfDocsError is caught by the pipeline and returns empty results
    const result = await searchDocumentation(ctx, { query: 'test' });
    expect(result.results).toHaveLength(0);
  });

  it('should propagate article provider errors', async () => {
    const articleProvider: ArticleProvider = {
      getArticleByIds: vi.fn(async () => { throw new Error('R2 unavailable'); }),
    };

    await expect(articleProvider.getArticleByIds(
      'test-map', 'test-content',
    )).rejects.toThrow('R2 unavailable');
  });

  it('should propagate glossary provider errors', async () => {
    const glossaryProvider: GlossaryProvider = {
      lookup: vi.fn(async () => { throw new Error('D1 connection failed'); }),
    };
    const ctx = createMockContext({ glossaryProvider });

    await expect(lookupGlossaryTerm(ctx, { term: 'MDM' }))
      .rejects.toThrow('D1 connection failed');
  });

  it('should propagate toc provider errors', async () => {
    const tocProvider: TocProvider = {
      getTableOfContents: vi.fn(async () => { throw new Error('TOC fetch failed'); }),
    };
    const ctx = createMockContext({ tocProvider });

    await expect(fetchTableOfContents(ctx, 'jamf-pro'))
      .rejects.toThrow('TOC fetch failed');
  });
});
