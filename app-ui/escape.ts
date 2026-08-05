/**
 * HTML escaping for the MCP App.
 *
 * Split out of `app.ts` so renderers can live in modules a test can import.
 * `app.ts` itself cannot be imported outside a browser: its top level calls
 * `requireRoot()`, which throws without a `#root` element, and `app.connect()`,
 * which reaches for a host. That is why the existing guard tests re-declare
 * copies of the predicates they check instead of calling them — a mirror that
 * stays green when the original changes. Anything worth asserting on belongs
 * on this side of the import boundary.
 */

/**
 * Everything rendered by this app originates from fetched documentation, so it
 * is escaped before any markup is applied. The inline formatter in `app.ts`
 * only ever re-introduces tags it generated itself.
 */
export function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
