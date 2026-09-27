/**
 * The context `createMcpServer` registers its tools and resources on: the
 * caller's own, read live, with one field of its own, `cache`, which is the
 * provider's guard (cache-guard.ts).
 *
 * Live, because a caller can set a provider on its context after building on
 * it, as this repo's own tests do with a single tool
 * (glossary-lookup-over-budget.test.ts, get-toc-pages.test.ts), and a context
 * can be a class whose fields are getters. A copy of the context,
 * `{ ...ctx, cache }`, would lose both: the provider set later is never
 * called, and a getter on a prototype is not copied at all, so reading
 * `ctx.config.version` while the server is built throws.
 *
 * The guard, because the in-memory state core keeps per `CacheProvider`, the
 * glossary's and the static sources' Fuse indexes and the map TOC loads in
 * flight, is keyed on the object the tools read as `ctx.cache`. src/index.ts
 * builds a server per HTTP request over one context, so every one of those
 * servers has to read the same guard, or each would start that state over.
 */

import { describe, it, expect, vi, type Mock } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/server';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';

/** The context each server handed the glossary tool, in the order they were built. */
const handedToTools = vi.hoisted((): ServerContext[] => []);

vi.mock('../../../src/core/tools/glossary-lookup.js', async (importOriginal) => {
  const actual = await importOriginal<typeof GlossaryLookupModule>();
  return {
    ...actual,
    registerGlossaryLookupTool: (server: McpServer, ctx: ServerContext): void => {
      handedToTools.push(ctx);
      actual.registerGlossaryLookupTool(server, ctx);
    },
  };
});

import type * as GlossaryLookupModule from '../../../src/core/tools/glossary-lookup.js';
import { createMcpServer } from '../../../src/core/create-server.js';
import { guardCache } from '../../../src/core/services/cache-guard.js';
import type { HttpClient } from '../../../src/core/http-client.js';
import type { CacheProvider, GlossaryProvider, LoggerFactory } from '../../../src/core/services/interfaces/index.js';
import type { ServerConfig } from '../../../src/core/config.js';
import type { GlossaryLookupResult } from '../../../src/core/types.js';
import type { ServerContext } from '../../../src/core/types/context.js';
import {
  createMockCache, createMockContext, createMockLoggerFactory, createStubMapsRegistry,
} from '../../helpers/mock-context.js';
import { CCP, POLICIES, PRO_MAP, articleUpstream } from '../../helpers/article-upstream.js';

/** Nothing here may reach the network: a request not served is an error. */
const OFFLINE: HttpClient = {
  getText: async url => await Promise.reject(new Error(`offline: GET ${url}`)),
  getJson: async url => await Promise.reject(new Error(`offline: GET ${url}`)),
  postJson: async url => await Promise.reject(new Error(`offline: POST ${url}`)),
};

const MDM: GlossaryLookupResult = {
  entries: [{
    term: 'MDM',
    definition: 'Mobile device management, as the provider defines it.',
    url: 'https://learn.jamf.com/en-US/bundle/jamf-technical-glossary/page/MDM.html',
  }],
  totalMatches: 1,
  tokenInfo: { tokenCount: 20, truncated: false, maxTokens: 5000 },
};

function glossaryProvider(): { lookup: Mock<GlossaryProvider['lookup']> } {
  return { lookup: vi.fn<GlossaryProvider['lookup']>(async () => await Promise.resolve(MDM)) };
}

async function connect(server: McpServer): Promise<Client> {
  const client = new Client({ name: 'create-server-context-test', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

async function lookupMdm(client: Client): Promise<string> {
  const result = await client.callTool({ name: 'jamf_docs_glossary_lookup', arguments: { term: 'MDM' } });
  expect(result.isError).toBeFalsy();
  return (result.content as { type: string; text: string }[])[0]?.text ?? '';
}

describe('the context createMcpServer registers on', () => {
  it('holds the guard of the caller\'s provider, the same one for every server over it', async () => {
    const cache = createMockCache();
    const ctx = createMockContext({ cache, http: OFFLINE, mapsRegistry: createStubMapsRegistry() });
    handedToTools.length = 0;

    // What src/index.ts does over HTTP: a server per request, each with a
    // logger of its own, over one context.
    const servers = [
      createMcpServer({ ...ctx, logger: createMockLoggerFactory() }),
      createMcpServer({ ...ctx, logger: createMockLoggerFactory() }),
    ];

    const guard = guardCache(cache);
    expect(guard).not.toBe(cache);
    expect(handedToTools).toHaveLength(2);
    expect(handedToTools[0]?.cache).toBe(guard);
    expect(handedToTools[1]?.cache).toBe(guard);
    // The caller's context is left as it was given.
    expect(ctx.cache).toBe(cache);
    await Promise.all(servers.map(async (server) => { await server.close(); }));
  });

  it('shares a map\'s TOC load in flight between two servers over one provider', async () => {
    // Each article needs its map's TOC index, and one server's load is joined
    // by the other only if both read the same object as ctx.cache. The TOC
    // answers on a timer, as in article-toc-index-fanout.test.ts, so the
    // second article arrives while the first one's load is still running.
    const learn = articleUpstream();
    let tocFetches = 0;
    const http: HttpClient = {
      ...OFFLINE,
      getJson: async <T>(url: string): Promise<T> => {
        if (new URL(url).pathname.endsWith('/toc')) {
          tocFetches++;
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        return await learn.getJson(url) as T;
      },
      getText: async url => await learn.getText(url),
    };
    const ctx = createMockContext({ http, mapsRegistry: createStubMapsRegistry() });
    const [first, second] = await Promise.all([
      connect(createMcpServer({ ...ctx, logger: createMockLoggerFactory() })),
      connect(createMcpServer({ ...ctx, logger: createMockLoggerFactory() })),
    ]);

    try {
      const results = await Promise.all([
        first.callTool({ name: 'jamf_docs_get_article', arguments: { mapId: PRO_MAP, contentId: CCP } }),
        second.callTool({ name: 'jamf_docs_get_article', arguments: { mapId: PRO_MAP, contentId: POLICIES } }),
      ]);

      expect(results.map(result => result.isError ?? false)).toEqual([false, false]);
      expect(tocFetches).toBe(1);
    } finally {
      await Promise.all([first.close(), second.close()]);
    }
  });

  it('uses a provider set on the caller\'s context after the server was created', async () => {
    const ctx = createMockContext({ http: OFFLINE, mapsRegistry: createStubMapsRegistry() });
    const client = await connect(createMcpServer(ctx));
    const provider = glossaryProvider();

    try {
      ctx.glossaryProvider = provider;

      expect(await lookupMdm(client)).toContain('Mobile device management, as the provider defines it.');
      expect(provider.lookup).toHaveBeenCalledOnce();
    } finally {
      await client.close();
    }
  });

  it('reads a context whose fields are getters on a class', async () => {
    const fields = createMockContext({ http: OFFLINE, mapsRegistry: createStubMapsRegistry() });

    /** A context an embedder might write: every field a getter over what it was built with. */
    class GetterContext implements ServerContext {
      constructor(private readonly backing: ServerContext, private readonly glossary: GlossaryProvider) {}
      get cache(): CacheProvider { return this.backing.cache; }
      get logger(): LoggerFactory { return this.backing.logger; }
      get config(): ServerConfig { return this.backing.config; }
      get http(): HttpClient { return this.backing.http; }
      get mapsRegistry(): ServerContext['mapsRegistry'] { return this.backing.mapsRegistry; }
      get topicResolver(): ServerContext['topicResolver'] { return this.backing.topicResolver; }
      get glossaryProvider(): GlossaryProvider { return this.glossary; }
    }

    const client = await connect(createMcpServer(new GetterContext(fields, glossaryProvider())));

    try {
      expect(client.getServerVersion()?.version).toBe(fields.config.version);
      expect(await lookupMdm(client)).toContain('Mobile device management, as the provider defines it.');
    } finally {
      await client.close();
    }
  });
});
