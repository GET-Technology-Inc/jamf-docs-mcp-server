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
 * Re-captured on 2026-09-28, after #371 decoded a snippet's character
 * references (3 snippets in the capture before had them) and #379 returned
 * the Jamf Training Catalog courses Fluid Topics ranks among the results
 * (none in it before, 3 now). Four `why`s were untrue: "Search — typical" had
 * no mix of docTypes, "TOC — small product" is two levels deep and not flat,
 * the glossary has had a view since #267, and "Article — zh-TW request" said
 * only an `ArticleProvider` sets `contentLocale`, which a concepts.jamf.com or
 * support.jamf.com page has too since #378. Four fixtures were added, for a
 * state the harness could not show: a search with nothing to suggest, a
 * course, a page shown in another language than asked for, and a page whose
 * markdown escapes characters.
 *
 * This reads the committed capture, so a re-capture that stops showing a
 * state fails here rather than in a preview nobody looks at twice.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import { translationNote } from '../../../app-ui/language.js';

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

/** The arguments a fixture was captured with. */
function argumentsOf(key: string): Record<string, unknown> {
  return fixtures.find(f => f.key === key)?.arguments ?? {};
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

  it('"Search — nothing matched" has no results, nothing to suggest and nothing elsewhere', () => {
    // So the view says "Nothing matched." and nothing else: see renderNoResults.
    const nothing = fixture('search-nothing');
    expect(nothing.totalResults).toBe(0);
    expect(list(nothing.suggestions)).toHaveLength(0);
    expect(list(nothing.otherSources)).toHaveLength(0);
  });

  it('"Search — training courses" has a course among the results an inline view shows', () => {
    // INLINE_HITS in app.ts: an inline view shows the first three.
    const courses = list(fixture('search-training').results).slice(0, 3)
      .filter(r => (r as { external?: unknown }).external === true);
    expect(courses.length).toBeGreaterThan(0);
  });

  it('"Search — typical" is ten results of a product\'s documentation, each with its breadcrumb', () => {
    const results = list(fixture('search').results) as { breadcrumb?: unknown }[];
    expect(results).toHaveLength(10);
    expect(results.every(r => list(r.breadcrumb).length > 0)).toBe(true);
  });

  it('has no snippet with a character reference left in it', () => {
    // #371 decodes them.
    const referenced = fixtures
      .filter(f => f.tool === 'jamf_docs_search')
      .flatMap(f => (list(f.structuredContent.results) as { snippet?: unknown }[]).map(r => r.snippet))
      .filter(snippet => typeof snippet === 'string' && /&(?:#x?[\da-f]+|[a-z]+);/i.test(snippet));
    expect(referenced).toEqual([]);
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

  it('"TOC — small product" is short, on one page, and two levels deep', () => {
    const toc = fixture('toc-shallow');
    expect(toc.totalPages).toBe(1);
    expect(Math.max(...list(toc.entries).map(e => (e as { depth: number }).depth))).toBe(1);
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

  it('"Article — no translation" is in another language than it was asked for in', () => {
    const page = fixture('article-untranslated');
    expect(page.contentLocale).toBe('en-US');
    const { language } = argumentsOf('article-untranslated');
    expect(language).toBe('ja-JP');
    // The three notices its why names, on the hosts it names them for.
    expect(translationNote(page.contentLocale, language, 'ja-JP')).toContain('no translation for your locale.');
    expect(translationNote(page.contentLocale, language, 'en-US')).toContain('no ja-JP translation.');
    expect(translationNote(page.contentLocale, language, 'ko-KR')).toContain('available here.');
  });

  it('"Article — zh-TW request" is in the language it was asked for in, and does not reach that notice', () => {
    // Whether the capture has a contentLocale is the server's to say: a
    // learn.jamf.com topic's is its own, zh-TW here, where the server gives
    // one. Either way the view says nothing of its language.
    const page = fixture('article-zh');
    expect(translationNote(page.contentLocale, argumentsOf('article-zh').language, 'en-US')).toBeUndefined();
  });

  it('"Article — support.jamf.com collection" escapes characters of its titles', () => {
    expect(fixture('article-collection').content).toContain('\\(JCDS\\)');
  });

  it('"Glossary lookup" is one definition, the layout its why names', () => {
    expect(list(fixture('glossary').entries)).toHaveLength(1);
  });
});
