/**
 * Fail a test that reaches an external host, instead of letting it succeed
 * slowly.
 *
 * Several tools now degrade gracefully when an upstream source is
 * unreachable: `list_products` omits its publications, `search` omits its
 * other-source block, `get_toc` reports a lookup failure. That is correct in
 * production and dangerous in a test, because a missing module mock produces
 * a real request whose failure is swallowed — the test passes, a little
 * slower, and nothing says the code under test was never exercised against
 * its fixture. That happened three times while the non-Fluid-Topics sources
 * were being added, and each time the only symptom was a slow test.
 *
 * Scoped by host rather than by directory: a unit test may talk to a server
 * it started itself, which the transport tests do. The integration and e2e
 * tiers reach live Jamf endpoints on purpose and set `ALLOW_LIVE_REQUESTS=1`.
 *
 * A test that needs its own `fetch` may still `vi.stubGlobal('fetch', …)`;
 * that replaces this for the file.
 */

import { vi } from 'vitest';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);

/** The runtime's own fetch, captured before the stub replaces it. */
const realFetch: typeof globalThis.fetch = globalThis.fetch;

function hostOf(input: unknown): string {
  const raw = typeof input === 'string'
    ? input
    : String((input as { url?: string } | undefined)?.url ?? input);
  try {
    return new URL(raw).hostname;
  } catch {
    return '';
  }
}

vi.stubGlobal('fetch', async (input: unknown, init?: unknown): Promise<Response> => {
  const host = hostOf(input);
  if (process.env.ALLOW_LIVE_REQUESTS === '1' || LOCAL_HOSTS.has(host)) {
    return await realFetch(input as Parameters<typeof realFetch>[0], init as Parameters<typeof realFetch>[1]);
  }
  throw new Error(
    `Tests must not reach ${host === '' ? 'an external host' : host} (${String(input)}). ` +
    'Mock the service module, or pass a stub via createMockContext({ ... }). ' +
    'Integration and e2e runs set ALLOW_LIVE_REQUESTS=1.',
  );
});
