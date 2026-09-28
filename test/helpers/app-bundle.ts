/**
 * The generated MCP App bundle, taken apart the way the app tests read it.
 *
 * `occurrences` and `inlinedScript` were in app-html.test.ts, and the pattern
 * of the "Show more" click handler in app-search-paging.test.ts, until
 * 2026-09-28, when app-toc-paging.test.ts needed both as well.
 *
 * The document is scanned with plain string operations over a lower-cased
 * copy rather than with regular expressions. HTML tag syntax has more slack
 * than a pattern comfortably expresses — `<SCRIPT>`, `</script >` — and a
 * matcher that quietly misses a spelling would report a well-formed document
 * without having looked at the one that matters. The click handler is minified
 * JavaScript, not markup, so it is matched with a pattern.
 */

import { APP_HTML } from '../../src/core/apps/generated/app-html.js';

const LOWER = APP_HTML.toLowerCase();

/** Every index at which `needle` occurs in the lower-cased document. */
export function occurrences(needle: string): number[] {
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
export function inlinedScript(): string {
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

/**
 * The `data-more` click handler in app.ts, as esbuild minifies it:
 *
 *     if (target.closest('button[data-more]') !== null) {
 *       const next = current !== null ? pageArgs(current) : null;
 *       if (next !== null) { void call(next.name, next.args, true); }
 *
 * esbuild renames identifiers but keeps property names and string literals,
 * so the shape is recognisable. The second group is the name it gives
 * `pageArgs`.
 */
const DATA_MORE_CLICK =
  /"button\[data-more\]"\)!==null\)\{let ([\w$]+)=[\w$]+!==null\?([\w$]+)\([\w$]+\):null;\1!==null&&[\w$]+\(\1\.name,\1\.args,!0\)/;

/**
 * The bundle's name for the function whose result a click on "Show more"
 * sends: `pageArgs` in app.ts. Throws, saying what it looked for, when the
 * bundle has no click handler of that shape, whether because the handler
 * changed or because esbuild now minifies it differently.
 */
export function showMoreArgsFunction(): string {
  const name = DATA_MORE_CLICK.exec(APP_HTML)?.[2];
  if (name === undefined) {
    throw new Error(
      'The built bundle has no "Show more" click handler that sends what a function of the view on screen '
      + 'returns (app.ts: `const next = current !== null ? pageArgs(current) : null; '
      + 'if (next !== null) { void call(next.name, next.args, true); }`). If app.ts or esbuild changed its '
      + 'shape, update DATA_MORE_CLICK in test/helpers/app-bundle.ts.',
    );
  }
  return name;
}
