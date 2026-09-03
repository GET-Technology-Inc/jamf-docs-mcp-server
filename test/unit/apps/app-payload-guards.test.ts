/**
 * The MCP App must not throw on a malformed tool payload.
 *
 * `classify()` in `app-ui/app.ts` casts an entirely unvalidated value — the
 * host's relayed `structuredContent`, or `JSON.parse` of a text block — to a
 * view interface after checking two fields. Every optional `string` in those
 * interfaces is therefore `unknown` at runtime, and the renderers reach
 * straight for `.replace` and `.length`.
 *
 * That matters because of where a throw lands. Inside `call()` it is caught and
 * repainted as an error view; arriving via `app.ontoolresult` it is an uncaught
 * exception and the panel is simply dead — the same silent-failure mode this
 * bundle already shipped once.
 *
 * The renderers are not exported (the module connects to a host on import), so
 * these tests run the guard predicates against the same inputs rather than the
 * renderers themselves, and assert the bundle carries them.
 */

import { describe, it, expect } from 'vitest';

import { APP_HTML } from '../../../src/core/apps/generated/app-html.js';
import { esc } from '../../../app-ui/escape.js';

/** Mirrors `renderableText` in app-ui/app.ts. */
function renderableText(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

/** Mirrors the `crumbs` guard in app-ui/app.ts. */
function crumbParts(path: unknown): string[] {
  if (!Array.isArray(path)) {
    return [];
  }
  return (path as unknown[]).filter(renderableText);
}

describe('malformed payload guards', () => {
  it('treats every non-string as unrenderable rather than reaching for .replace', () => {
    // `null` is the one the previous `!== undefined` check let through, and the
    // one the server has a precedent for: search-service returns
    // `product: null` upstream before normalisation.
    for (const value of [null, undefined, '', 0, 1, false, true, NaN, {}, []]) {
      expect(renderableText(value)).toBe(false);
    }
    expect(renderableText('11.5.0')).toBe(true);
  });

  it('drops non-string breadcrumb entries instead of throwing on them', () => {
    expect(crumbParts(undefined)).toEqual([]);
    expect(crumbParts(null)).toEqual([]);
    expect(crumbParts(0)).toEqual([]);
    expect(crumbParts('not-an-array')).toEqual([]);
    expect(crumbParts([])).toEqual([]);
    expect(crumbParts([null, 0, false])).toEqual([]);
    expect(crumbParts(['Jamf Pro', null, 'Policies'])).toEqual(['Jamf Pro', 'Policies']);
  });

  it('ships those guards in the built bundle', () => {
    // esbuild minifies identifiers, so the assertion is on the shape the
    // guards compile to rather than on their names: a `typeof … === "string"`
    // test and an `Array.isArray` test both survive minification.
    expect(APP_HTML).toContain('Array.isArray');
    expect(APP_HTML).toMatch(/typeof [\w$]+=="string"/);
  });
});

describe('section ids are stamped on a rendered-output match', () => {
  /**
   * `stampIds` decides whether a rendered heading came from a given section by
   * comparing it against what the renderer would emit for that section's
   * title — not by stripping the heading's markup and comparing plain text.
   *
   * Stripping was wrong twice. As sanitization, `<[^>]*>` never matches an
   * unterminated tag, so `<img src=x onerror=y` survives it whole and no
   * amount of looping helps (CodeQL: js/incomplete-multi-character-
   * sanitization). As logic, it asked whether two plain texts coincide when
   * the question is whether the heading was rendered *from* that title.
   *
   * Mirrored rather than imported for the reason app-ui/escape.ts documents:
   * importing app.ts runs its top-level wiring and throws outside a browser.
   */
  function inline(escaped: string): string {
    return escaped
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  }

  it('matches a heading the renderer produced from that title', () => {
    const title = 'Jamf `recon` Requirements';
    expect(inline(esc(title.trim()))).toBe('Jamf <code>recon</code> Requirements');
  });

  // CONTROL. The comparison never sees raw markup, because `esc` has already
  // turned every angle bracket into an entity — which is what removes the
  // sanitization question rather than answering it.
  it('never has markup to strip in the first place', () => {
    const hostile = '<img src=x onerror=alert(1)';
    const rendered = inline(esc(hostile));

    expect(rendered).not.toContain('<img');
    expect(rendered).toContain('&lt;img');
    // And an unterminated tag is exactly what a tag-stripping regex misses.
    expect(hostile.replace(/<[^>]*>/g, '')).toBe(hostile);
  });
});
