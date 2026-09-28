/**
 * The Jamf Training Catalog courses that Jamf's search lists among the
 * documentation come back as results, marked as pages `jamf_docs_get_article`
 * cannot read.
 *
 * A clustered search returns three kinds of entry: TOPIC and MAP, which are
 * the documentation, and DOCUMENT. Every DOCUMENT entry measured on
 * 2026-09-28 (46 in 106 unfiltered searches, and 67 in all 127, in en-US,
 * ja-JP and zh-TW) was a course or learning path of the Jamf Training
 * Catalog, crawled from trainingcatalog.jamf.com: `openMode` EXTERNAL, its
 * `originUrl` the course, filed under Jamf's product classification, with a
 * `jamf:contentType` of "Training Content", and ranked among the topics,
 * first of all in the ja-JP searches "configuration profiles" and
 * "inventory". Until that day `transformFtSearchResult` read only TOPIC and
 * MAP entries, gave any other a url of '', and the search dropped it without
 * a word.
 *
 * Every case runs the real search service under the registered tool, over
 * MCP, with only the HttpClient stubbed. The stub answers the clustered
 * search as Fluid Topics does: it keeps the entries every filter object
 * matches, a filter object matching when the entry carries any of its
 * values. The entries are live ones (test/fixtures/ft-search-training-courses.json
 * says which); a case that makes one up, or changes a field, says so.
 */

import { describe, it, expect, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { registerSearchTool } from '../../../src/core/tools/search.js';
import { registerGetArticleTool } from '../../../src/core/tools/get-article.js';
import { transformFtSearchResult } from '../../../src/core/services/search-service.js';
import { MapsRegistry } from '../../../src/core/services/maps-registry.js';
import { TopicResolver } from '../../../src/core/services/topic-resolver.js';
import { createMockContext, createMockCache } from '../../helpers/mock-context.js';
import { loadFixture } from '../../helpers/fixtures.js';
import { mapsWithContentTypes } from '../../fixtures/maps-content-types.js';
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
const MAPS_LIST = 'https://learn.jamf.com/api/khub/maps';

interface Group { query: string; locale: string; entries: FtSearchEntry[] }

const FIXTURE = loadFixture('ft-search-training-courses.json') as Partial<Record<string, Group>>;

function group(name: string): Group {
  const found = FIXTURE[name];
  if (found === undefined) { throw new Error(`no fixture group ${name}`); }
  return found;
}

/** ja-JP "configuration profiles": a course Fluid Topics ranked first, then two topics. */
const CONFIGURATION_PROFILES = group('configurationProfilesJa');
/**
 * en-US "FileVault", ranks 10, 15, 29, 33, 36 and 37 of 50: a Jamf Connect
 * topic, a Jamf Pro topic, a Jamf Pro training video (`content-training`),
 * the glossary's "FileVault" (no metadata at all), then a Jamf Pro course and
 * a Jamf Connect course.
 */
const FILEVAULT = group('fileVault');
/** en-US "inventory": two Jamf School courses, one of them a learning path. */
const INVENTORY_SCHOOL = group('inventorySchool');
/** ja-JP "Entra ID": a course Jamf files under Jamf Pro and Jamf Connect both. */
const ENTRA_ID = group('entraIdJa');

const PRO_COURSE = 'https://trainingcatalog.jamf.com/administer-filevault-with-jamf-pro';
const CONNECT_COURSE = 'https://trainingcatalog.jamf.com/identify-authentication-screens-with-filevault-and-jamf-connect';

/**
 * Enough of the maps list for the product filter to find the axis of the
 * three products these cases filter by, as `jamf:portal` or `jamf:app`, and
 * the live list's pairing of `content-*` labels with `jamf:contentType`
 * (test/fixtures/maps-content-types.ts), which says what content types are
 * training (`MapsRegistry.contentTypesOf`).
 */
const MAPS: FtMapInfo[] = [
  ...([
    ['Jamf Pro', 'jamf:portal'], ['Jamf School', 'jamf:portal'], ['Jamf Connect', 'jamf:app'],
  ] as const).map(([value, key], i) => ({
    id: `map${String(i)}`,
    title: `${value} Documentation`,
    mapApiEndpoint: `/api/khub/maps/map${String(i)}`,
    metadata: [
      { key: 'jamf:portal', label: 'Portal', values: key === 'jamf:portal' ? [value] : [] },
      { key: 'jamf:app', label: 'Application', values: key === 'jamf:app' ? [value] : [] },
      { key: 'jamf:utility', label: 'Utilities & Services', values: [] },
    ],
  })),
  ...mapsWithContentTypes(),
];

/**
 * What the maps list pairs with `content-training`: "Training Content" in the
 * six languages Jamf had training in on 2026-09-28, as the search sends them.
 */
const LIVE_TRAINING_CONTENT_TYPES = [
  'Contenido de formación',
  'Contenu de la formation',
  'Schulungsinhalt',
  'Training Content',
  'トレーニングコンテンツ',
  '培訓內容',
];

function metadataOf(e: FtSearchEntry): FtMetadataEntry[] {
  return e.topic?.metadata ?? e.map?.metadata ?? e.document?.metadata ?? [];
}

function meta(e: FtSearchEntry, key: string): string[] {
  return metadataOf(e).find(m => m.key === key)?.values ?? [];
}

/** Grouped by `ft:clusterId` in first-seen order, as Fluid Topics groups them. */
function clusteredSearch(entries: FtSearchEntry[]): FtClusteredSearchResponse {
  const clusters = new Map<string, FtSearchEntry[]>();
  for (const e of entries) {
    const id = meta(e, 'ft:clusterId')[0] ?? '';
    clusters.set(id, [...(clusters.get(id) ?? []), e]);
  }
  return {
    facets: [],
    announcements: [],
    paging: { currentPage: 1, isLastPage: true, totalResultsCount: entries.length, totalClustersCount: clusters.size },
    results: [...clusters.values()].map(entriesOf => ({ metadataVariableAxis: 'version', entries: entriesOf })),
  };
}

/** The entries every filter of `request` matches, as Fluid Topics applies them. */
function filtered(entries: FtSearchEntry[], request: FtSearchRequest): FtSearchEntry[] {
  return entries.filter(e => (request.filters ?? []).every(f => meta(e, f.key).some(v => f.values.includes(v))));
}

// ── Harness ─────────────────────────────────────────────────────────────────

interface Harness { ctx: ServerContext; requests: FtSearchRequest[] }

/**
 * Fluid Topics answers from `entries`. With `provider`, a SearchProvider
 * answers with those results instead.
 */
function backends(entries: FtSearchEntry[], provider?: SearchResult[]): Harness {
  const requests: FtSearchRequest[] = [];
  const offline = (method: string, url: string): Error => new Error(`offline: no fixture for ${method} ${url}`);
  const http: HttpClient = {
    getText: async (url) => await Promise.reject(offline('GET', url)),
    getJson: async <T>(url: string) => {
      if (url === MAPS_LIST) { return await Promise.resolve(structuredClone(MAPS) as T); }
      return await Promise.reject(offline('GET', url));
    },
    postJson: async <T>(url: string, body: unknown) => {
      if (url !== CLUSTERED_SEARCH) { throw offline('POST', url); }
      const request = body as FtSearchRequest;
      requests.push(request);
      return await Promise.resolve(clusteredSearch(filtered(structuredClone(entries), request)) as T);
    },
  };
  const answer = vi.fn<SearchProvider['search']>(async () => await Promise.resolve(provider ?? null));
  const cache = createMockCache();
  const mapsRegistry = new MapsRegistry(cache, undefined, undefined, undefined, http);
  const topicResolver = new TopicResolver(mapsRegistry, cache, undefined, undefined, http);
  const ctx = createMockContext({
    cache, http, mapsRegistry, topicResolver,
    ...(provider !== undefined ? { searchProvider: { search: answer } } : {}),
  });
  return { ctx, requests };
}

/** What a provider indexing learn.jamf.com's search hands over: one result per entry. */
const asProviderResults = (entries: FtSearchEntry[]): SearchResult[] =>
  entries.map(e => transformFtSearchResult(e, LIVE_TRAINING_CONTENT_TYPES));

interface TextContent { type: 'text'; text: string }

interface Called { isError: boolean; text: string; structuredContent: Record<string, unknown> }

async function callTool(ctx: ServerContext, name: string, args: Record<string, unknown>): Promise<Called> {
  const server = new McpServer({ name: 'test-server', version: '0.0.1' });
  registerSearchTool(server, ctx);
  registerGetArticleTool(server, ctx);
  const client = new Client({ name: 'test-client', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    // Listed first, so the client checks structuredContent against the outputSchema.
    await client.listTools();
    const result = await client.callTool({ name, arguments: args });
    return {
      isError: result.isError === true,
      text: (result.content as TextContent[]).map(c => c.text).join('\n'),
      structuredContent: result.structuredContent as Record<string, unknown>,
    };
  } finally {
    await client.close();
    await server.close();
  }
}

interface Reply {
  sc: Record<string, unknown>;
  /** The results in structuredContent. */
  results: Record<string, unknown>[];
  /** The results in the JSON text, every field the result carries. */
  textResults: Record<string, unknown>[];
}

async function search(ctx: ServerContext, g: Group, args: Record<string, unknown> = {}): Promise<Reply> {
  const reply = await callTool(ctx, 'jamf_docs_search', { query: g.query, language: g.locale, responseFormat: 'json', ...args });
  expect(reply.isError).toBe(false);
  return {
    sc: reply.structuredContent,
    results: reply.structuredContent.results as Record<string, unknown>[],
    textResults: (JSON.parse(reply.text) as { results: Record<string, unknown>[] }).results,
  };
}

async function markdown(ctx: ServerContext, g: Group, args: Record<string, unknown> = {}): Promise<string> {
  const reply = await callTool(ctx, 'jamf_docs_search', { query: g.query, language: g.locale, ...args });
  expect(reply.isError).toBe(false);
  return reply.text;
}

const urls = (results: Record<string, unknown>[]): unknown[] => results.map(r => r.url);

const EXTERNAL_LINE = '**External**: open the link in a browser; `jamf_docs_get_article` cannot read it';
const FOOTER = '*Use `jamf_docs_get_article` with any URL above — or with the `mapId` + `contentId` pair shown with a result — to read the full article.*';
const FOOTER_WITH_EXTERNAL = '*Use `jamf_docs_get_article` with any URL above but those marked **External** — or with the `mapId` + `contentId` pair shown with a result — to read the full article.*';

// ── Cases ───────────────────────────────────────────────────────────────────

describe('a course Jamf\'s search lists among the documentation comes back', () => {
  it('at the rank Fluid Topics gave it: first, in ja-JP "configuration profiles"', async () => {
    const [course, ...topics] = CONFIGURATION_PROFILES.entries as [FtSearchEntry, ...FtSearchEntry[]];
    expect(course.type).toBe('DOCUMENT');

    const { results, textResults, sc } = await search(backends(CONFIGURATION_PROFILES.entries).ctx, CONFIGURATION_PROFILES);

    expect(sc.totalResults).toBe(3);
    expect(results.map(r => r.title)).toEqual([
      '構成プロファイル (Configuration Profiles)',
      ...topics.map(e => e.topic?.title),
    ]);
    const expected = {
      title: '構成プロファイル (Configuration Profiles)',
      url: 'https://trainingcatalog.jamf.com/configuration-profiles-ja-jp',
      product: 'Jamf Pro',
      external: true,
    };
    expect(results[0]).toMatchObject(expected);
    expect(textResults[0]).toMatchObject(expected);
  });

  it('with its excerpt for a snippet, read as a topic\'s is', async () => {
    const { results } = await search(backends(FILEVAULT.entries).ctx, FILEVAULT);

    expect(results.find(r => r.url === PRO_COURSE)?.snippet)
      .toBe('Enforce disk encryption and manage recovery keys with FileVault and Jamf Pro.');
  });

  it('with its excerpt decoded once, as a topic\'s is (the excerpt is made up: no live course held a reference)', async () => {
    const entries = structuredClone(FILEVAULT.entries);
    const course = entries.find(e => e.document?.originUrl === PRO_COURSE)?.document;
    if (course === undefined) { throw new Error('no Pro course in the FileVault group'); }
    course.htmlExcerpt = 'In <span class="kwicmatch">FileVault</span>, open Settings &gt; Security &amp; Privacy '
      + 'and check the user&#x27;s &quot;recovery key&quot; &amp;lt;escrow&amp;gt;.';

    const { results, textResults } = await search(backends(entries).ctx, FILEVAULT);

    const decoded = 'In FileVault, open Settings > Security & Privacy and check the user\'s "recovery key" &lt;escrow&gt;.';
    expect(results.find(r => r.url === PRO_COURSE)?.snippet).toBe(decoded);
    expect(textResults.find(r => r.url === PRO_COURSE)?.snippet).toBe(decoded);
  });

  it('as a result, so a query only a course matches is answered with it, not with suggestions: ja-JP "Entra ID"', async () => {
    const { ctx } = backends(ENTRA_ID.entries);

    const { results, sc } = await search(ctx, ENTRA_ID);
    const text = await markdown(ctx, ENTRA_ID);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ external: true, docType: 'training' });
    expect(sc).not.toHaveProperty('suggestions');
    expect(text).not.toContain('No results found');
    expect(text).toContain(EXTERNAL_LINE);
  });

  it('as what it is: training, and no pair, publication, breadcrumb or version it does not have', async () => {
    const { results, textResults } = await search(backends(CONFIGURATION_PROFILES.entries).ctx, CONFIGURATION_PROFILES);

    for (const course of [results[0], textResults[0]]) {
      // No `content-*` label, but Jamf's "Training Content" ("トレーニングコンテンツ").
      expect(course).toHaveProperty('docType', 'training');
      for (const field of ['mapId', 'contentId', 'mapTitle', 'breadcrumb', 'version', 'otherVersions', 'crossFiled']) {
        expect(course).not.toHaveProperty(field);
      }
    }
    // The topics are as they were: no `external`.
    expect(results.slice(1).every(r => !('external' in r))).toBe(true);
    expect(textResults.slice(1).every(r => !('external' in r))).toBe(true);
  });

  it('whose url jamf_docs_get_article does not accept, which is why it is marked', async () => {
    const { ctx } = backends([]);

    const reply = await callTool(ctx, 'jamf_docs_get_article', { url: 'https://trainingcatalog.jamf.com/configuration-profiles-ja-jp' });

    expect(reply.isError).toBe(true);
    expect(reply.text).toContain('URL must be from');
  });

  it('marked External in markdown, with the footer saying so', async () => {
    const text = await markdown(backends(CONFIGURATION_PROFILES.entries).ctx, CONFIGURATION_PROFILES);

    // Markdown-escaped, as the reply sends it.
    expect(text).toContain('### [構成プロファイル \\(Configuration Profiles\\)](https://trainingcatalog.jamf.com/configuration-profiles-ja-jp)');
    const block = text.split('### ')[1] ?? '';
    expect(block).toContain(`**Product**: Jamf Pro | ${EXTERNAL_LINE}`);
    expect(block).not.toContain('**IDs**');
    expect(text.split(EXTERNAL_LINE)).toHaveLength(2);
    expect(text).toContain(FOOTER_WITH_EXTERNAL);
    expect(text).not.toContain(FOOTER);
  });

  it('and a page with no course keeps the footer it had', async () => {
    // This passes on main too; it pins that only a page with a course changes.
    const topics = CONFIGURATION_PROFILES.entries.slice(1);

    const text = await markdown(backends(topics).ctx, CONFIGURATION_PROFILES);

    expect(text).toContain(FOOTER);
    expect(text).not.toContain('**External**');
  });

  it('marked in compact output, on its own line only', async () => {
    const text = await markdown(backends(CONFIGURATION_PROFILES.entries).ctx, CONFIGURATION_PROFILES, { outputMode: 'compact' });

    const lines = text.split('\n').filter(line => /^\d+\. \[/.test(line));
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^1\. \[構成プロファイル \\\(Configuration Profiles\\\)\]\(https:\/\/trainingcatalog\.jamf\.com\/configuration-profiles-ja-jp\) - .* \(external: jamf_docs_get_article cannot read it\)$/);
    expect(lines.slice(1).every(line => !line.includes('external'))).toBe(true);
  });

  it('field for field as a SearchProvider returning the same entries gets it', async () => {
    const searched = await search(backends(CONFIGURATION_PROFILES.entries).ctx, CONFIGURATION_PROFILES);
    const provided = await search(backends([], asProviderResults(CONFIGURATION_PROFILES.entries)).ctx, CONFIGURATION_PROFILES);

    expect(searched.results).toEqual(provided.results);
    expect(searched.textResults).toEqual(provided.textResults);
  });
});

describe('filters apply to a course as Jamf\'s search applies them', () => {
  it('product: by Jamf\'s classification, sent upstream and applied again here', async () => {
    const { ctx, requests } = backends(FILEVAULT.entries);

    const pro = await search(ctx, FILEVAULT, { product: 'jamf-pro' });
    const connect = await search(ctx, FILEVAULT, { product: 'jamf-connect' });

    expect(requests.map(r => r.filters)).toEqual([
      [{ key: 'jamf:portal', values: ['Jamf Pro'] }],
      [{ key: 'jamf:app', values: ['Jamf Connect'] }],
    ]);
    expect(urls(pro.results)).toContain(PRO_COURSE);
    expect(urls(pro.results)).not.toContain(CONNECT_COURSE);
    expect(urls(connect.results)).toContain(CONNECT_COURSE);
    expect(urls(connect.results)).not.toContain(PRO_COURSE);
    expect(pro.results.find(r => r.url === PRO_COURSE)).toMatchObject({ product: 'Jamf Pro', external: true });
    expect(connect.results.find(r => r.url === CONNECT_COURSE)).toMatchObject({ product: 'Jamf Connect', external: true });
  });

  it('product: by the local filter too, when the fetch was not filtered upstream', async () => {
    // A maps list with no map of these products, so the registry cannot
    // place their classification value and the fetch goes out unfiltered.
    const { ctx, requests } = backends(FILEVAULT.entries);
    vi.spyOn(ctx.mapsRegistry, 'classificationAxis').mockResolvedValue(null);

    const pro = await search(ctx, FILEVAULT, { product: 'jamf-pro' });

    expect(requests.map(r => r.filters)).toEqual([[]]);
    expect(urls(pro.results)).toContain(PRO_COURSE);
    expect(urls(pro.results)).not.toContain(CONNECT_COURSE);
  });

  it('product: a course Jamf files under two products is returned for each', async () => {
    const { ctx } = backends(ENTRA_ID.entries);
    const [course] = ENTRA_ID.entries as [FtSearchEntry];
    expect(meta(course, 'jamf:portal')).toEqual(['Jamf Pro']);
    expect(meta(course, 'jamf:app')).toEqual(['Jamf Connect']);

    const unfiltered = await search(ctx, ENTRA_ID);
    const pro = await search(ctx, ENTRA_ID, { product: 'jamf-pro' });
    const connect = await search(ctx, ENTRA_ID, { product: 'jamf-connect' });

    // Unfiltered, under the narrower axis, as a topic is.
    expect(unfiltered.results[0]).toMatchObject({ product: 'Jamf Connect', external: true });
    expect(pro.results[0]).toMatchObject({ product: 'Jamf Pro', external: true });
    expect(connect.results[0]).toMatchObject({ product: 'Jamf Connect', external: true });
    // No publication to name, so never marked as filed under another product.
    expect(pro.results[0]).not.toHaveProperty('crossFiled');
  });

  it('product: Jamf School courses for jamf-school, one of them a learning path', async () => {
    const { results } = await search(backends(INVENTORY_SCHOOL.entries).ctx, INVENTORY_SCHOOL, { product: 'jamf-school' });

    expect(results.map(r => [r.url, r.product, r.external])).toEqual([
      ['https://trainingcatalog.jamf.com/path/inventory-management-essentials-in-jamf-school', 'Jamf School', true],
      ['https://trainingcatalog.jamf.com/filters-inventory-records-and-quick-action-commands-in-jamf-school', 'Jamf School', true],
    ]);
  });

  it('topic: by its title and excerpt, as a topic\'s', async () => {
    const { results } = await search(backends(FILEVAULT.entries).ctx, FILEVAULT, { topic: 'filevault' });

    expect(urls(results)).toEqual(expect.arrayContaining([PRO_COURSE, CONNECT_COURSE]));
  });

  it('docType: training, asked for as Jamf\'s "Training Content", with the training topics at their rank', async () => {
    // `content-training` alone returns the video topic and no course, which
    // carries no `content-*` label (none came back under it in five live
    // searches). Jamf's "Training Content" returns both, ranked together:
    // live, the same five searches returned the same topics in the same
    // order, with the courses among them.
    const { ctx, requests } = backends(FILEVAULT.entries);

    const training = await search(ctx, FILEVAULT, { docType: 'training' });

    expect(requests.map(r => r.filters)).toEqual([[{ key: 'jamf:contentType', values: [...LIVE_TRAINING_CONTENT_TYPES] }]]);
    expect(training.results.map(r => [r.title, r.docType, r.external])).toEqual([
      ['Video: How to Troubleshoot FileVault Status in Jamf Pro', 'training', undefined],
      ['Administer FileVault with Jamf Pro', 'training', true],
      ['Identify Authentication Screens with FileVault and Jamf Connect', 'training', true],
    ]);
    expect(training.sc).not.toHaveProperty('filterRelaxation');
  });

  it('docType: training with a product, both sent upstream', async () => {
    const { ctx, requests } = backends(FILEVAULT.entries);

    const connect = await search(ctx, FILEVAULT, { docType: 'training', product: 'jamf-connect' });

    expect(requests.map(r => r.filters)).toEqual([[
      { key: 'jamf:app', values: ['Jamf Connect'] },
      { key: 'jamf:contentType', values: [...LIVE_TRAINING_CONTENT_TYPES] },
    ]]);
    expect(urls(connect.results)).toEqual([CONNECT_COURSE]);
  });

  it('docType: training asked for by its label when Jamf\'s "Training Content" finds nothing', async () => {
    // Constructed: the video's content type in a language the maps list pairs
    // with no training. The courses of that language would be missed; its
    // topics are not.
    const [connectTopic, proTopic, video, ...rest] = FILEVAULT.entries as [FtSearchEntry, FtSearchEntry, FtSearchEntry, ...FtSearchEntry[]];
    const untranslated = structuredClone(video);
    const contentType = untranslated.topic?.metadata?.find(m => m.key === 'jamf:contentType');
    if (contentType === undefined) { throw new Error('fixture video has no jamf:contentType'); }
    contentType.values = ['Opleidingsinhoud'];
    const entries = [connectTopic, proTopic, untranslated, ...rest.filter(e => e.type !== 'DOCUMENT')];
    const { ctx, requests } = backends(entries);

    const training = await search(ctx, FILEVAULT, { docType: 'training' });

    expect(requests.map(r => r.filters)).toEqual([
      [{ key: 'jamf:contentType', values: [...LIVE_TRAINING_CONTENT_TYPES] }],
      [{ key: 'zoominmetadata', values: ['content-training'] }],
    ]);
    expect(training.results.map(r => r.title)).toEqual(['Video: How to Troubleshoot FileVault Status in Jamf Pro']);
  });

  it('docType: training in a specific version, asked for by its label, as no course has a version', async () => {
    const { ctx, requests } = backends(FILEVAULT.entries);

    await search(ctx, FILEVAULT, { docType: 'training', version: '11.32.0' });

    expect(requests[0]?.filters).toEqual([
      { key: 'zoominmetadata', values: ['content-training'] },
      { key: 'version', values: ['11.32.0'] },
    ]);
  });

  it('docType: no other, not even when the search asks again without it, where a topic of no label is kept', async () => {
    // Nothing here is a release note, so the first request comes back empty
    // and the search asks again without the docType, for the local filter to
    // narrow. It keeps the glossary's "FileVault", a topic whose kind is not
    // known, as it always has. A course's kind is known: it is training.
    // Kept, it would be listed as a release note.
    const { ctx, requests } = backends(FILEVAULT.entries);

    const releaseNotes = await search(ctx, FILEVAULT, { docType: 'release-notes' });

    expect(requests).toHaveLength(2);
    expect(releaseNotes.results.map(r => r.title)).toEqual(['FileVault']);
    expect(releaseNotes.sc).not.toHaveProperty('filterRelaxation');
  });

  it('docType: an external result of no kind is left out, where a topic of no kind is kept', async () => {
    // Constructed: a course Jamf gave no content type. None measured was; a
    // SearchProvider's external result may carry no docType either. It is
    // known not to be a page of the documentation, so no docType takes it.
    const [glossary, course] = FILEVAULT.entries.filter(e => e.topic?.title === 'FileVault' || e.type === 'DOCUMENT') as [FtSearchEntry, FtSearchEntry];
    const unclassified = structuredClone(course);
    if (unclassified.document?.metadata === undefined) { throw new Error('fixture course has no metadata'); }
    unclassified.document.metadata = unclassified.document.metadata.filter(m => m.key !== 'jamf:contentType');

    const { results, sc } = await search(backends([glossary, unclassified]).ctx, FILEVAULT, { docType: 'release-notes' });

    expect(results.map(r => r.title)).toEqual(['FileVault']);
    expect(sc).not.toHaveProperty('filterRelaxation');
  });

  it('docType: and once the filter is relaxed away, the courses are back', async () => {
    const courses = FILEVAULT.entries.filter(e => e.type === 'DOCUMENT');

    const { results, sc } = await search(backends(courses).ctx, FILEVAULT, { docType: 'release-notes' });

    expect(urls(results)).toEqual([PRO_COURSE, CONNECT_COURSE]);
    expect(sc.filterRelaxation).toMatchObject({ removed: ['docType'] });
  });
});

describe('what one course is', () => {
  const [course] = CONFIGURATION_PROFILES.entries as [FtSearchEntry];

  it('its document: listed twice, it is one result', async () => {
    // Not seen live: every course measured was a cluster of its own, listed once.
    const { results } = await search(backends([course, structuredClone(course)]).ctx, CONFIGURATION_PROFILES);

    expect(results).toHaveLength(1);
  });

  it('two courses are two results, even in one cluster', async () => {
    // Constructed: the second course given the first one's cluster.
    const [pro, connect] = FILEVAULT.entries.filter(e => e.type === 'DOCUMENT') as [FtSearchEntry, FtSearchEntry];
    const sameCluster = structuredClone(connect);
    const cluster = sameCluster.document?.metadata?.find(m => m.key === 'ft:clusterId');
    if (cluster === undefined) { throw new Error('fixture course has no ft:clusterId'); }
    cluster.values = meta(pro, 'ft:clusterId');

    const { results } = await search(backends([pro, sameCluster]).ctx, FILEVAULT);

    expect(urls(results)).toEqual([PRO_COURSE, CONNECT_COURSE]);
  });
});

describe('where a course is read from', () => {
  const [course] = CONFIGURATION_PROFILES.entries as [FtSearchEntry];
  const withDocument = (changes: Record<string, unknown>): FtSearchEntry => {
    const copy = structuredClone(course);
    Object.assign(copy.document ?? {}, changes);
    return copy;
  };

  it('its origin on jamf.com itself, as on a host under it', async () => {
    // Constructed: every document measured was on trainingcatalog.jamf.com.
    const apex = 'https://jamf.com/training/configuration-profiles';

    const { results } = await search(backends([withDocument({ originUrl: apex })]).ctx, CONFIGURATION_PROFILES);

    expect(urls(results)).toEqual([apex]);
  });

  it('its viewer on learn.jamf.com, with no origin url to link to', async () => {
    // Constructed: every document measured had an `originUrl`.
    const { results } = await search(backends([withDocument({ originUrl: undefined })]).ctx, CONFIGURATION_PROFILES);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ url: course.document?.viewerUrl, external: true });
  });

  it('only on Jamf\'s own site, over https, as every other result is on a Jamf host', async () => {
    // Constructed: every document measured was on trainingcatalog.jamf.com.
    const elsewhere = withDocument({ originUrl: 'https://attacker.example/jamf-pro' });
    const plain = withDocument({ originUrl: 'http://trainingcatalog.jamf.com/configuration-profiles-ja-jp' });
    const lookalike = withDocument({ originUrl: 'https://trainingcatalog.jamf.com.attacker.example/x' });
    const suffix = withDocument({ originUrl: 'https://notjamf.com/x' });

    for (const entry of [elsewhere, plain, lookalike, suffix]) {
      const { results } = await search(backends([entry]).ctx, CONFIGURATION_PROFILES);

      // The viewer on learn.jamf.com instead.
      expect(urls(results)).toEqual([course.document?.viewerUrl]);
    }
  });

  it('nothing at all, with no address on Jamf\'s site to link to', async () => {
    // Constructed.
    const script = withDocument({ originUrl: 'javascript:alert(1)', viewerUrl: undefined });
    const elsewhere = withDocument({ originUrl: undefined, viewerUrl: 'https://attacker.example/v/u/x' });
    const none = withDocument({ originUrl: undefined, viewerUrl: undefined });

    const { ctx } = backends([script, elsewhere, none]);
    const reply = await callTool(ctx, 'jamf_docs_search', { query: CONFIGURATION_PROFILES.query, language: 'ja-JP' });

    expect(reply.isError).toBe(false);
    expect(reply.text).not.toContain('javascript:');
    expect(reply.text).not.toContain('attacker');
    expect(reply.structuredContent.totalResults).toBe(0);
  });
});
