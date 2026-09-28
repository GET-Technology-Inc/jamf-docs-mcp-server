/**
 * `DegradationStatus.failure`: what the registry threw, beside a stand-in
 * built in this call, and nothing beside one read from the cache, which keeps
 * that it is a stand-in but not why.
 *
 * `jamf_docs_list_products` words its incomplete note from it when the
 * product half's read is the one that failed
 * (list-products-stand-in-failure.test.ts). Until 2026-09-28 the metadata
 * lookups kept only `degraded`, so that note named learn.jamf.com whatever
 * the registry threw.
 */

import { describe, it, expect } from 'vitest';
import {
  getAvailableVersions,
  getProductAvailability,
  getProductsMetadata,
  type DegradationStatus,
} from '../../../src/core/services/metadata.js';
import { MapsProviderError } from '../../../src/core/services/maps-registry.js';
import { createMockContext } from '../../helpers/mock-context.js';
import type { ServerContext } from '../../../src/core/types/context.js';

/** A context whose registry throws `failure` on every read. */
function failingRegistry(failure: Error): ServerContext {
  const ctx = createMockContext();
  const reject = async (): Promise<never> => await Promise.reject(failure);
  Object.assign(ctx.mapsRegistry, { getProducts: reject, getVersions: reject });
  return ctx;
}

const failure = new MapsProviderError(new Error('KV namespace unavailable'));

describe('DegradationStatus.failure', () => {
  it.each([
    ['getProductsMetadata', getProductsMetadata],
    ['getProductAvailability', getProductAvailability],
  ] as const)('%s: set when the stand-in is built, and absent when it is read from the cache', async (_label, lookup) => {
    const ctx = failingRegistry(failure);
    const built: DegradationStatus = { degraded: false };
    const cached: DegradationStatus = { degraded: false };

    await lookup(ctx, built);
    await lookup(ctx, cached);

    expect(built).toEqual({ degraded: true, failure });
    expect(cached).toEqual({ degraded: true });
  });

  it('getAvailableVersions: set when the registry threw', async () => {
    const status: DegradationStatus = { degraded: false };

    expect(await getAvailableVersions(failingRegistry(failure), 'jamf-pro', status)).toEqual(['current']);
    expect(status).toEqual({ degraded: true, failure });
  });

  it('is absent when the registry answered', async () => {
    const ctx = createMockContext();
    Object.assign(ctx.mapsRegistry, {
      getProducts: async () => await Promise.resolve([]),
      getVersions: async () => await Promise.resolve(['11.32.0']),
    });
    const products: DegradationStatus = { degraded: false };
    const availability: DegradationStatus = { degraded: false };
    const versions: DegradationStatus = { degraded: false };

    await getProductsMetadata(ctx, products);
    await getProductAvailability(ctx, availability);
    await getAvailableVersions(ctx, 'jamf-pro', versions);

    for (const status of [products, availability, versions]) {
      expect(status).toEqual({ degraded: false });
    }
  });
});
