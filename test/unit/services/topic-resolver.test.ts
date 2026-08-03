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

const VERSIONED_MAP_ID = 'pro-map-11.15.0';

const MOCK_MAPS = [
  {
    id: 'pro-map', title: 'Jamf Pro', mapApiEndpoint: '/api/khub/maps/pro-map',
    metadata: makeMeta({
      'version_bundle_stem': ['jamf-pro-documentation'],
      'version': ['11.26.0'], 'ft:locale': ['en-US'], 'latestVersion': ['yes'],
      'bundle': ['jamf-pro-documentation-current', 'jamf-pro-documentation-11.26.0'],
    }),
  },
  // Jamf keeps an older release as its own map, with its own content — this is
  // what makes a versioned URL meaningful rather than an alias for current.
  {
    id: VERSIONED_MAP_ID, title: 'Jamf Pro 11.15.0',
    mapApiEndpoint: `/api/khub/maps/${VERSIONED_MAP_ID}`,
    metadata: makeMeta({
      'version_bundle_stem': ['jamf-pro-documentation'],
      'version': ['11.15.0'], 'ft:locale': ['en-US'],
      'bundle': ['jamf-pro-documentation-11.15.0'],
    }),
  },
  // Release notes, shaped the way the live API actually returns them: EVERY map
  // in the family carries `{stem}-current` in its `bundle` values, and the one
  // flagged `latestVersion=yes` is not the first in the array. Anything that
  // resolves a `-current` slug by scanning raw bundle values answers with
  // 11.30.2 here (measured against the live API on 2026-08-03), which is a
  // different map with different topics.
  {
    id: 'rn-map-11.30.2', title: 'Jamf Pro Release Notes 11.30.2',
    mapApiEndpoint: '/api/khub/maps/rn-map-11.30.2',
    metadata: makeMeta({
      'version_bundle_stem': ['jamf-pro-release-notes'],
      'version': ['11.30.2'], 'ft:locale': ['en-US'], 'latestVersion': ['no'],
      'bundle': ['jamf-pro-release-notes-11.30.2', 'jamf-pro-release-notes-current'],
    }),
  },
  {
    id: 'rn-map-11.30.0', title: 'Jamf Pro Release Notes 11.30.0',
    mapApiEndpoint: '/api/khub/maps/rn-map-11.30.0',
    metadata: makeMeta({
      'version_bundle_stem': ['jamf-pro-release-notes'],
      'version': ['11.30.0'], 'ft:locale': ['en-US'], 'latestVersion': ['yes'],
      'bundle': ['jamf-pro-release-notes-current', 'jamf-pro-release-notes-11.30.0'],
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

  it('should resolve a -current slug to the latest map', async () => {
    const result = await resolver.resolve({
      url: 'https://learn.jamf.com/r/en-US/jamf-pro-documentation-current/MDM_Profile_Settings',
    });
    expect(result.mapId).toBe('pro-map');
    expect(result.contentId).toBe('content-mdm');
  });

  it('should resolve a -current slug by latestVersion, not by bundle-value order', async () => {
    // `{stem}-current` appears in the bundle values of every map in a family,
    // so picking the first map that lists it lands on an arbitrary version —
    // in production that turned a live search hit into
    // "Topic not found: System_Requirements in jamf-pro-release-notes-current".
    const result = await resolver.resolve({
      url: 'https://learn.jamf.com/r/en-US/jamf-pro-release-notes-current/MDM_Profile_Settings',
    });
    expect(result.mapId).toBe('rn-map-11.30.0');
  });
});

describe('resolve — versioned prettyUrl', () => {
  // The versioned map has its own topics: resolving to the wrong map would
  // return `content-mdm`, so contentId doubles as a check on which map was hit.
  const MOCK_TOPICS_11_15 = [
    {
      title: 'MDM Profile Settings', id: 'content-mdm-11.15.0',
      contentApiEndpoint: '/api/...', metadata: makeMeta({
        'legacy_topicname': ['MDM_Profile_Settings'],
      }),
    },
  ];

  beforeEach(() => {
    mockedFetchMapTopics.mockImplementation(async (mapId: string) =>
      await Promise.resolve(mapId === VERSIONED_MAP_ID ? MOCK_TOPICS_11_15 : MOCK_TOPICS)
    );
  });

  it('should resolve both URL shapes of one page to the same map + content', async () => {
    // `get_toc(product="jamf-pro", version="11.15.0")` hands back pretty URLs
    // built from FT's own `node.prettyUrl`; feeding one straight into
    // `get_article` used to fail with "Cannot resolve product:
    // jamf-pro-documentation-11.15.0" while the legacy spelling of the very
    // same page resolved. The asymmetry between the two resolvers is the bug.
    const legacy = await resolver.resolve({
      url: 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation-11.15.0/page/MDM_Profile_Settings.html',
    });
    const pretty = await resolver.resolve({
      url: 'https://learn.jamf.com/r/en-US/jamf-pro-documentation-11.15.0/MDM_Profile_Settings',
    });

    expect(pretty).toEqual(legacy);
    expect(pretty.mapId).toBe(VERSIONED_MAP_ID);
    expect(pretty.contentId).toBe('content-mdm-11.15.0');
  });

  it('should not silently serve the current map for a versioned slug', async () => {
    const result = await resolver.resolve({
      url: 'https://learn.jamf.com/r/en-US/jamf-pro-documentation-11.15.0/MDM_Profile_Settings',
    });

    expect(result.mapId).not.toBe('pro-map');
    expect(result.contentId).not.toBe('content-mdm');
  });

  it('should throw NOT_FOUND — not fall back to current — for a version with no map', async () => {
    // Rewriting an unknown version to `-current` would answer an 11.15.0-shaped
    // request with 11.26.0 content, which is worse than the error.
    await expect(
      resolver.resolve({
        url: 'https://learn.jamf.com/r/en-US/jamf-pro-documentation-9.99.0/MDM_Profile_Settings',
      })
    ).rejects.toMatchObject({ code: JamfDocsErrorCode.NOT_FOUND });
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

  it('should clear the in-flight entry after a failed fetch so the next call retries', async () => {
    mockedFetchMapTopics.mockRejectedValueOnce(new Error('HTTP 503'));

    const url = 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation-current/page/MDM_Profile_Settings.html';
    await expect(resolver.resolve({ url })).rejects.toThrow();

    // A stale in-flight entry would make this return the same rejected promise
    // forever, so a transient outage would look permanent.
    mockedFetchMapTopics.mockResolvedValueOnce(MOCK_TOPICS);
    const retried = await resolver.resolve({ url });

    expect(retried.contentId).toBe('content-mdm');
    expect(mockedFetchMapTopics).toHaveBeenCalledTimes(2);
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
