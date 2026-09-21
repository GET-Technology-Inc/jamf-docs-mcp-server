/**
 * Runtime-agnostic HTTP client using the global fetch API.
 * No Node.js built-in imports — works in any environment with global fetch.
 */

import type { RequestConfig } from './config.js';

export class HttpError extends Error {
  public readonly status: number;
  public readonly statusText: string;
  public readonly url: string;
  /** Retry-After header value (when present on 429 responses). */
  public readonly retryAfter: string | null;

  constructor(
    status: number,
    statusText: string,
    url: string,
    retryAfter?: string | null
  ) {
    super(`HTTP ${status} ${statusText}: ${url}`);
    this.name = 'HttpError';
    this.status = status;
    this.statusText = statusText;
    this.url = url;
    this.retryAfter = retryAfter ?? null;
  }

  get isRetryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}

interface RetryOptions {
  maxRetries?: number | undefined;
  retryDelay?: number | undefined;
}

export interface HttpGetOptions extends RetryOptions {
  headers?: Record<string, string>;
  timeout?: number;
  params?: Record<string, string>;
}

export interface HttpPostJsonOptions extends RetryOptions {
  headers?: Record<string, string>;
  timeout?: number;
}

const DEFAULT_TIMEOUT = 15000;
const DEFAULT_MAX_RETRIES = 0;
const DEFAULT_RETRY_DELAY = 1000;
const MAX_RETRY_DELAY_MS = 60_000;

function appendQueryParams(
  url: string,
  params: Record<string, string>
): string {
  const parsed = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    parsed.searchParams.set(key, value);
  }
  return parsed.toString();
}

/**
 * Determine how long to wait before the next retry attempt (in ms).
 *
 * - For 429 responses the `Retry-After` header is respected when present.
 *   It may be an integer (seconds) or an HTTP-date string.
 * - Otherwise, exponential backoff is used: `retryDelay * 2^attempt`.
 */
function computeRetryDelay(
  error: unknown,
  attempt: number,
  retryDelay: number
): number {
  // Respect Retry-After header on 429 responses
  if (
    error instanceof HttpError &&
    error.status === 429 &&
    error.retryAfter !== null
  ) {
    const seconds = Number(error.retryAfter);
    if (!Number.isNaN(seconds)) {
      return Math.min(seconds * 1000, MAX_RETRY_DELAY_MS);
    }
    // Retry-After may be an HTTP-date
    const date = new Date(error.retryAfter).getTime();
    if (!Number.isNaN(date)) {
      return Math.min(Math.max(0, date - Date.now()), MAX_RETRY_DELAY_MS);
    }
  }

  // Exponential backoff: retryDelay * 2^attempt
  return Math.min(retryDelay * Math.pow(2, attempt), MAX_RETRY_DELAY_MS);
}

/**
 * Determine whether an error is eligible for retry.
 *
 * Retryable errors:
 *  - HttpError with 429 or 5xx status
 *  - Network errors (TypeError from fetch)
 *  - Timeout / abort errors
 *
 * Non-retryable: 4xx (except 429).
 */
function isRetryableError(error: unknown): boolean {
  if (error instanceof HttpError) {
    return error.isRetryable;
  }
  // Network failures surface as TypeError in the Fetch API
  if (error instanceof TypeError) {
    return true;
  }
  // AbortSignal.timeout() throws a DOMException with name "TimeoutError"
  if (
    typeof DOMException !== 'undefined' &&
    error instanceof DOMException &&
    (error.name === 'TimeoutError' || error.name === 'AbortError')
  ) {
    return true;
  }
  return false;
}

/**
 * Platform-agnostic sleep using a plain Promise + setTimeout.
 * Works on Cloudflare Workers, Deno, Bun, and Node.js.
 */
async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Execute an async operation with retry logic.
 *
 * - Retries on transient failures (5xx, 429, network errors, timeouts).
 * - Does NOT retry non-retryable 4xx errors (except 429).
 * - Uses exponential backoff: `retryDelay * 2^attempt`.
 * - Respects `Retry-After` header for 429 responses (via HttpError.retryAfter).
 */
async function fetchWithRetry<T>(
  operation: () => Promise<T>,
  opts: RetryOptions
): Promise<T> {
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const retryDelay = opts.retryDelay ?? DEFAULT_RETRY_DELAY;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: unknown) {
      lastError = error;

      const isLastAttempt = attempt >= maxRetries;
      if (isLastAttempt || !isRetryableError(error)) {
        throw error;
      }

      const delay = computeRetryDelay(error, attempt, retryDelay);
      await sleep(delay);
    }
  }

  /* istanbul ignore next — defensive: the loop always throws or returns */
  throw lastError;
}

export async function httpGetText(
  url: string,
  options?: HttpGetOptions
): Promise<string> {
  const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
  const targetUrl = options?.params !== undefined
    ? appendQueryParams(url, options.params)
    : url;

  return await fetchWithRetry(async () => {
    const response = await fetch(targetUrl, {
      method: 'GET',
      ...(options?.headers !== undefined
        ? { headers: options.headers }
        : {}),
      signal: AbortSignal.timeout(timeout),
    });

    if (!response.ok) {
      throw new HttpError(
        response.status, response.statusText, targetUrl,
        response.headers.get('Retry-After'),
      );
    }

    return await response.text();
  }, {
    maxRetries: options?.maxRetries,
    retryDelay: options?.retryDelay,
  });
}

export async function httpGetJson<T>(
  url: string,
  options?: HttpGetOptions
): Promise<T> {
  const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
  const targetUrl = options?.params !== undefined
    ? appendQueryParams(url, options.params)
    : url;

  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...options?.headers,
  };

  return await fetchWithRetry(async () => {
    const response = await fetch(targetUrl, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(timeout),
    });

    if (!response.ok) {
      throw new HttpError(
        response.status, response.statusText, targetUrl,
        response.headers.get('Retry-After'),
      );
    }

    return await (response.json() as Promise<T>);
  }, {
    maxRetries: options?.maxRetries,
    retryDelay: options?.retryDelay,
  });
}

export async function httpPostJson<T>(
  url: string,
  body: unknown,
  options?: HttpPostJsonOptions
): Promise<T> {
  const timeout = options?.timeout ?? DEFAULT_TIMEOUT;

  const headers: Record<string, string> = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    ...options?.headers,
  };

  const serializedBody = JSON.stringify(body);

  return await fetchWithRetry(async () => {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: serializedBody,
      signal: AbortSignal.timeout(timeout),
    });

    if (!response.ok) {
      throw new HttpError(
        response.status, response.statusText, url,
        response.headers.get('Retry-After'),
      );
    }

    return await (response.json() as Promise<T>);
  }, {
    maxRetries: options?.maxRetries,
    retryDelay: options?.retryDelay,
  });
}

// ============================================================================
// Client factory
// ============================================================================

/**
 * An HTTP client bound to one {@link RequestConfig}.
 *
 * The three functions above take their settings per call, which meant nothing
 * ever passed them: `ServerConfig.request` was parsed from the environment and
 * read by no one, so five documented variables did nothing for as long as they
 * existed. Binding the config to a client and putting that client on
 * `ServerContext` is what makes them real, and follows the injection the rest
 * of the context already uses for cache, logger and the providers.
 *
 * Per-call options still win over the bound config, and a per-call `User-Agent`
 * wins over the configured one.
 */
export interface HttpClient {
  getText: (url: string, options?: HttpGetOptions) => Promise<string>;
  getJson: <T>(url: string, options?: HttpGetOptions) => Promise<T>;
  postJson: <T>(url: string, body: unknown, options?: HttpPostJsonOptions) => Promise<T>;
}

export function createHttpClient(config: RequestConfig): HttpClient {
  // Serialised through a promise chain rather than a bare timestamp: several
  // requests can be in flight at once (batch_get_articles fans out), and two
  // that read the same `lastStartedAt` before either wrote it would both go
  // immediately. The chain staggers starts without serialising the requests.
  let lastStartedAt = 0;
  let gate: Promise<void> = Promise.resolve();

  async function waitForTurn(): Promise<void> {
    if (config.rateLimitDelay <= 0) { return; }
    const turn = gate.then(async () => {
      const wait = lastStartedAt + config.rateLimitDelay - Date.now();
      if (wait > 0) { await sleep(wait); }
      lastStartedAt = Date.now();
    });
    gate = turn.catch(() => undefined);
    await turn;
  }

  /** Config as the default for anything the caller did not specify. */
  function bound(options?: HttpGetOptions | HttpPostJsonOptions): {
    timeout: number;
    maxRetries: number;
    retryDelay: number;
    headers: Record<string, string>;
  } {
    return {
      timeout: options?.timeout ?? config.timeout,
      maxRetries: options?.maxRetries ?? config.maxRetries,
      retryDelay: options?.retryDelay ?? config.retryDelay,
      // Spread second so an explicit per-call User-Agent still wins.
      headers: { 'User-Agent': config.userAgent, ...options?.headers },
    };
  }

  return {
    async getText(url: string, options?: HttpGetOptions): Promise<string> {
      await waitForTurn();
      return await httpGetText(url, { ...options, ...bound(options) });
    },
    async getJson<T>(url: string, options?: HttpGetOptions): Promise<T> {
      await waitForTurn();
      return await httpGetJson<T>(url, { ...options, ...bound(options) });
    },
    async postJson<T>(url: string, body: unknown, options?: HttpPostJsonOptions): Promise<T> {
      await waitForTurn();
      return await httpPostJson<T>(url, body, { ...options, ...bound(options) });
    },
  };
}
