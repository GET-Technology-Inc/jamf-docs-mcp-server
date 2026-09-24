/**
 * What a client reads from `jamf_docs_glossary_lookup` when learn.jamf.com
 * fails: the registered tool over MCP, with the real glossary service and
 * formatter, and only the two Fluid Topics calls mocked.
 *
 * Until 2026-09-24 a lookup that could not reach the glossary answered
 * `No glossary entries found for "MDM".` with `isError` unset — the reply for
 * a term the glossary does not have. Reproduced over stdio with
 * learn.jamf.com behind a proxy answering 503, and with it unreachable
 * (`fetch failed`). A partly fetched answer said nothing either: with one
 * definition failing, `MDM` came back as "Found 1 match" and `Automated
 * Device Enrollment` as `device enrollment`.
 */

import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

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
import { createMockContext, createMockCache } from '../../helpers/mock-context.js';
import {
  GLOSSARY_MAP_ID,
  LIVE_GLOSSARY_TOC,
  glossaryEntryUrl,
  http503,
  serveGlossaryContent,
} from '../../helpers/glossary-upstream.js';
import type { FtMapInfo } from '../../../src/core/types.js';
import type { ServerContext } from '../../../src/core/types/context.js';

const mockedFetchMapToc = vi.mocked(fetchMapToc);
const mockedFetchTopicContent = vi.mocked(fetchTopicContent);

interface TextContent { type: 'text'; text: string }

interface CallResult {
  isError?: boolean;
  content: unknown[];
  structuredContent?: Record<string, unknown>;
}

function textOf(result: CallResult): string {
  return (result.content[0] as TextContent).text;
}

const GLOSSARY_MAP: FtMapInfo = {
  id: GLOSSARY_MAP_ID,
  title: 'Jamf Platform Technical Glossary',
  mapApiEndpoint: `/api/khub/maps/${GLOSSARY_MAP_ID}`,
  metadata: [
    { key: 'version_bundle_stem', label: 'version_bundle_stem', values: ['jamf-technical-glossary'] },
    { key: 'ft:locale', label: 'ft:locale', values: ['en-US'] },
  ],
};

/** Titles whose `/content` answers 503. */
let failingTitles = new Set<string>();
/** What the maps registry's `fetchMaps` does on its next call. */
const fetchMaps = vi.fn<() => Promise<FtMapInfo[]>>();

let ctx: ServerContext;
let server: McpServer;
let client: Client;

beforeAll(async () => {
  server = new McpServer({ name: 'test', version: '0.0.1' });
  // One context for the whole suite, as a running server has: what one call
  // caches, the next one reads.
  const cache = createMockCache();
  ctx = createMockContext({ cache, mapsRegistry: new MapsRegistry(cache, fetchMaps) });
  registerGlossaryLookupTool(server, ctx);

  client = new Client({ name: 'test-client', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  // The client checks structuredContent against the published outputSchema
  // only for tools it has listed.
  await client.listTools();
});

afterAll(async () => {
  await client.close();
  await server.close();
});

beforeEach(async () => {
  vi.clearAllMocks();
  await ctx.cache.clear();
  ctx.mapsRegistry.reset();
  failingTitles = new Set();
  fetchMaps.mockResolvedValue([GLOSSARY_MAP]);
  mockedFetchMapToc.mockResolvedValue(LIVE_GLOSSARY_TOC);
  mockedFetchTopicContent.mockImplementation(serveGlossaryContent(() => failingTitles));
});

async function lookup(args: Record<string, unknown>): Promise<CallResult> {
  return await client.callTool({ name: 'jamf_docs_glossary_lookup', arguments: args }) as CallResult;
}

/** The checks every "the glossary could not be read" reply must pass. */
function expectUnreadable(result: CallResult, term: string): string {
  const text = textOf(result);
  expect(result.isError).toBe(true);
  expect(text).toMatch(new RegExp(`^Glossary lookup for "${term}" failed: `));
  expect(text).toContain('This is not a "no match"');
  expect(text).not.toContain('No glossary entries found');
  // The generic error advice. Wrong for an outage: no other term would help.
  expect(text).not.toContain('use different search terms');
  expect(result.structuredContent).toBeUndefined();
  return text;
}

describe('learn.jamf.com failing is an error, not "No glossary entries found"', () => {
  it('when the map list cannot be fetched (network error)', async () => {
    fetchMaps.mockRejectedValueOnce(
      new TypeError('fetch failed', { cause: Object.assign(new Error('connect'), { code: 'ECONNREFUSED' }) }),
    );

    const text = expectUnreadable(await lookup({ term: 'MDM' }), 'MDM');

    expect(text).toContain(
      'the list of documentation maps, which says where the glossary is, could not be fetched ' +
      'from learn.jamf.com (a network error: ECONNREFUSED).',
    );
    expect(text).toContain('This may be temporary: try again in a moment.');
  });

  it('when the glossary TOC answers 503, in either response format', async () => {
    mockedFetchMapToc.mockRejectedValue(
      http503(`https://learn.jamf.com/api/khub/maps/${GLOSSARY_MAP_ID}/toc`),
    );

    for (const responseFormat of ['markdown', 'json']) {
      const text = expectUnreadable(
        await lookup({ term: 'Automated Device Enrollment', responseFormat }),
        'Automated Device Enrollment',
      );
      expect(text).toContain(
        "the glossary's table of contents could not be fetched from learn.jamf.com " +
        '(HTTP 503 Service Unavailable).',
      );
    }
  });

  it('when every matching definition answers 503', async () => {
    failingTitles = new Set(['mobile device management (MDM)', 'User Approved MDM']);

    const text = expectUnreadable(await lookup({ term: 'MDM' }), 'MDM');

    expect(text).toContain('none of their definitions could be fetched');
  });

  it("when the term's own entry fails and a neighbour would answer in its place", async () => {
    failingTitles = new Set(['Automated Device Enrollment']);

    const text = expectUnreadable(
      await lookup({ term: 'Automated Device Enrollment' }),
      'Automated Device Enrollment',
    );

    expect(text).toContain('the entry whose title names it, Automated Device Enrollment, could not be fetched');
  });

  it('answers normally once learn.jamf.com recovers: no failure was cached', async () => {
    fetchMaps.mockRejectedValueOnce(http503('https://learn.jamf.com/api/khub/maps'));
    expect((await lookup({ term: 'MDM' })).isError).toBe(true);

    mockedFetchMapToc.mockRejectedValueOnce(
      http503(`https://learn.jamf.com/api/khub/maps/${GLOSSARY_MAP_ID}/toc`),
    );
    expect((await lookup({ term: 'MDM' })).isError).toBe(true);

    failingTitles = new Set(['mobile device management (MDM)', 'User Approved MDM']);
    expect((await lookup({ term: 'MDM' })).isError).toBe(true);

    failingTitles = new Set();
    const recovered = await lookup({ term: 'MDM' });
    expect(recovered.isError).not.toBe(true);
    expect(recovered.structuredContent?.totalMatches).toBe(2);
  });
});

describe('a partly fetched answer says what it may be missing', () => {
  const unfetched = [{ term: 'User Approved MDM', url: glossaryEntryUrl('User Approved MDM') }];
  const message =
    'Could not fetch 1 of the 2 glossary entries whose titles are close to "MDM" from ' +
    'learn.jamf.com (HTTP 503 Service Unavailable): User Approved MDM. These results may be ' +
    'missing its definition. This may be temporary: repeat the lookup, or fetch it with ' +
    'jamf_docs_get_article.';

  beforeEach(() => {
    failingTitles = new Set(['User Approved MDM']);
  });

  it('in markdown, above the definitions, with a link to the missing entry', async () => {
    const result = await lookup({ term: 'MDM' });
    const text = textOf(result);

    expect(result.isError).not.toBe(true);
    expect(text).toContain('Found 1 match\n\n> **Results may be incomplete.** Could not fetch 1 of the 2');
    expect(text).toContain(`> Not fetched: [User Approved MDM](${glossaryEntryUrl('User Approved MDM')})`);
    expect(text.indexOf('Results may be incomplete')).toBeLessThan(text.indexOf('### mobile device management'));
  });

  it('in compact markdown', async () => {
    const text = textOf(await lookup({ term: 'MDM', outputMode: 'compact' }));

    expect(text).toContain('> **Results may be incomplete.**');
    expect(text).toContain('> Not fetched: [User Approved MDM]');
  });

  it('in the JSON text and in structuredContent', async () => {
    const result = await lookup({ term: 'MDM', responseFormat: 'json' });
    const json = JSON.parse(textOf(result)) as Record<string, unknown>;

    expect(result.isError).not.toBe(true);
    expect(json.incomplete).toEqual({ unfetched, message });
    expect(result.structuredContent?.incomplete).toEqual({ unfetched, message });
    expect(result.structuredContent?.totalMatches).toBe(1);
  });
});

describe('a glossary that was read keeps today\'s replies', () => {
  it('a term with no entry is still "No glossary entries found", not an error', async () => {
    const result = await lookup({ term: 'Smart Group' });

    expect(result.isError).not.toBe(true);
    expect(textOf(result)).toContain('No glossary entries found for "Smart Group".');
    expect(result.structuredContent).toEqual({
      term: 'Smart Group',
      totalMatches: 0,
      entries: [],
      truncated: false,
    });
  });

  it('a whole read carries no incomplete note on any channel', async () => {
    const markdown = await lookup({ term: 'MDM' });
    const json = await lookup({ term: 'MDM', responseFormat: 'json' });

    expect(textOf(markdown)).not.toContain('incomplete');
    expect(markdown.structuredContent).not.toHaveProperty('incomplete');
    expect(JSON.parse(textOf(json))).not.toHaveProperty('incomplete');
  });
});

describe('the description says which reply is which', () => {
  it('lists a failed read under Errors and "No glossary entries found" as not an error', async () => {
    const { tools } = await client.listTools();
    const description = tools.find(t => t.name === 'jamf_docs_glossary_lookup')?.description ?? '';
    const errors = description.slice(description.indexOf('Errors:'), description.indexOf('Note: "No glossary'));
    const returns = description.slice(description.indexOf('Returns:'), description.indexOf('Examples:'));

    expect(errors).toContain('Glossary lookup for "<term>" failed');
    expect(errors).toContain('(isError)');
    expect(errors).not.toContain('No glossary entries found');
    expect(description).toContain('Note: "No glossary entries found" is not an error.');
    expect(returns).toContain('"incomplete"');
  });
});
