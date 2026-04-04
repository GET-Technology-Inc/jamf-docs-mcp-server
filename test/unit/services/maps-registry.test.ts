/**
 * Unit tests for MapsRegistry
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../src/core/services/ft-client.js', () => ({
  fetchMaps: vi.fn(),
}));

import { fetchMaps } from '../../../src/core/services/ft-client.js';
import { MapsRegistry } from '../../../src/core/services/maps-registry.js';
import { createMockCache } from '../../helpers/mock-context.js';

const mockedFetchMaps = vi.mocked(fetchMaps);

function makeMeta(entries: Record<string, string[]>): { key: string; label: string; values: string[] }[] {
  return Object.entries(entries).map(([key, values]) => ({ key, label: key, values }));
}

function makeMap(id: string, title: string, meta: Record<string, string[]>) {
  return { id, title, mapApiEndpoint: `/api/khub/maps/${id}`, metadata: makeMeta(meta) };
}

const MOCK_MAPS = [
  makeMap('pro-en-latest', 'Jamf Pro Documentation 11.26.0', {
    'version_bundle_stem': ['jamf-pro-documentation'],
    'version': ['11.26.0'],
    'ft:locale': ['en-US'],
    'latestVersion': ['yes'],
    'bundle': ['jamf-pro-documentation-11.26.0', 'jamf-pro-documentation-current'],
  }),
  makeMap('pro-en-old', 'Jamf Pro Documentation 11.12.0', {
    'version_bundle_stem': ['jamf-pro-documentation'],
    'version': ['11.12.0'],
    'ft:locale': ['en-US'],
    'bundle': ['jamf-pro-documentation-11.12.0'],
  }),
  makeMap('pro-ja-latest', 'Jamf Pro Documentation 11.26.0', {
    'version_bundle_stem': ['jamf-pro-documentation'],
    'version': ['11.26.0'],
    'ft:locale': ['ja-JP'],
    'latestVersion': ['yes'],
    'bundle': ['jamf-pro-documentation-11.26.0'],
  }),
  makeMap('connect-en', 'Jamf Connect Documentation', {
    'version_bundle_stem': ['jamf-connect-documentation'],
    'ft:locale': ['en-US'],
    'latestVersion': ['yes'],
    'bundle': ['jamf-connect-documentation-current'],
  }),
  makeMap('glossary-en', 'Jamf Platform Technical Glossary', {
    'ft:locale': ['en-US'],
    'bundle': ['jamf-technical-glossary'],
  }),
  makeMap('glossary-ja', 'Jamf Platform Technical Glossary', {
    'ft:locale': ['ja-JP'],
    'bundle': ['jamf-technical-glossary'],
  }),
];

let registry: MapsRegistry;

beforeEach(() => {
  vi.clearAllMocks();
  mockedFetchMaps.mockResolvedValue(MOCK_MAPS);
  registry = new MapsRegistry(createMockCache());
});

describe('resolveMapId', () => {
  it('should resolve latest version for a product', async () => {
    const mapId = await registry.resolveMapId('jamf-pro-documentation');
    expect(mapId).toBe('pro-en-latest');
  });

  it('should resolve specific version', async () => {
    const mapId = await registry.resolveMapId('jamf-pro-documentation', '11.12.0');
    expect(mapId).toBe('pro-en-old');
  });

  it('should resolve for a specific locale', async () => {
    const mapId = await registry.resolveMapId('jamf-pro-documentation', undefined, 'ja-JP');
    expect(mapId).toBe('pro-ja-latest');
  });

  it('should fallback to en-US when locale not found', async () => {
    const mapId = await registry.resolveMapId('jamf-pro-documentation', undefined, 'de-DE');
    expect(mapId).toBe('pro-en-latest');
  });

  it('should return null for unknown product', async () => {
    const mapId = await registry.resolveMapId('nonexistent-product');
    expect(mapId).toBeNull();
  });

  it('should resolve unversioned product', async () => {
    const mapId = await registry.resolveMapId('jamf-connect-documentation');
    expect(mapId).toBe('connect-en');
  });
});

describe('resolveFromBundleId', () => {
  it('should resolve from versioned bundleId', async () => {
    const mapId = await registry.resolveFromBundleId('jamf-pro-documentation-11.12.0');
    expect(mapId).toBe('pro-en-old');
  });

  it('should resolve from current bundleId', async () => {
    const mapId = await registry.resolveFromBundleId('jamf-pro-documentation-current');
    expect(mapId).toBe('pro-en-latest');
  });

  it('should resolve from direct bundle match', async () => {
    const mapId = await registry.resolveFromBundleId('jamf-technical-glossary');
    expect(mapId).toBe('glossary-en');
  });

  it('should return null for unknown bundleId', async () => {
    const mapId = await registry.resolveFromBundleId('nonexistent-bundle-1.0.0');
    expect(mapId).toBeNull();
  });
});

describe('resolveGlossaryMapId', () => {
  it('should find the glossary map for en-US', async () => {
    const mapId = await registry.resolveGlossaryMapId();
    expect(mapId).toBe('glossary-en');
  });

  it('should find the glossary map for ja-JP', async () => {
    const mapId = await registry.resolveGlossaryMapId('ja-JP');
    expect(mapId).toBe('glossary-ja');
  });

  it('should fallback to en-US for unknown locale', async () => {
    const mapId = await registry.resolveGlossaryMapId('th-TH');
    expect(mapId).toBe('glossary-en');
  });
});

describe('getProducts', () => {
  it('should return unique products with versions', async () => {
    const products = await registry.getProducts();

    expect(products.length).toBeGreaterThanOrEqual(3);

    const pro = products.find(p => p.bundleStem === 'jamf-pro-documentation');
    expect(pro).toBeDefined();
    expect(pro!.versions).toContain('11.26.0');
    expect(pro!.versions).toContain('11.12.0');
    // Latest version should be first (descending sort)
    expect(pro!.versions[0]).toBe('11.26.0');
  });

  it('should include unversioned products', async () => {
    const products = await registry.getProducts();
    const glossary = products.find(p => p.bundleStem === 'jamf-technical-glossary');
    expect(glossary).toBeDefined();
    expect(glossary!.versions).toHaveLength(0);
  });
});

describe('getVersions', () => {
  it('should return versions sorted descending', async () => {
    const versions = await registry.getVersions('jamf-pro-documentation');
    expect(versions).toEqual(['11.26.0', '11.12.0']);
  });

  it('should return empty for unversioned product', async () => {
    const versions = await registry.getVersions('jamf-technical-glossary');
    expect(versions).toHaveLength(0);
  });
});

describe('caching', () => {
  it('should call fetchMaps only once for multiple operations', async () => {
    await registry.resolveMapId('jamf-pro-documentation');
    await registry.resolveMapId('jamf-connect-documentation');
    await registry.getProducts();

    expect(mockedFetchMaps).toHaveBeenCalledTimes(1);
  });

  it('should re-fetch after cacheTtl expires', async () => {
    vi.useFakeTimers();
    const shortTtlRegistry = new MapsRegistry(createMockCache(), mockedFetchMaps, undefined, 50);

    await shortTtlRegistry.resolveMapId('jamf-pro-documentation');
    expect(mockedFetchMaps).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60);

    await shortTtlRegistry.resolveMapId('jamf-pro-documentation');
    expect(mockedFetchMaps).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });
});
