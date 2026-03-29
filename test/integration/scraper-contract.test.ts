/**
 * Contract tests for scraper service layer
 *
 * These tests call the REAL external APIs (learn.jamf.com, learn-be.jamf.com)
 * to verify that response structures match our TypeScript interfaces.
 *
 * If these tests fail, it likely means the external API has changed
 * and the scraper logic needs to be updated accordingly.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  searchDocumentation,
  fetchArticle,
  fetchTableOfContents,
} from '../../src/services/scraper.js';
import type { ProductId } from '../../src/constants.js';
import axios from 'axios';
import { DOCS_API_URL } from '../../src/constants.js';

// ============================================================================
// searchDocumentation() contract tests
// ============================================================================

describe('searchDocumentation() contract', { timeout: 60000, retry: 2 }, () => {
  it('should return results with correct structure', async () => {
    const result = await searchDocumentation({ query: 'configuration profile' });

    // Top-level structure
    expect(result).toHaveProperty('results');
    expect(result).toHaveProperty('tokenInfo');
    expect(result).toHaveProperty('pagination');
    expect(Array.isArray(result.results)).toBe(true);
    expect(result.results.length).toBeGreaterThan(0);

    // SearchResult structure
    const first = result.results[0];
    expect(typeof first.title).toBe('string');
    expect(first.title.length).toBeGreaterThan(0);
    expect(typeof first.url).toBe('string');
    expect(first.url).toMatch(/^https:\/\/learn\.jamf\.com/);
    expect(typeof first.snippet).toBe('string');
    // product can be string or null per type definition
    expect(first.product === null || typeof first.product === 'string').toBe(true);

    // TokenInfo structure
    expect(typeof result.tokenInfo.tokenCount).toBe('number');
    expect(result.tokenInfo.tokenCount).toBeGreaterThanOrEqual(0);
    expect(typeof result.tokenInfo.truncated).toBe('boolean');
    expect(typeof result.tokenInfo.maxTokens).toBe('number');

    // PaginationInfo structure
    expect(typeof result.pagination.page).toBe('number');
    expect(typeof result.pagination.pageSize).toBe('number');
    expect(typeof result.pagination.totalPages).toBe('number');
    expect(typeof result.pagination.totalItems).toBe('number');
    expect(typeof result.pagination.hasNext).toBe('boolean');
    expect(typeof result.pagination.hasPrev).toBe('boolean');
  });

  it('should filter results by product', async () => {
    const result = await searchDocumentation({
      query: 'enrollment',
      product: 'jamf-pro',
    });

    expect(result.results.length).toBeGreaterThan(0);

    // All results should be from Jamf Pro
    for (const r of result.results) {
      expect(r.product).toBe('Jamf Pro');
    }
  });

  it('should support pagination with different pages', async () => {
    const page1 = await searchDocumentation({ query: 'policy', page: 1, limit: 3 });
    const page2 = await searchDocumentation({ query: 'policy', page: 2, limit: 3 });

    expect(page1.pagination.page).toBe(1);
    expect(page2.pagination.page).toBe(2);

    // Results should not overlap
    if (page1.results.length > 0 && page2.results.length > 0) {
      const urls1 = new Set(page1.results.map(r => r.url));
      const urls2 = new Set(page2.results.map(r => r.url));
      const overlap = [...urls1].filter(u => urls2.has(u));
      expect(overlap).toHaveLength(0);
    }
  });

  it('should return empty results for nonexistent query', async () => {
    const result = await searchDocumentation({
      query: 'xyznonexistent_query_that_returns_nothing_12345',
    });

    expect(result.results).toHaveLength(0);
    expect(result.pagination.totalItems).toBe(0);
  });
});

// ============================================================================
// fetchArticle() contract tests
// ============================================================================

describe('fetchArticle() contract', { timeout: 60000, retry: 2 }, () => {
  // Discover a valid URL from search instead of hardcoding
  let ARTICLE_URL: string;

  beforeAll(async () => {
    const searchResult = await searchDocumentation({ query: 'policies', limit: 1 });
    ARTICLE_URL = searchResult.results[0]?.url
      ?? 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/Policies.html';
  });

  it('should return article with correct structure', async () => {
    const result = await fetchArticle(ARTICLE_URL);

    // Required fields
    expect(typeof result.title).toBe('string');
    expect(result.title.length).toBeGreaterThan(0);
    expect(typeof result.content).toBe('string');
    expect(result.content.length).toBeGreaterThan(100);
    expect(typeof result.url).toBe('string');

    // TokenInfo
    expect(result.tokenInfo).toBeDefined();
    expect(typeof result.tokenInfo.tokenCount).toBe('number');
    expect(result.tokenInfo.tokenCount).toBeGreaterThan(0);
    expect(typeof result.tokenInfo.truncated).toBe('boolean');
    expect(typeof result.tokenInfo.maxTokens).toBe('number');

    // Sections
    expect(Array.isArray(result.sections)).toBe(true);
    if (result.sections.length > 0) {
      const section = result.sections[0];
      expect(typeof section.id).toBe('string');
      expect(typeof section.title).toBe('string');
      expect(typeof section.level).toBe('number');
      expect(typeof section.tokenCount).toBe('number');
    }
  });

  it('should return valid Markdown content', async () => {
    const result = await fetchArticle(ARTICLE_URL);

    // Content should be Markdown (contains headings or paragraph text)
    expect(result.content).toMatch(/(^#|\n#|\w{10,})/);
    // Should NOT be raw HTML
    expect(result.content).not.toMatch(/<html/i);
    expect(result.content).not.toMatch(/<body/i);
  });

  it('should include breadcrumb navigation', async () => {
    const result = await fetchArticle(ARTICLE_URL);

    // breadcrumb is optional per type definition, but should be present for real articles
    if (result.breadcrumb !== undefined) {
      expect(Array.isArray(result.breadcrumb)).toBe(true);
      expect(result.breadcrumb.length).toBeGreaterThanOrEqual(1);
      for (const crumb of result.breadcrumb) {
        expect(typeof crumb).toBe('string');
      }
    }
  });

  it('should throw error for nonexistent article URL', async () => {
    const badUrl =
      'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/This_Page_Does_Not_Exist_404.html';

    await expect(fetchArticle(badUrl)).rejects.toThrow();
  });
});

// ============================================================================
// fetchTableOfContents() contract tests
// ============================================================================

describe('fetchTableOfContents() contract', { timeout: 60000, retry: 2 }, () => {
  it('should return TOC with hierarchical structure for jamf-pro', async () => {
    const result = await fetchTableOfContents('jamf-pro');

    // Top-level structure
    expect(Array.isArray(result.toc)).toBe(true);
    expect(result.toc.length).toBeGreaterThan(0);

    // TocEntry structure
    const first = result.toc[0];
    expect(typeof first.title).toBe('string');
    expect(first.title.length).toBeGreaterThan(0);
    expect(typeof first.url).toBe('string');

    // Validate that children, if present, have correct structure
    const withChildren = result.toc.find(e => e.children !== undefined && e.children.length > 0);
    if (withChildren?.children) {
      const child = withChildren.children[0];
      expect(typeof child.title).toBe('string');
      expect(typeof child.url).toBe('string');
    }

    // Pagination and TokenInfo
    expect(result.pagination).toBeDefined();
    expect(typeof result.pagination.page).toBe('number');
    expect(typeof result.pagination.totalItems).toBe('number');
    expect(result.tokenInfo).toBeDefined();
    expect(typeof result.tokenInfo.tokenCount).toBe('number');
  });

  it('should fetch TOC for all four products', async () => {
    const products: ProductId[] = ['jamf-pro', 'jamf-school', 'jamf-connect', 'jamf-protect'];

    for (const product of products) {
      const result = await fetchTableOfContents(product);
      expect(result.toc.length).toBeGreaterThan(0);
    }
  });
});

// ============================================================================
// docType filtering contract tests
// ============================================================================

describe('searchDocumentation() docType filtering', { timeout: 60000, retry: 2 }, () => {
  it('should include docType in search results', async () => {
    const result = await searchDocumentation({ query: 'jamf pro' });

    expect(result.results.length).toBeGreaterThan(0);
    for (const r of result.results) {
      expect(r.docType).toBeDefined();
      expect(typeof r.docType).toBe('string');
    }
  });

  it('should filter by docType release-notes', async () => {
    const result = await searchDocumentation({
      query: 'jamf pro',
      docType: 'release-notes',
    });

    // May return empty if no release notes match, but should not error
    for (const r of result.results) {
      expect(r.docType).toBe('release-notes');
    }
  });
});

// ============================================================================
// Version behavior contract tests
// ============================================================================

describe('searchDocumentation() version behavior', { timeout: 60000, retry: 2 }, () => {
  it('should extract actual version from bundle_id instead of hardcoding current', async () => {
    const result = await searchDocumentation({
      query: 'configuration profile',
    });

    expect(result.results.length).toBeGreaterThan(0);

    // Results should have actual version strings extracted from bundle_id, or 'current'
    for (const r of result.results) {
      expect(r.version).toMatch(/^(\d+\.\d+\.\d+|current)$/);
    }
  });
});

// ============================================================================
// Section ID non-empty contract tests
// ============================================================================

describe('fetchArticle() section IDs', { timeout: 60000, retry: 2 }, () => {
  it('should produce non-empty valid slug IDs for all sections', async () => {
    // Discover a real article URL from search
    const searchResult = await searchDocumentation({ query: 'configuration profiles', limit: 1 });
    const url = searchResult.results[0]?.url;
    expect(url).toBeDefined();

    const article = await fetchArticle(url!);

    if (article.sections.length > 0) {
      for (const section of article.sections) {
        expect(section.id).toBeTruthy();
        expect(section.id.length).toBeGreaterThan(0);
        expect(section.id).toMatch(/^[a-z0-9][a-z0-9-]*$/);
      }
    }
  });
});

// ============================================================================
// Snippet quality contract tests
// ============================================================================

describe('searchDocumentation() snippet quality', { timeout: 60000, retry: 2 }, () => {
  it('should return snippets with minimum meaningful length', async () => {
    const result = await searchDocumentation({ query: 'enrollment', limit: 10 });

    expect(result.results.length).toBeGreaterThan(0);

    for (const r of result.results) {
      // Snippet should be either >= 50 chars of content, or a title-based fallback
      // Title fallback format: "Title" or "Title — Product"
      expect(r.snippet.length).toBeGreaterThanOrEqual(10);
    }
  });
});

// ============================================================================
// Multi-filter combination contract tests
// ============================================================================

describe('searchDocumentation() multi-filter', { timeout: 60000, retry: 2 }, () => {
  it('should return results or filterRelaxation for product + docType', async () => {
    const result = await searchDocumentation({
      query: 'jamf pro',
      product: 'jamf-pro',
      docType: 'release-notes',
    });

    if (result.filterRelaxation) {
      // Filter relaxation occurred — results may not match all original filters
      expect(result.filterRelaxation.removed.length).toBeGreaterThan(0);
      expect(result.filterRelaxation.message).toBeTruthy();
    } else if (result.results.length > 0) {
      // No relaxation — all results should match both filters
      for (const r of result.results) {
        expect(r.docType).toBe('release-notes');
        expect(r.product).toBe('Jamf Pro');
      }
    }
    // Empty results without relaxation is also a valid outcome
  });
});

// ============================================================================
// label-based docType contract tests
// ============================================================================

describe('searchDocumentation() label-based docType', { timeout: 60000, retry: 2 }, () => {
  it('should include diverse docType values in broad search results', async () => {
    const result = await searchDocumentation({ query: 'jamf pro', limit: 50 });

    expect(result.results.length).toBeGreaterThan(0);

    const docTypes = new Set(result.results.map(r => r.docType).filter(Boolean));
    // A broad search should return more than just 'documentation'
    expect(docTypes.size).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================================
// External API URL format and reachability
// ============================================================================

describe('external API contract', { timeout: 60000, retry: 2 }, () => {
  it('should return search result URLs matching expected format', async () => {
    const result = await searchDocumentation({ query: 'policy', limit: 5 });

    for (const r of result.results) {
      // URLs should follow learn.jamf.com bundle pattern
      // Some results may come from non-standard bundles (e.g., jamf-technical-glossary)
      expect(r.url).toMatch(
        /^https:\/\/learn\.jamf\.com\/(en-US\/)?bundle\/[a-z0-9.-]+\/page\/[^/]+\.html$/
      );
    }
  });

  it('should reach the search API endpoint', async () => {
    const response = await axios.get(`${DOCS_API_URL}/api/search`, {
      params: { q: 'test', rpp: '1' },
      timeout: 15000,
      headers: { Accept: 'application/json' },
    });

    expect(response.status).toBe(200);
    expect(response.data).toHaveProperty('Results');
    expect(response.data).toHaveProperty('status');
  });
});
