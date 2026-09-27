/**
 * Search results that cost an exact number of tokens.
 *
 * `jamf_docs_search` charges a result what `estimateTokens` says its title,
 * snippet and URL cost, one per line, so where a page ends is only as
 * predictable as those costs. Building results to a stated cost is what lets a
 * test replay a result set measured on the live site without carrying fifty
 * live snippets as a fixture.
 *
 * The cost is met with plain ASCII in the snippet, one character per quarter
 * token, and no code fences, which `estimateTokens` would charge at a
 * different rate. A snippet is at least 50 characters: `cleanSnippet` puts
 * the title in place of a shorter one.
 */

import type { FtMetadataEntry, FtSearchEntry, SearchResult } from '../../src/core/types.js';
import { estimateTokens } from '../../src/core/services/tokenizer.js';

/**
 * The costs of the 50 results of `query: "enrollment"` (no filters, en-US),
 * in rank order, as `estimateTokens` prices each one's title, snippet and
 * URL. Measured live on 2026-09-28; they add up to 5586, the `tokenCount` of
 * the one page that holds all 50 at `maxTokens: 50000`.
 */
export const ENROLLMENT_COSTS = [
  115, 115, 139, 105, 105, 110, 107, 100, 108, 110, 111, 114, 113, 116, 105, 109, 112, 115, 109, 118,
  117, 116, 113, 116, 118, 114, 118, 119, 105, 119, 120, 125, 37, 106, 117, 117, 115, 118, 110, 122,
  111, 129, 41, 129, 108, 120, 118, 111, 118, 123,
] as const;

const BUNDLE = 'jamf-pro-documentation-current';
const WORDS = 'Enroll and manage computers and mobile devices with the settings described on this page. ';
/** `cleanSnippet` replaces a shorter snippet with the title. */
const MIN_SNIPPET = 50;

/** What `jamf_docs_search` charges a result: its title, snippet and URL, a line each. */
export function resultCost(result: Pick<SearchResult, 'title' | 'snippet' | 'url'>): number {
  return estimateTokens(`${result.title}\n${result.snippet}\n${result.url}`);
}

function slug(index: number): string {
  return `Result_${String(index + 1)}`;
}

/** The title, URL and snippet of the `index`th result, costing `tokens`. */
export function fieldsCosting(index: number, tokens: number): { title: string; url: string; snippet: string } {
  const title = `Result ${String(index + 1)}`;
  const url = `https://learn.jamf.com/r/en-US/${BUNDLE}/${slug(index)}`;
  const length = tokens * 4 - (title.length + url.length + 2);
  if (length < MIN_SNIPPET) {
    throw new Error(`Result ${String(index + 1)} costs at least ${String(Math.ceil((title.length + url.length + 2 + MIN_SNIPPET) / 4))} tokens`);
  }
  const text = WORDS.repeat(Math.ceil(length / WORDS.length)).slice(0, length);
  // `cleanSnippet` trims, and a trimmed snippet would cost less than asked.
  const snippet = text.endsWith(' ') ? `${text.slice(0, -1)}.` : text;
  return { title, url, snippet };
}

function meta(entries: Record<string, string[]>): FtMetadataEntry[] {
  return Object.entries(entries).map(([key, values]) => ({ key, label: key, values }));
}

/** Jamf Pro topics as the clustered search sends them, one per cost, in rank order. */
export function ftEntriesCosting(costs: readonly number[]): FtSearchEntry[] {
  return costs.map((tokens, i) => {
    const { title, snippet } = fieldsCosting(i, tokens);
    return {
      type: 'TOPIC',
      missingTerms: [],
      topic: {
        mapId: 'A4LI4vM0BILraYeOD89WGg',
        contentId: `content-${String(i)}`,
        tocId: `toc-${String(i)}`,
        title,
        htmlTitle: title,
        mapTitle: 'Jamf Pro Documentation 11.32.0',
        breadcrumb: ['Enrollment', title],
        htmlExcerpt: snippet,
        metadata: meta({
          'version': ['11.32.0'],
          'zoominmetadata': ['content-techdocs', 'product-pro', 'product-pro-11.32.0'],
          'ft:clusterId': [`${BUNDLE}/${slug(i)}`],
          'ft:locale': ['en-US'],
          'jamf:portal': ['Jamf Pro'],
          'ft:prettyUrl': [`en-US/${BUNDLE}/${slug(i)}`],
        }),
      },
    };
  });
}

/** What a SearchProvider returns: one result per cost, in rank order. */
export function providerResultsCosting(costs: readonly number[]): SearchResult[] {
  return costs.map((tokens, i) => ({ ...fieldsCosting(i, tokens), product: 'Jamf Pro' }));
}

/**
 * `count` costs from a seeded generator, between `min` and `max` inclusive.
 * The same seed always gives the same list, so a failure can be replayed.
 */
export function seededCosts(seed: number, count: number, min: number, max: number): number[] {
  let state = seed >>> 0;
  const next = (): number => {
    // mulberry32
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: count }, () => min + Math.floor(next() * (max - min + 1)));
}
