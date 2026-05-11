/**
 * Guard tests for the SEARCH_EXAMPLES surfaced in the jamf_docs_search tool
 * description.
 *
 * The previous TOOL_DESCRIPTION hardcoded examples and a topic hint list that
 * referenced IDs (`smart-groups`, `identity`) that did not exist in the enum.
 * SEARCH_EXAMPLES is now a typed constant, so TypeScript catches invalid
 * product/topic IDs at compile time. These tests are a runtime belt-and-braces
 * check and also verify the rendered description does not regress.
 */

import { describe, it, expect } from 'vitest';
import { JAMF_PRODUCTS, JAMF_TOPICS } from '../../../src/core/constants.js';
import { SEARCH_EXAMPLES, TOOL_DESCRIPTION } from '../../../src/core/tools/search.js';

describe('SEARCH_EXAMPLES', () => {
  it('is non-empty', () => {
    expect(SEARCH_EXAMPLES.length).toBeGreaterThan(0);
  });

  it('every product filter exists in JAMF_PRODUCTS', () => {
    for (const ex of SEARCH_EXAMPLES) {
      if (ex.product !== undefined) {
        expect(JAMF_PRODUCTS, `example "${ex.label}" references unknown product "${ex.product}"`)
          .toHaveProperty(ex.product);
      }
    }
  });

  it('every topic filter exists in JAMF_TOPICS', () => {
    for (const ex of SEARCH_EXAMPLES) {
      if (ex.topic !== undefined) {
        expect(JAMF_TOPICS, `example "${ex.label}" references unknown topic "${ex.topic}"`)
          .toHaveProperty(ex.topic);
      }
    }
  });

  it('every query satisfies SearchInputSchema length bounds', () => {
    // SearchInputSchema enforces 2..200 characters on query
    for (const ex of SEARCH_EXAMPLES) {
      expect(ex.query.length, `example "${ex.label}" has query too short`).toBeGreaterThanOrEqual(2);
      expect(ex.query.length, `example "${ex.label}" has query too long`).toBeLessThanOrEqual(200);
    }
  });

  it('covers all four primary Jamf products', () => {
    const primaryProducts = ['jamf-pro', 'jamf-school', 'jamf-connect', 'jamf-protect'];
    const covered = new Set(SEARCH_EXAMPLES.map(ex => ex.product).filter(Boolean));
    for (const p of primaryProducts) {
      expect(covered, `no SEARCH_EXAMPLES entry covers product "${p}"`).toContain(p);
    }
  });
});

describe('TOOL_DESCRIPTION', () => {
  it('does not mention the previously-broken IDs `smart-groups` or `identity`', () => {
    // Regression guard: these IDs were in the old description but never in the
    // enum, causing LLM calls to fail with validation errors.
    expect(TOOL_DESCRIPTION).not.toMatch(/\bsmart-groups\b/);
    // `identity` as a topic ID (not as part of `identity-provider`).
    // Allow `identity-provider` to appear.
    const withoutValidIds = TOOL_DESCRIPTION.replace(/identity-provider/g, '');
    expect(withoutValidIds).not.toMatch(/\bidentity\b/);
  });

  it('every topic ID referenced in the description exists in JAMF_TOPICS', () => {
    // Pull out anything that looks like a topic="..." example
    const matches = [...TOOL_DESCRIPTION.matchAll(/topic="([^"]+)"/g)];
    expect(matches.length, 'TOOL_DESCRIPTION should mention at least one topic example').toBeGreaterThan(0);
    for (const m of matches) {
      const id = m[1] as string;
      expect(JAMF_TOPICS, `TOOL_DESCRIPTION references unknown topic "${id}"`).toHaveProperty(id);
    }
  });

  it('every product ID referenced in the description exists in JAMF_PRODUCTS', () => {
    const matches = [...TOOL_DESCRIPTION.matchAll(/product="([^"]+)"/g)];
    expect(matches.length, 'TOOL_DESCRIPTION should mention at least one product example').toBeGreaterThan(0);
    for (const m of matches) {
      const id = m[1] as string;
      expect(JAMF_PRODUCTS, `TOOL_DESCRIPTION references unknown product "${id}"`).toHaveProperty(id);
    }
  });
});
