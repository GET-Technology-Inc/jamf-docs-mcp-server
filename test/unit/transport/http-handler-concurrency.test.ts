/**
 * Regression test for the shared-McpServer concurrency defect.
 *
 * The HTTP handler used to hold a single McpServer and reconnect a fresh
 * transport to it on every request. The MCP SDK allows only one transport
 * per Protocol/Server instance, so a second *concurrent* request threw
 * "Already connected to a transport" and leaked its transport.
 *
 * Unlike http-handler.test.ts, this file does NOT mock the SDK transport —
 * it exercises the real McpServer + WebStandardStreamableHTTPServerTransport
 * so the connect()-per-request contract is actually verified. No network is
 * touched: only the `initialize` handshake is sent.
 */

import { describe, it, expect } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createHttpHandler } from '../../../src/transport/http-handler.js';
import { DEFAULT_HTTP_CONFIG } from '../../../src/transport/http-types.js';
import { createMcpServer } from '../../../src/core/create-server.js';
import { createMockContext } from '../../helpers/mock-context.js';

const localIp = (_req: Request): string => '127.0.0.1';

/** A minimal, valid MCP `initialize` request to /mcp. */
function initializeRequest(id: number): Request {
  return new Request('http://localhost/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'regression-test', version: '1.0.0' },
      },
    }),
  });
}

/** Per-request factory: a fresh, fully-registered server each call. */
function serverFactory(): () => McpServer {
  const ctx = createMockContext();
  return () => createMcpServer(ctx);
}

describe('HTTP handler — concurrent /mcp requests (real SDK)', () => {
  it('serves a single initialize request with HTTP 200', async () => {
    const { handler, cleanup } = createHttpHandler(
      serverFactory(),
      { ...DEFAULT_HTTP_CONFIG },
      localIp,
    );
    try {
      const res = await handler(initializeRequest(1));
      expect(res.status).toBe(200);
    } finally {
      cleanup();
    }
  });

  it('serves two concurrent initialize requests without "Already connected"', async () => {
    const { handler, cleanup } = createHttpHandler(
      serverFactory(),
      { ...DEFAULT_HTTP_CONFIG },
      localIp,
    );
    try {
      // Fire both before awaiting either — this is the race that previously
      // made the second request throw on the shared server's second connect().
      const settled = await Promise.allSettled([
        handler(initializeRequest(1)),
        handler(initializeRequest(2)),
      ]);

      const rejected = settled.filter((s) => s.status === 'rejected');
      expect(rejected).toHaveLength(0);

      const statuses = settled.map((s) =>
        s.status === 'fulfilled' ? s.value.status : 0,
      );
      expect(statuses).toEqual([200, 200]);
    } finally {
      cleanup();
    }
  });
});
