/**
 * How many times one `jamf_docs_list_products` call asks learn.jamf.com for a
 * maps list that cannot be read: once, with its retries, whichever half of
 * the reply needs it.
 *
 * The server here is the one the Node entry builds (`createNodeContext`):
 * the real http client, with its retries, the real MapsRegistry, metadata
 * service and Intercom reader, and an in-memory cache. Only `fetch` is
 * stubbed, and it answers the maps list with a 503.
 *
 * Until 2026-09-28 a call asked twice. The publication half read the
 * registry, which could not be built, and `MapsRegistry` keeps no failure;
 * then the product half asked it again for the versions and the
 * availability map, and built the same failure a second time, with every
 * retry again. That was 2 requests at the default MAX_RETRIES=0 and 8 at
 * MAX_RETRIES=3, each waiting on an endpoint that had just failed. The
 * product half now builds its stand-ins from the failure the publication
 * half met, as #345 builds them from one it meets itself, and keeps them for
 * the same minute.
 */

import { vi, describe, it, expect, afterEach } from 'vitest';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createMcpServer } from '../../../src/core/create-server.js';
import { createDefaultConfig } from '../../../src/core/config.js';
import { createNodeContext } from '../../../src/platforms/node/context.js';
import { STATIC_DOC_SOURCES } from '../../../src/core/constants/sources.js';
import { createMockCache, createMockLoggerFactory } from '../../helpers/mock-context.js';
import type { FtMapInfo } from '../../../src/core/types.js';

const MAPS_LIST = 'https://learn.jamf.com/api/khub/maps';

interface Incomplete { unavailable: string[]; message: string }

interface ListResult {
  isError?: boolean;
  structuredContent?: {
    products: { id: string; availableVersions: string[]; hasContent: boolean }[];
    publications: { id: string }[];
    incomplete?: Incomplete;
  };
}

/** One Jamf Pro map, so that a registry that answers has a version to report. */
const MAPS: FtMapInfo[] = [{
  id: 'map-pro',
  title: 'Jamf Pro Documentation 11.32.0',
  mapApiEndpoint: '/api/khub/maps/map-pro',
  metadata: [
    { key: 'version_bundle_stem', label: 'version_bundle_stem', values: ['jamf-pro-documentation'] },
    { key: 'version', label: 'version', values: ['11.32.0'] },
    { key: 'latestVersion', label: 'latestVersion', values: ['yes'] },
    { key: 'ft:locale', label: 'ft:locale', values: ['en-US'] },
    { key: 'jamf:portal', label: 'jamf:portal', values: ['Jamf Pro'] },
  ],
}];

/** support.jamf.com's home page in every locale, listing one collection. */
const SUPPORT_HOME = `<html><body><script id="__NEXT_DATA__" type="application/json">${
  JSON.stringify({ props: { pageProps: { home: { collections: [{
    id: '12369024', slug: 'jamf-pro', name: 'Jamf Pro',
    url: 'https://support.jamf.com/en/collections/12369024-jamf-pro', articleCount: 3,
  }] } } } })
}</script></body></html>`;

const SUPPORT_HOMES = new Set(Object.values(STATIC_DOC_SOURCES['jamf-support'].locales)
  .map(code => `https://support.jamf.com/${code}/`));

/** The no-network guard the setup file installs. */
const guardedFetch = globalThis.fetch;

afterEach(() => {
  vi.stubGlobal('fetch', guardedFetch);
  vi.useRealTimers();
});

interface Upstream {
  /** Requests for the maps list, answered or not. */
  mapsRequests: () => number;
  setMapsUp: (up: boolean) => void;
}

/** Serve support.jamf.com, and the maps list with a 503 until it is set up. */
function serve(): Upstream {
  let mapsRequests = 0;
  let mapsUp = false;
  vi.stubGlobal('fetch', async (input: string | URL): Promise<Response> => {
    const url = String(input);
    if (url === MAPS_LIST) {
      mapsRequests++;
      return mapsUp
        ? Response.json(MAPS)
        : new Response('', { status: 503, statusText: 'Service Unavailable' });
    }
    if (SUPPORT_HOMES.has(url)) { return await Promise.resolve(new Response(SUPPORT_HOME)); }
    return new Response('', { status: 404, statusText: 'Not Found' });
  });
  return {
    mapsRequests: () => mapsRequests,
    setMapsUp: (up) => { mapsUp = up; },
  };
}

interface Running {
  listProducts: () => Promise<ListResult>;
  close: () => Promise<void>;
}

/** A server on the Node context, retrying a failed request `maxRetries` times, 1 ms apart. */
async function start(maxRetries: number): Promise<Running> {
  const defaults = createDefaultConfig();
  const config = createDefaultConfig({ request: { ...defaults.request, maxRetries, retryDelay: 1 } });
  const ctx = createNodeContext({ config, logger: createMockLoggerFactory(), cache: createMockCache() });
  const server = createMcpServer(ctx);
  const client = new Client({ name: 'list-products-one-registry-read', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  // Listed first, so every structuredContent is checked against its schema.
  await client.listTools();
  return {
    listProducts: async () => await client.callTool({
      name: 'jamf_docs_list_products', arguments: { responseFormat: 'json' },
    }) as ListResult,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

describe('one list_products call asks for a maps list that cannot be read once', () => {
  it.each([
    [0, 1],
    [3, 4],
  ])('at MAX_RETRIES=%i, a cold call makes %i requests for it', async (maxRetries, attempts) => {
    const upstream = serve();
    const running = await start(maxRetries);
    try {
      const result = await running.listProducts();

      expect(upstream.mapsRequests()).toBe(attempts);
      // And the reply is the one both halves' own reads gave: each half is
      // the stand-in for the registry, and the note says so of both.
      expect(result.isError).toBeFalsy();
      const incomplete = result.structuredContent?.incomplete;
      expect(incomplete?.unavailable).toEqual(['maps-registry']);
      expect(incomplete?.message).toContain('The publication list has none of the documents published there.');
      expect(incomplete?.message).toContain('Product versions are compiled-in defaults.');
      expect(incomplete?.message).toContain('Every product is assumed to have a table of contents.');
      expect(incomplete?.message).toContain('This may be temporary: try again in a minute.');
      const jamfPro = result.structuredContent?.products.find(p => p.id === 'jamf-pro');
      expect(jamfPro?.availableVersions).toEqual(['current']);
      expect(jamfPro?.hasContent).toBe(true);
    } finally {
      await running.close();
    }
  });

  it('keeps the product half\'s stand-ins a minute, as when it met the failure itself', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const upstream = serve();
    const running = await start(0);
    try {
      await running.listProducts();
      expect(upstream.mapsRequests()).toBe(1);

      // Inside the minute the publication half asks again, as it always has:
      // it is the read that says whether the registry answers now.
      vi.setSystemTime(Date.now() + 59_000);
      const inside = await running.listProducts();
      expect(upstream.mapsRequests()).toBe(2);
      expect(inside.structuredContent?.incomplete?.message).toContain('Product versions are compiled-in defaults.');

      // Past it, the stand-ins are built again, and still from the one
      // failure the call met.
      vi.setSystemTime(Date.now() + 2_000);
      const past = await running.listProducts();
      expect(upstream.mapsRequests()).toBe(3);
      expect(past.structuredContent?.incomplete?.message).toContain('Every product is assumed to have a table of contents.');

      // Recovered: the publication half builds the registry, and the product
      // half is rebuilt from it in memory, with no request of its own.
      upstream.setMapsUp(true);
      const recovered = await running.listProducts();
      expect(upstream.mapsRequests()).toBe(4);
      expect(recovered.structuredContent).not.toHaveProperty('incomplete');
      expect(recovered.structuredContent?.products.find(p => p.id === 'jamf-pro')?.availableVersions)
        .toEqual(['11.32.0']);
    } finally {
      await running.close();
    }
  });
});
