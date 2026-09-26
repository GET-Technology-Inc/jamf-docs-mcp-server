/**
 * What `jamf_docs_search` promises in its outputSchema, against what its
 * structuredContent and its JSON text carry.
 *
 * `SearchOutputSchema` has declared `mapTitle` on every result since #78, and
 * `buildSearchResult` has set it from each Fluid Topics entry since then, but
 * `buildSearchStructuredContent` listed the result fields it copied one by one
 * and `mapTitle` was not on the list. So a client reading structuredContent
 * could not see which publication a result came from, while the JSON text of
 * the same reply, a serialised `SearchResult`, carried it. The same drop was
 * fixed for `mapId`/`contentId` in #200 and for `breadcrumb` in #216.
 *
 * It matters most since #343. A `product` search shows every result under the
 * product searched for, and where that passes another product's document off
 * as its own (a Jamf Trust release-notes topic titled "Windows", shown as
 * Jamf Protect) the markdown names the publication. The result carries
 * `crossFiled` to say so, but the schema never declared it, so
 * structuredContent could carry neither the note nor the publication it names.
 * Measured live on 2026-09-26 with jamf-protect + "install" (limit 50): 44
 * results, 27 with the markdown `**Publication**` note, 44 with `mapTitle` and
 * 27 with `crossFiled` in the JSON text, and 0 of either in structuredContent.
 *
 * The JSON text had a gap of its own: it never carried `otherSources`, which
 * the markdown renders and structuredContent carries. Live, the same search
 * had 3 other-source matches in structuredContent and none in the JSON text.
 *
 * Publishing the two fields exposed one thing main never met: a SearchProvider
 * `mapTitle: null` or `crossFiled: null`, which untyped provider data can
 * carry, would fail the client's check and turn the search into an error. The
 * tool reads such a value as absent, on every channel.
 *
 * Every case drives the registered tool over MCP with the real search
 * service, a real MapsRegistry and, for the second backend, a SearchProvider.
 * The client lists the tools first, so it checks each structuredContent
 * against the published outputSchema, whose result items allow no key they do
 * not declare. The Fluid Topics entries are live ones from 2026-09-26, with
 * shortened excerpts and only the metadata the code reads; the maps carry the
 * live classification of their publications.
 */

import { describe, it, expect, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { registerSearchTool } from '../../../src/core/tools/search.js';
import { MapsRegistry } from '../../../src/core/services/maps-registry.js';
import { TopicResolver } from '../../../src/core/services/topic-resolver.js';
import { createMockContext, createMockCache } from '../../helpers/mock-context.js';
import type { HttpClient } from '../../../src/core/http-client.js';
import type { SearchProvider } from '../../../src/core/services/interfaces/index.js';
import type {
  FtClusteredSearchResponse,
  FtMapInfo,
  FtMetadataEntry,
  FtSearchEntry,
  FtSearchRequest,
  SearchResult,
} from '../../../src/core/types.js';
import type { ServerContext } from '../../../src/core/types/context.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

const CLUSTERED_SEARCH = 'https://learn.jamf.com/api/khub/clustered-search';
const CONCEPTS_SITEMAP = 'https://concepts.jamf.com/sitemap.xml';

const CONCEPTS_SITEMAP_XML = '<urlset>'
  + '<url><loc>https://concepts.jamf.com/en/concepts/reenroller</loc></url>'
  + '<url><loc>https://concepts.jamf.com/en/concepts/setup-manager</loc></url>'
  + '</urlset>';

type Classification = Partial<Record<'jamf:portal' | 'jamf:app', string[]>>;

function meta(entries: Record<string, string[]>): FtMetadataEntry[] {
  return Object.entries(entries).map(([key, values]) => ({ key, label: key, values }));
}

interface Topic {
  title: string;
  mapId: string;
  contentId: string;
  mapTitle: string;
  breadcrumb: string[];
  classification: Classification;
  labels: string[];
  cluster: string;
  prettyUrl: string;
  version?: string;
  excerpt: string;
}

function entry(t: Topic): FtSearchEntry {
  return {
    type: 'TOPIC',
    missingTerms: [],
    topic: {
      mapId: t.mapId,
      contentId: t.contentId,
      tocId: `toc-${t.contentId}`,
      title: t.title,
      htmlTitle: t.title,
      mapTitle: t.mapTitle,
      breadcrumb: t.breadcrumb,
      htmlExcerpt: t.excerpt,
      metadata: meta({
        ...(t.version !== undefined ? { version: [t.version] } : {}),
        'zoominmetadata': t.labels,
        'ft:clusterId': [t.cluster],
        'ft:locale': ['en-US'],
        'ft:prettyUrl': [t.prettyUrl],
        ...t.classification,
      }),
    },
  };
}

const PRO: Classification = { 'jamf:portal': ['Jamf Pro'] };
const SETUP_RESET: Classification = { 'jamf:portal': ['Jamf Pro'], 'jamf:app': ['Jamf Reset', 'Jamf Setup'] };
const TRUST: Classification = {
  'jamf:portal': ['Jamf Safe Internet', 'Jamf Protect'],
  'jamf:app': ['Jamf Connect', 'Jamf Trust'],
};
const PROTECT: Classification = { 'jamf:portal': ['Jamf Protect'] };

/** One Jamf Pro topic in three versions, which the search collapses to one. */
const SHARED_IPAD = ([
  ['11.32.0', 'A4LI4vM0BILraYeOD89WGg', 'jamf-pro-documentation-current'],
  ['11.31.0', 'wqin5wmqOhRZNP0CChQ8MQ', 'jamf-pro-documentation-11.31.0'],
  ['11.14.0', '~hFRs6h0hprrcVO8LN5Qgg', 'jamf-pro-documentation-11.14.0'],
] as const).map(([version, mapId, bundle]): Topic => ({
  title: 'Shared iPad User Management',
  mapId,
  contentId: 'qMdiBY1MH5H6C_QwTkbvnQ',
  mapTitle: `Jamf Pro Documentation ${version}`,
  breadcrumb: [
    'Managing Mobile Devices', 'Settings and Security Management for Mobile Devices',
    'Shared iPad with Jamf Pro', 'Shared iPad User Management',
  ],
  classification: PRO,
  labels: ['content-techdocs', 'product-pro', `product-pro-${version}`],
  cluster: 'jamf-pro-documentation-current/Shared_iPad_User_Management',
  prettyUrl: `en-US/${bundle}/Shared_iPad_User_Management`,
  version,
  excerpt: '<span class="kwicstring">Before you begin, see Prepare </span>'
    + '<span class="kwicmatch">Shared iPad</span><span class="kwicstring"> in Apple documentation.</span>',
}));

/**
 * Filed under Jamf Pro and listed first under Jamf Reset: shown as Jamf Pro in
 * a jamf-pro search, from a publication whose title does not say Jamf Pro.
 * Live, jamf-pro + "Jamf Reset" marked all 46 results cross-filed.
 */
const DEVICE_COMPLIANCE: Topic = {
  title: 'Device Compliance for Shared Devices',
  mapId: '93qDb8Q1dFv86wIpU2KAQg',
  contentId: 'GHQmfRihL9i3_Q4MfD_kWQ',
  mapTitle: 'Jamf Setup and Reset Configuration Guide',
  breadcrumb: ['Jamf Setup', 'Device Compliance for Shared Devices'],
  classification: SETUP_RESET,
  labels: ['content-techdocs', 'product-reset', 'product-pro', 'product-setup'],
  cluster: 'jamf-setup-reset-configuration-guide/Device_Compliance_for_Shared_Devices_Overview',
  prettyUrl: 'en-US/jamf-setup-reset-configuration-guide/Device_Compliance_for_Shared_Devices_Overview',
  excerpt: '<span class="kwicstring">Microsoft&#x27;s Shared Device Mode (SDM) is a feature in Microsoft Entra ID '
    + 'that allows a device to be </span><span class="kwicmatch">shared</span>'
    + '<span class="kwicstring"> among multiple users.</span>',
};

/** The #343 example: a Jamf Trust topic, shown as Jamf Protect's. */
const TRUST_WINDOWS: Topic = {
  title: 'Windows',
  mapId: 'srvzB24iQkhXEgDo4Pmfrw',
  contentId: '~la1AfZOr2UxH12WsiPLeQ',
  mapTitle: 'Jamf Trust Release Notes',
  breadcrumb: ['Windows'],
  classification: TRUST,
  labels: ['product-safeinternet', 'product-connect', 'product-trust', 'content-releasenotes', 'product-protect'],
  cluster: 'jamf-trust-documentation/Jamf_Trust_for_Windows',
  prettyUrl: 'en-US/jamf-trust-documentation/Jamf_Trust_for_Windows',
  excerpt: '<span class="kwicstring">Click Package Log Data to save the contents to the desktop. For </span>'
    + '<span class="kwicmatch">release notes</span><span class="kwicstring"> related to the Jamf Security '
    + 'Cloud portal-based capabilities, see the Jamf Security Cloud Portal Release Notes.</span>',
};

/** Jamf Protect's own release notes: shown under their own product, no note. */
const PROTECT_MACOS: Topic = {
  title: 'macOS Security Release Notes',
  mapId: 'lld4_RvMCcBN870naaePLg',
  contentId: '_J3H6NKbEICeonUiR71zpQ',
  mapTitle: 'Jamf Protect Release Notes',
  breadcrumb: ['macOS Security Release Notes'],
  classification: PROTECT,
  labels: ['content-releasenotes', 'product-protect'],
  cluster: 'jamf-protect-release-notes/macOS_Security_Portal_Release_Notes',
  prettyUrl: 'en-US/jamf-protect-release-notes/macOS_Security_Portal_Release_Notes',
  excerpt: '<span class="kwicstring">Enhancements for the macOS Security portal (Jamf Protect web app) and '
    + 'Jamf Protect agent. For related </span><span class="kwicmatch">release notes</span>'
    + '<span class="kwicstring">, see the following.</span>',
};

const CORPUS: FtSearchEntry[] = [
  ...SHARED_IPAD, DEVICE_COMPLIANCE, TRUST_WINDOWS, PROTECT_MACOS,
].map(entry);

/** One map per publication, carrying the classification its topics carry. */
const MAPS: FtMapInfo[] = ([
  ['Jamf Pro Documentation', 'jamf-pro-documentation', PRO],
  ['Jamf Setup and Reset Configuration Guide', 'jamf-setup-reset-configuration-guide', SETUP_RESET],
  ['Jamf Trust Release Notes', 'jamf-trust-documentation', TRUST],
  ['Jamf Protect Release Notes', 'jamf-protect-release-notes', PROTECT],
] as const).map(([title, bundle, classification], i) => ({
  id: `map-${String(i)}`,
  title,
  mapApiEndpoint: `/api/khub/maps/map-${String(i)}`,
  metadata: meta({ 'ft:locale': ['en-US'], 'bundle': [bundle], ...classification }),
}));

/**
 * A SearchProvider result that sets every field a `SearchResult` has.
 *
 * `Required<SearchResult>` makes a field added to `SearchResult` fail
 * `typecheck:test` here until this sets it, so the cases below always cover
 * every field. Not one live document: a provider can set any of them.
 */
const EVERY_FIELD: Required<SearchResult> = {
  title: 'Device Compliance for Shared Devices',
  url: 'https://learn.jamf.com/en-US/bundle/jamf-setup-reset-configuration-guide/page/Device_Compliance_for_Shared_Devices_Overview.html',
  snippet: "Microsoft's Shared Device Mode (SDM) is a feature in Microsoft Entra ID that allows a device to be shared.",
  product: 'Jamf Pro',
  version: '2.4.0',
  docType: 'documentation',
  mapId: '93qDb8Q1dFv86wIpU2KAQg',
  contentId: 'GHQmfRihL9i3_Q4MfD_kWQ',
  breadcrumb: ['Jamf Setup', 'Device Compliance for Shared Devices'],
  mapTitle: 'Jamf Setup and Reset Configuration Guide',
  crossFiled: true,
  otherVersions: ['2.3.0'],
};

/** Only the fields a `SearchResult` must have, with the null product the API can send. */
const BARE: SearchResult = {
  title: 'Shared iPad User Management',
  url: 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation-current/page/Shared_iPad_User_Management.html',
  snippet: 'Before you begin, see Prepare Shared iPad in Apple documentation.',
  product: null,
};

// ── Harness ─────────────────────────────────────────────────────────────────

/** Fluid Topics' filter semantics: objects intersect, values within one union. */
function passes(request: FtSearchRequest, e: FtSearchEntry): boolean {
  const carried = e.topic?.metadata ?? [];
  return (request.filters ?? []).every(f =>
    (carried.find(m => m.key === f.key)?.values ?? []).some(v => f.values.includes(v)));
}

interface Harness {
  ctx: ServerContext;
  /** Every request the server made, as `METHOD url`. */
  requests: string[];
}

function backends(provided?: SearchResult[]): Harness {
  const requests: string[] = [];
  const offline = (method: string, url: string): Error => new Error(`offline: no fixture for ${method} ${url}`);

  const http: HttpClient = {
    getText: async (url) => {
      requests.push(`GET ${url}`);
      if (url === CONCEPTS_SITEMAP) { return await Promise.resolve(CONCEPTS_SITEMAP_XML); }
      throw offline('GET', url);
    },
    getJson: async (url) => {
      requests.push(`GET ${url}`);
      return await Promise.reject(offline('GET', url));
    },
    postJson: async <T>(url: string, body?: unknown) => {
      requests.push(`POST ${url}`);
      if (url !== CLUSTERED_SEARCH) { throw offline('POST', url); }
      const entries = CORPUS.filter(e => passes(body as FtSearchRequest, e));
      const response: FtClusteredSearchResponse = {
        facets: [],
        announcements: [],
        paging: { currentPage: 1, isLastPage: true, totalResultsCount: entries.length, totalClustersCount: 1 },
        results: [{ metadataVariableAxis: 'version', entries }],
      };
      return await Promise.resolve(response as T);
    },
  };

  const cache = createMockCache();
  const mapsRegistry = new MapsRegistry(
    cache, undefined, { getMaps: async () => await Promise.resolve(MAPS) }, undefined, http,
  );
  const topicResolver = new TopicResolver(mapsRegistry, cache, undefined, undefined, http);
  const search = vi.fn<SearchProvider['search']>(async () => await Promise.resolve(provided ?? null));
  const ctx = createMockContext({
    cache, http, mapsRegistry, topicResolver,
    ...(provided !== undefined ? { searchProvider: { search } } : {}),
  });
  return { ctx, requests };
}

interface TextContent { type: 'text'; text: string }

type Row = Record<string, unknown>;

interface Reply {
  text: string;
  sc: Row & { results: Row[] };
  /** The tool's description, as `tools/list` serves it. */
  description: string;
  /** The published outputSchema's result item: its declared keys, and whether it allows others. */
  declared: string[];
  additionalProperties: unknown;
}

async function callSearch(ctx: ServerContext, args: Record<string, unknown>): Promise<Reply> {
  const server = new McpServer({ name: 'test-server', version: '0.0.1' });
  registerSearchTool(server, ctx);
  const client = new Client({ name: 'test-client', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    // The client checks structuredContent against the published outputSchema
    // only for tools it has listed, and throws when it does not match.
    const { tools } = await client.listTools();
    const listed = tools.find(t => t.name === 'jamf_docs_search');
    const schema = listed?.outputSchema as {
      properties: { results: { items: { properties: Row; additionalProperties?: unknown } } };
    };
    const { items } = schema.properties.results;
    const result = await client.callTool({ name: 'jamf_docs_search', arguments: { limit: 50, ...args } });
    expect(result.isError).not.toBe(true);
    return {
      text: (result.content[0] as TextContent).text,
      sc: result.structuredContent as Reply['sc'],
      description: listed?.description ?? '',
      declared: Object.keys(items.properties).sort(),
      additionalProperties: items.additionalProperties,
    };
  } finally {
    await client.close();
    await server.close();
  }
}

function keysOf(rows: Row[]): string[] {
  return [...new Set(rows.flatMap(r => Object.keys(r)))].sort();
}

function byTitle(rows: Row[], title: string): Row {
  const row = rows.find(r => r.title === title);
  if (row === undefined) { throw new Error(`no result titled ${title}`); }
  return row;
}

/** Each markdown result's `**Publication**` item, by result title. */
function publicationNotes(markdown: string): Record<string, string> {
  const notes: Record<string, string> = {};
  for (const block of markdown.split('\n### [').slice(1)) {
    const title = block.slice(0, block.indexOf(']('));
    const note = /\*\*Publication\*\*: ([^|\n]+?)(?: \||\n)/.exec(block)?.[1];
    if (note !== undefined) { notes[title] = note; }
  }
  return notes;
}

// ── Cases ───────────────────────────────────────────────────────────────────

describe('structuredContent carries every result field the outputSchema declares, and no other', () => {
  it('the published schema rejects a key it does not declare, so the client check below is real', async () => {
    const { ctx } = backends();
    const { additionalProperties } = await callSearch(ctx, { query: 'shared ipad', product: 'jamf-pro' });
    expect(additionalProperties).toBe(false);
  });

  it('on the Fluid Topics path', async () => {
    const { ctx, requests } = backends();

    const { sc, declared } = await callSearch(ctx, { query: 'shared ipad', product: 'jamf-pro', responseFormat: 'json' });

    expect(requests).toContain(`POST ${CLUSTERED_SEARCH}`);
    expect(sc.results.map(r => r.title)).toEqual(['Shared iPad User Management', 'Device Compliance for Shared Devices']);
    // Between them, the two results set every field a result can have, so
    // every key the schema declares must reach the client.
    expect(keysOf(sc.results)).toEqual(declared);

    expect(byTitle(sc.results, 'Shared iPad User Management')).toEqual({
      title: 'Shared iPad User Management',
      url: 'https://learn.jamf.com/r/en-US/jamf-pro-documentation-current/Shared_iPad_User_Management',
      snippet: expect.stringContaining('Prepare Shared iPad') as unknown,
      product: 'Jamf Pro',
      version: '11.32.0',
      docType: 'documentation',
      mapId: 'A4LI4vM0BILraYeOD89WGg',
      contentId: 'qMdiBY1MH5H6C_QwTkbvnQ',
      breadcrumb: SHARED_IPAD[0]?.breadcrumb,
      mapTitle: 'Jamf Pro Documentation 11.32.0',
      otherVersions: ['11.31.0', '11.14.0'],
    });
    expect(byTitle(sc.results, 'Device Compliance for Shared Devices')).toMatchObject({
      product: 'Jamf Pro',
      mapTitle: 'Jamf Setup and Reset Configuration Guide',
      crossFiled: true,
    });
  });

  it('on the SearchProvider path, where a result carrying every field arrives whole', async () => {
    const { ctx, requests } = backends([EVERY_FIELD]);

    const { sc, text, declared } = await callSearch(ctx, { query: 'shared devices', responseFormat: 'json' });

    expect(requests.filter(r => new URL(r.slice(r.indexOf(' ') + 1)).hostname === 'learn.jamf.com')).toEqual([]);
    expect(sc.results).toEqual([EVERY_FIELD]);
    expect(Object.keys(EVERY_FIELD).sort()).toEqual(declared);
    // The JSON text is the serialised SearchResult, and always carried them.
    expect((JSON.parse(text) as { results: unknown }).results).toEqual([EVERY_FIELD]);
  });

  it('whatever the responseFormat: markdown replies carry the same structuredContent results', async () => {
    const { ctx } = backends();
    const args = { query: 'shared ipad', product: 'jamf-pro' };

    const json = await callSearch(ctx, { ...args, responseFormat: 'json' });
    const markdown = await callSearch(ctx, args);

    expect(markdown.sc.results).toEqual(json.sc.results);
    expect(keysOf(markdown.sc.results)).toEqual(markdown.declared);
  });

  it('leaves out what a result does not have, rather than sending empty values', async () => {
    const { ctx } = backends([BARE, { ...BARE, title: 'Empty trail', breadcrumb: [] }]);

    const { sc } = await callSearch(ctx, { query: 'shared ipad', responseFormat: 'json' });

    // No `mapTitle: ''`, no `crossFiled: false`, no `breadcrumb: []`: each
    // would claim something the backend never said. The null product becomes
    // '' because the schema declares a string.
    expect(sc.results).toEqual([
      { title: BARE.title, url: BARE.url, snippet: BARE.snippet, product: '' },
      { title: 'Empty trail', url: BARE.url, snippet: BARE.snippet, product: '' },
    ]);
  });

  it("reads a SearchProvider's mistyped mapTitle or crossFiled as absent, on every channel", async () => {
    // Typed code cannot build these, but a provider's results are taken as
    // given, and one built from untyped rows can hand over a database NULL.
    // Before 2026-09-26 neither field reached structuredContent, so a null
    // did no harm there; published as is, it fails the client's check and
    // the whole search becomes an output validation error. The JSON text
    // carried the nulls as sent, and the third result's markdown threw in
    // the publication note (#343), which escaped a null title.
    const untyped = [
      { ...BARE, title: 'Null', mapTitle: null, crossFiled: null },
      { ...BARE, title: 'Mistyped', mapTitle: 42, crossFiled: 'yes' },
      { ...BARE, title: 'Flagged, no publication', mapTitle: null, crossFiled: true },
    ] as unknown as SearchResult[];
    const { ctx } = backends(untyped);

    const json = await callSearch(ctx, { query: 'shared ipad', responseFormat: 'json' });
    const markdown = await callSearch(ctx, { query: 'shared ipad' });

    const expected = (product: string | null): Row[] => [
      { title: 'Null', url: BARE.url, snippet: BARE.snippet, product },
      { title: 'Mistyped', url: BARE.url, snippet: BARE.snippet, product },
      { title: 'Flagged, no publication', url: BARE.url, snippet: BARE.snippet, product, crossFiled: true },
    ];
    expect(json.sc.results).toEqual(expected(''));
    expect(markdown.sc.results).toEqual(expected(''));
    // The JSON text is the serialised SearchResult, null product and all.
    expect((JSON.parse(json.text) as { results: Row[] }).results).toEqual(expected(null));
    // A flag with no publication to name gets no note, rather than a crash.
    expect(publicationNotes(markdown.text)).toEqual({});
  });
});

describe('a cross-filed result names its publication on every channel', () => {
  it('jamf-protect: structuredContent and the JSON text say what the markdown note says', async () => {
    const { ctx } = backends();
    const args = { query: 'release notes', product: 'jamf-protect' };

    const markdown = await callSearch(ctx, args);
    const json = await callSearch(ctx, { ...args, responseFormat: 'json' });
    const text = (JSON.parse(json.text) as { results: Row[] }).results;

    // The premise (#343): shown as Jamf Protect, the Jamf Trust topic gets
    // the note in markdown, and Jamf Protect's own release notes do not.
    expect(publicationNotes(markdown.text)).toEqual({ Windows: 'Jamf Trust Release Notes' });

    for (const results of [markdown.sc.results, json.sc.results, text]) {
      expect(byTitle(results, 'Windows')).toMatchObject({
        product: 'Jamf Protect', mapTitle: 'Jamf Trust Release Notes', crossFiled: true,
      });
      const own = byTitle(results, 'macOS Security Release Notes');
      expect(own).toMatchObject({ product: 'Jamf Protect', mapTitle: 'Jamf Protect Release Notes' });
      expect(own).not.toHaveProperty('crossFiled');
    }
  });
});

describe('the JSON text carries the other-source matches that structuredContent does', () => {
  it('when something matched', async () => {
    const { ctx, requests } = backends();

    const { sc, text, description } = await callSearch(ctx, { query: 'setup manager', responseFormat: 'json' });
    const json = JSON.parse(text) as Row;

    expect(requests).toContain(`GET ${CONCEPTS_SITEMAP}`);
    expect(sc.otherSources).toEqual([{
      title: 'Setup Manager',
      url: 'https://concepts.jamf.com/en/concepts/setup-manager/',
      source: 'Jamf Concepts',
    }]);
    expect(json.otherSources).toEqual(sc.otherSources);
    // With the shape it has: the JSON shape in the description is where the
    // caveat the markdown prints under these matches lives.
    expect(description).toContain('"otherSources"?: [{ "title": string, "url": string, "source": string }]');
  });

  it('and neither carries an empty list when nothing did', async () => {
    const { ctx } = backends();

    const { sc, text } = await callSearch(ctx, { query: 'shared ipad', product: 'jamf-pro', responseFormat: 'json' });

    expect(sc).not.toHaveProperty('otherSources');
    expect(JSON.parse(text)).not.toHaveProperty('otherSources');
  });
});
