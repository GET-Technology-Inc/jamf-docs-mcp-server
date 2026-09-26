/**
 * The glossary view must say what the token budget left out.
 *
 * `jamf_docs_glossary_lookup` sends `entries: []` beside a nonzero
 * `totalMatches` when not even the leading definition fits `maxTokens`: live on
 * 2026-09-26, Apple School Manager at `maxTokens: 100`. The view drew that as
 * "1 definition" over an empty list, with a note that "some" definitions were
 * omitted; and with one definition shown and more omitted, the
 * single-definition layout dropped the note, so `Apple` at a small budget read
 * as one definition and nothing more.
 *
 * Asserted against `budgetNote` and `renderGlossaryList` themselves, which
 * live in `app-ui/glossary.ts` for the reason `app-ui/toc.ts` does, and then
 * against the built bundle, which is what ships.
 */

import { describe, it, expect } from 'vitest';

import { budgetNote, renderGlossaryList, type GlossaryBudget } from '../../../app-ui/glossary.js';
import { APP_HTML } from '../../../src/core/apps/generated/app-html.js';

const entry = { term: 'Apple Account', definition: '…', url: 'https://learn.jamf.com/r/en-US/x' };

/** The structuredContent of an over-budget lookup, as the server sends it. */
function view(overrides: Partial<GlossaryBudget>): GlossaryBudget {
  return { totalMatches: 1, entries: [], truncated: true, ...overrides };
}

describe('when no definition fits', () => {
  it('says the one match is too long, and what it needs', () => {
    expect(budgetNote(view({
      truncatedContent: { omittedCount: 1, omittedItems: [{ title: 'Apple School Manager', estimatedTokens: 134 }] },
    }))).toBe('The definition is too long for the token budget this lookup was given: it needs 134 tokens.');
  });

  it('says none of several fits, and what the first needs', () => {
    expect(budgetNote(view({
      totalMatches: 4,
      truncatedContent: {
        omittedCount: 4,
        omittedItems: [
          { title: 'Apple Account', estimatedTokens: 129 },
          { title: 'Apple Business', estimatedTokens: 110 },
        ],
      },
    }))).toBe('4 definitions match, but none fits in the token budget this lookup was given: the first needs 129 tokens.');
  });

  it('still says why the list is empty when the server sends no costs', () => {
    // An older server, or a GlossaryProvider that does not report them.
    expect(budgetNote(view({}))).toBe('The definition is too long for the token budget this lookup was given.');
    expect(budgetNote(view({ totalMatches: 2 }))).toBe(
      '2 definitions match, but none fits in the token budget this lookup was given.',
    );
  });

  it('reads a malformed cost as none rather than printing it', () => {
    for (const estimatedTokens of [null, 'lots', -1, Number.NaN, undefined]) {
      expect(budgetNote(view({
        truncatedContent: { omittedCount: 1, omittedItems: [{ title: 'X', estimatedTokens: estimatedTokens as number }] },
      }))).toBe('The definition is too long for the token budget this lookup was given.');
    }
    expect(budgetNote(view({
      truncatedContent: 'garbage' as unknown as NonNullable<GlossaryBudget['truncatedContent']>,
    }))).toBe('The definition is too long for the token budget this lookup was given.');
  });
});

describe('when some definitions fit', () => {
  it('counts the ones left out, for the single-definition layout as well', () => {
    expect(budgetNote(view({ totalMatches: 2, entries: [entry] }))).toBe(
      '1 more definition omitted to fit the token budget.',
    );
    expect(budgetNote(view({ totalMatches: 4, entries: [entry, entry] }))).toBe(
      '2 more definitions omitted to fit the token budget.',
    );
  });

  it('keeps the general note when the counts do not say how many', () => {
    expect(budgetNote(view({ totalMatches: 1, entries: [entry] }))).toBe(
      'Some definitions were omitted to fit the token budget.',
    );
    expect(budgetNote(view({ totalMatches: 'x' as unknown as number }))).toBe(
      'Some definitions were omitted to fit the token budget.',
    );
  });
});

describe('when nothing was cut', () => {
  it('says nothing, including for a real no-match', () => {
    expect(budgetNote(view({ truncated: false, totalMatches: 0 }))).toBeUndefined();
    expect(budgetNote(view({ truncated: false, totalMatches: 1, entries: [entry] }))).toBeUndefined();
  });
});

describe('the list layout', () => {
  const note = '<p class="notice" data-level="info">3 more definitions omitted to fit the token budget.</p>';
  const rows = ['<li>Apple Account</li>', '<li>Apple Business</li>'];

  it('draws no list when no definition fitted, only the note', () => {
    // The case this is about: `entries: []` beside a nonzero `totalMatches`.
    const html = renderGlossaryList([], note);

    expect(html).not.toContain('<ol');
    expect(html.trim()).toBe(note);
  });

  it('draws the definitions that fitted, then the note', () => {
    const html = renderGlossaryList(rows, note);

    expect(html).toContain('<ol class="list list-hits"><li>Apple Account</li><li>Apple Business</li></ol>');
    expect(html.indexOf(note)).toBeGreaterThan(html.indexOf('</ol>'));
  });

  it('adds nothing below the list when nothing was cut', () => {
    expect(renderGlossaryList(rows, '').trim()).toBe(
      '<ol class="list list-hits"><li>Apple Account</li><li>Apple Business</li></ol>',
    );
  });
});

/**
 * An identifier from the minified bundle, for use inside a RegExp. Only `$`
 * can occur in one, but every metacharacter is escaped, backslash included.
 */
function literal(identifier: string): string {
  return identifier.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

describe('the built bundle', () => {
  // Asserted on the compiled template, as the other bundle checks are: the
  // renderer is not importable. esbuild renames identifiers but keeps template
  // literals, so the layouts are recognisable by their markup.
  const single = /<div class="prose">\$\{[\w$]+\([\w$]+\.definition\)\}<\/div>\s*\$\{([\w$]+)\}`;/.exec(APP_HTML);

  it('ships the note, and renders it in the single-definition layout too', () => {
    expect(APP_HTML).toContain('none fits in the token budget this lookup was given');
    expect(APP_HTML).toContain('more definition');
    // The single-definition layout ends with the note after the prose.
    expect(single).not.toBeNull();
  });

  it('renders the list layout through renderGlossaryList, with the same note', () => {
    // The list layout carries the case where no definition fitted, so it must
    // end with renderGlossaryList(rows, note), and `note` must be the notice
    // the single-definition layout ends with.
    const listFn = /function ([\w$]+)\([\w$]+,[\w$]+\)\{return`\$\{[\w$]+\.length>0\?`<ol class="list list-hits">/
      .exec(APP_HTML)?.[1];
    expect(listFn).toBeDefined();
    expect(single).not.toBeNull();

    const start = single?.index ?? 0;
    const renderer = APP_HTML.slice(start, APP_HTML.indexOf('function ', start));
    expect(renderer).toMatch(new RegExp(
      `\\$\\{${literal(listFn ?? '')}\\([\\w$]+,${literal(single?.[1] ?? '')}\\)\\}\`\\}$`,
    ));
  });
});
