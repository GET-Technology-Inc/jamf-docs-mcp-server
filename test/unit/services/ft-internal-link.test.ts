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
