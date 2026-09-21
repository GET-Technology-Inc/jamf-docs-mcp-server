/**
 * Tests for createHttpClient — the binding that makes ServerConfig.request real.
 *
 * Before it existed, `request` was parsed from the environment, range-checked,
 * and read by nobody: five documented variables did nothing, and the client
 * identified itself to learn.jamf.com not at all. Each case below asserts one
 * of those settings actually reaches the wire.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHttpClient } from '../../../src/core/http-client.js';
import { createDefaultConfig, defaultUserAgent } from '../../../src/core/config.js';
import type { RequestConfig } from '../../../src/core/config.js';

const URL_A = 'https://learn.jamf.com/a';

function config(overrides: Partial<RequestConfig> = {}): RequestConfig {
  return { ...createDefaultConfig().request, ...overrides };
}

/** Capture every fetch the client makes, answering each one 200 OK. */
function captureFetch(responder?: () => Response): {
  calls: { url: string; init: RequestInit }[];
} {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return await Promise.resolve(responder?.() ?? new Response('ok', { status: 200 }));
  });
  return { calls };
}

function headerOf(init: RequestInit, name: string): string | undefined {
  return (init.headers as Record<string, string> | undefined)?.[name];
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('User-Agent', () => {
  it('sends the configured User-Agent on a GET', async () => {
    const { calls } = captureFetch();
    await createHttpClient(config({ userAgent: 'test-agent/9.9' })).getText(URL_A);

    expect(calls).toHaveLength(1);
    expect(headerOf(calls[0].init, 'User-Agent')).toBe('test-agent/9.9');
  });

  it('sends it on a POST too', async () => {
    const { calls } = captureFetch(() => new Response('{}', { status: 200 }));
    await createHttpClient(config({ userAgent: 'test-agent/9.9' }))
      .postJson(URL_A, { q: 1 });

    expect(headerOf(calls[0].init, 'User-Agent')).toBe('test-agent/9.9');
  });

  it('does not clobber the headers the call already needs', async () => {
    const { calls } = captureFetch(() => new Response('{}', { status: 200 }));
    await createHttpClient(config()).getJson(URL_A);

    // httpGetJson sets Accept; the client must add to that, not replace it.
    expect(headerOf(calls[0].init, 'Accept')).toBe('application/json');
    expect(headerOf(calls[0].init, 'User-Agent')).toBeDefined();
  });

  it('lets an explicit per-call User-Agent win', async () => {
    const { calls } = captureFetch();
    await createHttpClient(config({ userAgent: 'bound' }))
      .getText(URL_A, { headers: { 'User-Agent': 'per-call' } });

    expect(headerOf(calls[0].init, 'User-Agent')).toBe('per-call');
  });

  it('names the package and version by default', () => {
    // The point of the header is to be identifiable and traceable, so assert
    // the shape rather than a frozen string.
    expect(defaultUserAgent('7.1.2')).toContain('jamf-docs-mcp-server/7.1.2');
    expect(defaultUserAgent('7.1.2')).toContain('github.com/GET-Technology-Inc');
    expect(createDefaultConfig({ version: '7.1.2' }).request.userAgent)
      .toBe(defaultUserAgent('7.1.2'));
  });
});

describe('maxRetries', () => {
  it('makes exactly one attempt at the shipped default of 0', async () => {
    const { calls } = captureFetch(() => new Response('nope', { status: 503 }));

    await expect(createHttpClient(config()).getText(URL_A)).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });

  it('makes 1 + maxRetries attempts when configured', async () => {
    const { calls } = captureFetch(() => new Response('nope', { status: 503 }));

    await expect(
      createHttpClient(config({ maxRetries: 2, retryDelay: 1 })).getText(URL_A),
    ).rejects.toThrow();
    expect(calls).toHaveLength(3);
  });

  it('does not retry a non-retryable 404 however high the setting', async () => {
    const { calls } = captureFetch(() => new Response('gone', { status: 404 }));

    await expect(
      createHttpClient(config({ maxRetries: 5, retryDelay: 1 })).getText(URL_A),
    ).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });

  it('lets a per-call maxRetries override the bound one', async () => {
    const { calls } = captureFetch(() => new Response('nope', { status: 503 }));

    await expect(
      createHttpClient(config({ maxRetries: 0 }))
        .getText(URL_A, { maxRetries: 1, retryDelay: 1 }),
    ).rejects.toThrow();
    expect(calls).toHaveLength(2);
  });
});

describe('rateLimitDelay', () => {
  it('does not stagger anything at the shipped default of 0', async () => {
    const starts: number[] = [];
    vi.stubGlobal('fetch', async () => {
      starts.push(Date.now());
      return await Promise.resolve(new Response('ok', { status: 200 }));
    });

    const client = createHttpClient(config());
    await Promise.all([client.getText(URL_A), client.getText(URL_A), client.getText(URL_A)]);

    expect(starts).toHaveLength(3);
    // Parallel work stays parallel — this is why the default is 0 and not the
    // 500 the old README advertised: batch_get_articles fans out.
    expect(Math.max(...starts) - Math.min(...starts)).toBeLessThan(100);
  });

  it('staggers concurrent requests by at least the configured delay', async () => {
    const starts: number[] = [];
    vi.stubGlobal('fetch', async () => {
      starts.push(Date.now());
      return await Promise.resolve(new Response('ok', { status: 200 }));
    });

    const client = createHttpClient(config({ rateLimitDelay: 40 }));
    await Promise.all([client.getText(URL_A), client.getText(URL_A), client.getText(URL_A)]);

    expect(starts).toHaveLength(3);
    const gaps = starts.slice(1).map((t, i) => t - starts[i]);
    // Allow slack for timer coarseness; the point is that a gap exists at all.
    for (const gap of gaps) {
      expect(gap).toBeGreaterThanOrEqual(30);
    }
  });

  it('keeps the gate per client, not global', async () => {
    vi.stubGlobal('fetch', async () => await Promise.resolve(new Response('ok', { status: 200 })));

    const a = createHttpClient(config({ rateLimitDelay: 10_000 }));
    const b = createHttpClient(config());

    await a.getText(URL_A);
    // b must not be held behind a's delay; if the gate were module-level this
    // would hang until the test timed out.
    await expect(b.getText(URL_A)).resolves.toBe('ok');
  });
});

describe('timeout', () => {
  it('passes the configured timeout down as an abort signal', async () => {
    const { calls } = captureFetch();
    await createHttpClient(config({ timeout: 1234 })).getText(URL_A);

    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  it('aborts a request that outlives the configured timeout', async () => {
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      // Never resolve on its own; only the signal ends this.
      return await new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('timed out', 'TimeoutError'));
        });
      });
    });

    await expect(
      createHttpClient(config({ timeout: 25 })).getText(URL_A),
    ).rejects.toThrow();
  });
});
