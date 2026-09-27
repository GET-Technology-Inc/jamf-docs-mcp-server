/**
 * A MapsProvider map whose field is `null`, or of another type than
 * `FtMapInfo` declares, no longer costs every other map.
 *
 * A provider's answer is taken as given, like a SearchProvider's results
 * (search-provider-mistyped-fields.test.ts has the rule). The registry is built
 * from every map at once, so until 2026-09-28 one bad map was every map's
 * problem. Offline over MCP:
 *
 *  - a `null` map, a `metadata` that is not an array, a `null` metadata entry
 *    or one whose `values` is `null`: the registry could not be built.
 *    `jamf_docs_list_products` then listed no publication at all and said
 *    "The maps registry on learn.jamf.com could not be read", and
 *    `jamf_docs_get_toc` by `publication` failed with "Cannot destructure
 *    property 'metadata' of 'map' as it is null" or "metadata?.find is not a
 *    function".
 *  - a `title` that is not a string: `jamf_docs_list_products` failed with
 *    "Output validation error" (`isError`) in every format.
 *  - an answer that is not an array: the registry could not be built.
 *
 * Now a map without an `id` string is left out, and the rest are read. A
 * `title` that is not a string is read as absent, as is a `metadata` that is
 * not an array, and a metadata entry without a `key` string and a `values`
 * array of strings is left out of it. An answer that is not an array, or
 * whose every map is left out, is read as none, and the registry reads the
 * maps on learn.jamf.com instead, as it does without a MapsProvider.
 *
 * Every case drives the registered tools over MCP with a real MapsRegistry.
 */

import { describe, it, expect, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { registerListProductsTool } from '../../../src/core/tools/list-products.js';
import { registerGetTocTool } from '../../../src/core/tools/get-toc.js';
import { MapsRegistry } from '../../../src/core/services/maps-registry.js';
import { createMockCache, createMockContext } from '../../helpers/mock-context.js';
import type { HttpClient } from '../../../src/core/http-client.js';
import type { FetchTocResult, FtMapInfo } from '../../../src/core/types.js';
import type { ServerContext } from '../../../src/core/types/context.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

const meta = (key: string, ...values: string[]): { key: string; label: string; values: string[] } =>
  ({ key, label: key, values });

const PRO: FtMapInfo = {
  id: 'A4LI4vM0BILraYeOD89WGg',
  title: 'Jamf Pro Documentation 11.32.0',
  mapApiEndpoint: '/api/khub/maps/A4LI4vM0BILraYeOD89WGg',
  metadata: [
    meta('version_bundle_stem', 'jamf-pro-documentation'),
    meta('bundle', 'jamf-pro-documentation-current'),
    meta('version', '11.32.0'),
    meta('latestVersion', 'yes'),
    meta('ft:locale', 'en-US'),
    meta('jamf:portal', 'Jamf Pro'),
  ],
};

const LAPS: FtMapInfo = {
  id: '1ZN5bkFvUa6baRoUXR6Zog',
  title: 'Local Administrator Password Solution for Jamf Pro',
  mapApiEndpoint: '/api/khub/maps/1ZN5bkFvUa6baRoUXR6Zog',
  metadata: [
    meta('bundle', 'technical-paper-laps-current'),
    meta('ft:locale', 'en-US'),
    meta('jamf:portal', 'Jamf Pro'),
  ],
};

/** A publication of its own, for a bad map to be the only map of. */
const SSO: FtMapInfo = {
  id: 'cS8LDqz0Nk~sJdAXkL5kWA',
  title: 'Single Sign-On with Jamf Pro',
  mapApiEndpoint: '/api/khub/maps/cS8LDqz0Nk~sJdAXkL5kWA',
  metadata: [
    meta('bundle', 'technical-paper-sso-current'),
    meta('ft:locale', 'en-US'),
    meta('jamf:portal', 'Jamf Pro'),
  ],
};

const TOC: FetchTocResult = {
  toc: [{ title: 'Use LAPS', url: 'https://learn.jamf.com/r/en-US/technical-paper-laps-current/Using_LAPS' }],
  pagination: { page: 1, pageSize: 50, totalPages: 1, totalItems: 1, hasNext: false, hasPrev: false },
  tokenInfo: { tokenCount: 10, truncated: false, maxTokens: 5000 },
};

// ── Harness ─────────────────────────────────────────────────────────────────

interface Harness {
  ctx: ServerContext;
  /** Every read of the maps on learn.jamf.com, which a usable answer makes unneeded. */
  ftMapFetches: () => number;
}

/** A MapsProvider answering `maps`, and learn.jamf.com serving `ftMaps`. */
function context(maps: unknown, ftMaps: FtMapInfo[] = []): Harness {
  const offline = (url: string): Error => new Error(`offline: no fixture for ${url}`);
  const http: HttpClient = {
    getText: async url => await Promise.reject(offline(url)),
    getJson: async url => await Promise.reject(offline(url)),
    postJson: async url => await Promise.reject(offline(url)),
  };
  const fetchMaps = vi.fn(async () => await Promise.resolve(ftMaps));
  const cache = createMockCache();
  const ctx = createMockContext({
    cache, http,
    mapsRegistry: new MapsRegistry(
      cache, fetchMaps, { getMaps: async () => await Promise.resolve(maps as FtMapInfo[]) }, undefined, http,
    ),
    tocProvider: { getTableOfContents: async () => await Promise.resolve(TOC) },
  });
  return { ctx, ftMapFetches: () => fetchMaps.mock.calls.length };
}

interface TextContent { type: 'text'; text: string }
type Row = Record<string, unknown>;
interface Reply { text: string; sc: Row; isError: boolean }

async function call(ctx: ServerContext, name: string, args: Row): Promise<Reply> {
  const server = new McpServer({ name: 'test-server', version: '0.0.1' });
  registerListProductsTool(server, ctx);
  registerGetTocTool(server, ctx);
  const client = new Client({ name: 'test-client', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    // Listed first, so the client checks structuredContent against the
    // published outputSchema and rejects a reply that does not match it.
    await client.listTools();
    const result = await client.callTool({ name, arguments: args });
    const { text } = result.content[0] as TextContent;
    return { text, sc: (result.structuredContent ?? {}) as Row, isError: result.isError === true };
  } finally {
    await client.close();
    await server.close();
  }
}

async function callTool(ctx: ServerContext, name: string, args: Row): Promise<Reply> {
  const reply = await call(ctx, name, args);
  expect(reply.isError, reply.text).toBe(false);
  return reply;
}

interface Catalogue {
  publications: { id: string; title: string }[];
  incomplete?: { unavailable: string[] };
}

async function catalogue(ctx: ServerContext): Promise<Catalogue> {
  return (await callTool(ctx, 'jamf_docs_list_products', { responseFormat: 'json' })).sc as unknown as Catalogue;
}

function titleOf(c: Catalogue, id: string): string | undefined {
  return c.publications.find(p => p.id === id)?.title;
}

// ── Cases ───────────────────────────────────────────────────────────────────

describe('a MapsProvider map core cannot read is left out, and the others are read', () => {
  const withoutId: Partial<FtMapInfo> = { ...SSO };
  delete withoutId.id;

  it.each([
    ['a null map', null],
    ['a string', 'technical-paper-sso'],
    ['a map with a null id', { ...SSO, id: null }],
    ['a map with a numeric id', { ...SSO, id: 42 }],
    ['a map with no id', withoutId],
  ])('%s', async (_label, bad) => {
    const { ctx, ftMapFetches } = context([bad, PRO, LAPS]);

    const listed = await catalogue(ctx);

    expect(listed.incomplete?.unavailable ?? []).not.toContain('maps-registry');
    expect(titleOf(listed, 'jamf-pro-documentation')).toBe(PRO.title);
    expect(titleOf(listed, 'technical-paper-laps')).toBe(LAPS.title);
    const toc = await callTool(ctx, 'jamf_docs_get_toc', { publication: 'technical-paper-laps', responseFormat: 'json' });
    expect(toc.sc).toMatchObject({ publicationId: 'technical-paper-laps', entries: [{ title: 'Use LAPS' }] });
    // Left out: its publication, which no other map has, is not listed, and
    // cannot be asked for. Until 2026-09-28 an id-less map was listed, and
    // reachable only through a TocProvider.
    expect(titleOf(listed, 'technical-paper-sso')).toBeUndefined();
    const sso = await call(ctx, 'jamf_docs_get_toc', { publication: 'technical-paper-sso', responseFormat: 'json' });
    expect(sso.text).toContain('Unknown publication: "technical-paper-sso"');
    expect(ftMapFetches()).toBe(0);
  });
});

describe('a MapsProvider answer the registry cannot use is read as none, and learn.jamf.com answers', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['an object', { maps: [SSO] }],
    ['a string', 'technical-paper-sso'],
    ['a list whose every map is left out', [null, { ...SSO, id: 42 }]],
  ])('%s', async (_label, answer) => {
    const { ctx, ftMapFetches } = context(answer, [PRO, LAPS]);

    const listed = await catalogue(ctx);

    expect(listed.incomplete?.unavailable ?? []).not.toContain('maps-registry');
    expect(titleOf(listed, 'jamf-pro-documentation')).toBe(PRO.title);
    expect(titleOf(listed, 'technical-paper-laps')).toBe(LAPS.title);
    expect(titleOf(listed, 'technical-paper-sso')).toBeUndefined();
    const toc = await callTool(ctx, 'jamf_docs_get_toc', { publication: 'technical-paper-laps', responseFormat: 'json' });
    expect(toc.sc).toMatchObject({ publicationId: 'technical-paper-laps' });
    expect(ftMapFetches()).toBe(1);
  });

  it('but an empty list is the provider\'s own answer: learn.jamf.com is not asked', async () => {
    const { ctx, ftMapFetches } = context([], [PRO, LAPS]);

    const listed = await catalogue(ctx);

    expect(titleOf(listed, 'jamf-pro-documentation')).toBeUndefined();
    expect(titleOf(listed, 'technical-paper-laps')).toBeUndefined();
    expect(ftMapFetches()).toBe(0);
  });
});

describe('a MapsProvider map field that is not of its declared type is read as absent', () => {
  it.each([
    ['null', null],
    ['a number', 42],
  ])('a title that is %s: the publication is listed, untitled', async (_label, title) => {
    const { ctx } = context([PRO, { ...LAPS, title }]);

    for (const format of ['json', 'markdown']) {
      const reply = await callTool(ctx, 'jamf_docs_list_products', { responseFormat: format });
      expect(reply.text).not.toMatch(/\bnull\b|\b42\b/);
    }
    const listed = await catalogue(ctx);
    expect(titleOf(listed, 'technical-paper-laps')).toBe('');
    expect(titleOf(listed, 'jamf-pro-documentation')).toBe(PRO.title);
  });

  it.each([
    ['a number', 42],
    ['an object', { bundle: 'technical-paper-laps-current' }],
  ])('a metadata that is %s: that map has none, and the others are read', async (_label, metadata) => {
    const { ctx } = context([PRO, { ...LAPS, id: 'laps-broken', metadata }, LAPS]);

    const listed = await catalogue(ctx);

    expect(listed.incomplete?.unavailable ?? []).not.toContain('maps-registry');
    expect(titleOf(listed, 'jamf-pro-documentation')).toBe(PRO.title);
    expect(titleOf(listed, 'technical-paper-laps')).toBe(LAPS.title);
  });

  it.each([
    ['null', null],
    ['with null values', { key: 'ft:locale', label: 'ft:locale', values: null }],
    ['with a numeric key', { key: 42, label: 'x', values: ['x'] }],
    ['with a value that is not a string', { key: 'jamf:app', label: 'jamf:app', values: [null] }],
  ])('a metadata entry %s is left out, and the rest of that map is read', async (_label, entry) => {
    const { ctx } = context([PRO, { ...LAPS, metadata: [entry, ...(LAPS.metadata ?? [])] }]);

    const listed = await catalogue(ctx);

    expect(listed.incomplete?.unavailable ?? []).not.toContain('maps-registry');
    expect(titleOf(listed, 'technical-paper-laps')).toBe(LAPS.title);
    const toc = await callTool(ctx, 'jamf_docs_get_toc', { publication: 'technical-paper-laps', responseFormat: 'json' });
    expect(toc.sc).toMatchObject({ publicationId: 'technical-paper-laps' });
  });
});
