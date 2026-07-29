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
