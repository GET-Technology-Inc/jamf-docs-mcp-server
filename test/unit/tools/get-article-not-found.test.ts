/**
 * What `jamf_docs_get_article` says when there is no article at an address:
 * which 404 it quotes, and when it adds "The article may have been moved or
 * deleted".
 *
 * Until 2026-09-28:
 *
 *  - The advice followed any reason that contained "404": a 404 from the
 *    maps list, which says nothing about the article, a provider's own
 *    message, and a 503 for a topic whose address has "404" in it.
 *  - For an unknown `contentId`, the topic's metadata and its body are
 *    requested side by side, both answer 404, and the reply quoted whichever
 *    answered first. Live on 2026-09-28, 12 calls through the registered tool
 *    for `mapId=ZlB_0jgM2084m7JxZgV1KQ, contentId=NoSuchTopicXyz123` quoted
 *    `…/topics/NoSuchTopicXyz123` 9 times and `…/topics/NoSuchTopicXyz123/content`
 *    3 times.
 *
 * Now the advice follows a 404 at one of the article's own addresses, read
 * from the status and the address of an HttpError, this server's or an
 * ArticleProvider's: on learn.jamf.com the map's topic index, which answers
 * 404 only when the map is gone, or the topic's metadata or body; the page
 * on concepts.jamf.com or support.jamf.com. And the metadata's failure is
 * the one quoted whenever it failed.
 *
 * Over MCP, against a whole server with a real MapsRegistry and TopicResolver
 * and only the http client stubbed.
 */

import { vi, describe, it, expect } from 'vitest';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createMcpServer } from '../../../src/core/create-server.js';
import { MapsRegistry } from '../../../src/core/services/maps-registry.js';
import { TopicResolver } from '../../../src/core/services/topic-resolver.js';
import { HttpError, type HttpClient } from '../../../src/core/http-client.js';
import { createMockCache, createMockContext } from '../../helpers/mock-context.js';
import type { FtMapInfo, FtTopicInfo } from '../../../src/core/types.js';
import type { ServerContext } from '../../../src/core/types/context.js';
import type { ArticleProvider } from '../../../src/core/services/interfaces/index.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

const BASE = 'https://learn.jamf.com/api/khub';
const MAPS_LIST = `${BASE}/maps`;
const PRO_MAP = 'A4LI4vM0BILraYeOD89WGg';
const PRESTAGE = 'JyVp2nkOM1zB2lCgV~IgAA';
const UNKNOWN = 'NoSuchTopicXyz123';
const PRETTY_URL = 'https://learn.jamf.com/r/en-US/jamf-pro-documentation-current/Computer_PreStage_Enrollments';
const CONCEPTS_URL = 'https://concepts.jamf.com/no-such-page-xyz123/';
const SUPPORT_URL = 'https://support.jamf.com/en/articles/99999999-no-such-article';

const metadataUrl = (contentId: string): string => `${BASE}/maps/${PRO_MAP}/topics/${contentId}`;
const contentUrl = (contentId: string): string => `${metadataUrl(contentId)}/content`;

const meta = (key: string, ...values: string[]): { key: string; label: string; values: string[] } =>
  ({ key, label: key, values });

const PRO: FtMapInfo = {
  id: PRO_MAP,
  title: 'Jamf Pro Documentation 11.32.0',
  mapApiEndpoint: `/api/khub/maps/${PRO_MAP}`,
  metadata: [
    meta('version_bundle_stem', 'jamf-pro-documentation'),
    meta('version', '11.32.0'),
    meta('bundle', 'jamf-pro-documentation-current'),
    meta('latestVersion', 'yes'),
    meta('ft:locale', 'en-US'),
  ],
};

const topicInfo = (id: string): FtTopicInfo => ({
  title: 'Computer PreStage Enrollments',
  id,
  contentApiEndpoint: `/api/khub/maps/${PRO_MAP}/topics/${id}/content`,
  metadata: [meta('version', '11.32.0'), meta('ft:locale', 'en-US')],
});

/** learn.jamf.com's 404: no status text (live, 2026-09-28). */
const notFound = (url: string): HttpError => new HttpError(404, '', url);

/** What one request answers: a value, a failure, or nothing ever. */
type Answer = { value: unknown } | { fails: unknown } | 'never';

/** Settle as `answer` says, after `delay` ms. */
async function settle(answer: Answer, delay: number): Promise<unknown> {
  if (answer === 'never') { return await new Promise(() => undefined); }
  await new Promise(resolve => setTimeout(resolve, delay));
  if ('fails' in answer) { throw answer.fails; }
  return answer.value;
}

// ── Harness ─────────────────────────────────────────────────────────────────

interface Upstream {
  /** Answers by url, each after its delay (ms, default 0). Anything else is offline. */
  routes?: Record<string, { answer: Answer; delay?: number }>;
  articleProvider?: ArticleProvider;
}

function upstream(given: Upstream): { ctx: ServerContext; requested: string[] } {
  const requested: string[] = [];
  const routes: Partial<Record<string, { answer: Answer; delay?: number }>> = {
    [MAPS_LIST]: { answer: { value: [PRO] } },
    [`${BASE}/maps/${PRO_MAP}/toc`]: { answer: { value: [] } },
    [`${BASE}/maps/${PRO_MAP}/topics`]: {
      answer: { value: [{ ...topicInfo(PRESTAGE), title: 'Computer_PreStage_Enrollments' }] },
    },
    ...given.routes,
  };
  const answer = async (url: string): Promise<unknown> => {
    requested.push(url);
    const route = routes[url];
    if (route === undefined) { throw new Error(`offline: no fixture for ${url}`); }
    return await settle(route.answer, route.delay ?? 0);
  };
  const http: HttpClient = {
    getJson: async <T>(url: string) => await answer(url) as T,
    getText: async (url: string) => await answer(url) as string,
    postJson: async (url: string) => await Promise.reject(new Error(`offline: no fixture for ${url}`)),
  };
  const cache = createMockCache();
  const mapsRegistry = new MapsRegistry(cache, undefined, undefined, undefined, http);
  const topicResolver = new TopicResolver(mapsRegistry, cache, undefined, undefined, http);
  const ctx = createMockContext({
    cache, http, mapsRegistry, topicResolver,
    ...(given.articleProvider !== undefined ? { articleProvider: given.articleProvider } : {}),
  });
  return { ctx, requested };
}

async function article(ctx: ServerContext, args: Record<string, unknown>): Promise<{ isError?: boolean; text: string }> {
  const server = createMcpServer(ctx);
  const client = new Client({ name: 'test-client', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = await client.callTool({ name: 'jamf_docs_get_article', arguments: args });
    const text = (result.content as { type: string; text?: string }[]).map(c => c.text ?? '').join('\n\n');
    return { ...(result.isError !== undefined ? { isError: result.isError } : {}), text };
  } finally {
    await client.close();
    await server.close();
  }
}

const ERROR = 'Error fetching article: ';
const MOVED = '\n\nThe article may have been moved or deleted. Try searching with `jamf_docs_search` to find the current URL.';

// ── Which 404 is quoted ─────────────────────────────────────────────────────

describe('an unknown contentId quotes the topic metadata\'s 404, whichever request answers first', () => {
  const both404 = (metadataDelay: number, contentDelay: number): Upstream => ({
    routes: {
      [metadataUrl(UNKNOWN)]: { answer: { fails: notFound(metadataUrl(UNKNOWN)) }, delay: metadataDelay },
      [contentUrl(UNKNOWN)]: { answer: { fails: notFound(contentUrl(UNKNOWN)) }, delay: contentDelay },
    },
  });

  it.each([
    ['the metadata answers first', 0, 30],
    ['the body answers first', 30, 0],
  ])('%s', async (_label, metadataDelay, contentDelay) => {
    const { ctx, requested } = upstream(both404(metadataDelay, contentDelay));

    const reply = await article(ctx, { mapId: PRO_MAP, contentId: UNKNOWN });

    expect(reply).toEqual({ isError: true, text: `${ERROR}HTTP 404: ${metadataUrl(UNKNOWN)}${MOVED}` });
    // Both still go out at once.
    expect(requested).toEqual([metadataUrl(UNKNOWN), contentUrl(UNKNOWN)]);
  });

  it('a metadata 404 is answered without waiting for a body that never comes', async () => {
    const { ctx } = upstream({
      routes: {
        [metadataUrl(UNKNOWN)]: { answer: { fails: notFound(metadataUrl(UNKNOWN)) } },
        [contentUrl(UNKNOWN)]: { answer: 'never' },
      },
    });

    const reply = await article(ctx, { mapId: PRO_MAP, contentId: UNKNOWN });

    expect(reply.text).toBe(`${ERROR}HTTP 404: ${metadataUrl(UNKNOWN)}${MOVED}`);
  }, 5_000);

  it('the body\'s 404 is quoted when the metadata answered, however late', async () => {
    const { ctx } = upstream({
      routes: {
        [metadataUrl(PRESTAGE)]: { answer: { value: topicInfo(PRESTAGE) }, delay: 30 },
        [contentUrl(PRESTAGE)]: { answer: { fails: notFound(contentUrl(PRESTAGE)) } },
      },
    });

    const reply = await article(ctx, { mapId: PRO_MAP, contentId: PRESTAGE });

    expect(reply.text).toBe(`${ERROR}HTTP 404: ${contentUrl(PRESTAGE)}${MOVED}`);
  });
});

// ── When the advice is given ────────────────────────────────────────────────

describe('the advice follows a 404 of the article\'s own request', () => {
  it('the topic, for a url resolved through its map\'s topic index', async () => {
    const { ctx } = upstream({
      routes: {
        [metadataUrl(PRESTAGE)]: { answer: { fails: notFound(metadataUrl(PRESTAGE)) } },
        [contentUrl(PRESTAGE)]: { answer: { fails: notFound(contentUrl(PRESTAGE)) } },
      },
    });

    const reply = await article(ctx, { url: PRETTY_URL });

    expect(reply.text).toBe(`${ERROR}HTTP 404: ${metadataUrl(PRESTAGE)}${MOVED}`);
  });

  it.each([
    ['concepts.jamf.com', CONCEPTS_URL],
    ['support.jamf.com', SUPPORT_URL],
  ])('the page, on %s', async (_label, url) => {
    const { ctx } = upstream({ routes: { [url]: { answer: { fails: new HttpError(404, 'Not Found', url) } } } });

    const reply = await article(ctx, { url });

    expect(reply.text).toBe(`${ERROR}HTTP 404 Not Found: ${url}${MOVED}`);
  });

  it('an ArticleProvider\'s HttpError 404 for the topic on learn.jamf.com, read as a 429 of its is', async () => {
    // A provider that reads learn.jamf.com itself asked for the article's own
    // address, and the catch unwraps its ProviderError for either status.
    const { ctx } = upstream({
      articleProvider: {
        getArticleByIds: vi.fn<ArticleProvider['getArticleByIds']>().mockRejectedValue(notFound(metadataUrl(PRESTAGE))),
      },
    });

    const reply = await article(ctx, { mapId: PRO_MAP, contentId: PRESTAGE });

    expect(reply).toEqual({ isError: true, text: `${ERROR}HTTP 404: ${metadataUrl(PRESTAGE)}${MOVED}` });
  });
});

describe('a map Jamf has retired, still in a maps list read before it was: url and pair get the same advice', () => {
  // Live on 2026-09-28 an unknown map answered 404 at its topic index and at
  // any topic in it. A url is resolved through the index and a pair goes to
  // the topic: the same article, gone, reached two ways.
  const INDEX = `${BASE}/maps/${PRO_MAP}/topics`;
  const retired = (): Upstream => ({
    routes: Object.fromEntries([INDEX, metadataUrl(PRESTAGE), contentUrl(PRESTAGE), `${BASE}/maps/${PRO_MAP}/toc`]
      .map(url => [url, { answer: { fails: notFound(url) } }])),
  });

  it('by url, the topic index\'s 404; by the pair, the topic\'s; the advice after each', async () => {
    const byUrl = await article(upstream(retired()).ctx, { url: PRETTY_URL });
    const byPair = await article(upstream(retired()).ctx, { mapId: PRO_MAP, contentId: PRESTAGE });

    expect(byUrl).toEqual({ isError: true, text: `${ERROR}HTTP 404: ${INDEX}${MOVED}` });
    expect(byPair).toEqual({ isError: true, text: `${ERROR}HTTP 404: ${metadataUrl(PRESTAGE)}${MOVED}` });
  });
});

describe('and no other failure gets it, whatever its words', () => {
  it('the maps list answering 404', async () => {
    const { ctx } = upstream({ routes: { [MAPS_LIST]: { answer: { fails: new HttpError(404, 'Not Found', MAPS_LIST) } } } });

    const reply = await article(ctx, { url: PRETTY_URL });

    expect(reply).toEqual({ isError: true, text: `${ERROR}HTTP 404 Not Found: ${MAPS_LIST}` });
  });

  it('the topic answering 503 at an address with 404 in it', async () => {
    const id = 'Ab404CdEfGhIjKlMnOpQrS';
    const { ctx } = upstream({
      routes: {
        [metadataUrl(id)]: { answer: { fails: new HttpError(503, 'Service Unavailable', metadataUrl(id)) } },
        [contentUrl(id)]: { answer: { fails: new HttpError(503, 'Service Unavailable', contentUrl(id)) } },
      },
    });

    const reply = await article(ctx, { mapId: PRO_MAP, contentId: id });

    expect(reply.text).toBe(`${ERROR}HTTP 503 Service Unavailable: ${metadataUrl(id)}`);
  });

  it('a support.jamf.com page that answered but could not be read, at an address with 404 in it', async () => {
    const url = 'https://support.jamf.com/en/articles/14040404-setting-up-a-new-mac';
    const { ctx } = upstream({ routes: { [url]: { answer: { value: '<html><body>Maintenance</body></html>' } } } });

    const reply = await article(ctx, { url });

    expect(reply.text).toBe(`${ERROR}Could not read a Jamf Support Knowledge Base article at ${url}`);
  });

  it('an injected HttpClient that fails the topic\'s 404 with something other than an HttpError', async () => {
    const { ctx } = upstream({
      routes: {
        [metadataUrl(UNKNOWN)]: { answer: { fails: new Error(`404 Not Found: ${metadataUrl(UNKNOWN)}`) } },
        [contentUrl(UNKNOWN)]: { answer: { fails: new Error(`404 Not Found: ${contentUrl(UNKNOWN)}`) } },
      },
    });

    const reply = await article(ctx, { mapId: PRO_MAP, contentId: UNKNOWN });

    expect(reply).toEqual({ isError: true, text: `${ERROR}404 Not Found: ${metadataUrl(UNKNOWN)}` });
  });

  it.each([
    ['a message that says 404', new Error('R2 object toc/jamf-pro.json: 404')],
    // An address of its own, not the article's.
    ['an HttpError 404 for its own object', new HttpError(404, 'Not Found', 'https://r2.example.test/articles/jamf-pro.json')],
  ])('an ArticleProvider that throws %s', async (_label, failure) => {
    const { ctx } = upstream({
      articleProvider: { getArticleByIds: vi.fn<ArticleProvider['getArticleByIds']>().mockRejectedValue(failure) },
    });

    const reply = await article(ctx, { mapId: PRO_MAP, contentId: PRESTAGE });

    expect(reply.isError).toBe(true);
    expect(reply.text).toContain('404');
    expect(reply.text).not.toContain('moved or deleted');
  });
});
