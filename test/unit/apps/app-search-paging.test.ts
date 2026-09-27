/**
 * The search view's "Show more" must ask for the page after the one on
 * screen, and the view must say when that page is one result cut to fit.
 *
 * `jamf_docs_search` now cuts each page to `maxTokens` (see
 * `paginateSearchResults`), so page N+1 follows page N only at the same
 * budget and page size. The view asked for the next page with the filters,
 * `limit` and the page number, so a search the model had run at
 * `maxTokens: 1000` continued at the default 5000, from wherever the
 * default's pages begin: results skipped, with nothing on screen to say so.
 * Before pages were cut this way, the same call skipped whatever the budget
 * had dropped from the page on screen, and the view said "N long results
 * omitted to fit the token budget" of results no page held.
 *
 * Asserted against `nextSearchPageArgs` and `searchBudgetNote` themselves,
 * which live in `app-ui/search.ts` because importing app.ts throws outside a
 * browser, and then against the built bundle, which is what ships.
 */

import { describe, it, expect } from 'vitest';

import { nextSearchPageArgs, searchBudgetNote, type SearchPaging } from '../../../app-ui/search.js';
import { APP_HTML } from '../../../src/core/apps/generated/app-html.js';

describe('the next page of a search', () => {
  it('is asked for at the budget and page size the page on screen was cut to', () => {
    expect(nextSearchPageArgs({ query: 'enrollment', page: 1, limit: 20, maxTokens: 1000 })).toEqual({
      name: 'jamf_docs_search',
      args: { limit: 20, query: 'enrollment', page: 2, maxTokens: 1000 },
    });
  });

  it('is of the same search: the filters go back too', () => {
    const view: SearchPaging = {
      query: 'sso',
      filters: { product: 'jamf-connect', topic: 'sso', language: 'ja-JP' },
      page: 3,
      limit: 10,
      maxTokens: 5000,
    };
    expect(nextSearchPageArgs(view)?.args).toEqual({
      product: 'jamf-connect', topic: 'sso', language: 'ja-JP', limit: 10, query: 'sso', page: 4, maxTokens: 5000,
    });
  });

  it('leaves the budget and page size to the server when the payload has none it could send', () => {
    for (const bad of [undefined, 0, -1, 1.5, '1000', Number.NaN]) {
      const view = { query: 'enrollment', page: 1, limit: bad, maxTokens: bad } as unknown as SearchPaging;
      expect(nextSearchPageArgs(view)).toEqual({ name: 'jamf_docs_search', args: { query: 'enrollment', page: 2 } });
    }
  });

  it('ignores filters that are not an object', () => {
    for (const filters of ['product', ['jamf-pro'], null, 7]) {
      expect(nextSearchPageArgs({ query: 'enrollment', page: 1, filters })?.args).toEqual({ query: 'enrollment', page: 2 });
    }
  });

  it('is nothing past the last page `page` accepts', () => {
    expect(nextSearchPageArgs({ query: 'enrollment', page: 100, hasMore: false, maxTokens: 100 })).toBeNull();
  });
});

describe('the note for a page that is one result cut to fit', () => {
  it('names the result and what it needs whole', () => {
    expect(searchBudgetNote({
      query: 'enrollment', page: 1, truncatedResult: { title: 'Computer PreStage Enrollments', estimatedTokens: 139 },
    })).toBe(
      '“Computer PreStage Enrollments” is too long for the token budget this page was given: its snippet is cut. ' +
      'The whole result needs 139 tokens.',
    );
  });

  it('is nothing for a page that was not cut', () => {
    expect(searchBudgetNote({ query: 'enrollment', page: 1 })).toBeUndefined();
  });

  it('says what it can of a malformed one, and nothing of a mangled one', () => {
    expect(searchBudgetNote({
      query: 'q', page: 1, truncatedResult: { title: 7, estimatedTokens: 'many' },
    } as unknown as SearchPaging)).toBe('This result is too long for the token budget this page was given: its snippet is cut.');
    expect(searchBudgetNote({ query: 'q', page: 1, truncatedResult: 'cut' } as unknown as SearchPaging)).toBeUndefined();
  });
});

/** An identifier from the bundle, escaped for a RegExp. */
function literal(identifier: string): string {
  return identifier.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

describe('the built bundle', () => {
  it('ships the filters, page size and budget in the next-page arguments, and the cut note', () => {
    // esbuild renames identifiers but keeps property names and string
    // literals, so both are recognisable in the compiled output.
    expect(APP_HTML).toMatch(new RegExp(
      'name:"jamf_docs_search",args:\\{\\.\\.\\.[\\w$]+,' +
      '\\.\\.\\.[\\w$]+!==void 0\\?\\{limit:[\\w$]+\\}:\\{\\},' +
      'query:[\\w$]+\\.query,page:[\\w$]+\\.page\\+1,' +
      '\\.\\.\\.[\\w$]+!==void 0\\?\\{maxTokens:[\\w$]+\\}:\\{\\}\\}',
    ));
    expect(APP_HTML).toContain('is too long for the token budget this page was given: its snippet is cut.');
    expect(APP_HTML).not.toContain(' long result');
  });

  it('asks for those arguments when "Show more" is clicked', () => {
    // The regex above matches the body of nextSearchPageArgs, which the label
    // below also calls, so it would still match if the click built its own
    // arguments. So: the one place the bundle builds search arguments is a
    // function, the click takes its arguments from pageArgs, and pageArgs's
    // search branch calls that function. Before 2026-09-28 pageArgs built
    // them inline, with the filters, limit and page and no budget.
    const builds = APP_HTML.split('name:"jamf_docs_search",args:');
    expect(builds).toHaveLength(2);
    const builder = /function ([\w$]+)\([\w$]+\)\{(?:(?!function ).)*$/s.exec(builds[0] ?? '')?.[1];
    expect(builder).toBeDefined();

    const click = /"button\[data-more\]"\)!==null\)\{let ([\w$]+)=[\w$]+!==null\?([\w$]+)\([\w$]+\):null;\1!==null&&[\w$]+\(\1\.name,\1\.args,!0\)/
      .exec(APP_HTML);
    expect(click).not.toBeNull();
    const pageArgs = literal(click?.[2] ?? '');
    expect(APP_HTML).toMatch(new RegExp(
      `function ${pageArgs}\\(([\\w$]+)\\)\\{return \\1\\.kind==="search"\\?${literal(builder ?? '')}\\(\\1\\.data\\):`,
    ));
  });

  it('shows "Show more" only when there is a next page to ask for, without a count it cannot know', () => {
    expect(APP_HTML).toMatch(
      /\.page>=[\w$]+\.totalPages\|\|[\w$]+\([\w$]+\)===null\?"":`<button class="more" data-more>Show more of \$\{String\([\w$]+\.totalResults\)\}<\/button>`/,
    );
  });
});
