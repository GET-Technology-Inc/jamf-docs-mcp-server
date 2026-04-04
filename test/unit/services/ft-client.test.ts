/**
 * Unit tests for ft-client — Fluid Topics API HTTP client
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../src/core/http-client.js', async () => {
  return {
    httpGetText: vi.fn(),
    httpGetJson: vi.fn(),
    httpPostJson: vi.fn(),
    HttpError: (await import('../../../src/core/http-client.js')).HttpError,
  };
});

import { httpGetText, httpGetJson, httpPostJson } from '../../../src/core/http-client.js';
import {
  search,
  fetchMaps,
  fetchMapToc,
  fetchMapTopics,
  fetchTopicContent,
  fetchTopicMetadata,
} from '../../../src/core/services/ft-client.js';
import { FT_API_BASE } from '../../../src/core/constants.js';

const mockedGetJson = vi.mocked(httpGetJson);
const mockedGetText = vi.mocked(httpGetText);
const mockedPostJson = vi.mocked(httpPostJson);

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================================
// search()
// ============================================================================

describe('search()', () => {
  const mockResponse = {
    facets: [],
    results: [{
      metadataVariableAxis: 'publisher',
      entries: [{
        type: 'TOPIC' as const,
        missingTerms: [],
        topic: {
          mapId: 'map1',
          contentId: 'content1',
          tocId: 'toc1',
          title: 'MDM Profile',
          htmlTitle: '<span>MDM</span> Profile',
          mapTitle: 'Jamf Pro 11.26.0',
          breadcrumb: ['Settings', 'MDM Profile'],
          htmlExcerpt: '<span>MDM</span> excerpt',
          metadata: [],
        },
      }],
    }],
    announcements: [],
    paging: {
      currentPage: 1,
      isLastPage: true,
      totalResultsCount: 1,
      totalClustersCount: 1,
    },
  };

  it('should POST to clustered-search with correct URL and body', async () => {
    mockedPostJson.mockResolvedValue(mockResponse);

    const request = {
      query: 'MDM',
      contentLocale: 'en-US',
      paging: { perPage: 10, page: 1 },
    };

    const result = await search(request);

    expect(mockedPostJson).toHaveBeenCalledWith(
      `${FT_API_BASE}/api/khub/clustered-search`,
      request
    );
    expect(result.results).toHaveLength(1);
    expect(result.paging.totalResultsCount).toBe(1);
  });

  it('should pass filters and sortId to request body', async () => {
    mockedPostJson.mockResolvedValue(mockResponse);

    const request = {
      query: 'test',
      filters: [{ key: 'zoominmetadata', values: ['product-pro'] }],
      sortId: 'last_update',
    };

    await search(request);

    expect(mockedPostJson).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        filters: [{ key: 'zoominmetadata', values: ['product-pro'] }],
        sortId: 'last_update',
      })
    );
  });
});

// ============================================================================
// fetchMaps()
// ============================================================================

describe('fetchMaps()', () => {
  it('should GET /api/khub/maps', async () => {
    const mockMaps = [
      { title: 'Jamf Pro', id: 'map1', mapApiEndpoint: '/api/khub/maps/map1', metadata: [] },
      { title: 'Glossary', id: 'map2', mapApiEndpoint: '/api/khub/maps/map2', metadata: [] },
    ];
    mockedGetJson.mockResolvedValue(mockMaps);

    const result = await fetchMaps();

    expect(mockedGetJson).toHaveBeenCalledWith(`${FT_API_BASE}/api/khub/maps`);
    expect(result).toHaveLength(2);
    expect(result[0].title).toBe('Jamf Pro');
  });
});

// ============================================================================
// fetchMapToc()
// ============================================================================

describe('fetchMapToc()', () => {
  it('should GET /api/khub/maps/{mapId}/toc and normalize to array', async () => {
    const mockToc = {
      tocId: 'root',
      contentId: 'rootContent',
      title: 'Root',
      prettyUrl: '/r/en-US/doc/root',
      children: [
        { tocId: 't1', contentId: 'c1', title: 'Child', prettyUrl: '/r/en-US/doc/child', children: [] },
      ],
    };
    mockedGetJson.mockResolvedValue(mockToc);

    const result = await fetchMapToc('map1');

    expect(mockedGetJson).toHaveBeenCalledWith(`${FT_API_BASE}/api/khub/maps/map1/toc`);
    expect(result).toHaveLength(1);
    expect(result[0].children).toHaveLength(1);
  });

  it('should handle array response', async () => {
    const mockToc = [
      { tocId: 'r1', contentId: 'c1', title: 'Root1', prettyUrl: '/a', children: [] },
      { tocId: 'r2', contentId: 'c2', title: 'Root2', prettyUrl: '/b', children: [] },
    ];
    mockedGetJson.mockResolvedValue(mockToc);

    const result = await fetchMapToc('map1');

    expect(result).toHaveLength(2);
  });
});

// ============================================================================
// fetchMapTopics()
// ============================================================================

describe('fetchMapTopics()', () => {
  it('should GET /api/khub/maps/{mapId}/topics', async () => {
    const mockTopics = [
      { title: 'Topic A', id: 'ta', contentApiEndpoint: '/api/...', metadata: [] },
    ];
    mockedGetJson.mockResolvedValue(mockTopics);

    const result = await fetchMapTopics('map1');

    expect(mockedGetJson).toHaveBeenCalledWith(`${FT_API_BASE}/api/khub/maps/map1/topics`);
    expect(result).toHaveLength(1);
  });
});

// ============================================================================
// fetchTopicContent()
// ============================================================================

describe('fetchTopicContent()', () => {
  it('should GET topic content as HTML text', async () => {
    mockedGetText.mockResolvedValue('<div class="glossdef"><p>Definition</p></div>');

    const result = await fetchTopicContent('map1', 'content1');

    expect(mockedGetText).toHaveBeenCalledWith(
      `${FT_API_BASE}/api/khub/maps/map1/topics/content1/content`
    );
    expect(result).toContain('Definition');
  });
});

// ============================================================================
// fetchTopicMetadata()
// ============================================================================

describe('fetchTopicMetadata()', () => {
  it('should GET topic metadata', async () => {
    const mockMeta = {
      title: 'MDM',
      id: 'content1',
      contentApiEndpoint: '/api/...',
      metadata: [{ key: 'ft:prettyUrl', label: 'prettyUrl', values: ['/r/en-US/doc/MDM'] }],
    };
    mockedGetJson.mockResolvedValue(mockMeta);

    const result = await fetchTopicMetadata('map1', 'content1');

    expect(mockedGetJson).toHaveBeenCalledWith(
      `${FT_API_BASE}/api/khub/maps/map1/topics/content1`
    );
    expect(result.title).toBe('MDM');
  });
});

// ============================================================================
// Network error propagation
// ============================================================================

describe('network error propagation', () => {
  it('should propagate network error from search()', async () => {
    const networkError = new Error('Network timeout');
    mockedPostJson.mockRejectedValue(networkError);

    await expect(
      search({ query: 'MDM', contentLocale: 'en-US', paging: { perPage: 10, page: 1 } })
    ).rejects.toThrow('Network timeout');
  });

  it('should propagate network error from fetchMaps()', async () => {
    const networkError = new Error('Connection refused');
    mockedGetJson.mockRejectedValue(networkError);

    await expect(fetchMaps()).rejects.toThrow('Connection refused');
  });

  it('should propagate network error from fetchMapToc()', async () => {
    const networkError = new Error('DNS lookup failed');
    mockedGetJson.mockRejectedValue(networkError);

    await expect(fetchMapToc('map1')).rejects.toThrow('DNS lookup failed');
  });

  it('should propagate network error from fetchTopicContent()', async () => {
    const networkError = new Error('HTTP 429 Too Many Requests');
    mockedGetText.mockRejectedValue(networkError);

    await expect(fetchTopicContent('map1', 'content1')).rejects.toThrow('HTTP 429 Too Many Requests');
  });

  it('should propagate network error from fetchMapTopics()', async () => {
    const networkError = new Error('HTTP 404 Not Found');
    mockedGetJson.mockRejectedValue(networkError);

    await expect(fetchMapTopics('map1')).rejects.toThrow('HTTP 404 Not Found');
  });

  it('should not swallow errors — search() rejection reaches caller', async () => {
    mockedPostJson.mockRejectedValue(new Error('fail'));

    let caught = false;
    try {
      await search({ query: 'x' });
    } catch {
      caught = true;
    }
    expect(caught).toBe(true);
  });

  it('should not swallow errors — fetchMaps() rejection reaches caller', async () => {
    mockedGetJson.mockRejectedValue(new Error('fail'));

    let caught = false;
    try {
      await fetchMaps();
    } catch {
      caught = true;
    }
    expect(caught).toBe(true);
  });

  it('should not swallow errors — fetchMapToc() rejection reaches caller', async () => {
    mockedGetJson.mockRejectedValue(new Error('fail'));

    let caught = false;
    try {
      await fetchMapToc('map1');
    } catch {
      caught = true;
    }
    expect(caught).toBe(true);
  });

  it('should not swallow errors — fetchTopicContent() rejection reaches caller', async () => {
    mockedGetText.mockRejectedValue(new Error('fail'));

    let caught = false;
    try {
      await fetchTopicContent('map1', 'content1');
    } catch {
      caught = true;
    }
    expect(caught).toBe(true);
  });
});
