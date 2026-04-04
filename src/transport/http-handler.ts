/**
 * Platform-agnostic HTTP handler for the MCP server.
 *
 * Platform adapters (Node.js, Cloudflare Workers) convert their
 * native request/response types to/from Web Standard objects and
 * call the `handler` function returned by `createHttpHandler`.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  WebStandardStreamableHTTPServerTransport,
} from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';

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
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
    return headers;
  }

  // Otherwise, check exact match against the allowed list
  if (origin !== null && allowedOrigins.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
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
 * @param mcpServer    - The MCP server instance to connect per-request transports to
 * @param config       - HTTP handler configuration
 * @param getClientIp  - Platform-specific function to extract client IP from a Request
 * @param logger       - Optional logger instance
 * @returns An object with:
 *   - `handler`: async function that takes a Web Standard Request and returns a Response
 *   - `cleanup`: function to stop the rate limiter cleanup interval
 */
export function createHttpHandler(
  mcpServer: McpServer,
  config: HttpHandlerConfig,
  getClientIp: ClientIpExtractor,
  logger?: Logger,
): { handler: (request: Request) => Promise<Response>; cleanup: () => void } {
  const rateLimiter = new RateLimiter(config.rateLimitRpm, 60_000);
  const cleanupIntervalId = setInterval(() => { rateLimiter.cleanup(); }, 5 * 60_000);

  // Prevent the interval from keeping the process alive (Node.js-specific,
  // but calling .unref() is harmless on platforms that lack it).
  if (typeof cleanupIntervalId === 'object' && 'unref' in cleanupIntervalId) {
    (cleanupIntervalId as { unref: () => void }).unref();
  }

  function cleanup(): void {
    clearInterval(cleanupIntervalId);
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
      return await handleMcp(request, mcpServer, config, corsHeaders, logger);
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
  mcpServer: McpServer,
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

  // Create a per-request transport (stateless mode)
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: config.enableJsonResponse,
  });

  // Connect the MCP server to this transport
  await mcpServer.connect(transport);

  try {
    // Parse body if present
    let parsedBody: unknown;
    if (bodyText.length > 0) {
      try {
        parsedBody = JSON.parse(bodyText) as unknown;
      } catch {
        return jsonResponse(400, { error: 'Invalid JSON in request body' }, corsHeaders);
      }
    }

    // Handle the request via the MCP transport
    const webRes = await transport.handleRequest(request, { parsedBody });

    // Add CORS + security headers to the response
    for (const [key, value] of Object.entries(corsHeaders)) {
      webRes.headers.set(key, value);
    }

    return webRes;
  } catch (err) {
    logger?.error(`MCP handler error: ${err instanceof Error ? err.message : String(err)}`);
    return jsonResponse(500, { error: 'Internal server error' }, corsHeaders);
  } finally {
    await transport.close();
  }
}
