/**
 * Unit tests for Zod input validation schemas (src/schemas/index.ts)
 */

import { describe, it, expect } from 'vitest';
import {
  SearchInputSchema,
  GetArticleInputSchema,
  GetTocInputSchema,
  ListProductsInputSchema,
} from '../../../src/core/schemas/index.js';

// ---------------------------------------------------------------------------
// SearchInputSchema
// ---------------------------------------------------------------------------

describe('SearchInputSchema', () => {
  const VALID_BASE = { query: 'enrollment' };

  it('should accept a minimal valid query', () => {
    const result = SearchInputSchema.safeParse(VALID_BASE);
    expect(result.success).toBe(true);
  });

  it('should reject an empty query string', () => {
    const result = SearchInputSchema.safeParse({ query: '' });
    expect(result.success).toBe(false);
  });

  it('should reject a one-character query', () => {
    const result = SearchInputSchema.safeParse({ query: 'a' });
    expect(result.success).toBe(false);
  });

  it('should reject a query longer than 200 characters', () => {
    const result = SearchInputSchema.safeParse({ query: 'a'.repeat(201) });
    expect(result.success).toBe(false);
  });

  it('should accept a query of exactly 200 characters', () => {
    const result = SearchInputSchema.safeParse({ query: 'a'.repeat(200) });
    expect(result.success).toBe(true);
  });

  it('should accept a valid product filter', () => {
    const result = SearchInputSchema.safeParse({ query: 'test', product: 'jamf-pro' });
    expect(result.success).toBe(true);
  });

  it('should reject an invalid product filter', () => {
    const result = SearchInputSchema.safeParse({ query: 'test', product: 'jamf-unknown' });
    expect(result.success).toBe(false);
  });

  it('should accept all known products', () => {
    const products = ['jamf-pro', 'jamf-school', 'jamf-connect', 'jamf-protect'];
    for (const product of products) {
      const result = SearchInputSchema.safeParse({ query: 'test', product });
      expect(result.success, `product "${product}" should be accepted`).toBe(true);
    }
  });

  it('should accept a valid topic filter', () => {
    const result = SearchInputSchema.safeParse({ query: 'test', topic: 'enrollment' });
    expect(result.success).toBe(true);
  });

  it('should reject an invalid topic filter', () => {
    const result = SearchInputSchema.safeParse({ query: 'test', topic: 'not-a-topic' });
    expect(result.success).toBe(false);
  });

  it('should accept page 1 (minimum valid)', () => {
    const result = SearchInputSchema.safeParse({ query: 'test', page: 1 });
    expect(result.success).toBe(true);
  });

  it('should accept page 100 (maximum valid)', () => {
    const result = SearchInputSchema.safeParse({ query: 'test', page: 100 });
    expect(result.success).toBe(true);
  });

  it('should reject page 0 (below minimum)', () => {
    const result = SearchInputSchema.safeParse({ query: 'test', page: 0 });
    expect(result.success).toBe(false);
  });

  it('should reject page 101 (above maximum)', () => {
    const result = SearchInputSchema.safeParse({ query: 'test', page: 101 });
    expect(result.success).toBe(false);
  });

  it('should accept maxTokens 100 (minimum valid)', () => {
    const result = SearchInputSchema.safeParse({ query: 'test', maxTokens: 100 });
    expect(result.success).toBe(true);
  });

  it('should accept maxTokens 50000 (maximum valid)', () => {
    const result = SearchInputSchema.safeParse({ query: 'test', maxTokens: 50000 });
    expect(result.success).toBe(true);
  });

  it('should reject maxTokens 50 (below minimum)', () => {
    const result = SearchInputSchema.safeParse({ query: 'test', maxTokens: 50 });
    expect(result.success).toBe(false);
  });

  it('should reject maxTokens 60000 (above maximum)', () => {
    const result = SearchInputSchema.safeParse({ query: 'test', maxTokens: 60000 });
    expect(result.success).toBe(false);
  });

  it('should reject unknown extra fields (strict mode)', () => {
    const result = SearchInputSchema.safeParse({ query: 'test', unknownField: true });
    expect(result.success).toBe(false);
  });

  it('should default outputMode to "full"', () => {
    const result = SearchInputSchema.safeParse(VALID_BASE);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.outputMode).toBe('full');
    }
  });

  it('should default responseFormat to "markdown"', () => {
    const result = SearchInputSchema.safeParse(VALID_BASE);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.responseFormat).toBe('markdown');
    }
  });

  it('should accept all valid fields together', () => {
    const result = SearchInputSchema.safeParse({
      query: 'enrollment',
      product: 'jamf-pro',
      topic: 'enrollment',
      version: '11.5.0',
      limit: 20,
      page: 2,
      maxTokens: 5000,
      outputMode: 'compact',
      responseFormat: 'json',
    });
    expect(result.success).toBe(true);
  });

  it('should reject maxTokens=99 (one below minimum of 100)', () => {
    const result = SearchInputSchema.safeParse({ query: 'test', maxTokens: 99 });
    expect(result.success).toBe(false);
  });

  it('should reject maxTokens=50001 (one above maximum of 50000)', () => {
    const result = SearchInputSchema.safeParse({ query: 'test', maxTokens: 50001 });
    expect(result.success).toBe(false);
  });

  it('should apply default limit when omitted', () => {
    const result = SearchInputSchema.safeParse(VALID_BASE);
    expect(result.success).toBe(true);
    if (result.success) {
      // Default search results limit from CONTENT_LIMITS.DEFAULT_SEARCH_RESULTS = 10
      expect(result.data.limit).toBe(10);
    }
  });
});

// ---------------------------------------------------------------------------
// GetArticleInputSchema
// ---------------------------------------------------------------------------

describe('GetArticleInputSchema', () => {
  const VALID_URL = 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/Overview.html';

  it('should accept a valid learn.jamf.com URL', () => {
    const result = GetArticleInputSchema.safeParse({ url: VALID_URL });
    expect(result.success).toBe(true);
  });

  it('should accept a docs.jamf.com URL', () => {
    const result = GetArticleInputSchema.safeParse({
      url: 'https://docs.jamf.com/10.39.0/jamf-pro/documentation/Overview.html',
    });
    expect(result.success).toBe(true);
  });

  it('should reject a learn-be.jamf.com URL (backend hostname removed after FT migration)', () => {
    const result = GetArticleInputSchema.safeParse({
      url: 'https://learn-be.jamf.com/services/search/v2/search?query=test',
    });
    expect(result.success).toBe(false);
  });

  it('should reject a non-Jamf URL', () => {
    const result = GetArticleInputSchema.safeParse({ url: 'https://example.com/page' });
    expect(result.success).toBe(false);
  });

  it('should reject a javascript: protocol URL', () => {
    // javascript: is not a valid URL per Zod's .url() validator
    const result = GetArticleInputSchema.safeParse({ url: 'javascript:alert(1)' });
    expect(result.success).toBe(false);
  });

  it('should reject a non-URL string', () => {
    const result = GetArticleInputSchema.safeParse({ url: 'not-a-url' });
    expect(result.success).toBe(false);
  });

  it('should reject extra unknown fields', () => {
    const result = GetArticleInputSchema.safeParse({ url: VALID_URL, extraField: 'bad' });
    expect(result.success).toBe(false);
  });

  it('should default summaryOnly to false', () => {
    const result = GetArticleInputSchema.safeParse({ url: VALID_URL });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.summaryOnly).toBe(false);
    }
  });

  it('should default includeRelated to false', () => {
    const result = GetArticleInputSchema.safeParse({ url: VALID_URL });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.includeRelated).toBe(false);
    }
  });

  it('should reject a non-jamf domain URL (domain check)', () => {
    const result = GetArticleInputSchema.safeParse({ url: 'https://attacker.com/fake-jamf-doc' });
    expect(result.success).toBe(false);
  });

  it('should reject http: protocol URL (non-https jamf domain)', () => {
    // isAllowedHostname now enforces https: protocol in addition to hostname
    const result = GetArticleInputSchema.safeParse({ url: 'http://learn.jamf.com/page.html' });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// GetTocInputSchema
// ---------------------------------------------------------------------------

describe('GetTocInputSchema', () => {
  it('should accept a valid product ID', () => {
    const result = GetTocInputSchema.safeParse({ product: 'jamf-pro' });
    expect(result.success).toBe(true);
  });

  it('should accept all known product IDs', () => {
    const products = ['jamf-pro', 'jamf-school', 'jamf-connect', 'jamf-protect'];
    for (const product of products) {
      const result = GetTocInputSchema.safeParse({ product });
      expect(result.success, `product "${product}" should be accepted`).toBe(true);
    }
  });

  it('should reject an invalid product ID', () => {
    const result = GetTocInputSchema.safeParse({ product: 'jamf-cloud' });
    expect(result.success).toBe(false);
  });

  it('should reject input without a product', () => {
    const result = GetTocInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('should accept an optional version string', () => {
    const result = GetTocInputSchema.safeParse({ product: 'jamf-pro', version: '11.5.0' });
    expect(result.success).toBe(true);
  });

  it('should accept page 1 (minimum valid)', () => {
    const result = GetTocInputSchema.safeParse({ product: 'jamf-pro', page: 1 });
    expect(result.success).toBe(true);
  });

  it('should accept page 100 (maximum valid)', () => {
    const result = GetTocInputSchema.safeParse({ product: 'jamf-pro', page: 100 });
    expect(result.success).toBe(true);
  });

  it('should reject page 0', () => {
    const result = GetTocInputSchema.safeParse({ product: 'jamf-pro', page: 0 });
    expect(result.success).toBe(false);
  });

  it('should reject page 101', () => {
    const result = GetTocInputSchema.safeParse({ product: 'jamf-pro', page: 101 });
    expect(result.success).toBe(false);
  });

  it('should reject extra unknown fields', () => {
    const result = GetTocInputSchema.safeParse({ product: 'jamf-pro', unknown: true });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ListProductsInputSchema
// ---------------------------------------------------------------------------

describe('ListProductsInputSchema', () => {
  it('should accept an empty object (all defaults)', () => {
    const result = ListProductsInputSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('should default outputMode to "full"', () => {
    const result = ListProductsInputSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.outputMode).toBe('full');
    }
  });

  it('should accept outputMode "compact"', () => {
    const result = ListProductsInputSchema.safeParse({ outputMode: 'compact' });
    expect(result.success).toBe(true);
  });

  it('should accept responseFormat "json"', () => {
    const result = ListProductsInputSchema.safeParse({ responseFormat: 'json' });
    expect(result.success).toBe(true);
  });

  it('should accept responseFormat "markdown"', () => {
    const result = ListProductsInputSchema.safeParse({ responseFormat: 'markdown' });
    expect(result.success).toBe(true);
  });

  it('should accept maxTokens 100 (minimum valid)', () => {
    const result = ListProductsInputSchema.safeParse({ maxTokens: 100 });
    expect(result.success).toBe(true);
  });

  it('should accept maxTokens 50000 (maximum valid)', () => {
    const result = ListProductsInputSchema.safeParse({ maxTokens: 50000 });
    expect(result.success).toBe(true);
  });

  it('should reject maxTokens 50 (below minimum)', () => {
    const result = ListProductsInputSchema.safeParse({ maxTokens: 50 });
    expect(result.success).toBe(false);
  });

  it('should reject maxTokens 60000 (above maximum)', () => {
    const result = ListProductsInputSchema.safeParse({ maxTokens: 60000 });
    expect(result.success).toBe(false);
  });

  it('should reject extra unknown fields', () => {
    const result = ListProductsInputSchema.safeParse({ unknownField: 'bad' });
    expect(result.success).toBe(false);
  });

  it('should reject maxTokens=99 (one below minimum of 100)', () => {
    const result = ListProductsInputSchema.safeParse({ maxTokens: 99 });
    expect(result.success).toBe(false);
  });

  it('should reject maxTokens=50001 (one above maximum of 50000)', () => {
    const result = ListProductsInputSchema.safeParse({ maxTokens: 50001 });
    expect(result.success).toBe(false);
  });

  it('should apply default responseFormat to "markdown" when omitted', () => {
    const result = ListProductsInputSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.responseFormat).toBe('markdown');
    }
  });
});
