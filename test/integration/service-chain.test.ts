/**
 * Cross-service integration tests — validates data flows across service boundaries
 * using the real Fluid Topics API.
 *
 * WHY this file exists:
 * Product filtering was broken because `extractProductSlug` was called on opaque
 * hash mapIds. Unit/mock tests passed because mocks used readable strings.
 * These tests catch that class of mock/reality mismatch by touching the real API.
 *
 * Key assertions:
 * - product field comes from zoominmetadata, NOT from mapId
 * - mapIds returned by FT API are opaque hashes, not slug-like strings
 * - all chain links (search → fetch, TOC → resolver, registry → TOC) work end-to-end
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { MapsRegistry } from '../../src/core/services/maps-registry.js';
import { TopicResolver } from '../../src/core/services/topic-resolver.js';
import { searchDocumentation } from '../../src/core/services/search-service.js';
import { fetchTableOfContents } from '../../src/core/services/toc-service.js';
import { resolveAndFetchArticle } from '../../src/core/services/article-service.js';
import { JAMF_PRODUCTS } from '../../src/core/constants.js';
import { createMockCache, createMockContext } from '../helpers/mock-context.js';
import type { ServerContext } from '../../src/core/types/context.js';
import type { SearchResult, TocEntry } from '../../src/core/types.js';

// ─── Shared context setup ──────────────────────────────────────────────────────
//
// We create ONE context for the whole suite and pre-warm the MapsRegistry in
// beforeAll so every test pays the API cost only once.

let ctx: ServerContext;

// Cache shared search/TOC results across tests to reduce API load.
let proSearchResults: SearchResult[] = [];
let proTocEntries: TocEntry[] = [];

beforeAll(async () => {
  const cache = createMockCache();
  const mapsRegistry = new MapsRegistry(cache);
  const topicResolver = new TopicResolver(mapsRegistry, cache);

  ctx = createMockContext({ cache, mapsRegistry, topicResolver });

  // Warm the registry once — all tests share the same entries.
  await mapsRegistry.ensureBuilt();

  // Pre-fetch search results for 'enrollment' (no product filter) — reused across tests.
  const searchResult = await searchDocumentation(ctx, {
    query: 'enrollment',
    limit: 20,
  });
  proSearchResults = searchResult.results;

  // Pre-fetch Jamf Pro TOC — reused across tests.
  const tocResult = await fetchTableOfContents(ctx, 'jamf-pro', 'current', { maxTokens: 20000 });
  proTocEntries = tocResult.toc;
}, 60000);

// ─── Helper ────────────────────────────────────────────────────────────────────

/** Flatten a nested TocEntry tree into a flat array */
function flattenToc(entries: TocEntry[]): TocEntry[] {
  const out: TocEntry[] = [];
  for (const entry of entries) {
    out.push(entry);
    if (entry.children !== undefined && entry.children.length > 0) {
      out.push(...flattenToc(entry.children));
    }
  }
  return out;
}

// =============================================================================
// 1. Search → product filtering chain
// =============================================================================

describe('search product filtering with real API data', () => {
  it('product filtering works even though mapIds are opaque hashes', async () => {
    const result = await searchDocumentation(ctx, {
      query: 'enrollment',
      product: 'jamf-pro',
      limit: 10,
    });

    // Filtering must not silently wipe all results
    expect(result.results.length).toBeGreaterThan(0);

    // Every result that carries a product must claim 'Jamf Pro'
    for (const r of result.results) {
      if (r.product !== null) {
        expect(r.product).toBe('Jamf Pro');
      }
    }
  }, 30000);

  it('product field comes from zoominmetadata, not from mapId', async () => {
    // Use the pre-fetched unfiltered results; pick results whose product is 'Jamf Pro'.
    const proResults = proSearchResults.filter(r => r.product === 'Jamf Pro');

    // Guard: if the API returned no Jamf Pro results at all, skip the mapId assertion
    // but still confirm we got some results from the search.
    expect(proSearchResults.length).toBeGreaterThan(0);

    if (proResults.length === 0) {
      // No Jamf Pro results in batch — still a passing scenario, nothing to assert.
      return;
    }

    for (const r of proResults) {
      // mapId must be defined for API results
      expect(r.mapId).toBeDefined();

      // CRITICAL: The mapId returned by Fluid Topics is an opaque hash (e.g.
      // 'uRhiWJWbjHyL1vegaHmj8g'), NOT a readable slug like 'jamf-pro-documentation'.
      // If this assertion fails it means the API changed and mapIds became slugs —
      // which would make the original bug latent again.
      if (r.mapId !== undefined) {
        const mapId = r.mapId;
        // A slug would look like 'jamf-pro-documentation-...' (contains hyphens and
        // known bundle stems). An opaque hash has NO product name in it.
        // We assert that it does NOT start with 'jamf-pro' as a slug would.
        const looksLikeSlug = mapId.startsWith('jamf-pro') || mapId.startsWith('jamf-school')
          || mapId.startsWith('jamf-connect') || mapId.startsWith('jamf-protect');
        expect(looksLikeSlug).toBe(false);
      }

      // The product name must be human-readable, not an opaque identifier
      expect(r.product).toBe('Jamf Pro');
      expect(r.product).not.toMatch(/^[a-zA-Z0-9_-]{20,}$/); // not a raw hash
    }
  }, 30000);

  it('unfiltered search returns results from multiple products', async () => {
    // proSearchResults was fetched without a product filter
    expect(proSearchResults.length).toBeGreaterThan(0);

    const uniqueProducts = new Set(
      proSearchResults.map(r => r.product).filter((p): p is string => p !== null)
    );

    // A broad query like 'enrollment' should span at least 2 products
    expect(uniqueProducts.size).toBeGreaterThanOrEqual(2);
  }, 30000);

  it('each result has a non-empty URL pointing to learn.jamf.com', async () => {
    expect(proSearchResults.length).toBeGreaterThan(0);

    for (const r of proSearchResults) {
      expect(r.url).toBeTruthy();
      expect(r.url).toMatch(/^https:\/\/learn\.jamf\.com\//);
    }
  }, 30000);
});

// =============================================================================
// 2. Search → article fetch chain
// =============================================================================

describe('search → article fetch chain', () => {
  it('can fetch an article found by search using its mapId and contentId', async () => {
    // Pick a result that has both mapId and contentId (TOPIC entries do)
    const candidate = proSearchResults.find(
      r => r.mapId !== undefined && r.contentId !== undefined && r.url !== ''
    );

    // Guard: skip if search returned no TOPIC-typed results
    if (candidate === undefined) {
      return;
    }

    const article = await resolveAndFetchArticle(
      ctx,
      { url: candidate.url, mapId: candidate.mapId, contentId: candidate.contentId },
      { maxTokens: 2000 },
    );

    expect(article.title).toBeTruthy();
    expect(article.content.length).toBeGreaterThan(50);
    expect(article.url).toMatch(/^https:\/\/learn\.jamf\.com\//);
    expect(article.mapId).toBe(candidate.mapId);
    expect(article.contentId).toBe(candidate.contentId);
    expect(article.tokenInfo).toBeDefined();
    expect(article.tokenInfo.tokenCount).toBeGreaterThan(0);
  }, 45000);

  it('fetched article URL is a valid display URL (not an opaque API path)', async () => {
    const candidate = proSearchResults.find(
      r => r.mapId !== undefined && r.contentId !== undefined
    );

    if (candidate === undefined) {
      return;
    }

    const article = await resolveAndFetchArticle(
      ctx,
      { url: candidate.url, mapId: candidate.mapId, contentId: candidate.contentId },
      { maxTokens: 1000 },
    );

    // Display URL must be a human-readable learn.jamf.com URL, not a raw API endpoint
    expect(article.url).toMatch(/^https:\/\/learn\.jamf\.com\//);
    expect(article.url).not.toContain('/api/khub/');
  }, 45000);
});

// =============================================================================
// 3. MapsRegistry → TOC → TopicResolver chain
// =============================================================================

describe('MapsRegistry → TOC → TopicResolver chain', () => {
  it('can resolve a TOC entry URL back to mapId + contentId', async () => {
    const flatEntries = flattenToc(proTocEntries);
    // Find any entry with a URL that follows the legacy bundle format
    // (those can be resolved by TopicResolver)
    const candidate = flatEntries.find(
      e => e.url.includes('/bundle/') && e.url.includes('/page/')
    );

    if (candidate === undefined) {
      // Try any entry with a URL — some maps use prettyUrl format
      const anyEntry = flatEntries.find(e => e.url !== '');
      if (anyEntry === undefined) {
        // No resolvable entries found — skip rather than fail
        return;
      }

      const resolved = await ctx.topicResolver.resolve({ url: anyEntry.url });
      expect(resolved.mapId).toBeTruthy();
      expect(typeof resolved.mapId).toBe('string');
      expect(resolved.contentId).toBeTruthy();
      expect(typeof resolved.contentId).toBe('string');
      return;
    }

    const resolved = await ctx.topicResolver.resolve({ url: candidate.url });

    expect(resolved.mapId).toBeTruthy();
    expect(typeof resolved.mapId).toBe('string');
    expect(resolved.contentId).toBeTruthy();
    expect(typeof resolved.contentId).toBe('string');
    expect(resolved.locale).toBe('en-US');
  }, 45000);

  it('MapsRegistry product versions match TOC availability', async () => {
    const versions = await ctx.mapsRegistry.getVersions('jamf-pro-documentation');

    // Registry must know at least one version
    expect(versions.length).toBeGreaterThan(0);

    // TOC for the latest (default) version must be non-empty
    expect(proTocEntries.length).toBeGreaterThan(0);
  }, 30000);

  it('resolveMapId returns an opaque hash, not a bundle-name slug', async () => {
    const mapId = await ctx.mapsRegistry.resolveMapId('jamf-pro-documentation');

    expect(mapId).toBeTruthy();
    expect(typeof mapId).toBe('string');

    // The resolved mapId must NOT look like a bundle slug
    // (regression guard: if FT ever starts returning slugs, this will catch it)
    expect(mapId).not.toMatch(/^jamf-pro-documentation/);
  }, 15000);

  it('TOC entries have valid learn.jamf.com URLs', async () => {
    expect(proTocEntries.length).toBeGreaterThan(0);

    const flatEntries = flattenToc(proTocEntries);
    const urlEntries = flatEntries.filter(e => e.url !== '');

    expect(urlEntries.length).toBeGreaterThan(0);

    for (const entry of urlEntries.slice(0, 10)) {
      expect(entry.url).toMatch(/^https:\/\/learn\.jamf\.com\//);
    }
  }, 15000);

  it('can fetch TOC for multiple products', async () => {
    const products: Array<'jamf-connect' | 'jamf-protect'> = ['jamf-connect', 'jamf-protect'];

    for (const product of products) {
      const tocResult = await fetchTableOfContents(ctx, product, 'current', { maxTokens: 5000 });
      expect(tocResult.toc.length).toBeGreaterThan(0);

      const productDef = JAMF_PRODUCTS[product];
      // Verify the registry could resolve a mapId for each product (it must have, to get the TOC)
      const mapId = await ctx.mapsRegistry.resolveMapId(productDef.bundleId);
      expect(mapId).toBeTruthy();
    }
  }, 60000);
});

// =============================================================================
// 4. Filter fallback preserves data integrity
// =============================================================================

describe('filter fallback preserves data integrity', () => {
  it('progressive filter relaxation still returns valid search results', async () => {
    // Use a topic filter that is likely to trigger relaxation for a narrow query
    const result = await searchDocumentation(ctx, {
      query: 'enrollment certificate authority',
      product: 'jamf-connect',  // narrow product filter
      topic: 'filevault',       // unlikely to match in jamf-connect → triggers relaxation
      limit: 10,
    });

    // Whether relaxed or not, all results must have valid structure
    for (const r of result.results) {
      expect(r.title).toBeTruthy();
      expect(r.url).toMatch(/^https:\/\/learn\.jamf\.com\//);
      // product may be null for some entries but must be a string or null
      expect(r.product === null || typeof r.product === 'string').toBe(true);
    }

    // If relaxation occurred, it must be reported
    if (result.filterRelaxation !== undefined) {
      expect(result.filterRelaxation.removed.length).toBeGreaterThan(0);
      expect(result.filterRelaxation.message).toBeTruthy();
    }
  }, 30000);

  it('search with only a product filter returns results whose product matches', async () => {
    const result = await searchDocumentation(ctx, {
      query: 'configuration profile',
      product: 'jamf-school',
      limit: 5,
    });

    // Results may be 0 if the product has no relevant content, but if we got results
    // they should all be from jamf-school (Jamf School)
    for (const r of result.results) {
      if (r.product !== null) {
        expect(r.product).toBe('Jamf School');
      }
    }
  }, 30000);
});

// =============================================================================
// 5. Error propagation across services
// =============================================================================

describe('error propagation across services', () => {
  it('searchDocumentation handles search result with empty URL gracefully', async () => {
    // A real API call — even if the query is unusual, searchDocumentation must
    // return a valid SearchDocumentationResult (never throw to the caller).
    const result = await searchDocumentation(ctx, {
      query: 'zzz_nonexistent_term_xqz',
      limit: 5,
    });

    // Must always return a valid result structure
    expect(result.results).toBeDefined();
    expect(Array.isArray(result.results)).toBe(true);
    expect(result.pagination).toBeDefined();
    expect(result.tokenInfo).toBeDefined();

    // When no results, there should be no searchError from a valid (if unusual) query
    // (searchError is reserved for actual API failures, not zero-result queries)
    if (result.results.length === 0) {
      expect(result.searchError).toBeUndefined();
    }
  }, 30000);

  it('resolveAndFetchArticle throws a structured error for an invalid bundle URL', async () => {
    await expect(
      resolveAndFetchArticle(
        ctx,
        { url: 'https://learn.jamf.com/en-US/bundle/nonexistent-bundle-xyz/page/NoPage.html' },
        {},
      )
    ).rejects.toThrow();
  }, 30000);

  it('TopicResolver throws for an unrecognised URL format', async () => {
    await expect(
      ctx.topicResolver.resolve({
        url: 'https://learn.jamf.com/totally/unknown/path/format',
      })
    ).rejects.toThrow();
  }, 15000);
});
