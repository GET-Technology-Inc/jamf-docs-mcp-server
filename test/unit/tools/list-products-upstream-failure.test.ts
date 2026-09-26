/**
 * What a client reads from `jamf_docs_list_products` and `jamf://products`
 * when an upstream they list from cannot be read: the registered tool and
 * resource over MCP, with the real metadata service, the real MapsRegistry and
 * the real Intercom reader. Only the two upstreams are stubbed: the
 * `/api/khub/maps` payload and the support.jamf.com home page.
 *
 * Until #335 nothing a client could read said that a reply was a fallback.
 * With the maps registry down, `publications` held the two Jamf Concepts
 * sections under "Every document Jamf publishes", every product reported
 * `['current']` as its versions, and neither channel said so. The product
 * fallback was also cached for 24 hours, so the first reply after the
 * registry recovered listed Jamf Pro's 11.31.0 and 11.30.0 under
 * `publications` while calling Jamf Pro unversioned under `products`.
 */

import { vi, describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { registerListProductsTool } from '../../../src/core/tools/list-products.js';
import { registerResources } from '../../../src/core/resources/index.js';
import { MapsRegistry } from '../../../src/core/services/maps-registry.js';
import { cacheKey } from '../../../src/core/services/cache-key.js';
import { HttpError, type HttpClient } from '../../../src/core/http-client.js';
import { STATIC_SECTIONS } from '../../../src/core/constants/sources.js';
import { TOKEN_CONFIG } from '../../../src/core/constants.js';
import { estimateTokens } from '../../../src/core/services/tokenizer.js';
import { createMockContext, createMockCache } from '../../helpers/mock-context.js';
import type { FtMapInfo } from '../../../src/core/types.js';
import type { ServerContext } from '../../../src/core/types/context.js';

interface TextContent { type: 'text'; text: string }

interface Incomplete { unavailable: string[]; message: string }

interface ProductRow {
  id: string;
  currentVersion: string;
  availableVersions: string[];
  hasContent: boolean;
}

interface ListResult {
  isError?: boolean;
  content: unknown[];
  structuredContent?: {
    products: ProductRow[];
    publications?: { id: string; versions: string[] }[];
    incomplete?: Incomplete;
  };
}

const meta = (key: string, ...values: string[]): { key: string; label: string; values: string[] } =>
  ({ key, label: key, values });

/**
 * Two Jamf Pro maps, as the issue's reproduction serves them. Jamf Pro is the
 * product the fallback gets most wrong: live on 2026-09-26 the registry
 * publishes 20 versions of it, and the fallback reports `['current']`. Every
 * other product is absent here, so once the registry answers, their
 * `hasContent` is false rather than the fallback's optimistic true.
 */
const MAPS: FtMapInfo[] = ['11.31.0', '11.30.0'].map((version, i) => ({
  id: `map-${version}`,
  title: `Jamf Pro Documentation ${version}`,
  mapApiEndpoint: `/api/khub/maps/map-${version}`,
  metadata: [
    meta('version_bundle_stem', 'jamf-pro-documentation'),
    meta('version', version),
    meta('latestVersion', i === 0 ? 'yes' : 'no'),
    meta('ft:locale', 'en-US'),
    meta('jamf:portal', 'Jamf Pro'),
  ],
}));

/** support.jamf.com's home page, reduced to the data the collection reader takes. */
const SUPPORT_HOME = `<html><body><script id="__NEXT_DATA__" type="application/json" nonce="n">${
  JSON.stringify({ props: { pageProps: { home: { collections: [{
    id: '12369024', slug: 'jamf-pro', name: 'Jamf Pro',
    url: 'https://support.jamf.com/en/collections/12369024-jamf-pro', articleCount: 3,
  }] } } } })
}</script></body></html>`;

let registryUp = true;
let supportUp = true;
/** Requests to `/api/khub/maps`, answered or not. */
let registryRequests = 0;

const http: HttpClient = {
  getText: async (url) => {
    if (url !== 'https://support.jamf.com/en/') { throw new Error(`unexpected request: ${url}`); }
    if (!supportUp) { throw new HttpError(503, 'Service Unavailable', url); }
    return await Promise.resolve(SUPPORT_HOME);
  },
  getJson: async (url) => await Promise.reject(new Error(`unexpected request: ${url}`)),
  postJson: async (url) => await Promise.reject(new Error(`unexpected request: ${url}`)),
};

let ctx: ServerContext;
let server: McpServer;
let client: Client;

beforeAll(async () => {
  // One context for the whole suite, as a running server has: what one call
  // caches, the next one reads.
  const cache = createMockCache();
  const mapsRegistry = new MapsRegistry(cache, undefined, {
    getMaps: async () => {
      registryRequests++;
      if (!registryUp) {
        throw new HttpError(503, 'Service Unavailable', 'https://learn.jamf.com/api/khub/maps');
      }
      return await Promise.resolve(MAPS);
    },
  }, undefined, http);
  ctx = createMockContext({ cache, http, mapsRegistry });

  server = new McpServer({ name: 'test', version: '0.0.1' });
  registerListProductsTool(server, ctx);
  registerResources(server, ctx);

  client = new Client({ name: 'test-client', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  // The client checks structuredContent against the published outputSchema
  // only for tools it has listed, and `incomplete` has to pass that check.
  await client.listTools();
});

afterAll(async () => {
  await client.close();
  await server.close();
});

beforeEach(async () => {
  await ctx.cache.clear();
  ctx.mapsRegistry.reset();
  registryUp = true;
  supportUp = true;
  registryRequests = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

async function listProducts(args: Record<string, unknown> = { responseFormat: 'json' }): Promise<ListResult> {
  return await client.callTool({ name: 'jamf_docs_list_products', arguments: args }) as ListResult;
}

function textOf(result: ListResult): string {
  return (result.content[0] as TextContent).text;
}

function jamfPro(result: ListResult): ProductRow | undefined {
  return result.structuredContent?.products.find(p => p.id === 'jamf-pro');
}

function publicationIds(result: ListResult): string[] {
  return (result.structuredContent?.publications ?? []).map(p => p.id);
}

const NOTE = '> **This catalogue is incomplete.** ';

describe('a source that cannot be read is named, not passed off as the whole catalogue', () => {
  it('names the maps registry and support.jamf.com when both are down, on both channels', async () => {
    registryUp = false;
    supportUp = false;

    const result = await listProducts();

    expect(result.isError).toBeFalsy();
    const incomplete = result.structuredContent?.incomplete;
    expect(incomplete?.unavailable).toEqual(['maps-registry', 'jamf-support']);
    expect(incomplete?.message).toContain('learn.jamf.com');
    expect(incomplete?.message).toContain('The publication list has none of the documents published there.');
    expect(incomplete?.message).toContain('Product versions are compiled-in defaults.');
    expect(incomplete?.message).toContain('Every product is assumed to have a table of contents.');
    expect(incomplete?.message).toContain('support.jamf.com');
    expect(incomplete?.message).toContain('try again');
    // The JSON text carries what structuredContent does.
    expect((JSON.parse(textOf(result)) as { incomplete?: Incomplete }).incomplete).toEqual(incomplete);

    // What the reply still holds, which is what `incomplete` qualifies: the
    // compiled-in sources, and the product fallback.
    expect(publicationIds(result)).toEqual(STATIC_SECTIONS.map(({ section }) => section.id));
    expect(jamfPro(result)?.availableVersions).toEqual(['current']);
  });

  it('opens the markdown with the note, and does not call a partial list every document', async () => {
    registryUp = false;
    supportUp = false;
    const { structuredContent } = await listProducts();
    const message = structuredContent?.incomplete?.message ?? '';

    const full = textOf(await listProducts({}));
    expect(full).toContain(`${NOTE}${message}`);
    // Ahead of the catalogue, under the title.
    expect(full.startsWith(`# Jamf Documentation Products\n\n${NOTE}`)).toBe(true);
    expect(full).not.toContain('Every document Jamf publishes');

    const compact = textOf(await listProducts({ outputMode: 'compact' }));
    expect(compact.startsWith(`${NOTE}${message}`)).toBe(true);
  });

  it('keeps the whole note through a maxTokens cut, down to the smallest budget', async () => {
    registryUp = false;
    supportUp = false;
    const { structuredContent } = await listProducts();
    const note = `${NOTE}${structuredContent?.incomplete?.message ?? ''}`;

    // With both sources down the note alone is larger than the smallest
    // budget. It is kept whole, and the catalogue under it gives way.
    for (const outputMode of ['full', 'compact']) {
      const cut = textOf(await listProducts({ outputMode, maxTokens: TOKEN_CONFIG.MIN_TOKENS }));
      expect(cut).toContain(note);
      expect(cut).toContain('Content truncated');
      expect(cut).not.toContain('`jamf-pro`');
    }

    // When the note leaves room, it is charged to the budget like the rest,
    // and the reply stays within it.
    for (const outputMode of ['full', 'compact']) {
      const cut = textOf(await listProducts({ outputMode, maxTokens: 300 }));
      expect(cut).toContain(note);
      expect(cut).toContain('Content truncated');
      expect(estimateTokens(cut)).toBeLessThanOrEqual(300);
    }
  });

  it('names only the maps registry when only it is down', async () => {
    registryUp = false;

    const result = await listProducts();

    expect(result.structuredContent?.incomplete?.unavailable).toEqual(['maps-registry']);
    expect(result.structuredContent?.incomplete?.message).not.toContain('support.jamf.com');
    expect(publicationIds(result)).toContain('jamf-support-jamf-pro');
    expect(publicationIds(result)).not.toContain('jamf-pro-documentation');
  });

  it('names only support.jamf.com when only it is down', async () => {
    supportUp = false;

    const result = await listProducts();

    expect(result.structuredContent?.incomplete?.unavailable).toEqual(['jamf-support']);
    expect(result.structuredContent?.incomplete?.message).not.toContain('learn.jamf.com');
    expect(publicationIds(result)).toContain('jamf-pro-documentation');
    expect(publicationIds(result)).not.toContain('jamf-support-jamf-pro');
    // The product half never needed support.jamf.com.
    expect(jamfPro(result)?.availableVersions).toEqual(['11.31.0', '11.30.0']);

    // A list missing only support.jamf.com is still not every document.
    const full = textOf(await listProducts({}));
    expect(full).toContain(`${NOTE}${result.structuredContent?.incomplete?.message ?? ''}`);
    expect(full).not.toContain('Every document Jamf publishes');
  });

  it('says nothing when every source answered', async () => {
    const result = await listProducts();

    expect(result.structuredContent).not.toHaveProperty('incomplete');
    expect(JSON.parse(textOf(result))).not.toHaveProperty('incomplete');
    const full = textOf(await listProducts({}));
    expect(full).not.toContain(NOTE);
    expect(full).toContain('Every document Jamf publishes');
  });

  it('does not blame the product versions when they are not the fallback', async () => {
    // The products were read while the registry was up and are cached; then
    // the registry's own entry lapses and the next build fails. The
    // publication list loses learn.jamf.com, the products do not, and the
    // note has to say which.
    await listProducts();
    registryUp = false;
    ctx.mapsRegistry.reset();
    await ctx.cache.delete(cacheKey('maps-registry-v3'));

    const result = await listProducts();

    expect(result.structuredContent?.incomplete?.unavailable).toEqual(['maps-registry']);
    expect(jamfPro(result)?.availableVersions).toEqual(['11.31.0', '11.30.0']);
    expect(result.structuredContent?.incomplete?.message).not.toMatch(/version/i);
    expect(result.structuredContent?.incomplete?.message).not.toContain('table of contents');
  });

  // The product versions and the availability map are cached on their own
  // clocks, a day and an hour, so during an outage either can be the stand-in
  // while the other is still what the registry built. The note names only the
  // one that is.
  async function lapseDuringOutage(
    key: 'metadata-products-v2' | 'metadata-product-availability-v2',
  ): Promise<ListResult> {
    await listProducts();
    registryUp = false;
    ctx.mapsRegistry.reset();
    await ctx.cache.delete(cacheKey('maps-registry-v3'));
    await ctx.cache.delete(cacheKey(key));
    return await listProducts();
  }

  it('blames only the product versions when only they are the fallback', async () => {
    const result = await lapseDuringOutage('metadata-products-v2');

    expect(jamfPro(result)?.availableVersions).toEqual(['current']);
    // The availability map the registry built, which does not list Jamf School.
    expect(result.structuredContent?.products.find(p => p.id === 'jamf-school')?.hasContent).toBe(false);
    const message = result.structuredContent?.incomplete?.message;
    expect(message).toContain('Product versions are compiled-in defaults.');
    expect(message).not.toContain('table of contents');
  });

  it('blames only the table-of-contents flags when only they are the fallback', async () => {
    const result = await lapseDuringOutage('metadata-product-availability-v2');

    expect(jamfPro(result)?.availableVersions).toEqual(['11.31.0', '11.30.0']);
    expect(result.structuredContent?.products.find(p => p.id === 'jamf-school')?.hasContent).toBe(true);
    const message = result.structuredContent?.incomplete?.message;
    expect(message).toContain('Every product is assumed to have a table of contents.');
    expect(message).not.toMatch(/version/i);
  });
});

describe('a fallback does not outlive the outage', () => {
  it('answers from the registry on the first call after it recovers (#335 reproduction)', async () => {
    registryUp = false;
    const outage = await listProducts();
    expect(jamfPro(outage)?.availableVersions).toEqual(['current']);
    // The fallback's optimistic availability, for a product the registry
    // does not carry.
    expect(outage.structuredContent?.products.find(p => p.id === 'jamf-school')?.hasContent).toBe(true);

    registryUp = true;
    const recovered = await listProducts();

    // One reply, one registry: the publication list and the product list agree.
    const proDocs = recovered.structuredContent?.publications?.find(p => p.id === 'jamf-pro-documentation');
    expect(proDocs?.versions).toEqual(['11.31.0', '11.30.0']);
    expect(jamfPro(recovered)?.availableVersions).toEqual(['11.31.0', '11.30.0']);
    expect(jamfPro(recovered)?.currentVersion).toBe('11.31.0');
    expect(recovered.structuredContent?.products.find(p => p.id === 'jamf-school')?.hasContent).toBe(false);
    expect(recovered.structuredContent).not.toHaveProperty('incomplete');
  });

  it('waits on a failing registry as little as it can', async () => {
    registryUp = false;

    // Cold: the publication axis asks once, and the product half asks once
    // for both its lookups, which share the build in flight.
    await listProducts();
    expect(registryRequests).toBe(2);

    // Inside the minute: only the publication axis asks. It is the one read
    // that says whether the registry answers now, and it did not, so the
    // product half is served its cached fallback rather than sent back to an
    // endpoint that has just failed.
    await listProducts();
    expect(registryRequests).toBe(3);

    // Recovered: the publication axis builds the registry, and the product
    // half rebuilds from it in memory, with no request of its own.
    registryUp = true;
    const recovered = await listProducts();
    expect(registryRequests).toBe(4);
    expect(jamfPro(recovered)?.availableVersions).toEqual(['11.31.0', '11.30.0']);
    expect(recovered.structuredContent).not.toHaveProperty('incomplete');
  });

  it('keeps jamf://products on the fallback for a minute at most, and uncacheable throughout', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const read = async (): Promise<{
      ttlMs: number | undefined; cacheScope: string | undefined; jamfPro: string[] | undefined;
    }> => {
      const result = await client.readResource({ uri: 'jamf://products' }) as {
        contents: { text: string }[]; ttlMs?: number; cacheScope?: string;
      };
      const body = JSON.parse(result.contents[0]?.text ?? '{}') as { products: { id: string; availableVersions: string[] }[] };
      return {
        ttlMs: result.ttlMs,
        cacheScope: result.cacheScope,
        jamfPro: body.products.find(p => p.id === 'jamf-pro')?.availableVersions,
      };
    };

    registryUp = false;
    expect(await read()).toEqual({ ttlMs: 0, cacheScope: 'private', jamfPro: ['current'] });

    // Inside the minute the resource still serves the cached fallback, and
    // still says it is one: the provenance is stored with the value (#188).
    registryUp = true;
    expect(await read()).toEqual({ ttlMs: 0, cacheScope: 'private', jamfPro: ['current'] });

    // A minute on, the next read tries the registry again. It used to be 24h.
    vi.setSystemTime(Date.now() + 61_000);
    const after = await read();
    expect(after.jamfPro).toEqual(['11.31.0', '11.30.0']);
    expect(after.ttlMs).toBeUndefined();
    expect(after.cacheScope).toBeUndefined();
  });
});
