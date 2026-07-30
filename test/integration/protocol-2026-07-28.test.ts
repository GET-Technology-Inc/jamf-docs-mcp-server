/**
 * Wire-level checks for protocol revision 2026-07-28.
 *
 * These drive the real `createHttpHandler` (no SDK mocks) so the assertions
 * are about bytes on the wire, not about how the handler is wired internally.
 * Nothing here touches the network: `server/discover`, `tools/list` and the
 * legacy `initialize` handshake are all answered from registration state.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { createHttpHandler } from '../../src/transport/http-handler.js';
import { createMcpServer, TOOL_ORDER } from '../../src/core/create-server.js';
import {
  APP_RESOURCE_URI,
  APP_MIME_TYPE,
  UI_EXTENSION_ID,
} from '../../src/core/apps/index.js';
import { DEFAULT_HTTP_CONFIG } from '../../src/transport/http-types.js';
import { createMockContext } from '../helpers/mock-context.js';
import { readJsonRpc } from '../helpers/streamable-http.js';

const { handler, cleanup } = createHttpHandler(
  () => createMcpServer(createMockContext()),
  { ...DEFAULT_HTTP_CONFIG, rateLimitRpm: 10_000 },
  () => '127.0.0.1',
);

afterAll(() => {
  cleanup();
});

/** The reserved `_meta` envelope every 2026-07-28 request must carry. */
function modernMeta(): Record<string, unknown> {
  return {
    'io.modelcontextprotocol/protocolVersion': '2026-07-28',
    'io.modelcontextprotocol/clientCapabilities': {},
    'io.modelcontextprotocol/clientInfo': { name: 'protocol-test', version: '1.0.0' },
  };
}

interface RpcResult {
  status: number;
  body: Record<string, unknown>;
}

async function rpc(
  method: string,
  params: Record<string, unknown>,
  id = 1,
): Promise<RpcResult> {
  // SEP-2243: a request naming an entity must repeat that name in `Mcp-Name`,
  // and the entry rejects a mismatch with -32020 before dispatch.
  const name = (params.uri ?? params.name) as string | undefined;

  const res = await handler(
    new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'Mcp-Method': method,
        ...(name !== undefined ? { 'Mcp-Name': name } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    }),
  );
  return { status: res.status, body: await readJsonRpc(res) };
}

function resultOf(body: Record<string, unknown>): Record<string, unknown> {
  expect(body.error).toBeUndefined();
  return body.result as Record<string, unknown>;
}

describe('server/discover', () => {
  it('should advertise the 2026-07-28 revision', async () => {
    const { status, body } = await rpc('server/discover', { _meta: modernMeta() });

    expect(status).toBe(200);
    expect(resultOf(body).supportedVersions).toContain('2026-07-28');
  });

  it('should identify the server in the result _meta envelope', async () => {
    // serverInfo moved out of the result body into `_meta` in this revision.
    const result = resultOf((await rpc('server/discover', { _meta: modernMeta() })).body);
    const meta = result._meta as Record<string, unknown>;

    expect(meta['io.modelcontextprotocol/serverInfo']).toMatchObject({
      name: 'jamf-docs-mcp-server',
    });
  });

  it('should NOT advertise the deprecated logging capability', async () => {
    // SEP-2577 deprecated the Logging feature; declaring it would oblige this
    // server to answer logging requests it no longer implements.
    const result = resultOf((await rpc('server/discover', { _meta: modernMeta() })).body);
    const capabilities = result.capabilities as Record<string, unknown>;

    expect(capabilities.logging).toBeUndefined();
    expect(capabilities.tools).toBeDefined();
  });

  it('should carry a public cache hint', async () => {
    const result = resultOf((await rpc('server/discover', { _meta: modernMeta() })).body);

    expect(result.ttlMs).toBeGreaterThan(0);
    expect(result.cacheScope).toBe('public');
  });
});

describe('tools/list', () => {
  it('should tag the result as complete', async () => {
    const result = resultOf((await rpc('tools/list', { _meta: modernMeta() })).body);

    expect(result.resultType).toBe('complete');
  });

  it('should be cacheable by shared caches', async () => {
    // Everything this server returns is public documentation, and the tool
    // list only changes on deploy — without a hint the SDK emits ttlMs: 0.
    const result = resultOf((await rpc('tools/list', { _meta: modernMeta() })).body);

    expect(result.ttlMs).toBeGreaterThan(0);
    expect(result.cacheScope).toBe('public');
  });

  it('should list tools in the declared order', async () => {
    // 2026-07-28 asks for a deterministic order so clients can cache the list
    // and LLM prompt caches keep hitting.
    const result = resultOf((await rpc('tools/list', { _meta: modernMeta() })).body);
    const names = (result.tools as { name: string }[]).map((t) => t.name);

    expect(names).toEqual([...TOOL_ORDER]);
  });

  it('should list tools in the same order on every call', async () => {
    const first = resultOf((await rpc('tools/list', { _meta: modernMeta() }, 1)).body);
    const second = resultOf((await rpc('tools/list', { _meta: modernMeta() }, 2)).body);

    expect((second.tools as { name: string }[]).map((t) => t.name)).toEqual(
      (first.tools as { name: string }[]).map((t) => t.name),
    );
  });
});

describe('envelope enforcement', () => {
  it('should reject a 2026-07-28 request missing client capabilities', async () => {
    const { body } = await rpc('tools/list', {
      _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' },
    });

    expect(body.error).toBeDefined();
    expect((body.error as { code: number }).code).toBe(-32602);
  });
});

describe('request header binding', () => {
  it('should reject a named request whose Mcp-Name disagrees with the body', async () => {
    // SEP-2243 binds the header to the body so an intermediary cannot route on
    // a name the payload does not actually carry.
    const res = await handler(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'Mcp-Method': 'resources/read',
          'Mcp-Name': 'ui://jamf-docs/something-else.html',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'resources/read',
          params: { uri: APP_RESOURCE_URI, _meta: modernMeta() },
        }),
      }),
    );

    const body = await readJsonRpc(res);
    expect((body.error as { code: number } | undefined)?.code).toBe(-32020);
  });
});

describe('2025-era clients', () => {
  it('should still answer the initialize handshake', async () => {
    const res = await handler(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'old-client', version: '1.0.0' },
          },
        }),
      }),
    );

    expect(res.status).toBe(200);
    // Served by the SDK's stateless legacy fallback, which streams. The 2025
    // binding requires clients to accept `text/event-stream`, so the framing
    // is the transport's business — the test reads it the way a client does.
    const body = await readJsonRpc(res);
    const result = body.result as { serverInfo: { name: string } };
    expect(result.serverInfo.name).toBe('jamf-docs-mcp-server');
  });
});

describe('MCP Apps extension', () => {
  it('should advertise the ui extension in server/discover', async () => {
    const result = resultOf((await rpc('server/discover', { _meta: modernMeta() })).body);
    const {extensions} = (result.capabilities as { extensions?: Record<string, unknown> });

    expect(extensions?.[UI_EXTENSION_ID]).toMatchObject({
      mimeTypes: [APP_MIME_TYPE],
    });
  });

  it('should point the view-bearing tools at the shared app resource', async () => {
    const result = resultOf((await rpc('tools/list', { _meta: modernMeta() })).body);
    const tools = result.tools as ({ name: string } & Partial<Record<'_meta', Record<string, unknown>>>)[];

    // One resource serves all three: the app picks its view from the shape of
    // the structured content, so there is no need for three bundles.
    for (const name of ['jamf_docs_search', 'jamf_docs_get_toc', 'jamf_docs_get_article']) {
      const tool = tools.find((t) => t.name === name);
      expect(tool, name).toBeDefined();
      expect((tool!._meta?.ui as { resourceUri?: string } | undefined)?.resourceUri).toBe(
        APP_RESOURCE_URI,
      );
      // Older hosts read the flat key; the two must agree.
      expect(tool!._meta?.['ui/resourceUri']).toBe(APP_RESOURCE_URI);
    }
  });

  it('should not attach app metadata to tools with nothing to render', async () => {
    const result = resultOf((await rpc('tools/list', { _meta: modernMeta() })).body);
    const tools = result.tools as ({ name: string } & Partial<Record<'_meta', Record<string, unknown>>>)[];
    const listProducts = tools.find((t) => t.name === 'jamf_docs_list_products');

    expect(listProducts?._meta?.ui).toBeUndefined();
  });

  it('should list the app resource with the MCP Apps mime type', async () => {
    const result = resultOf((await rpc('resources/list', { _meta: modernMeta() })).body);
    const resources = result.resources as { uri: string; mimeType?: string }[];
    const app = resources.find((r) => r.uri === APP_RESOURCE_URI);

    expect(app).toBeDefined();
    expect(app!.mimeType).toBe(APP_MIME_TYPE);
  });

  it('should serve a self-contained document', async () => {
    const result = resultOf(
      (await rpc('resources/read', { uri: APP_RESOURCE_URI, _meta: modernMeta() })).body,
    );
    const contents = result.contents as { mimeType: string; text: string }[];
    const html = contents[0].text;

    expect(contents[0].mimeType).toBe(APP_MIME_TYPE);
    // Hosts render this in a sandboxed iframe under a deny-by-default CSP, so
    // anything loaded from another origin would silently fail.
    expect(html).toContain('<script type="module">');
    expect(html).not.toMatch(/<script[^>]+\bsrc=/i);
    expect(html).not.toMatch(/<link[^>]+rel=["']?stylesheet/i);
  });

  it('should let hosts cache the app bundle', async () => {
    const result = resultOf(
      (await rpc('resources/read', { uri: APP_RESOURCE_URI, _meta: modernMeta() })).body,
    );

    // The bundle only changes on release.
    expect(result.ttlMs).toBeGreaterThan(0);
    expect(result.cacheScope).toBe('public');
  });
});

// ---------------------------------------------------------------------------
// Malformed requests
// ---------------------------------------------------------------------------

describe('malformed POSTs', () => {
  it('should answer 400 for a POST with an empty body', async () => {
    // The handler reads the body itself and hands the parsed value to the SDK.
    // With nothing to hand over, the SDK re-reads the request by cloning it —
    // which throws on an already-consumed body and used to surface as an
    // opaque 500. Driven here against the real entry, not a mock.
    //
    // `body: ''` matters: it is what the Node adapter builds for a bodyless
    // POST (`init.body = Buffer.alloc(0)`). Omitting `body` entirely leaves
    // `request.body` null, which `text()` never marks as used and `clone()`
    // therefore still accepts — so it would not reproduce the defect.
    const res = await handler(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'Mcp-Method': 'tools/list',
        },
        body: '',
      }),
    );

    expect(res.status).toBe(400);
  });

  it('should answer 400 for a POST whose body is not JSON', async () => {
    const res = await handler(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'Mcp-Method': 'tools/list',
        },
        body: '{not json',
      }),
    );

    expect(res.status).toBe(400);
  });
});
