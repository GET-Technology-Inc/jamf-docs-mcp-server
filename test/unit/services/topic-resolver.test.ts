/**
 * Unit tests for TopicResolver
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../src/core/services/ft-client.js', () => ({
  fetchMaps: vi.fn(),
  fetchMapTopics: vi.fn(),
}));

import { fetchMaps, fetchMapTopics } from '../../../src/core/services/ft-client.js';
import { MapsRegistry } from '../../../src/core/services/maps-registry.js';
import { TopicResolver, buildDisplayUrl } from '../../../src/core/services/topic-resolver.js';
import { JamfDocsErrorCode } from '../../../src/core/types.js';
import { createMockCache } from '../../helpers/mock-context.js';

const mockedFetchMaps = vi.mocked(fetchMaps);
const mockedFetchMapTopics = vi.mocked(fetchMapTopics);

function makeMeta(entries: Record<string, string[]>): { key: string; label: string; values: string[] }[] {
  return Object.entries(entries).map(([key, values]) => ({ key, label: key, values }));
}

const MOCK_MAPS = [
  {
    id: 'pro-map', title: 'Jamf Pro', mapApiEndpoint: '/api/khub/maps/pro-map',
    metadata: makeMeta({
      'version_bundle_stem': ['jamf-pro-documentation'],
      'version': ['11.26.0'], 'ft:locale': ['en-US'], 'latestVersion': ['yes'],
      'bundle': ['jamf-pro-documentation-current', 'jamf-pro-documentation-11.26.0'],
    }),
  },
];

const MOCK_TOPICS = [
  {
    title: 'MDM Profile Settings', id: 'content-mdm',
    contentApiEndpoint: '/api/...', metadata: makeMeta({
      'legacy_topicname': ['MDM_Profile_Settings'],
    }),
  },
  {
    title: 'Smart Groups', id: 'content-sg',
    contentApiEndpoint: '/api/...', metadata: makeMeta({
      'legacy_topicname': ['Smart_Groups'],
    }),
  },
];

let resolver: TopicResolver;

beforeEach(() => {
  vi.clearAllMocks();
  mockedFetchMaps.mockResolvedValue(MOCK_MAPS);
  mockedFetchMapTopics.mockResolvedValue(MOCK_TOPICS);

  const cache = createMockCache();
  const registry = new MapsRegistry(cache);
  resolver = new TopicResolver(registry, cache);
});

describe('resolve — direct IDs', () => {
  it('should passthrough mapId + contentId directly', async () => {
    const result = await resolver.resolve({ mapId: 'abc', contentId: 'def' });
    expect(result.mapId).toBe('abc');
    expect(result.contentId).toBe('def');
    // Should NOT call fetchMapTopics
    expect(mockedFetchMapTopics).not.toHaveBeenCalled();
  });

  it('should prefer IDs over url when both provided', async () => {
    const result = await resolver.resolve({
      url: 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation-current/page/MDM_Profile_Settings.html',
      mapId: 'direct-map',
      contentId: 'direct-content',
    });
    expect(result.mapId).toBe('direct-map');
    expect(result.contentId).toBe('direct-content');
  });
});

describe('resolve — legacy bundle URL', () => {
  it('should resolve /bundle/{bundleId}/page/{page}.html', async () => {
    const result = await resolver.resolve({
      url: 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation-current/page/MDM_Profile_Settings.html',
    });
    expect(result.mapId).toBe('pro-map');
    expect(result.contentId).toBe('content-mdm');
    expect(result.locale).toBe('en-US');
  });

  it('should resolve without .html extension', async () => {
    const result = await resolver.resolve({
      url: 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation-current/page/Smart_Groups',
    });
    expect(result.contentId).toBe('content-sg');
  });
});

describe('resolve — prettyUrl', () => {
  it('should resolve /r/{locale}/{product}/{page}', async () => {
    const result = await resolver.resolve({
      url: 'https://learn.jamf.com/r/en-US/jamf-pro-documentation/MDM_Profile_Settings',
    });
    expect(result.mapId).toBe('pro-map');
    expect(result.contentId).toBe('content-mdm');
  });
});

describe('resolve — errors', () => {
  it('should throw INVALID_URL for unrecognized format', async () => {
    await expect(
      resolver.resolve({ url: 'https://example.com/random/path' })
    ).rejects.toMatchObject({ code: JamfDocsErrorCode.INVALID_URL });
  });

  it('should throw INVALID_URL when no url and no IDs', async () => {
    await expect(
      resolver.resolve({})
    ).rejects.toMatchObject({ code: JamfDocsErrorCode.INVALID_URL });
  });

  it('should throw NOT_FOUND for unknown topic slug', async () => {
    await expect(
      resolver.resolve({
        url: 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation-current/page/Nonexistent_Page.html',
      })
    ).rejects.toMatchObject({ code: JamfDocsErrorCode.NOT_FOUND });
  });
});

describe('resolve — NOT_FOUND when bundleId cannot be resolved', () => {
  it('should throw NOT_FOUND when registry returns null for bundleId', async () => {
    // Use a bundleId that doesn't match any map in MOCK_MAPS
    await expect(
      resolver.resolve({
        url: 'https://learn.jamf.com/en-US/bundle/unknown-product-documentation-current/page/Some_Page.html',
      })
    ).rejects.toMatchObject({ code: JamfDocsErrorCode.NOT_FOUND });
    // fetchMapTopics should NOT be called because the registry returns null first
    expect(mockedFetchMapTopics).not.toHaveBeenCalled();
  });
});

describe('resolve — cache hit on topic index', () => {
  it('should use cached topic index and not call fetchMapTopics again', async () => {
    // First call — populates cache
    const first = await resolver.resolve({
      url: 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation-current/page/MDM_Profile_Settings.html',
    });
    expect(first.contentId).toBe('content-mdm');
    expect(mockedFetchMapTopics).toHaveBeenCalledTimes(1);

    // Second call — same mapId, should hit the in-memory cache via CacheProvider
    const second = await resolver.resolve({
      url: 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation-current/page/Smart_Groups.html',
    });
    expect(second.contentId).toBe('content-sg');

    // fetchMapTopics should still be called only ONCE total
    expect(mockedFetchMapTopics).toHaveBeenCalledTimes(1);
  });
});

describe('resolve — in-flight deduplication', () => {
  it('should call fetchMapTopics only once for concurrent resolves of the same mapId', async () => {
    // Track whether the first fetchMapTopics promise has settled
    let resolveTopics!: (topics: typeof MOCK_TOPICS) => void;
    const pendingTopics = new Promise<typeof MOCK_TOPICS>(res => { resolveTopics = res; });
    mockedFetchMapTopics.mockReturnValueOnce(pendingTopics);

    // Fire two concurrent resolve calls that both need the same topic index
    const p1 = resolver.resolve({
      url: 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation-current/page/MDM_Profile_Settings.html',
    });
    const p2 = resolver.resolve({
      url: 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation-current/page/Smart_Groups.html',
    });

    // Allow micro-task queue to flush so both calls register the in-flight promise
    await Promise.resolve();

    // Unblock the one pending fetchMapTopics call
    resolveTopics(MOCK_TOPICS);

    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1.contentId).toBe('content-mdm');
    expect(r2.contentId).toBe('content-sg');

    // fetchMapTopics must have been invoked exactly once despite two concurrent callers
    expect(mockedFetchMapTopics).toHaveBeenCalledTimes(1);
  });
});

describe('buildDisplayUrl', () => {
  it('should prepend DOCS_BASE_URL to prettyUrl path', () => {
    expect(buildDisplayUrl('/r/en-US/doc/page')).toBe('https://learn.jamf.com/r/en-US/doc/page');
  });

  it('should pass through full URLs', () => {
    expect(buildDisplayUrl('https://learn.jamf.com/r/en-US/doc/page'))
      .toBe('https://learn.jamf.com/r/en-US/doc/page');
  });
});
