/**
 * Unit tests for Zod output schemas (src/schemas/output.ts)
 */

import { describe, it, expect } from 'vitest';
import {
  SearchOutputSchema,
  ArticleOutputSchema,
  TocOutputSchema,
  ProductListOutputSchema,
} from '../../../src/schemas/output.js';

// ---------------------------------------------------------------------------
// SearchOutputSchema
// ---------------------------------------------------------------------------

describe('SearchOutputSchema', () => {
  const VALID_SEARCH_OUTPUT = {
    query: 'enrollment',
    totalResults: 25,
    page: 1,
    totalPages: 3,
    hasMore: true,
    results: [
      {
        title: 'Device Enrollment Overview',
        url: 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/DeviceEnrollment.html',
        snippet: 'Learn about device enrollment options...',
        product: 'jamf-pro',
        version: '11.5.0',
      },
    ],
    suggestions: ['enrollment profiles', 'user enrollment'],
  };

  it('should accept valid SearchOutputSchema data', () => {
    const result = SearchOutputSchema.safeParse(VALID_SEARCH_OUTPUT);
    expect(result.success).toBe(true);
  });

  it('should accept SearchOutputSchema without optional suggestions', () => {
    const { suggestions: _s, ...withoutSuggestions } = VALID_SEARCH_OUTPUT;
    const result = SearchOutputSchema.safeParse(withoutSuggestions);
    expect(result.success).toBe(true);
  });

  it('should accept results with optional version omitted', () => {
    const data = {
      ...VALID_SEARCH_OUTPUT,
      results: [
        {
          title: 'Enrollment',
          url: 'https://learn.jamf.com/page.html',
          snippet: 'Content here',
          product: 'jamf-pro',
          // version omitted
        },
      ],
    };
    const result = SearchOutputSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('should accept empty results array', () => {
    const data = { ...VALID_SEARCH_OUTPUT, results: [], totalResults: 0, hasMore: false };
    const result = SearchOutputSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('should fail when query is missing', () => {
    const { query: _q, ...withoutQuery } = VALID_SEARCH_OUTPUT;
    const result = SearchOutputSchema.safeParse(withoutQuery);
    expect(result.success).toBe(false);
  });

  it('should fail when results is missing', () => {
    const { results: _r, ...withoutResults } = VALID_SEARCH_OUTPUT;
    const result = SearchOutputSchema.safeParse(withoutResults);
    expect(result.success).toBe(false);
  });

  it('should fail when hasMore is not a boolean', () => {
    const data = { ...VALID_SEARCH_OUTPUT, hasMore: 'yes' };
    const result = SearchOutputSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('should fail when totalResults is not a number', () => {
    const data = { ...VALID_SEARCH_OUTPUT, totalResults: 'many' };
    const result = SearchOutputSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('should fail when a result is missing required title field', () => {
    const data = {
      ...VALID_SEARCH_OUTPUT,
      results: [
        {
          // title missing
          url: 'https://learn.jamf.com/page.html',
          snippet: 'Content',
          product: 'jamf-pro',
        },
      ],
    };
    const result = SearchOutputSchema.safeParse(data);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ArticleOutputSchema
// ---------------------------------------------------------------------------

describe('ArticleOutputSchema', () => {
  const VALID_ARTICLE_OUTPUT = {
    title: 'Device Enrollment Overview',
    url: 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/DeviceEnrollment.html',
    content: '# Device Enrollment\n\nThis article explains enrollment options...',
    product: 'jamf-pro',
    version: '11.5.0',
    lastUpdated: '2024-01-15',
    breadcrumb: ['Jamf Pro', 'Device Enrollment'],
    sections: [
      {
        id: 'overview',
        title: 'Overview',
        level: 1,
        tokenCount: 150,
      },
    ],
    truncated: false,
  };

  it('should accept valid ArticleOutputSchema data', () => {
    const result = ArticleOutputSchema.safeParse(VALID_ARTICLE_OUTPUT);
    expect(result.success).toBe(true);
  });

  it('should accept article without optional fields (product, version, lastUpdated, breadcrumb)', () => {
    const minimal = {
      title: 'Enrollment',
      url: 'https://learn.jamf.com/page.html',
      content: 'Article content',
      sections: [],
      truncated: false,
    };
    const result = ArticleOutputSchema.safeParse(minimal);
    expect(result.success).toBe(true);
  });

  it('should accept article with truncated=true', () => {
    const data = { ...VALID_ARTICLE_OUTPUT, truncated: true };
    const result = ArticleOutputSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('should accept empty sections array', () => {
    const data = { ...VALID_ARTICLE_OUTPUT, sections: [] };
    const result = ArticleOutputSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('should fail when title is missing', () => {
    const { title: _t, ...withoutTitle } = VALID_ARTICLE_OUTPUT;
    const result = ArticleOutputSchema.safeParse(withoutTitle);
    expect(result.success).toBe(false);
  });

  it('should fail when url is missing', () => {
    const { url: _u, ...withoutUrl } = VALID_ARTICLE_OUTPUT;
    const result = ArticleOutputSchema.safeParse(withoutUrl);
    expect(result.success).toBe(false);
  });

  it('should fail when content is missing', () => {
    const { content: _c, ...withoutContent } = VALID_ARTICLE_OUTPUT;
    const result = ArticleOutputSchema.safeParse(withoutContent);
    expect(result.success).toBe(false);
  });

  it('should fail when sections is missing', () => {
    const { sections: _s, ...withoutSections } = VALID_ARTICLE_OUTPUT;
    const result = ArticleOutputSchema.safeParse(withoutSections);
    expect(result.success).toBe(false);
  });

  it('should fail when truncated is missing', () => {
    const { truncated: _t, ...withoutTruncated } = VALID_ARTICLE_OUTPUT;
    const result = ArticleOutputSchema.safeParse(withoutTruncated);
    expect(result.success).toBe(false);
  });

  it('should fail when a section is missing required fields', () => {
    const data = {
      ...VALID_ARTICLE_OUTPUT,
      sections: [
        {
          // id missing
          title: 'Overview',
          level: 1,
          tokenCount: 100,
        },
      ],
    };
    const result = ArticleOutputSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('should fail when section level is not a number', () => {
    const data = {
      ...VALID_ARTICLE_OUTPUT,
      sections: [{ id: 'overview', title: 'Overview', level: 'h1', tokenCount: 100 }],
    };
    const result = ArticleOutputSchema.safeParse(data);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TocOutputSchema
// ---------------------------------------------------------------------------

describe('TocOutputSchema', () => {
  const VALID_TOC_OUTPUT = {
    product: 'jamf-pro',
    version: '11.5.0',
    totalEntries: 120,
    page: 1,
    totalPages: 12,
    hasMore: true,
    entries: [
      {
        title: 'Getting Started',
        url: 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/GettingStarted.html',
      },
    ],
  };

  it('should accept valid TocOutputSchema data', () => {
    const result = TocOutputSchema.safeParse(VALID_TOC_OUTPUT);
    expect(result.success).toBe(true);
  });

  it('should accept empty entries array', () => {
    const data = { ...VALID_TOC_OUTPUT, entries: [], totalEntries: 0, hasMore: false };
    const result = TocOutputSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('should fail when product is missing', () => {
    const { product: _p, ...withoutProduct } = VALID_TOC_OUTPUT;
    const result = TocOutputSchema.safeParse(withoutProduct);
    expect(result.success).toBe(false);
  });

  it('should fail when version is missing', () => {
    const { version: _v, ...withoutVersion } = VALID_TOC_OUTPUT;
    const result = TocOutputSchema.safeParse(withoutVersion);
    expect(result.success).toBe(false);
  });

  it('should fail when entries is missing', () => {
    const { entries: _e, ...withoutEntries } = VALID_TOC_OUTPUT;
    const result = TocOutputSchema.safeParse(withoutEntries);
    expect(result.success).toBe(false);
  });

  it('should fail when hasMore is not a boolean', () => {
    const data = { ...VALID_TOC_OUTPUT, hasMore: 1 };
    const result = TocOutputSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('should fail when a toc entry is missing title', () => {
    const data = {
      ...VALID_TOC_OUTPUT,
      entries: [{ url: 'https://learn.jamf.com/page.html' }],
    };
    const result = TocOutputSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('should fail when a toc entry is missing url', () => {
    const data = {
      ...VALID_TOC_OUTPUT,
      entries: [{ title: 'Getting Started' }],
    };
    const result = TocOutputSchema.safeParse(data);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ProductListOutputSchema
// ---------------------------------------------------------------------------

describe('ProductListOutputSchema', () => {
  const VALID_PRODUCT_LIST_OUTPUT = {
    products: [
      {
        id: 'jamf-pro',
        name: 'Jamf Pro',
        description: 'Apple device management for enterprise',
        currentVersion: '11.5.0',
        availableVersions: ['11.5.0', '11.4.0'],
        hasContent: true,
      },
    ],
    topics: [
      {
        id: 'enrollment',
        name: 'Enrollment & Onboarding',
        keywords: ['enroll', 'dep', 'ade'],
      },
    ],
  };

  it('should accept valid ProductListOutputSchema data', () => {
    const result = ProductListOutputSchema.safeParse(VALID_PRODUCT_LIST_OUTPUT);
    expect(result.success).toBe(true);
  });

  it('should accept empty products and topics arrays', () => {
    const data = { products: [], topics: [] };
    const result = ProductListOutputSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('should accept products with empty availableVersions', () => {
    const data = {
      ...VALID_PRODUCT_LIST_OUTPUT,
      products: [
        {
          id: 'jamf-pro',
          name: 'Jamf Pro',
          description: 'Enterprise MDM',
          currentVersion: 'current',
          availableVersions: [],
          hasContent: true,
        },
      ],
    };
    const result = ProductListOutputSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('should fail when products is missing', () => {
    const { products: _p, ...withoutProducts } = VALID_PRODUCT_LIST_OUTPUT;
    const result = ProductListOutputSchema.safeParse(withoutProducts);
    expect(result.success).toBe(false);
  });

  it('should fail when topics is missing', () => {
    const { topics: _t, ...withoutTopics } = VALID_PRODUCT_LIST_OUTPUT;
    const result = ProductListOutputSchema.safeParse(withoutTopics);
    expect(result.success).toBe(false);
  });

  it('should fail when a product is missing required id', () => {
    const data = {
      ...VALID_PRODUCT_LIST_OUTPUT,
      products: [
        {
          // id missing
          name: 'Jamf Pro',
          description: 'Enterprise MDM',
          currentVersion: '11.5.0',
          availableVersions: ['11.5.0'],
        },
      ],
    };
    const result = ProductListOutputSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('should fail when a product currentVersion is not a string', () => {
    const data = {
      ...VALID_PRODUCT_LIST_OUTPUT,
      products: [
        {
          id: 'jamf-pro',
          name: 'Jamf Pro',
          description: 'Enterprise MDM',
          currentVersion: 11.5,
          availableVersions: ['11.5.0'],
        },
      ],
    };
    const result = ProductListOutputSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('should fail when a topic is missing required name', () => {
    const data = {
      ...VALID_PRODUCT_LIST_OUTPUT,
      topics: [
        {
          id: 'enrollment',
          // name missing
          keywords: ['enroll'],
        },
      ],
    };
    const result = ProductListOutputSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('should fail when topic keywords is not an array', () => {
    const data = {
      ...VALID_PRODUCT_LIST_OUTPUT,
      topics: [
        {
          id: 'enrollment',
          name: 'Enrollment',
          keywords: 'enroll, dep',
        },
      ],
    };
    const result = ProductListOutputSchema.safeParse(data);
    expect(result.success).toBe(false);
  });
});
