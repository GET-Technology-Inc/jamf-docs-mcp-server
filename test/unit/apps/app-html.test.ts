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
import { createHash } from 'node:crypto';

import { APP_HTML, APP_HTML_HASH } from '../../../src/core/apps/generated/app-html.js';
import { APP_RESOURCE_URI, appToolMeta } from '../../../src/core/apps/index.js';

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

// ============================================================================
// Cache identity
// ============================================================================

/**
 * The `ui://` URI is the only cache key a host has for the bundle, and the
 * resource is served with a 24-hour *public* hint. If the URI can name two
 * different bundles over time, that hint freezes whichever one a host happened
 * to read first — which is exactly what kept the unparseable 4.0.0 bundle
 * alive on hosts that had already fetched it, for a day after 4.0.1 deployed.
 *
 * These tests assert the property that makes the long TTL safe: the cache
 * identity is a function of the bundle's bytes.
 */
describe('app resource cache identity', () => {
  it('should carry the bundle hash in the resource URI', () => {
    expect(APP_RESOURCE_URI).toContain(APP_HTML_HASH);
  });

  it('should derive the hash from the bundle contents', () => {
    // Recomputed rather than trusted: this is what ties the URI to the bytes.
    // Editing the generated bundle without re-running `npm run build:app-ui`
    // fails here, because the committed hash would no longer describe it.
    const recomputed = createHash('sha256')
      .update(APP_HTML, 'utf-8')
      .digest('hex')
      .slice(0, APP_HTML_HASH.length);

    expect(APP_HTML_HASH).toBe(recomputed);
  });

  it('should produce a different URI for different bundle content', () => {
    const other = createHash('sha256')
      .update(`${APP_HTML}<!-- changed -->`, 'utf-8')
      .digest('hex')
      .slice(0, APP_HTML_HASH.length);

    expect(other).not.toBe(APP_HTML_HASH);
  });

  it('should point both _meta spellings at the same content-addressed URI', () => {
    // Older hosts read the flat key and newer ones read the nested one; if
    // they disagreed, one population would fetch a URI the server no longer
    // serves. Both derive from APP_RESOURCE_URI, so this pins that they stay
    // derived from it.
    const meta = appToolMeta();
    const nested = (meta.ui as { resourceUri?: string } | undefined)?.resourceUri;

    expect(nested).toBe(APP_RESOURCE_URI);
    expect(meta['ui/resourceUri']).toBe(APP_RESOURCE_URI);
  });

  it('should keep the URI a well-formed ui:// resource identifier', () => {
    expect(APP_RESOURCE_URI.startsWith('ui://jamf-docs/app-')).toBe(true);
    expect(APP_RESOURCE_URI.endsWith('.html')).toBe(true);
    // No characters that would need escaping in a URI.
    expect(/^ui:\/\/[a-z0-9\-/.]+$/.test(APP_RESOURCE_URI)).toBe(true);
  });
});
