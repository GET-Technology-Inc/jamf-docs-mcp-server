/**
 * What `jamf_docs_glossary_lookup` calls made at once cost learn.jamf.com on
 * a cold cache: the registered tool over MCP, with the real glossary service,
 * cache keys and maps registry, and only the http client stubbed.
 *
 * Until 2026-09-28 nothing shared the glossary's table of contents, or a
 * term's definition, while it was being requested, so every call that reached
 * one before the first had cached it requested it again. Measured offline,
 * with every request answering on a 20 ms timer: five lookups of `MDM` at once
 * made 15 requests, the table of contents and each of the two definitions
 * five times; three made 9, where one makes 3. Five lookups of five different
 * terms at once made 17, where the same five one after another make 9, as a
 * case below pins. #370 closed the same gap for the other readers of a cache
 * entry.
 *
 * Every request answers on a timer, as in support-and-sitemap-fanout.test.ts:
 * calls made at once reach each page within a few milliseconds of each other,
 * well inside one request.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createMcpServer } from '../../../src/core/create-server.js';
import { registerGlossaryLookupTool } from '../../../src/core/tools/glossary-lookup.js';
import { MapsRegistry } from '../../../src/core/services/maps-registry.js';
import { HttpError, type HttpClient } from '../../../src/core/http-client.js';
import { createMockCache, createMockContext, createMockLoggerFactory } from '../../helpers/mock-context.js';
import { GLOSSARY_MAP_ID, LIVE_GLOSSARY_TOC, glossaryToc, serveGlossaryContent } from '../../helpers/glossary-upstream.js';
import type { ServerContext } from '../../../src/core/types/context.js';
import type { FtMapInfo, FtTocNode } from '../../../src/core/types.js';

interface TextContent { type: 'text'; text: string }

interface CallResult {
  isError?: boolean;
  content: unknown[];
  structuredContent?: Record<string, unknown>;
}

const GLOSSARY_MAP: FtMapInfo = {
  id: GLOSSARY_MAP_ID,
  title: 'Jamf Platform Technical Glossary',
  mapApiEndpoint: `/api/khub/maps/${GLOSSARY_MAP_ID}`,
  metadata: [
    { key: 'version_bundle_stem', label: 'version_bundle_stem', values: ['jamf-technical-glossary'] },
    { key: 'ft:locale', label: 'ft:locale', values: ['en-US'] },
  ],
};

const MAP_PATH = `/api/khub/maps/${GLOSSARY_MAP_ID}`;
const TOC_PATH = `${MAP_PATH}/toc`;

/** How long a request takes to answer. */
const LATENCY_MS = 20;

/** How many calls are made at once. */
const AT_ONCE = 5;

/** Five terms whose candidates overlap: eight definitions between them. */
const TERMS = ['MDM', 'User Approved MDM', 'mobile device management', 'enrollment', 'Automated Device Enrollment'];

/** What the table of contents answers: the live one unless a case says otherwise. */
let toc: FtTocNode[] | '503';
/** Titles whose definition answers 503. */
let failingTitles: Set<string>;
/** Every path requested, in order. */
const requests: string[] = [];

const serveContent = serveGlossaryContent(() => failingTitles);

const http: HttpClient = {
  getJson: async <T>(url: string) => {
    const path = decodeURIComponent(new URL(url).pathname);
    requests.push(path);
    await new Promise(resolve => setTimeout(resolve, LATENCY_MS));
    if (path !== TOC_PATH) { throw new HttpError(404, 'Not Found', url); }
    if (toc === '503') { throw new HttpError(503, 'Service Unavailable', url); }
    return toc as T;
  },
  getText: async (url: string) => {
    const path = decodeURIComponent(new URL(url).pathname);
    requests.push(path);
    await new Promise(resolve => setTimeout(resolve, LATENCY_MS));
    const contentId = new RegExp(`^${MAP_PATH}/topics/([^/]+)/content$`).exec(path)?.[1];
    if (contentId === undefined) { throw new HttpError(404, 'Not Found', url); }
    return await serveContent(http, GLOSSARY_MAP_ID, contentId);
  },
  postJson: async url => await Promise.reject(new HttpError(404, 'Not Found', url)),
};

/** How many times each path was requested. */
function requestCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const path of requests) { counts[path] = (counts[path] ?? 0) + 1; }
  return counts;
}

/** The definitions requested, and how many times each. */
function definitionCounts(): number[] {
  return Object.entries(requestCounts()).filter(([path]) => path.endsWith('/content')).map(([, n]) => n);
}

/** A context whose maps list is read without a request: it is not what is counted. */
function newContext(): ServerContext {
  const cache = createMockCache();
  return createMockContext({
    cache,
    http,
    mapsRegistry: new MapsRegistry(cache, async () => await Promise.resolve([GLOSSARY_MAP])),
  });
}

async function connect(server: McpServer): Promise<Client> {
  const client = new Client({ name: 'glossary-fanout-test', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  // The client checks structuredContent against the published outputSchema
  // only for the tools it has listed.
  await client.listTools();
  return client;
}

async function clientOver(ctx: ServerContext): Promise<Client> {
  const server = new McpServer({ name: 'glossary-fanout-test', version: '0.0.1' });
  registerGlossaryLookupTool(server, ctx);
  return await connect(server);
}

async function lookup(client: Client, term: string): Promise<CallResult> {
  return await client.callTool({
    name: 'jamf_docs_glossary_lookup',
    arguments: { term, responseFormat: 'json' },
  }) as CallResult;
}

async function atOnce(make: () => Promise<CallResult>): Promise<CallResult[]> {
  return await Promise.all(Array.from({ length: AT_ONCE }, make));
}

/** What a lookup of `term` answers on a cold cache when it is the only call. */
async function coldAlone(term: string): Promise<CallResult> {
  const alone = await clientOver(newContext());
  try {
    return await lookup(alone, term);
  } finally {
    await alone.close();
    requests.length = 0;
  }
}

function textOf(result: CallResult): string {
  return (result.content[0] as TextContent).text;
}

/** What a client reads: whether it failed, the text, and the structured reply. */
function reply(result: CallResult): unknown {
  return { isError: result.isError ?? false, text: textOf(result), structuredContent: result.structuredContent };
}

let client: Client;

beforeEach(async () => {
  toc = LIVE_GLOSSARY_TOC;
  failingTitles = new Set();
  requests.length = 0;
  // A context per case, so each starts cold.
  client = await clientOver(newContext());
  return async () => { await client.close(); };
});

describe('jamf_docs_glossary_lookup, called five times at once', () => {
  it('requests the table of contents and each definition once, and every call gets the answer one call gets', async () => {
    const alone = await coldAlone('MDM');
    expect(alone.isError, textOf(alone)).not.toBe(true);

    const results = await atOnce(async () => await lookup(client, 'MDM'));

    expect(requestCounts()[TOC_PATH]).toBe(1);
    expect(definitionCounts()).toEqual([1, 1]);
    for (const result of results) {
      expect(reply(result)).toEqual(reply(alone));
    }
  });

  it('for five different terms, requests each definition once however many of them want it', async () => {
    const alone = new Map<string, CallResult>();
    for (const term of TERMS) { alone.set(term, await coldAlone(term)); }

    const results = await Promise.all(TERMS.map(async term => [term, await lookup(client, term)] as const));

    expect(requestCounts()[TOC_PATH]).toBe(1);
    expect(definitionCounts()).toHaveLength(8);
    expect(definitionCounts().every(n => n === 1), JSON.stringify(requestCounts())).toBe(true);
    for (const [term, result] of results) {
      expect(result.isError, textOf(result)).not.toBe(true);
      expect(reply(result)).toEqual(reply(alone.get(term)!));
    }
  });

  it('requests a table of contents that fails once, every call reports it, and the next call asks again', async () => {
    toc = '503';
    const alone = await coldAlone('MDM');
    expect(alone.isError).toBe(true);

    const results = await atOnce(async () => await lookup(client, 'MDM'));

    expect(requestCounts()).toEqual({ [TOC_PATH]: 1 });
    for (const result of results) {
      expect(reply(result)).toEqual(reply(alone));
    }

    // Nothing of a failure is kept: once the table of contents answers, the
    // next call is served.
    toc = LIVE_GLOSSARY_TOC;
    const recovered = await lookup(client, 'MDM');
    expect(recovered.isError, textOf(recovered)).not.toBe(true);
    expect(requestCounts()[TOC_PATH]).toBe(2);
  });

  it('requests a table of contents with no terms in it once, and the next call asks again', async () => {
    // A TOC with no terms is not the glossary's, so it is not cached; calls
    // made at once share the one request, and nothing after it.
    toc = glossaryToc([]);

    const results = await atOnce(async () => await lookup(client, 'MDM'));

    expect(requestCounts()).toEqual({ [TOC_PATH]: 1 });
    for (const result of results) {
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('with no terms in it');
    }

    await lookup(client, 'MDM');
    expect(requestCounts()[TOC_PATH]).toBe(2);
  });

  it('requests a definition that fails once, and every call reports it as one call does', async () => {
    failingTitles.add('User Approved MDM');
    const alone = await coldAlone('MDM');
    expect(alone.structuredContent?.incomplete).toBeDefined();

    const results = await atOnce(async () => await lookup(client, 'MDM'));

    expect(definitionCounts()).toEqual([1, 1]);
    for (const result of results) {
      expect(reply(result)).toEqual(reply(alone));
    }
  });
});

describe('jamf_docs_glossary_lookup, called one after another', () => {
  it('reads the table of contents and each definition from the cache once it holds them', async () => {
    // What the calls made at once are measured against. Each call here starts
    // after the one before has settled, so no load is in flight to join: only
    // the cache spares a request. Until 2026-09-28 nothing tested that, and a
    // glossary that read neither its table of contents nor a definition from
    // the cache passed every test.
    const results = new Map<string, CallResult>();
    for (const term of TERMS) { results.set(term, await lookup(client, term)); }

    for (const [term, result] of results) {
      expect(result.isError, `${term}: ${textOf(result)}`).not.toBe(true);
    }
    expect(requestCounts()[TOC_PATH]).toBe(1);
    expect(definitionCounts()).toHaveLength(8);
    expect(definitionCounts().every(n => n === 1), JSON.stringify(requestCounts())).toBe(true);

    // A term looked up again requests nothing, and gets the answer it got.
    const before = requests.length;
    const again = await lookup(client, 'MDM');
    expect(requests.slice(before)).toEqual([]);
    expect(reply(again)).toEqual(reply(results.get('MDM')!));
  });
});

describe('two servers over one context, as src/index.ts builds one per HTTP request', () => {
  it('share the glossary\'s requests in flight', async () => {
    const shared = newContext();
    const clients = await Promise.all([
      connect(createMcpServer({ ...shared, logger: createMockLoggerFactory() })),
      connect(createMcpServer({ ...shared, logger: createMockLoggerFactory() })),
    ]);

    try {
      const results = await Promise.all(clients.map(async c => await lookup(c, 'MDM')));

      expect(results.filter(result => result.isError === true)).toEqual([]);
      expect(requestCounts()[TOC_PATH]).toBe(1);
      expect(definitionCounts()).toEqual([1, 1]);
    } finally {
      await Promise.all(clients.map(async (c) => { await c.close(); }));
    }
  });
});
