/**
 * Which source `jamf_docs_list_products`' incomplete note names when the maps
 * registry answers the publication half of the call and then fails the
 * product half's read: over MCP, against a whole server, with a real
 * MapsRegistry and only the http client stubbed.
 *
 * When the publication half's read answers, the product half rebuilds any
 * stand-in it cached (see `MetadataReadOptions.revalidateFallback`), so a
 * stand-in in the reply is always one this call built, because the registry
 * failed in this call. The registry keeps a build in memory for its TTL, so
 * that takes the build to lapse between the two reads; the registry here
 * keeps nothing (a TTL of 0, and a cache that stores nothing), so each read
 * asks again.
 *
 * #362 worded the note by what the registry threw, but only for a throw in
 * the publication half's read. Until 2026-09-28 a stand-in the product half's
 * read forced was always learn.jamf.com's failure. Measured offline that day,
 * before this change: with a MapsProvider that answered the first read and threw "KV
 * namespace unavailable" on the second, and no request sent to learn.jamf.com,
 * the note read "The maps registry on learn.jamf.com could not be read.
 * Product versions are compiled-in defaults. Every product is assumed to have
 * a table of contents. This may be temporary: try again in a minute." A list
 * from learn.jamf.com that was not a list on the second read got the same
 * note, where the publication half's read gets "could not be read" and the
 * server log.
 *
 * The product half now keeps what the registry threw beside the stand-in it
 * built (`DegradationStatus.failure`), and the note is worded from it as it
 * is from the publication half's.
 */

import { describe, it, expect } from 'vitest';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createMcpServer } from '../../../src/core/create-server.js';
import { MapsRegistry } from '../../../src/core/services/maps-registry.js';
import { TopicResolver } from '../../../src/core/services/topic-resolver.js';
import { HttpError, type HttpClient } from '../../../src/core/http-client.js';
import { STATIC_DOC_SOURCES } from '../../../src/core/constants/sources.js';
import { cacheKey } from '../../../src/core/services/cache-key.js';
import { createMockCache, createMockContext } from '../../helpers/mock-context.js';
import type { FtMapInfo } from '../../../src/core/types.js';
import type { ServerContext } from '../../../src/core/types/context.js';
import type { CacheProvider } from '../../../src/core/services/interfaces/index.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

const MAPS_LIST = 'https://learn.jamf.com/api/khub/maps';

const meta = (key: string, ...values: string[]): { key: string; label: string; values: string[] } =>
  ({ key, label: key, values });

const PRO_MAP: FtMapInfo = {
  id: 'A4LI4vM0BILraYeOD89WGg',
  title: 'Jamf Pro Documentation 11.32.0',
  mapApiEndpoint: '/api/khub/maps/A4LI4vM0BILraYeOD89WGg',
  metadata: [
    meta('version_bundle_stem', 'jamf-pro-documentation'),
    meta('bundle', 'jamf-pro-documentation-current'),
    meta('latestVersion', 'yes'),
    meta('ft:locale', 'en-US'),
    meta('jamf:portal', 'Jamf Pro'),
  ],
};

/** A map without an id: the registry leaves it out, so an answer of only this is read as none. */
const NO_ID = { title: 'No id' } as unknown as FtMapInfo;

/** support.jamf.com's home page, reduced to the data the collection reader takes. */
const SUPPORT_HOME = `<html><body><script id="__NEXT_DATA__" type="application/json" nonce="n">${
  JSON.stringify({ props: { pageProps: { home: { collections: [{
    id: '12369024', slug: 'jamf-pro', name: 'Jamf Pro',
    url: 'https://support.jamf.com/en/collections/12369024-jamf-pro', articleCount: 3,
  }] } } } })
}</script></body></html>`;

const SUPPORT_HOMES = new Set(Object.values(STATIC_DOC_SOURCES['jamf-support'].locales)
  .map(code => `https://support.jamf.com/${code}/`));

const KV_DOWN = 'KV namespace unavailable';
const STAND_INS = 'Product versions are compiled-in defaults. Every product is assumed to have a table of contents.';
const UNEXPECTED_FAILURE_ADVICE = 'Trying again may help. If it keeps failing, the server log says what went wrong.';
const MAY_BE_TEMPORARY = 'This may be temporary: try again in a minute.';

// ── Harness ─────────────────────────────────────────────────────────────────

/** What one read of the registry gets: the maps, or what it throws. */
type Read = FtMapInfo[] | 'not a list' | { throws: Error };

interface Upstream {
  /** What the MapsProvider answers on each read, in order. Unset, no MapsProvider is configured. */
  provider?: Read[];
  /** What learn.jamf.com's maps list answers on each read, in order. */
  learn?: Read[];
  /** Whether support.jamf.com's home pages answer. Unset, they do. */
  supportUp?: boolean;
}

interface Harness {
  ctx: ServerContext;
  /** Every request the server made, as `METHOD url`, in order. */
  requests: string[];
  /** How many times the registry asked the provider, and learn.jamf.com. */
  reads: { provider: number; learn: number };
}

/** The answer for the `n`th read, the last one standing for every read after it. */
async function answer(reads: Read[], n: number): Promise<unknown> {
  const read = reads[Math.min(n, reads.length - 1)] ?? [];
  if (read === 'not a list') { return await Promise.resolve({}); }
  if ('throws' in read) { return await Promise.reject(read.throws); }
  return await Promise.resolve(read);
}

function upstream(given: Upstream): Harness {
  const requests: string[] = [];
  const reads = { provider: 0, learn: 0 };
  const offline = (url: string): Error => new Error(`offline: no fixture for ${url}`);
  const http: HttpClient = {
    getJson: async (url: string) => {
      requests.push(`GET ${url}`);
      return await Promise.reject(offline(url));
    },
    getText: async (url) => {
      requests.push(`GET ${url}`);
      if (!SUPPORT_HOMES.has(url)) { throw offline(url); }
      if (given.supportUp === false) { throw new HttpError(503, 'Service Unavailable', url); }
      return await Promise.resolve(SUPPORT_HOME);
    },
    postJson: async (url) => {
      requests.push(`POST ${url}`);
      return await Promise.reject(offline(url));
    },
  };
  const learn = async (): Promise<FtMapInfo[]> => {
    requests.push(`GET ${MAPS_LIST}`);
    return await answer(given.learn ?? [[PRO_MAP]], reads.learn++) as FtMapInfo[];
  };
  const { provider } = given;
  const mapsProvider = provider === undefined
    ? undefined
    : { getMaps: async () => await answer(provider, reads.provider++) as FtMapInfo[] };

  // Keeps nothing, so each read of the registry asks again.
  const keepsNothing: CacheProvider = { ...createMockCache(), get: async () => await Promise.resolve(null) };
  const mapsRegistry = new MapsRegistry(keepsNothing, learn, mapsProvider, 0, http);
  const cache = createMockCache();
  const topicResolver = new TopicResolver(mapsRegistry, cache, undefined, undefined, http);
  return { ctx: createMockContext({ cache, http, mapsRegistry, topicResolver }), requests, reads };
}

async function incompleteOf(ctx: ServerContext): Promise<{ unavailable: string[]; message: string } | undefined> {
  const server = createMcpServer(ctx);
  const client = new Client({ name: 'test-client', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    // Listed first, so the client checks structuredContent against the outputSchema.
    await client.listTools();
    const result = await client.callTool({ name: 'jamf_docs_list_products', arguments: { responseFormat: 'json' } });
    expect(result.isError).not.toBe(true);
    return (result.structuredContent as { incomplete?: { unavailable: string[]; message: string } }).incomplete;
  } finally {
    await client.close();
    await server.close();
  }
}

/** The requests sent to learn.jamf.com, by the host each one is sent to. */
function toLearnJamf(requests: string[]): string[] {
  return requests.filter(r => new URL(r.slice(r.indexOf(' ') + 1)).hostname === 'learn.jamf.com');
}

// ── A MapsProvider ──────────────────────────────────────────────────────────

describe('a MapsProvider that answers the publication half and then fails is named, and learn.jamf.com is not', () => {
  it('with its reason, and no advice while every other source answered', async () => {
    const { ctx, requests, reads } = upstream({ provider: [[PRO_MAP], { throws: new Error(KV_DOWN) }] });

    const incomplete = await incompleteOf(ctx);

    expect(reads.provider).toBe(2);
    expect(incomplete).toEqual({
      unavailable: ['maps-registry'],
      message: `The maps registry could not be read from the configured maps provider (${KV_DOWN}). ${STAND_INS}`,
    });
    expect(toLearnJamf(requests)).toEqual([]);
  });

  it('without a reason: says so', async () => {
    const { ctx } = upstream({ provider: [[PRO_MAP], { throws: new Error('') }] });

    expect((await incompleteOf(ctx))?.message).toBe(
      `The maps registry could not be read from the configured maps provider, which gave no reason. ${STAND_INS}`,
    );
  });

  it('with support.jamf.com down too: the advice is kept for support.jamf.com', async () => {
    const { ctx } = upstream({ provider: [[PRO_MAP], { throws: new Error(KV_DOWN) }], supportUp: false });

    const incomplete = await incompleteOf(ctx);

    expect(incomplete?.unavailable).toEqual(['maps-registry', 'jamf-support']);
    expect(incomplete?.message.startsWith(
      `The maps registry could not be read from the configured maps provider (${KV_DOWN}). ${STAND_INS} `,
    )).toBe(true);
    expect(incomplete?.message).not.toContain('learn.jamf.com');
    expect(incomplete?.message.endsWith(MAY_BE_TEMPORARY)).toBe(true);
  });

  it.each([
    // The availability map is kept for an hour and the product catalogue for
    // a day, so the map is the one that lapses first.
    ['the availability map', 'metadata-product-availability-v2', 'Every product is assumed to have a table of contents.'],
    ['the product catalogue', 'metadata-products-v2', 'Product versions are compiled-in defaults.'],
  ] as const)('when only %s is rebuilt, and the other is served from the cache', async (_label, namespace, standIn) => {
    // Two reads answer the first call; the third answers the second call's
    // publication half, and the fourth, the one entry it rebuilds, fails.
    const { ctx, requests, reads } = upstream({
      provider: [[PRO_MAP], [PRO_MAP], [PRO_MAP], { throws: new Error(KV_DOWN) }],
    });

    expect(await incompleteOf(ctx)).toBeUndefined();
    await ctx.cache.delete(cacheKey(namespace));
    const incomplete = await incompleteOf(ctx);

    expect(reads.provider).toBe(4);
    expect(incomplete).toEqual({
      unavailable: ['maps-registry'],
      message: `The maps registry could not be read from the configured maps provider (${KV_DOWN}). ${standIn}`,
    });
    expect(toLearnJamf(requests)).toEqual([]);
  });

  it('whose second answer the registry cannot use, replaced by learn.jamf.com, which fails: learn.jamf.com\'s note', async () => {
    const { ctx, requests } = upstream({
      provider: [[PRO_MAP], [NO_ID]],
      learn: [{ throws: new HttpError(503, 'Service Unavailable', MAPS_LIST) }],
    });

    expect(await incompleteOf(ctx)).toEqual({
      unavailable: ['maps-registry'],
      message: `The maps registry on learn.jamf.com could not be read. ${STAND_INS} ${MAY_BE_TEMPORARY}`,
    });
    expect(requests).toContain(`GET ${MAPS_LIST}`);
  });
});

// ── Both halves ─────────────────────────────────────────────────────────────

describe('when both halves\' reads fail, and differently, the note names the publication half\'s', () => {
  it('a MapsProvider that throws, then answers with nothing the registry can use and learn.jamf.com 503s', async () => {
    // The publication half's read throws in the provider. The product half's
    // gets an answer it cannot use, so asks learn.jamf.com in its place (#355),
    // which fails: a request, whose note would name learn.jamf.com.
    const { ctx, requests, reads } = upstream({
      provider: [{ throws: new Error(KV_DOWN) }, [NO_ID]],
      learn: [{ throws: new HttpError(503, 'Service Unavailable', MAPS_LIST) }],
    });

    const incomplete = await incompleteOf(ctx);

    expect(reads.provider).toBe(2);
    expect(toLearnJamf(requests)).toEqual([`GET ${MAPS_LIST}`]);
    expect(incomplete).toEqual({
      unavailable: ['maps-registry'],
      message: `The maps registry could not be read from the configured maps provider (${KV_DOWN}). ` +
        `The publication list has none of the documents the maps registry names. ${STAND_INS}`,
    });
  });
});

// ── learn.jamf.com ──────────────────────────────────────────────────────────

describe('learn.jamf.com answering the publication half and then failing', () => {
  it('a request that failed keeps the note it had', async () => {
    const { ctx, reads } = upstream({
      learn: [[PRO_MAP], { throws: new HttpError(503, 'Service Unavailable', MAPS_LIST) }],
    });

    expect(await incompleteOf(ctx)).toEqual({
      unavailable: ['maps-registry'],
      message: `The maps registry on learn.jamf.com could not be read. ${STAND_INS} ${MAY_BE_TEMPORARY}`,
    });
    expect(reads.learn).toBe(2);
  });

  it('a list that is not a list: the words the publication half\'s read gets, and the server log', async () => {
    const { ctx } = upstream({ learn: [[PRO_MAP], 'not a list'] });

    expect(await incompleteOf(ctx)).toEqual({
      unavailable: ['maps-registry'],
      message: `The maps registry could not be read. ${STAND_INS} ${UNEXPECTED_FAILURE_ADVICE}`,
    });
  });
});
