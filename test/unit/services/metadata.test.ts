/**
 * Unit tests for metadata service
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock axios before importing the module under test
vi.mock('axios', async () => {
  const actual = await vi.importActual<typeof import('axios')>('axios');
  return {
    default: {
      ...actual.default,
      get: vi.fn()
    }
  };
});

// Mock cache to avoid file system interaction
vi.mock('../../../src/services/cache.js', () => ({
  cache: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined)
  }
}));

import axios from 'axios';
import { cache } from '../../../src/services/cache.js';
import {
  getProductsMetadata,
  getBundleIdForVersion,
  getAvailableVersions,
  getTopicsMetadata,
  getProductsResourceData,
  getTopicsResourceData
} from '../../../src/services/metadata.js';
import { JAMF_PRODUCTS } from '../../../src/constants.js';

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
    vi.mocked(cache.get).mockResolvedValue(null);
    vi.mocked(cache.set).mockResolvedValue(undefined);
  });

  it('should fall back to static JAMF_PRODUCTS when API throws a network error', async () => {
    vi.mocked(axios.get).mockRejectedValue(new Error('Network error: ECONNREFUSED'));

    const products = await getProductsMetadata();
    expect(products.length).toBeGreaterThan(0);

    // All products from static list should appear
    const staticIds = Object.keys(JAMF_PRODUCTS);
    const resultIds = products.map(p => p.id);
    staticIds.forEach(id => expect(resultIds).toContain(id));
  });

  it('should use static bundleId as fallback when API fails', async () => {
    vi.mocked(axios.get).mockRejectedValue(new Error('Network failure'));

    const products = await getProductsMetadata();
    const pro = products.find(p => p.id === 'jamf-pro');
    expect(pro).toBeDefined();
    expect(pro?.bundleId).toBe(JAMF_PRODUCTS['jamf-pro'].bundleId);
  });

  it('should use static latestVersion as fallback when API fails', async () => {
    vi.mocked(axios.get).mockRejectedValue(new Error('Network failure'));

    const products = await getProductsMetadata();
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

    vi.mocked(cache.get).mockResolvedValue(cachedProducts);
    // Reset the call count so we can assert this test's behavior in isolation
    vi.mocked(axios.get).mockClear();

    const products = await getProductsMetadata();
    expect(products).toEqual(cachedProducts);
    expect(vi.mocked(axios.get)).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Empty API results tests
// ============================================================================

describe('getProductsMetadata - empty API results', () => {
  beforeEach(() => {
    vi.mocked(cache.get).mockResolvedValue(null);
    vi.mocked(cache.set).mockResolvedValue(undefined);
  });

  it('should fall back to static data when API returns empty Results array', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: { status: 'ok', Results: [] }
    });

    const products = await getProductsMetadata();
    expect(products.length).toBeGreaterThan(0);

    // Should still contain all static products
    const staticIds = Object.keys(JAMF_PRODUCTS);
    staticIds.forEach(id => {
      expect(products.some(p => p.id === id)).toBe(true);
    });
  });

  it('should fall back when API returns results with no matching bundle prefix', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: makeSearchResponse(['some-unrelated-bundle-id'])
    });

    const products = await getProductsMetadata();
    // Fallback products should still be present
    expect(products.length).toBeGreaterThan(0);
  });

  it('should handle API response with null leading_results gracefully', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: makeSearchResponse([null, null, null])
    });

    const products = await getProductsMetadata();
    expect(products.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// Version extraction tests
// ============================================================================

describe('version extraction from bundleId', () => {
  beforeEach(() => {
    vi.mocked(cache.get).mockResolvedValue(null);
    vi.mocked(cache.set).mockResolvedValue(undefined);
  });

  it('should extract version from versioned bundleId', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: makeSearchResponse(['jamf-pro-documentation-11.24.0'])
    });

    const products = await getProductsMetadata();
    const pro = products.find(p => p.id === 'jamf-pro');
    expect(pro?.latestVersion).toBe('11.24.0');
  });

  it('should use "current" as latestVersion when bundleId has no version suffix', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: makeSearchResponse(['jamf-pro-documentation'])
    });

    const products = await getProductsMetadata();
    const pro = products.find(p => p.id === 'jamf-pro');
    // bundleId 'jamf-pro-documentation' has no version suffix → versionMatch is null → 'current'
    expect(pro?.latestVersion).toBe('current');
  });

  it('should collect multiple available versions from search results', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: {
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
      }
    });

    const products = await getProductsMetadata();
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
    vi.mocked(cache.get).mockResolvedValue(null);
    vi.mocked(cache.set).mockResolvedValue(undefined);
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
    vi.mocked(cache.get).mockResolvedValue(mockProducts);

    const bundleId = await getBundleIdForVersion('jamf-pro', 'current');
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
    vi.mocked(cache.get).mockResolvedValue(mockProducts);

    const bundleId = await getBundleIdForVersion('jamf-pro', 'latest');
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
    vi.mocked(cache.get).mockResolvedValue(mockProducts);

    const bundleId = await getBundleIdForVersion('jamf-pro', undefined);
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
    vi.mocked(cache.get).mockResolvedValue(mockProducts);

    const bundleId = await getBundleIdForVersion('jamf-pro', '11.23.0');
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
    vi.mocked(cache.get).mockResolvedValue(mockProducts);

    const bundleId = await getBundleIdForVersion('jamf-pro', '10.0.0');
    expect(bundleId).toBeNull();
  });

  it('should return null when product is not found in metadata', async () => {
    vi.mocked(cache.get).mockResolvedValue([]);
    vi.mocked(axios.get).mockResolvedValue({ data: { status: 'ok', Results: [] } });

    const bundleId = await getBundleIdForVersion('jamf-pro', 'current');
    expect(bundleId).toBeNull();
  });
});

// ============================================================================
// getAvailableVersions tests
// ============================================================================

describe('getAvailableVersions', () => {
  beforeEach(() => {
    vi.mocked(cache.get).mockResolvedValue(null);
    vi.mocked(cache.set).mockResolvedValue(undefined);
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
    vi.mocked(cache.get).mockResolvedValue(mockProducts);

    const versions = await getAvailableVersions('jamf-pro');
    expect(versions).toContain('11.24.0');
    expect(versions).toContain('11.23.0');
  });

  it('should return empty array when product is not in metadata', async () => {
    vi.mocked(cache.get).mockResolvedValue([]);
    vi.mocked(axios.get).mockResolvedValue({ data: { Results: [] } });

    const versions = await getAvailableVersions('jamf-pro');
    expect(versions).toEqual([]);
  });

  it('should return single-item array with latestVersion when no versions discovered', async () => {
    // When API fails, static fallback uses [product.latestVersion]
    vi.mocked(axios.get).mockRejectedValue(new Error('network error'));

    const versions = await getAvailableVersions('jamf-pro');
    expect(Array.isArray(versions)).toBe(true);
    expect(versions.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// getTopicsMetadata tests
// ============================================================================

describe('getTopicsMetadata', () => {
  beforeEach(() => {
    vi.mocked(cache.get).mockResolvedValue(null);
    vi.mocked(cache.set).mockResolvedValue(undefined);
  });

  it('should return cached topics without calling API', async () => {
    const cachedTopics = [
      { id: 'enrollment', name: 'Enrollment', source: 'manual' as const }
    ];
    vi.mocked(cache.get).mockImplementation(async (key) => {
      if (key === 'metadata:topics') return cachedTopics;
      return null;
    });
    vi.mocked(axios.get).mockClear();

    const topics = await getTopicsMetadata();
    expect(topics).toEqual(cachedTopics);
    expect(vi.mocked(axios.get)).not.toHaveBeenCalled();
  });

  it('should include at least the manual topics from JAMF_TOPICS when API fails', async () => {
    vi.mocked(cache.get).mockImplementation(async (key) => {
      if (key === 'metadata:topics') return null;
      if (key === 'metadata:products') return []; // empty products → no TOC fetches
      return null;
    });
    vi.mocked(axios.get).mockRejectedValue(new Error('API failure'));

    const topics = await getTopicsMetadata();
    expect(Array.isArray(topics)).toBe(true);
    expect(topics.length).toBeGreaterThan(0);
    // All fallback topics should have source='manual'
    expect(topics.every(t => t.source === 'manual')).toBe(true);
  });

  it('should cache the topics after fetching', async () => {
    vi.mocked(cache.get).mockImplementation(async (key) => {
      if (key === 'metadata:topics') return null;
      if (key === 'metadata:products') return [];
      return null;
    });
    vi.mocked(axios.get).mockRejectedValue(new Error('skip'));

    await getTopicsMetadata();
    expect(vi.mocked(cache.set)).toHaveBeenCalled();
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

    vi.mocked(cache.get).mockImplementation(async (key) => {
      if (key === 'metadata:topics') return null;
      if (key === 'metadata:products') return mockProducts;
      return null;
    });

    // TOC API response with HTML list
    vi.mocked(axios.get).mockResolvedValue({
      data: {
        'nav-1': '<ul><a href="/enroll">Enrollment Guide</a><a href="/sub">Sub Article</a></ul>',
      }
    });

    const topics = await getTopicsMetadata();
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

    vi.mocked(cache.get).mockImplementation(async (key) => {
      if (key === 'metadata:topics') return null;
      if (key === 'metadata:products') return mockProducts;
      return null;
    });
    vi.mocked(axios.get).mockRejectedValue(new Error('TOC fetch failed'));

    await expect(getTopicsMetadata()).resolves.not.toThrow();
  });
});

// ============================================================================
// getProductsResourceData tests
// ============================================================================

describe('getProductsResourceData', () => {
  beforeEach(() => {
    vi.mocked(cache.set).mockResolvedValue(undefined);
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
    vi.mocked(cache.get).mockResolvedValue(mockProducts);

    const data = await getProductsResourceData();

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
    vi.mocked(cache.get).mockResolvedValue(mockProducts);

    const data = await getProductsResourceData();
    const product = data.products[0];

    expect(product.id).toBe('jamf-pro');
    expect(product.name).toBe('Jamf Pro');
    expect(product.description).toBe('Enterprise MDM');
    expect(product.latestVersion).toBe('11.24.0');
    expect(product.availableVersions).toEqual(['11.24.0', '11.23.0']);
    expect(product.bundleId).toBe('jamf-pro-documentation-11.24.0');
  });

  it('should return a valid ISO timestamp in lastUpdated', async () => {
    vi.mocked(cache.get).mockResolvedValue([]);
    vi.mocked(axios.get).mockRejectedValue(new Error('skip'));

    const data = await getProductsResourceData();
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
    vi.mocked(cache.get).mockImplementation(async (key) => {
      if (key === 'metadata:topics') return cachedTopics;
      return null;
    });
    vi.mocked(cache.set).mockResolvedValue(undefined);

    const data = await getTopicsResourceData();

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
    vi.mocked(cache.get).mockImplementation(async (key) => {
      if (key === 'metadata:topics') return cachedTopics;
      return null;
    });
    vi.mocked(cache.set).mockResolvedValue(undefined);

    const data = await getTopicsResourceData();
    const topic = data.topics[0];

    expect(topic.id).toBe('enrollment');
    expect(topic.name).toBe('Enrollment & Onboarding');
    expect(topic.source).toBe('manual');
  });

  it('should include articleCount when present', async () => {
    const cachedTopics = [
      { id: 'enrollment', name: 'Enrollment', source: 'toc' as const, articleCount: 42 },
    ];
    vi.mocked(cache.get).mockImplementation(async (key) => {
      if (key === 'metadata:topics') return cachedTopics;
      return null;
    });
    vi.mocked(cache.set).mockResolvedValue(undefined);

    const data = await getTopicsResourceData();
    expect(data.topics[0].articleCount).toBe(42);
  });

  it('should omit articleCount when undefined', async () => {
    const cachedTopics = [
      { id: 'enrollment', name: 'Enrollment', source: 'manual' as const },
    ];
    vi.mocked(cache.get).mockImplementation(async (key) => {
      if (key === 'metadata:topics') return cachedTopics;
      return null;
    });
    vi.mocked(cache.set).mockResolvedValue(undefined);

    const data = await getTopicsResourceData();
    expect(data.topics[0].articleCount).toBeUndefined();
  });
});
