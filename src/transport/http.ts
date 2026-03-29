/**
 * HTTP transport using Web Standard APIs
 *
 * Uses WebStandardStreamableHTTPServerTransport from the SDK,
 * compatible with Node.js, Cloudflare Workers, Deno, and Bun.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { SERVER_VERSION, getEnvNumber } from '../constants.js';
import { createLogger } from '../services/logging.js';

const log = createLogger('http');

const SHUTDOWN_TIMEOUT = 10_000;
const MAX_BODY_SIZE = 1_048_576; // 1MB

const LLMS_TXT = `# Jamf Docs MCP Server

> MCP server providing access to official Jamf documentation from learn.jamf.com

## Products
- Jamf Pro — Apple device management for enterprise
- Jamf School — Apple device management for education
- Jamf Connect — identity and access management
- Jamf Protect — endpoint security for Apple
- Jamf Now — simple device management for small businesses
- Jamf Safe Internet — content filtering and web security
- Jamf Insights — analytics and reporting for Apple fleet
- RapidIdentity — identity and access management platform

## Tools
- jamf_docs_list_products: discover available products and versions
- jamf_docs_search: search documentation by keyword with product/topic filters
- jamf_docs_get_article: retrieve full article content in markdown
- jamf_docs_get_toc: browse table of contents for a product
- jamf_docs_glossary_lookup: look up glossary terms with fuzzy matching
- jamf_docs_batch_get_articles: retrieve multiple articles in a single request

## Resources
- jamf://products — product list with metadata and versions
- jamf://topics — topic categories per product
- jamf://products/{productId}/toc — table of contents for a specific product
- jamf://products/{productId}/versions — available documentation versions

## Prompts
- jamf_troubleshoot: guided troubleshooting workflow
- jamf_setup_guide: step-by-step setup instructions
- jamf_compare_versions: compare features across versions

## Supported Locales
en-US, ja-JP, zh-TW, de-DE, es-ES, fr-FR, nl-NL, th-TH

## Limitations
- Documentation content only — no Jamf REST API reference
- Content is sourced from learn.jamf.com and cached; not real-time
`;

class PayloadTooLargeError extends Error {
  constructor() {
    super('Payload too large');
    this.name = 'PayloadTooLargeError';
  }
}

// CORS configuration
const CORS_ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean);

// Trust reverse proxy headers (X-Forwarded-For) only when explicitly enabled
const TRUST_PROXY = process.env.TRUST_PROXY === 'true' || process.env.TRUST_PROXY === '1';

// Maximum unique IPs tracked by rate limiter to prevent memory exhaustion
const MAX_RATE_LIMIT_BUCKETS = 10_000;

/**
 * Token bucket rate limiter (per-IP)
 */
class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; lastRefill: number }>();
  private readonly maxTokens: number;
  private readonly windowMs: number;
  private readonly maxBuckets: number;

  constructor(maxTokens: number, windowMs: number, maxBuckets: number = MAX_RATE_LIMIT_BUCKETS) {
    this.maxTokens = maxTokens;
    this.windowMs = windowMs;
    this.maxBuckets = maxBuckets;
  }

  isAllowed(ip: string): boolean {
    const now = Date.now();
    let bucket = this.buckets.get(ip);

    if (bucket === undefined) {
      // Evict oldest entry if at capacity to prevent memory exhaustion
      if (this.buckets.size >= this.maxBuckets) {
        this.evictOldest();
      }
      bucket = { tokens: this.maxTokens, lastRefill: now };
      this.buckets.set(ip, bucket);
    }

    // Refill tokens based on elapsed time
    const elapsed = now - bucket.lastRefill;
    const tokensToAdd = (elapsed / this.windowMs) * this.maxTokens;
    bucket.tokens = Math.min(this.maxTokens, bucket.tokens + tokensToAdd);
    bucket.lastRefill = now;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }
    return false;
  }

  // Evict the oldest (least recently seen) bucket entry
  private evictOldest(): void {
    let oldestKey: string | undefined;
    let oldestTime = Infinity;
    for (const [key, bucket] of this.buckets.entries()) {
      if (bucket.lastRefill < oldestTime) {
        oldestTime = bucket.lastRefill;
        oldestKey = key;
      }
    }
    if (oldestKey !== undefined) {
      this.buckets.delete(oldestKey);
    }
  }

  // Periodically clean up old entries to prevent memory leak
  cleanup(): void {
    const now = Date.now();
    for (const [ip, bucket] of this.buckets.entries()) {
      if (now - bucket.lastRefill > this.windowMs * 2) {
        this.buckets.delete(ip);
      }
    }
  }
}

/** Security headers applied to all responses (defense-in-depth) */
const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Cache-Control': 'no-store',
};

/**
 * Get CORS headers for a given origin
 */
function getCorsHeaders(origin: string | string[] | undefined): Record<string, string> {
  const headers: Record<string, string> = { ...SECURITY_HEADERS };

  if (CORS_ALLOWED_ORIGINS.length === 0) {
    // No origins configured — deny cross-origin by not setting Access-Control-Allow-Origin
    return headers;
  }

  const originStr = Array.isArray(origin) ? origin[0] : origin;
  if (originStr !== undefined && CORS_ALLOWED_ORIGINS.includes(originStr)) {
    headers['Access-Control-Allow-Origin'] = originStr;
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
    headers['Access-Control-Max-Age'] = '86400';
    headers.Vary = 'Origin';
  }

  return headers;
}

/**
 * Get client IP from request.
 * Only trusts X-Forwarded-For when TRUST_PROXY is enabled.
 */
function getClientIp(req: IncomingMessage): string {
  if (TRUST_PROXY) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      return forwarded.split(',')[0]?.trim() ?? 'unknown';
    }
  }
  // socket may be undefined in test environments
  const socket = req.socket as { remoteAddress?: string } | undefined;
  return socket?.remoteAddress ?? 'unknown';
}

/**
 * Convert Node.js IncomingMessage to a Web Standard Request
 */
function toWebRequest(req: IncomingMessage, body: Buffer, url: URL): Request {
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
 * Write a Web Standard Response back to Node.js ServerResponse
 */
async function writeWebResponse(webRes: Response, res: ServerResponse): Promise<void> {
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
async function collectBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let totalSize = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer);
    totalSize += buf.length;
    if (totalSize > MAX_BODY_SIZE) {
      req.destroy();
      throw new PayloadTooLargeError();
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

/**
 * Create and start an HTTP server for the MCP server
 */
export async function startHttpServer(
  mcpServer: McpServer,
  port: number,
  host: string,
): Promise<void> {
  const rateLimitRpm = getEnvNumber('RATE_LIMIT_RPM', 60, 1, 10000);
  const rateLimiter = new RateLimiter(rateLimitRpm, 60_000);
  setInterval(() => { rateLimiter.cleanup(); }, 5 * 60_000).unref();

  const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    void handleHttpRequest(req, res, mcpServer, rateLimiter);
  });

  // Graceful shutdown
  let shuttingDown = false;

  function shutdown(signal: string): void {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    log.info(`${signal} received, shutting down...`);

    httpServer.close(() => {
      log.info('HTTP server closed');
      process.exit(0);
    });

    // Force exit after timeout
    setTimeout(() => {
      log.warning('Shutdown timeout, forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT);
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
        log.warning(`Server is binding to ${host}, which exposes it to the network. Use 127.0.0.1 for local-only access.`);
      }
      log.info(`Jamf Docs MCP Server running on http://${host}:${port}`);
      log.info(`MCP endpoint: http://${host}:${port}/mcp`);
      log.info(`Health check: http://${host}:${port}/health`);
      log.info(`LLMs info:   http://${host}:${port}/llms.txt`);
      resolve();
    });
  });
}

/**
 * Handle a single HTTP request
 */
async function handleHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  mcpServer: McpServer,
  rateLimiter: RateLimiter,
): Promise<void> {
  // Use hardcoded base URL to prevent Host header injection (SAST #8)
  const url = new URL(req.url ?? '/', 'http://localhost');
  const { pathname } = url;
  const { origin } = req.headers;
  const corsHeaders = getCorsHeaders(origin);

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { ...corsHeaders, 'Content-Length': '0' });
    res.end();
    return;
  }

  // Rate limiting
  const clientIp = getClientIp(req);
  if (!rateLimiter.isAllowed(clientIp)) {
    res.writeHead(429, { 'Content-Type': 'application/json', ...corsHeaders });
    res.end(JSON.stringify({ error: 'Too many requests' }));
    return;
  }

  // Health check endpoint
  if (pathname === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders });
    res.end(JSON.stringify({ status: 'ok', version: SERVER_VERSION }));
    return;
  }

  // llms.txt endpoint
  if (pathname === '/llms.txt' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', ...corsHeaders });
    res.end(LLMS_TXT);
    return;
  }

  // MCP endpoint
  if (pathname === '/mcp') {
    let body: Buffer;
    try {
      body = await collectBody(req);
    } catch (err) {
      if (err instanceof PayloadTooLargeError) {
        res.writeHead(413, { 'Content-Type': 'application/json', ...corsHeaders });
        res.end(JSON.stringify({ error: 'Payload too large' }));
        return;
      }
      throw err;
    }

    // Create a per-request transport (stateless mode)
    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: true,
    });

    // Connect the MCP server to this transport
    await mcpServer.connect(transport);

    try {
      // Convert Node request to Web Standard Request
      const webReq = toWebRequest(req, body, url);

      // Parse body for the transport if present
      let parsedBody: unknown;
      if (body.length > 0) {
        try {
          parsedBody = JSON.parse(body.toString()) as unknown;
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeaders });
          res.end(JSON.stringify({ error: 'Invalid JSON in request body' }));
          return;
        }
      }

      // Handle the request
      const webRes = await transport.handleRequest(webReq, { parsedBody });

      // Add CORS headers to the web response before writing
      for (const [key, value] of Object.entries(corsHeaders)) {
        webRes.headers.set(key, value);
      }

      // Write the response
      await writeWebResponse(webRes, res);
    } catch {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json', ...corsHeaders });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    } finally {
      await transport.close();
    }
    return;
  }

  // 404 for everything else
  res.writeHead(404, { 'Content-Type': 'application/json', ...corsHeaders });
  res.end(JSON.stringify({ error: 'Not found' }));
}
