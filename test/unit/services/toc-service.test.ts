/**
 * Unit tests for toc-service — FT-based TOC fetching and transformation
 *
 * Mocks at the HTTP layer (http-client) so the real ft-client functions
 * (URL construction, array normalization for TOC) are exercised.
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

import { httpGetJson } from '../../../src/core/http-client.js';
import {
  transformFtTocToTocEntries,
  fetchTableOfContents,
} from '../../../src/core/services/toc-service.js';
import { DOCS_BASE_URL, FT_API_BASE } from '../../../src/core/constants.js';
import { createMockContext } from '../../helpers/mock-context.js';
import type { FtTocNode, FtMapInfo } from '../../../src/core/types.js';
import type { ServerContext } from '../../../src/core/types/context.js';

const mockedGetJson = vi.mocked(httpGetJson);

// ─── Shared state set per-test for URL-based routing ─────────────
let currentTocResponse: FtTocNode | FtTocNode[];
let currentMapsResponse: FtMapInfo[];

/**
 * Install a URL-based router on mockedGetJson.
 *
 * Routes:
 *   .../api/khub/maps          → currentMapsResponse
 *   .../toc                    → currentTocResponse
 *   .../topics                 → [] (fetchMapTopics, unused by toc-service)
 */
function installUrlRouter(): void {
  mockedGetJson.mockImplementation(async (url: string) => {
    if (url === `${FT_API_BASE}/api/khub/maps`) {
      return currentMapsResponse;
    }
    if (url.endsWith('/toc')) {
      return currentTocResponse;
    }
    if (url.endsWith('/topics')) {
      return [];
    }
    throw new Error(`Unexpected URL in test: ${url}`);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  currentTocResponse = [];
  currentMapsResponse = [];
});

// ============================================================================
// transformFtTocToTocEntries()
// ============================================================================

describe('transformFtTocToTocEntries()', () => {
  it('should transform flat nodes with contentId and tocId', () => {
    const nodes: FtTocNode[] = [
      {
        tocId: 'toc-1',
        contentId: 'content-1',
        title: 'Getting Started',
        prettyUrl: '/en-US/bundle/jamf-pro-documentation/page/Getting_Started.html',
        children: [],
      },
      {
        tocId: 'toc-2',
        contentId: 'content-2',
        title: 'Configuration',
        prettyUrl: '/en-US/bundle/jamf-pro-documentation/page/Configuration.html',
        children: [],
      },
    ];

    const result = transformFtTocToTocEntries(nodes);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      title: 'Getting Started',
      url: `${DOCS_BASE_URL}/en-US/bundle/jamf-pro-documentation/page/Getting_Started.html`,
      contentId: 'content-1',
      tocId: 'toc-1',
    });
    expect(result[1]).toEqual({
      title: 'Configuration',
      url: `${DOCS_BASE_URL}/en-US/bundle/jamf-pro-documentation/page/Configuration.html`,
      contentId: 'content-2',
      tocId: 'toc-2',
    });
  });

  it('should recursively transform nested children', () => {
    const nodes: FtTocNode[] = [
      {
        tocId: 'parent-toc',
        contentId: 'parent-content',
        title: 'Parent Section',
        prettyUrl: '/en-US/bundle/jamf-pro-documentation/page/Parent.html',
        children: [
          {
            tocId: 'child-toc-1',
            contentId: 'child-content-1',
            title: 'Child One',
            prettyUrl: '/en-US/bundle/jamf-pro-documentation/page/Child1.html',
            children: [
              {
                tocId: 'grandchild-toc',
                contentId: 'grandchild-content',
                title: 'Grandchild',
                prettyUrl: '/en-US/bundle/jamf-pro-documentation/page/Grandchild.html',
                children: [],
              },
            ],
          },
          {
            tocId: 'child-toc-2',
            contentId: 'child-content-2',
            title: 'Child Two',
            prettyUrl: '/en-US/bundle/jamf-pro-documentation/page/Child2.html',
            children: [],
          },
        ],
      },
    ];

    const result = transformFtTocToTocEntries(nodes);

    expect(result).toHaveLength(1);

    const parent = result[0]!;
    expect(parent.title).toBe('Parent Section');
    expect(parent.contentId).toBe('parent-content');
    expect(parent.tocId).toBe('parent-toc');
    expect(parent.children).toHaveLength(2);

    const child1 = parent.children![0]!;
    expect(child1.title).toBe('Child One');
    expect(child1.contentId).toBe('child-content-1');
    expect(child1.tocId).toBe('child-toc-1');
    expect(child1.children).toHaveLength(1);

    const grandchild = child1.children![0]!;
    expect(grandchild.title).toBe('Grandchild');
    expect(grandchild.contentId).toBe('grandchild-content');
    expect(grandchild.tocId).toBe('grandchild-toc');
    expect(grandchild.children).toBeUndefined();

    const child2 = parent.children![1]!;
    expect(child2.title).toBe('Child Two');
    expect(child2.children).toBeUndefined();
  });

  it('should handle empty node array', () => {
    const result = transformFtTocToTocEntries([]);
    expect(result).toEqual([]);
  });

  it('should not set children property when node has empty children array', () => {
    const nodes: FtTocNode[] = [
      {
        tocId: 'leaf-toc',
        contentId: 'leaf-content',
        title: 'Leaf Node',
        prettyUrl: '/en-US/bundle/jamf-pro-documentation/page/Leaf.html',
        children: [],
      },
    ];

    const result = transformFtTocToTocEntries(nodes);
    expect(result[0]!.children).toBeUndefined();
  });

  it('should prefix url with DOCS_BASE_URL', () => {
    const nodes: FtTocNode[] = [
      {
        tocId: 't1',
        contentId: 'c1',
        title: 'Test',
        prettyUrl: '/ja-JP/bundle/jamf-pro-documentation/page/Test.html',
        children: [],
      },
    ];

    const result = transformFtTocToTocEntries(nodes);
    expect(result[0]!.url).toBe(
      `${DOCS_BASE_URL}/ja-JP/bundle/jamf-pro-documentation/page/Test.html`,
    );
  });
});

// ============================================================================
// fetchTableOfContents()
// ============================================================================

describe('fetchTableOfContents()', () => {
  let ctx: ServerContext;

  /**
   * Helper to set up maps response for a single product map.
   * The data is served via httpGetJson URL routing when MapsRegistry calls fetchMaps().
   */
  function setupMapsResponse(mapId: string, bundleStem: string, locale = 'en-US'): void {
    currentMapsResponse = [
      {
        id: mapId,
        title: 'Jamf Pro Documentation',
        mapApiEndpoint: `/api/khub/maps/${mapId}`,
        metadata: [
          { key: 'version_bundle_stem', label: 'version_bundle_stem', values: [bundleStem] },
          { key: 'ft:locale', label: 'ft:locale', values: [locale] },
          { key: 'latestVersion', label: 'latestVersion', values: ['yes'] },
          { key: 'version', label: 'version', values: ['11.26.0'] },
          { key: 'bundle', label: 'bundle', values: [`${bundleStem}-current`] },
        ],
      },
    ];
  }

  const SAMPLE_FT_NODES: FtTocNode[] = [
    {
      tocId: 'toc-1',
      contentId: 'content-1',
      title: 'Overview',
      prettyUrl: '/en-US/bundle/jamf-pro-documentation/page/Overview.html',
      children: [
        {
          tocId: 'toc-1-1',
          contentId: 'content-1-1',
          title: 'Requirements',
          prettyUrl: '/en-US/bundle/jamf-pro-documentation/page/Requirements.html',
          children: [],
        },
      ],
    },
    {
      tocId: 'toc-2',
      contentId: 'content-2',
      title: 'Installation',
      prettyUrl: '/en-US/bundle/jamf-pro-documentation/page/Installation.html',
      children: [],
    },
  ];

  beforeEach(() => {
    ctx = createMockContext();
    installUrlRouter();
  });

  it('should delegate to tocProvider when it returns a result', async () => {
    const mockResult = {
      toc: [{ title: 'Provided', url: 'https://example.com' }],
      pagination: {
        page: 1,
        pageSize: 10,
        totalPages: 1,
        totalItems: 1,
        hasNext: false,
        hasPrev: false,
      },
      tokenInfo: { tokenCount: 10, truncated: false, maxTokens: 5000 },
    };

    ctx.tocProvider = {
      getTableOfContents: vi.fn().mockResolvedValue(mockResult),
    };

    const result = await fetchTableOfContents(ctx, 'jamf-pro');

    expect(ctx.tocProvider.getTableOfContents).toHaveBeenCalledWith(
      'jamf-pro',
      'current',
      {},
    );
    expect(result).toBe(mockResult);
    expect(mockedGetJson).not.toHaveBeenCalled();
  });

  it('should fall through when tocProvider returns null', async () => {
    ctx.tocProvider = {
      getTableOfContents: vi.fn().mockResolvedValue(null),
    };

    setupMapsResponse('pro-map-id', 'jamf-pro-documentation');
    currentTocResponse = SAMPLE_FT_NODES;

    const result = await fetchTableOfContents(ctx, 'jamf-pro');

    expect(ctx.tocProvider.getTableOfContents).toHaveBeenCalled();
    // Verify httpGetJson was called with the correct TOC URL
    const tocUrl = `${FT_API_BASE}/api/khub/maps/pro-map-id/toc`;
    expect(mockedGetJson).toHaveBeenCalledWith(tocUrl);
    expect(result.toc.length).toBeGreaterThan(0);
  });

  it('should resolve mapId via MapsRegistry and fetch TOC', async () => {
    setupMapsResponse('test-map-123', 'jamf-pro-documentation');
    currentTocResponse = SAMPLE_FT_NODES;

    const result = await fetchTableOfContents(ctx, 'jamf-pro');

    // Verify the correct TOC URL was constructed and called
    const tocUrl = `${FT_API_BASE}/api/khub/maps/test-map-123/toc`;
    expect(mockedGetJson).toHaveBeenCalledWith(tocUrl);
    expect(result.toc).toHaveLength(2);
    expect(result.toc[0]!.title).toBe('Overview');
    expect(result.toc[0]!.contentId).toBe('content-1');
    expect(result.toc[0]!.tocId).toBe('toc-1');
    expect(result.toc[0]!.children).toHaveLength(1);
    expect(result.toc[1]!.title).toBe('Installation');
  });

  it('should return correct pagination info', async () => {
    setupMapsResponse('map-1', 'jamf-pro-documentation');
    currentTocResponse = SAMPLE_FT_NODES;

    const result = await fetchTableOfContents(ctx, 'jamf-pro');

    expect(result.pagination.page).toBe(1);
    expect(result.pagination.totalItems).toBe(3); // 2 top-level + 1 child
    expect(result.pagination.totalPages).toBe(1);
    expect(result.pagination.hasNext).toBe(false);
    expect(result.pagination.hasPrev).toBe(false);
  });

  it('should return token info', async () => {
    setupMapsResponse('map-1', 'jamf-pro-documentation');
    currentTocResponse = SAMPLE_FT_NODES;

    const result = await fetchTableOfContents(ctx, 'jamf-pro');

    expect(result.tokenInfo.maxTokens).toBe(5000);
    expect(result.tokenInfo.truncated).toBe(false);
    expect(result.tokenInfo.tokenCount).toBeGreaterThan(0);
  });

  it('should throw JamfDocsError when mapId cannot be resolved', async () => {
    // Return empty maps so registry finds nothing
    currentMapsResponse = [];

    await expect(
      fetchTableOfContents(ctx, 'jamf-pro'),
    ).rejects.toThrow('Could not resolve map');
  });

  it('should cache TOC entries and reuse on second call', async () => {
    setupMapsResponse('map-cached', 'jamf-pro-documentation');
    currentTocResponse = SAMPLE_FT_NODES;

    // First call — populates cache
    const result1 = await fetchTableOfContents(ctx, 'jamf-pro');

    // Count how many times the TOC URL was called (should be 1)
    const tocCallCount = mockedGetJson.mock.calls.filter(
      ([url]) => typeof url === 'string' && url.endsWith('/toc'),
    ).length;
    expect(tocCallCount).toBe(1);

    // Second call — should use cache, not call fetchMapToc again
    const result2 = await fetchTableOfContents(ctx, 'jamf-pro');

    const tocCallCountAfter = mockedGetJson.mock.calls.filter(
      ([url]) => typeof url === 'string' && url.endsWith('/toc'),
    ).length;
    expect(tocCallCountAfter).toBe(1);
    expect(result2.toc[0]!.title).toBe(result1.toc[0]!.title);
  });

  it('should respect maxTokens option and truncate when needed', async () => {
    // Build a large set of nodes to exceed a small token limit
    const manyNodes: FtTocNode[] = Array.from({ length: 50 }, (_, i) => ({
      tocId: `toc-${i}`,
      contentId: `content-${i}`,
      title: `Very Long Section Title Number ${i} With Extra Words To Add Tokens`,
      prettyUrl: `/en-US/bundle/jamf-pro-documentation/page/Section_${i}.html`,
      children: [],
    }));

    setupMapsResponse('map-trunc', 'jamf-pro-documentation');
    currentTocResponse = manyNodes;

    const result = await fetchTableOfContents(ctx, 'jamf-pro', 'current', {
      maxTokens: 50,
    });

    expect(result.tokenInfo.truncated).toBe(true);
    expect(result.tokenInfo.tokenCount).toBeLessThanOrEqual(50);
    expect(result.toc.length).toBeLessThan(50);
  });

  it('should pass locale option to registry resolution', async () => {
    // Setup a Japanese locale map via the URL router
    currentMapsResponse = [
      {
        id: 'pro-ja-map',
        title: 'Jamf Pro Documentation (ja)',
        mapApiEndpoint: '/api/khub/maps/pro-ja-map',
        metadata: [
          { key: 'version_bundle_stem', label: 'version_bundle_stem', values: ['jamf-pro-documentation'] },
          { key: 'ft:locale', label: 'ft:locale', values: ['ja-JP'] },
          { key: 'latestVersion', label: 'latestVersion', values: ['yes'] },
          { key: 'version', label: 'version', values: ['11.26.0'] },
          { key: 'bundle', label: 'bundle', values: ['jamf-pro-documentation-current'] },
        ],
      },
    ];

    const jaNodes: FtTocNode[] = [
      {
        tocId: 'ja-toc-1',
        contentId: 'ja-content-1',
        title: '概要',
        prettyUrl: '/ja-JP/bundle/jamf-pro-documentation/page/Overview.html',
        children: [],
      },
    ];
    currentTocResponse = jaNodes;

    const result = await fetchTableOfContents(ctx, 'jamf-pro', 'current', {
      locale: 'ja-JP',
    });

    // Verify the correct TOC URL was constructed with the ja-JP map
    const tocUrl = `${FT_API_BASE}/api/khub/maps/pro-ja-map/toc`;
    expect(mockedGetJson).toHaveBeenCalledWith(tocUrl);
    expect(result.toc[0]!.title).toBe('概要');
  });

  it('should paginate top-level entries', async () => {
    // Create 15 top-level entries (default page size is 10)
    const nodes: FtTocNode[] = Array.from({ length: 15 }, (_, i) => ({
      tocId: `toc-${i}`,
      contentId: `content-${i}`,
      title: `Section ${i}`,
      prettyUrl: `/en-US/bundle/jamf-pro-documentation/page/Section_${i}.html`,
      children: [],
    }));

    setupMapsResponse('map-paginate', 'jamf-pro-documentation');
    currentTocResponse = nodes;

    // Page 1
    const page1 = await fetchTableOfContents(ctx, 'jamf-pro', 'current', { page: 1 });
    expect(page1.toc).toHaveLength(10);
    expect(page1.pagination.page).toBe(1);
    expect(page1.pagination.totalPages).toBe(2);
    expect(page1.pagination.hasNext).toBe(true);
    expect(page1.pagination.hasPrev).toBe(false);

    // Page 2
    const page2 = await fetchTableOfContents(ctx, 'jamf-pro', 'current', { page: 2 });
    expect(page2.toc).toHaveLength(5);
    expect(page2.pagination.page).toBe(2);
    expect(page2.pagination.hasNext).toBe(false);
    expect(page2.pagination.hasPrev).toBe(true);
  });

  it('should include paginationNote when requested page exceeds total pages', async () => {
    // 5 top-level nodes with default pageSize=10 → 1 total page
    const nodes: FtTocNode[] = Array.from({ length: 5 }, (_, i) => ({
      tocId: `toc-pn-${i}`,
      contentId: `content-pn-${i}`,
      title: `Section ${i}`,
      prettyUrl: `/en-US/bundle/jamf-pro-documentation/page/PN_${i}.html`,
      children: [],
    }));

    setupMapsResponse('map-pn', 'jamf-pro-documentation');
    currentTocResponse = nodes;

    const result = await fetchTableOfContents(ctx, 'jamf-pro', 'current', {
      page: 50,
    });

    // Page should be clamped to the last page (1)
    expect(result.pagination.page).toBe(1);
    expect(result.pagination.totalPages).toBe(1);

    // paginationNote should exist and mention the requested page
    const note = (result as Record<string, unknown>).paginationNote as string;
    expect(note).toBeDefined();
    expect(note).toContain('50');
    expect(note).toContain('1'); // total pages
  });

  it('should NOT include paginationNote when requested page is within range', async () => {
    // 15 top-level nodes with default pageSize=10 → 2 total pages
    const nodes: FtTocNode[] = Array.from({ length: 15 }, (_, i) => ({
      tocId: `toc-no-pn-${i}`,
      contentId: `content-no-pn-${i}`,
      title: `Section ${i}`,
      prettyUrl: `/en-US/bundle/jamf-pro-documentation/page/NPN_${i}.html`,
      children: [],
    }));

    setupMapsResponse('map-no-pn', 'jamf-pro-documentation');
    currentTocResponse = nodes;

    const result = await fetchTableOfContents(ctx, 'jamf-pro', 'current', {
      page: 2,
    });

    expect(result.pagination.page).toBe(2);
    const note = (result as Record<string, unknown>).paginationNote;
    expect(note).toBeUndefined();
  });
});
