/**
 * The `product` search filter against the live Fluid Topics API: the local
 * post-filter must agree with the upstream one (#334).
 *
 * Asserted as an invariant rather than as content. Whatever Jamf files under
 * these products this week, a product search that came back with results must
 * not then report the product filter as removed, and must show every result
 * under the product asked for. Before #334 all three of these products failed
 * both on every non-empty search, because the post-filter read one
 * classification value per result where Fluid Topics matches on any.
 *
 * Zero results passes vacuously, by design: "Jamf has no document matching
 * this query under this product" is Jamf's business, not a defect here.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { MapsRegistry } from '../../src/core/services/maps-registry.js';
import { searchDocumentation } from '../../src/core/services/search-service.js';
import { JAMF_PRODUCTS, type ProductId } from '../../src/core/constants.js';
import { createMockCache, createMockContext } from '../helpers/mock-context.js';
import type { ServerContext } from '../../src/core/types/context.js';

let ctx: ServerContext;

beforeAll(async () => {
  const cache = createMockCache();
  const mapsRegistry = new MapsRegistry(cache);
  ctx = createMockContext({ cache, mapsRegistry });
  await mapsRegistry.ensureBuilt();
}, 60000);

describe('a product search keeps what Fluid Topics returned for the product', () => {
  // The three products whose own publication the old post-filter rejected:
  // Jamf files each under several products, and lists another first.
  it.each([
    ['jamf-security-cloud', 'policy'],
    ['jamf-setup-reset', 'install'],
    ['jamf-trust', 'policy'],
  ] as [ProductId, string][])('%s ("%s")', async (product, query) => {
    const result = await searchDocumentation(ctx, { query, product, limit: 50 });

    expect(result.searchError).toBeUndefined();
    expect(
      result.filterRelaxation?.removed ?? [],
      `Fluid Topics returned results for ${product}, and the local product ` +
      'filter then rejected them: the two filters disagree again.',
    ).not.toContain('product');
    for (const r of result.results) {
      expect(r.product).toBe(JAMF_PRODUCTS[product].name);
    }
  }, 30000);
});
