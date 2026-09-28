/**
 * Unit tests for ft-client — Fluid Topics API HTTP client
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../src/core/http-client.js', async () => {
  const actual = await import('../../../src/core/http-client.js');
  return {
    // Spread first: the module also exports createHttpClient, which
    // MapsRegistry and TopicResolver fall back to when none is injected.
    ...actual,
    httpGetText: vi.fn(),
    httpGetJson: vi.fn(),
    httpPostJson: vi.fn(),
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
  isTopicRequestUrl,
} from '../../../src/core/services/ft-client.js';
import { FT_API_BASE } from '../../../src/core/constants.js';
import { createTestHttpClient } from '../../helpers/mock-context.js';

const http = createTestHttpClient();

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

    const result = await search(http, request);

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

    await search(http, request);

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

    const result = await fetchMaps(http);

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

    const result = await fetchMapToc(http, 'map1');

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

    const result = await fetchMapToc(http, 'map1');

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

    const result = await fetchMapTopics(http, 'map1');

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

    const result = await fetchTopicContent(http, 'map1', 'content1');

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

    const result = await fetchTopicMetadata(http, 'map1', 'content1');

    expect(mockedGetJson).toHaveBeenCalledWith(
      `${FT_API_BASE}/api/khub/maps/map1/topics/content1`
    );
    expect(result.title).toBe('MDM');
  });
});

// ============================================================================
// isTopicRequestUrl()
// ============================================================================

describe('isTopicRequestUrl()', () => {
  // get_article's "moved or deleted" advice follows a 404 only at one of
  // these: see isArticleNotFound in get-article.ts.
  const MAPS = `${FT_API_BASE}/api/khub/maps`;

  it('is true of the three requests an article is read by, as the fetchers build them', async () => {
    mockedGetJson.mockResolvedValue([]);
    mockedGetText.mockResolvedValue('');

    // Ids as live ones look: `~` and `_` are left as they are by the encoding.
    await fetchMapTopics(http, 'ZlB_0jgM2084m7JxZgV1KQ');
    await fetchTopicMetadata(http, 'JEc~s7Yc6BZM_8sDZDLNrg', 'EN07tYt99KYjHfrWJ8QdfA');
    await fetchTopicContent(http, 'JEc~s7Yc6BZM_8sDZDLNrg', 'EN07tYt99KYjHfrWJ8QdfA');
    const built = [...mockedGetJson.mock.calls, ...mockedGetText.mock.calls].map(([url]) => url);

    expect(built).toEqual([
      `${MAPS}/ZlB_0jgM2084m7JxZgV1KQ/topics`,
      `${MAPS}/JEc~s7Yc6BZM_8sDZDLNrg/topics/EN07tYt99KYjHfrWJ8QdfA`,
      `${MAPS}/JEc~s7Yc6BZM_8sDZDLNrg/topics/EN07tYt99KYjHfrWJ8QdfA/content`,
    ]);
    for (const url of built) {
      expect(isTopicRequestUrl(url), url).toBe(true);
    }
  });

  it('is true of an id that had to be encoded: it holds no `/`', () => {
    expect(isTopicRequestUrl(`${MAPS}/a%2Fb/topics/c%2Fd/content`)).toBe(true);
  });

  it.each([
    ['the maps list', MAPS],
    ['a map', `${MAPS}/map1`],
    ['a map\'s table of contents', `${MAPS}/map1/toc`],
    ['the search', `${FT_API_BASE}/api/khub/clustered-search`],
    ['a topic\'s content under another name', `${MAPS}/map1/topics/content1/html`],
  ])('is false of another learn.jamf.com request: %s', (_label, url) => {
    expect(isTopicRequestUrl(url)).toBe(false);
  });

  it.each([
    ['a trailing segment', `${MAPS}/map1/topics/content1/content/extra`],
    ['a segment after the index', `${MAPS}/map1/topics/content1/extra`],
    ['a trailing slash', `${MAPS}/map1/topics/`],
    ['a prefix before /api', `${FT_API_BASE}/proxy/api/khub/maps/map1/topics/content1`],
    ['no map id', `${FT_API_BASE}/api/khub/maps//topics/content1`],
  ])('is false of a path that only contains one: %s', (_label, url) => {
    expect(isTopicRequestUrl(url)).toBe(false);
  });

  it.each([
    ['another host', 'https://r2.example.test/api/khub/maps/map1/topics/content1'],
    ['a learn.jamf.com subdomain', 'https://cdn.learn.jamf.com/api/khub/maps/map1/topics/content1'],
    ['http://', `${FT_API_BASE.replace(/^https:/, 'http:')}/api/khub/maps/map1/topics/content1`],
    ['another port', `${FT_API_BASE}:8443/api/khub/maps/map1/topics/content1`],
  ])('is false of the same path on %s', (_label, url) => {
    expect(isTopicRequestUrl(url)).toBe(false);
  });

  it.each([
    ['an empty string', ''],
    ['a path alone', '/api/khub/maps/map1/topics/content1'],
    ['words', 'HTTP 404: /api/khub/maps/map1/topics/content1'],
  ])('is false of what is not a URL: %s', (_label, url) => {
    expect(isTopicRequestUrl(url)).toBe(false);
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
      search(http, { query: 'MDM', contentLocale: 'en-US', paging: { perPage: 10, page: 1 } })
    ).rejects.toThrow('Network timeout');
  });

  it('should propagate network error from fetchMaps()', async () => {
    const networkError = new Error('Connection refused');
    mockedGetJson.mockRejectedValue(networkError);

    await expect(fetchMaps(http)).rejects.toThrow('Connection refused');
  });

  it('should propagate network error from fetchMapToc()', async () => {
    const networkError = new Error('DNS lookup failed');
    mockedGetJson.mockRejectedValue(networkError);

    await expect(fetchMapToc(http, 'map1')).rejects.toThrow('DNS lookup failed');
  });

  it('should propagate network error from fetchTopicContent()', async () => {
    const networkError = new Error('HTTP 429 Too Many Requests');
    mockedGetText.mockRejectedValue(networkError);

    await expect(fetchTopicContent(http, 'map1', 'content1')).rejects.toThrow('HTTP 429 Too Many Requests');
  });

  it('should propagate network error from fetchMapTopics()', async () => {
    const networkError = new Error('HTTP 404 Not Found');
    mockedGetJson.mockRejectedValue(networkError);

    await expect(fetchMapTopics(http, 'map1')).rejects.toThrow('HTTP 404 Not Found');
  });

  it('should not swallow errors — search() rejection reaches caller', async () => {
    mockedPostJson.mockRejectedValue(new Error('fail'));

    let caught = false;
    try {
      await search(http, { query: 'x' });
    } catch {
      caught = true;
    }
    expect(caught).toBe(true);
  });

  it('should not swallow errors — fetchMaps() rejection reaches caller', async () => {
    mockedGetJson.mockRejectedValue(new Error('fail'));

    let caught = false;
    try {
      await fetchMaps(http);
    } catch {
      caught = true;
    }
    expect(caught).toBe(true);
  });

  it('should not swallow errors — fetchMapToc() rejection reaches caller', async () => {
    mockedGetJson.mockRejectedValue(new Error('fail'));

    let caught = false;
    try {
      await fetchMapToc(http, 'map1');
    } catch {
      caught = true;
    }
    expect(caught).toBe(true);
  });

  it('should not swallow errors — fetchTopicContent() rejection reaches caller', async () => {
    mockedGetText.mockRejectedValue(new Error('fail'));

    let caught = false;
    try {
      await fetchTopicContent(http, 'map1', 'content1');
    } catch {
      caught = true;
    }
    expect(caught).toBe(true);
  });
});
