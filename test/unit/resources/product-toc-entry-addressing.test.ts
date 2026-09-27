/**
 * Whether an entry of `jamf://products/{productId}/toc` can be fetched from
 * what the body holds: the registered resource and `jamf_docs_get_article`
 * over MCP, with the real TOC and article services, and only HTTP mocked.
 *
 * Until 2026-09-28 the body carried every entry's `contentId` (794 of Jamf
 * Pro's 794, live) but not the map they belong to, so none of them could be
 * used on its own: `jamf_docs_get_article` fetches by `mapId` + `contentId`,
 * and a contentId does not name its map. Live on 2026-09-28 the "General
 * Requirements" entry under Declarative Device Management
 * (`6v2U8OQmQs1Joi3ZWEwIyQ`) is in the 11.31.0 map as well, and with that map
 * it fetches the 11.31.0 article; with the ja-JP map it is a 404. The map the
 * body was read from is the one its entries belong to, and it was at hand
 * (`jamf_docs_get_toc` has always sent it).
 *
 * The body's later pages come from the tree the first one cached, and until
 * 2026-09-28 a cached tree was named by asking the registry again, so once
 * the registry named another map, the body and `jamf_docs_get_toc` named a
 * map the entries were not read from. The cache now keeps the map with the
 * tree.
 *
 * The identifiers below are the live ones (2026-09-28).
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';

vi.mock('../../../src/core/http-client.js', async () => {
  const actual = await import('../../../src/core/http-client.js');
  return {
    ...actual,
    httpGetJson: vi.fn(),
    httpGetText: vi.fn(),
    httpPostJson: vi.fn(),
  };
});

import { McpServer } from '@modelcontextprotocol/server';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { httpGetJson, httpGetText, HttpError } from '../../../src/core/http-client.js';
import { registerResources } from '../../../src/core/resources/index.js';
import { registerGetArticleTool } from '../../../src/core/tools/get-article.js';
import { registerGetTocTool } from '../../../src/core/tools/get-toc.js';
import { paginateTocEntries } from '../../../src/core/services/toc-helpers.js';
import { transformFtTocToTocEntries } from '../../../src/core/services/toc-service.js';
import { createMockContext } from '../../helpers/mock-context.js';
import { PRO_MAP, PRO_MAP_PREVIOUS } from '../../helpers/article-upstream.js';
import { ftRootsCosting, tocRootsCosting } from '../../helpers/toc-costs.js';
import type { ServerContext } from '../../../src/core/types/context.js';
import type { FetchTocOptions, FetchTocResult, FtTocNode, FtTopicInfo, TocEntry } from '../../../src/core/types.js';

const mockedGetJson = vi.mocked(httpGetJson);
const mockedGetText = vi.mocked(httpGetText);

// ── Live identifiers (2026-09-28) ───────────────────────────────────────────

// Jamf Pro Documentation, en-US: PRO_MAP is the current map (11.32.0) and
// PRO_MAP_PREVIOUS 11.31.0's (test/helpers/article-upstream.ts).

/** "General Requirements" under Declarative Device Management, in both maps. */
const GENREQ_DDM = '6v2U8OQmQs1Joi3ZWEwIyQ';

const URI = 'jamf://products/jamf-pro/toc';

// ── Fixtures ────────────────────────────────────────────────────────────────

/**
 * Twelve top-level entries, so the resource reads two pages of
 * `jamf_docs_get_toc` (ten to a page) and the entry under the twelfth is on
 * the second. The twelfth is Declarative Device Management, as it is live.
 */
function proTree(bundle: string): FtTocNode[] {
  const roots = ftRootsCosting(Array.from({ length: 11 }, () => 20), bundle);
  return [
    ...roots,
    {
      tocId: 'ddm-toc', contentId: 'ddm-content', title: 'Declarative Device Management',
      prettyUrl: `/r/en-US/${bundle}/Declarative_Device_Management`,
      children: [{
        tocId: 'genreq-ddm-toc', contentId: GENREQ_DDM, title: 'General Requirements',
        prettyUrl: `/r/en-US/${bundle}/GenReq_Declarative_Device_Management`,
      }],
    },
  ];
}

/**
 * Each map: its tree, and the version and locale its topics carry. Any other
 * map holds nothing, as the ja-JP one (`GE9~jUeMhje7axrw1dW5VA`) holds none
 * of these contentIds, live: 0 of the 289 on its page 1 are en-US's, and the
 * pair above with it is a 404.
 */
const MAPS: Record<string, { tree: FtTocNode[]; version: string; locale: string }> = {
  [PRO_MAP]: { tree: proTree('jamf-pro-documentation-current'), version: '11.32.0', locale: 'en-US' },
  [PRO_MAP_PREVIOUS]: { tree: proTree('jamf-pro-documentation-11.31.0'), version: '11.31.0', locale: 'en-US' },
};

function nodesOf(tree: FtTocNode[]): FtTocNode[] {
  return tree.flatMap(node => [node, ...nodesOf(node.children ?? [])]);
}

/** A map's topic as `GET …/maps/{mapId}/topics/{contentId}` sends it, or undefined. */
function topicIn(mapId: string, contentId: string): FtTopicInfo | undefined {
  const map = Object.hasOwn(MAPS, mapId) ? MAPS[mapId] : undefined;
  const node = map === undefined ? undefined : nodesOf(map.tree).find(n => n.contentId === contentId);
  if (map === undefined || node === undefined) {
    return undefined;
  }
  return {
    title: node.title ?? '',
    id: contentId,
    contentApiEndpoint: `/api/khub/maps/${mapId}/topics/${contentId}/content`,
    metadata: [
      { key: 'version', label: 'version', values: [map.version] },
      { key: 'ft:locale', label: 'ft:locale', values: [map.locale] },
      { key: 'ft:prettyUrl', label: 'ft:prettyUrl', values: [node.prettyUrl.replace(/^\/r\//, '')] },
    ],
  };
}

function route(): void {
  mockedGetJson.mockImplementation(async (url: string) => {
    await Promise.resolve();
    const path = decodeURIComponent(new URL(url).pathname);
    const toc = /^\/api\/khub\/maps\/([^/]+)\/toc$/.exec(path);
    if (toc !== null) {
      return Object.hasOwn(MAPS, toc[1]) ? MAPS[toc[1]].tree : [];
    }
    const ids = /^\/api\/khub\/maps\/([^/]+)\/topics\/([^/]+)$/.exec(path);
    const topic = ids === null ? undefined : topicIn(ids[1], ids[2]);
    if (topic !== undefined) {
      return topic;
    }
    // What learn.jamf.com answers for a contentId the map does not hold.
    throw new HttpError(404, '', url);
  });
  mockedGetText.mockImplementation(async (url: string) => {
    await Promise.resolve();
    const ids = /^\/api\/khub\/maps\/([^/]+)\/topics\/([^/]+)\/content$/.exec(decodeURIComponent(new URL(url).pathname));
    const topic = ids === null ? undefined : topicIn(ids[1], ids[2]);
    if (ids === null || topic === undefined) {
      throw new HttpError(404, '', url);
    }
    return `<div class="body conbody"><p class="p">${topic.title ?? ''}, ${MAPS[ids[1]].version}.</p></div>`;
  });
}

// ── Harness ─────────────────────────────────────────────────────────────────

interface TocBody {
  product: string;
  mapId?: string;
  totalEntries: number;
  complete: boolean;
  toc: TocEntry[];
}

let ctx: ServerContext;
let client: Client;

beforeAll(async () => {
  const server = new McpServer({ name: 'test', version: '0.0.1' });
  ctx = createMockContext();
  ctx.mapsRegistry.getVersions = vi.fn().mockResolvedValue(['11.32.0', '11.31.0']);
  registerResources(server, ctx);
  registerGetTocTool(server, ctx);
  registerGetArticleTool(server, ctx);
  client = new Client({ name: 'test-client', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});

afterAll(async () => {
  await client.close();
});

/** What the registry answers for Jamf Pro's current en-US documentation. */
function registryNames(mapId: string): { mapId: string; title: string; resolvedLocale: string } {
  return { mapId, title: 'Jamf Pro Documentation', resolvedLocale: 'en-US' };
}

beforeEach(async () => {
  vi.clearAllMocks();
  delete ctx.tocProvider;
  // Each case starts cold, so no answer is a cached one from an earlier case.
  await ctx.cache.clear();
  ctx.mapsRegistry.resolveMap = vi.fn().mockResolvedValue(registryNames(PRO_MAP));
  route();
});

/** The maps whose tree was fetched, in order. */
function treesFetched(): string[] {
  return mockedGetJson.mock.calls
    .map(([url]) => /^\/api\/khub\/maps\/([^/]+)\/toc$/.exec(decodeURIComponent(new URL(url).pathname))?.[1])
    .filter(mapId => mapId !== undefined);
}

async function readToc(uri = URI): Promise<TocBody> {
  const result = await client.readResource({ uri });
  return JSON.parse((result.contents[0] as { text: string }).text) as TocBody;
}

function flatten(entries: TocEntry[]): TocEntry[] {
  return entries.flatMap(entry => [entry, ...flatten(entry.children ?? [])]);
}

/** The entry under Declarative Device Management: on the second page the resource reads. */
function genReq(body: TocBody): TocEntry {
  const entry = flatten(body.toc).find(e => e.contentId === GENREQ_DDM);
  if (entry === undefined) {
    throw new Error('The body has no entry for General Requirements');
  }
  return entry;
}

async function getArticle(args: Record<string, unknown>): Promise<{ isError: unknown; sc: Record<string, unknown> }> {
  const result = await client.callTool({ name: 'jamf_docs_get_article', arguments: args });
  return { isError: result.isError, sc: (result.structuredContent ?? {}) as Record<string, unknown> };
}

// ── The pair, from the body alone ───────────────────────────────────────────

describe('an entry of the table-of-contents resource, fetched by the pair the body gives it', () => {
  it('carries the map its entries come from', async () => {
    const body = await readToc();

    expect(body.mapId).toBe(PRO_MAP);
  });

  it('fetches the entry\'s own article by the body\'s mapId and the entry\'s contentId', async () => {
    const body = await readToc();
    const entry = genReq(body);

    const { isError, sc } = await getArticle({ mapId: body.mapId, contentId: entry.contentId });

    expect(isError).toBeFalsy();
    expect(sc).toMatchObject({
      title: entry.title,
      url: entry.url,
      mapId: PRO_MAP,
      contentId: GENREQ_DDM,
      version: '11.32.0',
    });
  });

  it('fetches the current article, not the one another version\'s map holds under the same contentId', async () => {
    // The same contentId is in the 11.31.0 map, live, and with that map it is
    // the 11.31.0 article: the contentId alone does not say which.
    const body = await readToc();
    const entry = genReq(body);
    const older = await getArticle({ mapId: PRO_MAP_PREVIOUS, contentId: entry.contentId });
    const own = await getArticle({ mapId: body.mapId, contentId: entry.contentId });

    expect(older.sc.version).toBe('11.31.0');
    expect(own.sc.version).toBe('11.32.0');
    expect(own.sc.url).toBe(entry.url);
  });

  it('fetches every entry of the body by the pair, each its own article', async () => {
    const body = await readToc();
    const entries = flatten(body.toc);
    expect(entries).toHaveLength(body.totalEntries);

    for (const entry of entries) {
      const { isError, sc } = await getArticle({ mapId: body.mapId, contentId: entry.contentId });
      expect(isError, entry.title).toBeFalsy();
      expect({ title: sc.title, url: sc.url }, entry.title).toEqual({ title: entry.title, url: entry.url });
    }
  });

  it('names the map jamf_docs_get_toc names for the same product', async () => {
    const body = await readToc();
    const toc = await client.callTool({ name: 'jamf_docs_get_toc', arguments: { product: 'jamf-pro' } });

    expect((toc.structuredContent as { mapId?: string }).mapId).toBe(body.mapId);
  });

  it('names the map beside the product, before the completeness marker and the entries', async () => {
    const result = await client.readResource({ uri: URI });
    const { text } = result.contents[0] as { text: string };

    expect(Object.keys(JSON.parse(text) as object)).toEqual(['product', 'mapId', 'totalEntries', 'complete', 'toc']);
  });

  it('carries the map on a body that is not the whole tree, too', async () => {
    // Two pages at the resource's budget, the second too large to hold beside
    // the first: what is held is still from this map.
    MAPS[PRO_MAP].tree = ftRootsCosting([...Array.from({ length: 10 }, () => 1000), 10001]);
    try {
      const body = await readToc();

      expect(body.complete).toBe(false);
      expect(body.mapId).toBe(PRO_MAP);
    } finally {
      MAPS[PRO_MAP].tree = proTree('jamf-pro-documentation-current');
    }
  });

  it('keeps the map when the registry fails after the first page cached the tree', async () => {
    // The first page fetches the tree under PRO_MAP and caches it; the second
    // is served from that cache, which holds the map with the tree. Until
    // 2026-09-28 that page asked the registry again, and its failure cost the
    // page its mapId.
    ctx.mapsRegistry.resolveMap = vi.fn()
      .mockResolvedValueOnce(registryNames(PRO_MAP))
      .mockRejectedValue(new Error('registry unreachable'));
    const body = await readToc();

    expect(treesFetched()).toEqual([PRO_MAP]);
    expect(body.mapId).toBe(PRO_MAP);
    const { sc } = await getArticle({ mapId: body.mapId, contentId: genReq(body).contentId });
    expect(sc.version).toBe('11.32.0');
  });

  it('says in the resource description that the body\'s mapId and an entry\'s contentId are the pair', async () => {
    const { resourceTemplates } = await client.listResourceTemplates();
    const template = resourceTemplates.find(t => t.uriTemplate === 'jamf://products/{productId}/toc');

    expect(template?.description).toContain('`mapId`');
    expect(template?.description).toContain('jamf_docs_get_article');
  });
});

// ── A tree the registry has moved on from ──────────────────────────────────

describe('a table of contents read from the cache after the registry names another map', () => {
  // The tree is cached for CACHE_TTL_ARTICLE (24 hours by default) and the
  // registry's maps for CACHE_TTL_PRODUCTS (7 days in the Node server), each
  // written at its own time. Here the registry names 11.31.0's map while the
  // tree is fetched and cached, as it did before 11.32.0 was published, and
  // 11.32.0's by the next read.
  beforeEach(async () => {
    ctx.mapsRegistry.resolveMap = vi.fn().mockResolvedValue(registryNames(PRO_MAP_PREVIOUS));
    await readToc();
    ctx.mapsRegistry.resolveMap = vi.fn().mockResolvedValue(registryNames(PRO_MAP));
  });

  it('names, in the resource body, the map its entries were read from', async () => {
    const body = await readToc();

    expect(treesFetched()).toEqual([PRO_MAP_PREVIOUS]);
    expect(new URL(genReq(body).url).pathname)
      .toBe('/r/en-US/jamf-pro-documentation-11.31.0/GenReq_Declarative_Device_Management');
    expect(body.mapId).toBe(PRO_MAP_PREVIOUS);
  });

  it('names, in jamf_docs_get_toc, the map its entries were read from', async () => {
    const toc = await client.callTool({
      name: 'jamf_docs_get_toc', arguments: { product: 'jamf-pro', responseFormat: 'json' },
    });
    const { text } = (toc.content as { type: string; text: string }[])[0];

    expect(treesFetched()).toEqual([PRO_MAP_PREVIOUS]);
    expect((toc.structuredContent as { mapId?: string }).mapId).toBe(PRO_MAP_PREVIOUS);
    expect((JSON.parse(text) as { mapId?: string }).mapId).toBe(PRO_MAP_PREVIOUS);
  });

  it('fetches, by the body\'s mapId and an entry\'s contentId, that entry\'s own article', async () => {
    const body = await readToc();
    const entry = genReq(body);

    const { isError, sc } = await getArticle({ mapId: body.mapId, contentId: entry.contentId });

    expect(isError).toBeFalsy();
    expect(sc).toMatchObject({ title: entry.title, url: entry.url, version: '11.31.0' });
  });
});

// ── A TocProvider's table of contents ───────────────────────────────────────

describe('a TocProvider\'s table of contents', () => {
  const ENTRIES = transformFtTocToTocEntries(proTree('jamf-pro-documentation-current'));

  /** Serve `entries` a page at a time, with `mapIdOn` giving each page's mapId. */
  function provide(mapIdOn: (page: number) => string | undefined, entries = ENTRIES): void {
    ctx.tocProvider = {
      getTableOfContents: vi.fn(async (_product: string, _version: string, options?: FetchTocOptions) => {
        const page = options?.page ?? 1;
        const mapId = mapIdOn(page);
        const result: FetchTocResult = paginateTocEntries(entries, page, options?.maxTokens ?? 5000);
        return await Promise.resolve(mapId === undefined ? result : { ...result, mapId });
      }),
    };
  }

  it('carries the map the provider names', async () => {
    provide(() => PRO_MAP);
    const body = await readToc();

    expect(body.toc).toEqual(ENTRIES);
    expect(body.mapId).toBe(PRO_MAP);
  });

  it.each([
    ['names none', undefined],
    ['names an empty one', ''],
  ])('carries no map when the provider %s', async (_label, mapId) => {
    provide(() => mapId);
    const body = await readToc();

    expect(body.toc).toEqual(ENTRIES);
    expect(body).not.toHaveProperty('mapId');
  });

  it('carries no map when its pages name different ones, since no one map holds them all', async () => {
    provide(page => page === 1 ? PRO_MAP : PRO_MAP_PREVIOUS);
    const body = await readToc();

    expect(body.toc).toEqual(ENTRIES);
    expect(body).not.toHaveProperty('mapId');
  });

  it('carries the map one page names when the others name none', async () => {
    provide(page => page === 2 ? PRO_MAP : undefined);
    const body = await readToc();

    expect(body.mapId).toBe(PRO_MAP);
  });

  it('carries the map of the pages it holds, whatever a page it left out names', async () => {
    // The second page is read, and left out for not fitting beside the first.
    provide(page => page === 1 ? PRO_MAP : PRO_MAP_PREVIOUS, tocRootsCosting([...Array.from({ length: 10 }, () => 1000), 10001]));
    const body = await readToc();

    expect(body.complete).toBe(false);
    expect(body.toc).toHaveLength(10);
    expect(body.mapId).toBe(PRO_MAP);
  });

  // A page where the provider did not page as asked ends the read, and is
  // not held: its map is not the entries' either.
  it.each([
    ['echoes the first page\'s entries as the second', (first: FetchTocResult): FetchTocResult =>
      ({ ...first, pagination: { ...first.pagination, page: 2 } })],
    ['answers the first page when asked for the second', (first: FetchTocResult): FetchTocResult => first],
  ])('carries the map of the pages it holds when it %s under another map', async (_label, second) => {
    const first = paginateTocEntries(ENTRIES, 1, 20000);
    ctx.tocProvider = {
      getTableOfContents: vi.fn(async (_product: string, _version: string, options?: FetchTocOptions) =>
        await Promise.resolve(options?.page === 2
          ? { ...second(first), mapId: PRO_MAP_PREVIOUS }
          : { ...first, mapId: PRO_MAP })),
    };
    const body = await readToc();

    expect(ctx.tocProvider.getTableOfContents).toHaveBeenCalledTimes(2);
    expect(body.complete).toBe(false);
    expect(body.toc).toEqual(first.toc);
    expect(body.mapId).toBe(PRO_MAP);
  });
});
