/**
 * MCP Apps extension (`io.modelcontextprotocol/ui`).
 *
 * Tools that return a browsable result — search hits, a table of contents, an
 * article — reference a `ui://` HTML resource, and hosts that support the
 * extension render it inline in the conversation instead of printing the
 * markdown. Hosts that do not support it ignore the metadata entirely and get
 * the same text they always did, so this is purely additive.
 *
 * All three tools point at the *same* resource. The app decides which view to
 * show from the shape of the structured content it is handed, which keeps one
 * bundle on the wire instead of three near-identical copies.
 */

import type { McpServer } from '@modelcontextprotocol/server';
import { APP_HTML, APP_HTML_HASH } from './generated/app-html.js';

/** Extension identifier used for capability negotiation. */
export const UI_EXTENSION_ID = 'io.modelcontextprotocol/ui';

/** MIME type identifying an MCP Apps HTML resource. */
export const APP_MIME_TYPE = 'text/html;profile=mcp-app';

/**
 * URI of the shared app resource, content-addressed by the bundle's hash.
 *
 * The hash is not decoration — it is what makes the cache hint below safe. A
 * fixed `ui://jamf-docs/app.html` carries no identity for *which* bundle it
 * names, so a host that fetched it under one release kept serving that copy
 * for the full TTL after the server had deployed a different one. 4.0.0
 * shipped a bundle that never parsed and 4.0.1 replaced it wholesale; every
 * host that had read the resource in between held the broken copy for up to a
 * day, and the fix could not reach them.
 *
 * With the hash in the URI a changed bundle is a different resource, so the
 * stale entry is simply never asked for again and the host fetches the new one
 * on its next `tools/list`. That also bounds the residual staleness to the
 * one-hour `tools/list` / `resources/list` hint in create-server.ts rather
 * than this resource's own 24 hours.
 */
export const APP_RESOURCE_URI = `ui://jamf-docs/app-${APP_HTML_HASH}.html`;

/**
 * `_meta` to attach to a tool whose result the app can render.
 *
 * Both spellings are emitted: `_meta.ui.resourceUri` is the current form, and
 * `_meta['ui/resourceUri']` is what older hosts read. They must agree.
 */
export function appToolMeta(): Record<string, unknown> {
  return {
    ui: { resourceUri: APP_RESOURCE_URI },
    'ui/resourceUri': APP_RESOURCE_URI,
  };
}

/**
 * Register the shared `ui://` resource.
 *
 * The document is fully self-contained — script and styles inlined — because
 * hosts render it in a sandboxed iframe under a deny-by-default CSP where no
 * external asset would load. It is embedded at build time rather than read
 * from disk so the same code path works on Cloudflare Workers, which has no
 * filesystem.
 */
export function registerApps(server: McpServer): void {
  server.registerResource(
    'jamf-docs-app',
    APP_RESOURCE_URI,
    {
      title: 'Jamf Documentation Viewer',
      description:
        'Interactive viewer for Jamf documentation search results, tables of contents, and articles.',
      mimeType: APP_MIME_TYPE,
      // Safe because APP_RESOURCE_URI is content-addressed: this URI names one
      // exact bundle and will never name a different one, so a host holding it
      // for a day is holding something that genuinely cannot go stale. A new
      // bundle arrives under a new URI rather than replacing this one.
      cacheHint: { ttlMs: 86_400_000, cacheScope: 'public' },
    },
    () => ({
      contents: [
        {
          uri: APP_RESOURCE_URI,
          mimeType: APP_MIME_TYPE,
          text: APP_HTML,
        },
      ],
    }),
  );
}
