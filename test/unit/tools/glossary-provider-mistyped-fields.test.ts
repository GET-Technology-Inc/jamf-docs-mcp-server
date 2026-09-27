/**
 * A GlossaryProvider answer whose field is `null`, or of another type than
 * `GlossaryLookupResult` declares, no longer fails the lookup.
 *
 * A provider's answer is taken as given, like a SearchProvider's results
 * (search-provider-mistyped-fields.test.ts has the rule). Offline over MCP,
 * until 2026-09-28 every field of the answer and of its entries failed the
 * lookup when `null`:
 *
 *  - an entry's `product`, `definition` or `url`, `totalMatches`, or
 *    `truncatedContent`: "Output validation error" (`isError`).
 *  - an entry's `term`: "Glossary lookup error: Cannot read properties of
 *    null (reading 'replace')" in markdown.
 *  - `entries`, a `null` entry, `tokenInfo` or `incomplete`: a "Glossary
 *    lookup error" in every format.
 *
 * Now an optional field that is not of its declared type is read as absent,
 * on every channel. An entry without a `term`, `definition` and `url` string
 * is left out, the others are shown, and `totalMatches` no longer counts it.
 * An answer without a usable `entries`, `totalMatches` or `tokenInfo`, or
 * whose every entry was left out, is read as the provider answering `null`,
 * and the glossary on learn.jamf.com answers. A `null` optional field is
 * logged at debug, and anything else read as absent as a warning.
 *
 * Every case drives the registered tool over MCP with the real glossary
 * service; the Fluid Topics glossary answers from the live titles in
 * test/helpers/glossary-upstream.ts.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../src/core/services/ft-client.js', async (importOriginal) => ({
  ...await importOriginal<typeof FtClientModule>(),
  fetchMapToc: vi.fn(),
  fetchTopicContent: vi.fn(),
}));

import { McpServer } from '@modelcontextprotocol/server';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import type * as FtClientModule from '../../../src/core/services/ft-client.js';
import { fetchMapToc, fetchTopicContent } from '../../../src/core/services/ft-client.js';
import { registerGlossaryLookupTool } from '../../../src/core/tools/glossary-lookup.js';
import { MapsRegistry } from '../../../src/core/services/maps-registry.js';
import { createMockCache, createMockContext, createMockLogger } from '../../helpers/mock-context.js';
import { GLOSSARY_MAP_ID, LIVE_GLOSSARY_TOC, serveGlossaryContent } from '../../helpers/glossary-upstream.js';
import type { LoggerFactory } from '../../../src/core/services/interfaces/index.js';
import type { FtMapInfo, GlossaryLookupResult } from '../../../src/core/types.js';
import type { ServerContext } from '../../../src/core/types/context.js';

const mockedFetchMapToc = vi.mocked(fetchMapToc);
const mockedFetchTopicContent = vi.mocked(fetchTopicContent);

// ── Fixtures ────────────────────────────────────────────────────────────────

const GLOSSARY_MAP: FtMapInfo = {
  id: GLOSSARY_MAP_ID,
  title: 'Jamf Platform Technical Glossary',
  mapApiEndpoint: `/api/khub/maps/${GLOSSARY_MAP_ID}`,
  metadata: [
    { key: 'version_bundle_stem', label: 'version_bundle_stem', values: ['jamf-technical-glossary'] },
    { key: 'ft:locale', label: 'ft:locale', values: ['en-US'] },
  ],
};

const MDM = {
  term: 'MDM (stored)',
  definition: 'Mobile device management, as the provider stores it.',
  url: 'https://learn.jamf.com/r/en-US/jamf-technical-glossary/mobile_device_management_MDM_',
  product: 'Jamf Pro',
};
const UAMDM = {
  term: 'User Approved MDM (stored)',
  definition: 'A macOS security feature that requires explicit user consent.',
  url: 'https://learn.jamf.com/r/en-US/jamf-technical-glossary/User_Approved_MDM',
};

/** A well-typed answer that sets every field. */
const WHOLE: Required<GlossaryLookupResult> = {
  entries: [MDM, UAMDM],
  totalMatches: 3,
  tokenInfo: { tokenCount: 60, truncated: true, maxTokens: 5000 },
  truncatedContent: { omittedCount: 1, omittedItems: [{ title: 'Automated Device Enrollment', estimatedTokens: 40 }] },
  incomplete: {
    unfetched: [{ term: 'device enrollment', url: 'https://learn.jamf.com/r/en-US/jamf-technical-glossary/device_enrollment' }],
    message: 'One entry could not be fetched.',
  },
};

function answer(patch: Record<string, unknown>): GlossaryLookupResult {
  return { ...WHOLE, ...patch };
}

// ── Harness ─────────────────────────────────────────────────────────────────

interface Harness {
  ctx: ServerContext;
  /** Every warning the glossary service logged. */
  warnings: string[];
  /** Every debug line the glossary service logged that names the provider. */
  debugs: string[];
}

function backends(provided: unknown): Harness {
  const harness: Harness = { ctx: undefined as unknown as ServerContext, warnings: [], debugs: [] };
  const logger: LoggerFactory = {
    createLogger: (name: string) => ({
      ...createMockLogger(),
      warning: (message: unknown) => {
        if (name === 'glossary') { harness.warnings.push(String(message)); }
      },
      debug: (message: unknown) => {
        if (name === 'glossary' && String(message).startsWith('GlossaryProvider')) {
          harness.debugs.push(String(message));
        }
      },
    }),
  };
  const cache = createMockCache();
  harness.ctx = createMockContext({
    cache, logger,
    mapsRegistry: new MapsRegistry(cache, async () => await Promise.resolve([GLOSSARY_MAP])),
    glossaryProvider: { lookup: async () => await Promise.resolve(provided as GlossaryLookupResult | null) },
  });
  return harness;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedFetchMapToc.mockResolvedValue(LIVE_GLOSSARY_TOC);
  mockedFetchTopicContent.mockImplementation(serveGlossaryContent(() => new Set()));
});

interface TextContent { type: 'text'; text: string }
type Row = Record<string, unknown>;
interface Reply { text: string; sc: Row & { entries: Row[] } }

async function lookup(ctx: ServerContext, args: Row): Promise<Reply> {
  const server = new McpServer({ name: 'test-server', version: '0.0.1' });
  registerGlossaryLookupTool(server, ctx);
  const client = new Client({ name: 'test-client', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    // Listed first, so the client checks structuredContent against the
    // published outputSchema and rejects a reply that does not match it.
    await client.listTools();
    const result = await client.callTool({ name: 'jamf_docs_glossary_lookup', arguments: { term: 'MDM', ...args } });
    const { text } = result.content[0] as TextContent;
    expect(result.isError, text).not.toBe(true);
    return { text, sc: result.structuredContent as Reply['sc'] };
  } finally {
    await client.close();
    await server.close();
  }
}

const FORMATS = [
  { responseFormat: 'json' },
  { responseFormat: 'markdown' },
  { responseFormat: 'markdown', outputMode: 'compact' },
] as const;

// ── Cases ───────────────────────────────────────────────────────────────────

describe('a GlossaryProvider optional field that is not of its declared type is read as absent', () => {
  it.each([
    ['null', { product: null }, { truncatedContent: null, incomplete: null }],
    ['of another type', { product: 42 }, {
      truncatedContent: { omittedCount: 'one', omittedItems: null },
      incomplete: { unfetched: null, message: null },
    }],
  ])('each of them %s: the provider answers, and no channel carries them', async (label, entryPatch, patch) => {
    const harness = backends(answer({ ...patch, entries: [{ ...MDM, ...entryPatch }, UAMDM] }));

    for (const format of FORMATS) {
      const reply = await lookup(harness.ctx, format);
      expect(reply.sc.entries.map(e => e.term)).toEqual([MDM.term, UAMDM.term]);
      expect(reply.sc.entries[0]).not.toHaveProperty('product');
      expect(reply.sc).not.toHaveProperty('truncatedContent');
      expect(reply.sc).not.toHaveProperty('incomplete');
      if (format.responseFormat === 'json') {
        const json = JSON.parse(reply.text) as Row & { entries: Row[] };
        expect(json.entries[0]).not.toHaveProperty('product');
        expect(json).not.toHaveProperty('truncatedContent');
        expect(json).not.toHaveProperty('incomplete');
      } else {
        expect(reply.text).not.toMatch(/null|undefined|\b42\b/);
      }
    }
    // A null is how a database row says "absent", so it is logged at debug.
    const [logged, quiet] = label === 'null' ? [harness.debugs, harness.warnings] : [harness.warnings, harness.debugs];
    expect(logged).toHaveLength(FORMATS.length);
    expect(logged[0]).toMatch(/product.*truncatedContent.*incomplete|truncatedContent.*incomplete.*product/);
    expect(quiet).toEqual([]);
  });
});

describe('a GlossaryProvider entry without a term, definition or url string', () => {
  it.each(['term', 'definition', 'url'])('%s: is left out, the others are shown, and a warning names it', async field => {
    const harness = backends(answer({ entries: [{ ...MDM, [field]: null }, null, UAMDM] }));

    for (const format of FORMATS) {
      const reply = await lookup(harness.ctx, format);
      expect(reply.sc.entries.map(e => e.term)).toEqual([UAMDM.term]);
    }
    expect(harness.warnings.join('\n')).toContain('2 of 3 entries');
  });

  it('is not counted in totalMatches, so the reply does not count a match it does not show', async () => {
    // Three matches: the two entries given and one the budget left out.
    const harness = backends(answer({ entries: [{ ...MDM, url: null }, UAMDM] }));

    const json = await lookup(harness.ctx, { responseFormat: 'json' });
    const markdown = await lookup(harness.ctx, { responseFormat: 'markdown' });

    expect(json.sc).toMatchObject({ totalMatches: 2, entries: [{ term: UAMDM.term }] });
    expect(JSON.parse(json.text)).toMatchObject({ totalMatches: 2 });
    expect(markdown.text).toContain('Found 2 matches');
    expect(markdown.text).toContain('*1 of 2 match(es)');
  });
});

describe('a GlossaryProvider answer core cannot use is read as null, and the glossary on learn.jamf.com answers', () => {
  it.each([
    ['entries null', { entries: null }],
    ['entries not an array', { entries: MDM }],
    ['every entry left out', { entries: [{ ...MDM, term: null }, null] }],
    ['totalMatches null', { totalMatches: null }],
    ['totalMatches a string', { totalMatches: '3' }],
    ['tokenInfo null', { tokenInfo: null }],
    ['tokenInfo without its counts', { tokenInfo: { truncated: false } }],
  ])('%s', async (_label, patch) => {
    const harness = backends(answer(patch));

    for (const format of FORMATS) {
      const reply = await lookup(harness.ctx, format);
      // The live glossary's own entry, not the provider's "(stored)" one.
      expect(reply.sc.entries[0]?.term).toBe('mobile device management (MDM)');
    }
    expect(mockedFetchMapToc).toHaveBeenCalled();
    expect(harness.warnings).toHaveLength(FORMATS.length);
  });

  it('and so is an answer that is not an object', async () => {
    for (const provided of [undefined, 'MDM', [MDM]]) {
      const harness = backends(provided);
      const reply = await lookup(harness.ctx, { responseFormat: 'json' });
      expect(reply.sc.entries[0]?.term).toBe('mobile device management (MDM)');
      expect(harness.warnings).toHaveLength(1);
    }
  });

  it('a plain null is the documented fall-through, and nothing is logged', async () => {
    const harness = backends(null);

    const reply = await lookup(harness.ctx, { responseFormat: 'json' });

    expect(reply.sc.entries[0]?.term).toBe('mobile device management (MDM)');
    expect([...harness.warnings, ...harness.debugs]).toEqual([]);
  });
});

describe('a well-typed GlossaryProvider answer', () => {
  it('reaches every channel as it was returned, with nothing logged', async () => {
    const harness = backends(WHOLE);

    const reply = await lookup(harness.ctx, { responseFormat: 'json' });

    expect(reply.sc).toMatchObject({
      totalMatches: 3, entries: [MDM, UAMDM], truncated: true,
      truncatedContent: WHOLE.truncatedContent, incomplete: WHOLE.incomplete,
    });
    expect(JSON.parse(reply.text)).toMatchObject({ entries: [MDM, UAMDM], tokenInfo: WHOLE.tokenInfo });
    expect(mockedFetchMapToc).not.toHaveBeenCalled();
    expect(harness.warnings).toEqual([]);
  });
});
