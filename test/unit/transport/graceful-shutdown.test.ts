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
 * so it cannot run inside the test worker). The adapter's own signal
 * listeners are checked in process, with `process.exit` stubbed out.
 */

import { describe, it, expect, vi } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type AddressInfo } from 'node:net';
import path from 'node:path';

import { createHttpHandler } from '../../../src/transport/http-handler.js';
import { startHttpServer } from '../../../src/platforms/node/http-server.js';
import { DEFAULT_HTTP_CONFIG } from '../../../src/transport/http-types.js';
import { createSlowServer } from '../../helpers/slow-server.js';
import { readJsonRpc, parseSseMessages } from '../../helpers/streamable-http.js';
import { getFreePort, waitForServerStart } from '../../helpers/server-process.js';

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
      // Required on every 2026-07-28 POST. Server 2.0.0 served a request that
      // omitted it; 2.1.0 (typescript-sdk#2590) refuses one with 400 / -32020
      // before dispatch — so without it these tests would time a rejection,
      // not a drain.
      'MCP-Protocol-Version': '2026-07-28',
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

interface Fixture {
  child: ChildProcess;
  /** `http://127.0.0.1:<port>`, on the port this fixture was given. */
  base: string;
}

/**
 * Start the fixture on a free port, or on `port` when one is given. Only the
 * test of the failure path passes a port: the fixed one used here before
 * (13581) made overlapping test runs fail each other; see server-process.ts.
 */
async function startFixture(port?: number): Promise<Fixture> {
  const bind = port ?? await getFreePort();
  const child = spawn(process.execPath, ['--import', 'tsx', FIXTURE], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(bind) },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  await waitForServerStart(child, 30_000);
  return { child, base: `http://127.0.0.1:${String(bind)}` };
}

describe('the SIGTERM fixture', { timeout: 60_000 }, () => {
  it('takes a port of its own, so two can run at once', async () => {
    // What two overlapping test runs do. With the fixed port, the second
    // fixture failed to bind and its test failed.
    const fixtures = await Promise.allSettled([startFixture(), startFixture()]);
    try {
      const [a, b] = fixtures.map((f) => {
        if (f.status === 'rejected') { throw f.reason; }
        return f.value;
      });
      expect(a.base).not.toBe(b.base);
      for (const { base } of [a, b]) {
        expect((await fetch(`${base}/health`)).status).toBe(200);
      }
    } finally {
      for (const f of fixtures) {
        if (f.status === 'fulfilled') { f.value.child.kill('SIGKILL'); }
      }
    }
  });

  it('says why when its port is taken', async () => {
    const holder = createServer();
    await new Promise<void>((resolve) => { holder.listen(0, '127.0.0.1', resolve); });
    try {
      const { port } = holder.address() as AddressInfo;
      // The adapter prints the cause to stderr and exits 1. It used to reach
      // the test as a bare "fixture exited early with code 1".
      await expect(startFixture(port)).rejects.toThrow(
        new RegExp(`exited with code 1[\\s\\S]*Port ${String(port)} is already in use`),
      );
    } finally {
      await new Promise<void>((resolve) => { holder.close(() => { resolve(); }); });
    }
  });
});

describe('SIGTERM against a running HTTP server', { timeout: 60_000 }, () => {
  it('answers an in-flight 2026-07-28 tools/call in full and exits cleanly', async () => {
    const { child, base } = await startFixture();
    try {
      const call = fetch(`${base}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          // See modernRequest(): server 2.1.0 rejects a 2026-07-28 POST without it.
          'MCP-Protocol-Version': '2026-07-28',
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
    const { child, base } = await startFixture();
    try {
      const listen = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          // See modernRequest(): server 2.1.0 rejects a 2026-07-28 POST without it.
          'MCP-Protocol-Version': '2026-07-28',
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

// ---------------------------------------------------------------------------
// In process: the adapter's process signal listeners
// ---------------------------------------------------------------------------

describe('startHttpServer signal listeners', () => {
  it('stay installed through the drain and are removed once the server has closed', async () => {
    // Shutdown ends in process.exit, which would take the test worker down.
    // Recording it instead lets the real adapter run here.
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const counts = (): number[] => [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
    const baseline = counts();
    const before = process.listeners('SIGTERM');
    // Not a fixed port (13582 before): see server-process.ts.
    const port = await getFreePort();

    try {
      // The handler builds a server per request, after it has counted the
      // request as in flight, so the first factory call means the drain now
      // has to wait for it. Signalling there instead of sleeping keeps a slow
      // machine from sending SIGTERM before the call has arrived.
      let dispatched!: () => void;
      const reachedServer = new Promise<void>((resolve) => { dispatched = resolve; });
      await startHttpServer(() => {
        dispatched();
        return createSlowServer();
      }, port, '127.0.0.1');
      expect(counts()).toEqual(baseline.map((n) => n + 1));

      // Call the adapter's listener directly: emitting the signal would also
      // run whatever listeners the test runner has installed.
      const added = process.listeners('SIGTERM').filter((l) => !before.includes(l));
      expect(added).toHaveLength(1);
      const onSigterm = added[0];

      const call = fetch(`http://127.0.0.1:${String(port)}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'MCP-Protocol-Version': '2026-07-28',
          'Mcp-Method': 'tools/call',
          'Mcp-Name': 'slow',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'slow', arguments: { ms: 500 }, _meta: MODERN_META },
        }),
      });
      await reachedServer;
      onSigterm('SIGTERM');

      // Mid-drain the listeners must still be there: without one, a second
      // SIGTERM would get Node's default action and kill the process (143).
      // With one, shutdown() ignores the repeat.
      expect(counts()).toEqual(baseline.map((n) => n + 1));
      onSigterm('SIGTERM');

      const res = await call;
      expect(res.status).toBe(200);
      expect(JSON.stringify((await readJsonRpc(res)).result)).toContain('slept 500ms');

      await vi.waitFor(() => { expect(exit).toHaveBeenCalled(); }, { timeout: 5_000 });
      expect(exit).toHaveBeenCalledTimes(1);
      expect(exit).toHaveBeenCalledWith(0);
      expect(counts()).toEqual(baseline);
    } finally {
      exit.mockRestore();
      stderr.mockRestore();
    }
  });
});
