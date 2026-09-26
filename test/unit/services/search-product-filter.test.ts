/**
 * The `product` post-filter in `searchDocumentation`, below the tool boundary:
 * which rule it applies on each path, what it says when it cannot hold, and
 * what it stores in the cache.
 *
 * test/unit/tools/search-product-classification.test.ts drives the tool with
 * Jamf's live classifications (#334). These are the cases that do not surface
 * there: a SearchProvider, which hands over no classification to read; a Fluid
 * Topics response that contains a result the filter should not have let
 * through; an upstream that returned nothing; a registry that cannot say which
 * axis a product's value sits on, or cannot read the maps list at all; which
 * relabelled results are marked as filed under another product; and the
 * short-snippet fallback that repeats the product name.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/core/services/ft-client.js', async (importOriginal) => ({
  ...await importOriginal<typeof FtClientModule>(),
  search: vi.fn(),
}));

import type * as FtClientModule from '../../../src/core/services/ft-client.js';
import { search as ftSearch } from '../../../src/core/services/ft-client.js';
import { searchDocumentation } from '../../../src/core/services/search-service.js';
import { MapsRegistry } from '../../../src/core/services/maps-registry.js';
import { createClassifyingMapsRegistry, createMockCache, createMockContext } from '../../helpers/mock-context.js';
import { makeFtSearchResponse, type FixtureClassification } from '../../helpers/fixtures.js';
import type { MapsProvider, SearchProvider } from '../../../src/core/services/interfaces/index.js';
import type { SearchResult } from '../../../src/core/types.js';

const mockedFtSearch = vi.mocked(ftSearch);

beforeEach(() => {
  mockedFtSearch.mockReset();
});

/**
 * The registry is an offline one: a provider search for a product with no
 * classification reads the maps list, to match results against its
 * publication.
 */
function providerContext(
  results: SearchResult[],
  mapsRegistry: MapsRegistry = createClassifyingMapsRegistry(),
): ReturnType<typeof createMockContext> {
  const searchProvider: SearchProvider = {
    search: vi.fn<SearchProvider['search']>().mockResolvedValue(results),
  };
  return createMockContext({ searchProvider, mapsRegistry });
}

function registryOf(getMaps: MapsProvider['getMaps']): MapsRegistry {
  return new MapsRegistry(createMockCache(), undefined, { getMaps });
}

/** The live Jamf Routines map id (learn.jamf.com, 2026-09-26). */
const ROUTINES_MAP_ID = 'C~Tmp9IxyjJUYOFsJQew8g';

/** A maps list holding the Jamf Routines map, filed under Jamf Pro as it is live. */
function routinesRegistry(): MapsRegistry {
  return registryOf(async () => await Promise.resolve([{
    id: ROUTINES_MAP_ID,
    title: 'Jamf Routines Documentation',
    mapApiEndpoint: `/api/khub/maps/${ROUTINES_MAP_ID}`,
    metadata: [
      { key: 'ft:locale', label: 'ft:locale', values: ['en-US'] },
      { key: 'bundle', label: 'bundle', values: ['jamf-routines-documentation'] },
      { key: 'jamf:portal', label: 'jamf:portal', values: ['Jamf Pro'] },
    ],
  }]));
}

/** A maps list that cannot be read: the fetch failed, or an injected MapsProvider threw. */
function unreadableRegistry(): MapsRegistry {
  return registryOf(async () => await Promise.reject(new Error('maps list unavailable')));
}

function providerResult(title: string, product: string | null): SearchResult {
  return {
    title,
    url: `https://learn.jamf.com/en-US/bundle/x/page/${title.replace(/\W+/g, '_')}.html`,
    snippet: `A provider result titled ${title}, long enough to be a snippet.`,
    product,
  };
}

describe('on the SearchProvider path the filter reads the reported product name', () => {
  it("accepts Jamf's own names for jamf-setup-reset and shows the product asked for", async () => {
    // `Jamf Setup` and `Jamf Reset` are the values Jamf files the guide under;
    // `Jamf Setup and Reset` is this server's name for the one product that
    // covers both. None of the three used to reach jamf-setup-reset but the
    // last: the reverse lookup knew registry names only.
    const ctx = providerContext([
      { ...providerResult('Deploying Jamf Setup', 'Jamf Setup'), mapTitle: 'Shared iPad Deployment Guide' },
      providerResult('Deploying Jamf Reset', 'Jamf Reset'),
      providerResult('Overview', 'Jamf Setup and Reset'),
      providerResult('Login Window', 'Jamf Connect'),
    ]);

    const result = await searchDocumentation(ctx, { query: 'deploy', product: 'jamf-setup-reset' });

    expect(result.results.map(r => [r.title, r.product])).toEqual([
      ['Deploying Jamf Setup', 'Jamf Setup and Reset'],
      ['Deploying Jamf Reset', 'Jamf Setup and Reset'],
      ['Overview', 'Jamf Setup and Reset'],
    ]);
    expect(result.filterRelaxation).toBeUndefined();
    // Renamed within one product, not moved to another: nothing to mark,
    // whatever the publication is called.
    expect(result.results.every(r => r.crossFiled === undefined)).toBe(true);
  });

  it('keeps jamf-routines as an ordinary filter: a provider can report it', async () => {
    // The up-front removal when there is no publication to filter by is about
    // what can be sent to Fluid Topics. A provider is handed `params` and
    // filters however it filters, so its results are judged by the name they
    // report, as any product's are, and by the publication (next test).
    const ctx = providerContext([
      providerResult('Routine Templates Reference', 'Jamf Routines'),
      providerResult('Policies', 'Jamf Pro'),
    ]);

    const result = await searchDocumentation(ctx, { query: 'routine', product: 'jamf-routines' });

    expect(result.results.map(r => r.title)).toEqual(['Routine Templates Reference']);
    expect(result.filterRelaxation).toBeUndefined();
  });

  it('takes a jamf-routines result from its publication whatever product the provider reports', async () => {
    // A provider that goes by Jamf's classification reports Jamf Routines
    // documentation as Jamf Pro, where Jamf files it. Matched by that name
    // alone, none of these passed, and the product filter was relaxed away.
    const ctx = providerContext([
      {
        ...providerResult('Creating a Routine', 'Jamf Pro'),
        url: 'https://learn.jamf.com/r/en-US/jamf-routines-documentation/Creating_a_Routine',
        mapTitle: 'Jamf Routines Documentation',
      },
      // By map id: the url names no bundle this server can read.
      { ...providerResult('Routine Templates', 'Jamf Pro'), mapId: ROUTINES_MAP_ID },
      // The publication itself, as a MAP result is addressed.
      {
        ...providerResult('Jamf Routines Documentation', 'Jamf Pro'),
        url: 'https://learn.jamf.com/r/en-US/jamf-routines-documentation',
      },
      {
        ...providerResult('Policies', 'Jamf Pro'),
        url: 'https://learn.jamf.com/r/en-US/jamf-pro-documentation/Policies',
        mapId: 'pro-map',
      },
      // A Jamf Pro video about Routines, with no map id: not the publication.
      {
        ...providerResult('How to Use Jamf Routines with Jamf Pro', 'Jamf Pro'),
        url: 'https://learn.jamf.com/r/en-US/training-video-shorts-jamf-pro/How_to_Use_Jamf_Routines',
      },
      // Only a Fluid Topics address names a bundle.
      {
        ...providerResult('Mirrored Page', 'Jamf Pro'),
        url: 'https://example.com/r/en-US/jamf-routines-documentation/Mirrored_Page',
      },
    ], routinesRegistry());

    const result = await searchDocumentation(ctx, { query: 'routine', product: 'jamf-routines' });

    expect(result.results.map(r => [r.title, r.product, r.crossFiled])).toEqual([
      ['Creating a Routine', 'Jamf Routines', undefined],
      ['Routine Templates', 'Jamf Routines', undefined],
      ['Jamf Routines Documentation', 'Jamf Routines', undefined],
    ]);
    expect(result.filterRelaxation).toBeUndefined();
  });

  it('still matches jamf-routines by url and name when the maps list cannot be read', async () => {
    const ctx = providerContext([
      {
        ...providerResult('Creating a Routine', 'Jamf Pro'),
        url: 'https://learn.jamf.com/en-US/bundle/jamf-routines-documentation/page/Creating_a_Routine.html',
      },
      // No map ids to match it against.
      { ...providerResult('Routine Templates', 'Jamf Pro'), mapId: ROUTINES_MAP_ID },
      providerResult('Routine Templates Reference', 'Jamf Routines'),
    ], unreadableRegistry());

    const result = await searchDocumentation(ctx, { query: 'routine', product: 'jamf-routines' });

    expect(result.searchError).toBeUndefined();
    expect(result.results.map(r => r.title)).toEqual(['Creating a Routine', 'Routine Templates Reference']);
    expect(result.filterRelaxation).toBeUndefined();
  });

  it('leaves the reported names alone once the product filter is relaxed', async () => {
    // Display follows the filter only while it held. Once relaxation has
    // removed it, nothing says these results are Jamf Protect's, and showing
    // them under it would be the false attribution the relabel exists to
    // avoid.
    const ctx = providerContext([
      providerResult('Policies', 'Jamf Pro'),
      providerResult('Login Window', 'Jamf Connect'),
    ]);

    const result = await searchDocumentation(ctx, { query: 'q', product: 'jamf-protect' });

    expect(result.filterRelaxation?.removed).toEqual(['product']);
    expect(result.results.map(r => [r.title, r.product])).toEqual([
      ['Policies', 'Jamf Pro'],
      ['Login Window', 'Jamf Connect'],
    ]);
  });
});

describe('on the Fluid Topics path the filter reads every classification value', () => {
  const ctx = createMockContext({ mapsRegistry: createClassifyingMapsRegistry() });

  beforeEach(async () => {
    await ctx.cache.clear();
  });

  it('still drops a result that carries none of the product values', async () => {
    // The local filter agrees with the upstream one rather than trusting it,
    // so a result that should not have come back is still caught — and the
    // relaxation that follows is then a true statement.
    mockedFtSearch.mockResolvedValue(makeFtSearchResponse([
      { title: 'Login Window', mapId: 'jamf-connect-documentation' },
      {
        title: 'Network Communication',
        mapId: 'jamf-security-cloud-setup-guide',
        classification: { 'jamf:portal': ['Jamf Security Cloud', 'Jamf Protect'], 'jamf:app': ['Jamf Connect'] },
      },
    ]));

    const result = await searchDocumentation(ctx, { query: 'q', product: 'jamf-security-cloud' });

    expect(result.results.map(r => [r.title, r.product])).toEqual([
      ['Network Communication', 'Jamf Security Cloud'],
    ]);
    expect(result.filterRelaxation).toBeUndefined();
  });

  it('says nothing was removed when upstream returned nothing to relax into', async () => {
    // Relaxation only re-filters what was fetched. With nothing fetched,
    // removing a filter changes nothing, and "Removed filter(s): topic,
    // product" would name filters that were never the reason — the product
    // filter held upstream and simply matched no document for this query.
    mockedFtSearch.mockResolvedValue(makeFtSearchResponse([]));

    const result = await searchDocumentation(ctx, { query: 'q', product: 'jamf-trust', topic: 'network' });

    expect(result.results).toEqual([]);
    expect(result.filterRelaxation).toBeUndefined();
  });

  it('re-labels the short-snippet fallback along with the product', async () => {
    // A snippet under 50 characters is replaced by "title — product". Showing
    // the result under Jamf Trust while its snippet says Jamf Connect would
    // contradict itself; 12 of 12,597 filtered live results were in that
    // shape on 2026-09-26, 5 of them under jamf-trust.
    mockedFtSearch.mockResolvedValue(makeFtSearchResponse([{
      title: '11.42 (2025-02-18)',
      snippet: 'Bug fixes.',
      mapId: 'jamf-trust-documentation',
      classification: {
        'jamf:portal': ['Jamf Safe Internet', 'Jamf Protect'],
        'jamf:app': ['Jamf Connect', 'Jamf Trust'],
      },
    }]));

    const unfiltered = await searchDocumentation(ctx, { query: 'q' });
    expect(unfiltered.results[0]).toMatchObject({
      product: 'Jamf Connect', snippet: '11.42 (2025-02-18) — Jamf Connect',
    });

    const filtered = await searchDocumentation(ctx, { query: 'q', product: 'jamf-trust' });
    expect(filtered.results[0]).toMatchObject({
      product: 'Jamf Trust', snippet: '11.42 (2025-02-18) — Jamf Trust',
    });
  });

  it('caches under a namespace no entry of the old shape was written to', async () => {
    // The cached value now carries every classification value. An entry
    // written by an earlier build carries none, so the product filter would
    // have nothing to read. A new namespace makes those entries unreachable;
    // they expire on their search TTL.
    mockedFtSearch.mockResolvedValue(makeFtSearchResponse([
      { title: 'Plans', mapId: 'jamf-protect-documentation' },
    ]));

    await searchDocumentation(ctx, { query: 'q', product: 'jamf-protect' });

    expect(ctx.cache.set).toHaveBeenCalledWith(
      expect.stringMatching(/^ft-search-v2:/),
      [expect.objectContaining({ classification: ['Jamf Protect'] })],
      ctx.config.cacheTtl.search,
    );
  });
});

describe('when the registry cannot place a product value', () => {
  // An empty maps list — a trimmed snapshot served by an injected
  // MapsProvider, or an empty response that got cached — leaves every value
  // without an axis, so no upstream filter can be built. Unlike jamf-routines,
  // the product still has values, and every result still carries its own, so
  // the local filter works as it always did.
  const ctx = createMockContext({
    mapsRegistry: new MapsRegistry(createMockCache(), undefined, {
      getMaps: async () => await Promise.resolve([]),
    }),
  });

  beforeEach(async () => {
    await ctx.cache.clear();
    mockedFtSearch.mockResolvedValue(makeFtSearchResponse([
      { title: 'Login Window', mapId: 'jamf-connect-documentation' },
      { title: 'Policies', mapId: 'jamf-pro-documentation' },
      { title: 'Plans', mapId: 'jamf-protect-documentation' },
    ]));
  });

  it('searches without the upstream filter and still filters locally', async () => {
    const result = await searchDocumentation(ctx, { query: 'q', product: 'jamf-pro' });

    expect(mockedFtSearch.mock.calls[0]?.[1].filters).toEqual([]);
    expect(result.results.map(r => [r.title, r.product])).toEqual([['Policies', 'Jamf Pro']]);
    // Nothing was removed, and nothing is said about the product being
    // unclassified — it is not.
    expect(result.filterRelaxation).toBeUndefined();
  });

  it('relaxes the product filter as an ordinary one when nothing fetched belongs to it', async () => {
    const result = await searchDocumentation(ctx, { query: 'q', product: 'jamf-school' });

    expect(result.filterRelaxation?.removed).toEqual(['product']);
    expect(result.filterRelaxation?.message).toMatch(/^No results with all filters applied\. Removed filter\(s\): product\./);
    expect(result.filterRelaxation?.message).not.toContain('was not applied');
    // Relaxed, so shown under their own products rather than Jamf School.
    expect(result.results.map(r => r.product)).toEqual(['Jamf Connect', 'Jamf Pro', 'Jamf Protect']);
  });
});

describe('on the Fluid Topics path jamf-routines is matched by map id alone', () => {
  const ctx = createMockContext({ mapsRegistry: routinesRegistry() });

  beforeEach(async () => {
    await ctx.cache.clear();
  });

  it('drops a result from another publication, whatever product it is shown under', async () => {
    // The local filter is the rule upstream applied, `ft:publicationId`, so a
    // Fluid Topics result that is not from the publication goes even when it
    // would be shown as Jamf Routines. Synthetic: Jamf files nothing as Jamf
    // Routines today. The stub returns both whatever the filters, as Fluid
    // Topics would if it ignored the key.
    mockedFtSearch.mockResolvedValue(makeFtSearchResponse([
      { title: 'Creating a Routine', mapId: ROUTINES_MAP_ID, classification: { 'jamf:portal': ['Jamf Pro'] } },
      {
        title: 'How to Use Jamf Routines with Jamf Pro',
        mapId: 'training-video-shorts-jamf-pro',
        classification: { 'jamf:portal': ['Jamf Pro'], 'jamf:app': ['Jamf Routines'] },
      },
    ]));

    const result = await searchDocumentation(ctx, { query: 'routine', product: 'jamf-routines' });

    expect(mockedFtSearch.mock.calls[0]?.[1].filters).toEqual([{ key: 'ft:publicationId', values: [ROUTINES_MAP_ID] }]);
    expect(result.results.map(r => [r.title, r.product])).toEqual([['Creating a Routine', 'Jamf Routines']]);
    expect(result.filterRelaxation).toBeUndefined();
  });
});

describe('when the maps list cannot be read', () => {
  // The maps fetch fails, or an injected MapsProvider throws. A classified
  // product's search has always needed the list, to know which axis its value
  // sits on. jamf-routines needs it only to be filtered by its publication,
  // and before that its search never read the list, so it falls back to what
  // it did then.
  const ctx = createMockContext({ mapsRegistry: unreadableRegistry() });

  beforeEach(async () => {
    await ctx.cache.clear();
    mockedFtSearch.mockResolvedValue(makeFtSearchResponse([
      { title: 'Policies', mapId: 'jamf-pro-documentation' },
      { title: 'Login Window', mapId: 'jamf-connect-documentation' },
    ]));
  });

  it('searches for jamf-routines unfiltered and says the filter was not applied', async () => {
    const result = await searchDocumentation(ctx, { query: 'q', product: 'jamf-routines' });

    expect(result.searchError).toBeUndefined();
    expect(mockedFtSearch.mock.calls[0]?.[1].filters).toEqual([]);
    expect(result.results.map(r => [r.title, r.product])).toEqual([
      ['Policies', 'Jamf Pro'],
      ['Login Window', 'Jamf Connect'],
    ]);
    expect(result.filterRelaxation).toEqual({
      removed: ['product'],
      original: { product: 'jamf-routines' },
      message: expect.stringContaining('The product filter "jamf-routines" was not applied'),
    });
  });

  it('still fails a classified product search, as it always did', async () => {
    const result = await searchDocumentation(ctx, { query: 'q', product: 'jamf-pro' });

    expect(result.searchError).toContain('maps list unavailable');
    expect(result.results).toEqual([]);
    expect(mockedFtSearch).not.toHaveBeenCalled();
  });
});

describe('a relabelled result is marked when its product would misidentify it', () => {
  const ctx = createMockContext({ mapsRegistry: createClassifyingMapsRegistry() });

  const TRUST_NOTES: FixtureClassification = {
    'jamf:portal': ['Jamf Safe Internet', 'Jamf Protect'],
    'jamf:app': ['Jamf Connect', 'Jamf Trust'],
  };

  beforeEach(async () => {
    await ctx.cache.clear();
  });

  it('marks another product\'s publication, not the product\'s own', async () => {
    mockedFtSearch.mockResolvedValue(makeFtSearchResponse([
      { title: 'Windows', mapId: 'jamf-trust-documentation', mapTitle: 'Jamf Trust Release Notes', classification: TRUST_NOTES },
      { title: 'Plans', mapId: 'jamf-protect-documentation', mapTitle: 'Jamf Protect Documentation' },
    ]));

    const protect = await searchDocumentation(ctx, { query: 'q', product: 'jamf-protect' });
    expect(protect.results.map(r => [r.title, r.product, r.crossFiled])).toEqual([
      ['Windows', 'Jamf Protect', true],
      ['Plans', 'Jamf Protect', undefined],
    ]);

    // The same topic under its own product is relabelled too — Jamf lists
    // Jamf Connect first — but "Jamf Trust Release Notes" already says whose
    // it is.
    const trust = await searchDocumentation(ctx, { query: 'q', product: 'jamf-trust' });
    expect(trust.results.map(r => [r.title, r.product, r.crossFiled])).toEqual([
      ['Windows', 'Jamf Trust', undefined],
    ]);

    // And nothing is marked where nothing was relabelled.
    const unfiltered = await searchDocumentation(ctx, { query: 'q' });
    expect(unfiltered.results.every(r => r.crossFiled === undefined)).toBe(true);
  });

  it('reads the publication title for whole product names', async () => {
    // "Jamf Protect Release Notes" contains "Jamf Pro" but does not name it.
    // Synthetic: a Jamf Protect publication filed under Jamf Pro as well.
    mockedFtSearch.mockResolvedValue(makeFtSearchResponse([{
      title: 'Overview',
      mapId: 'jamf-protect-release-notes',
      mapTitle: 'Jamf Protect Release Notes',
      classification: { 'jamf:portal': ['Jamf Protect', 'Jamf Pro'] },
    }]));

    const result = await searchDocumentation(ctx, { query: 'q', product: 'jamf-pro' });

    expect(result.results.map(r => [r.product, r.crossFiled])).toEqual([['Jamf Pro', true]]);
  });
});

describe('topic matching reads the document, not the attribution', () => {
  const ctx = createMockContext({ mapsRegistry: createClassifyingMapsRegistry() });

  beforeEach(async () => {
    await ctx.cache.clear();
  });

  it('does not match a topic on the product name the short-snippet fallback appends', async () => {
    // "Bug fixes." is too short, so the snippet is "11.42 (2025-02-18) — Jamf
    // Connect", and connect-login lists "jamf connect" among its keywords. The
    // topic filter used to pass the result on that name alone — and a
    // jamf-trust search then showed it as "… — Jamf Trust", with nothing
    // left to explain the match.
    mockedFtSearch.mockResolvedValue(makeFtSearchResponse([{
      title: '11.42 (2025-02-18)',
      snippet: 'Bug fixes.',
      mapId: 'jamf-trust-documentation',
      classification: {
        'jamf:portal': ['Jamf Safe Internet', 'Jamf Protect'],
        'jamf:app': ['Jamf Connect', 'Jamf Trust'],
      },
    }]));

    const result = await searchDocumentation(ctx, { query: 'q', product: 'jamf-trust', topic: 'connect-login' });

    expect(result.filterRelaxation?.removed).toEqual(['topic']);
    // The product filter held, so the result is still shown under it.
    expect(result.results[0]).toMatchObject({
      product: 'Jamf Trust', snippet: '11.42 (2025-02-18) — Jamf Trust',
    });
  });
});
