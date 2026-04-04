/**
 * Node.js HTTP server adapter
 *
 * Bridges the platform-agnostic HTTP handler with Node.js `node:http`.
 * All Node.js-specific code (IncomingMessage, ServerResponse, process,
 * Buffer, env vars) is isolated here.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { createHttpHandler } from '../../transport/http-handler.js';
import { createStderrLogger } from '../../core/services/logging.js';
import { createNodeConfig, getEnvNumber } from './config.js';
import type { HttpHandlerConfig, ClientIpExtractor } from '../../transport/http-types.js';
import { DEFAULT_HTTP_CONFIG } from '../../transport/http-types.js';

const log = createStderrLogger('http');

// ============================================================================
// Node.js request / response conversion
// ============================================================================

/**
 * Convert Node.js IncomingMessage to a Web Standard Request.
 *
 * Injects the resolved client IP as an `X-Real-IP` header so the
 * platform-agnostic handler can extract it without Node.js APIs.
 */
function toWebRequest(
  req: IncomingMessage,
  body: Buffer,
  url: URL,
  clientIp: string,
): Request {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value !== undefined) {
      if (Array.isArray(value)) {
        for (const v of value) {
          headers.append(key, v);
        }
      } else {
        headers.set(key, value);
      }
    }
  }

  // Inject resolved client IP for the platform-agnostic handler
  headers.set('x-real-ip', clientIp);

  const method = req.method ?? 'GET';

  const init: RequestInit = {
    method,
    headers,
  };

  // Only add body for methods that support it
  if (method !== 'GET' && method !== 'HEAD' && method !== 'DELETE') {
    init.body = body;
  }

  return new Request(url.toString(), init);
}

/**
 * Write a Web Standard Response back to Node.js ServerResponse.
 */
async function writeWebResponse(
  webRes: Response,
  res: ServerResponse,
): Promise<void> {
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

/**
 * Collect request body from IncomingMessage into a Buffer.
 * Enforces a maximum body size to prevent memory exhaustion.
 */
async function collectBody(req: IncomingMessage, maxBodySize: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let totalSize = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer);
    totalSize += buf.length;
    if (totalSize > maxBodySize) {
      throw new Error('Payload too large');
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

// ============================================================================
// Client IP extraction (Node.js-specific)
// ============================================================================

/**
 * Get client IP from Node.js IncomingMessage.
 * Only trusts X-Forwarded-For when TRUST_PROXY is enabled.
 */
function getNodeClientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      const ips = forwarded.split(',').map(s => s.trim()).filter(Boolean);
      return ips[ips.length - 1] ?? 'unknown';
    }
  }
  // socket may be undefined in test environments
  const socket = req.socket as { remoteAddress?: string } | undefined;
  return socket?.remoteAddress ?? 'unknown';
}

// ============================================================================
// Configuration from environment
// ============================================================================

function buildConfig(): HttpHandlerConfig {
  const nodeConfig = createNodeConfig();
  const corsAllowedOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const trustProxy =
    process.env.TRUST_PROXY === 'true' || process.env.TRUST_PROXY === '1';

  const rateLimitRpm = getEnvNumber('RATE_LIMIT_RPM', 60, 1, 10000);

  return {
    ...DEFAULT_HTTP_CONFIG,
    serverVersion: nodeConfig.version,
    corsAllowedOrigins,
    trustProxy,
    rateLimitRpm,
  };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Create and start an HTTP server for the MCP server (Node.js platform).
 */
export async function startHttpServer(
  mcpServer: McpServer,
  port: number,
  host: string,
): Promise<void> {
  const config = buildConfig();

  // Platform-specific IP extractor: reads from X-Real-IP header
  // that we inject in toWebRequest
  const getClientIp: ClientIpExtractor = (request: Request): string => {
    return request.headers.get('x-real-ip') ?? 'unknown';
  };

  const { handler, cleanup } = createHttpHandler(mcpServer, config, getClientIp, log);

  const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    void handleNodeRequest(req, res, handler, config);
  });

  // Graceful shutdown
  let shuttingDown = false;

  function shutdown(signal: string): void {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    log.info(`${signal} received, shutting down...`);

    cleanup();

    httpServer.close(() => {
      log.info('HTTP server closed');
      process.exit(0);
    });

    // Force exit after timeout
    setTimeout(() => {
      log.warning('Shutdown timeout, forcing exit');
      process.exit(1);
    }, config.shutdownTimeoutMs);
  }

  process.on('SIGINT', () => { shutdown('SIGINT'); });
  process.on('SIGTERM', () => { shutdown('SIGTERM'); });

  // Start listening
  await new Promise<void>((resolve, reject) => {
    httpServer.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        log.error(`Port ${port} is already in use`);
        process.exit(1);
      }
      reject(error);
    });

    httpServer.listen(port, host, () => {
      if (host !== '127.0.0.1' && host !== '::1') {
        log.warning(
          `Server is binding to ${host}, which exposes it to the network. `
          + 'Use 127.0.0.1 for local-only access.',
        );
      }
      log.info(`Jamf Docs MCP Server running on http://${host}:${port}`);
      log.info(`MCP endpoint: http://${host}:${port}/mcp`);
      log.info(`Health check: http://${host}:${port}/health`);
      log.info(`LLMs info:   http://${host}:${port}/llms.txt`);
      resolve();
    });
  });
}

// ============================================================================
// Node.js request handler bridge
// ============================================================================

/**
 * Bridge a single Node.js HTTP request into the platform-agnostic handler.
 */
async function handleNodeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  handler: (request: Request) => Promise<Response>,
  config: HttpHandlerConfig,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');

  // Resolve client IP at the Node.js layer
  const clientIp = getNodeClientIp(req, config.trustProxy);

  // For methods that carry a body, collect it; otherwise use empty Buffer
  const method = req.method ?? 'GET';
  let body: Buffer;
  if (method !== 'GET' && method !== 'HEAD' && method !== 'DELETE' && method !== 'OPTIONS') {
    try {
      body = await collectBody(req, config.maxBodySize);
    } catch {
      // Body too large — send 413, then destroy to stop reading remaining data
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Payload too large' }), () => {
        req.destroy();
      });
      return;
    }
  } else {
    body = Buffer.alloc(0);
  }

  // Convert to Web Standard Request
  const webReq = toWebRequest(req, body, url, clientIp);

  try {
    const webRes = await handler(webReq);
    await writeWebResponse(webRes, res);
  } catch {
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }
}
