/**
 * A TocProvider answer whose field is `null`, or of another type than
 * `FetchTocResult` declares, no longer fails the table of contents.
 *
 * A provider's answer is taken as given, like a SearchProvider's results
 * (search-provider-mistyped-fields.test.ts has the rule). Offline over MCP,
 * until 2026-09-28:
 *
 *  - an entry's `contentId`, `mapId`, `paginationNote` or `truncatedEntry`
 *    `null`: "Output validation error" (`isError`) in every format.
 *  - an entry's `title` `null`: "Error fetching table of contents: Cannot
 *    read properties of null (reading 'replace')" in markdown; its `url`, an
 *    output validation error; its `children`, "(reading 'length')".
 *  - `toc` or `pagination` `null`, or a `null` entry: an error in every
 *    format, and `jamf://products/{productId}/toc` threw on `pagination`.
 *    That resource carried every other `null` as sent.
 *  - `tokenInfo` `null`: an error in markdown.
 *  - `resolvedLocale` `null`, asked in ja-JP: "Showing the null edition
 *    instead."
 *
 * Now an optional field that is not of its declared type is read as absent,
 * on every channel. An entry without a `url` string is left out with its
 * sub-entries, and `totalItems` no longer counts them. So, since 2026-09-28,
 * is one whose url is blank or not an absolute https URL: until then it was
 * listed as `- [Nowhere](#)`, under a footer that says to fetch any url
 * above, and is now logged at debug, as a `null` is. One without a `title`
 * string is titled "Untitled", as an entry from Fluid Topics without one is.
 * An answer without a usable `toc`, `pagination` or `tokenInfo`, or whose
 * every entry was left out, is read as the provider answering `null`, and the
 * table of contents on learn.jamf.com answers.
 *
 * Every case drives the registered tool, or the resource, over MCP with the
 * real TOC service; Fluid Topics answers from the fixtures in
 * test/helpers/article-upstream.ts.
 */

import { describe, it, expect } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { registerGetTocTool } from '../../../src/core/tools/get-toc.js';
import { registerResources } from '../../../src/core/resources/index.js';
import { MapsRegistry } from '../../../src/core/services/maps-registry.js';
import { createMockCache, createMockContext, createMockLogger } from '../../helpers/mock-context.js';
import { PRO_MAP, articleUpstream } from '../../helpers/article-upstream.js';
import type { HttpClient } from '../../../src/core/http-client.js';
import type { LoggerFactory } from '../../../src/core/services/interfaces/index.js';
import type { FetchTocResult, FtMapInfo, TocEntry } from '../../../src/core/types.js';
import type { ServerContext } from '../../../src/core/types/context.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

const PRO_DOCS: FtMapInfo = {
  id: PRO_MAP,
  title: 'Jamf Pro Documentation 11.32.0',
  mapApiEndpoint: `/api/khub/maps/${PRO_MAP}`,
  metadata: [
    { key: 'version_bundle_stem', label: 'version_bundle_stem', values: ['jamf-pro-documentation'] },
    { key: 'bundle', label: 'bundle', values: ['jamf-pro-documentation-current'] },
    { key: 'version', label: 'version', values: ['11.32.0'] },
    { key: 'latestVersion', label: 'latestVersion', values: ['yes'] },
    { key: 'ft:locale', label: 'ft:locale', values: ['en-US'] },
  ],
};

const url = (slug: string): string => `https://learn.jamf.com/r/en-US/jamf-pro-documentation-current/${slug}`;

const CHILD: TocEntry = { title: 'Policy Management', url: url('Policy_Management'), contentId: 'KGltaN4o3nLWOd_zhvw~fA', tocId: 'toc-pm' };
const POLICIES: TocEntry = {
  title: 'Policies (stored)', url: url('Policies'), contentId: '0Kv7TU1RQ7Sd8J2yMYv8Ew', tocId: 'toc-policies',
  children: [CHILD],
};
const PROFILES: TocEntry = {
  title: 'Computer Configuration Profiles (stored)', url: url('Computer_Configuration_Profiles'),
  contentId: 'fFa7Mu0YJW87Bs~ZXE_j2Q', tocId: 'toc-ccp',
};

/** A well-typed answer that sets every field. */
const WHOLE: Required<FetchTocResult> = {
  toc: [POLICIES, PROFILES],
  // Every entry, nested ones included, as paginateTocEntries counts them.
  pagination: { page: 1, pageSize: 50, totalPages: 1, totalItems: 3, hasNext: false, hasPrev: false },
  tokenInfo: { tokenCount: 40, truncated: true, maxTokens: 5000 },
  mapId: PRO_MAP,
  paginationNote: 'Page 1 is the only page.',
  truncatedEntry: { title: 'Policies (stored)', shownEntries: 2, totalEntries: 5, estimatedTokens: 90 },
  resolvedLocale: 'en-US',
};

function answer(patch: Record<string, unknown>): FetchTocResult {
  return { ...WHOLE, ...patch };
}

// ── Harness ─────────────────────────────────────────────────────────────────

interface Harness {
  ctx: ServerContext;
  /** Every warning the TOC service logged. */
  warnings: string[];
  /** Every debug line the TOC service logged that names the provider. */
  debugs: string[];
}

function backends(provided: unknown): Harness {
  const upstream = articleUpstream();
  const harness: Harness = { ctx: undefined as unknown as ServerContext, warnings: [], debugs: [] };
  const http: HttpClient = {
    getJson: upstream.getJson as HttpClient['getJson'],
    getText: upstream.getText,
    postJson: async u => await Promise.reject(new Error(`offline: no fixture for ${u}`)),
  };
  const logger: LoggerFactory = {
    createLogger: (name: string) => ({
      ...createMockLogger(),
      warning: (message: unknown) => {
        if (name === 'toc-service') { harness.warnings.push(String(message)); }
      },
      debug: (message: unknown) => {
        if (name === 'toc-service' && String(message).startsWith('TocProvider')) {
          harness.debugs.push(String(message));
        }
      },
    }),
  };
  const cache = createMockCache();
  harness.ctx = createMockContext({
    cache, http, logger,
    mapsRegistry: new MapsRegistry(cache, undefined, { getMaps: async () => await Promise.resolve([PRO_DOCS]) }, undefined, http),
    tocProvider: { getTableOfContents: async () => await Promise.resolve(provided as FetchTocResult | null) },
  });
  return harness;
}

interface TextContent { type: 'text'; text: string }
type Row = Record<string, unknown>;
interface Reply { text: string; sc: Row & { entries: Row[] } }

async function connect(ctx: ServerContext): Promise<{ client: Client; close: () => Promise<void> }> {
  const server = new McpServer({ name: 'test-server', version: '0.0.1' });
  registerGetTocTool(server, ctx);
  registerResources(server, ctx);
  const client = new Client({ name: 'test-client', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  // Listed first, so the client checks structuredContent against the
  // published outputSchema and rejects a reply that does not match it.
  await client.listTools();
  return { client, close: async () => { await client.close(); await server.close(); } };
}

async function getToc(ctx: ServerContext, args: Row): Promise<Reply> {
  const { client, close } = await connect(ctx);
  try {
    const result = await client.callTool({ name: 'jamf_docs_get_toc', arguments: { product: 'jamf-pro', ...args } });
    const { text } = result.content[0] as TextContent;
    expect(result.isError, text).not.toBe(true);
    return { text, sc: result.structuredContent as Reply['sc'] };
  } finally {
    await close();
  }
}

async function readTocResource(ctx: ServerContext): Promise<Row & { toc: Row[] }> {
  const { client, close } = await connect(ctx);
  try {
    const { contents } = await client.readResource({ uri: 'jamf://products/jamf-pro/toc' });
    return JSON.parse((contents[0] as { text: string }).text) as Row & { toc: Row[] };
  } finally {
    await close();
  }
}

const FORMATS = [
  { responseFormat: 'json' },
  { responseFormat: 'markdown' },
  { responseFormat: 'markdown', outputMode: 'compact' },
] as const;

const NOT_A_VALUE = /\bnull\b|undefined|\b42\b|\[object Object\]/;

// ── Cases ───────────────────────────────────────────────────────────────────

describe('a TocProvider optional field that is not of its declared type is read as absent', () => {
  it.each([
    ['null', null],
    ['of another type', 42],
  ])('every one of them %s: the provider answers, and no channel carries them', async (label, value) => {
    const harness = backends(answer({
      mapId: value, paginationNote: value, truncatedEntry: value, resolvedLocale: value,
      toc: [{ ...POLICIES, contentId: value, tocId: value, children: [{ ...CHILD, contentId: value }] },
        { ...PROFILES, children: value }],
    }));

    for (const format of FORMATS) {
      // Asked in another language, so the locale note would name the
      // provider's resolvedLocale if it were read.
      const reply = await getToc(harness.ctx, { ...format, language: 'ja-JP' });
      expect(reply.sc.entries.map(e => e.title)).toEqual([POLICIES.title, CHILD.title, PROFILES.title]);
      expect(reply.sc.entries.filter(e => 'contentId' in e).map(e => e.title)).toEqual([PROFILES.title]);
      expect(reply.sc).not.toHaveProperty('mapId');
      expect(reply.sc).not.toHaveProperty('paginationNote');
      expect(reply.sc).not.toHaveProperty('truncatedEntry');
      expect(reply.sc).not.toHaveProperty('localeNote');
      expect(reply.text).not.toMatch(NOT_A_VALUE);
    }
    expect(JSON.stringify(await readTocResource(harness.ctx))).not.toMatch(NOT_A_VALUE);
    // A null is how a database row says "absent", so it is logged at debug.
    const [logged, quiet] = label === 'null' ? [harness.debugs, harness.warnings] : [harness.warnings, harness.debugs];
    expect(logged.join('\n')).toContain('resolvedLocale');
    expect(quiet).toEqual([]);
  });
});

describe('a TocProvider entry whose required field is not of its declared type', () => {
  it('without a url string is left out with its sub-entries, and a warning says so', async () => {
    const harness = backends(answer({ toc: [{ ...POLICIES, url: null }, null, PROFILES] }));

    for (const format of FORMATS) {
      const reply = await getToc(harness.ctx, format);
      expect(reply.sc.entries.map(e => e.title)).toEqual([PROFILES.title]);
    }
    expect((await readTocResource(harness.ctx)).toc).toEqual([PROFILES]);
    expect(harness.warnings.join('\n')).toContain('left out 2 entries, with their sub-entries');
  });

  it('is not counted in totalItems, and the pages stay as the provider made them', async () => {
    // Page 1 of 2, of a tree of 13 entries: five on this page (POLICIES and
    // its child, PROFILES, Other and its child) and eight on page 2.
    const other = { ...PROFILES, title: 'Other', url: url('Other') };
    const harness = backends(answer({
      toc: [{ ...POLICIES, url: null }, PROFILES, { ...other, children: [{ ...CHILD, url: 42 }] }],
      pagination: { page: 1, pageSize: 3, totalPages: 2, totalItems: 13, hasNext: true, hasPrev: false },
    }));

    const json = await getToc(harness.ctx, { responseFormat: 'json' });
    const markdown = await getToc(harness.ctx, { responseFormat: 'markdown' });

    // Three left out: POLICIES, its child, and Other's child.
    expect(json.sc).toMatchObject({ totalEntries: 10, page: 1, totalPages: 2, hasMore: true });
    expect(json.sc.entries.map(e => e.title)).toEqual([PROFILES.title, 'Other']);
    expect(JSON.parse(json.text)).toMatchObject({ pagination: { totalItems: 10, totalPages: 2, hasNext: true } });
    expect(markdown.text).toContain('10 total entries');
    expect(harness.warnings.join('\n')).toContain('left out 2 entries');
  });

  it('without a title string is titled "Untitled", as a Fluid Topics entry without one is', async () => {
    const harness = backends(answer({ toc: [{ ...POLICIES, title: 42, children: [{ ...CHILD, title: null }] }] }));

    const reply = await getToc(harness.ctx, { responseFormat: 'markdown' });

    expect(reply.sc.entries.map(e => e.title)).toEqual(['Untitled', 'Untitled']);
    expect(reply.text).toContain(`[Untitled](${POLICIES.url})`);
  });
});

describe('a TocProvider entry whose url no link can be made of', () => {
  const UNLINKABLE: [string, string][] = [
    ['empty', ''],
    ['blank', ' '],
    ['http', 'http://learn.jamf.com/r/en-US/jamf-pro-documentation-current/Policies'],
    ['relative', '/r/en-US/jamf-pro-documentation-current/Policies'],
  ];

  it.each(UNLINKABLE)('%s: is left out with its sub-entries on every channel, and a debug line says so', async (_label, bad) => {
    const harness = backends(answer({ toc: [{ ...POLICIES, url: bad }, PROFILES] }));

    for (const format of FORMATS) {
      const reply = await getToc(harness.ctx, format);
      expect(reply.sc.entries.map(e => e.title)).toEqual([PROFILES.title]);
      expect(reply.sc.totalEntries).toBe(1);
      expect(reply.text).not.toContain('](#)');
    }
    expect((await readTocResource(harness.ctx)).toc).toEqual([PROFILES]);
    expect(harness.debugs.join('\n'))
      .toContain('TocProvider: left out 1 entry, with its sub-entries (a url that is not an absolute https URL)');
    expect(harness.warnings).toEqual([]);
  });

  it('as a sub-entry, is left out and its parent kept', async () => {
    const harness = backends(answer({ toc: [{ ...POLICIES, children: [{ ...CHILD, url: '' }] }, PROFILES] }));

    const reply = await getToc(harness.ctx, { responseFormat: 'markdown' });

    expect(reply.sc.entries.map(e => e.title)).toEqual([POLICIES.title, PROFILES.title]);
    expect(reply.sc.totalEntries).toBe(2);
    expect(reply.text).not.toContain('](#)');
    expect(reply.text).toContain(`](${POLICIES.url})`);
  });

  it('on every entry, is read as null, and learn.jamf.com answers', async () => {
    const harness = backends(answer({ toc: UNLINKABLE.map(([, bad]) => ({ ...PROFILES, url: bad })) }));

    const reply = await getToc(harness.ctx, { responseFormat: 'json' });

    expect(reply.sc.entries[0]?.title).toBe('Managing Computers');
    expect(harness.warnings).toHaveLength(1);
  });
});

describe('a TocProvider answer core cannot use is read as null, and learn.jamf.com answers', () => {
  it.each([
    ['toc null', { toc: null }],
    ['toc not an array', { toc: POLICIES }],
    ['every entry left out', { toc: [{ ...POLICIES, url: 42 }, null] }],
    ['pagination null', { pagination: null }],
    ['pagination without its counts', { pagination: { page: 1 } }],
    ['tokenInfo null', { tokenInfo: null }],
    ['tokenInfo a number', { tokenInfo: 40 }],
  ])('%s', async (_label, patch) => {
    const harness = backends(answer(patch));

    for (const format of FORMATS) {
      const reply = await getToc(harness.ctx, format);
      // The fixture's own TOC, not the provider's "(stored)" one.
      expect(reply.sc.entries[0]?.title).toBe('Managing Computers');
      expect(reply.sc.mapId).toBe(PRO_MAP);
    }
    expect((await readTocResource(harness.ctx)).toc[0]).toMatchObject({ title: 'Managing Computers' });
    expect(harness.warnings.length).toBeGreaterThan(0);
  });

  it('and so is an answer that is not an object', async () => {
    for (const provided of [undefined, 'Policies', [POLICIES]]) {
      const harness = backends(provided);
      const reply = await getToc(harness.ctx, { responseFormat: 'json' });
      expect(reply.sc.entries[0]?.title).toBe('Managing Computers');
      expect(harness.warnings).toHaveLength(1);
    }
  });

  it('a plain null is the documented fall-through, and nothing is logged', async () => {
    const harness = backends(null);

    const reply = await getToc(harness.ctx, { responseFormat: 'json' });

    expect(reply.sc.entries[0]?.title).toBe('Managing Computers');
    expect([...harness.warnings, ...harness.debugs]).toEqual([]);
  });
});

describe('a well-typed TocProvider answer', () => {
  it('reaches every channel as it was returned, with nothing logged', async () => {
    const harness = backends(WHOLE);

    const reply = await getToc(harness.ctx, { responseFormat: 'json' });

    expect(reply.sc).toMatchObject({
      mapId: PRO_MAP, totalEntries: 3, paginationNote: WHOLE.paginationNote, truncatedEntry: WHOLE.truncatedEntry,
    });
    expect(reply.sc.entries.map(e => e.title)).toEqual([POLICIES.title, CHILD.title, PROFILES.title]);
    expect(JSON.parse(reply.text)).toMatchObject({ toc: WHOLE.toc, pagination: WHOLE.pagination });
    expect((await readTocResource(harness.ctx)).toc).toEqual(WHOLE.toc);
    // Its resolvedLocale is read: asked in ja-JP, the reply says what it is.
    const ja = await getToc(harness.ctx, { responseFormat: 'json', language: 'ja-JP' });
    expect(ja.sc.localeNote).toContain('Showing the en-US edition instead.');
    expect([...harness.warnings, ...harness.debugs]).toEqual([]);
  });
});
