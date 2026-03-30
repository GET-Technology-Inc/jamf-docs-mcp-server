/**
 * Unit tests for the runtime-agnostic HTTP client (src/core/http-client.ts).
 *
 * Global fetch is stubbed via vi.stubGlobal so no real network I/O occurs.
 *
 * Coverage targets:
 *   - httpGetText: success, HTTP errors (404/429/500), timeout, query params, custom headers
 *   - httpGetJson: success, Accept header injection, invalid JSON body
 *   - HttpError: constructor properties, isRetryable logic
 */

import { vi, describe, it, expect, afterEach } from 'vitest';
import { httpGetText, httpGetJson, HttpError } from '../../../src/core/http-client.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetchOk(body: string, headers?: HeadersInit): typeof fetch {
  return vi.fn().mockResolvedValue(new Response(body, { status: 200, statusText: 'OK', headers }));
}

function mockFetchStatus(status: number, statusText: string): typeof fetch {
  return vi.fn().mockResolvedValue(
    new Response(null, { status, statusText })
  );
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.restoreAllMocks();
});

// ===========================================================================
// httpGetText
// ===========================================================================

describe('httpGetText', () => {
  it('should return text body on 200 response', async () => {
    const mock = mockFetchOk('hello world');
    vi.stubGlobal('fetch', mock);

    const result = await httpGetText('https://example.com/page');

    expect(result).toBe('hello world');
    expect(mock).toHaveBeenCalledOnce();
  });

  it('should throw HttpError with isRetryable=false for 404', async () => {
    vi.stubGlobal('fetch', mockFetchStatus(404, 'Not Found'));

    const err = await httpGetText('https://example.com/missing').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(HttpError);
    const httpErr = err as HttpError;
    expect(httpErr.status).toBe(404);
    expect(httpErr.statusText).toBe('Not Found');
    expect(httpErr.isRetryable).toBe(false);
  });

  it('should throw HttpError with isRetryable=true for 429', async () => {
    vi.stubGlobal('fetch', mockFetchStatus(429, 'Too Many Requests'));

    const err = await httpGetText('https://example.com/rate-limited').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(HttpError);
    const httpErr = err as HttpError;
    expect(httpErr.status).toBe(429);
    expect(httpErr.isRetryable).toBe(true);
  });

  it('should throw HttpError with isRetryable=true for 500', async () => {
    vi.stubGlobal('fetch', mockFetchStatus(500, 'Internal Server Error'));

    const err = await httpGetText('https://example.com/error').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(HttpError);
    const httpErr = err as HttpError;
    expect(httpErr.status).toBe(500);
    expect(httpErr.isRetryable).toBe(true);
  });

  it('should throw on timeout when fetch never resolves', async () => {
    // Mock fetch that respects the AbortSignal so the timeout actually fires.
    const slowFetch = vi.fn().mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(init.signal!.reason ?? new DOMException('The operation was aborted.', 'AbortError'));
          });
        })
    );
    vi.stubGlobal('fetch', slowFetch);

    await expect(
      httpGetText('https://example.com/slow', { timeout: 50 })
    ).rejects.toThrow();
  }, 5000);

  it('should append query params to the URL', async () => {
    const mock = mockFetchOk('ok');
    vi.stubGlobal('fetch', mock);

    await httpGetText('https://example.com/search', {
      params: { q: 'jamf', page: '2' },
    });

    const calledUrl = (mock as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    const parsed = new URL(calledUrl);
    expect(parsed.searchParams.get('q')).toBe('jamf');
    expect(parsed.searchParams.get('page')).toBe('2');
  });

  it('should pass custom headers through to fetch', async () => {
    const mock = mockFetchOk('ok');
    vi.stubGlobal('fetch', mock);

    await httpGetText('https://example.com/api', {
      headers: { 'X-Custom': 'value123' },
    });

    const calledInit = (mock as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    expect(calledInit.headers).toEqual({ 'X-Custom': 'value123' });
  });
});

// ===========================================================================
// httpGetJson
// ===========================================================================

describe('httpGetJson', () => {
  it('should parse and return JSON body on 200 response', async () => {
    const payload = { results: [1, 2, 3], total: 3 };
    const mock = mockFetchOk(JSON.stringify(payload), { 'Content-Type': 'application/json' });
    vi.stubGlobal('fetch', mock);

    const result = await httpGetJson<{ results: number[]; total: number }>(
      'https://example.com/api/data'
    );

    expect(result).toEqual(payload);
  });

  it('should include Accept: application/json header', async () => {
    const mock = mockFetchOk(JSON.stringify({}));
    vi.stubGlobal('fetch', mock);

    await httpGetJson('https://example.com/api');

    const calledInit = (mock as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    const headers = calledInit.headers as Record<string, string>;
    expect(headers['Accept']).toBe('application/json');
  });

  it('should throw a non-HttpError when response body is invalid JSON', async () => {
    const mock = vi.fn().mockResolvedValue(
      new Response('not valid json {{{', { status: 200, statusText: 'OK' })
    );
    vi.stubGlobal('fetch', mock);

    const err = await httpGetJson('https://example.com/bad-json').catch((e: unknown) => e);

    expect(err).not.toBeInstanceOf(HttpError);
    expect(err).toBeInstanceOf(Error);
  });
});

// ===========================================================================
// HttpError
// ===========================================================================

describe('HttpError', () => {
  it('should set status, statusText, url, name, and message correctly', () => {
    const err = new HttpError(503, 'Service Unavailable', 'https://example.com/down');

    expect(err.status).toBe(503);
    expect(err.statusText).toBe('Service Unavailable');
    expect(err.url).toBe('https://example.com/down');
    expect(err.name).toBe('HttpError');
    expect(err.message).toBe('HTTP 503 Service Unavailable: https://example.com/down');
    expect(err).toBeInstanceOf(Error);
  });

  it('should report isRetryable=true for 429 and 5xx status codes', () => {
    expect(new HttpError(429, 'Too Many Requests', '').isRetryable).toBe(true);
    expect(new HttpError(500, 'Internal Server Error', '').isRetryable).toBe(true);
    expect(new HttpError(502, 'Bad Gateway', '').isRetryable).toBe(true);
    expect(new HttpError(503, 'Service Unavailable', '').isRetryable).toBe(true);
    expect(new HttpError(504, 'Gateway Timeout', '').isRetryable).toBe(true);
  });

  it('should report isRetryable=false for 4xx status codes (except 429)', () => {
    expect(new HttpError(400, 'Bad Request', '').isRetryable).toBe(false);
    expect(new HttpError(401, 'Unauthorized', '').isRetryable).toBe(false);
    expect(new HttpError(403, 'Forbidden', '').isRetryable).toBe(false);
    expect(new HttpError(404, 'Not Found', '').isRetryable).toBe(false);
    expect(new HttpError(422, 'Unprocessable Entity', '').isRetryable).toBe(false);
  });
});
