/**
 * Guard tests for the product registry.
 *
 * Background: a search result's product identity is derived by a round trip
 * through two structures in `search-service.ts` that break ties in *opposite*
 * directions:
 *
 *   - `extractProductFromZoominMeta` (search-service.ts:107) scans
 *     `Object.entries(JAMF_PRODUCTS).find(...)` for a matching `searchLabel`
 *     and returns that product's **name** — first declaration wins.
 *   - `PRODUCT_NAME_TO_ID` (search-service.ts:86) is built with
 *     `Object.fromEntries(...)` keyed on **name** — last declaration wins.
 *
 * So a duplicate `searchLabel` silently resolves to whichever row sits higher
 * in the object literal, and a duplicate `name` silently resolves to whichever
 * sits lower. Neither produces an error, an empty result, or a failing test —
 * the user just gets another product's documentation.
 *
 * Coverage work under #237 adds many rows to this registry, several of which
 * legitimately share a `searchLabel` with an existing product (Jamf tags 38
 * bundle families with `product-pro` alone). These tests pin the columns that
 * must stay unique and force any shared label to be declared, so that sharing
 * is a decision someone wrote down rather than an accident of ordering.
 */

import { describe, it, expect } from 'vitest';
import { JAMF_PRODUCTS, PRODUCT_IDS } from '../../../src/core/constants/products.js';
import type { ProductId } from '../../../src/core/constants/products.js';

const rows = Object.entries(JAMF_PRODUCTS) as [ProductId, typeof JAMF_PRODUCTS[ProductId]][];

/**
 * `searchLabel` values knowingly shared by more than one product.
 *
 * Every entry needs a reason and an owner: whichever product is declared
 * FIRST in the object literal wins `extractProductFromZoominMeta`, so adding
 * a row here without checking declaration order changes which product a
 * search result is attributed to.
 */
const SHARED_SEARCH_LABELS: Readonly<Record<string, readonly ProductId[]>> = {};

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

describe('JAMF_PRODUCTS search labels', () => {
  it('declares every shared searchLabel in SHARED_SEARCH_LABELS', () => {
    const byLabel = new Map<string, ProductId[]>();
    for (const [id, product] of rows) {
      byLabel.set(product.searchLabel, [...(byLabel.get(product.searchLabel) ?? []), id]);
    }
    const shared = [...byLabel].filter(([, ids]) => ids.length > 1);

    for (const [label, ids] of shared) {
      expect(
        SHARED_SEARCH_LABELS[label],
        `searchLabel "${label}" is shared by ${ids.join(', ')} but is not declared in ` +
        'SHARED_SEARCH_LABELS. Sharing is allowed, but it must be written down: the ' +
        'first-declared product wins extractProductFromZoominMeta and takes the other\'s ' +
        'search results.'
      ).toBeDefined();
      expect([...(SHARED_SEARCH_LABELS[label] ?? [])].sort()).toEqual([...ids].sort());
    }
  });

  it('lists the winner of each shared label first', () => {
    const order = rows.map(([id]) => id);
    for (const [label, ids] of Object.entries(SHARED_SEARCH_LABELS)) {
      const declared = [...ids].sort((a, b) => order.indexOf(a) - order.indexOf(b));
      expect(
        ids[0],
        `SHARED_SEARCH_LABELS["${label}"] must list the product that actually wins the ` +
        `lookup first; declaration order in JAMF_PRODUCTS makes that "${declared[0]}"`
      ).toBe(declared[0]);
    }
  });

  it('names no label that no product carries', () => {
    const live = new Set<string>(rows.map(([, product]) => product.searchLabel));
    for (const label of Object.keys(SHARED_SEARCH_LABELS)) {
      expect(live.has(label), `SHARED_SEARCH_LABELS names "${label}", which no product uses`)
        .toBe(true);
    }
  });
});
