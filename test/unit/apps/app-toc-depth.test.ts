/**
 * The MCP App must draw the TOC as a tree.
 *
 * `jamf_docs_get_toc` publishes `structuredContent.entries` flattened in
 * document order with a `depth` on every entry, precisely so a host that reads
 * the structured payload can rebuild the hierarchy the markdown shows as
 * indentation. This bundle is that host — `jamf_docs_get_toc` carries
 * `_meta: appToolMeta()` — and it rendered every entry as a `<li class="row">`
 * in one flat `<ul>`, so a user of the app saw a Jamf Pro TOC as ~800 titles
 * with no structure and no way to tell a section from an article under it.
 *
 * The rows are asserted against `renderTocItems` itself rather than against a
 * re-declared copy of it, which is why that function lives in `app-ui/toc.ts`:
 * importing `app-ui/app.ts` runs its top-level wiring and throws outside a
 * browser. The last test closes the remaining gap — that the built bundle,
 * which is what actually ships, was regenerated from these sources.
 */

import { describe, it, expect } from 'vitest';

import { indentSteps, renderTocItems, MAX_TOC_INDENT, type TocEntry } from '../../../app-ui/toc.js';
import { CSS } from '../../../app-ui/styles.js';
import { APP_HTML } from '../../../src/core/apps/generated/app-html.js';

/** The `--depth:N` written on each row, in row order. */
function renderedDepths(html: string): number[] {
  return [...html.matchAll(/--depth:(-?[\w.]+)/g)].map((m) => Number(m[1]));
}

/**
 * The six-entry shape `test/unit/tools/get-toc.test.ts` sends the tool: two
 * roots, one three levels deep with a sibling after the deep branch. Its
 * depths are [0, 1, 2, 1, 0, 1] — a sequence no counter and no constant
 * reproduces.
 */
function nestedEntries(): TocEntry[] {
  return [
    { title: 'Computers', url: 'https://learn.jamf.com/page/Computers.html', depth: 0 },
    { title: 'Inventory', url: 'https://learn.jamf.com/page/Inventory.html', depth: 1 },
    { title: 'Inventory Display', url: 'https://learn.jamf.com/page/Display.html', depth: 2 },
    { title: 'Smart Groups', url: 'https://learn.jamf.com/page/SmartGroups.html', depth: 1 },
    { title: 'Mobile Devices', url: 'https://learn.jamf.com/page/MobileDevices.html', depth: 0 },
    { title: 'Enrollment', url: 'https://learn.jamf.com/page/Enrollment.html', depth: 1 },
  ];
}

describe('TOC rows carry their nesting level', () => {
  it('gives every row the depth the server sent for it', () => {
    const html = renderTocItems(nestedEntries());

    expect(renderedDepths(html)).toEqual([0, 1, 2, 1, 0, 1]);
    // One row per entry, still: indenting must not drop or duplicate any.
    expect(html.split('<li').length - 1).toBe(6);
  });

  it('still carries the url and title each row is clicked for', () => {
    // The rows are what `[data-url]` handlers key off, so the indent must not
    // have been bought by rewriting the row into something unclickable.
    const html = renderTocItems([
      { title: 'Smart Groups', url: 'https://learn.jamf.com/page/SmartGroups.html', depth: 2 },
    ]);

    expect(html).toContain('data-url="https://learn.jamf.com/page/SmartGroups.html"');
    expect(html).toContain('>Smart Groups</a>');

    // A real anchor with a real href, not the `<li role="button" tabindex="0">`
    // this replaced. A TOC row opens a document, so the affordance should not
    // be a lie: keyboard activation, the status-bar URL preview and "copy link
    // address" all come back for free, and a modifier-click reaches the host's
    // own link handling instead of being swallowed. The ARIA role and the
    // manual tabindex existed only to fake the first of those.
    expect(html).toContain('<a class="row"');
    expect(html).toContain('href="https://learn.jamf.com/page/SmartGroups.html"');
    expect(html).not.toContain('role="button"');
  });

  it('marks a top-level row so the stylesheet can rank it', () => {
    // Depth alone cannot separate a section from an article inside it once the
    // indent is capped, and a 792-entry Jamf Pro TOC is otherwise one
    // undifferentiated column of titles.
    const html = renderTocItems(nestedEntries());

    expect(html.match(/data-top/g)).toHaveLength(2);
    expect(html).toContain('<a class="row" data-top');
  });

  // CONTROL. Every assertion above is also satisfied by a renderer that
  // indents by array position, and that draws a flat TOC as a staircase. Jamf
  // ships flat bundles (a release-notes map whose top level is all leaves), so
  // this is a real page, not a hypothetical one.
  it('leaves every row of a flat TOC flush left', () => {
    const html = renderTocItems([
      { title: 'Release Notes', url: 'https://learn.jamf.com/page/Release.html', depth: 0 },
      { title: 'Known Issues', url: 'https://learn.jamf.com/page/Known.html', depth: 0 },
      { title: 'Deprecations', url: 'https://learn.jamf.com/page/Deprecations.html', depth: 0 },
    ]);

    expect(renderedDepths(html)).toEqual([0, 0, 0]);
  });

  // CONTROL. `depth` only exists from server 4.2.0. A host talking to an older
  // one gets entries without it, and those must render exactly as this app
  // always rendered them rather than as NaN — which `calc()` treats as an
  // invalid declaration, silently, so it would look correct here and be
  // untraceable in a panel.
  it('renders entries from a server that does not send depth flush left', () => {
    const html = renderTocItems([
      { title: 'Computers', url: 'https://learn.jamf.com/page/Computers.html' },
      { title: 'Inventory', url: 'https://learn.jamf.com/page/Inventory.html' },
    ]);

    expect(renderedDepths(html)).toEqual([0, 0]);
  });
});

describe('indent depth is clamped before it reaches a style attribute', () => {
  it('passes through the levels a real TOC has', () => {
    expect(indentSteps(0)).toBe(0);
    expect(indentSteps(1)).toBe(1);
    expect(indentSteps(MAX_TOC_INDENT)).toBe(MAX_TOC_INDENT);
  });

  it('caps a depth deeper than the panel can indent', () => {
    // Unbounded, 400 * 14px pushes the title 5,600px right of a ~320px panel:
    // the row is still there, still clickable, and entirely off-screen.
    expect(indentSteps(MAX_TOC_INDENT + 1)).toBe(MAX_TOC_INDENT);
    expect(indentSteps(400)).toBe(MAX_TOC_INDENT);
    expect(indentSteps(Number.MAX_SAFE_INTEGER)).toBe(MAX_TOC_INDENT);
  });

  it('treats every value that is not a usable level as no indent', () => {
    // `classify()` in app.ts casts an unvalidated payload after checking two
    // fields, so the declared `number` is `unknown` at runtime — the same
    // reasoning as `renderableText` and the `crumbs` guard. The infinities are
    // in here rather than in the cap above deliberately: neither names a level
    // a TOC can have, so both render as "no nesting known" rather than as a
    // depth the payload merely overshot.
    const notALevel: [label: string, value: unknown][] = [
      ['undefined', undefined],
      ['null', null],
      ['NaN', NaN],
      ['Infinity', Infinity],
      ['-Infinity', -Infinity],
      ['-1', -1],
      ['-0', -0],
      ['"2"', '2'],
      ['{}', {}],
      ['[]', []],
      ['true', true],
    ];
    for (const [label, value] of notALevel) {
      expect(indentSteps(value), `indentSteps(${label})`).toBe(0);
    }
    // Fractions floor rather than emitting `calc(11px + 1.5 * 14px)`.
    expect(indentSteps(1.5)).toBe(1);
  });

  it('cannot let a payload break out of the style attribute it is written into', () => {
    // The one place an unvalidated value is interpolated into an attribute
    // *value* rather than into text. A string closes the quote and everything
    // after it is parsed as further attributes on the same tag.
    const html = renderTocItems([
      {
        title: 'Computers',
        url: 'https://learn.jamf.com/page/Computers.html',
        depth: '0" onmouseover="alert(1)' as unknown as number,
      },
    ]);

    expect(html).not.toContain('onmouseover');
    expect(html).toContain('style="--depth:0"');
  });
});

describe('the indent is wired up end to end', () => {
  it('spends the depth in the stylesheet', () => {
    // An attribute nothing reads is not an indent. The rule has to consume
    // `--depth` and has to have a fallback, or a pre-4.2.0 payload renders
    // with `calc()` invalid and no padding at all.
    //
    // `padding-inline-start`, not `padding-left`: the app sets `dir="rtl"` from
    // `hostContext.locale`, and a physical property indents an Arabic or Hebrew
    // TOC away from the text it belongs to.
    expect(CSS).toMatch(/\.row\s*\{[^}]*padding-inline-start:[^}]*var\(--depth,\s*0\)/);
  });

  it('clamps the depth a second time in CSS', () => {
    // `indentSteps` bounds the value written into the attribute, and the rule
    // bounds it again against a cap measured from the panel width. The two
    // guards are independent on purpose: neither a hostile payload nor a bug in
    // one of them alone can push a row off the panel.
    expect(CSS).toMatch(/min\(var\(--depth,\s*0\),\s*var\(--cap,\s*\d+\)\)/);
  });

  it('ships in the generated bundle', () => {
    // `src/core/apps/generated/app-html.ts` is committed, and the hash test in
    // app-html.test.ts recomputes the hash from the bundle itself — so editing
    // `app-ui/` and not re-running `npm run build:app-ui` leaves every other
    // test green while shipping the old flat renderer to every host.
    expect(APP_HTML).toContain('--depth:');
    expect(APP_HTML).toContain('var(--depth, 0)');
  });
});
