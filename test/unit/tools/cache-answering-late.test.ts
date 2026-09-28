/**
 * A call whose cache read answers late: the registered tools over MCP, with
 * the real readers, cache keys, maps registry and topic resolver, a cache
 * that holds a read the case names, and an http client that answers a page
 * when the case says so.
 *
 * A remote store can answer a read after a write it did not see. A call that
 * read an entry that way, before the first call stored it, then looked for
 * the first call's load after that load had cleared, found neither, and
 * requested the page again. Only a read inside the shared load closes that
 * gap (load-once.ts). Until 2026-09-28 `TopicResolver.getTopicIndex` read
 * the cache before it looked for a load in flight: measured offline, with the
 * topic index's reads answering 50 ms late and `/topics` taking 100 ms,
 * twenty `jamf_docs_get_article` calls 10 ms apart requested one map's
 * `/topics` twice. The glossary's table of contents and definitions had no
 * shared load at all (glossary-lookup-fanout.test.ts). The map TOC index
 * already read inside its load (#341), and is pinned here with the others.
 *
 * Nothing here waits on a timer: the page answers when the case says so, and
 * the held read answers once the first call has settled.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { registerGetArticleTool } from '../../../src/core/tools/get-article.js';
import { registerGlossaryLookupTool } from '../../../src/core/tools/glossary-lookup.js';
import { MapsRegistry } from '../../../src/core/services/maps-registry.js';
import { TopicResolver } from '../../../src/core/services/topic-resolver.js';
import { HttpError, type HttpClient } from '../../../src/core/http-client.js';
import type { CacheKey } from '../../../src/core/services/cache-key.js';
import type { CacheProvider } from '../../../src/core/services/interfaces/cache.js';
import { createMockCache, createMockContext } from '../../helpers/mock-context.js';
import { GLOSSARY_MAP_ID, LIVE_GLOSSARY_TOC, serveGlossaryContent } from '../../helpers/glossary-upstream.js';
import type { FtMapInfo, FtMetadataEntry, FtTocNode, FtTopicInfo } from '../../../src/core/types.js';

interface TextContent { type: 'text'; text: string }

interface CallResult {
  isError?: boolean;
  content: unknown[];
  structuredContent?: Record<string, unknown>;
}

function meta(entries: Record<string, string[]>): FtMetadataEntry[] {
  return Object.entries(entries).map(([key, values]) => ({ key, label: key, values }));
}

/** Jamf Pro Documentation's map. */
const MAP_ID = 'A4LI4vM0BILraYeOD89WGg';

const MAPS: FtMapInfo[] = [
  {
    id: GLOSSARY_MAP_ID,
    title: 'Jamf Platform Technical Glossary',
    mapApiEndpoint: `/api/khub/maps/${GLOSSARY_MAP_ID}`,
    metadata: meta({ 'version_bundle_stem': ['jamf-technical-glossary'], 'ft:locale': ['en-US'] }),
  },
  {
    id: MAP_ID,
    title: 'Jamf Pro Documentation',
    mapApiEndpoint: `/api/khub/maps/${MAP_ID}`,
    metadata: meta({
      'version_bundle_stem': ['jamf-pro-documentation'],
      'version': ['11.26.0'], 'ft:locale': ['en-US'], 'latestVersion': ['yes'],
      'bundle': ['jamf-pro-documentation-current', 'jamf-pro-documentation-11.26.0'],
    }),
  },
];

const GLOSSARY_TOC_PATH = `/api/khub/maps/${GLOSSARY_MAP_ID}/toc`;
const TOPICS_PATH = `/api/khub/maps/${MAP_ID}/topics`;
const MAP_TOC_PATH = `/api/khub/maps/${MAP_ID}/toc`;

const TOPICS: FtTopicInfo[] = [0, 1].map(index => ({
  title: `Topic ${String(index)}`,
  id: `content-${String(index)}`,
  contentApiEndpoint: `${TOPICS_PATH}/content-${String(index)}/content`,
  metadata: meta({ 'legacy_topicname': [`Topic_${String(index)}`] }),
}));

const MAP_TOC: FtTocNode[] = [{
  tocId: 'toc-root',
  contentId: 'content-root',
  title: 'Computers',
  prettyUrl: '/r/en-US/jamf-pro-documentation-current/Computers',
  children: TOPICS.map((topic, index) => ({
    tocId: `toc-${String(index)}`,
    contentId: topic.id,
    title: `Topic ${String(index)}`,
    prettyUrl: `/r/en-US/jamf-pro-documentation-current/Topic_${String(index)}`,
  })),
}];

const articleUrl = (index: number): string =>
  `https://learn.jamf.com/en-US/bundle/jamf-pro-documentation-current/page/Topic_${String(index)}.html`;

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

function deferred(): Deferred {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

/** Every path requested, in order. */
const requests: string[] = [];
/** The pages held until the case answers them, and a signal when one is first requested. */
let held: { matches: (path: string) => boolean; requested: Deferred; answer: Deferred } | undefined;
/** The reads held until the first call has settled, by key prefix. */
const heldReads = new Map<string, Promise<void>>();

const serveContent = serveGlossaryContent(() => new Set());

async function asked(path: string): Promise<void> {
  requests.push(path);
  if (held?.matches(path) === true) {
    held.requested.resolve();
    await held.answer.promise;
  }
  await Promise.resolve();
}

const http: HttpClient = {
  getJson: async <T>(url: string) => {
    const path = decodeURIComponent(new URL(url).pathname);
    await asked(path);
    if (path === GLOSSARY_TOC_PATH) { return LIVE_GLOSSARY_TOC as T; }
    if (path === TOPICS_PATH) { return TOPICS as T; }
    if (path === MAP_TOC_PATH) { return MAP_TOC as T; }
    const id = new RegExp(`^${TOPICS_PATH}/([^/]+)$`).exec(path)?.[1];
    const topic = TOPICS.find(t => t.id === id);
    if (topic !== undefined) { return topic as T; }
    throw new HttpError(404, 'Not Found', url);
  },
  getText: async (url: string) => {
    const path = decodeURIComponent(new URL(url).pathname);
    await asked(path);
    const glossaryId = new RegExp(`^/api/khub/maps/${GLOSSARY_MAP_ID}/topics/([^/]+)/content$`).exec(path)?.[1];
    if (glossaryId !== undefined) { return await serveContent(http, GLOSSARY_MAP_ID, glossaryId); }
    if (/\/topics\/content-\d\/content$/.test(path)) { return '<div class="body conbody"><p class="p">Body.</p></div>'; }
    throw new HttpError(404, 'Not Found', url);
  },
  postJson: async url => await Promise.reject(new HttpError(404, 'Not Found', url)),
};

/**
 * A cache that answers a held read with what it held when the read was made,
 * but only once the case lets it: a remote store that answers late.
 */
function lateCache(): CacheProvider {
  const store = createMockCache();
  return {
    ...store,
    get: async <T>(key: CacheKey): Promise<T | null> => {
      const value = await store.get<T>(key);
      const until = [...heldReads].find(([prefix]) => key.startsWith(prefix))?.[1];
      if (until !== undefined) { await until; }
      return value;
    },
  };
}

async function newClient(): Promise<Client> {
  const cache = lateCache();
  const mapsRegistry = new MapsRegistry(cache, async () => await Promise.resolve(MAPS));
  const topicResolver = new TopicResolver(mapsRegistry, cache, undefined, undefined, http);
  const ctx = createMockContext({ cache, http, mapsRegistry, topicResolver });
  const server = new McpServer({ name: 'late-cache-test', version: '0.0.1' });
  registerGlossaryLookupTool(server, ctx);
  registerGetArticleTool(server, ctx);
  const client = new Client({ name: 'late-cache-test', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  await client.listTools();
  return client;
}

async function call(name: string, args: Record<string, unknown>): Promise<CallResult> {
  return await client.callTool({ name, arguments: { responseFormat: 'json', ...args } }) as CallResult;
}

function textOf(result: CallResult): string {
  return (result.content[0] as TextContent).text;
}

/** How many times each path was requested. */
function requestCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const path of requests) { counts[path] = (counts[path] ?? 0) + 1; }
  return counts;
}

/**
 * Two calls. The first is held on the page `matches` names; then the second
 * starts, and its reads of any key starting with `entry` answer, with what
 * the cache held when they were made, only once the first call has settled.
 */
async function secondReadsLate(options: {
  matches: (path: string) => boolean;
  entry: string;
  first: () => Promise<CallResult>;
  second: () => Promise<CallResult>;
}): Promise<[CallResult, CallResult]> {
  held = { matches: options.matches, requested: deferred(), answer: deferred() };
  const first = options.first();
  await held.requested.promise;
  const firstSettled = deferred();
  heldReads.set(options.entry, firstSettled.promise);
  const second = options.second();
  // Everything here answers within the microtask queue: let the second call
  // go as far as it can before the page answers.
  for (let turn = 0; turn < 5; turn++) {
    await new Promise(resolve => setImmediate(resolve));
  }
  held.answer.resolve();
  const answered = await first;
  firstSettled.resolve();
  return [answered, await second];
}

let client: Client;

beforeEach(async () => {
  requests.length = 0;
  held = undefined;
  heldReads.clear();
  client = await newClient();
  return async () => { await client.close(); };
});

describe('a call whose cache read answers late does not request the page again', () => {
  it('the glossary\'s table of contents', async () => {
    const lookup = async (): Promise<CallResult> => await call('jamf_docs_glossary_lookup', { term: 'MDM' });

    const [first, second] = await secondReadsLate({
      matches: path => path === GLOSSARY_TOC_PATH,
      entry: 'glossary-toc:',
      first: lookup,
      second: lookup,
    });

    expect(first.isError, textOf(first)).not.toBe(true);
    expect(second.structuredContent).toEqual(first.structuredContent);
    expect(requestCounts()[GLOSSARY_TOC_PATH]).toBe(1);
    expect(Object.values(requestCounts()).every(n => n === 1), JSON.stringify(requestCounts())).toBe(true);
  });

  it('a glossary definition', async () => {
    const lookup = async (): Promise<CallResult> => await call('jamf_docs_glossary_lookup', { term: 'MDM' });

    const [first, second] = await secondReadsLate({
      matches: path => path.endsWith('/content'),
      entry: 'glossary-content:',
      first: lookup,
      second: lookup,
    });

    expect(first.isError, textOf(first)).not.toBe(true);
    expect(second.structuredContent).toEqual(first.structuredContent);
    const definitions = Object.entries(requestCounts()).filter(([path]) => path.endsWith('/content'));
    expect(definitions.map(([, n]) => n)).toEqual([1, 1]);
  });

  it('a map\'s topic index, which a page URL is resolved with', async () => {
    const [first, second] = await secondReadsLate({
      matches: path => path === TOPICS_PATH,
      entry: 'ft-topic-index-v2:',
      first: async () => await call('jamf_docs_get_article', { url: articleUrl(0) }),
      second: async () => await call('jamf_docs_get_article', { url: articleUrl(1) }),
    });

    expect(first.isError, textOf(first)).not.toBe(true);
    expect(second.isError, textOf(second)).not.toBe(true);
    expect(textOf(second)).toContain('Topic 1');
    expect(requestCounts()[TOPICS_PATH]).toBe(1);
  });

  it('a map\'s TOC index, which an article\'s links, breadcrumb and navigation are read from', async () => {
    const [first, second] = await secondReadsLate({
      matches: path => path === MAP_TOC_PATH,
      entry: 'ft-tocindex-v3:',
      first: async () => await call('jamf_docs_get_article', { mapId: MAP_ID, contentId: 'content-0' }),
      second: async () => await call('jamf_docs_get_article', { mapId: MAP_ID, contentId: 'content-1' }),
    });

    expect(first.isError, textOf(first)).not.toBe(true);
    expect(second.isError, textOf(second)).not.toBe(true);
    expect(second.structuredContent?.breadcrumb).toEqual(['Computers']);
    expect(requestCounts()[MAP_TOC_PATH]).toBe(1);
  });
});
