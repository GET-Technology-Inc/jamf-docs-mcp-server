/**
 * What `jamf:contentType` values a search reads as training: the ones the
 * maps list pairs with `content-training`, read from it, not a list kept by
 * hand.
 *
 * #379 searched `docType: "training"` by Jamf's "Training Content" in the six
 * languages Jamf had it in on 2026-09-28, and read an entry with no
 * `content-*` label (a Jamf Training Catalog course) as training when it
 * carried one of them, from a list written down in constants/doc-types.ts. A
 * language Jamf added training in was then searched without its courses, and
 * they had no docType, until someone added the value to the list. The values
 * are now read from the maps list (`MapsRegistry.contentTypesOf`): the
 * `jamf:contentType` values of the maps labelled `content-training` that no
 * other map carries. On the live list of 2026-09-28 those are the six
 * (test/fixtures/maps-content-types.ts). While the list cannot be read, the
 * search uses those six, compiled in as a stand-in, as it used the hand-kept
 * list, and caches what it finds.
 *
 * The registered tool over MCP, with the real search service and
 * MapsRegistry, and only the HttpClient stubbed. The stub answers the
 * clustered search as Fluid Topics does, keeping the entries every filter
 * object matches. The entries are the live ones of
 * test/fixtures/ft-search-training-courses.json; a case that makes one up, or
 * a map, says so.
 */

import { describe, it, expect } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { registerSearchTool } from '../../../src/core/tools/search.js';
import { MapsRegistry, type MapEntry } from '../../../src/core/services/maps-registry.js';
import { TopicResolver } from '../../../src/core/services/topic-resolver.js';
import { HttpError, type HttpClient } from '../../../src/core/http-client.js';
import type { CacheKey } from '../../../src/core/services/cache-key.js';
import { createMockContext, createMockCache, createStubMapsRegistry } from '../../helpers/mock-context.js';
import { loadFixture } from '../../helpers/fixtures.js';
import { MAPS_CONTENT_TYPES, mapsWithContentTypes } from '../../fixtures/maps-content-types.js';
import type {
  FtClusteredSearchResponse,
  FtMapInfo,
  FtMetadataEntry,
  FtSearchEntry,
  FtSearchRequest,
} from '../../../src/core/types.js';
import type { ServerContext } from '../../../src/core/types/context.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

const CLUSTERED_SEARCH = 'https://learn.jamf.com/api/khub/clustered-search';
const MAPS_LIST = 'https://learn.jamf.com/api/khub/maps';

interface Group { query: string; locale: string; entries: FtSearchEntry[] }

const FIXTURE = loadFixture('ft-search-training-courses.json') as Partial<Record<string, Group>>;

/**
 * en-US "FileVault": a Jamf Connect topic, a Jamf Pro topic, a Jamf Pro
 * training video (`content-training`), the glossary's "FileVault" (no
 * metadata), then a Jamf Pro course and a Jamf Connect course.
 */
const FILEVAULT = FIXTURE.fileVault ?? { query: '', locale: '', entries: [] };

/** The training content types the maps list of 2026-09-28 pairs with `content-training`. */
const LIVE_TRAINING = [
  'Contenido de formación',
  'Contenu de la formation',
  'Schulungsinhalt',
  'Training Content',
  'トレーニングコンテンツ',
  '培訓內容',
];

/** Made up: a training map in nl-NL, a language Jamf published no training in on 2026-09-28. */
const NL_TRAINING = 'Trainingsinhoud';

function metadataOf(e: FtSearchEntry): FtMetadataEntry[] {
  return e.topic?.metadata ?? e.map?.metadata ?? e.document?.metadata ?? [];
}

function meta(e: FtSearchEntry, key: string): string[] {
  return metadataOf(e).find(m => m.key === key)?.values ?? [];
}

/** A map made up for a case, with one locale's labels and content types. */
function madeUpMap(id: string, locale: string, labelKeys: string[], contentTypes: string[]): FtMapInfo {
  return {
    id,
    title: id,
    mapApiEndpoint: `/api/khub/maps/${id}`,
    metadata: [
      { key: 'bundle', label: 'bundle', values: [id] },
      { key: 'ft:locale', label: 'ft:locale', values: [locale] },
      { key: 'zoominmetadata', label: 'zoominmetadata', values: labelKeys },
      { key: 'jamf:contentType', label: 'Content Type', values: contentTypes },
    ],
  };
}

/** Made up: the FileVault group's Jamf Pro course, as Jamf would list it in nl-NL. */
function dutchCourse(): FtSearchEntry {
  const course = structuredClone(FILEVAULT.entries.find(e => e.type === 'DOCUMENT'));
  if (course?.document === undefined) { throw new Error('no course in the FileVault group'); }
  course.document.metadata = metadataOf(course).map(m => {
    if (m.key === 'ft:locale') { return { ...m, values: ['nl-NL'] }; }
    if (m.key === 'jamf:contentType') { return { ...m, values: [NL_TRAINING] }; }
    return m;
  });
  return course;
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

interface Harness {
  ctx: ServerContext;
  requests: FtSearchRequest[];
  /** Requests for the maps list, answered or not. */
  mapsRequests: () => number;
  /** Serve `maps` for the maps list from now on, or a 503 for `null`. */
  setMaps: (maps: FtMapInfo[] | null) => void;
}

/** Fluid Topics answers from `entries`, and learn.jamf.com's maps list is `maps`, or a 503 for `null`. */
function backends(entries: FtSearchEntry[], maps: FtMapInfo[] | null = mapsWithContentTypes()): Harness {
  const requests: FtSearchRequest[] = [];
  let served = maps;
  let mapsRequests = 0;
  const offline = (method: string, url: string): Error => new Error(`offline: no fixture for ${method} ${url}`);
  const http: HttpClient = {
    getText: async (url) => await Promise.reject(offline('GET', url)),
    getJson: async <T>(url: string) => {
      if (url !== MAPS_LIST) { return await Promise.reject(offline('GET', url)); }
      mapsRequests++;
      if (served === null) { throw new HttpError(503, 'Service Unavailable', url); }
      return await Promise.resolve(structuredClone(served) as T);
    },
    postJson: async <T>(url: string, body: unknown) => {
      if (url !== CLUSTERED_SEARCH) { throw offline('POST', url); }
      const request = body as FtSearchRequest;
      requests.push(request);
      return await Promise.resolve(clusteredSearch(filtered(structuredClone(entries), request)) as T);
    },
  };
  const cache = createMockCache();
  const mapsRegistry = new MapsRegistry(cache, undefined, undefined, undefined, http);
  const topicResolver = new TopicResolver(mapsRegistry, cache, undefined, undefined, http);
  return {
    ctx: createMockContext({ cache, http, mapsRegistry, topicResolver }),
    requests,
    mapsRequests: () => mapsRequests,
    setMaps: (next) => { served = next; },
  };
}

interface TextContent { type: 'text'; text: string }

interface Reply {
  sc: Record<string, unknown>;
  results: Record<string, unknown>[];
}

async function search(ctx: ServerContext, args: Record<string, unknown>): Promise<Reply> {
  const server = new McpServer({ name: 'test-server', version: '0.0.1' });
  registerSearchTool(server, ctx);
  const client = new Client({ name: 'test-client', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    // Listed first, so the client checks structuredContent against the outputSchema.
    await client.listTools();
    const result = await client.callTool({ name: 'jamf_docs_search', arguments: { responseFormat: 'json', ...args } });
    expect(result.isError, (result.content as TextContent[])[0]?.text).not.toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    return { sc, results: sc.results as Record<string, unknown>[] };
  } finally {
    await client.close();
    await server.close();
  }
}

const FILEVAULT_ARGS = { query: FILEVAULT.query, language: FILEVAULT.locale };

/** The values the first request of a training search filtered `jamf:contentType` by, sorted. */
function contentTypesAskedFor(requests: FtSearchRequest[]): string[] | undefined {
  return requests[0]?.filters?.find(f => f.key === 'jamf:contentType')?.values.slice().sort();
}

// ── Cases ───────────────────────────────────────────────────────────────────

describe('docType "training" is searched by what the maps list pairs with content-training', () => {
  it('the six values of 2026-09-28, with the training topics and courses they find', async () => {
    const { ctx, requests } = backends(FILEVAULT.entries);

    const training = await search(ctx, { ...FILEVAULT_ARGS, docType: 'training' });

    expect(contentTypesAskedFor(requests)).toEqual(LIVE_TRAINING);
    expect(training.results.map(r => [r.title, r.docType, r.external])).toEqual([
      ['Video: How to Troubleshoot FileVault Status in Jamf Pro', 'training', undefined],
      ['Administer FileVault with Jamf Pro', 'training', true],
      ['Identify Authentication Screens with FileVault and Jamf Connect', 'training', true],
    ]);
  });

  it('a language the maps list gains training in is searched by its own value, and finds its courses', async () => {
    const maps = [...mapsWithContentTypes(), madeUpMap('nl-training', 'nl-NL', ['content-training'], [NL_TRAINING])];
    const { ctx, requests } = backends([dutchCourse()], maps);

    const training = await search(ctx, { query: 'FileVault', language: 'nl-NL', docType: 'training' });

    expect(contentTypesAskedFor(requests)).toEqual([...LIVE_TRAINING, NL_TRAINING].sort());
    expect(requests).toHaveLength(1);
    expect(training.results.map(r => [r.title, r.docType, r.external])).toEqual([
      ['Administer FileVault with Jamf Pro', 'training', true],
    ]);
    expect(training.sc).not.toHaveProperty('filterRelaxation');
  });

  it('and a course in that language is training in any search', async () => {
    const maps = [...mapsWithContentTypes(), madeUpMap('nl-training', 'nl-NL', ['content-training'], [NL_TRAINING])];
    const { ctx } = backends([dutchCourse()], maps);

    const unfiltered = await search(ctx, { query: 'FileVault', language: 'nl-NL' });

    expect(unfiltered.results[0]).toMatchObject({ docType: 'training', external: true });
  });

  it('leaves out a value a map of another kind carries too, which would not say an entry is training', async () => {
    // Made up: one en-US techdocs map that carries "Training Content" too.
    const maps = [
      ...mapsWithContentTypes(),
      madeUpMap('techdocs-and-training', 'en-US', ['content-techdocs'], ['Technical Documentation', 'Training Content']),
    ];
    const { ctx, requests } = backends(FILEVAULT.entries, maps);

    const training = await search(ctx, { ...FILEVAULT_ARGS, docType: 'training' });
    const unfiltered = await search(ctx, FILEVAULT_ARGS);

    expect(contentTypesAskedFor(requests)).toEqual(LIVE_TRAINING.filter(v => v !== 'Training Content'));
    // The first request found nothing in en-US, so the search asked by the
    // label, which finds the video and no course.
    expect(requests[1]?.filters).toEqual([{ key: 'zoominmetadata', values: ['content-training'] }]);
    expect(training.results.map(r => r.title)).toEqual(['Video: How to Troubleshoot FileVault Status in Jamf Pro']);
    const courses = unfiltered.results.filter(r => r.external === true);
    expect(courses).toHaveLength(2);
    expect(courses.every(r => !('docType' in r))).toBe(true);
  });
});

describe('what a search reads of the maps list for it', () => {
  it('nothing, when every result carries a content-* label or no content type', async () => {
    const { ctx, mapsRequests } = backends(FILEVAULT.entries.filter(e => e.type !== 'DOCUMENT'));

    const { results } = await search(ctx, FILEVAULT_ARGS);

    expect(results).toHaveLength(4);
    expect(mapsRequests()).toBe(0);
  });

  it('the list, once, when a result carries a content type and no label', async () => {
    const { ctx, mapsRequests } = backends(FILEVAULT.entries);

    await search(ctx, FILEVAULT_ARGS);
    await search(ctx, { ...FILEVAULT_ARGS, docType: 'training' });

    expect(mapsRequests()).toBe(1);
  });

  it('when it cannot be read: the six of 2026-09-28 stand in, and what they find is kept', async () => {
    const { ctx, requests, mapsRequests } = backends(FILEVAULT.entries, null);

    const unfiltered = await search(ctx, FILEVAULT_ARGS);
    const training = await search(ctx, { ...FILEVAULT_ARGS, docType: 'training' });

    // As while the list answers, and as before the values were read from it.
    expect(unfiltered.results.map(r => [r.title, r.docType])).toEqual([
      ['FileVault Settings', 'documentation'],
      ['FileVault Management Options', 'documentation'],
      ['Video: How to Troubleshoot FileVault Status in Jamf Pro', 'training'],
      ['FileVault', undefined],
      ['Administer FileVault with Jamf Pro', 'training'],
      ['Identify Authentication Screens with FileVault and Jamf Connect', 'training'],
    ]);
    expect(requests[1]?.filters).toEqual([{ key: 'jamf:contentType', values: LIVE_TRAINING }]);
    expect(training.results.map(r => [r.title, r.docType, r.external])).toEqual([
      ['Video: How to Troubleshoot FileVault Status in Jamf Pro', 'training', undefined],
      ['Administer FileVault with Jamf Pro', 'training', true],
      ['Identify Authentication Screens with FileVault and Jamf Connect', 'training', true],
    ]);
    expect(requests).toHaveLength(2);
    expect(mapsRequests()).toBe(2);

    // Both kept: asked again, neither is sent to Fluid Topics. The unfiltered
    // search is served from the cache before it needs the values; the
    // training search needs them for its request, so it asks for the list
    // again, once, as MapsRegistry keeps no failure.
    await search(ctx, FILEVAULT_ARGS);
    await search(ctx, { ...FILEVAULT_ARGS, docType: 'training' });

    expect(requests).toHaveLength(2);
    expect(mapsRequests()).toBe(3);
  });

  it('at most once a search, however many of its steps need the values', async () => {
    // Only the two courses. The training request needs the values, and so
    // does reading what it finds.
    const { ctx, requests, mapsRequests } = backends(FILEVAULT.entries.filter(e => e.type === 'DOCUMENT'), null);

    const training = await search(ctx, { ...FILEVAULT_ARGS, docType: 'training' });

    expect(mapsRequests()).toBe(1);
    expect(requests.map(r => r.filters)).toEqual([[{ key: 'jamf:contentType', values: LIVE_TRAINING }]]);
    expect(training.results.map(r => [r.title, r.docType])).toEqual([
      ['Administer FileVault with Jamf Pro', 'training'],
      ['Identify Authentication Screens with FileVault and Jamf Connect', 'training'],
    ]);
  });

  it('at most once a search, when the only course is in a language the stand-in lacks', async () => {
    // The stand-in finds nothing in nl-NL, nor does the label, so the search
    // asks again without the docType, and what that finds needs the values.
    const { ctx, requests, mapsRequests } = backends([dutchCourse()], null);

    const training = await search(ctx, { query: 'FileVault', language: 'nl-NL', docType: 'training' });

    expect(mapsRequests()).toBe(1);
    expect(requests.map(r => r.filters)).toEqual([
      [{ key: 'jamf:contentType', values: LIVE_TRAINING }],
      [{ key: 'zoominmetadata', values: ['content-training'] }],
      [],
    ]);
    expect(training.results.map(r => [r.title, r.docType])).toEqual([['Administer FileVault with Jamf Pro', undefined]]);
    expect((training.sc.filterRelaxation as { removed: string[] } | undefined)?.removed).toEqual(['docType']);
  });

  it('once a search, when the product filter found it could not be read', async () => {
    // jamf-routines has no classification, so its filter is its own
    // publication, which needs the maps list, and a search for it goes on
    // without one when the list cannot be read. MapsRegistry keeps no
    // failure, so asking again for the training content types would be a
    // second request for the list in one search; the stand-in is used.
    const { ctx, requests, mapsRequests } = backends(FILEVAULT.entries, null);

    const training = await search(ctx, { ...FILEVAULT_ARGS, product: 'jamf-routines', docType: 'training' });

    expect(mapsRequests()).toBe(1);
    expect(requests.map(r => r.filters)).toEqual([[{ key: 'jamf:contentType', values: LIVE_TRAINING }]]);
    expect(training.results.map(r => [r.title, r.docType])).toEqual([
      ['Video: How to Troubleshoot FileVault Status in Jamf Pro', 'training'],
      ['Administer FileVault with Jamf Pro', 'training'],
      ['Identify Authentication Screens with FileVault and Jamf Connect', 'training'],
    ]);
  });

  it('a registry an embedder stands in with, with no contentTypesOf: the six of 2026-09-28 stand in', async () => {
    const harness = backends(FILEVAULT.entries);
    // Written before the method was: every other method of a registry.
    const registry = Object.fromEntries(Object.entries(createStubMapsRegistry())
      .filter(([name]) => name !== 'contentTypesOf'));
    const ctx: ServerContext = { ...harness.ctx, mapsRegistry: registry as unknown as ServerContext['mapsRegistry'] };

    const unfiltered = await search(ctx, FILEVAULT_ARGS);
    const training = await search(ctx, { ...FILEVAULT_ARGS, docType: 'training' });

    expect(unfiltered.results.filter(r => r.external === true).map(r => r.docType)).toEqual(['training', 'training']);
    expect(harness.requests[1]?.filters).toEqual([{ key: 'jamf:contentType', values: LIVE_TRAINING }]);
    expect(training.results).toHaveLength(3);
  });

  it('not a list an earlier build cached, which holds no content types', async () => {
    // As an earlier build wrote it, under maps-registry-v4: every map, and
    // nothing of its labels or content types.
    const { ctx, mapsRequests } = backends(FILEVAULT.entries);
    const earlier = (map: FtMapInfo): Omit<MapEntry, 'labelKeys' | 'contentType'> => ({
      mapId: map.id, title: map.title ?? '', bundleStem: map.id, version: '',
      locale: map.metadata?.find(m => m.key === 'ft:locale')?.values[0] ?? '', isLatest: false,
      bundleValues: [map.id], portal: [], app: [], utility: [],
    });
    // The key a namespace of no parts is (cache-key.ts), which this build no
    // longer names.
    await ctx.cache.set('maps-registry-v4' as CacheKey, {
      fetchedAt: Date.now(),
      entries: mapsWithContentTypes().map(earlier),
    });

    const unfiltered = await search(ctx, FILEVAULT_ARGS);

    expect(mapsRequests()).toBe(1);
    expect(unfiltered.results.filter(r => r.external === true).map(r => r.docType)).toEqual(['training', 'training']);
  });
});

describe('MapsRegistry.contentTypesOf, on the maps list of 2026-09-28', () => {
  it('gives each content-* label the one value per locale Jamf pairs with it', async () => {
    const { ctx } = backends([]);
    const labels = [...new Set(MAPS_CONTENT_TYPES.flatMap(row => row.labelKeys))].sort();

    const byLabel = Object.fromEntries(await Promise.all(labels.map(async label =>
      [label, await ctx.mapsRegistry.contentTypesOf(label)] as const)));

    expect(byLabel['content-training']).toEqual(LIVE_TRAINING);
    expect(byLabel['content-glossary']).toEqual(['Glossary']);
    // Outside en-US every solution guide is `content-techdocs` too, and
    // carries both values; its own is the solution guide's, not techdocs'.
    expect(byLabel['content-solutionguide']).toEqual([
      'Guide des solutions', 'Guía de soluciones', 'Leitfaden zur Lösung', 'Solution Guide', 'ソリューションガイド', '解決方案指南',
    ]);
    expect(byLabel['content-techdocs']).toEqual([
      'Documentación técnica', 'Documentation technique', 'Technical Documentation', 'Technische Dokumentation',
      'Technische documentatie', 'テクニカル資料', '技術說明文件',
    ]);
    // One value per locale that has a map with the label.
    for (const label of labels) {
      const locales = new Set(MAPS_CONTENT_TYPES
        .filter(row => row.labelKeys.includes(label) && row.contentTypes.length > 0)
        .map(row => row.locale));
      expect(byLabel[label], label).toHaveLength(locales.size);
    }
  });

  it('gives a label no map carries nothing', async () => {
    const { ctx } = backends([]);

    expect(await ctx.mapsRegistry.contentTypesOf('content-nothing')).toEqual([]);
  });
});
