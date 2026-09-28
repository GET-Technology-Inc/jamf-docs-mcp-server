/**
 * The MCP App's search view for the two replies that changed on 2026-09-28:
 * a search that could not be completed, and one with no results.
 *
 * A failed search used to come back as a structured search with no results,
 * which the panel drew as "Nothing matched". It is now an error, as it should
 * be, and an error carries no structuredContent and prose for text, so the
 * panel classified it as nothing: from the host it was dropped, leaving the
 * loading view up, and from the panel's own call it read "returned nothing
 * renderable". The same was true of every tool's errors.
 *
 * A search with no results now carries what other sites matched, which the
 * empty view never drew.
 *
 * Asserted against `toolErrorText`, `renderNoResults` and `renderElsewhere`
 * themselves, which live outside app.ts for the reason `app-ui/toc.ts` does,
 * and then against the built bundle, which is what ships.
 */

import { describe, it, expect } from 'vitest';

import { toolErrorText, UNEXPLAINED_ERROR } from '../../../app-ui/tool-error.js';
import { otherSourceCount, renderElsewhere, renderNoResults } from '../../../app-ui/search.js';
import { APP_HTML } from '../../../src/core/apps/generated/app-html.js';

const FAILED =
  'Search for "setup manager" failed: the search results could not be fetched from ' +
  'learn.jamf.com (HTTP 503 Service Unavailable).';

const JAMFORMER = {
  title: 'Jamformer',
  url: 'https://concepts.jamf.com/en/concepts/jamformer/',
  source: 'Jamf Concepts',
};

describe('toolErrorText', () => {
  it('is nothing for a result that did not fail', () => {
    expect(toolErrorText({ content: [{ type: 'text', text: 'No results found for "x"' }] })).toBeUndefined();
    expect(toolErrorText({ isError: false, content: [] })).toBeUndefined();
  });

  it('is the first text block of one that did', () => {
    expect(toolErrorText({ isError: true, content: [{ type: 'text', text: FAILED }] })).toBe(FAILED);
  });

  it('leaves out the other-source block a failed search adds after it', () => {
    expect(toolErrorText({
      isError: true,
      content: [
        { type: 'text', text: FAILED },
        { type: 'text', text: '## Also found outside the product documentation\n\n…' },
      ],
    })).toBe(FAILED);
  });

  it('still says something when the result says nothing, or is malformed', () => {
    for (const content of [undefined, null, [], [{ type: 'text', text: '  ' }], [{ type: 'image' }], 'text']) {
      expect(toolErrorText({ isError: true, content })).toBe(UNEXPLAINED_ERROR);
    }
  });
});

describe('renderElsewhere', () => {
  it('is nothing when nothing matched elsewhere', () => {
    for (const otherSources of [undefined, null, [], 'x']) {
      expect(renderElsewhere(otherSources)).toBe('');
    }
  });

  it('links each match to its site, escaped', () => {
    const html = renderElsewhere([{ ...JAMFORMER, title: 'Jam<former>' }]);

    expect(html).toContain('<h2 class="group-title">Elsewhere</h2>');
    expect(html).toContain(`<a class="hit" href="${JAMFORMER.url}" data-external>`);
    expect(html).toContain('<span class="hit-title">Jam&lt;former&gt;</span>');
    expect(html).toContain('<span class="hit-meta">Jamf Concepts</span>');
  });

  it('skips a malformed match rather than throwing on it', () => {
    const html = renderElsewhere([null, { title: 'No URL', source: 'Jamf Concepts' }, JAMFORMER]);

    expect(html).toContain('Jamformer');
    expect(html).not.toContain('No URL');
  });
});

describe('renderNoResults', () => {
  it('shows what other sites matched, and says where nothing did', () => {
    const html = renderNoResults({ suggestions: [], otherSources: [JAMFORMER] });

    expect(html).toContain('<p class="notice">Nothing matched in the product documentation.</p>');
    expect(html).toContain(`href="${JAMFORMER.url}"`);
  });

  it('shows no more of them than it is given room for, and counts the rest', () => {
    const REENROLLER = { ...JAMFORMER, title: 'Reenroller', url: 'https://concepts.jamf.com/en/concepts/reenroller/' };
    const otherSources = [JAMFORMER, REENROLLER, { title: 'malformed' }];

    const html = renderNoResults({ otherSources }, 1);

    expect(html).toContain('Jamformer');
    expect(html).not.toContain('Reenroller');
    expect(otherSourceCount(otherSources)).toBe(2);
    expect(renderNoResults({ otherSources })).toContain('Reenroller');
  });

  it('says nothing matched anywhere, and offers the suggestions it has', () => {
    // With none, it gives no advice. Until 2026-09-28 it said "Try a broader
    // query", and Fluid Topics matches a page on any one word of a query, so
    // fewer words find nothing more: see renderNoResults.
    for (const suggestions of [[], undefined, [''], 'policies']) {
      expect(renderNoResults({ suggestions })).toContain('<p class="notice">Nothing matched.</p>');
    }
    const html = renderNoResults({ suggestions: ['policies'] });
    expect(html).toContain('<p class="notice">Nothing matched. Try one of these:</p>');
    expect(html).toContain('<button class="hit" data-search="policies"><span class="hit-title">policies</span></button>');
    expect(html).not.toContain('Elsewhere');
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
  // Asserted on the compiled code, as the other bundle checks are: app.ts is
  // not importable. esbuild renames identifiers but keeps property names,
  // string literals and template literals, so the call sites are recognisable.
  const noResultsFn = /function ([\w$]+)\([\w$]+,[\w$]+=Number\.POSITIVE_INFINITY\)\{let [\w$]+=Array\.isArray\([\w$]+\.suggestions\)/
    .exec(APP_HTML)?.[1] ?? '';
  const errorTextFn = /function ([\w$]+)\([\w$]+\)\{if\([\w$]+\.isError!==!0\)return;/.exec(APP_HTML)?.[1] ?? '';
  // INLINE_HITS, by the slice the view with results takes of them.
  const inlineHits = /\.results\.slice\(0,([\w$]+)\)/.exec(APP_HTML)?.[1] ?? '';
  // expandAction, by the label it writes.
  const expandFn = /function ([\w$]+)\([\w$]+,[\w$]+\)\{if\([\w$]+<=0\)return"";let [\w$]+=`Show /
    .exec(APP_HTML)?.[1] ?? '';
  const elsewhereFn = /function ([\w$]+)\([\w$]+,[\w$]+=Number\.POSITIVE_INFINITY\)\{let [\w$]+=[\w$]+\([\w$]+\)\.slice\(0,/
    .exec(APP_HTML)?.[1] ?? '';

  it('ships both', () => {
    for (const identifier of [noResultsFn, errorTextFn, inlineHits, expandFn, elsewhereFn]) {
      expect(identifier).not.toBe('');
    }
    expect(APP_HTML).toContain('Nothing matched in the product documentation.');
    expect(APP_HTML).not.toContain('Try a broader query');
    expect(APP_HTML).toContain(UNEXPLAINED_ERROR);
  });

  it('draws the empty search view from the whole payload, and caps what other sites matched inline', () => {
    // Fullscreen shows them all. Inline shows INLINE_HITS of them, as it does
    // results, and "Show N more links" for the rest.
    expect(APP_HTML).toMatch(new RegExp(
      'if\\(([\\w$]+)\\.results\\.length===0\\)\\{' +
      `let ([\\w$]+)=[\\w$]+\\(\\)\\?Number\\.POSITIVE_INFINITY:${literal(inlineHits)};` +
      `return\`\\$\\{[\\w$]+\\}\\$\\{${literal(noResultsFn)}\\(\\1,\\2\\)\\}\\s*` +
      `\\$\\{${literal(expandFn)}\\([\\w$]+\\(\\1\\.otherSources\\)-\\2,"link"\\)\\}\``,
    ));
  });

  it('leaves what other sites matched out of an inline view with results, as before', () => {
    // With results, an inline panel keeps its room for them; fullscreen lists
    // the other sites under them.
    expect(APP_HTML).toMatch(new RegExp(
      `\\.results\\.slice\\(0,${literal(inlineHits)}\\),[^;]*,([\\w$]+)=[\\w$]+\\(\\)\\?` +
      `${literal(elsewhereFn)}\\([\\w$]+\\.otherSources\\):"";`,
    ));
  });

  it('shows a failed result from the host as an error view, and drops what the panel was doing', () => {
    // The same `seq` and `history` a result that did not fail resets: a panel
    // call still in flight must not draw over the error, and Back must not
    // lead into what the host has moved on from. The view a result that did
    // not fail shows is `asked(view, toolArguments)` since 2026-09-28: see
    // app-translation-note.test.ts.
    expect(APP_HTML).toMatch(new RegExp(
      `\\.ontoolresult=([\\w$]+)=>\\{let ([\\w$]+)=${literal(errorTextFn)}\\(\\1\\);` +
      'if\\(\\2!==void 0\\)\\{([\\w$]+)\\+\\+,([\\w$]+)\\.length=0,([\\w$]+)\\(\\{kind:"error",message:\\2\\},!1\\);return\\}' +
      '[^}]*&&\\(\\3\\+\\+,\\4\\.length=0,\\5\\([\\w$]+\\([\\w$]+,[\\w$]+\\),!1\\)\\)\\}',
    ));
  });

  it('keeps the paragraphs of an error message apart', () => {
    // A failed search's message is three paragraphs, separated by blank lines.
    expect(APP_HTML).toMatch(new RegExp(
      'if\\(([\\w$]+)\\.kind==="error"\\)\\{[\\w$]+\\.innerHTML=`[^`]*' +
      '<p class="head-sub head-error">\\$\\{[\\w$]+\\([\\w$]+\\(\\1\\.message\\)\\)\\}</p>',
    ));
    expect(APP_HTML).toMatch(/\.head-error \{ white-space: pre-line;/);
  });

  it("shows a failed result of the panel's own call as an error view it can retry", () => {
    expect(APP_HTML).toMatch(new RegExp(
      'let ([\\w$]+)=await [\\w$]+\\.callServerTool\\([^;]+;if\\([^)]+\\)return;' +
      `let ([\\w$]+)=${literal(errorTextFn)}\\(\\1\\);` +
      'if\\(\\2!==void 0\\)\\{[\\w$]+\\(\\{kind:"error",message:\\2,retry:',
    ));
  });
});
