/**
 * Unit tests for createHttpHandler (src/transport/http-handler.ts)
 *
 * Strategy: mock WebStandardStreamableHTTPServerTransport so we can test
 * createHttpHandler in isolation using Web Standard Request/Response objects.
 * Each test constructs a plain Request, calls the handler, and inspects the Response.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// ============================================================================
// Hoisted shared state — mock transport instance shared across all describe blocks
// ============================================================================

const shared = vi.hoisted(() => ({
  mcpTransportInstance: {
    handleRequest: vi.fn(),
    close: vi.fn(),
  },
}));

// ============================================================================
// Mock the MCP SDK transport — must be declared before importing handler
// ============================================================================

vi.mock('@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js', () => ({
  WebStandardStreamableHTTPServerTransport: vi.fn(function () {
    return shared.mcpTransportInstance;
  }),
}));

// Import the module under test AFTER all vi.mock() calls
import { createHttpHandler } from '../../../src/transport/http-handler.js';
import { DEFAULT_HTTP_CONFIG, type HttpHandlerConfig } from '../../../src/transport/http-types.js';

// ============================================================================
// Helpers
// ============================================================================

/** Minimal mock MCP server — only connect() is needed by the handler */
function makeMockMcpServer(): { connect: ReturnType<typeof vi.fn> } {
  return { connect: vi.fn().mockResolvedValue(undefined) };
}

/** Build a config with sensible overrides for tests */
function makeConfig(overrides?: Partial<HttpHandlerConfig>): HttpHandlerConfig {
  return { ...DEFAULT_HTTP_CONFIG, ...overrides };
}

/** Identity IP extractor — returns the supplied string directly */
const alwaysLocalIp = (_req: Request): string => '127.0.0.1';

/** Create a Web Standard Request with the given options */
function makeRequest(options: {
  method?: string;
  path?: string;
  headers?: Record<string, string>;
  body?: string;
} = {}): Request {
  const {
    method = 'GET',
    path = '/',
    headers = {},
    body,
  } = options;

  return new Request(`http://localhost${path}`, {
    method,
    headers,
    body: body !== undefined ? body : undefined,
  });
}

/** Convenience: parse the JSON response body */
async function parseJson(res: Response): Promise<Record<string, unknown>> {
  return res.json() as Promise<Record<string, unknown>>;
}

// ============================================================================
// createHttpHandler — factory return value
// ============================================================================

describe('createHttpHandler — return value', () => {
  it('should return an object with handler and cleanup functions', () => {
    // Arrange
    const { handler, cleanup } = createHttpHandler(
      makeMockMcpServer() as never,
      makeConfig(),
      alwaysLocalIp,
    );

    // Assert
    expect(typeof handler).toBe('function');
    expect(typeof cleanup).toBe('function');

    // Cleanup
    cleanup();
  });

  it('cleanup should clear the interval without throwing', () => {
    // Arrange
    const { cleanup } = createHttpHandler(
      makeMockMcpServer() as never,
      makeConfig(),
      alwaysLocalIp,
    );

    // Act & Assert: no error thrown
    expect(() => cleanup()).not.toThrow();
  });
});

// ============================================================================
// Health endpoint
// ============================================================================

describe('/health endpoint', () => {
  let handler: (request: Request) => Promise<Response>;
  let cleanup: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ handler, cleanup } = createHttpHandler(
      makeMockMcpServer() as never,
      makeConfig({ serverVersion: '9.9.9-test' }),
      alwaysLocalIp,
    ));
  });

  afterEach(() => {
    cleanup();
  });

  it('should return 200 for GET /health', async () => {
    // Arrange
    const req = makeRequest({ method: 'GET', path: '/health' });

    // Act
    const res = await handler(req);

    // Assert
    expect(res.status).toBe(200);
  });

  it('should return JSON body with status "ok"', async () => {
    // Arrange
    const req = makeRequest({ method: 'GET', path: '/health' });

    // Act
    const res = await handler(req);
    const body = await parseJson(res);

    // Assert
    expect(body.status).toBe('ok');
  });

  it('should include serverVersion in health response', async () => {
    // Arrange
    const req = makeRequest({ method: 'GET', path: '/health' });

    // Act
    const res = await handler(req);
    const body = await parseJson(res);

    // Assert
    expect(body.version).toBe('9.9.9-test');
  });

  it('should set Content-Type: application/json', async () => {
    // Arrange
    const req = makeRequest({ method: 'GET', path: '/health' });

    // Act
    const res = await handler(req);

    // Assert
    expect(res.headers.get('content-type')).toBe('application/json');
  });
});

// ============================================================================
// Security headers
// ============================================================================

describe('Security headers', () => {
  let handler: (request: Request) => Promise<Response>;
  let cleanup: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ handler, cleanup } = createHttpHandler(
      makeMockMcpServer() as never,
      makeConfig(),
      alwaysLocalIp,
    ));
  });

  afterEach(() => {
    cleanup();
  });

  it('should set X-Content-Type-Options: nosniff on /health', async () => {
    const res = await handler(makeRequest({ path: '/health' }));
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('should set X-Frame-Options: DENY on /health', async () => {
    const res = await handler(makeRequest({ path: '/health' }));
    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });

  it('should set Cache-Control: no-store on /health', async () => {
    const res = await handler(makeRequest({ path: '/health' }));
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('should set security headers on OPTIONS preflight', async () => {
    const res = await handler(makeRequest({ method: 'OPTIONS', path: '/mcp' }));
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('should set security headers on 404 response', async () => {
    const res = await handler(makeRequest({ path: '/does-not-exist' }));
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

// ============================================================================
// CORS headers — no origins configured
// ============================================================================

describe('CORS — no allowedOrigins', () => {
  let handler: (request: Request) => Promise<Response>;
  let cleanup: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ handler, cleanup } = createHttpHandler(
      makeMockMcpServer() as never,
      makeConfig({ corsAllowedOrigins: [] }),
      alwaysLocalIp,
    ));
  });

  afterEach(() => {
    cleanup();
  });

  it('should NOT set Access-Control-Allow-Origin when no origins configured', async () => {
    const req = makeRequest({
      path: '/health',
      headers: { origin: 'https://example.com' },
    });
    const res = await handler(req);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('should NOT set CORS headers even when Origin header is present', async () => {
    const req = makeRequest({
      method: 'OPTIONS',
      path: '/mcp',
      headers: { origin: 'https://attacker.com' },
    });
    const res = await handler(req);
    expect(res.headers.get('access-control-allow-methods')).toBeNull();
  });
});

// ============================================================================
// CORS headers — exact origin matching
// ============================================================================

describe('CORS — exact origin matching', () => {
  let handler: (request: Request) => Promise<Response>;
  let cleanup: () => void;

  const allowedOrigins = ['https://app.example.com', 'https://other.example.com'];

  beforeEach(() => {
    vi.clearAllMocks();
    ({ handler, cleanup } = createHttpHandler(
      makeMockMcpServer() as never,
      makeConfig({ corsAllowedOrigins: allowedOrigins }),
      alwaysLocalIp,
    ));
  });

  afterEach(() => {
    cleanup();
  });

  it('should set Access-Control-Allow-Origin when origin matches', async () => {
    const req = makeRequest({
      path: '/health',
      headers: { origin: 'https://app.example.com' },
    });
    const res = await handler(req);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://app.example.com');
  });

  it('should set Vary: Origin when origin matches', async () => {
    const req = makeRequest({
      path: '/health',
      headers: { origin: 'https://app.example.com' },
    });
    const res = await handler(req);
    expect(res.headers.get('vary')).toBe('Origin');
  });

  it('should set Access-Control-Max-Age when origin matches', async () => {
    const req = makeRequest({
      path: '/health',
      headers: { origin: 'https://app.example.com' },
    });
    const res = await handler(req);
    expect(res.headers.get('access-control-max-age')).toBe('86400');
  });

  it('should NOT set Access-Control-Allow-Origin when origin does NOT match', async () => {
    const req = makeRequest({
      path: '/health',
      headers: { origin: 'https://not-allowed.com' },
    });
    const res = await handler(req);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('should NOT set Access-Control-Allow-Origin when no Origin header is sent', async () => {
    const req = makeRequest({ path: '/health' });
    const res = await handler(req);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('should allow the second configured origin as well', async () => {
    const req = makeRequest({
      path: '/health',
      headers: { origin: 'https://other.example.com' },
    });
    const res = await handler(req);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://other.example.com');
  });
});

// ============================================================================
// CORS headers — wildcard origin
// ============================================================================

describe('CORS — wildcard origin (*)', () => {
  let handler: (request: Request) => Promise<Response>;
  let cleanup: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ handler, cleanup } = createHttpHandler(
      makeMockMcpServer() as never,
      makeConfig({ corsAllowedOrigins: ['*'] }),
      alwaysLocalIp,
    ));
  });

  afterEach(() => {
    cleanup();
  });

  it('should set Access-Control-Allow-Origin: * for any origin', async () => {
    const req = makeRequest({
      path: '/health',
      headers: { origin: 'https://any.domain.com' },
    });
    const res = await handler(req);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('should set Access-Control-Allow-Origin: * even without an Origin header', async () => {
    const req = makeRequest({ path: '/health' });
    const res = await handler(req);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('should set Access-Control-Allow-Methods when wildcard is configured', async () => {
    const res = await handler(makeRequest({ path: '/health' }));
    expect(res.headers.get('access-control-allow-methods')).toBe('GET, POST, OPTIONS');
  });

  it('should NOT set Vary: Origin when wildcard is used', async () => {
    const req = makeRequest({
      path: '/health',
      headers: { origin: 'https://any.domain.com' },
    });
    const res = await handler(req);
    // Wildcard path skips Vary header
    expect(res.headers.get('vary')).toBeNull();
  });
});

// ============================================================================
// OPTIONS preflight
// ============================================================================

describe('OPTIONS preflight', () => {
  let handler: (request: Request) => Promise<Response>;
  let cleanup: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ handler, cleanup } = createHttpHandler(
      makeMockMcpServer() as never,
      makeConfig({ corsAllowedOrigins: ['https://app.example.com'] }),
      alwaysLocalIp,
    ));
  });

  afterEach(() => {
    cleanup();
  });

  it('should return 204 for OPTIONS request', async () => {
    const req = makeRequest({ method: 'OPTIONS', path: '/mcp' });
    const res = await handler(req);
    expect(res.status).toBe(204);
  });

  it('should return empty body for OPTIONS', async () => {
    const req = makeRequest({ method: 'OPTIONS', path: '/mcp' });
    const res = await handler(req);
    const text = await res.text();
    expect(text).toBe('');
  });

  it('should return Content-Length: 0 for OPTIONS', async () => {
    const req = makeRequest({ method: 'OPTIONS', path: '/mcp' });
    const res = await handler(req);
    expect(res.headers.get('content-length')).toBe('0');
  });

  it('should include CORS headers on OPTIONS when origin matches', async () => {
    const req = makeRequest({
      method: 'OPTIONS',
      path: '/mcp',
      headers: { origin: 'https://app.example.com' },
    });
    const res = await handler(req);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://app.example.com');
    expect(res.headers.get('access-control-allow-methods')).toBe('GET, POST, OPTIONS');
    expect(res.headers.get('access-control-allow-headers')).toBe('Content-Type');
  });

  it('should handle OPTIONS to /health as well', async () => {
    const req = makeRequest({ method: 'OPTIONS', path: '/health' });
    const res = await handler(req);
    expect(res.status).toBe(204);
  });
});

// ============================================================================
// Rate limiting
// ============================================================================

describe('Rate limiting', () => {
  let cleanup: () => void;

  afterEach(() => {
    cleanup?.();
  });

  it('should allow requests under the rate limit', async () => {
    // Arrange: generous limit so tests never trip it
    const { handler, cleanup: c } = createHttpHandler(
      makeMockMcpServer() as never,
      makeConfig({ rateLimitRpm: 100 }),
      alwaysLocalIp,
    );
    cleanup = c;

    // Act: 5 requests well under limit
    for (let i = 0; i < 5; i++) {
      const res = await handler(makeRequest({ path: '/health' }));
      expect(res.status).toBe(200);
    }
  });

  it('should return 429 when the rate limit is exceeded', async () => {
    // Arrange: limit of 2 RPM so we can exhaust quickly
    const { handler, cleanup: c } = createHttpHandler(
      makeMockMcpServer() as never,
      makeConfig({ rateLimitRpm: 2 }),
      alwaysLocalIp,
    );
    cleanup = c;

    // Exhaust bucket
    await handler(makeRequest({ path: '/health' }));
    await handler(makeRequest({ path: '/health' }));

    // Act: 3rd request exceeds limit
    const res = await handler(makeRequest({ path: '/health' }));

    // Assert
    expect(res.status).toBe(429);
    const body = await parseJson(res);
    expect(body.error).toBe('Too many requests');
  });

  it('should use a per-IP bucket — different IPs are not rate-limited together', async () => {
    // Arrange: limit of 1 per window
    let callCount = 0;
    const rotatingIp = (_req: Request): string => {
      callCount++;
      return `10.0.0.${callCount}`;
    };
    const { handler, cleanup: c } = createHttpHandler(
      makeMockMcpServer() as never,
      makeConfig({ rateLimitRpm: 1 }),
      rotatingIp,
    );
    cleanup = c;

    // Act: 5 requests, each from a different IP
    for (let i = 0; i < 5; i++) {
      const res = await handler(makeRequest({ path: '/health' }));
      // Each unique IP gets its own bucket → all should pass
      expect(res.status).toBe(200);
    }
  });

  it('should apply rate limiting BEFORE health check processing', async () => {
    // Arrange: limit of 1
    const { handler, cleanup: c } = createHttpHandler(
      makeMockMcpServer() as never,
      makeConfig({ rateLimitRpm: 1 }),
      alwaysLocalIp,
    );
    cleanup = c;

    // Exhaust
    await handler(makeRequest({ path: '/health' }));

    // Act: next health request hits rate limiter first
    const res = await handler(makeRequest({ path: '/health' }));

    // Assert: 429 returned even for a valid endpoint
    expect(res.status).toBe(429);
  });
});

// ============================================================================
// Body size limiting
// ============================================================================

describe('/mcp — body size limit', () => {
  let handler: (request: Request) => Promise<Response>;
  let cleanup: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    shared.mcpTransportInstance.handleRequest.mockResolvedValue(
      new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    shared.mcpTransportInstance.close.mockResolvedValue(undefined);

    ({ handler, cleanup } = createHttpHandler(
      makeMockMcpServer() as never,
      makeConfig({ maxBodySize: 100 }), // tiny limit for testing
      alwaysLocalIp,
    ));
  });

  afterEach(() => {
    cleanup();
  });

  it('should return 413 when Content-Length header exceeds maxBodySize', async () => {
    // Arrange: Content-Length says 200 bytes, limit is 100
    const req = makeRequest({
      method: 'POST',
      path: '/mcp',
      headers: {
        'content-type': 'application/json',
        'content-length': '200',
      },
      body: 'x'.repeat(50), // actual body doesn't matter — header check fires first
    });

    // Act
    const res = await handler(req);

    // Assert
    expect(res.status).toBe(413);
    const body = await parseJson(res);
    expect(body.error).toBe('Payload too large');
  });

  it('should return 413 when actual body size exceeds maxBodySize', async () => {
    // Arrange: no Content-Length header; body check fires on actual read
    const bigBody = 'x'.repeat(200); // 200 chars > 100 byte limit
    const req = new Request('http://localhost/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: bigBody,
    });

    // Act
    const res = await handler(req);

    // Assert
    expect(res.status).toBe(413);
    const body = await parseJson(res);
    expect(body.error).toBe('Payload too large');
  });

  it('should NOT return 413 for a body within the size limit', async () => {
    // Arrange: body well under the 100-byte limit
    const smallBody = JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 });
    // smallBody is ~47 chars — under limit

    const req = makeRequest({
      method: 'POST',
      path: '/mcp',
      headers: { 'content-type': 'application/json' },
      body: smallBody,
    });

    // Act
    const res = await handler(req);

    // Assert: not 413
    expect(res.status).not.toBe(413);
  });
});

// ============================================================================
// /mcp endpoint — request forwarding
// ============================================================================

describe('/mcp endpoint — JSON-RPC forwarding', () => {
  let mockMcpServer: { connect: ReturnType<typeof vi.fn> };
  let handler: (request: Request) => Promise<Response>;
  let cleanup: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMcpServer = makeMockMcpServer();

    shared.mcpTransportInstance.handleRequest.mockResolvedValue(
      new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    shared.mcpTransportInstance.close.mockResolvedValue(undefined);

    ({ handler, cleanup } = createHttpHandler(
      mockMcpServer as never,
      makeConfig(),
      alwaysLocalIp,
    ));
  });

  afterEach(() => {
    cleanup();
  });

  it('should return 200 for valid JSON-RPC POST to /mcp', async () => {
    // Arrange
    const body = JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 });
    const req = makeRequest({
      method: 'POST',
      path: '/mcp',
      headers: { 'content-type': 'application/json' },
      body,
    });

    // Act
    const res = await handler(req);

    // Assert
    expect(res.status).toBe(200);
  });

  it('should call mcpServer.connect before forwarding the request', async () => {
    // Arrange
    const body = JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 });
    const req = makeRequest({
      method: 'POST',
      path: '/mcp',
      headers: { 'content-type': 'application/json' },
      body,
    });

    // Act
    await handler(req);

    // Assert
    expect(mockMcpServer.connect).toHaveBeenCalledTimes(1);
  });

  it('should call transport.handleRequest to process the MCP message', async () => {
    // Arrange
    const body = JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 });
    const req = makeRequest({
      method: 'POST',
      path: '/mcp',
      headers: { 'content-type': 'application/json' },
      body,
    });

    // Act
    await handler(req);

    // Assert
    expect(shared.mcpTransportInstance.handleRequest).toHaveBeenCalledTimes(1);
  });

  it('should call transport.close after handling the request', async () => {
    // Arrange
    const body = JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 });
    const req = makeRequest({
      method: 'POST',
      path: '/mcp',
      headers: { 'content-type': 'application/json' },
      body,
    });

    // Act
    await handler(req);

    // Assert
    expect(shared.mcpTransportInstance.close).toHaveBeenCalledTimes(1);
  });

  it('should close transport even after a handler error (finally block)', async () => {
    // Arrange: transport.handleRequest throws
    shared.mcpTransportInstance.handleRequest.mockRejectedValueOnce(
      new Error('Transport failure')
    );
    const body = JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 });
    const req = makeRequest({
      method: 'POST',
      path: '/mcp',
      headers: { 'content-type': 'application/json' },
      body,
    });

    // Act
    const res = await handler(req);

    // Assert: 500 error returned AND transport was still closed
    expect(res.status).toBe(500);
    expect(shared.mcpTransportInstance.close).toHaveBeenCalledTimes(1);
  });

  it('should return 400 for invalid JSON body', async () => {
    // Arrange
    const req = makeRequest({
      method: 'POST',
      path: '/mcp',
      headers: { 'content-type': 'application/json' },
      body: '{invalid json{{',
    });

    // Act
    const res = await handler(req);

    // Assert
    expect(res.status).toBe(400);
    const body = await parseJson(res);
    expect(body.error).toBe('Invalid JSON in request body');
  });

  it('should forward empty body to transport without parsing error', async () => {
    // Arrange: POST /mcp with no body (empty string body)
    shared.mcpTransportInstance.handleRequest.mockResolvedValueOnce(
      new Response(null, { status: 200 })
    );
    const req = new Request('http://localhost/mcp', {
      method: 'POST',
    });

    // Act
    const res = await handler(req);

    // Assert: empty body is handled gracefully (no 400)
    expect(res.status).toBe(200);
  });

  it('should return 500 when transport.handleRequest throws', async () => {
    // Arrange
    shared.mcpTransportInstance.handleRequest.mockRejectedValueOnce(
      new Error('Unexpected transport error')
    );
    const body = JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 });
    const req = makeRequest({
      method: 'POST',
      path: '/mcp',
      headers: { 'content-type': 'application/json' },
      body,
    });

    // Act
    const res = await handler(req);

    // Assert
    expect(res.status).toBe(500);
    const resBody = await parseJson(res);
    expect(resBody.error).toBe('Internal server error');
  });
});

// ============================================================================
// /mcp — CORS headers propagated to transport response
// ============================================================================

describe('/mcp — CORS headers on transport response', () => {
  let handler: (request: Request) => Promise<Response>;
  let cleanup: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    shared.mcpTransportInstance.handleRequest.mockResolvedValue(
      new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    shared.mcpTransportInstance.close.mockResolvedValue(undefined);

    ({ handler, cleanup } = createHttpHandler(
      makeMockMcpServer() as never,
      makeConfig({ corsAllowedOrigins: ['https://app.example.com'] }),
      alwaysLocalIp,
    ));
  });

  afterEach(() => {
    cleanup();
  });

  it('should add CORS headers to the transport response when origin matches', async () => {
    // Arrange
    const body = JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 });
    const req = makeRequest({
      method: 'POST',
      path: '/mcp',
      headers: {
        'content-type': 'application/json',
        origin: 'https://app.example.com',
      },
      body,
    });

    // Act
    const res = await handler(req);

    // Assert
    expect(res.headers.get('access-control-allow-origin')).toBe('https://app.example.com');
  });

  it('should add security headers to the transport response', async () => {
    // Arrange
    const body = JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 });
    const req = makeRequest({
      method: 'POST',
      path: '/mcp',
      headers: { 'content-type': 'application/json' },
      body,
    });

    // Act
    const res = await handler(req);

    // Assert
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});

// ============================================================================
// /llms.txt endpoint
// ============================================================================

describe('/llms.txt endpoint', () => {
  let handler: (request: Request) => Promise<Response>;
  let cleanup: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ handler, cleanup } = createHttpHandler(
      makeMockMcpServer() as never,
      makeConfig(),
      alwaysLocalIp,
    ));
  });

  afterEach(() => {
    cleanup();
  });

  it('should return 200 for GET /llms.txt', async () => {
    const res = await handler(makeRequest({ path: '/llms.txt' }));
    expect(res.status).toBe(200);
  });

  it('should set Content-Type: text/plain for /llms.txt', async () => {
    const res = await handler(makeRequest({ path: '/llms.txt' }));
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
  });

  it('should return Jamf Docs content in the body', async () => {
    const res = await handler(makeRequest({ path: '/llms.txt' }));
    const text = await res.text();
    expect(text).toContain('Jamf Docs MCP Server');
  });
});

// ============================================================================
// 404 fallback
// ============================================================================

describe('404 fallback', () => {
  let handler: (request: Request) => Promise<Response>;
  let cleanup: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ handler, cleanup } = createHttpHandler(
      makeMockMcpServer() as never,
      makeConfig(),
      alwaysLocalIp,
    ));
  });

  afterEach(() => {
    cleanup();
  });

  it('should return 404 for an unknown GET path', async () => {
    const res = await handler(makeRequest({ path: '/unknown-route' }));
    expect(res.status).toBe(404);
  });

  it('should return JSON body with error "Not found"', async () => {
    const res = await handler(makeRequest({ path: '/unknown-route' }));
    const body = await parseJson(res);
    expect(body.error).toBe('Not found');
  });

  it('should return 404 for POST to an unrecognised path', async () => {
    const res = await handler(makeRequest({ method: 'POST', path: '/api/v1/wrong' }));
    expect(res.status).toBe(404);
  });
});

// ============================================================================
// Host Header Injection protection
// ============================================================================

describe('Host Header Injection protection', () => {
  let handler: (request: Request) => Promise<Response>;
  let cleanup: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ handler, cleanup } = createHttpHandler(
      makeMockMcpServer() as never,
      makeConfig(),
      alwaysLocalIp,
    ));
  });

  afterEach(() => {
    cleanup();
  });

  it('should route /health correctly regardless of Host header', async () => {
    const req = new Request('http://evil.com/health', {
      method: 'GET',
      headers: { host: 'evil.com' },
    });
    const res = await handler(req);
    expect(res.status).toBe(200);
    const body = await parseJson(res);
    expect(body.status).toBe('ok');
  });

  it('should return 404 for unknown path even with crafted Host header', async () => {
    const req = new Request('http://attacker.com:8080/unknown', {
      method: 'GET',
      headers: { host: 'attacker.com:8080' },
    });
    const res = await handler(req);
    expect(res.status).toBe(404);
  });
});
