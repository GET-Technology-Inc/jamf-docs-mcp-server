/**
 * Unit tests for search-service — Fluid Topics powered search
 *
 * Mocks at the HTTP layer (http-client) so the real ft-client.search()
 * URL construction and request body serialization are exercised.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock http-client at the HTTP layer, keeping the real HttpError class
vi.mock('../../../src/core/http-client.js', async () => {
  const actual = await import('../../../src/core/http-client.js');
  return {
    httpGetJson: vi.fn(),
    httpGetText: vi.fn(),
    httpPostJson: vi.fn(),
    HttpError: actual.HttpError,
  };
});

import { httpPostJson } from '../../../src/core/http-client.js';
import {
  buildSearchFilters,
  transformFtSearchResult,
  searchDocumentation,
  dedupeToLatestVersions,
} from '../../../src/core/services/search-service.js';
import {
  DOCS_BASE_URL,
  FT_API_BASE,
  DOC_TYPE_IDS,
  DOC_TYPE_LABEL_MAP,
} from '../../../src/core/constants.js';
import type { DocTypeId } from '../../../src/core/constants.js';
import type {
  FtSearchEntry,
  FtSearchCluster,
  FtClusteredSearchResponse,
  FtMetadataEntry,
  SearchResult,
} from '../../../src/core/types.js';
import type { ServerContext } from '../../../src/core/types/context.js';
import { createMockContext } from '../../helpers/mock-context.js';

const mockedPostJson = vi.mocked(httpPostJson);

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================================
// Helpers
// ============================================================================

function makeMetadata(entries: Record<string, string[]>): FtMetadataEntry[] {
  return Object.entries(entries).map(([key, values]) => ({
    key,
    label: key,
    values,
  }));
}

function makeTopicEntry(overrides?: {
  mapId?: string;
  contentId?: string;
  title?: string;
  htmlExcerpt?: string;
  mapTitle?: string;
  breadcrumb?: string[];
  metadata?: FtMetadataEntry[];
}): FtSearchEntry {
  return {
    type: 'TOPIC',
    missingTerms: [],
    topic: {
      mapId: overrides?.mapId ?? 'jamf-pro-documentation',
      contentId: overrides?.contentId ?? 'topic-123',
      tocId: 'toc-1',
      title: overrides?.title ?? 'Configuration Profiles',
      htmlTitle: overrides?.title ?? 'Configuration Profiles',
      mapTitle: overrides?.mapTitle ?? 'Jamf Pro Documentation',
      breadcrumb: overrides?.breadcrumb ?? ['Jamf Pro', 'Profiles'],
      htmlExcerpt: overrides?.htmlExcerpt ?? '<b>Learn</b> about configuration profiles in Jamf Pro for managing device settings.',
      metadata: overrides?.metadata ?? makeMetadata({
        'zoominmetadata': ['product-pro'],
        'ft:prettyUrl': ['/en-US/bundle/jamf-pro-documentation/page/Configuration_Profiles.html'],
        'version': ['11.5.0'],
        'jamf:contentType': ['Technical Documentation'],
      }),
    },
  };
}

function makeMapEntry(overrides?: {
  mapId?: string;
  title?: string;
  htmlExcerpt?: string;
  readerUrl?: string;
  mapUrl?: string;
  metadata?: FtMetadataEntry[];
}): FtSearchEntry {
  return {
    type: 'MAP',
    missingTerms: [],
    map: {
      mapId: overrides?.mapId ?? 'jamf-pro-documentation',
      mapUrl: overrides?.mapUrl ?? '/en-US/bundle/jamf-pro-documentation',
      readerUrl: overrides?.readerUrl ?? '/en-US/bundle/jamf-pro-documentation/page/index.html',
      title: overrides?.title ?? 'Jamf Pro Documentation',
      htmlTitle: overrides?.title ?? 'Jamf Pro Documentation',
      htmlExcerpt: overrides?.htmlExcerpt ?? 'Complete documentation for <b>Jamf Pro</b>.',
      metadata: overrides?.metadata ?? makeMetadata({
        'zoominmetadata': ['product-pro'],
        'version': ['current'],
        'jamf:contentType': ['Technical Documentation'],
      }),
      editorialType: 'STANDARD',
      openMode: 'reader',
    },
  };
}

function makeCluster(entries: FtSearchEntry[]): FtSearchCluster {
  return {
    metadataVariableAxis: 'publisher',
    entries,
  };
}

function makeFtResponse(
  clusters: FtSearchCluster[],
  totalResults = -1
): FtClusteredSearchResponse {
  const total = totalResults >= 0
    ? totalResults
    : clusters.reduce((sum, c) => sum + c.entries.length, 0);
  return {
    facets: [],
    results: clusters,
    announcements: [],
    paging: {
      currentPage: 0,
      isLastPage: true,
      totalResultsCount: total,
      totalClustersCount: clusters.length,
    },
  };
}

// ============================================================================
// buildSearchFilters()
// ============================================================================

describe('buildSearchFilters()', () => {
  // NOTE: `latestVersion=yes` is intentionally NOT auto-added. Jamf's non-Pro
  // products are unversioned (no latestVersion metadata), so that filter used to
  // silently drop them. Jamf Pro version snapshots are collapsed client-side via
  // dedupeToLatestVersions() instead.
  it('should not add any filter when no version specified', () => {
    const filters = buildSearchFilters({});
    expect(filters).toEqual([]);
  });

  it('should not add a version filter when version is "current"', () => {
    const filters = buildSearchFilters({ version: 'current' });
    expect(filters).toEqual([]);
  });

  it('should not add a version filter when version is empty string', () => {
    const filters = buildSearchFilters({ version: '' });
    expect(filters).toEqual([]);
  });

  it('should add version filter when specific version provided', () => {
    const filters = buildSearchFilters({ version: '11.5.0' });
    expect(filters).toEqual([
      { key: 'version', values: ['11.5.0'] },
    ]);
  });

  it('should map product to zoominmetadata filter', () => {
    const filters = buildSearchFilters({ product: 'jamf-pro' });
    expect(filters).toContainEqual({
      key: 'zoominmetadata',
      values: ['product-pro'],
    });
  });

  // Offline guard against constants drift for a non-Pro product. The live
  // counterpart (data-contracts: searchLabel must exist in live zoominmetadata)
  // catches Jamf-side renames; this catches an accidental constants edit without
  // needing the network. (This is exactly the chain that silently broke for
  // jamf-routines.)
  it('maps a non-Pro product to its exact zoominmetadata search label', () => {
    expect(buildSearchFilters({ product: 'jamf-school' })).toEqual([
      { key: 'zoominmetadata', values: ['product-school'] },
    ]);
  });

  // Pinned offline and by exact string. `product-self-service` also exists
  // upstream and also returns results — it is the retired iOS Self Service
  // app's label — so reverting this one character produces a green suite and
  // wrong answers. The live contract test that checks the map titles lives in
  // the integration job, which does not block a merge; this one runs in the
  // unit job, which does.
  it('maps self-service-plus to product-selfservice, not the retired iOS label', () => {
    expect(buildSearchFilters({ product: 'self-service-plus' })).toEqual([
      { key: 'zoominmetadata', values: ['product-selfservice'] },
    ]);
  });

  // docType filters on the `content-*` label, NOT `jamf:contentType`. The
  // latter's values are translated per locale ('Release Notes' / '版本資訊' /
  // 'リリースノート'), so the English string matched nothing upstream in seven
  // of the eight supported locales — and because the emptiness came back from
  // the API, applyFiltersWithFallback had nothing left to relax.
  it('should map docType to a locale-invariant zoominmetadata content-* filter', () => {
    const filters = buildSearchFilters({ docType: 'release-notes' });
    expect(filters).toContainEqual({
      key: 'zoominmetadata',
      values: ['content-releasenotes'],
    });
  });

  it('never sends jamf:contentType, whose values are locale-dependent', () => {
    for (const docType of DOC_TYPE_IDS as DocTypeId[]) {
      expect(
        buildSearchFilters({ docType }).map(f => f.key),
        `docType '${docType}' must not filter on jamf:contentType`
      ).not.toContain('jamf:contentType');
    }
  });

  it('maps every docType to its DOC_TYPE_LABEL_MAP label key', () => {
    for (const docType of DOC_TYPE_IDS as DocTypeId[]) {
      expect(buildSearchFilters({ docType })).toEqual([
        { key: 'zoominmetadata', values: [DOC_TYPE_LABEL_MAP[docType]] },
      ]);
    }
  });

  // Fluid Topics intersects separate filter objects but unions the values
  // inside one, so product and docType must stay in two entries even though
  // they share the `zoominmetadata` key. Merged into one entry, a
  // product+docType search widens to the union instead of narrowing.
  it('keeps product and docType as two separate zoominmetadata entries', () => {
    const filters = buildSearchFilters({ product: 'jamf-protect', docType: 'release-notes' });
    expect(filters).toEqual([
      { key: 'zoominmetadata', values: ['product-protect'] },
      { key: 'zoominmetadata', values: ['content-releasenotes'] },
    ]);
  });

  it('should map documentation docType correctly', () => {
    const filters = buildSearchFilters({ docType: 'documentation' });
    expect(filters).toContainEqual({
      key: 'zoominmetadata',
      values: ['content-techdocs'],
    });
  });

  it('should combine product, docType, and version filters', () => {
    const filters = buildSearchFilters({
      product: 'jamf-connect',
      docType: 'documentation',
      version: '2.30.0',
    });
    expect(filters).toHaveLength(3);
    expect(filters).toContainEqual({ key: 'zoominmetadata', values: ['product-connect'] });
    expect(filters).toContainEqual({ key: 'zoominmetadata', values: ['content-techdocs'] });
    expect(filters).toContainEqual({ key: 'version', values: ['2.30.0'] });
  });

  it('should not add a docType filter when docType has no mapping', () => {
    // Use a hypothetical unmapped docType to verify the fallback behavior
    const filters = buildSearchFilters({ docType: 'unknown-type' as never });
    expect(filters).toEqual([]);
  });

  // `training` used to map through DOC_TYPE_CONTENT_TYPE_MAP onto 'Technical
  // Documentation', which four docTypes share — so the upstream query widened
  // to all technical documentation and only the client-side post-filter
  // narrowed it back. `content-training` is one-to-one, so the narrowing now
  // happens at the API where it belongs.
  it('narrows training to its own label rather than the shared techdocs value', () => {
    expect(buildSearchFilters({ docType: 'training' })).toEqual([
      { key: 'zoominmetadata', values: ['content-training'] },
    ]);
  });
});

// ============================================================================
// dedupeToLatestVersions()
// ============================================================================

/** Build a TOPIC entry carrying a cluster id, version, and product label. */
function makeVersionedEntry(
  clusterId: string,
  version: string,
  product: string,
  contentId: string
): FtSearchEntry {
  return makeTopicEntry({
    contentId,
    title: `${product} ${clusterId} ${version}`,
    metadata: makeMetadata({
      'ft:clusterId': [clusterId],
      ...(version !== '' ? { version: [version] } : {}),
      'zoominmetadata': [product],
    }),
  });
}

describe('dedupeToLatestVersions()', () => {
  it('collapses Jamf Pro version snapshots of one topic to the latest version', () => {
    const clusterId = 'jamf-pro-documentation-current/Enrollment_URL';
    const cluster = makeCluster([
      makeVersionedEntry(clusterId, '11.27.0', 'product-pro', 'c1'),
      makeVersionedEntry(clusterId, '11.29.0', 'product-pro', 'c2'),
      makeVersionedEntry(clusterId, '11.28.0', 'product-pro', 'c3'),
    ]);

    const deduped = dedupeToLatestVersions([cluster]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].topic?.contentId).toBe('c2'); // the 11.29.0 entry
  });

  it('preserves non-versioned non-Pro topics (distinct cluster ids)', () => {
    const deduped = dedupeToLatestVersions([
      makeCluster([makeVersionedEntry('jamf-pro-documentation-current/A', '11.29.0', 'product-pro', 'p')]),
      makeCluster([makeVersionedEntry('jamf-school-documentation/Enrollment_Settings', '', 'product-school', 's')]),
      makeCluster([makeVersionedEntry('jamf-connect-documentation/About', '', 'product-connect', 'c')]),
    ]);

    // One result per product — none dropped by version dedup.
    expect(deduped).toHaveLength(3);
    const products = deduped.map(
      e => e.topic?.metadata?.find(m => m.key === 'zoominmetadata')?.values[0]
    );
    expect(new Set(products)).toEqual(new Set(['product-pro', 'product-school', 'product-connect']));
  });

  it('preserves first-seen (relevance) order', () => {
    const deduped = dedupeToLatestVersions([
      makeCluster([makeVersionedEntry('school/X', '', 'product-school', 'first')]),
      makeCluster([
        makeVersionedEntry('pro/Y', '11.20.0', 'product-pro', 'second-old'),
        makeVersionedEntry('pro/Y', '11.29.0', 'product-pro', 'second-new'),
      ]),
      makeCluster([makeVersionedEntry('connect/Z', '', 'product-connect', 'third')]),
    ]);

    expect(deduped.map(e => e.topic?.contentId)).toEqual(['first', 'second-new', 'third']);
  });

  it('keeps each entry that has no cluster id (cannot be version-deduped)', () => {
    const noCluster1 = makeTopicEntry({ contentId: 'n1', metadata: makeMetadata({ 'zoominmetadata': ['product-pro'] }) });
    const noCluster2 = makeTopicEntry({ contentId: 'n2', metadata: makeMetadata({ 'zoominmetadata': ['product-pro'] }) });

    const deduped = dedupeToLatestVersions([makeCluster([noCluster1, noCluster2])]);

    expect(deduped).toHaveLength(2);
  });
});

// ============================================================================
// transformFtSearchResult()
// ============================================================================

describe('transformFtSearchResult()', () => {
  describe('TOPIC entries', () => {
    it('should extract title from topic.title', () => {
      const entry = makeTopicEntry({ title: 'My Custom Title' });
      const result = transformFtSearchResult(entry);
      expect(result.title).toBe('My Custom Title');
    });

    it('should build URL from ft:prettyUrl with DOCS_BASE_URL prefix', () => {
      const entry = makeTopicEntry();
      const result = transformFtSearchResult(entry);
      expect(result.url).toBe(
        `${DOCS_BASE_URL}/en-US/bundle/jamf-pro-documentation/page/Configuration_Profiles.html`
      );
    });

    it('should fallback to legacy URL when ft:prettyUrl is missing', () => {
      const entry = makeTopicEntry({
        mapId: 'jamf-pro-documentation',
        contentId: 'topic-456',
        metadata: makeMetadata({
          'zoominmetadata': ['product-pro'],
          'version': ['11.5.0'],
        }),
      });
      const result = transformFtSearchResult(entry);
      expect(result.url).toBe(
        `${DOCS_BASE_URL}/r/en-US/jamf-pro-documentation/topic-456`
      );
    });

    it('should clean HTML from htmlExcerpt snippet', () => {
      const entry = makeTopicEntry({
        htmlExcerpt: '<b>Learn</b> about <em>profiles</em> in Jamf Pro for managing device settings and security.',
      });
      const result = transformFtSearchResult(entry);
      expect(result.snippet).not.toContain('<b>');
      expect(result.snippet).not.toContain('<em>');
      expect(result.snippet).toContain('Learn');
    });

    it('should extract product from zoominmetadata', () => {
      const entry = makeTopicEntry({
        metadata: makeMetadata({
          'zoominmetadata': ['product-pro'],
          'ft:prettyUrl': ['/en-US/bundle/jamf-pro-documentation/page/test.html'],
        }),
      });
      const result = transformFtSearchResult(entry);
      expect(result.product).toBe('Jamf Pro');
    });

    it('should extract version from metadata', () => {
      const entry = makeTopicEntry();
      const result = transformFtSearchResult(entry);
      expect(result.version).toBe('11.5.0');
    });

    it('should set mapId from topic', () => {
      const entry = makeTopicEntry({ mapId: 'my-map-id' });
      const result = transformFtSearchResult(entry);
      expect(result.mapId).toBe('my-map-id');
    });

    it('should set contentId from topic', () => {
      const entry = makeTopicEntry({ contentId: 'my-content-id' });
      const result = transformFtSearchResult(entry);
      expect(result.contentId).toBe('my-content-id');
    });

    it('should set breadcrumb from topic', () => {
      const entry = makeTopicEntry({ breadcrumb: ['Level 1', 'Level 2', 'Level 3'] });
      const result = transformFtSearchResult(entry);
      expect(result.breadcrumb).toEqual(['Level 1', 'Level 2', 'Level 3']);
    });

    it('should omit breadcrumb when empty', () => {
      const entry = makeTopicEntry({ breadcrumb: [] });
      const result = transformFtSearchResult(entry);
      expect(result.breadcrumb).toBeUndefined();
    });

    it('should set mapTitle from topic', () => {
      const entry = makeTopicEntry({ mapTitle: 'Jamf Pro Documentation Guide' });
      const result = transformFtSearchResult(entry);
      expect(result.mapTitle).toBe('Jamf Pro Documentation Guide');
    });

    it('should omit mapTitle when empty', () => {
      const entry = makeTopicEntry({ mapTitle: '' });
      const result = transformFtSearchResult(entry);
      expect(result.mapTitle).toBeUndefined();
    });

    // ── docType derivation ──────────────────────────────────────────────────
    //
    // FT ships the answer as `content-*` values under `zoominmetadata`, whose
    // vocabulary is exactly DOC_TYPES' labelKey set. `jamf:contentType` is
    // many-to-one ('Technical Documentation' covers four docTypes) and so
    // cannot be reversed: reverse-looking it up in DOC_TYPE_CONTENT_TYPE_MAP's
    // insertion order labelled every release note `documentation`, because
    // release notes carry BOTH values and `documentation` is declared first.
    it('should derive docType from the zoominmetadata content-* label', () => {
      const entry = makeTopicEntry({
        metadata: makeMetadata({
          'zoominmetadata': ['product-pro', 'content-releasenotes'],
          'ft:prettyUrl': ['/en-US/bundle/jamf-pro-documentation/page/test.html'],
          'jamf:contentType': ['Release Notes'],
        }),
      });
      const result = transformFtSearchResult(entry);
      expect(result.docType).toBe('release-notes');
    });

    // Shape copied from the live FT API (jamf-pro release notes, 2026-08-03):
    // both labels present, `content-techdocs` listed first.
    it('should prefer the specific label over content-techdocs on a release note', () => {
      const entry = makeTopicEntry({
        metadata: makeMetadata({
          'zoominmetadata': [
            'content-techdocs',
            'role-administrator',
            'product-pro',
            'content-releasenotes',
            'release-status-ga',
            'product-pro-11.24.0',
          ],
          'ft:prettyUrl': ['/en-US/bundle/jamf-pro-documentation/page/test.html'],
          'jamf:contentType': ['Technical Documentation', 'Release Notes'],
        }),
      });
      const result = transformFtSearchResult(entry);
      expect(result.docType).toBe('release-notes');
    });

    it.each([
      ['content-solutionguide', 'solution-guide'],
      ['content-gettingstarted', 'getting-started'],
      ['content-training', 'training'],
      ['content-glossary', 'glossary'],
    ])('should report %s alongside content-techdocs as %s', (labelKey, expected) => {
      const entry = makeTopicEntry({
        metadata: makeMetadata({
          'zoominmetadata': ['content-techdocs', 'product-pro', labelKey],
          'ft:prettyUrl': ['/en-US/bundle/jamf-pro-documentation/page/test.html'],
          'jamf:contentType': ['Technical Documentation'],
        }),
      });
      const result = transformFtSearchResult(entry);
      expect(result.docType).toBe(expected);
    });

    it('should report content-techdocs alone as documentation', () => {
      const entry = makeTopicEntry({
        metadata: makeMetadata({
          'zoominmetadata': ['product-pro', 'content-techdocs'],
          'ft:prettyUrl': ['/en-US/bundle/jamf-pro-documentation/page/test.html'],
          'jamf:contentType': ['Technical Documentation'],
        }),
      });
      const result = transformFtSearchResult(entry);
      expect(result.docType).toBe('documentation');
    });

    // "no content-* label" must stay unknown rather than become a positive
    // assertion of `documentation` — Jamf's glossary topics come back with no
    // zoominmetadata at all, and calling them documentation makes the docType
    // filter drop them from every search except docType: 'documentation'.
    it('should leave docType undefined when no content-* label is present', () => {
      const entry = makeTopicEntry({
        metadata: makeMetadata({
          'zoominmetadata': ['product-pro'],
          'ft:prettyUrl': ['/en-US/bundle/jamf-pro-documentation/page/test.html'],
          'jamf:contentType': ['Unknown Type'],
        }),
      });
      const result = transformFtSearchResult(entry);
      expect(result.docType).toBeUndefined();
    });

    it('should leave docType undefined when the entry has no metadata at all', () => {
      const entry = makeTopicEntry({ metadata: [] });
      const result = transformFtSearchResult(entry);
      expect(result.docType).toBeUndefined();
    });

    it('should handle Untitled when title is empty', () => {
      const entry = makeTopicEntry({ title: '' });
      const result = transformFtSearchResult(entry);
      expect(result.title).toBe('Untitled');
    });

    it('should return null product when zoominmetadata has no product match', () => {
      const entry = makeTopicEntry({
        metadata: makeMetadata({
          'zoominmetadata': ['some-unknown-label'],
          'ft:prettyUrl': ['/en-US/bundle/test/page/test.html'],
        }),
      });
      const result = transformFtSearchResult(entry);
      expect(result.product).toBeNull();
    });
  });

  describe('MAP entries', () => {
    it('should extract title from map', () => {
      const entry = makeMapEntry({ title: 'Jamf School Documentation' });
      const result = transformFtSearchResult(entry);
      expect(result.title).toBe('Jamf School Documentation');
    });

    it('should use readerUrl for URL', () => {
      const entry = makeMapEntry({
        readerUrl: '/en-US/bundle/jamf-school-documentation/page/index.html',
      });
      const result = transformFtSearchResult(entry);
      expect(result.url).toBe(
        `${DOCS_BASE_URL}/en-US/bundle/jamf-school-documentation/page/index.html`
      );
    });

    it('should fallback to mapUrl when readerUrl is empty', () => {
      const entry = makeMapEntry({
        readerUrl: '',
        mapUrl: '/en-US/bundle/jamf-pro-documentation',
      });
      const result = transformFtSearchResult(entry);
      expect(result.url).toBe(`${DOCS_BASE_URL}/en-US/bundle/jamf-pro-documentation`);
    });

    it('should set mapId from map', () => {
      const entry = makeMapEntry({ mapId: 'school-map-1' });
      const result = transformFtSearchResult(entry);
      expect(result.mapId).toBe('school-map-1');
    });

    it('should set mapTitle from map title', () => {
      const entry = makeMapEntry({ title: 'Jamf Protect Docs' });
      const result = transformFtSearchResult(entry);
      expect(result.mapTitle).toBe('Jamf Protect Docs');
    });
  });

  // ── Titleless payloads ────────────────────────────────────────────────────
  //
  // `FtSearchTopic.title` / `FtSearchMap.title` come from a bare cast over
  // `response.json()` with no runtime validation, so a payload without a title
  // is a shape the type forbids and the network can still produce. The guard
  // used to read `fields.title !== ''`, and `undefined !== ''` is true — so the
  // 'Untitled' fallback never fired and `undefined` reached SearchResult.title,
  // which is declared `string`.
  describe('entries with no title', () => {
    it('should fall back to Untitled for a TOPIC with no title', () => {
      const entry = makeTopicEntry();
      delete entry.topic?.title;

      const result = transformFtSearchResult(entry);

      expect(result.title).toBe('Untitled');
    });

    it('should fall back to Untitled for a MAP with no title', () => {
      const entry = makeMapEntry();
      delete entry.map?.title;

      const result = transformFtSearchResult(entry);

      expect(result.title).toBe('Untitled');
    });

    it('should still fall back to Untitled for an empty-string title', () => {
      const entry = makeTopicEntry({ title: '' });
      const result = transformFtSearchResult(entry);
      expect(result.title).toBe('Untitled');
    });

    it('should keep the literal string "undefined" out of the snippet', () => {
      // cleanSnippet() falls back to `${title} — ${product}` for a short
      // snippet, so an undefined title used to render as "undefined — Jamf Pro".
      const entry = makeTopicEntry({ htmlExcerpt: '<b>hi</b>' });
      delete entry.topic?.title;

      const result = transformFtSearchResult(entry);

      expect(result.snippet).not.toContain('undefined');
      expect(result.snippet).toContain('Untitled');
    });
  });
});

// ============================================================================
// searchDocumentation()
// ============================================================================

describe('searchDocumentation()', () => {
  let ctx: ReturnType<typeof createMockContext>;

  beforeEach(() => {
    ctx = createMockContext();
  });

  it('should return results from FT API', async () => {
    const entry = makeTopicEntry();
    mockedPostJson.mockResolvedValueOnce(
      makeFtResponse([makeCluster([entry])])
    );

    const result = await searchDocumentation(ctx, { query: 'profiles' });
    expect(result.results).toHaveLength(1);
    expect(result.results[0].title).toBe('Configuration Profiles');
    expect(result.pagination.totalItems).toBe(1);
  });

  it('should NOT pass a latestVersion filter when no version specified', async () => {
    mockedPostJson.mockResolvedValueOnce(makeFtResponse([]));

    await searchDocumentation(ctx, { query: 'test' });

    const body = mockedPostJson.mock.calls[0]?.[1] as { filters: { key: string }[] };
    expect(body.filters).toEqual([]);
    expect(body.filters.some(f => f.key === 'latestVersion')).toBe(false);
  });

  it('should pass version filter when version specified', async () => {
    mockedPostJson.mockResolvedValueOnce(makeFtResponse([]));

    await searchDocumentation(ctx, { query: 'test', version: '11.5.0' });

    expect(mockedPostJson).toHaveBeenCalledWith(
      `${FT_API_BASE}/api/khub/clustered-search`,
      expect.objectContaining({
        filters: expect.arrayContaining([
          { key: 'version', values: ['11.5.0'] },
        ]),
      })
    );
  });

  it('should pass product filter as zoominmetadata', async () => {
    mockedPostJson.mockResolvedValueOnce(makeFtResponse([]));

    await searchDocumentation(ctx, { query: 'test', product: 'jamf-protect' });

    expect(mockedPostJson).toHaveBeenCalledWith(
      `${FT_API_BASE}/api/khub/clustered-search`,
      expect.objectContaining({
        filters: expect.arrayContaining([
          { key: 'zoominmetadata', values: ['product-protect'] },
        ]),
      })
    );
  });

  it('returns results spanning multiple products and collapses Pro version snapshots', async () => {
    // Mirrors the live API after Jamf's unversioned-non-Pro migration: a broad
    // query returns many Jamf Pro version snapshots of the same topics plus
    // single unversioned entries for non-Pro products. The service must surface
    // every product (regression: latestVersion=yes used to hide non-Pro) while
    // collapsing Pro snapshots to one result per topic.
    mockedPostJson.mockResolvedValueOnce(
      makeFtResponse([
        makeCluster([
          makeVersionedEntry('jamf-pro-documentation-current/Enrollment', '11.27.0', 'product-pro', 'pro-old'),
          makeVersionedEntry('jamf-pro-documentation-current/Enrollment', '11.29.0', 'product-pro', 'pro-new'),
        ]),
        makeCluster([makeVersionedEntry('jamf-school-documentation/Enrollment_Settings', '', 'product-school', 'school')]),
        makeCluster([makeVersionedEntry('jamf-connect-documentation/Enrollment', '', 'product-connect', 'connect')]),
      ])
    );

    const result = await searchDocumentation(ctx, { query: 'enrollment' });

    const products = new Set(result.results.map(r => r.product));
    expect(products).toEqual(new Set(['Jamf Pro', 'Jamf School', 'Jamf Connect']));
    // Pro's two version snapshots collapse to one result (the latest, 11.29.0).
    const proResults = result.results.filter(r => r.product === 'Jamf Pro');
    expect(proResults).toHaveLength(1);
    expect(proResults[0].contentId).toBe('pro-new');
  });

  // ── docType post-filter ───────────────────────────────────────────────────
  //
  // Regression: search(query='declarative device management', product='jamf-pro',
  // docType='release-notes') returned "No results with all filters applied.
  // Removed filter(s): docType." while the results it then showed were visibly
  // release notes. Every jamf-pro release note carries both `content-techdocs`
  // and `content-releasenotes`; labelKeys were derived from a single reversed
  // docType and came out as ['content-techdocs'], so the filter dropped them all.
  describe('docType filtering of release notes', () => {
    /** A jamf-pro release note, labelled the way the live FT API labels one. */
    function makeReleaseNoteEntry(contentId: string): FtSearchEntry {
      return makeTopicEntry({
        contentId,
        title: 'Improved Declarative Device Management for Migrated Instances',
        metadata: makeMetadata({
          'zoominmetadata': [
            'content-techdocs',
            'role-administrator',
            'product-pro',
            'content-releasenotes',
            'product-pro-11.24.0',
          ],
          'ft:prettyUrl': [`/en-US/bundle/jamf-pro-release-notes-11.24.0/page/${contentId}.html`],
          'jamf:contentType': ['Technical Documentation', 'Release Notes'],
        }),
      });
    }

    it('keeps release notes when product and docType are combined', async () => {
      mockedPostJson.mockResolvedValueOnce(
        makeFtResponse([makeCluster([makeReleaseNoteEntry('rn-1')])])
      );

      const result = await searchDocumentation(ctx, {
        query: 'declarative device management',
        product: 'jamf-pro',
        docType: 'release-notes',
      });

      expect(result.filterRelaxation).toBeUndefined();
      expect(result.results).toHaveLength(1);
      expect(result.results[0].docType).toBe('release-notes');
    });

    // The other half of carrying both labels: a release note is still
    // technical documentation, so docType='documentation' must not lose it.
    it('keeps release notes under docType=documentation too', async () => {
      mockedPostJson.mockResolvedValueOnce(
        makeFtResponse([makeCluster([makeReleaseNoteEntry('rn-2')])])
      );

      const result = await searchDocumentation(ctx, {
        query: 'managed software updates',
        product: 'jamf-pro',
        docType: 'documentation',
      });

      expect(result.filterRelaxation).toBeUndefined();
      expect(result.results).toHaveLength(1);
    });

    it('still drops a plain documentation topic from a release-notes search', async () => {
      mockedPostJson.mockResolvedValueOnce(
        makeFtResponse([makeCluster([
          makeTopicEntry({
            contentId: 'doc-1',
            metadata: makeMetadata({
              'zoominmetadata': ['product-pro', 'content-techdocs'],
              'ft:prettyUrl': ['/en-US/bundle/jamf-pro-documentation/page/doc-1.html'],
              'jamf:contentType': ['Technical Documentation'],
            }),
          }),
        ])])
      );

      const result = await searchDocumentation(ctx, {
        query: 'configuration profiles',
        product: 'jamf-pro',
        docType: 'release-notes',
      });

      expect(result.filterRelaxation?.removed).toContain('docType');
    });
  });

  it('should return empty results when API returns no clusters', async () => {
    mockedPostJson.mockResolvedValueOnce(makeFtResponse([]));

    const result = await searchDocumentation(ctx, { query: 'nonexistent' });
    expect(result.results).toHaveLength(0);
    expect(result.pagination.totalItems).toBe(0);
  });

  it('should handle API errors gracefully', async () => {
    mockedPostJson.mockRejectedValueOnce(new Error('Network timeout'));

    const result = await searchDocumentation(ctx, { query: 'test' });
    expect(result.results).toHaveLength(0);
  });

  it('should paginate results correctly', async () => {
    const entries = Array.from({ length: 15 }, (_, i) =>
      makeTopicEntry({
        title: `Result ${i + 1}`,
        contentId: `topic-${i}`,
        metadata: makeMetadata({
          'zoominmetadata': ['product-pro'],
          'ft:prettyUrl': [`/en-US/bundle/jamf-pro-documentation/page/page-${i}.html`],
          'version': ['11.5.0'],
        }),
      })
    );
    mockedPostJson.mockResolvedValueOnce(
      makeFtResponse([makeCluster(entries)])
    );

    const result = await searchDocumentation(ctx, {
      query: 'test',
      limit: 5,
      page: 2,
    });

    expect(result.results).toHaveLength(5);
    expect(result.pagination.page).toBe(2);
    expect(result.pagination.totalPages).toBe(3);
    expect(result.pagination.hasNext).toBe(true);
    expect(result.pagination.hasPrev).toBe(true);
  });

  it('should prefer SearchProvider when available', async () => {
    const customResults = [
      {
        title: 'Custom Result',
        url: 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/custom.html',
        snippet: 'This is a custom search result from the provider with enough content to pass validation.',
        product: 'Jamf Pro',
      },
    ];

    const ctxWithProvider = createMockContext({
      searchProvider: {
        search: vi.fn().mockResolvedValue(customResults),
      },
    });

    const result = await searchDocumentation(ctxWithProvider, { query: 'test' });
    expect(result.results).toHaveLength(1);
    expect(result.results[0].title).toBe('Custom Result');
    expect(mockedPostJson).not.toHaveBeenCalled();
  });

  it('should fall through to FT API when SearchProvider returns null', async () => {
    const entry = makeTopicEntry({ title: 'FT Result' });
    mockedPostJson.mockResolvedValueOnce(
      makeFtResponse([makeCluster([entry])])
    );

    const ctxWithNullProvider = createMockContext({
      searchProvider: {
        search: vi.fn().mockResolvedValue(null),
      },
    });

    const result = await searchDocumentation(ctxWithNullProvider, { query: 'test' });
    expect(result.results).toHaveLength(1);
    expect(result.results[0].title).toBe('FT Result');
    expect(mockedPostJson).toHaveBeenCalled();
  });

  it('should include tokenInfo in response', async () => {
    const entry = makeTopicEntry();
    mockedPostJson.mockResolvedValueOnce(
      makeFtResponse([makeCluster([entry])])
    );

    const result = await searchDocumentation(ctx, { query: 'test', maxTokens: 5000 });
    expect(result.tokenInfo).toBeDefined();
    expect(result.tokenInfo.maxTokens).toBe(5000);
    expect(typeof result.tokenInfo.tokenCount).toBe('number');
    expect(typeof result.tokenInfo.truncated).toBe('boolean');
  });

  it('should pass locale as contentLocale to FT API', async () => {
    mockedPostJson.mockResolvedValueOnce(makeFtResponse([]));

    await searchDocumentation(ctx, { query: 'test', language: 'ja-JP' });

    expect(mockedPostJson).toHaveBeenCalledWith(
      `${FT_API_BASE}/api/khub/clustered-search`,
      expect.objectContaining({
        contentLocale: 'ja-JP',
      })
    );
  });

  it('should flatten multiple clusters into results', async () => {
    const entry1 = makeTopicEntry({ title: 'Cluster 1 Result', contentId: 'c1' });
    const entry2 = makeTopicEntry({ title: 'Cluster 2 Result', contentId: 'c2' });
    mockedPostJson.mockResolvedValueOnce(
      makeFtResponse([makeCluster([entry1]), makeCluster([entry2])])
    );

    const result = await searchDocumentation(ctx, { query: 'test' });
    expect(result.results).toHaveLength(2);
    expect(result.results[0].title).toBe('Cluster 1 Result');
    expect(result.results[1].title).toBe('Cluster 2 Result');
  });

  // ==========================================================================
  // Caching behaviour
  // ==========================================================================

  it('should cache FT API results and return cached on second call', async () => {
    const entry = makeTopicEntry({ title: 'Cached Result' });
    mockedPostJson.mockResolvedValueOnce(
      makeFtResponse([makeCluster([entry])])
    );

    // First call — hits the FT API
    const first = await searchDocumentation(ctx, { query: 'cache-test' });
    expect(first.results).toHaveLength(1);
    expect(first.results[0].title).toBe('Cached Result');
    expect(mockedPostJson).toHaveBeenCalledTimes(1);

    // Second call — should come from cache, no additional API call
    const second = await searchDocumentation(ctx, { query: 'cache-test' });
    expect(second.results).toHaveLength(1);
    expect(second.results[0].title).toBe('Cached Result');
    expect(mockedPostJson).toHaveBeenCalledTimes(1); // still 1
  });

  it('should use different cache keys for different queries', async () => {
    const entryA = makeTopicEntry({ title: 'Result A', contentId: 'a' });
    const entryB = makeTopicEntry({ title: 'Result B', contentId: 'b' });
    mockedPostJson
      .mockResolvedValueOnce(makeFtResponse([makeCluster([entryA])]))
      .mockResolvedValueOnce(makeFtResponse([makeCluster([entryB])]));

    const resultA = await searchDocumentation(ctx, { query: 'alpha' });
    const resultB = await searchDocumentation(ctx, { query: 'beta' });

    expect(resultA.results[0].title).toBe('Result A');
    expect(resultB.results[0].title).toBe('Result B');
    expect(mockedPostJson).toHaveBeenCalledTimes(2);
  });

  it('should use different cache keys for different filters', async () => {
    const entryPro = makeTopicEntry({ title: 'Pro Result' });
    const entrySchool = makeTopicEntry({ title: 'School Result' });
    mockedPostJson
      .mockResolvedValueOnce(makeFtResponse([makeCluster([entryPro])]))
      .mockResolvedValueOnce(makeFtResponse([makeCluster([entrySchool])]));

    const prResult = await searchDocumentation(ctx, {
      query: 'filter-test',
      product: 'jamf-pro',
    });
    const scResult = await searchDocumentation(ctx, {
      query: 'filter-test',
      product: 'jamf-school',
    });

    expect(prResult.results[0].title).toBe('Pro Result');
    expect(scResult.results[0].title).toBe('School Result');
    expect(mockedPostJson).toHaveBeenCalledTimes(2);
  });

  it('should NOT cache results from SearchProvider', async () => {
    const customResults = [
      {
        title: 'Provider Result',
        url: 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/custom.html',
        snippet: 'Custom search result from provider.',
        product: 'Jamf Pro',
      },
    ];

    const ctxWithProvider = createMockContext({
      searchProvider: {
        search: vi.fn().mockResolvedValue(customResults),
      },
    });

    await searchDocumentation(ctxWithProvider, { query: 'provider-test' });

    // Cache should not have been written
    expect(ctxWithProvider.cache.set).not.toHaveBeenCalled();
  });

  it('should cache results keyed by locale', async () => {
    const entryEn = makeTopicEntry({ title: 'English Result' });
    const entryJa = makeTopicEntry({ title: 'Japanese Result' });
    mockedPostJson
      .mockResolvedValueOnce(makeFtResponse([makeCluster([entryEn])]))
      .mockResolvedValueOnce(makeFtResponse([makeCluster([entryJa])]));

    await searchDocumentation(ctx, { query: 'locale-test', language: 'en-US' });
    await searchDocumentation(ctx, { query: 'locale-test', language: 'ja-JP' });

    // Both should call FT API since locale differs
    expect(mockedPostJson).toHaveBeenCalledTimes(2);
  });

  it('should share cache across different page requests', async () => {
    const entries = Array.from({ length: 10 }, (_, i) =>
      makeTopicEntry({
        title: `Paged Result ${i + 1}`,
        contentId: `topic-pg-${i}`,
        metadata: makeMetadata({
          'zoominmetadata': ['product-pro'],
          'ft:prettyUrl': [`/en-US/bundle/jamf-pro-documentation/page/pg-${i}.html`],
          'version': ['11.5.0'],
        }),
      })
    );
    mockedPostJson.mockResolvedValueOnce(
      makeFtResponse([makeCluster(entries)])
    );

    // Page 1
    const page1 = await searchDocumentation(ctx, {
      query: 'page-cache-test',
      limit: 5,
      page: 1,
    });
    expect(page1.results).toHaveLength(5);

    // Page 2 — should use cached results, no second API call
    const page2 = await searchDocumentation(ctx, {
      query: 'page-cache-test',
      limit: 5,
      page: 2,
    });
    expect(page2.results).toHaveLength(5);
    expect(mockedPostJson).toHaveBeenCalledTimes(1);
  });

  it('should pass cacheTtl.search as TTL to cache.set', async () => {
    const entry = makeTopicEntry();
    mockedPostJson.mockResolvedValueOnce(
      makeFtResponse([makeCluster([entry])])
    );

    await searchDocumentation(ctx, { query: 'ttl-test' });

    expect(ctx.cache.set).toHaveBeenCalledWith(
      expect.stringContaining('ft-search:'),
      expect.any(Array),
      ctx.config.cacheTtl.search,
    );
  });

  // ==========================================================================
  // paginationNote when requested page exceeds total pages
  // ==========================================================================

  it('should include paginationNote when requested page exceeds total pages', async () => {
    // Return 3 results — with limit=5 that's 1 page total
    const entries = Array.from({ length: 3 }, (_, i) =>
      makeTopicEntry({
        title: `Result ${i + 1}`,
        contentId: `topic-pn-${i}`,
        metadata: makeMetadata({
          'zoominmetadata': ['product-pro'],
          'ft:prettyUrl': [`/en-US/bundle/jamf-pro-documentation/page/pn-${i}.html`],
          'version': ['11.5.0'],
        }),
      })
    );
    mockedPostJson.mockResolvedValueOnce(
      makeFtResponse([makeCluster(entries)])
    );

    const result = await searchDocumentation(ctx, {
      query: 'pagination-note-test',
      limit: 5,
      page: 99,
    });

    // The page should be clamped to the last page (1)
    expect(result.pagination.page).toBe(1);
    expect(result.pagination.totalPages).toBe(1);

    // paginationNote should exist and mention the requested page number
    const { paginationNote: note } = result;
    expect(note).toBeDefined();
    expect(note).toContain('99');
    expect(note).toContain('1'); // total pages
  });

  it('should NOT include paginationNote when requested page is within range', async () => {
    const entries = Array.from({ length: 10 }, (_, i) =>
      makeTopicEntry({
        title: `Result ${i + 1}`,
        contentId: `topic-no-pn-${i}`,
        metadata: makeMetadata({
          'zoominmetadata': ['product-pro'],
          'ft:prettyUrl': [`/en-US/bundle/jamf-pro-documentation/page/no-pn-${i}.html`],
          'version': ['11.5.0'],
        }),
      })
    );
    mockedPostJson.mockResolvedValueOnce(
      makeFtResponse([makeCluster(entries)])
    );

    const result = await searchDocumentation(ctx, {
      query: 'no-pagination-note-test',
      limit: 5,
      page: 2,
    });

    expect(result.pagination.page).toBe(2);
    const { paginationNote: note } = result;
    expect(note).toBeUndefined();
  });

  // ==========================================================================
  // versionNote — a `version` filter the provider path did not enforce
  // ==========================================================================

  function providerCtx(results: SearchResult[]): ServerContext {
    return createMockContext({
      searchProvider: { search: vi.fn().mockResolvedValue(results) },
    });
  }

  const providerResult = (version?: string): SearchResult => ({
    title: 'Configuration Profiles',
    url: 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/Config.html',
    snippet: 'Configuration profiles let you manage settings on managed devices.',
    product: 'Jamf Pro',
    ...(version !== undefined ? { version } : {}),
  });

  it('should include versionNote when a SearchProvider returns other versions than the one requested', async () => {
    // The provider is handed `params` and its results are taken as given —
    // nothing in the service enforces `version` on this path. A result stamped
    // 11.20.0 proves the filter did not hold, and the tool would otherwise echo
    // filters.version back as though it had.
    const result = await searchDocumentation(
      providerCtx([providerResult('11.20.0')]),
      { query: 'profiles', version: '11.5.0' },
    );

    const { versionNote: note } = result;
    expect(note).toBeDefined();
    expect(note).toContain('11.5.0');
  });

  it('should NOT include versionNote when the provider honoured the requested version', async () => {
    const result = await searchDocumentation(
      providerCtx([providerResult('11.5.0')]),
      { query: 'profiles', version: '11.5.0' },
    );

    expect(result.versionNote).toBeUndefined();
  });

  it('should NOT include versionNote for provider results that carry no version at all', async () => {
    // The unversioned products (School, Connect, Protect, …) have no version
    // metadata. Silence there says nothing either way, so it must not be read
    // as a mismatch.
    const result = await searchDocumentation(
      providerCtx([providerResult()]),
      { query: 'profiles', version: '11.5.0' },
    );

    expect(result.versionNote).toBeUndefined();
  });

  it('should NOT include versionNote when version is "current" or omitted', async () => {
    const ctxWithProvider = providerCtx([providerResult('11.20.0')]);

    const currentVersion = await searchDocumentation(ctxWithProvider, {
      query: 'profiles', version: 'current',
    });
    const noVersion = await searchDocumentation(ctxWithProvider, { query: 'profiles' });

    expect(currentVersion.versionNote).toBeUndefined();
    expect(noVersion.versionNote).toBeUndefined();
  });

  it('should NOT include versionNote on the FT path, where the filter goes upstream', async () => {
    // buildSearchFilters sends `version` to Fluid Topics, so the API enforces
    // it; whatever version metadata comes back is authoritative.
    mockedPostJson.mockResolvedValueOnce(
      makeFtResponse([makeCluster([
        makeTopicEntry({
          title: 'Configuration Profiles',
          contentId: 'topic-vn-ft',
          metadata: makeMetadata({
            'zoominmetadata': ['product-pro'],
            'ft:prettyUrl': ['/en-US/bundle/jamf-pro-documentation/page/vn-ft.html'],
            'version': ['11.20.0'],
          }),
        }),
      ])])
    );

    const result = await searchDocumentation(ctx, { query: 'profiles', version: '11.5.0' });

    expect(mockedPostJson).toHaveBeenCalled();
    expect(result.versionNote).toBeUndefined();
  });

  // ==========================================================================
  // Token truncation — actual truncation of results under small maxTokens
  // ==========================================================================

  it('should truncate results when maxTokens budget is exceeded', async () => {
    // Create 20 results with substantial content to exceed a small token budget
    const entries = Array.from({ length: 20 }, (_, i) =>
      makeTopicEntry({
        title: `Detailed Article Number ${i + 1} About Device Management`,
        contentId: `topic-trunc-${i}`,
        htmlExcerpt: `<p>This is a detailed description of article ${i + 1} ` +
          'covering device management, configuration profiles, security policies, ' +
          'network settings, application deployment, inventory management, and ' +
          'compliance reporting for enterprise environments using Jamf Pro.</p>',
        metadata: makeMetadata({
          'zoominmetadata': ['product-pro'],
          'ft:prettyUrl': [
            `/en-US/bundle/jamf-pro-documentation/page/article-${i}.html`,
          ],
          'version': ['11.5.0'],
          'jamf:contentType': ['Technical Documentation'],
        }),
      })
    );
    mockedPostJson.mockResolvedValueOnce(
      makeFtResponse([makeCluster(entries)])
    );

    const result = await searchDocumentation(ctx, {
      query: 'device management',
      maxTokens: 200,
      limit: 20,
    });

    // With only 200 tokens budget, not all 20 results should fit
    expect(result.results.length).toBeLessThan(20);
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.tokenInfo.truncated).toBe(true);
    expect(result.tokenInfo.tokenCount).toBeLessThanOrEqual(200);

    // truncatedContent should describe the omitted items
    expect(result.truncatedContent).toBeDefined();
    expect(result.truncatedContent!.omittedCount).toBeGreaterThan(0);
    expect(result.truncatedContent!.omittedCount).toBe(
      20 - result.results.length
    );
  });
});
