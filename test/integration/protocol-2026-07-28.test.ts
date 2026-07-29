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
import { DEFAULT_HTTP_CONFIG } from '../../src/transport/http-types.js';
import { createMockContext } from '../helpers/mock-context.js';

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
  const res = await handler(
    new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'Mcp-Method': method,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    }),
  );
  return { status: res.status, body: JSON.parse(await res.text()) as Record<string, unknown> };
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
    // Legacy traffic keeps the JSON response shape it was built against
    // rather than the SDK fallback's always-SSE stream.
    const body = JSON.parse(await res.text()) as Record<string, unknown>;
    const result = body.result as { serverInfo: { name: string } };
    expect(result.serverInfo.name).toBe('jamf-docs-mcp-server');
  });
});
