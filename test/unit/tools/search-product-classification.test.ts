/**
 * What `jamf_docs_search` returns for a `product` filter, when the documents
 * carry the classification Jamf actually gives them: several products per
 * axis, and more than one axis.
 *
 * Until #334 a product search was filtered twice by two different rules.
 * Fluid Topics kept a topic when ANY of its `jamf:portal` / `jamf:app` /
 * `jamf:utility` values named the product; the client-side post-filter then
 * kept it only when the one product it was *displayed* under — the first value
 * of the most specific axis — mapped back to the product. The Security Cloud
 * setup guide is filed `portal: [Jamf Security Cloud, Jamf Protect], app:
 * [Jamf Connect]`, so it displayed as "Jamf Connect" and a jamf-security-cloud
 * search rejected its own publication. Measured live on 2026-09-26 over ten
 * queries per product: jamf-trust kept 0 of 181 upstream results, jamf-setup-
 * reset 0 of 133 and jamf-security-cloud 1 of 401, and every such search said
 * "Removed filter(s): product" over the correctly filtered set. Relaxation
 * runs docType, then topic, then product, so a topic passed with one of them
 * was thrown away first.
 *
 * Every case drives the registered tool over MCP with the real search service
 * and a real MapsRegistry. Only Fluid Topics is stubbed, and the stub applies
 * filters the way `clustered-search` does: filter objects intersect, and an
 * entry passes one when its key carries any of the filter's values. The maps
 * and topic classifications are the live ones, read from `/api/khub/maps` on
 * 2026-09-26; titles and snippets are shortened stand-ins.
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
import { sanitizeMarkdownText } from '../../../src/core/utils/sanitize.js';
import { createMockCache, createMockContext } from '../../helpers/mock-context.js';
import { makeFtSearchResponse, type FixtureClassification } from '../../helpers/fixtures.js';
import type { FtMapInfo, FtSearchFilter, FtSearchRequest } from '../../../src/core/types.js';
import type { ServerContext } from '../../../src/core/types/context.js';

const mockedFtSearch = vi.mocked(ftSearch);

interface TextContent { type: 'text'; text: string }

interface CallResult {
  isError?: boolean;
  content: unknown[];
  structuredContent?: {
    results: { title: string; product: string }[];
    filters?: Record<string, string>;
    filterRelaxation?: { removed: string[]; original: Record<string, string>; message: string };
  };
}

// ── The live classification (learn.jamf.com, en-US, 2026-09-26) ─────────────

interface Publication {
  title: string;
  bundle: string;
  classification: FixtureClassification;
}

const SECURITY_CLOUD: Publication = {
  title: 'Jamf Security Cloud Portal Setup Guide',
  // jamf-security-cloud's own `bundleId`.
  bundle: 'jamf-security-cloud-setup-guide',
  classification: { 'jamf:portal': ['Jamf Security Cloud', 'Jamf Protect'], 'jamf:app': ['Jamf Connect'] },
};
const SETUP_RESET: Publication = {
  title: 'Jamf Setup and Reset Configuration Guide',
  // jamf-setup-reset's own `bundleId`.
  bundle: 'jamf-setup-reset-configuration-guide',
  classification: { 'jamf:portal': ['Jamf Pro'], 'jamf:app': ['Jamf Reset', 'Jamf Setup'] },
};
const TRUST: Publication = {
  title: 'Jamf Trust Release Notes',
  // jamf-trust's own `bundleId`: its documentation IS the release notes.
  bundle: 'jamf-trust-documentation',
  classification: {
    'jamf:portal': ['Jamf Safe Internet', 'Jamf Protect'],
    'jamf:app': ['Jamf Connect', 'Jamf Trust'],
  },
};
const PROTECT: Publication = {
  title: 'Jamf Protect Documentation',
  bundle: 'jamf-protect-documentation',
  classification: { 'jamf:portal': ['Jamf Protect'] },
};
const CONNECT: Publication = {
  title: 'Jamf Connect Documentation',
  bundle: 'jamf-connect-documentation',
  classification: { 'jamf:app': ['Jamf Connect'] },
};
const PRO: Publication = {
  title: 'Jamf Pro Documentation',
  bundle: 'jamf-pro-documentation',
  classification: { 'jamf:portal': ['Jamf Pro'] },
};

const PUBLICATIONS = [SECURITY_CLOUD, SETUP_RESET, TRUST, PROTECT, CONNECT, PRO];

/**
 * Snippets are over 50 characters so none is replaced by the title-and-product
 * fallback, and are worded to hit only the topic keywords a case relies on.
 */
const TOPICS: [Publication, string, string][] = [
  [SECURITY_CLOUD, 'Policies', 'Configure the access policies that apply to every enrolled device you manage.'],
  [SECURITY_CLOUD, 'Network Communication', 'Hostnames and firewall rules the agent needs to reach the cloud service.'],
  [SECURITY_CLOUD, 'Activation Profiles', 'Create an activation profile and distribute it to devices with your MDM.'],
  [SETUP_RESET, 'Configuring and Deploying Jamf Setup', 'Deploy the Jamf Setup app to shared devices so users can personalise them.'],
  [SETUP_RESET, 'Configuring and Deploying Jamf Reset', 'Deploy the Jamf Reset app to shared devices so they can be wiped and reused.'],
  [SETUP_RESET, 'Requirements', 'Both run on iPadOS 17 or later, on shared devices enrolled with Jamf Pro.'],
  [TRUST, '11.42 (2025-02-18)', 'Bug fixes and improvements for Jamf Trust on iOS and Android devices this release.'],
  [PROTECT, 'Deploying Jamf Protect', 'Install the Jamf Protect agent on computers with a configuration profile.'],
  [PROTECT, 'Plans', 'Plans define how the Jamf Protect agent behaves on each computer it runs on.'],
  [CONNECT, 'Login Window', 'Configure the Jamf Connect login window for cloud identity provider sign-in.'],
  [PRO, 'Scripts', 'Add a script to Jamf Pro and run it on computers with a policy payload.'],
];

/** One map per publication, carrying the classification its topics carry. */
const MAPS: FtMapInfo[] = PUBLICATIONS.map((pub, i) => ({
  id: `map-${String(i)}`,
  title: pub.title,
  mapApiEndpoint: `/api/khub/maps/map-${String(i)}`,
  metadata: [
    { key: 'ft:locale', label: 'ft:locale', values: ['en-US'] },
    { key: 'bundle', label: 'bundle', values: [pub.bundle] },
    ...(['jamf:portal', 'jamf:app', 'jamf:utility'] as const).map(key => ({
      key, label: key, values: [...(pub.classification[key] ?? [])],
    })),
  ],
}));

const CORPUS = makeFtSearchResponse(TOPICS.map(([pub, title, snippet]) => ({
  title,
  snippet,
  mapId: pub.bundle,
  mapTitle: pub.title,
  contentId: title.replace(/\W+/g, '_'),
  classification: pub.classification,
})));

/** Fluid Topics' filter semantics: objects intersect, values within one union. */
function passes(filter: FtSearchFilter, metadata: { key: string; values: string[] }[]): boolean {
  const carried = metadata.find(m => m.key === filter.key)?.values ?? [];
  return carried.some(value => filter.values.includes(value));
}

/** The filters of every request that reached Fluid Topics, in order. */
let sent: FtSearchFilter[][] = [];

let ctx: ServerContext;
let server: McpServer;
let client: Client;

beforeAll(async () => {
  server = new McpServer({ name: 'test', version: '0.0.1' });
  const cache = createMockCache();
  ctx = createMockContext({
    cache,
    mapsRegistry: new MapsRegistry(cache, undefined, { getMaps: async () => await Promise.resolve(MAPS) }),
  });
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
    const entries = (CORPUS.results[0]?.entries ?? []).filter(
      entry => filters.every(f => passes(f, entry.topic?.metadata ?? [])),
    );
    return await Promise.resolve({
      ...CORPUS,
      paging: { ...CORPUS.paging, totalResultsCount: entries.length },
      results: [{ metadataVariableAxis: '', entries }],
    });
  });
});

async function searchJson(args: Record<string, unknown>): Promise<NonNullable<CallResult['structuredContent']>> {
  const result = await client.callTool({
    name: 'jamf_docs_search',
    arguments: { query: 'jamf', limit: 50, ...args },
  }) as CallResult;
  expect(result.isError).toBeUndefined();
  if (result.structuredContent === undefined) {
    throw new Error(`No structuredContent: ${(result.content[0] as TextContent).text}`);
  }
  return result.structuredContent;
}

async function searchMarkdown(args: Record<string, unknown>): Promise<string> {
  const result = await client.callTool({
    name: 'jamf_docs_search',
    arguments: { query: 'jamf', limit: 50, ...args },
  }) as CallResult;
  return (result.content[0] as TextContent).text;
}

const titles = (s: { results: { title: string }[] }): string[] => s.results.map(r => r.title);

describe("a product's own publication satisfies its product filter", () => {
  it.each([
    {
      product: 'jamf-security-cloud',
      name: 'Jamf Security Cloud',
      filter: { key: 'jamf:portal', values: ['Jamf Security Cloud'] },
      expected: ['Policies', 'Network Communication', 'Activation Profiles'],
    },
    {
      product: 'jamf-setup-reset',
      name: 'Jamf Setup and Reset',
      filter: { key: 'jamf:app', values: ['Jamf Setup', 'Jamf Reset'] },
      expected: ['Configuring and Deploying Jamf Setup', 'Configuring and Deploying Jamf Reset', 'Requirements'],
    },
    {
      product: 'jamf-trust',
      name: 'Jamf Trust',
      filter: { key: 'jamf:app', values: ['Jamf Trust'] },
      expected: ['11.42 (2025-02-18)'],
    },
  ])('$product: returns what Fluid Topics returned, under $name, with no relaxation', async ({ product, name, filter, expected }) => {
    const json = await searchJson({ product, responseFormat: 'json' });

    expect(sent).toEqual([[filter]]);
    expect(titles(json)).toEqual(expected);
    expect(json.filterRelaxation).toBeUndefined();
    expect(json.filters).toEqual({ product });
    // Display follows the filter: the result is shown under the product the
    // caller asked for, not under whichever value Jamf happens to list first
    // on the most specific axis ("Jamf Connect", "Jamf Reset").
    expect(new Set(json.results.map(r => r.product))).toEqual(new Set([name]));

    const markdown = await searchMarkdown({ product });
    expect(markdown).not.toContain('Removed filter');
    expect(markdown).toContain(`**Product**: ${name}`);
    expect(markdown).not.toContain('**Product**: Jamf Connect');
    // Each is the product's own publication, whose title says so already.
    expect(markdown).not.toContain('**Publication**');
  });
});

describe('product + topic keeps the topic filter', () => {
  it.each([
    { product: 'jamf-security-cloud', topic: 'network', expected: ['Network Communication'] },
    {
      product: 'jamf-setup-reset',
      topic: 'apps',
      expected: ['Configuring and Deploying Jamf Setup', 'Configuring and Deploying Jamf Reset'],
    },
  ])('$product + $topic narrows to the matching topics', async ({ product, topic, expected }) => {
    const json = await searchJson({ product, topic, responseFormat: 'json' });

    expect(titles(json)).toEqual(expected);
    expect(json.filterRelaxation).toBeUndefined();
    expect(json.filters).toEqual({ product, topic });
  });
});

describe('a document Jamf files under several products is found under each', () => {
  it('jamf-protect includes the Security Cloud guide and the Trust notes, shown as Jamf Protect', async () => {
    // Intended: Jamf files both under `jamf:portal = Jamf Protect`, the
    // upstream filter returns them, and the local filter now agrees with it.
    // They used to be dropped here without a word — 38.8% of what Fluid
    // Topics returned for jamf-protect across ten live queries.
    const json = await searchJson({ product: 'jamf-protect', responseFormat: 'json' });

    expect(sent).toEqual([[{ key: 'jamf:portal', values: ['Jamf Protect'] }]]);
    expect(titles(json)).toEqual([
      'Policies', 'Network Communication', 'Activation Profiles',
      '11.42 (2025-02-18)',
      'Deploying Jamf Protect', 'Plans',
    ]);
    expect(json.filterRelaxation).toBeUndefined();
    expect(new Set(json.results.map(r => r.product))).toEqual(new Set(['Jamf Protect']));

    // Shown as Jamf Protect, a topic of another product's publication would
    // read as Jamf Protect's own, so the markdown names the publication — for
    // those results only.
    const markdown = await searchMarkdown({ product: 'jamf-protect' });
    const publicationOf = (title: string): string | undefined => {
      const block = markdown.split('### ').find(b => b.startsWith(`[${sanitizeMarkdownText(title)}]`)) ?? '';
      return /\*\*Publication\*\*: ([^|\n]+?)(?: \||\n)/.exec(block)?.[1];
    };
    expect(publicationOf('Network Communication')).toBe(SECURITY_CLOUD.title);
    expect(publicationOf('11.42 (2025-02-18)')).toBe(TRUST.title);
    expect(publicationOf('Plans')).toBeUndefined();
  });

  it('without a product filter, a result keeps the attribution Jamf gives it', async () => {
    const json = await searchJson({ topic: 'network', responseFormat: 'json' });

    expect(sent).toEqual([[]]);
    expect(json.results).toEqual([
      expect.objectContaining({ title: 'Network Communication', product: 'Jamf Connect' }),
    ]);
  });
});

describe('a product Jamf classifies nothing under', () => {
  it('says so up front and keeps the topic filter', async () => {
    // jamf-routines has no classification value, so nothing can be sent
    // upstream. The search goes out unfiltered; the topic filter must still
    // run over it rather than being relaxed away before product is.
    const json = await searchJson({ product: 'jamf-routines', topic: 'scripts', responseFormat: 'json' });

    expect(sent).toEqual([[]]);
    expect(titles(json)).toEqual(['Scripts']);
    expect(json.filterRelaxation).toEqual({
      removed: ['product'],
      original: { product: 'jamf-routines' },
      message: expect.stringContaining('The product filter "jamf-routines" was not applied'),
    });
    expect(json.filterRelaxation?.message).not.toContain('No results with all filters applied');
    // Results are not re-labelled under a product they were not filtered by.
    expect(json.results[0]?.product).toBe('Jamf Pro');

    const markdown = await searchMarkdown({ product: 'jamf-routines', topic: 'scripts' });
    expect(markdown).toContain('The product filter "jamf-routines" was not applied');
    expect(markdown).toContain('jamf_docs_get_toc');
  });

  it('reports the removal even when nothing else was filtered', async () => {
    const json = await searchJson({ product: 'jamf-routines', responseFormat: 'json' });

    expect(json.results).toHaveLength(TOPICS.length);
    expect(json.filterRelaxation?.removed).toEqual(['product']);
  });
});
