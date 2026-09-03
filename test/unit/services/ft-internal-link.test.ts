/**
 * Unit tests for ft-internal-link — TOC-node-id resolution for FT's hrefless
 * internal links.
 *
 * Mocks at the HTTP layer so ft-client runs its real code path.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

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
  buildInternalLinkResolver,
  collectInternalLinkMapIds,
  fetchTopicAncestors,
  fetchTopicNavigation,
} from '../../../src/core/services/ft-internal-link.js';
import { createMockCache, createMockLogger } from '../../helpers/mock-context.js';
import type { FtTocNode } from '../../../src/core/types.js';

const mockedGetJson = vi.mocked(httpGetJson);

const MAP_ID = 'FtEgPHSd28ZhPyLlTkrYTA';
const OTHER_MAP_ID = 'Dpq4WYQPn8VQvKQZL~AxAA';

/** Shape taken from GET /api/khub/maps/{mapId}/toc on learn.jamf.com. */
const TOC: FtTocNode[] = [
  {
    tocId: 'HO1HzS5wEsYXh1_rA_mdQw',
    contentId: 'C149PhXe7uzceHuULOnLfA',
    title: 'Computers',
    prettyUrl: '/r/en-US/jamf-pro-documentation-current/Computers',
    children: [
      {
        tocId: '8Tflt44ylUo_Jo99tcQj5w',
        contentId: 'vccKyPVSh7VrXvknBiPQgQ',
        title: 'Computer Reports',
        prettyUrl: '/r/en-US/jamf-pro-documentation-current/Computer_Reports',
      },
    ],
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetJson.mockImplementation(async (url: string) => {
    await Promise.resolve();
    if (url.endsWith(`/maps/${encodeURIComponent(MAP_ID)}/toc`)) {
      return TOC;
    }
    throw new Error(`Unexpected GET JSON: ${url}`);
  });
});

describe('collectInternalLinkMapIds()', () => {
  it('should collect the map of every ft-internal-link span', () => {
    const html =
      `<span class="xref ft-internal-link" data-mapid="${MAP_ID}" data-tocid="a">A</span>` +
      `<span class="link ft-internal-link" data-mapid="${MAP_ID}" data-tocid="b">B</span>` +
      `<span class="link ft-internal-link" data-mapid="${OTHER_MAP_ID}" data-tocid="c">C</span>`;

    expect(collectInternalLinkMapIds(html)).toEqual([MAP_ID, OTHER_MAP_ID]);
  });

  it('should return nothing for HTML without internal links', () => {
    expect(collectInternalLinkMapIds('<p><a href="https://example.com">x</a></p>')).toEqual([]);
  });

  it('should ignore data-mapid that does not belong to an internal link', () => {
    // A tag carrying only one half of the pair cannot address anything, and a
    // stray data-mapid elsewhere must not drag a whole TOC over the wire.
    const html =
      `<div data-mapid="${OTHER_MAP_ID}">wrapper</div>` +
      `<span class="ft-internal-link" data-mapid="${MAP_ID}">no tocid</span>`;

    expect(collectInternalLinkMapIds(html)).toEqual([]);
  });
});

describe('buildInternalLinkResolver()', () => {
  it('should resolve a tocId to the TOC node display URL', async () => {
    const cache = createMockCache();

    const resolve = await buildInternalLinkResolver({ cache, mapIds: [MAP_ID] });

    expect(resolve(MAP_ID, '8Tflt44ylUo_Jo99tcQj5w')).toBe(
      'https://learn.jamf.com/r/en-US/jamf-pro-documentation-current/Computer_Reports',
    );
    expect(resolve(MAP_ID, 'HO1HzS5wEsYXh1_rA_mdQw')).toBe(
      'https://learn.jamf.com/r/en-US/jamf-pro-documentation-current/Computers',
    );
  });

  it('should not resolve a contentId — the ids are not interchangeable', async () => {
    const cache = createMockCache();

    const resolve = await buildInternalLinkResolver({ cache, mapIds: [MAP_ID] });

    expect(resolve(MAP_ID, 'vccKyPVSh7VrXvknBiPQgQ')).toBeUndefined();
    expect(resolve(OTHER_MAP_ID, '8Tflt44ylUo_Jo99tcQj5w')).toBeUndefined();
  });

  it('should fetch a map TOC once and reuse the cached index', async () => {
    const cache = createMockCache();

    await buildInternalLinkResolver({ cache, mapIds: [MAP_ID] });
    await buildInternalLinkResolver({ cache, mapIds: [MAP_ID] });

    expect(mockedGetJson).toHaveBeenCalledTimes(1);
  });

  it('should perform no I/O when no map is referenced', async () => {
    const cache = createMockCache();

    const resolve = await buildInternalLinkResolver({ cache, mapIds: [] });

    expect(mockedGetJson).not.toHaveBeenCalled();
    expect(resolve(MAP_ID, '8Tflt44ylUo_Jo99tcQj5w')).toBeUndefined();
  });

  it('should degrade to unresolved links when a TOC will not load', async () => {
    const cache = createMockCache();
    const logger = createMockLogger();

    const resolve = await buildInternalLinkResolver({
      cache,
      mapIds: [MAP_ID, OTHER_MAP_ID],
      logger,
    });

    // The map that loaded still resolves; the one that did not stays silent
    // rather than taking the article down with it.
    expect(resolve(MAP_ID, '8Tflt44ylUo_Jo99tcQj5w')).toBeDefined();
    expect(resolve(OTHER_MAP_ID, '8Tflt44ylUo_Jo99tcQj5w')).toBeUndefined();
    expect(logger.warning).toHaveBeenCalledTimes(1);
  });
});

describe('fetchTopicAncestors', () => {
  /**
   * The breadcrumb has no other source. FT's `/content` fragment is the
   * article body, and a breadcrumb belongs to the reader shell around it, so
   * the parser's selector never matches on a topic fetched this way. The map
   * TOC is the only place the hierarchy is published.
   */
  it('reports where a topic sits, nearest root first', async () => {
    const cache = createMockCache();

    const ancestors = await fetchTopicAncestors({
      cache,
      mapId: MAP_ID,
      contentId: 'vccKyPVSh7VrXvknBiPQgQ',
    });

    // 'Computers' only — the topic's own title is not part of its breadcrumb.
    expect(ancestors).toEqual(['Computers']);
  });

  it('gives a root-level topic an empty chain, not its own title', async () => {
    const cache = createMockCache();

    expect(
      await fetchTopicAncestors({
        cache,
        mapId: MAP_ID,
        contentId: 'C149PhXe7uzceHuULOnLfA',
      }),
    ).toEqual([]);
  });

  it('shares the TOC fetch with internal-link resolution', async () => {
    // One index serves both lookups. Fetching twice would double the cost of
    // every article in a map, since both run on the same fetch path.
    const cache = createMockCache();

    await buildInternalLinkResolver({ cache, mapIds: [MAP_ID] });
    await fetchTopicAncestors({ cache, mapId: MAP_ID, contentId: 'vccKyPVSh7VrXvknBiPQgQ' });

    const tocFetches = mockedGetJson.mock.calls.filter(([url]) => url.endsWith('/toc'));
    expect(tocFetches).toHaveLength(1);
  });

  it('returns an empty chain when the TOC will not load', async () => {
    // A partial or invented breadcrumb reads as a real path to somewhere that
    // does not exist, so the failure has to be visible as absence.
    mockedGetJson.mockRejectedValue(new Error('upstream down'));
    const logger = createMockLogger();

    const ancestors = await fetchTopicAncestors({
      cache: createMockCache(),
      mapId: MAP_ID,
      contentId: 'vccKyPVSh7VrXvknBiPQgQ',
      logger,
    });

    expect(ancestors).toEqual([]);
    expect(logger.warning).toHaveBeenCalled();
  });

  it('is silent about a topic the TOC does not list', async () => {
    expect(
      await fetchTopicAncestors({
        cache: createMockCache(),
        mapId: MAP_ID,
        contentId: 'not-in-this-map',
      }),
    ).toEqual([]);
  });
});

/**
 * A map shaped like the thing this feature exists for.
 *
 * `Configuration Profiles` is a parent whose children are what learn.jamf.com
 * renders as its `<h2>` sections — measured at 9 of 9 on the real page — and
 * `Grouping` is a heading node: Fluid Topics gives those an empty `contentId`
 * because nothing addresses them as a topic, and they still have to hold their
 * children together.
 */
const NAV_MAP_ID = 'nav~MapId~AAAAAAAAAA';
const NAV_TOC: FtTocNode[] = [
  {
    tocId: 'root-a',
    contentId: 'content-a',
    title: 'Settings for Computers',
    prettyUrl: '/r/en-US/jamf-pro-documentation-current/Settings',
    children: [
      {
        tocId: 'parent',
        contentId: 'content-parent',
        title: 'Configuration Profiles',
        prettyUrl: '/r/en-US/jamf-pro-documentation-current/Configuration_Profiles',
        children: [
          {
            tocId: 'child-1',
            contentId: 'content-child-1',
            title: 'General Requirements',
            prettyUrl: '/r/en-US/jamf-pro-documentation-current/General_Requirements',
          },
          {
            tocId: 'child-2',
            contentId: 'content-child-2',
            title: 'Uploading a Configuration Profile',
            prettyUrl: '/r/en-US/jamf-pro-documentation-current/Uploading',
          },
          {
            tocId: 'grouping',
            contentId: '',
            title: 'Grouping',
            prettyUrl: '',
            children: [
              {
                tocId: 'child-3',
                contentId: 'content-child-3',
                title: 'Downloading a Configuration Profile',
                prettyUrl: '/r/en-US/jamf-pro-documentation-current/Downloading',
              },
            ],
          },
        ],
      },
      {
        tocId: 'sibling',
        contentId: 'content-sibling',
        title: 'Remote Commands',
        prettyUrl: '/r/en-US/jamf-pro-documentation-current/Remote_Commands',
      },
    ],
  },
  {
    tocId: 'root-b',
    contentId: 'content-b',
    title: 'Mobile Devices',
    prettyUrl: '/r/en-US/jamf-pro-documentation-current/Mobile_Devices',
  },
];

describe('fetchTopicNavigation', () => {
  /**
   * The reason this exists at all.
   *
   * Fluid Topics serves one topic per `/content` call while learn.jamf.com
   * concatenates a topic and its children into a single page — so every `<h2>`
   * a reader sees on the site is a separate topic here, and nothing in the
   * topic's own payload says the others exist. Verified against the live API:
   * all nine `<h2>` headings on "Computer Configuration Profiles" are nine
   * separate TOC entries, and the API HTML for a topic contains zero heading
   * tags of any level.
   */
  beforeEach(() => {
    mockedGetJson.mockImplementation(async (url: string) => {
      await Promise.resolve();
      if (url.endsWith(`/maps/${encodeURIComponent(NAV_MAP_ID)}/toc`)) {
        return NAV_TOC;
      }
      if (url.endsWith(`/maps/${encodeURIComponent(MAP_ID)}/toc`)) {
        return TOC;
      }
      throw new Error(`Unexpected GET JSON: ${url}`);
    });
  });

  it('reports the children a page consists of on the website', async () => {
    const nav = await fetchTopicNavigation({
      cache: createMockCache(),
      mapId: NAV_MAP_ID,
      contentId: 'content-parent',
    });

    expect(nav?.self.title).toBe('Configuration Profiles');
    expect(nav?.parent?.title).toBe('Settings for Computers');
    // The grouping heading is not itself a destination, so it does not appear;
    // its child attaches one rung higher rather than being orphaned under an id
    // nothing can open.
    expect(nav?.children.map((c) => c.title)).toEqual([
      'General Requirements',
      'Uploading a Configuration Profile',
      'Downloading a Configuration Profile',
    ]);
    expect(nav?.childCount).toBe(3);
  });

  it('gives a leaf its siblings, excluding itself', async () => {
    const nav = await fetchTopicNavigation({
      cache: createMockCache(),
      mapId: NAV_MAP_ID,
      contentId: 'content-child-1',
    });

    expect(nav?.parent?.title).toBe('Configuration Profiles');
    expect(nav?.siblings.map((s) => s.title)).toEqual([
      'Uploading a Configuration Profile',
      'Downloading a Configuration Profile',
    ]);
    expect(nav?.siblings.map((s) => s.title)).not.toContain('General Requirements');
    expect(nav?.children).toEqual([]);
    expect(nav?.childCount).toBe(0);
  });

  // CONTROL. A root topic has no parent to take a sibling set from, and the
  // obvious implementation gives it none — so every top-level page in a product
  // reports itself as having no neighbours, which is the opposite of true.
  it('gives a root topic the other roots as siblings', async () => {
    const nav = await fetchTopicNavigation({
      cache: createMockCache(),
      mapId: NAV_MAP_ID,
      contentId: 'content-a',
    });

    expect(nav?.parent).toBeUndefined();
    expect(nav?.siblings.map((s) => s.title)).toEqual(['Mobile Devices']);
    expect(nav?.siblingCount).toBe(1);
  });

  it('never offers a grouping heading as a link, and does not orphan its children', async () => {
    // An empty contentId means nothing addresses the node as a topic, and an
    // empty prettyUrl means there is nowhere to send a reader — so it cannot be
    // a destination. It must not become a dead end either: a child under one
    // attaches to the nearest ancestor that *is* openable, so it keeps a parent
    // to go up to and its uncles as siblings.
    //
    // Measured against the live Jamf Pro map: 0 of 792 nodes are grouping
    // headings, so nothing in the current corpus takes this path. It is tested
    // because `FtTocNode` is a bare cast over `response.json()`.
    const nav = await fetchTopicNavigation({
      cache: createMockCache(),
      mapId: NAV_MAP_ID,
      contentId: 'content-child-3',
    });

    expect(nav?.parent?.title).toBe('Configuration Profiles');
    expect(nav?.siblings.map((s) => s.title)).toEqual([
      'General Requirements',
      'Uploading a Configuration Profile',
    ]);
    expect(nav?.siblings.map((s) => s.title)).not.toContain('Grouping');
  });

  it('caps the lists but reports the true totals', async () => {
    // A top-level page's sibling set is every top-level page — for Jamf Pro
    // that is twenty-odd links on the structured channel of every article
    // fetch. A truncated list that does not say so is one a reader treats as
    // exhaustive, which is what the counts are for.
    const wide: FtTocNode[] = Array.from({ length: 12 }, (_value, index) => ({
      tocId: `w${String(index)}`,
      contentId: `cw${String(index)}`,
      title: `Topic ${String(index)}`,
      prettyUrl: `/r/en-US/jamf-pro-documentation-current/Topic_${String(index)}`,
    }));
    mockedGetJson.mockImplementation(async (url: string) => {
      await Promise.resolve();
      if (url.endsWith(`/maps/${encodeURIComponent(NAV_MAP_ID)}/toc`)) {
        return wide;
      }
      throw new Error(`Unexpected GET JSON: ${url}`);
    });

    const nav = await fetchTopicNavigation({
      cache: createMockCache(),
      mapId: NAV_MAP_ID,
      contentId: 'cw0',
    });

    expect(nav?.siblings).toHaveLength(8);
    expect(nav?.siblingCount).toBe(11);
  });

  it('is silent about a topic the TOC does not list', async () => {
    // Absent means "this map does not place it", which is a different claim
    // from "it has no neighbours" — and the difference is what stops a client
    // rendering an empty navigation block for an unlisted page.
    const nav = await fetchTopicNavigation({
      cache: createMockCache(),
      mapId: NAV_MAP_ID,
      contentId: 'not-in-this-map',
    });

    expect(nav).toBeUndefined();
  });

  it('returns nothing, and warns, when the TOC will not load', async () => {
    mockedGetJson.mockRejectedValue(new Error('boom'));
    const logger = createMockLogger();

    const nav = await fetchTopicNavigation({
      cache: createMockCache(),
      mapId: NAV_MAP_ID,
      contentId: 'content-parent',
      logger,
    });

    expect(nav).toBeUndefined();
    expect(logger.warning).toHaveBeenCalled();
  });

  // REGRESSION. The index is a cache entry, so a lookup returns whatever shape
  // was on disk when it was written — including fields a later version of the
  // indexer no longer produces. Returning a stored node by reference published
  // those extra fields verbatim, and `NavigationLinkSchema` is strict, so one
  // stale key failed output validation for the whole tool and the article did
  // not render at all. Caught by the integration suite against a real cache
  // directory; pinned here so it cannot come back silently.
  //
  // The namespace version guards a *missing* field. Nothing but constructing
  // the link field by field guards an extra one.
  it('publishes only title and url, whatever the cached index holds', async () => {
    const cache = createMockCache();
    await fetchTopicNavigation({ cache, mapId: NAV_MAP_ID, contentId: 'content-parent' });

    // Re-write the cached index with an older, wider node shape. The key is
    // taken from the write the lookup above performed rather than rebuilt, so
    // this stays correct if the namespace is versioned again.
    const key = vi
      .mocked(cache.set)
      .mock.calls.map(([written]) => written)
      .find((written) => written.startsWith('ft-tocindex'));
    expect(key).toBeDefined();
    if (key === undefined) {
      return;
    }
    const stored = await cache.get<{
      nodeByTocId: Record<string, Record<string, unknown>>;
    }>(key);
    expect(stored).not.toBeNull();
    for (const node of Object.values(stored?.nodeByTocId ?? {})) {
      node.contentId = 'a-field-this-version-does-not-emit';
    }
    await cache.set(key, stored, undefined);

    const nav = await fetchTopicNavigation({ cache, mapId: NAV_MAP_ID, contentId: 'content-parent' });

    for (const link of [nav?.self, nav?.parent, ...(nav?.children ?? []), ...(nav?.siblings ?? [])]) {
      if (link !== undefined) {
        expect(Object.keys(link).sort()).toEqual(['title', 'url']);
      }
    }
  });

  it('shares the TOC fetch with the breadcrumb lookup', async () => {
    // Both read the same cached index. An article that already resolved a
    // breadcrumb must not pay a second fetch for its navigation.
    const cache = createMockCache();
    await fetchTopicAncestors({ cache, mapId: NAV_MAP_ID, contentId: 'content-child-1' });
    mockedGetJson.mockClear();

    const nav = await fetchTopicNavigation({ cache, mapId: NAV_MAP_ID, contentId: 'content-child-1' });

    expect(nav?.parent?.title).toBe('Configuration Profiles');
    expect(mockedGetJson).not.toHaveBeenCalled();
  });
});
