/**
 * Unit tests for HTTP transport (src/transport/http.ts)
 *
 * Strategy: mock node:http's createServer to capture the request handler,
 * then invoke the captured handler with mock IncomingMessage / ServerResponse
 * objects to verify routing, body collection, and response writing.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';

// ============================================================================
// Hoisted shared state so vi.mock factories can reference it
// ============================================================================

const shared = vi.hoisted(() => ({
  capturedHandler: undefined as
    | ((req: IncomingMessage, res: ServerResponse) => void)
    | undefined,
  httpServer: {
    listen: vi.fn(),
    close: vi.fn(),
    on: vi.fn(),
  },
  mcpTransportInstance: {
    handleRequest: vi.fn(),
    close: vi.fn(),
  },
}));

// ============================================================================
// Mocks — must come before any import of the module under test
// ============================================================================

vi.mock('node:http', () => ({
  createServer: vi.fn((handler: (req: IncomingMessage, res: ServerResponse) => void) => {
    shared.capturedHandler = handler;
    return shared.httpServer;
  }),
  IncomingMessage: class {},
  ServerResponse: class {},
}));

vi.mock('@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js', () => ({
  // Must use a regular function (not arrow) so `new` works correctly in Vitest v4
  WebStandardStreamableHTTPServerTransport: vi.fn(function () {
    return shared.mcpTransportInstance;
  }),
}));

vi.mock('../../../src/constants.js', () => ({
  SERVER_VERSION: '1.0.0-test',
  getEnvNumber: (_key: string, defaultValue: number) => defaultValue,
}));

// Import the module under test AFTER all mocks are registered
import { startHttpServer } from '../../../src/transport/http.js';

// ============================================================================
// Helpers
// ============================================================================

type MockHeaders = Record<string, string | string[]>;

function createMockReq(options: {
  method?: string;
  url?: string;
  headers?: MockHeaders;
  body?: string | Buffer;
  largeBody?: boolean;
} = {}): IncomingMessage {
  const { method = 'GET', url = '/', headers = {}, body, largeBody = false } = options;

  const readable = new Readable({ read() {} });
  Object.defineProperty(readable, 'method', { value: method, writable: true });
  Object.defineProperty(readable, 'url', { value: url, writable: true });
  Object.defineProperty(readable, 'headers', {
    value: { host: 'localhost', ...headers },
    writable: true,
  });

  if (largeBody) {
    // Push 2 MB — exceeds the 1 MB limit in collectBody
    readable.push(Buffer.alloc(2 * 1024 * 1024, 'x'));
  } else if (body !== undefined) {
    readable.push(typeof body === 'string' ? Buffer.from(body) : body);
  }
  readable.push(null);

  return readable as unknown as IncomingMessage;
}

interface CapturedResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

/**
 * Returns a mock ServerResponse and a promise that resolves once res.end() is called.
 */
function createCapturingRes(): { res: ServerResponse; done: Promise<CapturedResponse> } {
  let statusCode = 200;
  const headers: Record<string, string> = {};
  let body = '';
  let endResolve!: (value: CapturedResponse) => void;

  const done = new Promise<CapturedResponse>((resolve) => {
    endResolve = resolve;
  });

  const res = {
    writeHead: vi.fn((code: number, hdrs?: Record<string, string>) => {
      statusCode = code;
      if (hdrs) Object.assign(headers, hdrs);
    }),
    write: vi.fn((data: Buffer | string | Uint8Array) => {
      if (typeof data === 'string') {
        body += data;
      } else {
        body += Buffer.from(data).toString('utf8');
      }
    }),
    end: vi.fn((data?: string | Buffer | Uint8Array) => {
      if (data !== undefined && data !== null) {
        body += typeof data === 'string' ? data : Buffer.from(data).toString('utf8');
      }
      endResolve({ statusCode, headers, body });
    }),
    headersSent: false,
  };

  return { res: res as unknown as ServerResponse, done };
}

/**
 * Invoke the captured request handler and wait for res.end() to be called.
 */
async function makeRequest(options: {
  method?: string;
  url?: string;
  headers?: MockHeaders;
  body?: string | Buffer;
  largeBody?: boolean;
}): Promise<CapturedResponse> {
  if (shared.capturedHandler === undefined) {
    throw new Error('No request handler captured — was startHttpServer called?');
  }
  const req = createMockReq(options);
  const { res, done } = createCapturingRes();
  shared.capturedHandler(req, res);
  return done;
}

// ============================================================================
// startHttpServer tests
// ============================================================================

describe('startHttpServer', () => {
  let mockMcpServer: { connect: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    mockMcpServer = { connect: vi.fn().mockResolvedValue(undefined) };

    // Simulate successful bind: listen calls its callback synchronously
    shared.httpServer.listen.mockImplementation(
      (_port: number, _host: string, cb: () => void) => cb()
    );
    shared.httpServer.on.mockImplementation(() => {});
  });

  it('should resolve when the server starts listening', async () => {
    await expect(
      startHttpServer(mockMcpServer as any, 3000, '127.0.0.1')
    ).resolves.toBeUndefined();
  });

  it('should call listen with the given port and host', async () => {
    await startHttpServer(mockMcpServer as any, 4321, '127.0.0.1');
    expect(shared.httpServer.listen).toHaveBeenCalledWith(4321, '127.0.0.1', expect.any(Function));
  });

  it('should log security warning when binding to non-loopback host', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await startHttpServer(mockMcpServer as any, 3000, '0.0.0.0');

    const warningLogged = consoleSpy.mock.calls.some((args) =>
      String(args[0]).includes('SECURITY WARNING')
    );
    expect(warningLogged).toBe(true);
    consoleSpy.mockRestore();
  });

  it('should NOT log security warning when binding to 127.0.0.1', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await startHttpServer(mockMcpServer as any, 3000, '127.0.0.1');

    const warningLogged = consoleSpy.mock.calls.some((args) =>
      String(args[0]).includes('SECURITY WARNING')
    );
    expect(warningLogged).toBe(false);
    consoleSpy.mockRestore();
  });

  it('should NOT log security warning when binding to ::1', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await startHttpServer(mockMcpServer as any, 3000, '::1');

    const warningLogged = consoleSpy.mock.calls.some((args) =>
      String(args[0]).includes('SECURITY WARNING')
    );
    expect(warningLogged).toBe(false);
    consoleSpy.mockRestore();
  });

  it('should register an error handler on the HTTP server', async () => {
    await startHttpServer(mockMcpServer as any, 3000, '127.0.0.1');
    expect(shared.httpServer.on).toHaveBeenCalledWith('error', expect.any(Function));
  });
});

// ============================================================================
// /health endpoint
// ============================================================================

describe('/health endpoint', () => {
  let mockMcpServer: { connect: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockMcpServer = { connect: vi.fn().mockResolvedValue(undefined) };
    shared.httpServer.listen.mockImplementation(
      (_port: number, _host: string, cb: () => void) => cb()
    );
    shared.httpServer.on.mockImplementation(() => {});
    await startHttpServer(mockMcpServer as any, 3000, '127.0.0.1');
  });

  it('should return 200 OK with status "ok" for GET /health', async () => {
    const result = await makeRequest({ method: 'GET', url: '/health' });
    expect(result.statusCode).toBe(200);
    const data = JSON.parse(result.body);
    expect(data.status).toBe('ok');
  });

  it('should include version in health response', async () => {
    const result = await makeRequest({ method: 'GET', url: '/health' });
    const data = JSON.parse(result.body);
    expect(data.version).toBe('1.0.0-test');
  });

  it('should set Content-Type: application/json for /health', async () => {
    const result = await makeRequest({ method: 'GET', url: '/health' });
    expect(result.headers['Content-Type']).toBe('application/json');
  });
});

// ============================================================================
// 404 for unknown paths
// ============================================================================

describe('unknown path → 404', () => {
  let mockMcpServer: { connect: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockMcpServer = { connect: vi.fn().mockResolvedValue(undefined) };
    shared.httpServer.listen.mockImplementation(
      (_port: number, _host: string, cb: () => void) => cb()
    );
    shared.httpServer.on.mockImplementation(() => {});
    await startHttpServer(mockMcpServer as any, 3000, '127.0.0.1');
  });

  it('should return 404 for an unknown path', async () => {
    const result = await makeRequest({ method: 'GET', url: '/unknown-route' });
    expect(result.statusCode).toBe(404);
  });

  it('should return JSON body with error "Not found" for unknown paths', async () => {
    const result = await makeRequest({ method: 'GET', url: '/api/v1/does-not-exist' });
    const data = JSON.parse(result.body);
    expect(data.error).toBe('Not found');
  });

  it('should return 404 for POST to a non-existent endpoint', async () => {
    const result = await makeRequest({ method: 'POST', url: '/wrong-endpoint' });
    expect(result.statusCode).toBe(404);
  });
});

// ============================================================================
// /mcp endpoint — body size enforcement
// ============================================================================

describe('/mcp endpoint — payload size', () => {
  let mockMcpServer: { connect: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockMcpServer = { connect: vi.fn().mockResolvedValue(undefined) };
    shared.httpServer.listen.mockImplementation(
      (_port: number, _host: string, cb: () => void) => cb()
    );
    shared.httpServer.on.mockImplementation(() => {});
    shared.mcpTransportInstance.handleRequest.mockResolvedValue(
      new Response(null, { status: 200 })
    );
    shared.mcpTransportInstance.close.mockResolvedValue(undefined);
    await startHttpServer(mockMcpServer as any, 3000, '127.0.0.1');
  });

  it('should return 413 when body exceeds 1 MB', async () => {
    const result = await makeRequest({ method: 'POST', url: '/mcp', largeBody: true });
    expect(result.statusCode).toBe(413);
    const data = JSON.parse(result.body);
    expect(data.error).toBe('Payload too large');
  });

  it('should return 400 for invalid JSON body', async () => {
    const result = await makeRequest({
      method: 'POST',
      url: '/mcp',
      headers: { 'content-type': 'application/json' },
      body: '{invalid json{{',
    });
    expect(result.statusCode).toBe(400);
    const data = JSON.parse(result.body);
    expect(data.error).toBe('Invalid JSON in request body');
  });
});

// ============================================================================
// /mcp endpoint — request handling
// ============================================================================

describe('/mcp endpoint — valid requests', () => {
  let mockMcpServer: { connect: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockMcpServer = { connect: vi.fn().mockResolvedValue(undefined) };
    shared.httpServer.listen.mockImplementation(
      (_port: number, _host: string, cb: () => void) => cb()
    );
    shared.httpServer.on.mockImplementation(() => {});
    // Default transport response: 200 with JSON body (exercises writeWebResponse body path)
    shared.mcpTransportInstance.handleRequest.mockResolvedValue(
      new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    shared.mcpTransportInstance.close.mockResolvedValue(undefined);
    await startHttpServer(mockMcpServer as any, 3000, '127.0.0.1');
  });

  it('should handle valid JSON-RPC POST to /mcp and return 200', async () => {
    const body = JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 });
    const result = await makeRequest({
      method: 'POST',
      url: '/mcp',
      headers: { 'content-type': 'application/json' },
      body,
    });
    expect(result.statusCode).toBe(200);
  });

  it('should connect McpServer to the transport before handling', async () => {
    const body = JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 });
    await makeRequest({
      method: 'POST',
      url: '/mcp',
      headers: { 'content-type': 'application/json' },
      body,
    });
    expect(mockMcpServer.connect).toHaveBeenCalled();
  });

  it('should close the transport after handling the request', async () => {
    const body = JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 });
    await makeRequest({
      method: 'POST',
      url: '/mcp',
      headers: { 'content-type': 'application/json' },
      body,
    });
    expect(shared.mcpTransportInstance.close).toHaveBeenCalled();
  });

  it('should handle empty body (no parsedBody) without returning 400', async () => {
    // Reset the transport to return null body for simplicity
    shared.mcpTransportInstance.handleRequest.mockResolvedValue(
      new Response(null, { status: 200 })
    );

    const result = await makeRequest({ method: 'POST', url: '/mcp' });
    // Empty body skips JSON parse → calls transport → 200
    expect(result.statusCode).toBe(200);
  });

  it('should handle requests with array-valued headers (exercises toWebRequest array path)', async () => {
    const body = JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 2 });
    const result = await makeRequest({
      method: 'POST',
      url: '/mcp',
      headers: {
        'content-type': 'application/json',
        'accept': ['application/json', 'text/plain'], // Array header value
      },
      body,
    });
    expect(result.statusCode).toBe(200);
  });

  it('should return 200 even for GET /mcp (no body → skips JSON parse)', async () => {
    shared.mcpTransportInstance.handleRequest.mockResolvedValue(
      new Response(null, { status: 200 })
    );
    const result = await makeRequest({ method: 'GET', url: '/mcp' });
    expect(result.statusCode).toBe(200);
  });
});

// ============================================================================
// /mcp endpoint — response writing (writeWebResponse paths)
// ============================================================================

describe('/mcp endpoint — writeWebResponse', () => {
  let mockMcpServer: { connect: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockMcpServer = { connect: vi.fn().mockResolvedValue(undefined) };
    shared.httpServer.listen.mockImplementation(
      (_port: number, _host: string, cb: () => void) => cb()
    );
    shared.httpServer.on.mockImplementation(() => {});
    shared.mcpTransportInstance.close.mockResolvedValue(undefined);
    await startHttpServer(mockMcpServer as any, 3000, '127.0.0.1');
  });

  it('should call res.end() directly for null-body response', async () => {
    shared.mcpTransportInstance.handleRequest.mockResolvedValue(
      new Response(null, { status: 204 })
    );
    const result = await makeRequest({ method: 'POST', url: '/mcp' });
    expect(result.statusCode).toBe(204);
  });

  it('should stream response body via res.write() + res.end() for non-null body', async () => {
    const responseBody = JSON.stringify({ result: 'streamed' });
    shared.mcpTransportInstance.handleRequest.mockResolvedValue(
      new Response(responseBody, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const result = await makeRequest({
      method: 'POST',
      url: '/mcp',
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 3 }),
    });
    expect(result.statusCode).toBe(200);
    // The response body should contain the streamed content
    expect(result.body).toContain('streamed');
  });
});

// ============================================================================
// Host Header Injection protection
// ============================================================================

describe('Host Header Injection protection', () => {
  let mockMcpServer: { connect: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockMcpServer = { connect: vi.fn().mockResolvedValue(undefined) };
    shared.httpServer.listen.mockImplementation(
      (_port: number, _host: string, cb: () => void) => cb()
    );
    shared.httpServer.on.mockImplementation(() => {});
    shared.mcpTransportInstance.handleRequest.mockResolvedValue(
      new Response(null, { status: 200 })
    );
    shared.mcpTransportInstance.close.mockResolvedValue(undefined);
    await startHttpServer(mockMcpServer as any, 3000, '127.0.0.1');
  });

  it('should route correctly regardless of Host header value', async () => {
    const result = await makeRequest({
      method: 'GET',
      url: '/health',
      headers: { host: 'evil.com' },
    });
    expect(result.statusCode).toBe(200);
    const data = JSON.parse(result.body);
    expect(data.status).toBe('ok');
  });

  it('should return 404 for unknown paths even with crafted Host header', async () => {
    const result = await makeRequest({
      method: 'GET',
      url: '/unknown',
      headers: { host: 'attacker.com:8080' },
    });
    expect(result.statusCode).toBe(404);
  });
});

// ============================================================================
// CORS headers
// ============================================================================

describe('CORS headers', () => {
  let mockMcpServer: { connect: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockMcpServer = { connect: vi.fn().mockResolvedValue(undefined) };
    shared.httpServer.listen.mockImplementation(
      (_port: number, _host: string, cb: () => void) => cb()
    );
    shared.httpServer.on.mockImplementation(() => {});
    shared.mcpTransportInstance.handleRequest.mockResolvedValue(
      new Response(null, { status: 200 })
    );
    shared.mcpTransportInstance.close.mockResolvedValue(undefined);
    await startHttpServer(mockMcpServer as any, 3000, '127.0.0.1');
  });

  it('should return 204 for OPTIONS preflight requests', async () => {
    const result = await makeRequest({ method: 'OPTIONS', url: '/mcp' });
    expect(result.statusCode).toBe(204);
  });

  it('should not include Access-Control-Allow-Origin when no origins configured', async () => {
    // By default CORS_ALLOWED_ORIGINS is empty
    const result = await makeRequest({ method: 'GET', url: '/health' });
    expect(result.headers['Access-Control-Allow-Origin']).toBeUndefined();
  });
});

// ============================================================================
// Rate limiting
// ============================================================================

describe('Rate limiting', () => {
  let mockMcpServer: { connect: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockMcpServer = { connect: vi.fn().mockResolvedValue(undefined) };
    shared.httpServer.listen.mockImplementation(
      (_port: number, _host: string, cb: () => void) => cb()
    );
    shared.httpServer.on.mockImplementation(() => {});
    shared.mcpTransportInstance.handleRequest.mockResolvedValue(
      new Response(null, { status: 200 })
    );
    shared.mcpTransportInstance.close.mockResolvedValue(undefined);
    await startHttpServer(mockMcpServer as any, 3000, '127.0.0.1');
  });

  it('should allow normal request rate', async () => {
    // First few requests should all succeed
    for (let i = 0; i < 5; i++) {
      const result = await makeRequest({ method: 'GET', url: '/health' });
      expect(result.statusCode).toBe(200);
    }
  });
});
