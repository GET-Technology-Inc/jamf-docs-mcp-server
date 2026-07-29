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
// Request classification helpers
// ============================================================================

/**
 * Whether a parsed body is a `subscriptions/listen` request.
 *
 * These are long-lived SSE streams, not exchanges: they never complete on
 * their own, so shutdown ends them rather than waiting for them.
 */
function isSubscriptionListen(parsedBody: unknown): boolean {
  return (
    typeof parsedBody === 'object'
    && parsedBody !== null
    && (parsedBody as { method?: unknown }).method === 'subscriptions/listen'
  );
}

/**
 * Re-issue a request carrying an abort signal the caller controls.
 *
 * Only used for `subscriptions/listen`, whose body the SDK never reads — the
 * already-parsed body is handed to `mcpHandler.fetch` separately — so a
 * bodyless copy is equivalent for that path.
 */
function withSignal(request: Request, signal: AbortSignal): Request {
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    signal,
  });
}

/**
 * Decrement the in-flight count only once the response body has been fully
 * consumed (or cancelled).
 *
 * In `'auto'`/`'sse'` response mode the SDK resolves `fetch` as soon as the
 * first frame is ready and keeps writing the result into the stream, and the
 * per-request server stays registered as in-flight until that stream ends.
 * Counting only up to `fetch` resolving would therefore let shutdown tear the
 * server down mid-stream and truncate the response.
 */
function trackBody(response: Response, done: () => void): Response {
  const source = response.body;
  if (source === null) {
    done();
    return response;
  }

  // `Response.body` is typed as `ReadableStream<any>` in the ambient lib, so
  // the element type has to be re-stated for the pass-through to stay typed.
  const reader = source.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const tracked = new ReadableStream<Uint8Array>({
    async pull(controller): Promise<void> {
      try {
        const { done: finished, value } = await reader.read();
        if (finished) {
          controller.close();
          done();
          return;
        }
        controller.enqueue(value);
      } catch (err) {
        done();
        controller.error(err);
      }
    },
    async cancel(reason): Promise<void> {
      done();
      await reader.cancel(reason);
    },
  });

  return new Response(tracked, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

// ============================================================================
// Factory
// ============================================================================

/**
 * The handler plus its lifecycle hooks.
 */
export interface HttpHandlerHandle {
  /** Serve one Web Standard `Request`. */
  handler: (request: Request) => Promise<Response>;
  /**
   * Immediate teardown: stops the rate-limiter interval and closes the MCP
   * handler at once, aborting anything still in flight. Suitable for tests
   * and for callers with nothing to drain; use {@link shutdown} to serve a
   * graceful signal.
   */
  cleanup: () => void;
  /**
   * Graceful teardown, in the only order that works:
   *
   * 1. End the `subscriptions/listen` streams. They are long-lived by design
   *    and would otherwise hold their sockets open forever, so nothing that
   *    waits on connections closing — `http.Server.close()`, most obviously —
   *    could ever complete.
   * 2. Let in-flight exchanges finish, bounded by `timeoutMs`.
   * 3. Close the MCP handler.
   *
   * Step 3 cannot be hoisted: `McpHttpHandler.close()` aborts every in-flight
   * modern exchange and maps it to HTTP 499, which is exactly the drain window
   * being skipped. Nor can steps 1 and 3 be merged and deferred, because step
   * 1 only happens inside `close()` — deferring it deadlocks the caller.
   *
   * @param timeoutMs - Drain budget for step 2. Defaults to the configured
   *   `shutdownTimeoutMs`.
   */
  shutdown: (timeoutMs?: number) => Promise<void>;
}

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
 */
export function createHttpHandler(
  createServer: () => McpServer,
  config: HttpHandlerConfig,
  getClientIp: ClientIpExtractor,
  logger?: Logger,
): HttpHandlerHandle {
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

  // ------------------------------------------------------------------------
  // Shutdown bookkeeping
  // ------------------------------------------------------------------------

  /** Aborted to end `subscriptions/listen` streams; nothing else observes it. */
  const listenStreams = new AbortController();

  /** Exchanges past dispatch whose response body has not been consumed yet. */
  let inFlight = 0;
  const drainWaiters = new Set<() => void>();

  function enterExchange(): () => void {
    inFlight++;
    let left = false;
    return () => {
      if (left) { return; }
      left = true;
      inFlight--;
      if (inFlight === 0) {
        for (const wake of drainWaiters) { wake(); }
        drainWaiters.clear();
      }
    };
  }

  /** Resolves `true` once nothing is in flight, `false` if `timeoutMs` runs out. */
  async function drain(timeoutMs: number): Promise<boolean> {
    if (inFlight === 0) { return true; }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => { resolve(false); }, timeoutMs);
    });
    const drained = new Promise<boolean>((resolve) => {
      drainWaiters.add(() => { resolve(true); });
    });

    try {
      return await Promise.race([drained, expired]);
    } finally {
      clearTimeout(timer);
    }
  }

  function cleanup(): void {
    clearInterval(cleanupIntervalId);
    void mcpHandler.close();
  }

  async function shutdown(timeoutMs: number = config.shutdownTimeoutMs): Promise<void> {
    clearInterval(cleanupIntervalId);

    // 1. Long-lived subscription streams end now — they would never drain.
    listenStreams.abort();

    // 2. Give exchanges already past dispatch their window to answer.
    if (!(await drain(timeoutMs))) {
      logger?.warning(
        `Shutdown drain timed out after ${String(timeoutMs)}ms with ${String(inFlight)} request(s) in flight`,
      );
    }

    // 3. Only now may the handler go: this is the step that would have
    //    answered 499 to everything still running.
    await mcpHandler.close();
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
      return await handleMcp(request, mcpHandler, config, corsHeaders, {
        listenSignal: listenStreams.signal,
        enterExchange,
        ...(logger !== undefined && { logger }),
      });
    }

    // 404 fallback
    return jsonResponse(404, { error: 'Not found' }, corsHeaders);
  }

  return { handler, cleanup, shutdown };
}

// ============================================================================
// MCP endpoint handler
// ============================================================================

/** Shutdown wiring handed to the MCP endpoint by the factory. */
interface McpDeps {
  /** Aborts `subscriptions/listen` streams when shutdown begins. */
  listenSignal: AbortSignal;
  /** Registers an exchange as in-flight; returns its release function. */
  enterExchange: () => () => void;
  logger?: Logger;
}

async function handleMcp(
  request: Request,
  mcpHandler: McpHttpHandler,
  config: HttpHandlerConfig,
  corsHeaders: Record<string, string>,
  deps: McpDeps,
): Promise<Response> {
  const { logger } = deps;

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

    // A subscription stream is not an exchange: it stays open until the client
    // or the server ends it, so it is excluded from the drain and given the
    // shutdown signal instead. The SDK's listen router tears a stream down
    // when the request it was opened with aborts.
    const listen = isSubscriptionListen(parsedBody);
    const forwarded = listen ? withSignal(request, deps.listenSignal) : request;
    const release = listen ? undefined : deps.enterExchange();

    let webRes: Response;
    try {
      // The entry classifies the era itself and builds a fresh server per
      // request from the factory it was given.
      webRes = await mcpHandler.fetch(forwarded, { parsedBody });
    } catch (err) {
      release?.();
      throw err;
    }

    // Add CORS + security headers to the response
    for (const [key, value] of Object.entries(corsHeaders)) {
      webRes.headers.set(key, value);
    }

    return release === undefined ? webRes : trackBody(webRes, release);
  } catch (err) {
    logger?.error(`MCP handler error: ${err instanceof Error ? err.message : String(err)}`);
    return jsonResponse(500, { error: 'Internal server error' }, corsHeaders);
  }
}
