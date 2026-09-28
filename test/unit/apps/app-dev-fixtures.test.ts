/**
 * Each fixture of the MCP App's dev harness shows the state it is there for.
 *
 * `app-ui/dev/fixtures.json` is real `structuredContent`, captured by
 * `scripts/capture-app-fixtures.mjs`, and each capture says in `why` which
 * branch of the viewer it exercises. Two did not, and nothing said so: the
 * "Search — filter relaxed" capture had no `filterRelaxation` (a `version`
 * filter goes upstream and is never relaxed, and Jamf Pro 10.1.0 had no
 * results), and "Search — no results" had 50 (for "zzzqqq nonexistent
 * topic", such as "Advanced Topics"). So the harness never showed a relaxed
 * filter, and showed a search with no results only as "filter relaxed".
 *
 * This reads the committed capture, so a re-capture that stops showing a
 * state fails here rather than in a preview nobody looks at twice.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

interface Fixture {
  key: string;
  why: string;
  tool: string;
  arguments: Record<string, unknown>;
  structuredContent: Record<string, unknown>;
}

const fixtures = JSON.parse(
  readFileSync(new URL('../../../app-ui/dev/fixtures.json', import.meta.url), 'utf-8'),
) as Fixture[];

function fixture(key: string): Record<string, unknown> {
  const found = fixtures.find(f => f.key === key);
  if (found === undefined) {
    throw new Error(`app-ui/dev/fixtures.json has no fixture "${key}"`);
  }
  return found.structuredContent;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

describe('the dev harness fixtures', () => {
  it('"Search — filter relaxed" has a filter the server relaxed, and results without it', () => {
    const relaxed = fixture('search-relaxed');
    expect(list((relaxed.filterRelaxation as { removed?: unknown } | undefined)?.removed).length).toBeGreaterThan(0);
    expect(list(relaxed.results).length).toBeGreaterThan(0);
  });

  it('"Search — no results" has no results, and suggestions to run instead', () => {
    const empty = fixture('search-empty');
    expect(empty.totalResults).toBe(0);
    expect(list(empty.results)).toHaveLength(0);
    expect(list(empty.suggestions).length).toBeGreaterThan(0);
  });

  it('"Search — other sources" has other-source matches beside its results', () => {
    const other = fixture('search-other-sources');
    expect(list(other.otherSources).length).toBeGreaterThan(0);
    expect(list(other.results).length).toBeGreaterThan(0);
  });

  it('"TOC — Jamf Pro" is deep and paged', () => {
    const toc = fixture('toc');
    expect(toc.totalPages).toBeGreaterThan(1);
    expect(Math.max(...list(toc.entries).map(e => (e as { depth: number }).depth))).toBeGreaterThan(1);
  });

  it('"TOC — entry cut to fit" is one entry cut to fit', () => {
    expect(fixture('toc-cut').truncatedEntry).toBeDefined();
  });

  it('"TOC — by publication" is addressed by publication', () => {
    const toc = fixture('toc-publication');
    expect(toc.publicationId).toBeDefined();
    expect(toc.productId).toBeUndefined();
  });

  it('"Article — with children" has children', () => {
    expect(list((fixture('article-parent').navigation as { children?: unknown } | undefined)?.children).length)
      .toBeGreaterThan(0);
  });

  it('"Article — prose only" has no sections, and "Article — with sections" at least two', () => {
    expect(list(fixture('article-prose').sections)).toHaveLength(0);
    expect(list(fixture('article-sections').sections).length).toBeGreaterThan(1);
  });

  it('"Article — zh-TW request" is in Chinese', () => {
    expect(fixture('article-zh').title).toMatch(/\p{Script=Han}/u);
  });

  it('"Article — truncated" was cut to its budget', () => {
    expect(fixture('article-truncated').truncated).toBe(true);
  });
});
