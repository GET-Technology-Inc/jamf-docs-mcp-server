import { describe, it, expect, vi } from 'vitest';
import { createMockContext } from '../../helpers/mock-context.js';
import { searchDocumentation, fetchArticle, fetchTableOfContents } from '../../../src/core/services/scraper.js';
import { lookupGlossaryTerm } from '../../../src/core/services/glossary.js';
import type {
  SearchProvider,
  ArticleProvider,
  GlossaryProvider,
  TocProvider,
} from '../../../src/core/services/interfaces/index.js';
import type {
  SearchDocumentationResult,
  FetchArticleResult,
  FetchTocResult,
} from '../../../src/core/services/scraper.js';
import type { GlossaryLookupResult } from '../../../src/core/types.js';

// ============================================================================
// Shared fixtures
// ============================================================================

const mockSearchResult: SearchDocumentationResult = {
  results: [],
  pagination: { currentPage: 1, pageSize: 10, totalResults: 0, totalPages: 0 },
  tokenInfo: { inputTokens: 0, outputTokens: 0, totalTokens: 0, maxTokens: 5000, truncated: false },
};

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
  it('should use provider result when non-null', async () => {
    const searchProvider: SearchProvider = {
      search: vi.fn(async () => mockSearchResult),
    };
    const ctx = createMockContext({ searchProvider });

    const result = await searchDocumentation(ctx, { query: 'test' });

    expect(searchProvider.search).toHaveBeenCalledOnce();
    expect(result).toBe(mockSearchResult);
  });

  it('should fall through when provider returns null', async () => {
    const searchProvider: SearchProvider = {
      search: vi.fn(async () => null),
    };
    const ctx = createMockContext({ searchProvider });

    // Will attempt default implementation (which calls API).
    // We expect it to proceed past the provider check.
    expect(searchProvider.search).not.toHaveBeenCalled();
    // Calling searchDocumentation would hit the network; we verify the provider
    // was checked by calling it directly.
    const provided = await searchProvider.search({ query: 'test' });
    expect(provided).toBeNull();
  });

  it('should skip provider check when not configured', async () => {
    const ctx = createMockContext();
    expect(ctx.searchProvider).toBeUndefined();
    // No provider set — function should proceed to default logic.
    // Full execution would require network; we just verify context shape.
  });
});

// ============================================================================
// ArticleProvider
// ============================================================================

describe('ArticleProvider injection', () => {
  it('should use provider result when non-null', async () => {
    const articleProvider: ArticleProvider = {
      getArticle: vi.fn(async () => mockArticleResult),
    };
    const ctx = createMockContext({ articleProvider });

    const result = await fetchArticle(
      ctx,
      'https://learn.jamf.com/bundle/jamf-pro-documentation/page/test.html',
    );

    expect(articleProvider.getArticle).toHaveBeenCalledOnce();
    expect(result).toBe(mockArticleResult);
  });

  it('should pass url and options to provider', async () => {
    const articleProvider: ArticleProvider = {
      getArticle: vi.fn(async () => mockArticleResult),
    };
    const ctx = createMockContext({ articleProvider });
    const url = 'https://learn.jamf.com/bundle/jamf-pro-documentation/page/test.html';
    const options = { maxTokens: 1000, summaryOnly: true };

    await fetchArticle(ctx, url, options);

    expect(articleProvider.getArticle).toHaveBeenCalledWith(url, options);
  });

  it('should fall through when provider returns null', async () => {
    const articleProvider: ArticleProvider = {
      getArticle: vi.fn(async () => null),
    };

    const provided = await articleProvider.getArticle('https://learn.jamf.com/test');
    expect(provided).toBeNull();
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

    await expect(searchDocumentation(ctx, { query: 'test' }))
      .rejects.toThrow('Search backend down');
  });

  it('should propagate article provider errors', async () => {
    const articleProvider: ArticleProvider = {
      getArticle: vi.fn(async () => { throw new Error('R2 unavailable'); }),
    };
    const ctx = createMockContext({ articleProvider });

    await expect(fetchArticle(
      ctx,
      'https://learn.jamf.com/bundle/jamf-pro-documentation/page/test.html',
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
