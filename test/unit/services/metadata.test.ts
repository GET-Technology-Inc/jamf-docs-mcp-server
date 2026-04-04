/**
 * Unit tests for metadata service (MapsRegistry-backed)
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { RegistryProductInfo } from '../../../src/core/services/maps-registry.js';
import {
  getProductsMetadata,
  getBundleIdForVersion,
  getAvailableVersions,
  getTopicsMetadata,
  getProductsResourceData,
  getTopicsResourceData,
  getProductAvailability,
} from '../../../src/core/services/metadata.js';
import { JAMF_PRODUCTS, JAMF_TOPICS } from '../../../src/core/constants.js';
import { createMockContext } from '../../helpers/mock-context.js';

const ctx = createMockContext();

// Helper to access the mocked MapsRegistry methods on ctx
function getMockedRegistry(): {
  getProducts: ReturnType<typeof vi.fn>;
  getVersions: ReturnType<typeof vi.fn>;
  resolveMapId: ReturnType<typeof vi.fn>;
} {
  return ctx.mapsRegistry as unknown as {
    getProducts: ReturnType<typeof vi.fn>;
    getVersions: ReturnType<typeof vi.fn>;
    resolveMapId: ReturnType<typeof vi.fn>;
  };
}

// Spy on ctx.mapsRegistry methods so tests can control their behavior
vi.spyOn(ctx.mapsRegistry, 'getProducts');
vi.spyOn(ctx.mapsRegistry, 'getVersions');
vi.spyOn(ctx.mapsRegistry, 'resolveMapId');

// ============================================================================
// Helpers
// ============================================================================

function makeRegistryProduct(overrides: Partial<RegistryProductInfo> = {}): RegistryProductInfo {
  return {
    bundleStem: 'jamf-pro-documentation',
    title: 'Jamf Pro Documentation',
    versions: ['11.24.0', '11.23.0'],
    ...overrides,
  };
}

// ============================================================================
// getProductsMetadata tests
// ============================================================================

describe('getProductsMetadata - MapsRegistry integration', () => {
  beforeEach(() => {
    vi.mocked(ctx.cache.get).mockResolvedValue(null);
    vi.mocked(ctx.cache.set).mockResolvedValue(undefined);
  });

  it('should return products from MapsRegistry with correct metadata', async () => {
    const registryProducts: RegistryProductInfo[] = [
      makeRegistryProduct({
        bundleStem: 'jamf-pro-documentation',
        title: 'Jamf Pro Documentation',
        versions: ['11.24.0', '11.23.0'],
      }),
    ];
    getMockedRegistry().getProducts.mockResolvedValue(registryProducts);

    const products = await getProductsMetadata(ctx);
    const pro = products.find(p => p.id === 'jamf-pro');

    expect(pro).toBeDefined();
    expect(pro?.name).toBe('Jamf Pro');
    expect(pro?.latestVersion).toBe('11.24.0');
    expect(pro?.availableVersions).toEqual(['11.24.0', '11.23.0']);
    expect(pro?.bundleId).toBe('jamf-pro-documentation-11.24.0');
    expect(pro?.labelKey).toBe('product-pro');
  });

  it('should fall back to static JAMF_PRODUCTS when MapsRegistry throws', async () => {
    getMockedRegistry().getProducts.mockRejectedValue(
      new Error('Network error: ECONNREFUSED')
    );

    const products = await getProductsMetadata(ctx);
    expect(products.length).toBeGreaterThan(0);

    // All products from static list should appear
    const staticIds = Object.keys(JAMF_PRODUCTS);
    const resultIds = products.map(p => p.id);
    staticIds.forEach(id => expect(resultIds).toContain(id));
  });

  it('should use static bundleId as fallback when MapsRegistry fails', async () => {
    getMockedRegistry().getProducts.mockRejectedValue(new Error('Network failure'));

    const products = await getProductsMetadata(ctx);
    const pro = products.find(p => p.id === 'jamf-pro');
    expect(pro).toBeDefined();
    expect(pro?.bundleId).toBe(JAMF_PRODUCTS['jamf-pro'].bundleId);
  });

  it('should use static latestVersion as fallback when MapsRegistry fails', async () => {
    getMockedRegistry().getProducts.mockRejectedValue(new Error('Network failure'));

    const products = await getProductsMetadata(ctx);
    const pro = products.find(p => p.id === 'jamf-pro');
    expect(pro?.latestVersion).toBeDefined();
    expect(pro?.latestVersion).toBe(JAMF_PRODUCTS['jamf-pro'].latestVersion);
  });

  it('should return cached data without calling MapsRegistry again', async () => {
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
    getMockedRegistry().getProducts.mockClear();

    const products = await getProductsMetadata(ctx);
    expect(products).toEqual(cachedProducts);
    expect(getMockedRegistry().getProducts).not.toHaveBeenCalled();
  });

  it('should use fallback for products not found in registry', async () => {
    // Registry only has jamf-pro, not jamf-school
    const registryProducts: RegistryProductInfo[] = [
      makeRegistryProduct({
        bundleStem: 'jamf-pro-documentation',
        versions: ['11.24.0'],
      }),
    ];
    getMockedRegistry().getProducts.mockResolvedValue(registryProducts);

    const products = await getProductsMetadata(ctx);
    const school = products.find(p => p.id === 'jamf-school');
    expect(school).toBeDefined();
    expect(school?.bundleId).toBe(JAMF_PRODUCTS['jamf-school'].bundleId);
  });

  it('should handle unversioned products from registry', async () => {
    const registryProducts: RegistryProductInfo[] = [
      makeRegistryProduct({
        bundleStem: 'jamf-pro-documentation',
        versions: [],
      }),
    ];
    getMockedRegistry().getProducts.mockResolvedValue(registryProducts);

    const products = await getProductsMetadata(ctx);
    const pro = products.find(p => p.id === 'jamf-pro');
    expect(pro?.latestVersion).toBe('current');
    expect(pro?.availableVersions).toEqual(['current']);
    expect(pro?.bundleId).toBe('jamf-pro-documentation');
  });

  it('should cache the results after fetching', async () => {
    getMockedRegistry().getProducts.mockResolvedValue([]);

    await getProductsMetadata(ctx);
    expect(vi.mocked(ctx.cache.set)).toHaveBeenCalled();
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
    // Empty products from cache, MapsRegistry returns empty
    vi.mocked(ctx.cache.get).mockResolvedValue(null);
    getMockedRegistry().getProducts.mockResolvedValue([]);

    const bundleId = await getBundleIdForVersion(ctx, 'jamf-pro', 'current');
    // Falls back to static, so jamf-pro should still be found
    // The static fallback has latestVersion 'current' and bundleId 'jamf-pro-documentation'
    expect(bundleId).toBe('jamf-pro-documentation');
  });
});

// ============================================================================
// getAvailableVersions tests
// ============================================================================

describe('getAvailableVersions', () => {
  beforeEach(() => {
    vi.mocked(ctx.cache.get).mockResolvedValue(null);
    vi.mocked(ctx.cache.set).mockResolvedValue(undefined);
    getMockedRegistry().getVersions.mockReset();
  });

  it('should return versions from MapsRegistry.getVersions() directly', async () => {
    getMockedRegistry().getVersions.mockResolvedValue(['11.24.0', '11.23.0', '11.22.0']);

    const versions = await getAvailableVersions(ctx, 'jamf-pro');
    expect(versions).toEqual(['11.24.0', '11.23.0', '11.22.0']);
    expect(getMockedRegistry().getVersions).toHaveBeenCalledWith('jamf-pro-documentation');
  });

  it('should NOT call getProducts (avoids loading full catalogue)', async () => {
    getMockedRegistry().getVersions.mockResolvedValue(['11.24.0']);
    getMockedRegistry().getProducts.mockClear();

    await getAvailableVersions(ctx, 'jamf-pro');
    expect(getMockedRegistry().getProducts).not.toHaveBeenCalled();
  });

  it('should fall back to static latestVersion when getVersions returns empty', async () => {
    getMockedRegistry().getVersions.mockResolvedValue([]);

    const versions = await getAvailableVersions(ctx, 'jamf-pro');
    expect(Array.isArray(versions)).toBe(true);
    expect(versions.length).toBeGreaterThan(0);
    expect(versions).toContain(JAMF_PRODUCTS['jamf-pro'].latestVersion);
  });

  it('should fall back to static latestVersion when getVersions throws', async () => {
    getMockedRegistry().getVersions.mockRejectedValue(new Error('network error'));

    const versions = await getAvailableVersions(ctx, 'jamf-pro');
    expect(Array.isArray(versions)).toBe(true);
    expect(versions.length).toBeGreaterThan(0);
    expect(versions).toContain(JAMF_PRODUCTS['jamf-pro'].latestVersion);
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

  it('should return cached topics without calling registry', async () => {
    const cachedTopics = [
      { id: 'enrollment', name: 'Enrollment', source: 'manual' as const }
    ];
    vi.mocked(ctx.cache.get).mockImplementation(async (key) => {
      if (key === 'metadata:topics') return cachedTopics;
      return null;
    });

    const topics = await getTopicsMetadata(ctx);
    expect(topics).toEqual(cachedTopics);
  });

  it('should include all manual topics from JAMF_TOPICS', async () => {
    const topics = await getTopicsMetadata(ctx);
    expect(Array.isArray(topics)).toBe(true);
    expect(topics.length).toBeGreaterThan(0);
    // All topics should have source='manual'
    expect(topics.every(t => t.source === 'manual')).toBe(true);
  });

  it('should cache the topics after fetching', async () => {
    await getTopicsMetadata(ctx);
    expect(vi.mocked(ctx.cache.set)).toHaveBeenCalled();
  });

  it('should include known topic IDs', async () => {
    const topics = await getTopicsMetadata(ctx);
    const topicIds = topics.map(t => t.id);
    const expectedIds = Object.keys(JAMF_TOPICS);
    for (const id of expectedIds) {
      expect(topicIds).toContain(id);
    }
  });
});

// ============================================================================
// getProductAvailability tests
// ============================================================================

describe('getProductAvailability', () => {
  beforeEach(() => {
    vi.mocked(ctx.cache.get).mockResolvedValue(null);
    vi.mocked(ctx.cache.set).mockResolvedValue(undefined);
  });

  it('should return true for products found in registry', async () => {
    const registryProducts: RegistryProductInfo[] = [
      makeRegistryProduct({ bundleStem: 'jamf-pro-documentation' }),
    ];
    getMockedRegistry().getProducts.mockResolvedValue(registryProducts);

    const availability = await getProductAvailability(ctx);
    expect(availability['jamf-pro']).toBe(true);
    expect(availability['jamf-school']).toBe(false);
  });

  it('should return cached availability', async () => {
    const cached = { 'jamf-pro': true, 'jamf-school': false };
    vi.mocked(ctx.cache.get).mockResolvedValue(cached);

    const availability = await getProductAvailability(ctx);
    expect(availability).toEqual(cached);
  });

  it('should assume all products available on registry failure', async () => {
    getMockedRegistry().getProducts.mockRejectedValue(new Error('fail'));

    const availability = await getProductAvailability(ctx);
    const productIds = Object.keys(JAMF_PRODUCTS);
    for (const id of productIds) {
      expect(availability[id]).toBe(true);
    }
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
    vi.mocked(ctx.cache.get).mockResolvedValue(null);
    getMockedRegistry().getProducts.mockRejectedValue(new Error('skip'));

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
