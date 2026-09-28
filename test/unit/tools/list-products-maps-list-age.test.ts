/**
 * `jamf_docs_list_products` gives Jamf Pro's versions twice: under `products`
 * (`currentVersion`, `availableVersions`) and under `publications`
 * (`jamf-pro-documentation`'s `versions`), and `jamf://products` gives them a
 * third time. All three are read from learn.jamf.com's maps list, so one reply
 * must not give two answers, and the maps list must be no older than
 * `CACHE_TTL_PRODUCTS` however late a server started.
 *
 * Until 2026-09-28 neither held:
 *
 * - The products half was a cache entry of its own, written when it was first
 *   asked for and kept on its own clock (`CACHE_TTL_ARTICLE`, 24 hours by
 *   default). A version published after it was written showed under
 *   `publications` as soon as the maps list was read again, and under
 *   `products` only once that entry expired. Kept for `CACHE_TTL_PRODUCTS`
 *   instead, the gap would be up to 7 days: with the maps list read at 0 and
 *   `list_products` called at 6 days, `publications` had the new version from
 *   7.05 days and `products` from 13.1.
 * - A server that read the maps list from the cache kept it for a whole TTL
 *   from when it read it, not from when it was fetched, so one started 6 days
 *   into the list's week served it until day 13.
 *
 * Built on the context the Node server builds (`createNodeContext`), with every
 * `CACHE_TTL_*` at its default. Only the http client is stubbed, and the cache
 * is an in-memory one; two servers on one cache stand for two processes on one
 * `CACHE_DIR`.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createMcpServer } from '../../../src/core/create-server.js';
import { createNodeContext } from '../../../src/platforms/node/context.js';
import { HttpError, type HttpClient } from '../../../src/core/http-client.js';
import type { CacheProvider } from '../../../src/core/services/interfaces/index.js';
import type { FtMapInfo } from '../../../src/core/types.js';
import { createMockCache, createMockLoggerFactory } from '../../helpers/mock-context.js';
import { MAPS_LIST } from '../../helpers/search-upstream.js';
import { createSupportUpstream } from '../../helpers/support-upstream.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Fake time starts here. The maps list is first read at T0. */
const T0 = Date.UTC(2026, 8, 28);

/** The variables that could change a TTL here. Each is unset, so each default holds. */
const TTL_VARIABLES = ['CACHE_TTL_SEARCH', 'CACHE_TTL_ARTICLE', 'CACHE_TTL_PRODUCTS', 'CACHE_TTL_TOC'];

/** One en-US Jamf Pro map, as `/api/khub/maps` lists it. */
function proMap(version: string, latest: boolean): FtMapInfo {
  const meta = (key: string, ...values: string[]): { key: string; label: string; values: string[] } =>
    ({ key, label: key, values });
  return {
    id: `pro-${version}`,
    title: `Jamf Pro Documentation ${version}`,
    mapApiEndpoint: `/api/khub/maps/pro-${version}`,
    metadata: [
      meta('version_bundle_stem', 'jamf-pro-documentation'),
      meta('version', version),
      meta('latestVersion', latest ? 'yes' : 'no'),
      meta('ft:locale', 'en-US'),
      meta('jamf:portal', 'Jamf Pro'),
    ],
  };
}

const BEFORE = [proMap('11.32.0', true), proMap('11.31.0', false)];
const AFTER = [proMap('11.33.0', true), proMap('11.32.0', false), proMap('11.31.0', false)];

/** What `/api/khub/maps` lists now. */
let maps: FtMapInfo[];
/** Requests to `/api/khub/maps`. */
let mapsRequests: number;

/** learn.jamf.com's maps list, and support.jamf.com's pages, which list_products also reads. */
function upstream(): HttpClient {
  const support = createSupportUpstream();
  return {
    getJson: async <T>(url: string) => {
      if (url !== MAPS_LIST) { throw new HttpError(404, 'Not Found', url); }
      mapsRequests++;
      return await Promise.resolve(structuredClone(maps) as T);
    },
    getText: support.http.getText,
    postJson: async (url) => await Promise.reject(new HttpError(404, 'Not Found', url)),
  };
}

interface Running {
  client: Client;
  close: () => Promise<void>;
}

/** A server on the context the Node server builds, over `cache`. */
async function startServer(cache: CacheProvider): Promise<Running> {
  for (const name of TTL_VARIABLES) { vi.stubEnv(name, undefined); }
  const ctx = createNodeContext({ cache, http: upstream(), logger: createMockLoggerFactory() });
  vi.unstubAllEnvs();

  const server = createMcpServer(ctx);
  const client = new Client({ name: 'test-client', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  await client.listTools();
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

/**
 * Read the maps list without listing products: `jamf://products/{id}/versions`
 * asks the maps registry and nothing else.
 */
async function readMapsList(running: Running): Promise<void> {
  await running.client.readResource({ uri: 'jamf://products/jamf-pro/versions' });
}

interface JamfProVersions {
  /** `list_products`' `products[jamf-pro].availableVersions`. */
  products: string[] | undefined;
  /** `list_products`' `products[jamf-pro].currentVersion`. */
  current: string | undefined;
  /** `list_products`' `publications[jamf-pro-documentation].versions`. */
  publications: string[] | undefined;
  /** `jamf://products`' `products[jamf-pro].availableVersions`. */
  resource: string[] | undefined;
}

/** Jamf Pro's versions, as one `list_products` reply and then `jamf://products` give them. */
async function jamfProVersions(running: Running): Promise<JamfProVersions> {
  const listed = await running.client.callTool({
    name: 'jamf_docs_list_products', arguments: { responseFormat: 'json' },
  }) as {
    structuredContent?: {
      products: { id: string; currentVersion: string; availableVersions: string[] }[];
      publications: { id: string; versions: string[] }[];
    };
  };
  const pro = listed.structuredContent?.products.find(p => p.id === 'jamf-pro');
  const docs = listed.structuredContent?.publications.find(p => p.id === 'jamf-pro-documentation');

  const read = await running.client.readResource({ uri: 'jamf://products' }) as { contents: { text: string }[] };
  const body = JSON.parse(read.contents[0]?.text ?? '{}') as { products: { id: string; availableVersions: string[] }[] };

  return {
    products: pro?.availableVersions,
    current: pro?.currentVersion,
    publications: docs?.versions,
    resource: body.products.find(p => p.id === 'jamf-pro')?.availableVersions,
  };
}

/** What every view gives when all of them read `versions`. */
function agreeing(versions: string[]): JamfProVersions {
  return { products: versions, current: versions[0], publications: versions, resource: versions };
}

const OLD = ['11.32.0', '11.31.0'];
const NEW = ['11.33.0', '11.32.0', '11.31.0'];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  maps = BEFORE;
  mapsRequests = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('one reply gives Jamf Pro one set of versions', () => {
  it.each([
    // What the report reproduced.
    ['6 days after the maps list was read', 6 * DAY],
    // The latest it can be before the maps list is read again.
    ['an hour before the maps list is read again', 7 * DAY - HOUR],
  ])('when list_products was last called %s, and a version is published after', async (_, listedAt) => {
    const running = await startServer(createMockCache());
    try {
      await readMapsList(running);
      vi.setSystemTime(T0 + listedAt);
      expect(await jamfProVersions(running)).toEqual(agreeing(OLD));

      maps = AFTER;
      // Not yet read: the maps list is a week old at 7 days (CACHE_TTL_PRODUCTS).
      vi.setSystemTime(T0 + 7 * DAY - 60_000);
      expect(await jamfProVersions(running)).toEqual(agreeing(OLD));

      for (const at of [7 * DAY + HOUR, 8 * DAY, 10 * DAY, 13 * DAY - HOUR]) {
        vi.setSystemTime(T0 + at);
        expect(await jamfProVersions(running), `at ${String(at / DAY)} days`).toEqual(agreeing(NEW));
      }
      expect(mapsRequests).toBe(2);
    } finally {
      await running.close();
    }
  });
});

describe('a server started late in the maps list\'s life', () => {
  it('reads it again once it is CACHE_TTL_PRODUCTS old, not once it has held it that long', async () => {
    const cache = createMockCache();
    const first = await startServer(cache);
    let second: Running | undefined;
    try {
      await readMapsList(first);
      expect(mapsRequests).toBe(1);

      // Six days on, a second process starts on the same cache and is served
      // the maps list the first one fetched.
      vi.setSystemTime(T0 + 6 * DAY);
      second = await startServer(cache);
      expect(await jamfProVersions(second)).toEqual(agreeing(OLD));
      expect(mapsRequests).toBe(1);

      maps = AFTER;
      vi.setSystemTime(T0 + 7 * DAY + HOUR);
      expect(await jamfProVersions(second)).toEqual(agreeing(NEW));
      expect(mapsRequests).toBe(2);
    } finally {
      await second?.close();
      await first.close();
    }
  });
});
