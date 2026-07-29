/**
 * Platform-agnostic HTTP handler for the MCP server.
 *
 * Platform adapters (Node.js, Cloudflare Workers) convert their
 * native request/response types to/from Web Standard objects and
 * call the `handler` function returned by `createHttpHandler`.
 */

import type { McpServer, McpHttpHandler } from '@modelcontextprotocol/server';
import { createMcpHandler } from '@modelcontextprotocol/server';

import { RateLimiter } from './rate-limiter.js';
import {
  LLMS_TXT,
  PayloadTooLargeError,
  type HttpHandlerConfig,
  type ClientIpExtractor,
  type Logger,
} from './http-types.js';

// ============================================================================
// Security headers
// ============================================================================

/** Security headers applied to all responses (defense-in-depth) */
const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Cache-Control': 'no-store',
};

// ============================================================================
// CORS helper
// ============================================================================

/**
 * Request headers a browser-based MCP client is allowed to send.
 *
 * `Mcp-Method` / `Mcp-Name` are mandatory on Streamable HTTP POSTs from
 * protocol revision 2026-07-28 (SEP-2243) — omitting them from the preflight
 * allowlist makes every cross-origin call from a conforming client fail before
 * it reaches the handler. `MCP-Protocol-Version`, `Mcp-Session-Id` and
 * `Last-Event-ID` are kept for the 2025-era clients this endpoint still serves.
 */
export const CORS_ALLOWED_HEADERS = [
  'Content-Type',
  'Authorization',
  'Mcp-Method',
  'Mcp-Name',
  'MCP-Protocol-Version',
  'Mcp-Session-Id',
  'Last-Event-ID',
].join(', ');

/** Response headers a browser-based MCP client is allowed to read. */
export const CORS_EXPOSED_HEADERS = ['Mcp-Session-Id'].join(', ');

function getCorsHeaders(
  origin: string | null,
  allowedOrigins: string[],
): Record<string, string> {
  const headers: Record<string, string> = { ...SECURITY_HEADERS };

  if (allowedOrigins.length === 0) {
    // No origins configured -- deny cross-origin
    return headers;
  }

  // If wildcard is in the list, allow all origins
  if (allowedOrigins.includes('*')) {
    headers['Access-Control-Allow-Origin'] = '*';
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = CORS_ALLOWED_HEADERS;
    headers['Access-Control-Expose-Headers'] = CORS_EXPOSED_HEADERS;
    return headers;
  }

  // Otherwise, check exact match against the allowed list
  if (origin !== null && allowedOrigins.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = CORS_ALLOWED_HEADERS;
    headers['Access-Control-Expose-Headers'] = CORS_EXPOSED_HEADERS;
    headers['Access-Control-Max-Age'] = '86400';
    headers.Vary = 'Origin';
  }

  return headers;
}

// ============================================================================
// Body reading helper (Web Standard)
// ============================================================================

async function readBodyText(
  request: Request,
  maxBodySize: number,
): Promise<string> {
  // Fast reject via Content-Length header when available
  const contentLength = request.headers.get('content-length');
  if (contentLength !== null) {
    const length = parseInt(contentLength, 10);
    if (!isNaN(length) && length > maxBodySize) {
      throw new PayloadTooLargeError();
    }
  }

  const text = await request.text();
  if (text.length > maxBodySize) {
    throw new PayloadTooLargeError();
  }
  return text;
}

// ============================================================================
// Response builder helpers
// ============================================================================

function jsonResponse(
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
  });
}

function textResponse(
  status: number,
  body: string,
  contentType: string,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': contentType,
      ...extraHeaders,
    },
  });
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a platform-agnostic HTTP handler for the MCP server.
 *
 * @param createServer - Factory that returns a fresh McpServer per request.
 *   The MCP SDK requires one Protocol/Server instance per connection, so each
 *   request gets its own server rather than sharing a singleton.
 *   Callers decide the server's lifecycle/state model (stateless, per-session, …).
 * @param config       - HTTP handler configuration
 * @param getClientIp  - Platform-specific function to extract client IP from a Request
 * @param logger       - Optional logger instance
 * @returns An object with:
 *   - `handler`: async function that takes a Web Standard Request and returns a Response
 *   - `cleanup`: function to stop the rate limiter cleanup interval
 */
export function createHttpHandler(
  createServer: () => McpServer,
  config: HttpHandlerConfig,
  getClientIp: ClientIpExtractor,
  logger?: Logger,
): { handler: (request: Request) => Promise<Response>; cleanup: () => void } {
  const rateLimiter = new RateLimiter(config.rateLimitRpm, 60_000);
  const cleanupIntervalId = setInterval(() => { rateLimiter.cleanup(); }, 5 * 60_000);

  // One entry serves both protocol eras from the same factory: 2026-07-28
  // envelope traffic on the modern path, and 2025-era requests through the
  // SDK's stateless legacy fallback. Legacy responses stream over SSE, which
  // the 2025 Streamable HTTP binding already requires clients to accept.
  const mcpHandler = createMcpHandler(() => createServer(), {
    legacy: 'stateless',
    responseMode: config.responseMode,
    onerror: (err) => {
      logger?.error(`MCP handler error: ${err.message}`);
    },
  });

  // Prevent the interval from keeping the process alive (Node.js-specific,
  // but calling .unref() is harmless on platforms that lack it).
  if (typeof cleanupIntervalId === 'object' && 'unref' in cleanupIntervalId) {
    (cleanupIntervalId as { unref: () => void }).unref();
  }

  function cleanup(): void {
    clearInterval(cleanupIntervalId);
    void mcpHandler.close();
  }

  async function handler(request: Request): Promise<Response> {
    // Use hardcoded base URL to prevent Host header injection
    const url = new URL(request.url, 'http://localhost');
    const { pathname } = url;
    const origin = request.headers.get('origin');
    const corsHeaders = getCorsHeaders(origin, config.corsAllowedOrigins);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: { ...corsHeaders, 'Content-Length': '0' },
      });
    }

    // Rate limiting
    const clientIp = getClientIp(request);
    if (!rateLimiter.isAllowed(clientIp)) {
      return jsonResponse(429, { error: 'Too many requests' }, corsHeaders);
    }

    // Health check
    if (pathname === '/health' && request.method === 'GET') {
      return jsonResponse(200, { status: 'ok', version: config.serverVersion }, corsHeaders);
    }

    // llms.txt
    if (pathname === '/llms.txt' && request.method === 'GET') {
      return textResponse(200, LLMS_TXT, 'text/plain; charset=utf-8', corsHeaders);
    }

    // MCP endpoint
    if (pathname === '/mcp') {
      return await handleMcp(request, mcpHandler, config, corsHeaders, logger);
    }

    // 404 fallback
    return jsonResponse(404, { error: 'Not found' }, corsHeaders);
  }

  return { handler, cleanup };
}

// ============================================================================
// MCP endpoint handler
// ============================================================================

async function handleMcp(
  request: Request,
  mcpHandler: McpHttpHandler,
  config: HttpHandlerConfig,
  corsHeaders: Record<string, string>,
  logger?: Logger,
): Promise<Response> {
  // Read body (with size enforcement)
  let bodyText: string;
  try {
    bodyText = await readBodyText(request, config.maxBodySize);
  } catch (err) {
    if (err instanceof PayloadTooLargeError) {
      return jsonResponse(413, { error: 'Payload too large' }, corsHeaders);
    }
    throw err;
  }

  try {
    // Parse body if present. Reading it above consumed the request stream, so
    // the parsed value must be handed to the MCP handler explicitly.
    let parsedBody: unknown;
    if (bodyText.length > 0) {
      try {
        parsedBody = JSON.parse(bodyText) as unknown;
      } catch {
        return jsonResponse(400, { error: 'Invalid JSON in request body' }, corsHeaders);
      }
    }

    // The entry classifies the era itself and builds a fresh server per
    // request from the factory it was given.
    const webRes = await mcpHandler.fetch(request, { parsedBody });

    // Add CORS + security headers to the response
    for (const [key, value] of Object.entries(corsHeaders)) {
      webRes.headers.set(key, value);
    }

    return webRes;
  } catch (err) {
    logger?.error(`MCP handler error: ${err instanceof Error ? err.message : String(err)}`);
    return jsonResponse(500, { error: 'Internal server error' }, corsHeaders);
  }
}
