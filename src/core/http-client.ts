/**
 * Runtime-agnostic HTTP client using the global fetch API.
 * No Node.js built-in imports — works in any environment with global fetch.
 */

export class HttpError extends Error {
  public readonly status: number;
  public readonly statusText: string;
  public readonly url: string;

  constructor(status: number, statusText: string, url: string) {
    super(`HTTP ${status} ${statusText}: ${url}`);
    this.name = 'HttpError';
    this.status = status;
    this.statusText = statusText;
    this.url = url;
  }

  get isRetryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}

export interface HttpGetOptions {
  headers?: Record<string, string>;
  timeout?: number;
  params?: Record<string, string>;
}

const DEFAULT_TIMEOUT = 15000;

function appendQueryParams(url: string, params: Record<string, string>): string {
  const parsed = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    parsed.searchParams.set(key, value);
  }
  return parsed.toString();
}

export async function httpGetText(
  url: string,
  options?: HttpGetOptions
): Promise<string> {
  const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
  const targetUrl = options?.params !== undefined
    ? appendQueryParams(url, options.params)
    : url;

  const response = await fetch(targetUrl, {
    method: 'GET',
    ...(options?.headers !== undefined ? { headers: options.headers } : {}),
    signal: AbortSignal.timeout(timeout),
  });

  if (!response.ok) {
    throw new HttpError(response.status, response.statusText, targetUrl);
  }

  return await response.text();
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

  const response = await fetch(targetUrl, {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(timeout),
  });

  if (!response.ok) {
    throw new HttpError(response.status, response.statusText, targetUrl);
  }

  return await response.json() as T;
}
