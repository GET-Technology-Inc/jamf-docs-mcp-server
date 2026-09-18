/**
 * Guard tests for the product registry.
 *
 * Background: a search result's product identity is a round trip through two
 * structures in `search-service.ts`, and the hazardous half of it is `name`:
 *
 *   - `extractProductFromClassification` reads Jamf's own
 *     `jamf:portal` / `jamf:app` / `jamf:utility` off the result and returns
 *     the value, which IS a product name.
 *   - `PRODUCT_NAME_TO_ID` is built with `Object.fromEntries(...)` keyed on
 *     **name** — last declaration wins.
 *
 * So two products sharing a `name` silently resolve to whichever sits lower in
 * the object literal. No error, no empty result, no failing test — the user
 * just gets another product's documentation.
 *
 * This file used to guard a third column too. `searchLabel` translated each
 * product into `zoominmetadata`'s legacy `product-*` vocabulary, several rows
 * legitimately shared one (Jamf tags 38 bundle families `product-pro` alone),
 * and a shared label resolved by declaration order — so the sharing had to be
 * written down. The filter now sends Jamf's own classification instead and the
 * column is gone, which removes that failure mode rather than guarding it.
 */

import { describe, it, expect } from 'vitest';
import { JAMF_PRODUCTS, PRODUCT_IDS } from '../../../src/core/constants/products.js';
import type { ProductId } from '../../../src/core/constants/products.js';

const rows = Object.entries(JAMF_PRODUCTS) as [ProductId, typeof JAMF_PRODUCTS[ProductId]][];

describe('JAMF_PRODUCTS keys', () => {
  it('uses the object key as the row id', () => {
    for (const [key, product] of rows) {
      expect(product.id, `row "${key}" declares id "${product.id}"`).toBe(key);
    }
  });

  it('exposes exactly those keys as PRODUCT_IDS', () => {
    expect([...PRODUCT_IDS].sort()).toEqual(rows.map(([key]) => key).sort());
  });
});

describe('JAMF_PRODUCTS uniqueness', () => {
  // `name` is the pivot of the label -> name -> id round trip. Two products
  // sharing one means the second silently swallows the first's search results.
  it('gives every product a distinct display name', () => {
    const byName = new Map<string, ProductId[]>();
    for (const [id, product] of rows) {
      byName.set(product.name, [...(byName.get(product.name) ?? []), id]);
    }
    const collisions = [...byName].filter(([, ids]) => ids.length > 1);
    expect(collisions, 'PRODUCT_NAME_TO_ID is last-wins, so a shared name drops the earlier product')
      .toEqual([]);
  });

  // `bundleId` addresses get_toc and get_article. Two products sharing one is
  // not a routing hazard but is always a copy-paste mistake.
  it('gives every product a distinct bundleId', () => {
    const byBundle = new Map<string, ProductId[]>();
    for (const [id, product] of rows) {
      byBundle.set(product.bundleId, [...(byBundle.get(product.bundleId) ?? []), id]);
    }
    expect([...byBundle].filter(([, ids]) => ids.length > 1)).toEqual([]);
  });
});
