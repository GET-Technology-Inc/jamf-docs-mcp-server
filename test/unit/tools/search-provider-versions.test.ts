/**
 * A SearchProvider's results are collapsed to one version per topic, as
 * Fluid Topics results are.
 *
 * Fluid Topics returns a Jamf Pro topic once per product version, and core
 * keeps the newest (`dedupeToLatestVersions`) while the results are still
 * clustered-search entries. A SearchProvider's results arrive as flat
 * `SearchResult`s. #76 (v3.0.6) had core collapse those too
 * (`deduplicateByLatestVersion`), and #78 (v3.0.7) dropped that when it
 * replaced the scraper. From then on the same question got one result per
 * topic without a provider, and one per version with one, while the
 * `SearchProvider` docstring still promised version deduplication until #344
 * corrected it to say there was none. This restores the collapse.
 *
 * Only versions are collapsed. Several results for one topic at one version,
 * such as a provider's passages of one page, all come back.
 *
 * Every case runs the real search service under the registered tool, over
 * MCP, with only the backends stubbed: a SearchProvider, and an HttpClient that
 * answers the clustered search from fixtures. Where a case compares the two
 * paths, the provider hands over exactly the `SearchResult`s the Fluid Topics
 * path builds from the same entries, one per entry, which is what a provider
 * that indexes learn.jamf.com's search would return.
 *
 * The entries are live ones from 2026-09-26, trimmed to the fields the code
 * reads: two Jamf Pro topics in several versions, Jamf Connect's current
 * "FileVault Settings" and its 2.45.0 snapshot (two clusters, not one), and an
 * unversioned Jamf School topic.
 */

import { describe, it, expect, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { registerSearchTool } from '../../../src/core/tools/search.js';
import { transformFtSearchResult } from '../../../src/core/services/search-service.js';
import { MapsRegistry } from '../../../src/core/services/maps-registry.js';
import { TopicResolver } from '../../../src/core/services/topic-resolver.js';
import { createMockContext, createMockCache } from '../../helpers/mock-context.js';
import type { HttpClient } from '../../../src/core/http-client.js';
import type { SearchProvider } from '../../../src/core/services/interfaces/index.js';
import type {
  FtClusteredSearchResponse,
  FtMetadataEntry,
  FtSearchEntry,
  FtSearchRequest,
  SearchResult,
} from '../../../src/core/types.js';
import type { ServerContext } from '../../../src/core/types/context.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

const CLUSTERED_SEARCH = 'https://learn.jamf.com/api/khub/clustered-search';

type ProVersion = '11.32.0' | '11.31.0' | '11.30.0' | '11.14.0';

/** One map per Jamf Pro version, as the live API names them. */
const PRO_MAPS: Record<ProVersion, string> = {
  '11.32.0': 'A4LI4vM0BILraYeOD89WGg',
  '11.31.0': 'wqin5wmqOhRZNP0CChQ8MQ',
  '11.30.0': 'FtEgPHSd28ZhPyLlTkrYTA',
  '11.14.0': '~hFRs6h0hprrcVO8LN5Qgg',
};
const LATEST_PRO: ProVersion = '11.32.0';

function meta(entries: Record<string, string[]>): FtMetadataEntry[] {
  return Object.entries(entries).map(([key, values]) => ({ key, label: key, values }));
}

interface TopicFixture {
  mapId: string;
  contentId: string;
  title: string;
  mapTitle: string;
  /** The bundle as the url names it: `-current`, `-11.31.0`, or a bare stem. */
  bundle: string;
  clusterId: string;
  version?: string;
  classification: Record<string, string[]>;
}

function entry(t: TopicFixture): FtSearchEntry {
  const slug = t.clusterId.slice(t.clusterId.indexOf('/') + 1);
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
      breadcrumb: [t.title],
      htmlExcerpt: '<span class="kwicstring">Configure and deploy </span>'
        + `<span class="kwicmatch">${t.title}</span>`
        + '<span class="kwicstring"> for the devices in your organization.</span>',
      metadata: meta({
        ...(t.version !== undefined ? { version: [t.version] } : {}),
        'zoominmetadata': ['content-techdocs'],
        'ft:clusterId': [t.clusterId],
        'ft:locale': ['en-US'],
        'ft:prettyUrl': [`en-US/${t.bundle}/${slug}`],
        ...t.classification,
      }),
    },
  };
}

/** A Jamf Pro topic at one version: `-current` in the url for the latest, as live. */
function pro(contentId: string, title: string, slug: string, version: ProVersion): FtSearchEntry {
  return entry({
    mapId: PRO_MAPS[version],
    contentId,
    title,
    mapTitle: `Jamf Pro Documentation ${version}`,
    bundle: version === LATEST_PRO ? 'jamf-pro-documentation-current' : `jamf-pro-documentation-${version}`,
    clusterId: `jamf-pro-documentation-current/${slug}`,
    version,
    classification: { 'jamf:portal': ['Jamf Pro'] },
  });
}

const computer = (version: ProVersion): FtSearchEntry => pro(
  'zGNgfc54eSb4O0Kk864Pkg', 'Computer PreStage Enrollments', 'Computer_PreStage_Enrollments', version,
);
const mobile = (version: ProVersion): FtSearchEntry => pro(
  'Hl8kl0VoKUt1_2TFW5Oj~w', 'Mobile Device PreStage Enrollments', 'Mobile_Device_PreStage_Enrollments', version,
);

/** Jamf Connect's current documentation: unversioned, at `-current`. */
const CONNECT_CURRENT = entry({
  mapId: 'bjs61pwUXJK9FzeINitaJA',
  contentId: 'spGaE6eXBYzcJGWUk~rUCw',
  title: 'FileVault Settings',
  mapTitle: 'Jamf Connect Documentation',
  bundle: 'jamf-connect-documentation-current',
  clusterId: 'jamf-connect-documentation-current/FileVault_Settings',
  classification: { 'jamf:app': ['Jamf Connect'] },
});

/** Its 2.45.0 snapshot, which Jamf clusters apart from the current page. */
const CONNECT_2_45 = entry({
  mapId: 'ovlpAWLVkl7iKw8_KJEqaQ',
  contentId: 'p3N5u6fm0NZT4WsG7msVzQ',
  title: 'FileVault Settings',
  mapTitle: 'Jamf Connect Documentation 2.45.0',
  bundle: 'jamf-connect-documentation-2.45.0',
  clusterId: 'jamf-connect-documentation-2.45.0/FileVault_Settings',
  version: '2.45.0',
  classification: { 'jamf:app': ['Jamf Connect'] },
});

const SCHOOL = entry({
  mapId: 'HCc1lTfQ0scnR49sMjM_Wg',
  contentId: '9r4sM8_aY93O61Y20G9aAg',
  title: 'Creating a Network Configuration Profile for Devices',
  mapTitle: 'Jamf School Documentation',
  bundle: 'jamf-school-documentation',
  clusterId: 'jamf-school-documentation/Creating_a_Network_Configuration_Profile_for_Devices',
  classification: { 'jamf:portal': ['Jamf School'] },
});

/**
 * The entries in ranked order, versions interleaved the way a provider that
 * ranks each one on its own might return them: an older version first.
 */
const RANKED: FtSearchEntry[] = [
  computer('11.30.0'),
  CONNECT_CURRENT,
  mobile('11.32.0'),
  computer('11.32.0'),
  SCHOOL,
  CONNECT_2_45,
  computer('11.14.0'),
  mobile('11.31.0'),
  computer('11.31.0'),
];

/** What a provider indexing learn.jamf.com's search hands over: one result per entry. */
const asProviderResults = (entries: FtSearchEntry[]): SearchResult[] =>
  entries.map(e => transformFtSearchResult(e));

function versionOf(e: FtSearchEntry): string | undefined {
  return e.topic?.metadata?.find(m => m.key === 'version')?.values[0];
}

/**
 * The clustered-search reply for `entries`: grouped by `ft:clusterId` in
 * first-seen order, as Fluid Topics groups them, and narrowed to the
 * requested version when the request filters by one, as the API does.
 */
function clusteredSearch(entries: FtSearchEntry[], request: FtSearchRequest): FtClusteredSearchResponse {
  const wanted = request.filters?.find(f => f.key === 'version')?.values;
  const kept = wanted === undefined
    ? entries
    : entries.filter(e => { const v = versionOf(e); return v !== undefined && wanted.includes(v); });
  const clusters = new Map<string, FtSearchEntry[]>();
  for (const e of kept) {
    const id = e.topic?.metadata?.find(m => m.key === 'ft:clusterId')?.values[0] ?? '';
    clusters.set(id, [...(clusters.get(id) ?? []), e]);
  }
  return {
    facets: [],
    announcements: [],
    paging: { currentPage: 1, isLastPage: true, totalResultsCount: kept.length, totalClustersCount: clusters.size },
    results: [...clusters.values()].map(group => ({ metadataVariableAxis: 'version', entries: group })),
  };
}

// ── Harness ─────────────────────────────────────────────────────────────────

interface Harness {
  ctx: ServerContext;
  /** Every request the server made, as `METHOD url`. */
  requests: string[];
  providerCalls: () => number;
}

/**
 * `provider` is what the SearchProvider returns; none is configured when it
 * is omitted, and Fluid Topics answers from `entries` instead.
 */
function backends(entries: FtSearchEntry[], provider?: SearchResult[]): Harness {
  const requests: string[] = [];
  const unexpected = (method: string, url: string): Error =>
    new Error(`offline: no fixture for ${method} ${url}`);

  const http: HttpClient = {
    getText: async (url) => {
      requests.push(`GET ${url}`);
      return await Promise.reject(unexpected('GET', url));
    },
    getJson: async (url) => {
      requests.push(`GET ${url}`);
      return await Promise.reject(unexpected('GET', url));
    },
    postJson: async <T>(url: string, body: unknown) => {
      requests.push(`POST ${url}`);
      if (url === CLUSTERED_SEARCH) {
        return await Promise.resolve(clusteredSearch(entries, body as FtSearchRequest) as T);
      }
      throw unexpected('POST', url);
    },
  };

  const search = vi.fn<SearchProvider['search']>(async () => await Promise.resolve(provider ?? null));
  const cache = createMockCache();
  const mapsRegistry = new MapsRegistry(cache, undefined, undefined, undefined, http);
  const topicResolver = new TopicResolver(mapsRegistry, cache, undefined, undefined, http);
  const ctx = createMockContext({
    cache, http, mapsRegistry, topicResolver,
    ...(provider !== undefined ? { searchProvider: { search } } : {}),
  });
  return { ctx, requests, providerCalls: () => search.mock.calls.length };
}

interface TextContent { type: 'text'; text: string }

interface Reply {
  json: Record<string, unknown>;
  sc: Record<string, unknown>;
  /** The results in structuredContent, rebuilt field by field against the outputSchema. */
  results: Record<string, unknown>[];
  /** The results in the JSON text, every field the result carries. */
  textResults: Record<string, unknown>[];
}

/** Call the registered tool over MCP, as a client would. */
async function callTool(
  ctx: ServerContext,
  args: Record<string, unknown>,
): Promise<{ text: string; structuredContent: unknown }> {
  const server = new McpServer({ name: 'test-server', version: '0.0.1' });
  registerSearchTool(server, ctx);
  const client = new Client({ name: 'test-client', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    // The client checks structuredContent against the published outputSchema
    // only for tools it has listed.
    await client.listTools();
    const result = await client.callTool({ name: 'jamf_docs_search', arguments: args });
    expect(result.isError).not.toBe(true);
    return {
      text: (result.content[0] as TextContent).text,
      structuredContent: result.structuredContent,
    };
  } finally {
    await client.close();
    await server.close();
  }
}

async function callSearch(ctx: ServerContext, args: Record<string, unknown>): Promise<Reply> {
  const { text, structuredContent } = await callTool(ctx, { responseFormat: 'json', ...args });
  const json = JSON.parse(text) as Record<string, unknown>;
  const sc = structuredContent as Record<string, unknown>;
  return {
    json,
    sc,
    results: sc.results as Record<string, unknown>[],
    textResults: json.results as Record<string, unknown>[],
  };
}

/** Title, version and what was collapsed into it: the part of a result this is about. */
function summary(results: Record<string, unknown>[]): string[] {
  return results.map(r => [
    r.title,
    r.version ?? '-',
    ...(r.otherVersions !== undefined ? [`also ${(r.otherVersions as string[]).join(',')}`] : []),
  ].join(' | '));
}

async function markdown(ctx: ServerContext, args: Record<string, unknown>): Promise<string> {
  return (await callTool(ctx, args)).text;
}

const QUERY = { query: 'prestage enrollment' };

// ── Cases ───────────────────────────────────────────────────────────────────

describe('a provider returning several versions of a topic gets the Fluid Topics answer', () => {
  it('one result per topic, the newest, in the place of its first, naming what was dropped', async () => {
    const withProvider = backends(RANKED, asProviderResults(RANKED));

    const { results } = await callSearch(withProvider.ctx, QUERY);

    expect(withProvider.providerCalls()).toBe(1);
    expect(withProvider.requests).not.toContain(`POST ${CLUSTERED_SEARCH}`);
    expect(summary(results)).toEqual([
      'Computer PreStage Enrollments | 11.32.0 | also 11.31.0,11.30.0,11.14.0',
      'FileVault Settings | -',
      'Mobile Device PreStage Enrollments | 11.32.0 | also 11.31.0',
      'Creating a Network Configuration Profile for Devices | -',
      'FileVault Settings | 2.45.0',
    ]);
    // The survivor is the 11.32.0 result as the provider gave it, `-current` url and all.
    expect(results[0]?.url).toBe(
      'https://learn.jamf.com/r/en-US/jamf-pro-documentation-current/Computer_PreStage_Enrollments',
    );
    expect(results[0]?.mapId).toBe(PRO_MAPS[LATEST_PRO]);
  });

  it('field for field what the same entries give with no provider configured', async () => {
    const withProvider = backends(RANKED, asProviderResults(RANKED));
    const fluidTopics = backends(RANKED);

    const provided = await callSearch(withProvider.ctx, QUERY);
    const searched = await callSearch(fluidTopics.ctx, QUERY);

    expect(fluidTopics.requests).toContain(`POST ${CLUSTERED_SEARCH}`);
    expect(provided.results).toEqual(searched.results);
    expect(provided.textResults).toEqual(searched.textResults);
    expect(provided.sc.totalResults).toBe(5);
    expect(provided.sc.totalResults).toBe(searched.sc.totalResults);
  });

  it('and says so in markdown, with the same "Also in" line on both paths', async () => {
    const provided = await markdown(backends(RANKED, asProviderResults(RANKED)).ctx, QUERY);
    const searched = await markdown(backends(RANKED).ctx, QUERY);

    const alsoIn = (text: string): string[] => text.split('\n').filter(line => line.includes('**Also in**'));
    expect(alsoIn(provided)).toEqual(alsoIn(searched));
    expect(alsoIn(provided)).toHaveLength(2);
    expect(provided).toContain('**Also in**: 11.31.0, 11.30.0, 11.14.0 (pass `version` to fetch one)');
  });
});

describe('a provider that already returns one result per topic gets its results back unchanged', () => {
  it('including the otherVersions it set itself', async () => {
    const deduped = asProviderResults([
      computer('11.32.0'), CONNECT_CURRENT, mobile('11.32.0'), SCHOOL, CONNECT_2_45,
    ]).map((r, i) => (i === 0 ? { ...r, otherVersions: ['11.31.0', '11.30.0'] } : r));

    const { textResults } = await callSearch(backends([], deduped).ctx, QUERY);

    expect(textResults).toEqual(JSON.parse(JSON.stringify(deduped)));
  });

  it('when it honoured a version filter, which is what Fluid Topics returns for it too', async () => {
    const atVersion = RANKED.filter(e => versionOf(e) === '11.31.0');
    const args = { ...QUERY, version: '11.31.0' };

    const provided = await callSearch(backends([], asProviderResults(atVersion)).ctx, args);
    const searched = await callSearch(backends(RANKED).ctx, args);

    expect(summary(provided.results)).toEqual([
      'Mobile Device PreStage Enrollments | 11.31.0',
      'Computer PreStage Enrollments | 11.31.0',
    ]);
    expect(provided.results).toEqual(searched.results);
    expect(provided.textResults).toEqual(searched.textResults);
    expect(provided.sc).not.toHaveProperty('versionNote');
  });
});

describe('a provider returning several passages of one page keeps every passage of the version kept', () => {
  const [c32, c31, m32] = asProviderResults(
    [computer('11.32.0'), computer('11.31.0'), mobile('11.32.0')],
  ) as [SearchResult, SearchResult, SearchResult];
  const passage = (r: SearchResult, n: number, section = ''): SearchResult => ({
    ...r,
    url: `${r.url}${section}`,
    snippet: `Passage ${n} of ${r.title}.`,
  });
  const shown = (results: Record<string, unknown>[]): unknown[] =>
    results.map(r => [r.title, r.version, r.snippet, r.url, r.otherVersions ?? null]);

  it('and drops only the other versions, into the first-ranked passage', async () => {
    const provided = [passage(c31, 1), passage(c32, 1), m32, passage(c32, 2, '#Scope'), passage(c31, 2)];

    const { textResults, sc } = await callSearch(backends([], provided).ctx, QUERY);

    expect(shown(textResults)).toEqual([
      ['Computer PreStage Enrollments', '11.32.0', 'Passage 1 of Computer PreStage Enrollments.', c32.url, ['11.31.0']],
      ['Mobile Device PreStage Enrollments', '11.32.0', m32.snippet, m32.url, null],
      ['Computer PreStage Enrollments', '11.32.0', 'Passage 2 of Computer PreStage Enrollments.', `${c32.url}#Scope`, null],
    ]);
    expect(sc.totalResults).toBe(3);
  });

  it('and returns a topic found at one version only as the provider ranked it', async () => {
    const provided = [passage(c32, 1), m32, passage(c32, 2, '#Scope'), passage(c32, 3, '?lang=en')];

    const { textResults } = await callSearch(backends([], provided).ctx, QUERY);

    expect(textResults).toEqual(JSON.parse(JSON.stringify(provided)));
  });
});

describe('a result whose version cannot be read is never merged or dropped', () => {
  const at = (url: string, title: string, version?: string): SearchResult => ({
    title,
    url,
    snippet: `${title}, as the provider indexed it.`,
    product: 'Jamf Pro',
    ...(version !== undefined ? { version } : {}),
  });

  const cases: [string, SearchResult[]][] = [
    [
      // Two clusters upstream, so the Fluid Topics path returns both too.
      'Jamf Connect\'s unversioned current page beside its 2.45.0 snapshot',
      asProviderResults([CONNECT_CURRENT, CONNECT_2_45]),
    ],
    [
      // The LAPS technical paper publishes two topics at one url, unversioned.
      'two topics at one `-current` url with no version',
      [
        at('https://learn.jamf.com/r/en-US/technical-paper-laps-current/Using_LAPS', 'Use LAPS'),
        at('https://learn.jamf.com/r/en-US/technical-paper-laps-current/Using_LAPS', 'Using LAPS in the Jamf Pro API'),
      ],
    ],
    [
      // Jamf's own template text, left in two ja-JP Jamf Connect topics.
      'a `version` that is not a version number',
      [
        at('https://learn.jamf.com/r/ja-JP/jamf-connect-documentation-current/Configuring_Azure_AD', 'Step 2', 'Enter the latest product version for which the topic was revised.'),
        at('https://learn.jamf.com/r/ja-JP/jamf-connect-documentation-current/Configuring_Azure_AD', 'Step 2 (again)', 'Enter the latest product version for which the topic was revised.'),
      ],
    ],
    [
      'a `current` version on a `-current` url',
      [
        at('https://learn.jamf.com/r/en-US/jamf-pro-documentation-current/Policies', 'Policies', 'current'),
        at('https://learn.jamf.com/r/en-US/jamf-pro-documentation-current/Policies', 'Policies (chunk 2)', 'current'),
      ],
    ],
    [
      'a url on a host other than Fluid Topics\'',
      [
        at('https://docs.example.com/r/en-US/jamf-pro-documentation-11.31.0/Policies', 'Policies', '11.31.0'),
        at('https://docs.example.com/r/en-US/jamf-pro-documentation-11.30.0/Policies', 'Policies', '11.30.0'),
      ],
    ],
    [
      'a url in neither Fluid Topics form',
      [
        at('https://learn.jamf.com/some/other/path.html', 'Other', '11.31.0'),
        at('https://learn.jamf.com/some/other/path.html', 'Other', '11.30.0'),
      ],
    ],
  ];

  it.each(cases)('%s', async (_label, provided) => {
    const { results } = await callSearch(backends([], provided).ctx, QUERY);

    expect(results.map(r => r.title)).toEqual(provided.map(r => r.title));
    expect(results.some(r => r.otherVersions !== undefined)).toBe(false);
  });
});

describe('with a version filter, a provider that ignored it gets the version asked for', () => {
  it('where the topic has it, as Fluid Topics returns it, with the rest named', async () => {
    const args = { ...QUERY, version: '11.30.0' };

    const provided = await callSearch(backends([], asProviderResults(RANKED)).ctx, args);
    const searched = await callSearch(backends(RANKED).ctx, args);

    // Newest-wins would have kept 11.32.0 and dropped the version asked for.
    expect(summary(provided.results)).toEqual([
      'Computer PreStage Enrollments | 11.30.0 | also 11.32.0,11.31.0,11.14.0',
      'FileVault Settings | -',
      'Mobile Device PreStage Enrollments | 11.32.0 | also 11.31.0',
      'Creating a Network Configuration Profile for Devices | -',
      'FileVault Settings | 2.45.0',
    ]);
    // Fluid Topics filters upstream, so it returns that topic alone and at
    // that version, and names nothing else because it saw nothing else.
    expect(summary(searched.results)).toEqual(['Computer PreStage Enrollments | 11.30.0']);
    expect(provided.textResults[0]).toEqual({
      ...searched.textResults[0],
      otherVersions: ['11.32.0', '11.31.0', '11.14.0'],
    });
  });

  it('and the version note still says when a topic was returned at another version', async () => {
    const args = { ...QUERY, version: '11.30.0' };

    const { sc } = await callSearch(backends([], asProviderResults(RANKED)).ctx, args);

    expect(sc.versionNote).toBe(
      'Version "11.30.0" was not available for some results. '
      + 'The search backend returned articles from other versions; they are shown as-is.',
    );
  });

  it('but not when every topic survives at the version asked for', async () => {
    const proOnly = RANKED.filter(e => e.topic?.mapTitle.startsWith('Jamf Pro') === true);

    const { sc, results } = await callSearch(
      backends([], asProviderResults(proOnly)).ctx,
      { ...QUERY, version: '11.31.0' },
    );

    expect(summary(results)).toEqual([
      'Computer PreStage Enrollments | 11.31.0 | also 11.32.0,11.30.0,11.14.0',
      'Mobile Device PreStage Enrollments | 11.31.0 | also 11.32.0',
    ]);
    expect(sc).not.toHaveProperty('versionNote');
  });

  it('while `current` asks for no version in particular, so the newest is kept', async () => {
    const current = await callSearch(
      backends([], asProviderResults(RANKED)).ctx, { ...QUERY, version: 'current' },
    );
    const none = await callSearch(backends([], asProviderResults(RANKED)).ctx, QUERY);

    expect(current.textResults).toEqual(none.textResults);
  });
});
