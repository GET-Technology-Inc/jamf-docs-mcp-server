/**
 * `jamf_docs_search` with `product: 'jamf-routines'`, a product Jamf files
 * no documentation under.
 *
 * Jamf names nothing "Jamf Routines" on `jamf:portal`, `jamf:app` or
 * `jamf:utility`. Its one publication, jamf-routines-documentation, is filed
 * under `jamf:portal = Jamf Pro`, so no classification value can separate it
 * from the rest of Jamf Pro. Since #343 the product was therefore left out of
 * the search and reported up front as "not applied". That was the honest
 * answer while none of its topics were in the index (2026-09-18). By
 * 2026-09-26 they were, and a jamf-routines search answered with Jamf Pro's
 * results while the product's own documentation was one filter away. Measured
 * live on main that day over ten queries ("Jamf Routines", "routine",
 * "connection", "create", "delete", "single sign-on", "policy", "scripts",
 * "template", "install"): every reply said the product filter was not
 * applied (`removed: ['product']`), and 33 of the 432 results were Jamf
 * Routines documentation.
 *
 * Fluid Topics files every search entry under the map it came from, as
 * `ft:publicationId`, and that key filters: for "Jamf Routines", 13 entries
 * with it against 26,081 without, every one of them the Routines map or one
 * of its topics. So the product is now filtered by its own publication,
 * whose map ids the registry derives from `/api/khub/maps`.
 *
 * Every case drives the registered tool over MCP with the real search service
 * and a real MapsRegistry. Only Fluid Topics is stubbed, and the stub filters
 * the way `clustered-search` does: filter objects intersect, an entry passes
 * one when its key carries any of the filter's values, and a key Fluid Topics
 * does not know is ignored rather than rejected. That last rule is how most
 * unknown keys behave live: `ft:mapId` and `madeupkey` both returned the
 * unfiltered 26,081 (one with a hyphen in it matches nothing instead). The
 * maps and metadata are the live ones, read on 2026-09-26; titles and
 * snippets are shortened stand-ins.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';

vi.mock('../../../src/core/services/ft-client.js', async (importOriginal) => ({
  ...await importOriginal<typeof FtClientModule>(),
  search: vi.fn(),
}));

import { McpServer } from '@modelcontextprotocol/server';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import type * as FtClientModule from '../../../src/core/services/ft-client.js';
import { search as ftSearch } from '../../../src/core/services/ft-client.js';
import { registerSearchTool } from '../../../src/core/tools/search.js';
import { MapsRegistry } from '../../../src/core/services/maps-registry.js';
import { createMockCache, createMockContext } from '../../helpers/mock-context.js';
import type {
  FtClusteredSearchResponse,
  FtMapInfo,
  FtMetadataEntry,
  FtSearchEntry,
  FtSearchFilter,
  FtSearchRequest,
} from '../../../src/core/types.js';
import type { ServerContext } from '../../../src/core/types/context.js';

const mockedFtSearch = vi.mocked(ftSearch);

interface TextContent { type: 'text'; text: string }

interface StructuredSearch {
  results: { title: string; product: string; url: string }[];
  filters?: Record<string, string>;
  filterRelaxation?: { removed: string[]; original: Record<string, string>; message: string };
}

interface CallResult {
  isError?: boolean;
  content: unknown[];
  structuredContent?: StructuredSearch;
}

// ── The live maps (learn.jamf.com, 2026-09-26) ──────────────────────────────

interface Publication {
  /** The map id, which is also what Fluid Topics files its entries under. */
  id: string;
  title: string;
  bundle: string;
  locale: string;
  portal: string[];
}

/** The Jamf Routines map. The id is the live one. */
const ROUTINES: Publication = {
  id: 'C~Tmp9IxyjJUYOFsJQew8g',
  title: 'Jamf Routines Documentation',
  bundle: 'jamf-routines-documentation',
  locale: 'en-US',
  // Filed under Jamf Pro, like its topics. Nothing is filed as Jamf Routines.
  portal: ['Jamf Pro'],
};

const PRO: Publication = {
  id: 'pro-map',
  title: 'Jamf Pro Documentation',
  bundle: 'jamf-pro-documentation-current',
  locale: 'en-US',
  portal: ['Jamf Pro'],
};

/** A Jamf Pro publication about Jamf Routines, which is not Jamf Routines documentation. */
const PRO_VIDEOS: Publication = {
  id: 'pro-videos-map',
  title: 'Jamf Training and Support Videos: Jamf Pro',
  bundle: 'training-video-shorts-jamf-pro',
  locale: 'en-US',
  portal: ['Jamf Pro'],
};

const PUBLICATIONS = [ROUTINES, PRO, PRO_VIDEOS];

const MAPS: FtMapInfo[] = PUBLICATIONS.map(pub => ({
  id: pub.id,
  title: pub.title,
  mapApiEndpoint: `/api/khub/maps/${pub.id}`,
  metadata: [
    { key: 'ft:locale', label: 'ft:locale', values: [pub.locale] },
    { key: 'bundle', label: 'bundle', values: [pub.bundle] },
    { key: 'ft:publicationId', label: 'ft:publicationId', values: [pub.id] },
    { key: 'jamf:portal', label: 'jamf:portal', values: [...pub.portal] },
    { key: 'jamf:app', label: 'jamf:app', values: [] },
    { key: 'jamf:utility', label: 'jamf:utility', values: [] },
  ],
}));

// ── The corpus the stub searches ────────────────────────────────────────────

/** The metadata every live entry carries that the filters read. */
function entryMetadata(pub: Publication, prettyUrl: string): FtMetadataEntry[] {
  return [
    { key: 'ft:prettyUrl', label: 'URL', values: [prettyUrl] },
    { key: 'ft:publicationId', label: 'ft:publicationId', values: [pub.id] },
    { key: 'zoominmetadata', label: 'zoominmetadata', values: ['content-techdocs', 'product-pro'] },
    { key: 'jamf:portal', label: 'jamf:portal', values: [...pub.portal] },
    { key: 'jamf:app', label: 'jamf:app', values: [] },
    { key: 'jamf:utility', label: 'jamf:utility', values: [] },
  ];
}

/** Snippets are over 50 characters, so none is replaced by the title-and-product fallback. */
function topic(pub: Publication, title: string, snippet: string): FtSearchEntry {
  const contentId = title.replace(/\W+/g, '_');
  return {
    type: 'TOPIC',
    missingTerms: [],
    topic: {
      mapId: pub.id,
      contentId,
      tocId: contentId,
      title,
      htmlTitle: title,
      mapTitle: pub.title,
      breadcrumb: [],
      htmlExcerpt: snippet,
      metadata: entryMetadata(pub, `${pub.locale}/${pub.bundle}/${contentId}`),
    },
  };
}

const CORPUS: FtSearchEntry[] = [
  topic(ROUTINES, 'Jamf Routines', 'Routines automate repetitive device management work across your fleet.'),
  topic(PRO_VIDEOS, 'How to Use Jamf Routines with Jamf Pro', 'A short video that walks through a routine run against computers.'),
  topic(ROUTINES, 'Creating a Routine', 'Choose a template, set its trigger, and save the routine to start it running.'),
  // The one Routines topic that mentions single sign-on.
  topic(ROUTINES, 'Single Sign-On in Jamf Account', 'Sign in to Routines with single sign-on configured for your organisation.'),
  topic(PRO, 'Scripts', 'Add a script to Jamf Pro and run it on computers with a policy payload.'),
  topic(PRO, 'Policies', 'A policy runs a task on a schedule or trigger for the computers in its scope.'),
  {
    type: 'MAP',
    missingTerms: [],
    map: {
      mapId: ROUTINES.id,
      mapUrl: `/r/${ROUTINES.locale}/${ROUTINES.bundle}`,
      readerUrl: `/r/${ROUTINES.locale}/${ROUTINES.bundle}`,
      title: ROUTINES.title,
      htmlTitle: ROUTINES.title,
      htmlExcerpt: 'Overviews of Jamf Routines features and instructions for creating and maintaining routines.',
      metadata: entryMetadata(ROUTINES, `${ROUTINES.locale}/${ROUTINES.bundle}`),
      editorialType: 'book',
      openMode: 'fluidtopics',
    },
  },
];

const ROUTINES_TITLES = ['Jamf Routines', 'Creating a Routine', 'Single Sign-On in Jamf Account', ROUTINES.title];

/**
 * Every key the live `clustered-search` filtered on when asked. Anything else
 * is ignored, as `ft:mapId` is live.
 */
const KNOWN_KEYS = new Set(['jamf:portal', 'jamf:app', 'jamf:utility', 'zoominmetadata', 'ft:publicationId', 'version']);

/** Fluid Topics' filter semantics: objects intersect, values within one union. */
function passes(filter: FtSearchFilter, entry: FtSearchEntry): boolean {
  if (!KNOWN_KEYS.has(filter.key)) { return true; }
  const metadata = entry.topic?.metadata ?? entry.map?.metadata ?? [];
  const carried = metadata.find(m => m.key === filter.key)?.values ?? [];
  return carried.some(value => filter.values.includes(value));
}

function respond(entries: FtSearchEntry[]): FtClusteredSearchResponse {
  return {
    facets: [],
    announcements: [],
    paging: { currentPage: 1, isLastPage: true, totalResultsCount: entries.length, totalClustersCount: 1 },
    results: [{ metadataVariableAxis: '', entries }],
  };
}

/** The filters of every request that reached Fluid Topics, in order. */
let sent: FtSearchFilter[][] = [];

let ctx: ServerContext;
let server: McpServer;
let client: Client;

function connect(maps: FtMapInfo[]): ServerContext {
  const cache = createMockCache();
  return createMockContext({
    cache,
    mapsRegistry: new MapsRegistry(cache, undefined, { getMaps: async () => await Promise.resolve(maps) }),
  });
}

beforeAll(async () => {
  server = new McpServer({ name: 'test', version: '0.0.1' });
  ctx = connect(MAPS);
  registerSearchTool(server, ctx);

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
  sent = [];
  mockedFtSearch.mockImplementation(async (_http, request: FtSearchRequest) => {
    const filters = request.filters ?? [];
    sent.push(filters);
    return await Promise.resolve(respond(CORPUS.filter(entry => filters.every(f => passes(f, entry)))));
  });
});

async function call(args: Record<string, unknown>): Promise<CallResult> {
  return await client.callTool({
    name: 'jamf_docs_search',
    arguments: { query: 'routine', limit: 50, ...args },
  }) as CallResult;
}

async function searchJson(args: Record<string, unknown>): Promise<StructuredSearch> {
  const result = await call({ ...args, responseFormat: 'json' });
  expect(result.isError).toBeUndefined();
  if (result.structuredContent === undefined) {
    throw new Error(`No structuredContent: ${(result.content[0] as TextContent).text}`);
  }
  return result.structuredContent;
}

async function searchMarkdown(args: Record<string, unknown>): Promise<string> {
  return ((await call(args)).content[0] as TextContent).text;
}

const titles = (s: StructuredSearch): string[] => s.results.map(r => r.title);

describe('product: jamf-routines filters by its own publication', () => {
  it('sends the publication upstream and returns only Jamf Routines documentation', async () => {
    const json = await searchJson({ product: 'jamf-routines' });

    expect(sent).toEqual([[{ key: 'ft:publicationId', values: [ROUTINES.id] }]]);
    expect(titles(json)).toEqual(ROUTINES_TITLES);
    // Not "How to Use Jamf Routines with Jamf Pro": that is a Jamf Pro video
    // about Routines, filed under the same `jamf:portal` value, which is why
    // the classification could not tell the two apart.
    expect(json.results.every(r => r.url.includes('/jamf-routines-documentation'))).toBe(true);
    expect(json.filterRelaxation).toBeUndefined();
    expect(json.filters).toEqual({ product: 'jamf-routines' });
    // The filter held, so display follows it, as for any product.
    expect(new Set(json.results.map(r => r.product))).toEqual(new Set(['Jamf Routines']));
  });

  it('says nothing about the filter in markdown, because it held', async () => {
    const markdown = await searchMarkdown({ product: 'jamf-routines' });

    expect(markdown).not.toContain('was not applied');
    expect(markdown).not.toContain('Removed filter');
    expect(markdown).toContain('**Product**: Jamf Routines');
    expect(markdown).not.toContain('**Product**: Jamf Pro');
    // The publication is the product's own and its title says so.
    expect(markdown).not.toContain('**Publication**');
  });

  it('keeps a topic filter that matches within the publication', async () => {
    const json = await searchJson({ product: 'jamf-routines', topic: 'sso' });

    expect(titles(json)).toEqual(['Single Sign-On in Jamf Account']);
    expect(json.filterRelaxation).toBeUndefined();
    expect(json.filters).toEqual({ product: 'jamf-routines', topic: 'sso' });
  });

  it('relaxes the topic, not the product, when the publication has nothing on it', async () => {
    // On main this returned the Jamf Pro "Scripts" topic, reported the
    // product as not applied, and kept the topic. Jamf Routines has no
    // scripts topic, so the honest answer is its documentation with the
    // topic relaxed.
    const json = await searchJson({ product: 'jamf-routines', topic: 'scripts' });

    expect(titles(json)).toEqual(ROUTINES_TITLES);
    expect(json.filterRelaxation).toEqual({
      removed: ['topic'],
      original: { topic: 'scripts' },
      message: expect.stringMatching(/^No results with all filters applied\. Removed filter\(s\): topic\./),
    });
    expect(new Set(json.results.map(r => r.product))).toEqual(new Set(['Jamf Routines']));
  });

  it('keeps the publication filter when an empty docType re-query drops the docType', async () => {
    // Jamf Routines publishes no release notes. The first request comes back
    // empty, the docType is dropped upstream, and the publication stays.
    const json = await searchJson({ product: 'jamf-routines', docType: 'release-notes' });

    expect(sent).toEqual([
      [
        { key: 'ft:publicationId', values: [ROUTINES.id] },
        { key: 'zoominmetadata', values: ['content-releasenotes'] },
      ],
      [{ key: 'ft:publicationId', values: [ROUTINES.id] }],
    ]);
    expect(titles(json)).toEqual(ROUTINES_TITLES);
    expect(json.filterRelaxation?.removed).toEqual(['docType']);
  });

  it('still drops what is not the publication when Fluid Topics ignores the key', async () => {
    // Re-applied locally, as the classification filter is. If Fluid Topics
    // stopped honouring `ft:publicationId` it would return the unfiltered
    // ranking, as it does for any key it does not know, and without the local
    // filter every Jamf Pro result would be shown as Jamf Routines.
    KNOWN_KEYS.delete('ft:publicationId');
    try {
      const json = await searchJson({ product: 'jamf-routines' });

      expect(titles(json)).toEqual(ROUTINES_TITLES);
      expect(json.filterRelaxation).toBeUndefined();
    } finally {
      KNOWN_KEYS.add('ft:publicationId');
    }
  });
});

describe('product: jamf-routines when the registry has no map of its publication', () => {
  // A trimmed maps list served by an injected MapsProvider: there is nothing
  // to filter by, so the product is reported up front as not applied, as it
  // was for every jamf-routines search before.
  let trimmed: ServerContext;
  let trimmedServer: McpServer;
  let trimmedClient: Client;

  beforeAll(async () => {
    trimmedServer = new McpServer({ name: 'test', version: '0.0.1' });
    trimmed = connect(MAPS.filter(map => map.id !== ROUTINES.id));
    registerSearchTool(trimmedServer, trimmed);
    trimmedClient = new Client({ name: 'test-client', version: '0.0.1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([trimmedServer.connect(serverTransport), trimmedClient.connect(clientTransport)]);
    await trimmedClient.listTools();
  });

  afterAll(async () => {
    await trimmedClient.close();
    await trimmedServer.close();
  });

  it('searches unfiltered and says the filter was not applied', async () => {
    const result = await trimmedClient.callTool({
      name: 'jamf_docs_search',
      arguments: { query: 'routine', product: 'jamf-routines', limit: 50, responseFormat: 'json' },
    }) as CallResult;
    const json = result.structuredContent;

    expect(sent).toEqual([[]]);
    expect(json?.results).toHaveLength(CORPUS.length);
    expect(json?.filterRelaxation).toEqual({
      removed: ['product'],
      original: { product: 'jamf-routines' },
      message: expect.stringContaining('The product filter "jamf-routines" was not applied'),
    });
    expect(json?.filterRelaxation?.message).toContain('jamf-routines-documentation');
    // Not re-labelled under a product they were not filtered by.
    expect(json?.results.some(r => r.product === 'Jamf Routines')).toBe(false);
  });
});
