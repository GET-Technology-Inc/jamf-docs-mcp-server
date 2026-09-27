/**
 * A SearchProvider result whose field is `null`, or of another type than
 * `SearchResult` declares, no longer fails the search it is in.
 *
 * A provider's results are taken as given, and one built from untyped rows (a
 * database, a vector index's metadata) can hand over a `NULL` for any field.
 * #348 read a mistyped `mapTitle` or `crossFiled` as absent, in the tool, and
 * no other field. Offline over MCP, until 2026-09-28 one such result among
 * well-typed ones failed the whole search:
 *
 *  - `version`, `docType`, `mapId`, `contentId`, `otherVersions` or a
 *    `breadcrumb` step `null`: "Output validation error" (`isError`), since
 *    structuredContent no longer matched the published outputSchema.
 *  - `breadcrumb: null`: "Search error: Cannot read properties of null
 *    (reading 'length')" in every format; `mapId` or `contentId` `null`, the
 *    same in markdown.
 *  - `otherVersions: 42`, or a `null` row: "No results found", with no
 *    `isError`, because the service threw collapsing versions and the tool
 *    reports a failed search as an empty one. So did a provider answering
 *    `undefined`, where the interface says `null` falls through.
 *  - `mapTitle: null` on a result a product search relabels (a Jamf Routines
 *    page the provider reported as Jamf Pro): "Search error: Cannot read
 *    properties of null (reading 'indexOf')". #348's check ran in the tool,
 *    after the service had already read the field.
 *  - `title`, `snippet` or `url` `null`: a "Search error" or an output
 *    validation error in every format.
 *  - No `product` at all: "**Product**: undefined" in the markdown.
 *
 * Core now reads a provider's results before anything else does. What it does
 * with each field is in test names below; the rule for the optional ones is
 * derived from the published outputSchema, so a field declared there later is
 * covered with no change here (see the case that walks the declared keys). An
 * answer whose every result is left out is read as `null`, so a query the
 * provider matched is not answered "No results found".
 *
 * Every case drives the registered tool over MCP with the real search service.
 * The client lists the tools first, so it checks every structuredContent
 * against the published outputSchema.
 */

import { describe, it, expect } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { registerSearchTool } from '../../../src/core/tools/search.js';
import { MapsRegistry } from '../../../src/core/services/maps-registry.js';
import { TopicResolver } from '../../../src/core/services/topic-resolver.js';
import { createMockContext, createMockCache, createMockLogger } from '../../helpers/mock-context.js';
import type { HttpClient } from '../../../src/core/http-client.js';
import type { LoggerFactory, SearchProvider } from '../../../src/core/services/interfaces/index.js';
import type { FtClusteredSearchResponse, FtMapInfo, SearchResult } from '../../../src/core/types.js';
import type { ServerContext } from '../../../src/core/types/context.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

const CLUSTERED_SEARCH = 'https://learn.jamf.com/api/khub/clustered-search';

/** A well-typed result that sets every field, for the others to differ from. */
const WHOLE: Required<SearchResult> = {
  title: 'Shared iPad User Management',
  url: 'https://learn.jamf.com/r/en-US/jamf-pro-documentation-current/Shared_iPad_User_Management',
  snippet: 'Before you begin, see Prepare Shared iPad in Apple documentation.',
  product: 'Jamf Pro',
  version: '11.32.0',
  docType: 'documentation',
  mapId: 'A4LI4vM0BILraYeOD89WGg',
  contentId: 'qMdiBY1MH5H6C_QwTkbvnQ',
  breadcrumb: ['Managing Mobile Devices', 'Shared iPad with Jamf Pro'],
  mapTitle: 'Jamf Pro Documentation 11.32.0',
  crossFiled: true,
  otherVersions: ['11.31.0'],
};

/** A second, unrelated result, so a case can see the rest of the page survive. */
const NEIGHBOUR: SearchResult = {
  title: 'Policies',
  url: 'https://learn.jamf.com/r/en-US/jamf-pro-documentation-current/Policies',
  snippet: 'Policies allow you to remotely automate common management tasks on managed computers.',
  product: 'Jamf Pro',
};

const REQUIRED = ['title', 'url', 'snippet', 'product'] as const;
const OPTIONAL = Object.keys(WHOLE).filter(k => !(REQUIRED as readonly string[]).includes(k));

/** `WHOLE` with the given fields replaced, as untyped provider data. */
function row(patch: Record<string, unknown>): SearchResult {
  return { ...WHOLE, ...patch };
}

/** The Jamf Routines map, which `product: "jamf-routines"` is filtered by. */
const ROUTINES_MAP: FtMapInfo = {
  id: 'KZPj~dq3drzOQ5V8vP1Brw',
  title: 'Jamf Routines Documentation',
  mapApiEndpoint: '/api/khub/maps/KZPj~dq3drzOQ5V8vP1Brw',
  metadata: [
    { key: 'ft:locale', label: 'ft:locale', values: ['en-US'] },
    { key: 'bundle', label: 'bundle', values: ['jamf-routines-documentation'] },
  ],
};

/** One clustered-search entry, for the cases where Fluid Topics must answer. */
const FT_RESPONSE: FtClusteredSearchResponse = {
  facets: [],
  announcements: [],
  paging: { currentPage: 1, isLastPage: true, totalResultsCount: 1, totalClustersCount: 1 },
  results: [{
    metadataVariableAxis: 'version',
    entries: [{
      type: 'TOPIC',
      missingTerms: [],
      topic: {
        mapId: 'A4LI4vM0BILraYeOD89WGg',
        contentId: 'Fs1K7t0QnXq0XbkZ~aF3xw',
        tocId: 'toc-policies',
        title: 'Policies',
        htmlTitle: 'Policies',
        mapTitle: 'Jamf Pro Documentation 11.32.0',
        breadcrumb: ['Policies'],
        htmlExcerpt: '<span class="kwicstring">Policies allow you to remotely automate common management '
          + 'tasks on managed computers.</span>',
        metadata: [
          { key: 'ft:clusterId', label: 'ft:clusterId', values: ['jamf-pro-documentation-current/Policies'] },
          { key: 'ft:locale', label: 'ft:locale', values: ['en-US'] },
          { key: 'ft:prettyUrl', label: 'ft:prettyUrl', values: ['en-US/jamf-pro-documentation-current/Policies'] },
          { key: 'jamf:portal', label: 'jamf:portal', values: ['Jamf Pro'] },
        ],
      },
    }],
  }],
};

// ── Harness ─────────────────────────────────────────────────────────────────

interface Harness {
  ctx: ServerContext;
  /** Every request made to learn.jamf.com's search. */
  searches: number;
  /**
   * Every warning the search service logged. The other-source search logs
   * its own, that its sources are offline here, and they are not collected.
   */
  warnings: string[];
  /** Every debug line the search service logged that names the provider. */
  debugs: string[];
}

/** A SearchProvider whose `search` answers `answer`, as a promise unless `sync`. */
function backends(answer: unknown, { sync = false } = {}): Harness {
  const harness: Harness = { ctx: undefined as unknown as ServerContext, searches: 0, warnings: [], debugs: [] };
  const offline = (url: string): Error => new Error(`offline: no fixture for ${url}`);
  const http: HttpClient = {
    getText: async url => await Promise.reject(offline(url)),
    getJson: async url => await Promise.reject(offline(url)),
    postJson: async <T>(url: string) => {
      if (url !== CLUSTERED_SEARCH) { throw offline(url); }
      harness.searches += 1;
      return await Promise.resolve(FT_RESPONSE as T);
    },
  };
  const logger: LoggerFactory = {
    createLogger: (name: string) => ({
      ...createMockLogger(),
      warning: (message: unknown) => {
        if (name === 'search-service') { harness.warnings.push(String(message)); }
      },
      debug: (message: unknown) => {
        if (name === 'search-service' && String(message).startsWith('SearchProvider')) {
          harness.debugs.push(String(message));
        }
      },
    }),
  };
  const cache = createMockCache();
  const mapsRegistry = new MapsRegistry(
    cache, undefined, { getMaps: async () => await Promise.resolve([ROUTINES_MAP]) }, undefined, http,
  );
  harness.ctx = createMockContext({
    cache, http, logger, mapsRegistry,
    topicResolver: new TopicResolver(mapsRegistry, cache, undefined, undefined, http),
    // An untyped provider can answer without a promise, and `await` reads
    // that value as it would the promise's.
    searchProvider: {
      search: sync
        ? (() => answer) as unknown as SearchProvider['search']
        : async () => await Promise.resolve(answer as SearchResult[] | null),
    },
  });
  return harness;
}

interface TextContent { type: 'text'; text: string }
type Row = Record<string, unknown>;

interface Reply {
  text: string;
  results: Row[];
  /** The published outputSchema's result keys. */
  declared: string[];
}

async function callSearch(ctx: ServerContext, args: Record<string, unknown>): Promise<Reply> {
  const server = new McpServer({ name: 'test-server', version: '0.0.1' });
  registerSearchTool(server, ctx);
  const client = new Client({ name: 'test-client', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    // Listed first, so the client checks structuredContent against the
    // published outputSchema and rejects a reply that does not match it.
    const { tools } = await client.listTools();
    const schema = tools.find(t => t.name === 'jamf_docs_search')?.outputSchema as {
      properties: { results: { items: { properties: Row } } };
    };
    const result = await client.callTool({ name: 'jamf_docs_search', arguments: { query: 'shared ipad', ...args } });
    const { text } = result.content[0] as TextContent;
    expect(result.isError, text).not.toBe(true);
    return {
      text,
      results: (result.structuredContent as { results: Row[] }).results,
      declared: Object.keys(schema.properties.results.items.properties).sort(),
    };
  } finally {
    await client.close();
    await server.close();
  }
}

/** The three formats a client can ask for, each checked against the schema. */
const FORMATS = [
  { responseFormat: 'json' },
  { responseFormat: 'markdown' },
  { responseFormat: 'markdown', outputMode: 'compact' },
] as const;

function jsonResults(reply: Reply): Row[] {
  return (JSON.parse(reply.text) as { results: Row[] }).results;
}

// ── Cases ───────────────────────────────────────────────────────────────────

describe('a SearchProvider optional field that is not of its declared type is read as absent', () => {
  it.each([
    ['null', Object.fromEntries(OPTIONAL.map(k => [k, null]))],
    ['of another type', {
      version: 11.32, docType: 'Technical Documentation', mapId: 42, contentId: { id: 'x' },
      breadcrumb: 'Managing Mobile Devices', mapTitle: 42, crossFiled: 'yes', otherVersions: 42,
    }],
    ['an array holding another type', { breadcrumb: [null, 'Shared iPad'], otherVersions: [null] }],
  ])('every one of them %s: the search succeeds, and no channel carries them', async (_label, patch) => {
    const { ctx } = backends([row(patch), NEIGHBOUR]);
    const dropped = Object.keys(patch);

    for (const format of FORMATS) {
      const reply = await callSearch(ctx, format);
      expect(reply.results.map(r => r.title)).toEqual([WHOLE.title, NEIGHBOUR.title]);
      const [first] = reply.results;
      for (const field of dropped) {
        expect(first, `${field} in ${JSON.stringify(format)}`).not.toHaveProperty(field);
      }
      if (format.responseFormat === 'json') {
        const [firstInText] = jsonResults(reply);
        for (const field of dropped) {
          expect(firstInText).not.toHaveProperty(field);
        }
      } else {
        expect(reply.text).not.toMatch(/null|undefined|\[object Object\]/);
      }
    }
  });

  it('whichever field it is: every key the outputSchema declares is checked, so a field declared later is too', async () => {
    const { ctx } = backends([]);
    const { declared } = await callSearch(ctx, { responseFormat: 'json' });
    expect(declared).toEqual(Object.keys(WHOLE).sort());

    for (const field of declared) {
      const { ctx: fieldCtx, warnings, debugs } = backends([row({ [field]: null }), NEIGHBOUR]);
      const reply = await callSearch(fieldCtx, { responseFormat: 'json' });
      const text = jsonResults(reply);
      if (field === 'url') {
        // A result with no url is dropped (see below); its neighbour stays.
        expect(reply.results.map(r => r.title)).toEqual([NEIGHBOUR.title]);
        expect(warnings.join('\n'), field).toContain('left out 1 of 2 results');
        continue;
      }
      expect(reply.results[0], field).toBeDefined();
      expect(Object.values(reply.results[0] ?? {}), field).not.toContain(null);
      if (field === 'product') {
        // The one field `SearchResult` lets be null: an unclassified result.
        expect([...warnings, ...debugs], field).toEqual([]);
        continue;
      }
      if ((REQUIRED as readonly string[]).includes(field)) {
        // Given a stand-in: a warning.
        expect(warnings.join('\n'), field).toContain(field);
        continue;
      }
      expect(reply.results[0], field).not.toHaveProperty(field);
      expect(text[0], field).not.toHaveProperty(field);
      // A null optional field is how a database row says "absent": debug.
      expect(warnings, field).toEqual([]);
      expect(debugs.join('\n'), field).toContain(field);
    }
  });

  it('one of another type is logged as a warning, and one that is null at debug', async () => {
    const mistyped = backends([row({ version: 11.32, mapTitle: null })]);
    await callSearch(mistyped.ctx, { responseFormat: 'json' });

    expect(mistyped.warnings).toHaveLength(1);
    expect(mistyped.warnings[0]).toContain('version');
    expect(mistyped.warnings[0]).not.toContain('mapTitle');
    expect(mistyped.debugs).toHaveLength(1);
    expect(mistyped.debugs[0]).toContain('mapTitle');
    expect(mistyped.debugs[0]).not.toContain('version');
  });

  it('a docType that is not one of the document types is read as absent, as Fluid Topics reads an unknown label', async () => {
    // Without this a docType filter compared the provider's own label with
    // the ids and dropped the result, where one with no docType passes.
    const { ctx } = backends([row({ docType: 'Technical Documentation' })]);

    const reply = await callSearch(ctx, { responseFormat: 'json', docType: 'documentation' });

    expect(reply.results).toHaveLength(1);
    expect(reply.results[0]).not.toHaveProperty('docType');
  });
});

describe('a SearchProvider result whose required field is not of its declared type', () => {
  it('with no url string is left out, the rest of the page is returned, and a warning names it', async () => {
    const { ctx, warnings } = backends([row({ url: null }), NEIGHBOUR, row({ url: 42, title: 'Numbered' })]);

    for (const format of FORMATS) {
      const reply = await callSearch(ctx, format);
      expect(reply.results.map(r => r.title)).toEqual([NEIGHBOUR.title]);
    }
    const json = await callSearch(ctx, { responseFormat: 'json' });
    expect(JSON.parse(json.text)).toMatchObject({ total: 1, pagination: { totalItems: 1 } });
    expect(warnings.some(w => w.includes('url'))).toBe(true);
  });

  it('with no title string is titled "Untitled", as a Fluid Topics result without one is', async () => {
    const { ctx } = backends([row({ title: null })]);

    const json = await callSearch(ctx, { responseFormat: 'json' });
    const markdown = await callSearch(ctx, {});

    expect(json.results[0]).toMatchObject({ title: 'Untitled', url: WHOLE.url });
    expect(jsonResults(json)[0]).toMatchObject({ title: 'Untitled' });
    expect(markdown.text).toContain(`### [Untitled](${WHOLE.url})`);
  });

  it('with no snippet string gets the snippet a Fluid Topics result with a short excerpt gets', async () => {
    const { ctx } = backends([row({ snippet: null }), row({ snippet: 42, title: 'Numbered', url: NEIGHBOUR.url })]);

    for (const format of FORMATS) {
      const reply = await callSearch(ctx, format);
      expect(reply.results.map(r => r.snippet)).toEqual([
        `${WHOLE.title} — Jamf Pro`,
        'Numbered — Jamf Pro',
      ]);
    }
  });

  it('with no product string has none, as a Fluid Topics result with no classification has none', async () => {
    const { ctx } = backends([row({ product: 42 }), { ...NEIGHBOUR, product: undefined }]);

    const json = await callSearch(ctx, { responseFormat: 'json' });
    const markdown = await callSearch(ctx, {});

    // '' where the schema declares a string, null in the serialised result.
    expect(json.results.map(r => r.product)).toEqual(['', '']);
    expect(jsonResults(json).map(r => r.product)).toEqual([null, null]);
    expect(markdown.text).not.toContain('**Product**');
  });
});

describe('a SearchProvider answer that is not an array of results', () => {
  it('drops each entry that is not a result, and keeps the others', async () => {
    const { ctx, warnings } = backends([null, 'Policies', 42, NEIGHBOUR]);

    for (const format of FORMATS) {
      const reply = await callSearch(ctx, format);
      expect(reply.results.map(r => r.title)).toEqual([NEIGHBOUR.title]);
    }
    expect(warnings).toHaveLength(FORMATS.length);
  });

  it.each([
    ['undefined', undefined, {}],
    ['undefined, not in a promise', undefined, { sync: true }],
    ['an object', { results: [NEIGHBOUR] }, {}],
    ['a list whose every result is left out', [null, row({ url: null }), row({ url: 42 })], {}],
  ])('is read as null when it is %s: the Fluid Topics search answers, and a warning says why', async (_label, answer, how) => {
    const harness = backends(answer, how);

    const reply = await callSearch(harness.ctx, { responseFormat: 'json' });

    expect(harness.searches).toBe(1);
    expect(reply.results.map(r => r.url)).toEqual(['https://learn.jamf.com/r/en-US/jamf-pro-documentation-current/Policies']);
    expect(JSON.parse(reply.text)).toMatchObject({ relevanceNote: expect.stringContaining('Fluid Topics') as unknown });
    expect(harness.warnings).toHaveLength(1);
  });

  it('a plain null is the documented fall-through: the Fluid Topics search answers, and nothing is logged', async () => {
    const harness = backends(null);

    const reply = await callSearch(harness.ctx, { responseFormat: 'json' });

    expect(harness.searches).toBe(1);
    expect(reply.results).toHaveLength(1);
    expect([...harness.warnings, ...harness.debugs]).toEqual([]);
  });

  it('an empty list is the provider\'s own "no results": Fluid Topics is not asked', async () => {
    const harness = backends([]);

    const reply = await callSearch(harness.ctx, { responseFormat: 'json' });

    expect(harness.searches).toBe(0);
    expect(reply.results).toEqual([]);
    expect(harness.warnings).toEqual([]);
  });

  it('a list not in a promise is read as the promise\'s would be', async () => {
    const harness = backends([row({ version: null }), NEIGHBOUR], { sync: true });

    const reply = await callSearch(harness.ctx, { responseFormat: 'json' });

    expect(harness.searches).toBe(0);
    expect(reply.results.map(r => r.title)).toEqual([WHOLE.title, NEIGHBOUR.title]);
    expect(reply.results[0]).not.toHaveProperty('version');
  });
});

describe('a product search reads the provider results after they are checked', () => {
  it('a Jamf Routines page the provider reported as Jamf Pro, with a null mapTitle, is shown under Jamf Routines', async () => {
    // showUnderProduct reads mapTitle to decide `crossFiled`, and threw on
    // null. #348's check in the tool came after it.
    const routines = {
      title: 'Routines Overview',
      url: 'https://learn.jamf.com/r/en-US/jamf-routines-documentation/Routines_Overview',
      snippet: 'Jamf Routines lets you automate multi-step workflows across your fleet.',
      product: 'Jamf Pro',
      mapTitle: null,
    } as unknown as SearchResult;
    const { ctx } = backends([routines]);

    for (const format of FORMATS) {
      const reply = await callSearch(ctx, { ...format, query: 'routines', product: 'jamf-routines' });
      expect(reply.results).toEqual([{
        title: 'Routines Overview', url: routines.url, snippet: routines.snippet, product: 'Jamf Routines',
      }]);
    }
  });
});

describe('a well-typed SearchProvider result', () => {
  it('reaches every channel as it was returned, with nothing logged', async () => {
    const { ctx, warnings } = backends([WHOLE, NEIGHBOUR]);

    const json = await callSearch(ctx, { responseFormat: 'json' });

    expect(json.results).toEqual([WHOLE, NEIGHBOUR]);
    expect(jsonResults(json)).toEqual([WHOLE, NEIGHBOUR]);
    expect(warnings).toEqual([]);
  });
});
