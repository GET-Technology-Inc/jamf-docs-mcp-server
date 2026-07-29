/**
 * Regression tests for the generated MCP App bundle.
 *
 * `src/core/apps/generated/app-html.ts` is a build artifact that ships inside
 * `dist/`, and nothing else in the suite executes it — which is how 4.0.0
 * shipped a bundle that no browser could parse.
 *
 * The failure was silent by construction: `scripts/build-app-ui.mjs` inlined
 * the esbuild output with `String.prototype.replace` and a *replacement
 * string*, so every `$` pattern in the minified JS was expanded rather than
 * copied. Minified zod emits `` $` `` from its regex builders; in a
 * replacement string that means "everything before the match", so the entire
 * HTML prefix was spliced into the middle of the script fifteen times. The
 * document still looked well-formed — it just contained `<!DOCTYPE html>`
 * halfway through a function call.
 *
 * These tests assert the two properties that would have caught it: the
 * inlined script parses as JavaScript, and no markup from the shell leaked
 * into it.
 */

import { describe, it, expect } from 'vitest';
import vm from 'node:vm';

import { APP_HTML } from '../../../src/core/apps/generated/app-html.js';

/**
 * The contents of the single inlined `<script>` element.
 *
 * The bundle escapes its own `</script>` occurrences as `<\/script>`, so the
 * first closing tag in the document is the real one and a lazy match is safe.
 *
 * Every tag pattern here is case-insensitive. HTML tag names are, so a check
 * that only recognises the lower-case spelling would quietly pass on a shell
 * that used `<SCRIPT>` — reporting a well-formed document that is nothing of
 * the sort.
 */
function inlinedScript(): string {
  const match = /<script\b[^>]*>([\s\S]*?)<\/script>/i.exec(APP_HTML);
  if (match === null) {
    throw new Error('APP_HTML contains no <script> element');
  }
  const body = match[1];
  if (body === undefined) {
    throw new Error('APP_HTML <script> element has no body');
  }
  return body;
}

describe('generated MCP App bundle', () => {
  it('carries exactly one inlined script', () => {
    const openings = APP_HTML.match(/<script\b/gi) ?? [];
    expect(openings).toHaveLength(1);
    expect(inlinedScript().length).toBeGreaterThan(1000);
  });

  it('parses as JavaScript', () => {
    // `vm.Script` compiles without executing: a SyntaxError here is exactly
    // what a browser would raise on loading the document. esbuild emits an
    // IIFE (`format: 'iife'`), so classic-script parsing is the right check.
    expect(() => new vm.Script(inlinedScript(), { filename: 'app-bundle.js' })).not.toThrow();
  });

  it('does not splice the HTML shell into the script', () => {
    const script = inlinedScript();
    // The exact fingerprint of the `$`-expansion bug.
    expect(script).not.toMatch(/<!DOCTYPE/i);
    expect(script).not.toMatch(/<div id="root">/i);
    expect(script).not.toMatch(/<script\b/i);
  });

  it('keeps the shell well-formed around the script', () => {
    expect(APP_HTML.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(APP_HTML.match(/<!DOCTYPE/gi) ?? []).toHaveLength(1);
    expect(APP_HTML.match(/<\/body>/gi) ?? []).toHaveLength(1);
    expect(APP_HTML.trimEnd().endsWith('</html>')).toBe(true);
  });

  it('escapes closing script tags emitted by the bundle', () => {
    // Only the terminator may appear unescaped; anything else would end the
    // element early and dump the rest of the bundle into the document body.
    const withoutTerminator = APP_HTML.replace(/<\/script>\s*<\/body>/i, '</body>');
    expect(withoutTerminator).not.toMatch(/<\/script>/i);
  });
});
