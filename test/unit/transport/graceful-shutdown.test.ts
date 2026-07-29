/**
 * Regression tests for graceful shutdown of the HTTP transport.
 *
 * 4.0.0 shipped a shutdown that skipped its own drain window for exactly the
 * traffic it was meant to protect. `startHttpServer` called the handler's
 * `cleanup()` before `httpServer.close()`, and `cleanup()` ran
 * `mcpHandler.close()` — which aborts every in-flight *modern* exchange and
 * maps it to HTTP 499. A 2026-07-28 client mid-`tools/call` got `499` about
 * ten milliseconds after SIGTERM, while a 2025-era client on the SDK's legacy
 * fallback (per-request by construction, so nothing to abort) got its full
 * result. `shutdownTimeoutMs` was honoured for one era and ignored for the
 * other.
 *
 * The order that works, and the order these tests pin:
 *
 *   1. end the `subscriptions/listen` streams — they never finish on their
 *      own, and their sockets are what would keep `http.Server.close()` from
 *      ever completing;
 *   2. drain in-flight exchanges, bounded by `shutdownTimeoutMs`;
 *   3. close the MCP handler, then let the HTTP server finish.
 *
 * Two levels are covered: `createHttpHandler().shutdown()` in process, and the
 * real SIGTERM path in a child process (the Node adapter calls `process.exit`,
 * so it cannot run inside the test worker).
 */

import { describe, it, expect } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';

import { createHttpHandler } from '../../../src/transport/http-handler.js';
import { DEFAULT_HTTP_CONFIG } from '../../../src/transport/http-types.js';
import { createSlowServer } from '../../helpers/slow-server.js';
import { readJsonRpc, parseSseMessages } from '../../helpers/streamable-http.js';

const localIp = (): string => '127.0.0.1';

/** The `_meta` envelope every 2026-07-28 request carries. */
const MODERN_META = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientCapabilities': {},
  'io.modelcontextprotocol/clientInfo': { name: 'shutdown-test', version: '1.0.0' },
};

function modernRequest(
  url: string,
  method: string,
  params: Record<string, unknown>,
  id: string | number,
  name?: string,
): Request {
  return new Request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'Mcp-Method': method,
      ...(name !== undefined ? { 'Mcp-Name': name } : {}),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params: { ...params, _meta: MODERN_META },
    }),
  });
}

// ---------------------------------------------------------------------------
// In-process: the handler's own shutdown sequence
// ---------------------------------------------------------------------------

describe('createHttpHandler().shutdown()', () => {
  it('lets an in-flight modern tools/call finish instead of answering 499', async () => {
    const { handler, shutdown } = createHttpHandler(
      createSlowServer,
      { ...DEFAULT_HTTP_CONFIG, rateLimitRpm: 10_000, shutdownTimeoutMs: 10_000 },
      localIp,
    );

    const call = handler(
      modernRequest('http://localhost/mcp', 'tools/call', {
        name: 'slow',
        arguments: { ms: 300 },
      }, 1, 'slow'),
    );

    // Let the exchange get past dispatch, then pull the rug.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const shutdownDone = shutdown();

    const res = await call;
    expect(res.status).toBe(200);

    const body = await readJsonRpc(res);
    expect(body.error).toBeUndefined();
    expect(JSON.stringify(body.result)).toContain('slept 300ms');

    await shutdownDone;
  });

  it('ends an open subscriptions/listen stream rather than draining it', async () => {
    const { handler, shutdown } = createHttpHandler(
      createSlowServer,
      { ...DEFAULT_HTTP_CONFIG, rateLimitRpm: 10_000, shutdownTimeoutMs: 10_000 },
      localIp,
    );

    const listen = await handler(
      modernRequest('http://localhost/mcp', 'subscriptions/listen', {
        notifications: { tools: true },
      }, 'sub-1'),
    );
    expect(listen.status).toBe(200);
    expect(listen.headers.get('content-type')).toContain('text/event-stream');

    // A subscription never completes on its own: if shutdown waited for it,
    // this would take the full 10s budget instead of ending promptly.
    const started = Date.now();
    await shutdown();
    expect(Date.now() - started).toBeLessThan(2_000);

    // The stream is finite now — reading it to EOF must not hang.
    const frames = await listen.text();
    expect(frames).toContain('subscriptions/acknowledged');

    // And it must be *completed*, not merely dropped. Serving subscriptions
    // from their own handler is what buys this: closing that handler runs the
    // SDK's graceful teardown, which writes the terminal result frame. Cutting
    // the socket instead would leave the client unable to tell an orderly
    // shutdown from a crash.
    const messages = parseSseMessages(frames);
    const terminal = messages.find((m) => 'result' in m);
    expect(terminal).toBeDefined();
    expect(terminal?.id).toBe('sub-1');
    expect((terminal?.result as { resultType?: string }).resultType).toBe('complete');
  });

  it('gives up after the drain budget rather than hanging', async () => {
    const { handler, shutdown } = createHttpHandler(
      createSlowServer,
      { ...DEFAULT_HTTP_CONFIG, rateLimitRpm: 10_000 },
      localIp,
    );

    const call = handler(
      modernRequest('http://localhost/mcp', 'tools/call', {
        name: 'slow',
        arguments: { ms: 5_000 },
      }, 2, 'slow'),
    );

    await new Promise((resolve) => setTimeout(resolve, 50));
    const started = Date.now();
    await shutdown(150);
    const elapsed = Date.now() - started;

    expect(elapsed).toBeGreaterThanOrEqual(120);
    expect(elapsed).toBeLessThan(2_000);

    // Whatever the abandoned call answers, it must not throw.
    await expect(call.then((r) => r.status)).resolves.toBeTypeOf('number');
  });
});

// ---------------------------------------------------------------------------
// Child process: the real SIGTERM path
// ---------------------------------------------------------------------------

const FIXTURE = path.resolve(process.cwd(), 'test/helpers/slow-http-server.ts');
const PORT = 13_581;
const BASE = `http://127.0.0.1:${String(PORT)}`;

async function startFixture(): Promise<ChildProcess> {
  const child = spawn(process.execPath, ['--import', 'tsx', FIXTURE], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'ignore', 'pipe'],
  });

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error('fixture start timed out')); }, 30_000);
    child.stderr.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('running on http://')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      reject(new Error(`fixture exited early with code ${String(code)}`));
    });
  });

  return child;
}

describe('SIGTERM against a running HTTP server', { timeout: 60_000 }, () => {
  it('answers an in-flight 2026-07-28 tools/call in full and exits cleanly', async () => {
    const child = await startFixture();
    try {
      const call = fetch(`${BASE}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'Mcp-Method': 'tools/call',
          'Mcp-Name': 'slow',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'slow', arguments: { ms: 1_500 }, _meta: MODERN_META },
        }),
      });

      // Long enough that the call is certainly past dispatch, short enough
      // that it is nowhere near finishing.
      await new Promise((resolve) => setTimeout(resolve, 300));
      child.kill('SIGTERM');

      const res = await call;
      // The defect: 499 with an empty body, ~10ms after the signal.
      expect(res.status).toBe(200);
      const body = await readJsonRpc(res);
      expect(body.error).toBeUndefined();
      expect(JSON.stringify(body.result)).toContain('slept 1500ms');

      const code = await new Promise<number | null>((resolve) => {
        child.on('exit', resolve);
      });
      // Non-zero means the force-exit timer won, i.e. shutdown wedged.
      expect(code).toBe(0);
    } finally {
      child.kill('SIGKILL');
    }
  });

  it('releases an open subscription stream so shutdown can complete', async () => {
    const child = await startFixture();
    try {
      const listen = await fetch(`${BASE}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'Mcp-Method': 'subscriptions/listen',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'sub-1',
          method: 'subscriptions/listen',
          params: { notifications: { tools: true }, _meta: MODERN_META },
        }),
      });
      expect(listen.status).toBe(200);

      child.kill('SIGTERM');

      // Draining the stream to EOF proves the server ended it; if the socket
      // stayed open this await would sit here until the test timeout.
      const frames = await listen.text();
      expect(frames).toContain('subscriptions/acknowledged');
      // Ended properly, not dropped — see the in-process case above.
      expect(frames).toContain('"resultType":"complete"');

      const code = await new Promise<number | null>((resolve) => {
        child.on('exit', resolve);
      });
      expect(code).toBe(0);
    } finally {
      child.kill('SIGKILL');
    }
  });
});
