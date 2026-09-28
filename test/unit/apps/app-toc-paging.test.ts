/**
 * The TOC view's "Show more" must ask for the page after the one on screen,
 * and the view must say when that page is one entry cut to fit.
 *
 * `jamf_docs_get_toc` now cuts each page to `maxTokens` (see
 * `paginateTocEntries`), so page N+1 follows page N only at the same budget,
 * in the same tree. The view asked for the next page with the id and the page
 * number alone, so a TOC the model had fetched at `maxTokens: 1000`
 * continued at the default 5000, and one fetched in ja-JP or at an older
 * version continued in the current en-US tree, from wherever its pages
 * begin: entries skipped or repeated, with nothing on screen to say so.
 * Before pages were cut this way, the same call skipped whatever the budget
 * had dropped from the page on screen.
 *
 * Asserted against `nextTocPageArgs` and `tocBudgetNote` themselves, which
 * live in `app-ui/toc.ts` because importing app.ts throws outside a browser,
 * and then against the built bundle, which is what ships, down to what a
 * click on "Show more" sends.
 */

import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import ts from 'typescript';

import { nextTocPageArgs, tocBudgetNote, type TocPaging } from '../../../app-ui/toc.js';
import { APP_HTML } from '../../../src/core/apps/generated/app-html.js';
import { inlinedScript, showMoreArgsFunction } from '../../helpers/app-bundle.js';

describe('the next page of a table of contents', () => {
  it('is asked for at the budget the page on screen was cut to', () => {
    expect(nextTocPageArgs({ productId: 'jamf-pro', page: 1, maxTokens: 1000 })).toEqual({
      name: 'jamf_docs_get_toc',
      args: { product: 'jamf-pro', page: 2, maxTokens: 1000 },
    });
  });

  it('goes back under the name the request used', () => {
    expect(nextTocPageArgs({ publicationId: 'technical-paper-laps', page: 3, maxTokens: 5000 })).toEqual({
      name: 'jamf_docs_get_toc',
      args: { publication: 'technical-paper-laps', page: 4, maxTokens: 5000 },
    });
  });

  it('leaves the budget to the server when the payload has none it could send', () => {
    // An older server sends no `maxTokens`; anything else is not a budget.
    for (const maxTokens of [undefined, null, 'lots', 0, -1, 1.5, Number.NaN]) {
      const view = { productId: 'jamf-pro', page: 1, maxTokens } as unknown as TocPaging;
      expect(nextTocPageArgs(view)).toEqual({ name: 'jamf_docs_get_toc', args: { product: 'jamf-pro', page: 2 } });
    }
  });

  it('is asked for in the version and language the page on screen was', () => {
    expect(nextTocPageArgs({
      productId: 'jamf-pro', version: '11.25.0', language: 'ja-JP', page: 1, hasMore: true, maxTokens: 1000,
    })).toEqual({
      name: 'jamf_docs_get_toc',
      args: { product: 'jamf-pro', version: '11.25.0', language: 'ja-JP', page: 2, maxTokens: 1000 },
    });
  });

  it('leaves out `current` and anything that is not a version or language', () => {
    // `current` is what the server assumes without one; an older server sends
    // no `language`.
    for (const [version, language] of [['current', undefined], ['', ''], [7, 7], [null, null]]) {
      const view = { productId: 'jamf-pro', version, language, page: 1 } as unknown as TocPaging;
      expect(nextTocPageArgs(view)).toEqual({ name: 'jamf_docs_get_toc', args: { product: 'jamf-pro', page: 2 } });
    }
  });

  it('asks for nothing when the payload names no TOC', () => {
    expect(nextTocPageArgs({ page: 1, maxTokens: 1000 })).toBeNull();
    expect(nextTocPageArgs({ productId: '', page: 1 })).toBeNull();
  });

  it('asks for nothing past the last page the server offers', () => {
    // Page 100 of 150 at a small budget: `page` stops at 100, so the server
    // says there is no next page to ask for.
    expect(nextTocPageArgs({ productId: 'jamf-pro', page: 100, hasMore: false, maxTokens: 100 })).toBeNull();
  });
});

describe('a page that is one entry cut to fit', () => {
  it('says which entry, how much of it is shown, and what it needs whole', () => {
    expect(tocBudgetNote({
      productId: 'jamf-pro',
      page: 2,
      truncatedEntry: { title: 'Managing Computers', shownEntries: 9, totalEntries: 16, estimatedTokens: 178 },
    })).toBe(
      '“Managing Computers” is too long for the token budget this page was given: showing 9 of its 16 entries. ' +
      'The whole section needs 178 tokens.',
    );
  });

  it('says nothing about a page that was not cut', () => {
    expect(tocBudgetNote({ productId: 'jamf-pro', page: 1 })).toBeUndefined();
  });

  it('reads malformed fields as absent rather than printing them', () => {
    const view = {
      page: 2,
      truncatedEntry: { title: 7, shownEntries: 'nine', totalEntries: null, estimatedTokens: -1 },
    } as unknown as TocPaging;
    expect(tocBudgetNote(view)).toBe('This section is too long for the token budget this page was given.');
    expect(tocBudgetNote({ page: 2, truncatedEntry: 'cut' } as unknown as TocPaging)).toBeUndefined();
  });
});

describe('the built bundle', () => {
  it('ships the version, language and budget in the next-page arguments, and the cut note', () => {
    // esbuild renames identifiers but keeps property names and string
    // literals, so both are recognisable in the compiled output.
    expect(APP_HTML).toMatch(new RegExp(
      'name:"jamf_docs_get_toc",args:\\{\\[[\\w$]+\\]:[\\w$]+,' +
      '\\.\\.\\.[\\w$]+!==void 0\\?\\{version:[\\w$]+\\}:\\{\\},' +
      '\\.\\.\\.[\\w$]+!==void 0\\?\\{language:[\\w$]+\\}:\\{\\},' +
      'page:[\\w$]+\\.page\\+1,\\.\\.\\.[\\w$]+!==void 0\\?\\{maxTokens:[\\w$]+\\}:\\{\\}\\}',
    ));
    expect(APP_HTML).toContain('is too long for the token budget this page was given');
  });

  it('shows "Show more" only when there is a next page to ask for', () => {
    expect(APP_HTML).toMatch(/\.hasMore===!1\)return null/);
    expect(APP_HTML).toMatch(/\.page<[\w$]+\.totalPages&&[\w$]+\([\w$]+\)!==null\?`<button class="more" data-more>Show more of/);
  });
});

type PageArgs = (view: unknown) => { name: string; args: Record<string, unknown> } | null;

/**
 * The function the bundle declares as `name`, run from the bundle itself: its
 * declaration and those of the functions it names, from the scope it is
 * declared in, evaluated in a context of their own. None of them touches the
 * DOM, so no browser is needed to run them, only to run the whole bundle.
 */
function bundledFunction(name: string): PageArgs {
  const file = ts.createSourceFile('app.js', inlinedScript(), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let scope: readonly ts.Statement[] | undefined;
  const findScope = (node: ts.Node): void => {
    if (scope !== undefined) { return; }
    if ((ts.isBlock(node) || ts.isSourceFile(node))
      && node.statements.some(s => ts.isFunctionDeclaration(s) && s.name?.text === name)) {
      scope = node.statements;
      return;
    }
    ts.forEachChild(node, findScope);
  };
  findScope(file);
  if (scope === undefined) {
    throw new Error(
      `The built bundle has no function declaration named ${name}, the name the "Show more" click handler `
      + 'calls: esbuild may now emit pageArgs as an expression or inline it.',
    );
  }
  const declared = new Map<string, ts.FunctionDeclaration>();
  for (const statement of scope) {
    if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
      declared.set(statement.name.text, statement);
    }
  }
  // Every function of that scope the body names, and every one those name.
  // A name that is only a property or a shadowing local adds a declaration
  // nothing calls, which is harmless.
  const needed = new Set<string>();
  const need = (fn: string): void => {
    const declaration = declared.get(fn);
    if (declaration === undefined || needed.has(fn)) { return; }
    needed.add(fn);
    const walk = (node: ts.Node): void => {
      if (ts.isIdentifier(node)) { need(node.text); }
      ts.forEachChild(node, walk);
    };
    walk(declaration);
  };
  need(name);
  const source = [...needed].map(fn => declared.get(fn)?.getText(file) ?? '').join('\n');
  return vm.runInNewContext(`${source}\n${name}`) as PageArgs;
}

describe('a click on "Show more" in the built bundle', () => {
  // The regex above matches the body of nextTocPageArgs, which the label also
  // calls, so it would still match if the click built its own arguments, as
  // it did until 2026-09-26: the id and the page, and no budget, version or
  // language. So this runs what the click runs. The `data-more` handler sends
  // what pageArgs gives it, and pageArgs is taken from the bundle and called
  // on a TOC view.
  let pageArgs: PageArgs | undefined;
  const onScreen = (data: Record<string, unknown>): ReturnType<PageArgs> => {
    pageArgs ??= bundledFunction(showMoreArgsFunction());
    // Through JSON: the objects were made in another context, and this
    // compares what goes over the wire.
    return JSON.parse(JSON.stringify(pageArgs({ kind: 'toc', data }))) as ReturnType<PageArgs>;
  };

  it('sends what pageArgs gives it', () => {
    expect(showMoreArgsFunction).not.toThrow();
  });

  it('asks for the next page at the version, language and budget of the page on screen', () => {
    expect(onScreen({
      productId: 'jamf-pro', version: '11.25.0', language: 'ja-JP',
      page: 1, totalPages: 4, hasMore: true, maxTokens: 1000, entries: [],
    })).toEqual({
      name: 'jamf_docs_get_toc',
      args: { product: 'jamf-pro', version: '11.25.0', language: 'ja-JP', page: 2, maxTokens: 1000 },
    });
  });

  it('asks under the name the request used', () => {
    expect(onScreen({
      publicationId: 'technical-paper-laps', version: 'current', page: 3, totalPages: 5, hasMore: true, maxTokens: 5000,
    })).toEqual({
      name: 'jamf_docs_get_toc',
      args: { publication: 'technical-paper-laps', page: 4, maxTokens: 5000 },
    });
  });

  it('asks for nothing past the last page the server offers', () => {
    // Page 100 of 150 at a small budget: `page` stops at 100.
    expect(onScreen({ productId: 'jamf-pro', page: 100, totalPages: 150, hasMore: false, maxTokens: 100 })).toBeNull();
  });
});
