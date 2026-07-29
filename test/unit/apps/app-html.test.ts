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
 *
 * Everything here scans with plain string operations over a lower-cased copy
 * rather than with regular expressions. HTML tag syntax has more slack than a
 * pattern comfortably expresses — `<SCRIPT>`, `</script >` — and a matcher
 * that quietly misses a spelling would report a well-formed document without
 * having looked at the one that matters.
 */

import { describe, it, expect } from 'vitest';
import vm from 'node:vm';

import { APP_HTML } from '../../../src/core/apps/generated/app-html.js';

const LOWER = APP_HTML.toLowerCase();

/** Every index at which `needle` occurs in the lower-cased document. */
function occurrences(needle: string): number[] {
  const found: number[] = [];
  for (let i = LOWER.indexOf(needle); i !== -1; i = LOWER.indexOf(needle, i + 1)) {
    found.push(i);
  }
  return found;
}

/**
 * The contents of the single inlined `<script>` element.
 *
 * The bundle escapes its own `</script>` occurrences as `<\/script>`, so the
 * document contains exactly one opening and one closing tag and the span
 * between them is the whole script.
 */
function inlinedScript(): string {
  const opens = occurrences('<script');
  const closes = occurrences('</script');
  if (opens.length !== 1 || closes.length !== 1) {
    throw new Error(
      `expected exactly one script element, found ${String(opens.length)} open `
      + `and ${String(closes.length)} close tag(s)`,
    );
  }

  // Skip past the rest of the opening tag, and stop at the start of the
  // closing one — which may be spelled `</script >`.
  const bodyStart = APP_HTML.indexOf('>', opens[0] ?? 0) + 1;
  const bodyEnd = closes[0] ?? -1;
  if (bodyStart === 0 || bodyEnd < bodyStart) {
    throw new Error('APP_HTML script element is malformed');
  }
  return APP_HTML.slice(bodyStart, bodyEnd);
}

describe('generated MCP App bundle', () => {
  it('carries exactly one inlined script', () => {
    expect(occurrences('<script')).toHaveLength(1);
    expect(occurrences('</script')).toHaveLength(1);
    expect(inlinedScript().length).toBeGreaterThan(1000);
  });

  it('parses as JavaScript', () => {
    // `vm.Script` compiles without executing: a SyntaxError here is exactly
    // what a browser would raise on loading the document. esbuild emits an
    // IIFE (`format: 'iife'`), so classic-script parsing is the right check.
    expect(() => new vm.Script(inlinedScript(), { filename: 'app-bundle.js' })).not.toThrow();
  });

  it('does not splice the HTML shell into the script', () => {
    const script = inlinedScript().toLowerCase();
    // The exact fingerprint of the `$`-expansion bug.
    expect(script).not.toContain('<!doctype');
    expect(script).not.toContain('<div id="root">');
    expect(script).not.toContain('<html');
    expect(script).not.toContain('<body');
  });

  it('keeps the shell well-formed around the script', () => {
    expect(APP_HTML.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(occurrences('<!doctype')).toHaveLength(1);
    expect(occurrences('</body>')).toHaveLength(1);
    expect(occurrences('</html>')).toHaveLength(1);
    expect(APP_HTML.trimEnd().endsWith('</html>')).toBe(true);
  });

  it('escapes closing script tags emitted by the bundle', () => {
    // The bundle rewrites its own `</script>` occurrences as `<\/script>`,
    // which is inert to the JS parser. An unescaped one would end the element
    // early and dump the rest of the bundle into the document body — so the
    // single closing tag counted above must be the terminator, sitting between
    // the script and `</body>`.
    const close = occurrences('</script')[0] ?? -1;
    const body = occurrences('</body>')[0] ?? -1;
    expect(close).toBeGreaterThan(-1);
    expect(close).toBeLessThan(body);

    const between = APP_HTML.slice(close, body).trim().toLowerCase();
    expect(between.startsWith('</script')).toBe(true);
    expect(between.endsWith('>')).toBe(true);
    // Nothing but optional whitespace between the tag name and its `>`.
    expect(between.slice('</script'.length, -1).trim()).toBe('');
  });
});
