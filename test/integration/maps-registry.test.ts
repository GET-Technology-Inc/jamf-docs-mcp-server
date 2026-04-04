/**
 * Integration test for MapsRegistry — verifies real FT API resolution
 */

import { describe, it, expect } from 'vitest';
import { MapsRegistry } from '../../src/core/services/maps-registry.js';
import { createMockCache } from '../helpers/mock-context.js';

describe('MapsRegistry integration', () => {
  const registry = new MapsRegistry(createMockCache());

  it('should resolve Jamf Pro latest to a mapId', async () => {
    const mapId = await registry.resolveMapId('jamf-pro-documentation');
    expect(mapId).toBeTruthy();
    expect(typeof mapId).toBe('string');
  }, 15000);

  it('should resolve Jamf Connect to a mapId', async () => {
    const mapId = await registry.resolveMapId('jamf-connect-documentation');
    expect(mapId).toBeTruthy();
  }, 15000);

  it('should resolve glossary mapId', async () => {
    const mapId = await registry.resolveGlossaryMapId();
    expect(mapId).toBeTruthy();
  }, 15000);

  it('should resolve from legacy bundleId', async () => {
    const mapId = await registry.resolveFromBundleId('jamf-pro-documentation-current');
    expect(mapId).toBeTruthy();
  }, 15000);

  it('should list products with versions', async () => {
    const products = await registry.getProducts();
    expect(products.length).toBeGreaterThan(10);

    const pro = products.find(p => p.bundleStem === 'jamf-pro-documentation');
    expect(pro).toBeDefined();
    expect(pro!.versions.length).toBeGreaterThan(0);
  }, 15000);

  it('should get versions for Jamf Pro', async () => {
    const versions = await registry.getVersions('jamf-pro-documentation');
    expect(versions.length).toBeGreaterThan(0);
    // First version should be latest (highest number)
    expect(versions[0]).toMatch(/^\d+\.\d+/);
  }, 15000);
});
