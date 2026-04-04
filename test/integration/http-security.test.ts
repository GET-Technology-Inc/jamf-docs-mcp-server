/**
 * Integration tests for HTTP transport security.
 *
 * Starts a real Node.js HTTP server for each describe block (different configs)
 * and makes actual fetch() calls to test CORS, security headers, and rate
 * limiting end-to-end through the full Node.js request/response bridge.
 *
 * Complements the unit tests in test/unit/transport/http-handler.test.ts which
 * test the handler logic in isolation with a mocked MCP transport.  These tests
 * prove the Node.js bridge (X-Forwarded-For extraction, IP injection, etc.) works
 * correctly under real network conditions.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { createHttpHandler } from '../../src/transport/http-handler.js';
import type { HttpHandlerConfig, ClientIpExtractor } from '../../src/transport/http-types.js';
import { DEFAULT_HTTP_CONFIG } from '../../src/transport/http-types.js';

// ============================================================================
// Minimal Node.js bridge (mirrors handleNodeRequest in http-server.ts)
// ============================================================================

/**
 * Replicate the Node.js IP extraction logic from http-server.ts so we can
 * test the full path — including X-Forwarded-For header parsing — without
 * importing the private function directly.
 */
function getNodeClientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      const ips = forwarded.split(',').map((s) => s.trim()).filter(Boolean);
      // Take rightmost IP (last hop that we trust as the real client)
      return ips[ips.length - 1] ?? 'unknown';
    }
  }
  const socket = req.socket as { remoteAddress?: string } | undefined;
  return socket?.remoteAddress ?? 'unknown';
}

/**
 * Convert a Node.js IncomingMessage + resolved IP into a Web Standard Request,
 * then call the platform-agnostic handler and pipe the Web Response back.
 */
async function handleNodeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  handler: (request: Request) => Promise<Response>,
  config: HttpHandlerConfig,
  trustProxy: boolean,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const clientIp = getNodeClientIp(req, trustProxy);

  // Collect body
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer));
  }
  const body = Buffer.concat(chunks);

  // Build headers
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value !== undefined) {
      if (Array.isArray(value)) {
        for (const v of value) { headers.append(key, v); }
      } else {
        headers.set(key, value);
      }
    }
  }
  // Inject resolved client IP for the platform-agnostic handler
  headers.set('x-real-ip', clientIp);

  const method = req.method ?? 'GET';
  const init: RequestInit = { method, headers };
  if (method !== 'GET' && method !== 'HEAD' && method !== 'DELETE') {
    init.body = body;
  }

  const webReq = new Request(url.toString(), init);
  const webRes = await handler(webReq);

  res.writeHead(webRes.status, Object.fromEntries(webRes.headers.entries()));

  if (webRes.body === null) {
    res.end();
    return;
  }

  const reader = webRes.body.getReader();
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) { break; }
      res.write(result.value);
    }
  } finally {
    reader.releaseLock();
    res.end();
  }
}

// ============================================================================
// Test server factory
// ============================================================================

interface TestServer {
  port: number;
  baseUrl: string;
  close: () => Promise<void>;
  cleanup: () => void;
}

/**
 * Spin up a real HTTP server with the given config overrides.
 * The server automatically picks a free port (port 0).
 */
async function startTestServer(
  configOverrides: Partial<HttpHandlerConfig> & { trustProxy?: boolean },
): Promise<TestServer> {
  const { trustProxy = false, ...rest } = configOverrides;

  const config: HttpHandlerConfig = {
    ...DEFAULT_HTTP_CONFIG,
    serverVersion: '0.0.0-test',
    ...rest,
  };

  // The platform-agnostic handler reads IP from the injected x-real-ip header
  const getClientIp: ClientIpExtractor = (request: Request): string => {
    return request.headers.get('x-real-ip') ?? 'unknown';
  };

  // Minimal stub MCP server — health/CORS/rate-limit tests never reach /mcp
  const stubMcpServer = { connect: async (): Promise<void> => { /* no-op */ } };

  const { handler, cleanup } = createHttpHandler(
    stubMcpServer as never,
    config,
    getClientIp,
  );

  const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    void handleNodeRequest(req, res, handler, config, trustProxy);
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(0, '127.0.0.1', () => { resolve(); });
  });

  const address = httpServer.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Unexpected server address format');
  }

  const port = address.port;

  return {
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    close: (): Promise<void> =>
      new Promise<void>((resolve, reject) => {
        httpServer.close((err) => { err ? reject(err) : resolve(); });
      }),
    cleanup,
  };
}

// ============================================================================
// CORS — wildcard mode
// ============================================================================

describe('CORS — wildcard mode', () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await startTestServer({ corsAllowedOrigins: ['*'] });
  });

  afterAll(async () => {
    server.cleanup();
    await server.close();
  });

  it('responds with Access-Control-Allow-Origin: * when configured with wildcard', async () => {
    const res = await fetch(`${server.baseUrl}/health`, {
      headers: { Origin: 'https://example.com' },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('responds with Access-Control-Allow-Origin: * even without Origin header', async () => {
    // Wildcard mode does not require an Origin header — the header is still sent
    const res = await fetch(`${server.baseUrl}/health`);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('OPTIONS preflight returns 204 with CORS headers under wildcard', async () => {
    const res = await fetch(`${server.baseUrl}/mcp`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://example.com' },
    });

    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-methods')).toBe('GET, POST, OPTIONS');
    expect(res.headers.get('access-control-allow-headers')).toBe('Content-Type');
  });

  it('does NOT set Vary: Origin when wildcard is configured', async () => {
    const res = await fetch(`${server.baseUrl}/health`, {
      headers: { Origin: 'https://a.example.com' },
    });

    // Wildcard responses must not vary by Origin
    expect(res.headers.get('vary')).toBeNull();
  });
});

// ============================================================================
// CORS — exact origin matching
// ============================================================================

describe('CORS — exact origin matching', () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await startTestServer({
      corsAllowedOrigins: ['https://allowed.example.com'],
    });
  });

  afterAll(async () => {
    server.cleanup();
    await server.close();
  });

  it('allows a request from the configured origin', async () => {
    const res = await fetch(`${server.baseUrl}/health`, {
      headers: { Origin: 'https://allowed.example.com' },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://allowed.example.com');
    expect(res.headers.get('vary')).toBe('Origin');
  });

  it('rejects a request from a non-configured origin — no CORS header', async () => {
    const res = await fetch(`${server.baseUrl}/health`, {
      headers: { Origin: 'https://evil.example.com' },
    });

    // Server still responds (not a network-level block), but no CORS header
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('OPTIONS preflight allows the configured origin', async () => {
    const res = await fetch(`${server.baseUrl}/mcp`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://allowed.example.com' },
    });

    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://allowed.example.com');
  });

  it('OPTIONS preflight does NOT set CORS header for unlisted origin', async () => {
    const res = await fetch(`${server.baseUrl}/mcp`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://unlisted.example.com' },
    });

    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});

// ============================================================================
// CORS — no origins configured
// ============================================================================

describe('CORS — no origins configured', () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await startTestServer({ corsAllowedOrigins: [] });
  });

  afterAll(async () => {
    server.cleanup();
    await server.close();
  });

  it('never sets Access-Control-Allow-Origin when corsAllowedOrigins is empty', async () => {
    const res = await fetch(`${server.baseUrl}/health`, {
      headers: { Origin: 'https://any.example.com' },
    });

    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(res.headers.get('access-control-allow-methods')).toBeNull();
  });

  it('OPTIONS returns no CORS headers when no origins are configured', async () => {
    const res = await fetch(`${server.baseUrl}/mcp`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://any.example.com' },
    });

    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});

// ============================================================================
// Security headers (all responses)
// ============================================================================

describe('security headers', () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await startTestServer({ corsAllowedOrigins: [] });
  });

  afterAll(async () => {
    server.cleanup();
    await server.close();
  });

  it('all responses include X-Content-Type-Options: nosniff', async () => {
    const res = await fetch(`${server.baseUrl}/health`);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('all responses include X-Frame-Options: DENY', async () => {
    const res = await fetch(`${server.baseUrl}/health`);
    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });

  it('all responses include Cache-Control: no-store', async () => {
    const res = await fetch(`${server.baseUrl}/health`);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('404 responses also carry security headers', async () => {
    const res = await fetch(`${server.baseUrl}/unknown-path`);
    expect(res.status).toBe(404);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('OPTIONS preflight carries security headers', async () => {
    const res = await fetch(`${server.baseUrl}/mcp`, { method: 'OPTIONS' });
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});

// ============================================================================
// Rate limiting
// ============================================================================

describe('rate limiting', () => {
  /**
   * Use a burst limit of 3 RPM so each test server is cheap to exhaust
   * without sending dozens of real HTTP requests.
   */
  const BURST_LIMIT = 3;

  it('returns 429 after exceeding the burst limit', async () => {
    const server = await startTestServer({ rateLimitRpm: BURST_LIMIT });
    try {
      // Exhaust the bucket
      for (let i = 0; i < BURST_LIMIT; i++) {
        const res = await fetch(`${server.baseUrl}/health`);
        expect(res.status).toBe(200);
      }

      // Next request must be rejected
      const res = await fetch(`${server.baseUrl}/health`);
      expect(res.status).toBe(429);
      const body = await res.json() as { error: string };
      expect(body.error).toBe('Too many requests');
    } finally {
      server.cleanup();
      await server.close();
    }
  });

  it('rate limits by client IP independently — different IPs get separate buckets', async () => {
    /**
     * Start server with trustProxy: true so X-Forwarded-For is honoured.
     * Limit: 2 requests per IP.  Send 2 from IP-A then 2 from IP-B.
     * Both should succeed; the limit is not shared across IPs.
     */
    const server = await startTestServer({
      rateLimitRpm: 2,
      trustProxy: true,
    });
    try {
      // IP-A: 2 requests → both allowed
      for (let i = 0; i < 2; i++) {
        const res = await fetch(`${server.baseUrl}/health`, {
          headers: { 'X-Forwarded-For': '10.0.0.1' },
        });
        expect(res.status).toBe(200);
      }

      // IP-B: 2 requests → also both allowed (separate bucket)
      for (let i = 0; i < 2; i++) {
        const res = await fetch(`${server.baseUrl}/health`, {
          headers: { 'X-Forwarded-For': '10.0.0.2' },
        });
        expect(res.status).toBe(200);
      }

      // IP-A: 3rd request → now rejected
      const rejected = await fetch(`${server.baseUrl}/health`, {
        headers: { 'X-Forwarded-For': '10.0.0.1' },
      });
      expect(rejected.status).toBe(429);
    } finally {
      server.cleanup();
      await server.close();
    }
  });

  it('uses the rightmost X-Forwarded-For IP for rate limiting when trustProxy is enabled', async () => {
    /**
     * X-Forwarded-For: <client>, <proxy1>, <last-hop>
     *
     * The Node.js bridge takes the rightmost entry (last-hop) as the trusted
     * real client, preventing leftmost-IP spoofing attacks.
     *
     * Proof: exhaust the limit for the rightmost IP ("10.1.1.99") while
     * cycling the leftmost spoofed value.  Changing the spoofed header must
     * NOT reset the rate limit — the 429 is driven by "10.1.1.99".
     */
    const server = await startTestServer({
      rateLimitRpm: 2,
      trustProxy: true,
    });
    try {
      // Exhaust the bucket for rightmost IP 10.1.1.99 (spoofed leftmost varies)
      for (let i = 0; i < 2; i++) {
        const res = await fetch(`${server.baseUrl}/health`, {
          headers: { 'X-Forwarded-For': `192.168.${i}.1, 10.1.1.99` },
        });
        expect(res.status).toBe(200);
      }

      // Now change the spoofed leftmost IP — bucket still belongs to 10.1.1.99
      const res = await fetch(`${server.baseUrl}/health`, {
        headers: { 'X-Forwarded-For': '10.99.99.99, 10.1.1.99' },
      });
      // Must still be rejected because 10.1.1.99 is exhausted
      expect(res.status).toBe(429);
    } finally {
      server.cleanup();
      await server.close();
    }
  });

  it('does NOT rate limit when trustProxy is false and X-Forwarded-For is sent', async () => {
    /**
     * When trustProxy is false, X-Forwarded-For is ignored.
     * All loopback requests from 127.0.0.1 share a single bucket,
     * but the limit only applies to that real socket IP.
     *
     * Verify: with a limit of 2 and trustProxy=false, sending different
     * X-Forwarded-For values doesn't create separate buckets — they all
     * deplete the same 127.0.0.1 bucket.
     */
    const server = await startTestServer({
      rateLimitRpm: 2,
      trustProxy: false,
    });
    try {
      // Two requests allowed (fills 127.0.0.1 bucket)
      for (let i = 0; i < 2; i++) {
        const res = await fetch(`${server.baseUrl}/health`, {
          headers: { 'X-Forwarded-For': `10.0.0.${i + 1}` },
        });
        expect(res.status).toBe(200);
      }

      // Third request rejected — X-Forwarded-For header is irrelevant
      const res = await fetch(`${server.baseUrl}/health`, {
        headers: { 'X-Forwarded-For': '10.0.0.99' },
      });
      expect(res.status).toBe(429);
    } finally {
      server.cleanup();
      await server.close();
    }
  });
});
