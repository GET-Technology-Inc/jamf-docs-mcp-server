/**
 * Unit tests for metadata service
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock http-client before importing the module under test
vi.mock('../../../src/core/http-client.js', async () => {
  return {
    httpGetText: vi.fn(),
    httpGetJson: vi.fn(),
    HttpError: (await import('../../../src/core/http-client.js')).HttpError
  };
});

import { httpGetJson } from '../../../src/core/http-client.js';
import {
  getProductsMetadata,
  getBundleIdForVersion,
  getAvailableVersions,
  getTopicsMetadata,
  getProductsResourceData,
  getTopicsResourceData
} from '../../../src/core/services/metadata.js';
import { JAMF_PRODUCTS } from '../../../src/core/constants.js';
import { createMockContext } from '../../helpers/mock-context.js';

const ctx = createMockContext();

const mockedHttpGetJson = vi.mocked(httpGetJson);

// ============================================================================
// Helpers
// ============================================================================

function makeSearchResponse(bundleIds: (string | null)[]) {
  return {
    status: 'ok',
    Results: bundleIds.map(bundleId => ({
      leading_result: bundleId !== null ? {
        bundle_id: bundleId,
        title: 'Test Article',
        url: 'https://learn-be.jamf.com/test.html',
        snippet: '',
        page_id: 'p1',
        publication_title: 'Jamf',
        labels: [{ key: 'product-pro', navtitle: 'Jamf Pro' }]
      } : null
    }))
  };
}

// ============================================================================
// API fallback tests
// ============================================================================

describe('getProductsMetadata - API fallback', () => {
  beforeEach(() => {
    vi.mocked(ctx.cache.get).mockResolvedValue(null);
    vi.mocked(ctx.cache.set).mockResolvedValue(undefined);
  });

  it('should fall back to static JAMF_PRODUCTS when API throws a network error', async () => {
    mockedHttpGetJson.mockRejectedValue(new Error('Network error: ECONNREFUSED'));

    const products = await getProductsMetadata(ctx);
    expect(products.length).toBeGreaterThan(0);

    // All products from static list should appear
    const staticIds = Object.keys(JAMF_PRODUCTS);
    const resultIds = products.map(p => p.id);
    staticIds.forEach(id => expect(resultIds).toContain(id));
  });

  it('should use static bundleId as fallback when API fails', async () => {
    mockedHttpGetJson.mockRejectedValue(new Error('Network failure'));

    const products = await getProductsMetadata(ctx);
    const pro = products.find(p => p.id === 'jamf-pro');
    expect(pro).toBeDefined();
    expect(pro?.bundleId).toBe(JAMF_PRODUCTS['jamf-pro'].bundleId);
  });

  it('should use static latestVersion as fallback when API fails', async () => {
    mockedHttpGetJson.mockRejectedValue(new Error('Network failure'));

    const products = await getProductsMetadata(ctx);
    const pro = products.find(p => p.id === 'jamf-pro');
    expect(pro?.latestVersion).toBeDefined();
    expect(pro?.latestVersion).toBe(JAMF_PRODUCTS['jamf-pro'].latestVersion);
  });

  it('should return cached data without calling API again', async () => {
    const cachedProducts = [
      {
        id: 'jamf-pro',
        name: 'Jamf Pro',
        description: 'Cached',
        bundleId: 'jamf-pro-documentation-11.0.0',
        latestVersion: '11.0.0',
        availableVersions: ['11.0.0'],
        labelKey: 'product-pro'
      }
    ];

    vi.mocked(ctx.cache.get).mockResolvedValue(cachedProducts);
    // Reset the call count so we can assert this test's behavior in isolation
    mockedHttpGetJson.mockClear();

    const products = await getProductsMetadata(ctx);
    expect(products).toEqual(cachedProducts);
    expect(mockedHttpGetJson).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Empty API results tests
// ============================================================================

describe('getProductsMetadata - empty API results', () => {
  beforeEach(() => {
    vi.mocked(ctx.cache.get).mockResolvedValue(null);
    vi.mocked(ctx.cache.set).mockResolvedValue(undefined);
  });

  it('should fall back to static data when API returns empty Results array', async () => {
    mockedHttpGetJson.mockResolvedValue({ status: 'ok', Results: [] });

    const products = await getProductsMetadata(ctx);
    expect(products.length).toBeGreaterThan(0);

    // Should still contain all static products
    const staticIds = Object.keys(JAMF_PRODUCTS);
    staticIds.forEach(id => {
      expect(products.some(p => p.id === id)).toBe(true);
    });
  });

  it('should fall back when API returns results with no matching bundle prefix', async () => {
    mockedHttpGetJson.mockResolvedValue(
      makeSearchResponse(['some-unrelated-bundle-id'])
    );

    const products = await getProductsMetadata(ctx);
    // Fallback products should still be present
    expect(products.length).toBeGreaterThan(0);
  });

  it('should handle API response with null leading_results gracefully', async () => {
    mockedHttpGetJson.mockResolvedValue(
      makeSearchResponse([null, null, null])
    );

    const products = await getProductsMetadata(ctx);
    expect(products.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// Version extraction tests
// ============================================================================

describe('version extraction from bundleId', () => {
  beforeEach(() => {
    vi.mocked(ctx.cache.get).mockResolvedValue(null);
    vi.mocked(ctx.cache.set).mockResolvedValue(undefined);
  });

  it('should extract version from versioned bundleId', async () => {
    mockedHttpGetJson.mockResolvedValue(
      makeSearchResponse(['jamf-pro-documentation-11.24.0'])
    );

    const products = await getProductsMetadata(ctx);
    const pro = products.find(p => p.id === 'jamf-pro');
    expect(pro?.latestVersion).toBe('11.24.0');
  });

  it('should use "current" as latestVersion when bundleId has no version suffix', async () => {
    mockedHttpGetJson.mockResolvedValue(
      makeSearchResponse(['jamf-pro-documentation'])
    );

    const products = await getProductsMetadata(ctx);
    const pro = products.find(p => p.id === 'jamf-pro');
    // bundleId 'jamf-pro-documentation' has no version suffix -> versionMatch is null -> 'current'
    expect(pro?.latestVersion).toBe('current');
  });

  it('should collect multiple available versions from search results', async () => {
    mockedHttpGetJson.mockResolvedValue({
      status: 'ok',
      Results: [
        {
          leading_result: {
            bundle_id: 'jamf-pro-documentation-11.24.0',
            title: 'Jamf Pro 11.24',
            url: 'https://learn-be.jamf.com/test.html',
            snippet: '',
            page_id: 'p1',
            publication_title: 'Jamf Pro',
            labels: [{ key: 'product-pro', navtitle: 'Jamf Pro' }]
          }
        },
        {
          leading_result: {
            bundle_id: 'jamf-pro-documentation-11.23.0',
            title: 'Jamf Pro 11.23',
            url: 'https://learn-be.jamf.com/test2.html',
            snippet: '',
            page_id: 'p2',
            publication_title: 'Jamf Pro',
            labels: []
          }
        }
      ]
    });

    const products = await getProductsMetadata(ctx);
    const pro = products.find(p => p.id === 'jamf-pro');
    expect(pro?.availableVersions).toContain('11.24.0');
    expect(pro?.availableVersions).toContain('11.23.0');
  });
});

// ============================================================================
// getBundleIdForVersion tests
// ============================================================================

describe('getBundleIdForVersion', () => {
  beforeEach(() => {
    vi.mocked(ctx.cache.get).mockResolvedValue(null);
    vi.mocked(ctx.cache.set).mockResolvedValue(undefined);
  });

  it('should return latestBundleId when version is "current"', async () => {
    const mockProducts = [
      {
        id: 'jamf-pro',
        name: 'Jamf Pro',
        description: 'Desc',
        bundleId: 'jamf-pro-documentation-11.24.0',
        latestVersion: '11.24.0',
        availableVersions: ['11.24.0', '11.23.0'],
        labelKey: 'product-pro'
      }
    ];
    vi.mocked(ctx.cache.get).mockResolvedValue(mockProducts);

    const bundleId = await getBundleIdForVersion(ctx, 'jamf-pro', 'current');
    expect(bundleId).toBe('jamf-pro-documentation-11.24.0');
  });

  it('should return latestBundleId when version is "latest"', async () => {
    const mockProducts = [
      {
        id: 'jamf-pro',
        name: 'Jamf Pro',
        description: 'Desc',
        bundleId: 'jamf-pro-documentation-11.24.0',
        latestVersion: '11.24.0',
        availableVersions: ['11.24.0'],
        labelKey: 'product-pro'
      }
    ];
    vi.mocked(ctx.cache.get).mockResolvedValue(mockProducts);

    const bundleId = await getBundleIdForVersion(ctx, 'jamf-pro', 'latest');
    expect(bundleId).toBe('jamf-pro-documentation-11.24.0');
  });

  it('should return latestBundleId when version is undefined', async () => {
    const mockProducts = [
      {
        id: 'jamf-pro',
        name: 'Jamf Pro',
        description: 'Desc',
        bundleId: 'jamf-pro-documentation-11.24.0',
        latestVersion: '11.24.0',
        availableVersions: ['11.24.0'],
        labelKey: 'product-pro'
      }
    ];
    vi.mocked(ctx.cache.get).mockResolvedValue(mockProducts);

    const bundleId = await getBundleIdForVersion(ctx, 'jamf-pro', undefined);
    expect(bundleId).toBe('jamf-pro-documentation-11.24.0');
  });

  it('should return versioned bundleId when a valid specific version is requested', async () => {
    const mockProducts = [
      {
        id: 'jamf-pro',
        name: 'Jamf Pro',
        description: 'Desc',
        bundleId: 'jamf-pro-documentation-11.24.0',
        latestVersion: '11.24.0',
        availableVersions: ['11.24.0', '11.23.0', '11.22.0'],
        labelKey: 'product-pro'
      }
    ];
    vi.mocked(ctx.cache.get).mockResolvedValue(mockProducts);

    const bundleId = await getBundleIdForVersion(ctx, 'jamf-pro', '11.23.0');
    expect(bundleId).toBe('jamf-pro-documentation-11.23.0');
  });

  it('should return null when a specific version is not in availableVersions', async () => {
    const mockProducts = [
      {
        id: 'jamf-pro',
        name: 'Jamf Pro',
        description: 'Desc',
        bundleId: 'jamf-pro-documentation-11.24.0',
        latestVersion: '11.24.0',
        availableVersions: ['11.24.0'],
        labelKey: 'product-pro'
      }
    ];
    vi.mocked(ctx.cache.get).mockResolvedValue(mockProducts);

    const bundleId = await getBundleIdForVersion(ctx, 'jamf-pro', '10.0.0');
    expect(bundleId).toBeNull();
  });

  it('should return null when product is not found in metadata', async () => {
    vi.mocked(ctx.cache.get).mockResolvedValue([]);
    mockedHttpGetJson.mockResolvedValue({ status: 'ok', Results: [] });

    const bundleId = await getBundleIdForVersion(ctx, 'jamf-pro', 'current');
    expect(bundleId).toBeNull();
  });
});

// ============================================================================
// getAvailableVersions tests
// ============================================================================

describe('getAvailableVersions', () => {
  beforeEach(() => {
    vi.mocked(ctx.cache.get).mockResolvedValue(null);
    vi.mocked(ctx.cache.set).mockResolvedValue(undefined);
  });

  it('should return versions array for a known product', async () => {
    const mockProducts = [
      {
        id: 'jamf-pro',
        name: 'Jamf Pro',
        description: 'Desc',
        bundleId: 'jamf-pro-documentation',
        latestVersion: 'current',
        availableVersions: ['11.24.0', '11.23.0', '11.22.0'],
        labelKey: 'product-pro'
      }
    ];
    vi.mocked(ctx.cache.get).mockResolvedValue(mockProducts);

    const versions = await getAvailableVersions(ctx, 'jamf-pro');
    expect(versions).toContain('11.24.0');
    expect(versions).toContain('11.23.0');
  });

  it('should return empty array when product is not in metadata', async () => {
    vi.mocked(ctx.cache.get).mockResolvedValue([]);
    mockedHttpGetJson.mockResolvedValue({ Results: [] });

    const versions = await getAvailableVersions(ctx, 'jamf-pro');
    expect(versions).toEqual([]);
  });

  it('should return single-item array with latestVersion when no versions discovered', async () => {
    // When API fails, static fallback uses [product.latestVersion]
    mockedHttpGetJson.mockRejectedValue(new Error('network error'));

    const versions = await getAvailableVersions(ctx, 'jamf-pro');
    expect(Array.isArray(versions)).toBe(true);
    expect(versions.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// getTopicsMetadata tests
// ============================================================================

describe('getTopicsMetadata', () => {
  beforeEach(() => {
    vi.mocked(ctx.cache.get).mockResolvedValue(null);
    vi.mocked(ctx.cache.set).mockResolvedValue(undefined);
  });

  it('should return cached topics without calling API', async () => {
    const cachedTopics = [
      { id: 'enrollment', name: 'Enrollment', source: 'manual' as const }
    ];
    vi.mocked(ctx.cache.get).mockImplementation(async (key) => {
      if (key === 'metadata:topics') return cachedTopics;
      return null;
    });
    mockedHttpGetJson.mockClear();

    const topics = await getTopicsMetadata(ctx);
    expect(topics).toEqual(cachedTopics);
    expect(mockedHttpGetJson).not.toHaveBeenCalled();
  });

  it('should include at least the manual topics from JAMF_TOPICS when API fails', async () => {
    vi.mocked(ctx.cache.get).mockImplementation(async (key) => {
      if (key === 'metadata:topics') return null;
      if (key === 'metadata:products') return []; // empty products -> no TOC fetches
      return null;
    });
    mockedHttpGetJson.mockRejectedValue(new Error('API failure'));

    const topics = await getTopicsMetadata(ctx);
    expect(Array.isArray(topics)).toBe(true);
    expect(topics.length).toBeGreaterThan(0);
    // All fallback topics should have source='manual'
    expect(topics.every(t => t.source === 'manual')).toBe(true);
  });

  it('should cache the topics after fetching', async () => {
    vi.mocked(ctx.cache.get).mockImplementation(async (key) => {
      if (key === 'metadata:topics') return null;
      if (key === 'metadata:products') return [];
      return null;
    });
    mockedHttpGetJson.mockRejectedValue(new Error('skip'));

    await getTopicsMetadata(ctx);
    expect(vi.mocked(ctx.cache.set)).toHaveBeenCalled();
  });

  it('should combine TOC categories with manual topics', async () => {
    const mockProducts = [
      {
        id: 'jamf-pro',
        name: 'Jamf Pro',
        description: 'Desc',
        bundleId: 'jamf-pro-documentation',
        latestVersion: 'current',
        availableVersions: ['current'],
        labelKey: 'product-pro'
      }
    ];

    vi.mocked(ctx.cache.get).mockImplementation(async (key) => {
      if (key === 'metadata:topics') return null;
      if (key === 'metadata:products') return mockProducts;
      return null;
    });

    // TOC API response with HTML list
    mockedHttpGetJson.mockResolvedValue({
      'nav-1': '<ul><a href="/enroll">Enrollment Guide</a><a href="/sub">Sub Article</a></ul>',
    });

    const topics = await getTopicsMetadata(ctx);
    expect(Array.isArray(topics)).toBe(true);
    // Should include both manual and toc-derived topics
    expect(topics.length).toBeGreaterThan(0);
  });

  it('should not throw when TOC fetch fails for a product', async () => {
    const mockProducts = [
      {
        id: 'jamf-pro',
        name: 'Jamf Pro',
        description: 'Desc',
        bundleId: 'jamf-pro-documentation',
        latestVersion: 'current',
        availableVersions: ['current'],
        labelKey: 'product-pro'
      }
    ];

    vi.mocked(ctx.cache.get).mockImplementation(async (key) => {
      if (key === 'metadata:topics') return null;
      if (key === 'metadata:products') return mockProducts;
      return null;
    });
    mockedHttpGetJson.mockRejectedValue(new Error('TOC fetch failed'));

    await expect(getTopicsMetadata(ctx)).resolves.not.toThrow();
  });
});

// ============================================================================
// getProductsResourceData tests
// ============================================================================

describe('getProductsResourceData', () => {
  beforeEach(() => {
    vi.mocked(ctx.cache.set).mockResolvedValue(undefined);
  });

  it('should return correctly formatted resource data', async () => {
    const mockProducts = [
      {
        id: 'jamf-pro',
        name: 'Jamf Pro',
        description: 'Apple device management',
        bundleId: 'jamf-pro-documentation',
        latestVersion: 'current',
        availableVersions: ['current'],
        labelKey: 'product-pro'
      }
    ];
    vi.mocked(ctx.cache.get).mockResolvedValue(mockProducts);

    const data = await getProductsResourceData(ctx);

    expect(typeof data.description).toBe('string');
    expect(data.description.length).toBeGreaterThan(0);
    expect(data.products).toHaveLength(1);
    expect(data.products[0].id).toBe('jamf-pro');
    expect(data.products[0].name).toBe('Jamf Pro');
    expect(new Date(data.lastUpdated).getTime()).toBeGreaterThan(0);
    expect(typeof data.usage).toBe('string');
    expect(data.usage.length).toBeGreaterThan(0);
  });

  it('should include all required fields on each product', async () => {
    const mockProducts = [
      {
        id: 'jamf-pro',
        name: 'Jamf Pro',
        description: 'Enterprise MDM',
        bundleId: 'jamf-pro-documentation-11.24.0',
        latestVersion: '11.24.0',
        availableVersions: ['11.24.0', '11.23.0'],
        labelKey: 'product-pro'
      }
    ];
    vi.mocked(ctx.cache.get).mockResolvedValue(mockProducts);

    const data = await getProductsResourceData(ctx);
    const product = data.products[0];

    expect(product.id).toBe('jamf-pro');
    expect(product.name).toBe('Jamf Pro');
    expect(product.description).toBe('Enterprise MDM');
    expect(product.latestVersion).toBe('11.24.0');
    expect(product.availableVersions).toEqual(['11.24.0', '11.23.0']);
    expect(product.bundleId).toBe('jamf-pro-documentation-11.24.0');
  });

  it('should return a valid ISO timestamp in lastUpdated', async () => {
    vi.mocked(ctx.cache.get).mockResolvedValue([]);
    mockedHttpGetJson.mockRejectedValue(new Error('skip'));

    const data = await getProductsResourceData(ctx);
    expect(() => new Date(data.lastUpdated)).not.toThrow();
    expect(new Date(data.lastUpdated).getTime()).toBeGreaterThan(0);
  });
});

// ============================================================================
// getTopicsResourceData tests
// ============================================================================

describe('getTopicsResourceData', () => {
  it('should return correctly formatted topics resource data', async () => {
    const cachedTopics = [
      { id: 'enrollment', name: 'Enrollment', source: 'manual' as const },
      { id: 'security', name: 'Security', source: 'manual' as const, articleCount: 10 },
    ];
    vi.mocked(ctx.cache.get).mockImplementation(async (key) => {
      if (key === 'metadata:topics') return cachedTopics;
      return null;
    });
    vi.mocked(ctx.cache.set).mockResolvedValue(undefined);

    const data = await getTopicsResourceData(ctx);

    expect(data.description).toBeDefined();
    expect(data.totalTopics).toBe(2);
    expect(data.topics).toHaveLength(2);
    expect(data.lastUpdated).toBeDefined();
    expect(data.usage).toBeDefined();
  });

  it('should include id, name, source for each topic', async () => {
    const cachedTopics = [
      { id: 'enrollment', name: 'Enrollment & Onboarding', source: 'manual' as const },
    ];
    vi.mocked(ctx.cache.get).mockImplementation(async (key) => {
      if (key === 'metadata:topics') return cachedTopics;
      return null;
    });
    vi.mocked(ctx.cache.set).mockResolvedValue(undefined);

    const data = await getTopicsResourceData(ctx);
    const topic = data.topics[0];

    expect(topic.id).toBe('enrollment');
    expect(topic.name).toBe('Enrollment & Onboarding');
    expect(topic.source).toBe('manual');
  });

  it('should include articleCount when present', async () => {
    const cachedTopics = [
      { id: 'enrollment', name: 'Enrollment', source: 'toc' as const, articleCount: 42 },
    ];
    vi.mocked(ctx.cache.get).mockImplementation(async (key) => {
      if (key === 'metadata:topics') return cachedTopics;
      return null;
    });
    vi.mocked(ctx.cache.set).mockResolvedValue(undefined);

    const data = await getTopicsResourceData(ctx);
    expect(data.topics[0].articleCount).toBe(42);
  });

  it('should omit articleCount when undefined', async () => {
    const cachedTopics = [
      { id: 'enrollment', name: 'Enrollment', source: 'manual' as const },
    ];
    vi.mocked(ctx.cache.get).mockImplementation(async (key) => {
      if (key === 'metadata:topics') return cachedTopics;
      return null;
    });
    vi.mocked(ctx.cache.set).mockResolvedValue(undefined);

    const data = await getTopicsResourceData(ctx);
    expect(data.topics[0].articleCount).toBeUndefined();
  });
});
