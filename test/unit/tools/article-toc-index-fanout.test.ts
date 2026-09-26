/**
 * What the map TOC costs a client of `jamf_docs_batch_get_articles` and
 * `jamf_docs_get_article`: the registered tools over MCP, with the real
 * article service, parser and formatter, and only the HTTP calls mocked.
 *
 * Until #339 each article loaded its map's TOC index up to three times, and
 * concurrent articles in one map each built it: a cold batch at the default
 * `concurrency: 3` downloaded one map's `/toc` three times, and at 5 five
 * times. Measured live on 2026-09-26 against learn.jamf.com, ten uncached
 * Jamf Pro topics through `limitConcurrency` and core's `FileCache`: three
 * `/toc` downloads in each of three runs at 3, five in each of three at 5. A
 * `/toc` that failed was retried by each consumer in turn, so one uncached
 * `get_article` waited out three timeouts.
 *
 * `/toc` answers on a timer and topics at once, because that is the race: in
 * those runs the workers reached `/toc` within 1-53 ms of each other, and one
 * download of it took 200-1340 ms.
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
import { registerGetArticleTool } from '../../../src/core/tools/get-article.js';
import { registerBatchGetArticlesTool } from '../../../src/core/tools/batch-get-articles.js';
import { createMockContext } from '../../helpers/mock-context.js';
import type { Logger } from '../../../src/core/services/interfaces/index.js';
import type { ServerContext } from '../../../src/core/types/context.js';
import type { ResolvedTopic, TopicResolverInput } from '../../../src/core/services/topic-resolver.js';
import type { FtTocNode, FtTopicInfo } from '../../../src/core/types.js';

const mockedGetJson = vi.mocked(httpGetJson);
const mockedGetText = vi.mocked(httpGetText);

const MAP_ID = 'A4LI4vM0BILraYeOD89WGg';
const TOC_LATENCY_MS = 20;

const TOPICS: FtTocNode[] = Array.from({ length: 10 }, (_value, index) => ({
  tocId: `toc-${String(index)}`,
  contentId: `content-${String(index)}`,
  title: `Topic ${String(index)}`,
  prettyUrl: `/r/en-US/jamf-pro-documentation-current/Topic_${String(index)}`,
}));

const TOC: FtTocNode[] = [{
  tocId: 'toc-root',
  contentId: 'content-root',
  title: 'Managing Computers',
  prettyUrl: '/r/en-US/jamf-pro-documentation-current/Managing_Computers',
  children: TOPICS,
}];

const TOPIC_1_URL = 'https://learn.jamf.com/r/en-US/jamf-pro-documentation-current/Topic_1';

/** Every topic links to Topic 1, so each article needs the index to render. */
const HTML = '<div class="body conbody"><p class="p">Body. See '
  + `<span class="link ft-internal-link" data-mapid="${MAP_ID}" data-tocid="toc-1">Topic 1</span>.</p></div>`;

const articleUrl = (index: number): string =>
  `https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/Topic_${String(index)}.html`;

let tocFails: boolean;

function route(): void {
  mockedGetJson.mockImplementation(async (url: string) => {
    const path = decodeURIComponent(new URL(url).pathname);
    if (path === `/api/khub/maps/${MAP_ID}/toc`) {
      await new Promise((resolve) => setTimeout(resolve, TOC_LATENCY_MS));
      if (tocFails) {
        throw new HttpError(503, 'Service Unavailable', url);
      }
      return TOC;
    }
    await Promise.resolve();
    const id = /\/topics\/([^/]+)$/.exec(path)?.[1];
    if (id !== undefined) {
      const topic: FtTopicInfo = {
        title: `Title of ${id}`,
        id,
        contentApiEndpoint: `/api/khub/maps/${MAP_ID}/topics/${id}/content`,
        metadata: [],
      };
      return topic;
    }
    throw new Error(`Unexpected GET JSON: ${url}`);
  });
  mockedGetText.mockImplementation(async (url: string) => {
    await Promise.resolve();
    if (url.endsWith('/content')) {
      return HTML;
    }
    throw new Error(`Unexpected GET text: ${url}`);
  });
}

function tocFetches(): number {
  return mockedGetJson.mock.calls.filter(([url]) => url.endsWith('/toc')).length;
}

/** Every warning the server logged about a TOC index, across all its loggers. */
function tocWarnings(): string[] {
  return vi.mocked(ctx.logger.createLogger).mock.results
    .flatMap(({ value }) => vi.mocked((value as Logger).warning).mock.calls)
    .map(([message]) => String(message))
    .filter((message) => message.includes('TOC index unavailable'));
}

// ── Harness ─────────────────────────────────────────────────────────────────

interface TextContent { type: 'text'; text: string }

let client: Client;
let ctx: ServerContext;

beforeAll(async () => {
  const server = new McpServer({ name: 'test-server', version: '0.0.1' });
  ctx = createMockContext();
  // Resolving a url is the topic resolver's job and has its own tests.
  ctx.topicResolver.resolve = vi.fn(async ({ url }: TopicResolverInput): Promise<ResolvedTopic> => {
    await Promise.resolve();
    const index = /Topic_(\d+)\.html$/.exec(url ?? '')?.[1];
    if (index === undefined) {
      throw new Error(`Unexpected resolve: ${String(url)}`);
    }
    return { mapId: MAP_ID, contentId: `content-${index}`, locale: 'en-US' };
  });
  registerGetArticleTool(server, ctx);
  registerBatchGetArticlesTool(server, ctx);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test-client', version: '0.0.1' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  vi.clearAllMocks();
  tocFails = false;
  // Each case starts cold: the index is what is under test.
  await ctx.cache.clear();
  route();
});

// ── Cases ───────────────────────────────────────────────────────────────────

describe('jamf_docs_batch_get_articles on a cold map', () => {
  it.each([1, 3, 5])('downloads its TOC once at concurrency %i', async (concurrency) => {
    const result = await client.callTool({
      name: 'jamf_docs_batch_get_articles',
      arguments: { urls: TOPICS.map((_topic, index) => articleUrl(index)), concurrency },
    });

    const structured = result.structuredContent as {
      results: { status: string; content?: string }[];
      summary: { succeeded: number };
    };
    expect(structured.summary.succeeded).toBe(10);
    // Every article did place its link, so each one had the index.
    for (const article of structured.results) {
      expect(article.content).toContain(`(${TOPIC_1_URL})`);
    }
    expect(tocFetches()).toBe(1);
  });
});

describe('jamf_docs_get_article with a map TOC that will not load', () => {
  it('attempts it once, warns once, and serves the article', async () => {
    tocFails = true;

    const result = await client.callTool({
      name: 'jamf_docs_get_article',
      arguments: { url: articleUrl(2) },
    });

    expect(result.isError).toBeFalsy();
    const { text } = result.content[0] as TextContent;
    expect(text).toContain('Title of content-2');
    // The link stays text rather than pointing anywhere invented.
    expect(text).toContain('Topic 1');
    expect(text).not.toContain(TOPIC_1_URL);
    expect(tocFetches()).toBe(1);
    expect(tocWarnings()).toHaveLength(1);
  });
});
