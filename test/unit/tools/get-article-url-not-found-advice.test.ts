/**
 * What `jamf_docs_get_article` advises when the topic resolver finds no
 * topic for a learn.jamf.com url.
 *
 * Until 2026-09-28 such a url got the reason and no advice, while a 404 of
 * the article's own request got "The article may have been moved or deleted"
 * (#374, which listed this under "Not fixed here"). Live that day:
 *
 *  - `…/r/en-US/jamf-pro-documentation-current/No_Such_Page_Xyz123` answered
 *    "Topic not found: No_Such_Page_Xyz123 in jamf-pro-documentation-current";
 *  - `…/r/en-US/jamf-pro-documentation-10.40.0/Policies`, a version Jamf no
 *    longer lists (Jamf Pro runs from 11.13.0 to 11.32.x), answered "Cannot
 *    resolve product: jamf-pro-documentation-10.40.0", and its
 *    `/bundle/…/page/Policies.html` spelling "Cannot resolve bundleId: …".
 *
 * Neither reason says the page is gone, only that the url names nothing in
 * what the resolver reads. Its maps list is a copy kept for up to 7 days by
 * default, or what an embedder's MapsProvider gives: a publication Jamf has
 * published since, one a MapsProvider leaves out, and every one when the
 * list is empty, answer "Cannot resolve product", while a search, which is
 * live, returns them with their pair, and the pair reads them. A map's topic
 * index holds only the keys the resolver makes for a page, and a `language`
 * naming another locale looks the page up in that locale's map, where Jamf
 * can publish it at another address. Live that day, with the index keyed by
 * `legacy_topicname` and by title alone, the urls of 26 of the 794 entries in
 * `jamf_docs_get_toc`'s Jamf Pro contents and 91 of the 697 in Technical
 * Articles' answered "Topic not found", `…/Configuring-the-Branding-Settings`
 * among them, and by its pair that page read whole.
 *
 * So each of these failures gets the same advice: the article may have
 * moved, or have a url this server cannot resolve, and a search or a TOC
 * gives the `mapId` and `contentId` to fetch it by.
 *
 * Over MCP, against a whole server with a real MapsRegistry and TopicResolver
 * and only the http client stubbed.
 */

import { vi, describe, it, expect } from 'vitest';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createMcpServer } from '../../../src/core/create-server.js';
import { MapsRegistry } from '../../../src/core/services/maps-registry.js';
import { TopicNotFoundError, TopicResolver } from '../../../src/core/services/topic-resolver.js';
import { HttpError, type HttpClient } from '../../../src/core/http-client.js';
import { JamfDocsError, JamfDocsErrorCode, type FtMapInfo, type FtTopicInfo } from '../../../src/core/types.js';
import { createMockCache, createMockContext } from '../../helpers/mock-context.js';
import type { ServerContext } from '../../../src/core/types/context.js';
import type { ArticleProvider, MapsProvider } from '../../../src/core/services/interfaces/index.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

const BASE = 'https://learn.jamf.com/api/khub';
const PRO_MAP = 'A4LI4vM0BILraYeOD89WGg';
/** "Configuring the Branding Settings": no `legacy_topicname` (live, 2026-09-28). */
const BRANDING = '0nogkohSmN7SEAGQHhFTbw';
const PRESTAGE = 'JyVp2nkOM1zB2lCgV~IgAA';
/** A publication Jamf publishes after the maps list was read. */
const NEW_MAP = 'N3wPap3rMap0000000000A';
const NEW_TOPIC = 'N3wT0p1c00000000000000';

const meta = (key: string, ...values: string[]): { key: string; label: string; values: string[] } =>
  ({ key, label: key, values });

const PRO: FtMapInfo = {
  id: PRO_MAP,
  title: 'Jamf Pro Documentation 11.32.0',
  mapApiEndpoint: `/api/khub/maps/${PRO_MAP}`,
  metadata: [
    meta('version_bundle_stem', 'jamf-pro-documentation'),
    meta('version', '11.32.0'),
    meta('bundle', 'jamf-pro-documentation-current', 'jamf-pro-documentation-11.32.0'),
    meta('latestVersion', 'yes'),
    meta('ft:locale', 'en-US'),
  ],
};

const NEW: FtMapInfo = {
  id: NEW_MAP,
  title: 'Brand New Technical Paper',
  mapApiEndpoint: `/api/khub/maps/${NEW_MAP}`,
  metadata: [
    meta('version_bundle_stem', 'technical-paper-brand-new'),
    meta('bundle', 'technical-paper-brand-new-current'),
    meta('ft:locale', 'en-US'),
  ],
};

const topicInfo = (map: string, id: string, title: string, ...metadata: ReturnType<typeof meta>[]): FtTopicInfo => ({
  title,
  id,
  contentApiEndpoint: `/api/khub/maps/${map}/topics/${id}/content`,
  metadata: [meta('ft:locale', 'en-US'), ...metadata],
});

/** The Jamf Pro map's topic index, as `GET …/topics` lists them. */
const TOPICS: FtTopicInfo[] = [
  topicInfo(PRO_MAP, PRESTAGE, 'Computer PreStage Enrollments', meta('legacy_topicname', 'Computer_PreStage_Enrollments')),
  topicInfo(PRO_MAP, BRANDING, 'Configuring the Branding Settings'),
];
const NEW_TOPICS: FtTopicInfo[] = [
  topicInfo(NEW_MAP, NEW_TOPIC, 'Getting Started', meta('legacy_topicname', 'Getting_Started')),
];

const PRETTY = 'https://learn.jamf.com/r/en-US';
const LEGACY = 'https://learn.jamf.com/en-US/bundle';
const NEW_URL = `${PRETTY}/technical-paper-brand-new-current/Getting_Started`;
const PRESTAGE_URL = `${PRETTY}/jamf-pro-documentation-current/Computer_PreStage_Enrollments`;

// ── Harness ─────────────────────────────────────────────────────────────────

interface Upstream {
  ctx: ServerContext;
  requested: string[];
  /** What learn.jamf.com lists as its maps from now on. */
  publish: (maps: FtMapInfo[]) => void;
}

function upstream(options: { articleProvider?: ArticleProvider; mapsProvider?: MapsProvider; maps?: FtMapInfo[] } = {}): Upstream {
  const requested: string[] = [];
  let maps: FtMapInfo[] = options.maps ?? [PRO];
  const routes: Record<string, unknown> = {
    [`${BASE}/maps/${PRO_MAP}/topics`]: TOPICS,
    [`${BASE}/maps/${PRO_MAP}/toc`]: [],
    [`${BASE}/maps/${PRO_MAP}/topics/${PRESTAGE}`]: TOPICS[0],
    [`${BASE}/maps/${PRO_MAP}/topics/${PRESTAGE}/content`]:
      '<div class="body conbody"><p class="p">Set up a computer PreStage enrollment.</p></div>',
    [`${BASE}/maps/${PRO_MAP}/topics/${BRANDING}`]: TOPICS[1],
    [`${BASE}/maps/${PRO_MAP}/topics/${BRANDING}/content`]:
      '<div class="body conbody"><p class="p">Configure the Self Service branding.</p></div>',
    [`${BASE}/maps/${NEW_MAP}/topics`]: NEW_TOPICS,
    [`${BASE}/maps/${NEW_MAP}/toc`]: [],
    [`${BASE}/maps/${NEW_MAP}/topics/${NEW_TOPIC}`]: NEW_TOPICS[0],
    [`${BASE}/maps/${NEW_MAP}/topics/${NEW_TOPIC}/content`]:
      '<div class="body conbody"><p class="p">Start with the brand new paper.</p></div>',
  };
  const answer = async (url: string): Promise<unknown> => {
    await Promise.resolve();
    requested.push(url);
    if (url === `${BASE}/maps`) { return maps; }
    if (Object.hasOwn(routes, url)) { return routes[url]; }
    // A topic the map does not have, as Fluid Topics answers for one.
    if (new URL(url).pathname.startsWith(`/api/khub/maps/${PRO_MAP}/topics/`)) {
      throw new HttpError(404, 'Not Found', url);
    }
    throw new Error(`offline: no fixture for ${url}`);
  };
  const http: HttpClient = {
    getJson: async <T>(url: string) => await answer(url) as T,
    getText: async (url: string) => await answer(url) as string,
    postJson: async (url: string) => await Promise.reject(new Error(`offline: no fixture for ${url}`)),
  };
  const cache = createMockCache();
  const mapsRegistry = new MapsRegistry(cache, undefined, options.mapsProvider, undefined, http);
  const topicResolver = new TopicResolver(mapsRegistry, cache, undefined, undefined, http);
  const ctx = createMockContext({
    cache, http, mapsRegistry, topicResolver,
    ...(options.articleProvider !== undefined ? { articleProvider: options.articleProvider } : {}),
  });
  return { ctx, requested, publish: (next) => { maps = next; } };
}

async function connect(ctx: ServerContext): Promise<{ client: Client; close: () => Promise<void> }> {
  const server = createMcpServer(ctx);
  const client = new Client({ name: 'test-client', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

interface Reply { isError?: boolean; text: string }

async function callOn(client: Client, name: string, args: Record<string, unknown>): Promise<Reply> {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as { type: string; text?: string }[]).map(c => c.text ?? '').join('\n\n');
  return { ...(result.isError !== undefined ? { isError: result.isError } : {}), text };
}

async function callTool(ctx: ServerContext, name: string, args: Record<string, unknown>): Promise<Reply> {
  const { client, close } = await connect(ctx);
  try {
    return await callOn(client, name, args);
  } finally {
    await close();
  }
}

const ERROR = 'Error fetching article: ';
/** A 404's advice, as #374 gives it. */
const MOVED = '\n\nThe article may have been moved or deleted. Try searching with `jamf_docs_search` to find the current URL.';
const NOT_RESOLVED = '\n\nThe article may have been moved or deleted, or its url may be one this server cannot resolve. '
  + 'Find it with `jamf_docs_search` or `jamf_docs_get_toc`, and fetch it by the `mapId` and `contentId` they give for it.';

// ── A publication or version the maps list does not have ────────────────────

describe('a url whose publication or version the maps list does not have gets the advice that names the pair', () => {
  it.each([
    ['a version Jamf no longer lists, pretty url', `${PRETTY}/jamf-pro-documentation-10.40.0/Policies`,
      'Cannot resolve product: jamf-pro-documentation-10.40.0'],
    ['the same, legacy url', `${LEGACY}/jamf-pro-documentation-10.40.0/page/Policies.html`,
      'Cannot resolve bundleId: jamf-pro-documentation-10.40.0'],
    ['a publication with no map, pretty url', `${PRETTY}/no-such-publication-current/Policies`,
      'Cannot resolve product: no-such-publication-current'],
    ['the same, legacy url', `${LEGACY}/no-such-publication/page/Policies.html`,
      'Cannot resolve bundleId: no-such-publication'],
  ])('%s', async (_label, url, reason) => {
    const { ctx } = upstream();

    const reply = await callTool(ctx, 'jamf_docs_get_article', { url });

    expect(reply).toEqual({ isError: true, text: `${ERROR}${reason}${NOT_RESOLVED}` });
  });

  it('a publication Jamf published after the maps list was read, which its pair reads', async () => {
    const { ctx, publish } = upstream();
    const { client, close } = await connect(ctx);
    try {
      // The server reads the maps list, and keeps it.
      expect((await callOn(client, 'jamf_docs_get_article', { url: PRESTAGE_URL })).text)
        .toContain('Set up a computer PreStage enrollment.');
      publish([PRO, NEW]);

      const reply = await callOn(client, 'jamf_docs_get_article', { url: NEW_URL });
      const byPair = await callOn(client, 'jamf_docs_get_article', { mapId: NEW_MAP, contentId: NEW_TOPIC });

      expect(reply).toEqual({
        isError: true, text: `${ERROR}Cannot resolve product: technical-paper-brand-new-current${NOT_RESOLVED}`,
      });
      expect(byPair.isError).toBeUndefined();
      expect(byPair.text).toContain('Start with the brand new paper.');
    } finally {
      await close();
    }
  });

  it('any publication, when learn.jamf.com lists no maps', async () => {
    const { ctx } = upstream({ maps: [] });

    const reply = await callTool(ctx, 'jamf_docs_get_article', { url: PRESTAGE_URL });

    expect(reply).toEqual({
      isError: true, text: `${ERROR}Cannot resolve product: jamf-pro-documentation-current${NOT_RESOLVED}`,
    });
  });

  it('a publication a MapsProvider leaves out, which its pair reads', async () => {
    const getMaps = vi.fn<MapsProvider['getMaps']>().mockResolvedValue([PRO]);
    const { ctx } = upstream({ mapsProvider: { getMaps }, maps: [PRO, NEW] });
    const { client, close } = await connect(ctx);
    try {
      const reply = await callOn(client, 'jamf_docs_get_article', { url: NEW_URL });
      const byPair = await callOn(client, 'jamf_docs_get_article', { mapId: NEW_MAP, contentId: NEW_TOPIC });

      expect(getMaps).toHaveBeenCalled();
      expect(reply).toEqual({
        isError: true, text: `${ERROR}Cannot resolve product: technical-paper-brand-new-current${NOT_RESOLVED}`,
      });
      expect(byPair.isError).toBeUndefined();
      expect(byPair.text).toContain('Start with the brand new paper.');
    } finally {
      await close();
    }
  });
});

// ── A page the map's topic index has no key for ─────────────────────────────

describe('a url whose page is not in its map\'s topic index gets the same advice', () => {
  it.each([
    ['no such page, pretty url', `${PRETTY}/jamf-pro-documentation-current/No_Such_Page_Xyz123`,
      'Topic not found: No_Such_Page_Xyz123 in jamf-pro-documentation-current'],
    ['no such page, legacy url', `${LEGACY}/jamf-pro-documentation-current/page/No_Such_Page_Xyz123.html`,
      'Topic not found: No_Such_Page_Xyz123 in bundle jamf-pro-documentation-current'],
    ['a page at a slug its map\'s topic index has no key for', `${PRETTY}/jamf-pro-documentation-current/Configuring-the-Branding-Settings`,
      'Topic not found: Configuring-the-Branding-Settings in jamf-pro-documentation-current'],
  ])('%s', async (_label, url, reason) => {
    const { ctx } = upstream();

    const reply = await callTool(ctx, 'jamf_docs_get_article', { url });

    expect(reply).toEqual({ isError: true, text: `${ERROR}${reason}${NOT_RESOLVED}` });
  });

  it('and the pair it points to reads the page the url could not', async () => {
    const { ctx } = upstream();

    const reply = await callTool(ctx, 'jamf_docs_get_article', { mapId: PRO_MAP, contentId: BRANDING });

    expect(reply.isError).toBeUndefined();
    expect(reply.text).toContain('# Configuring the Branding Settings');
    expect(reply.text).toContain('Configure the Self Service branding.');
  });
});

// ── Nothing else changes ────────────────────────────────────────────────────

describe('what is not a url the resolver finds no topic for gets no such advice', () => {
  it('a learn.jamf.com url of a shape this server does not read', async () => {
    const url = 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation-current';
    const { ctx, requested } = upstream();

    const reply = await callTool(ctx, 'jamf_docs_get_article', { url });

    expect(reply).toEqual({ isError: true, text: `${ERROR}Unrecognized URL format: ${url}` });
    expect(requested).toEqual([]);
  });

  it('an ArticleProvider that throws its own NOT_FOUND JamfDocsError', async () => {
    const failure = new JamfDocsError(`Topic not found: ${PRESTAGE} in ${PRO_MAP}`, JamfDocsErrorCode.NOT_FOUND);
    const { ctx } = upstream({
      articleProvider: { getArticleByIds: vi.fn<ArticleProvider['getArticleByIds']>().mockRejectedValue(failure) },
    });

    const reply = await callTool(ctx, 'jamf_docs_get_article', { mapId: PRO_MAP, contentId: PRESTAGE });

    expect(reply.isError).toBe(true);
    expect(reply.text).toContain('Topic not found');
    expect(reply.text).not.toContain('moved or deleted');
  });

  it('a topic of the article\'s own request answering 404 keeps the 404\'s advice', async () => {
    const { ctx } = upstream();

    const reply = await callTool(ctx, 'jamf_docs_get_article', { mapId: PRO_MAP, contentId: 'NoSuchTopicXyz123' });

    expect(reply.isError).toBe(true);
    expect(reply.text).toMatch(/^Error fetching article: HTTP 404/);
    expect(reply.text.endsWith(MOVED)).toBe(true);
  });

  it('the batch, which gives no advice for any failure, as before', async () => {
    const { ctx } = upstream();
    const urls = [
      `${PRETTY}/jamf-pro-documentation-current/No_Such_Page_Xyz123`,
      `${PRETTY}/jamf-pro-documentation-10.40.0/Policies`,
    ];

    const reply = await callTool(ctx, 'jamf_docs_batch_get_articles', { urls, responseFormat: 'json' });
    const { results } = JSON.parse(reply.text) as { results: { status: string; error?: string }[] };

    expect(results.map(r => [r.status, r.error])).toEqual([
      ['error', 'Topic not found: No_Such_Page_Xyz123 in jamf-pro-documentation-current'],
      ['error', 'Cannot resolve product: jamf-pro-documentation-10.40.0'],
    ]);
  });
});

describe('what the tool says of these failures', () => {
  it('its description lists every reason, and that each comes with advice', async () => {
    const { client, close } = await connect(upstream().ctx);
    try {
      const { tools } = await client.listTools();
      const description = tools.find(tool => tool.name === 'jamf_docs_get_article')?.description ?? '';

      expect(description).toContain(
        '- "Topic not found", "Cannot resolve bundleId", "Cannot resolve product" or "HTTP 404" '
        + 'if no article is found at that address, with advice on finding it'
      );
    } finally {
      await close();
    }
  });
});

describe('the resolver\'s failure is still the JamfDocsError it was', () => {
  it.each([
    [`${PRETTY}/jamf-pro-documentation-current/No_Such_Page_Xyz123`,
      'Topic not found: No_Such_Page_Xyz123 in jamf-pro-documentation-current'],
    [`${LEGACY}/jamf-pro-documentation-10.40.0/page/Policies.html`,
      'Cannot resolve bundleId: jamf-pro-documentation-10.40.0'],
  ])('%s', async (url, message) => {
    const { ctx } = upstream();

    const failure = await ctx.topicResolver.resolve({ url }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(TopicNotFoundError);
    expect(failure).toBeInstanceOf(JamfDocsError);
    expect(failure).toMatchObject({ message, code: JamfDocsErrorCode.NOT_FOUND, name: 'JamfDocsError' });
  });
});
