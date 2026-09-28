/**
 * Which source a reply names when the list of documentation maps cannot be
 * read and a MapsProvider is configured: every tool and resource that reads
 * the list, over MCP, with a real MapsRegistry and only the http client
 * stubbed.
 *
 * Since #355 the registry tags what a MapsProvider throws (MapsProviderError),
 * and `jamf_docs_search` names the provider only for that. Until 2026-09-28
 * two tools did not. With a provider that threw "KV namespace unavailable",
 * and no request sent to learn.jamf.com:
 *
 *  - `jamf_docs_glossary_lookup` said the maps list "could not be fetched
 *    from learn.jamf.com (KV namespace unavailable)" and "This may be
 *    temporary: try again in a moment". A provider that threw `new Error('')`
 *    was "from learn.jamf.com ()". A provider whose maps were read, with no
 *    glossary among them, was "learn.jamf.com's list of documentation maps
 *    has no glossary in it".
 *  - `jamf_docs_list_products` said "The maps registry on learn.jamf.com
 *    could not be read" and "This may be temporary: try again in a minute",
 *    with support.jamf.com answering.
 *
 * A provider whose answer the registry cannot use is replaced by the maps on
 * learn.jamf.com, and a failure there is learn.jamf.com's: every reply names
 * learn.jamf.com, and none names the provider.
 *
 * `jamf_docs_get_toc`, `jamf_docs_get_article`, `jamf_docs_batch_get_articles`
 * and `jamf://products/{productId}/toc` quoted the error's own message, which
 * is the provider's for a MapsProviderError and carries learn.jamf.com's
 * address for a request that failed. They named no wrong source on main
 * either, and are here so that stays true. Since 2026-09-28 they name the
 * provider as well (failure-reason-in-replies.test.ts).
 *
 * The glossary and list_products now word a failure that is neither the
 * provider's nor a request's as the search has since #354: "could not be
 * read", and the server log. And the three quote a provider's reason on one
 * line, cut to 200 characters, since list_products' note, which no
 * `maxTokens` cut takes, quotes it too. Until 2026-09-28 the glossary and the
 * search quoted it whole, line breaks and all.
 */

import { vi, describe, it, expect } from 'vitest';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createMcpServer } from '../../../src/core/create-server.js';
import { MapsRegistry } from '../../../src/core/services/maps-registry.js';
import { TopicResolver } from '../../../src/core/services/topic-resolver.js';
import { HttpError, type HttpClient } from '../../../src/core/http-client.js';
import { MAY_BE_TEMPORARY } from '../../../src/core/utils/fetch-failure.js';
import { STATIC_DOC_SOURCES } from '../../../src/core/constants/sources.js';
import { estimateTokens } from '../../../src/core/services/tokenizer.js';
import { createMockCache, createMockContext } from '../../helpers/mock-context.js';
import {
  GLOSSARY_MAP_ID,
  LIVE_GLOSSARY_TOC,
  glossaryToc,
  serveGlossaryContent,
} from '../../helpers/glossary-upstream.js';
import type { FtMapInfo, FtTocNode } from '../../../src/core/types.js';
import type { ServerContext } from '../../../src/core/types/context.js';
import type { CacheProvider } from '../../../src/core/services/interfaces/index.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

const MAPS_LIST = 'https://learn.jamf.com/api/khub/maps';

const meta = (key: string, ...values: string[]): { key: string; label: string; values: string[] } =>
  ({ key, label: key, values });

const PRO_MAP: FtMapInfo = {
  id: 'A4LI4vM0BILraYeOD89WGg',
  title: 'Jamf Pro Documentation 11.32.0',
  mapApiEndpoint: '/api/khub/maps/A4LI4vM0BILraYeOD89WGg',
  metadata: [
    meta('version_bundle_stem', 'jamf-pro-documentation'),
    meta('bundle', 'jamf-pro-documentation-current'),
    meta('latestVersion', 'yes'),
    meta('ft:locale', 'en-US'),
    meta('jamf:portal', 'Jamf Pro'),
  ],
};

const GLOSSARY_MAP: FtMapInfo = {
  id: GLOSSARY_MAP_ID,
  title: 'Jamf Platform Technical Glossary',
  mapApiEndpoint: `/api/khub/maps/${GLOSSARY_MAP_ID}`,
  metadata: [
    meta('version_bundle_stem', 'jamf-technical-glossary'),
    meta('ft:locale', 'en-US'),
  ],
};

/** A map without an id: the registry leaves it out, so an answer of only this is read as none. */
const NO_ID = { title: 'No id' } as unknown as FtMapInfo;

/**
 * support.jamf.com's home page, reduced to the data the collection reader
 * takes. Served for every locale the source declares, so the test does not
 * depend on how many of them `list_products` reads.
 */
const SUPPORT_HOME = `<html><body><script id="__NEXT_DATA__" type="application/json" nonce="n">${
  JSON.stringify({ props: { pageProps: { home: { collections: [{
    id: '12369024', slug: 'jamf-pro', name: 'Jamf Pro',
    url: 'https://support.jamf.com/en/collections/12369024-jamf-pro', articleCount: 3,
  }] } } } })
}</script></body></html>`;

const SUPPORT_HOMES = new Set(Object.values(STATIC_DOC_SOURCES['jamf-support'].locales)
  .map(code => `https://support.jamf.com/${code}/`));

const LEGACY_URL = 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation-current/page/Computer_PreStage_Enrollments.html';
const PRETTY_URL = 'https://learn.jamf.com/r/en-US/jamf-pro-documentation-current/Computer_PreStage_Enrollments';

const KV_DOWN = 'KV namespace unavailable';
const NOT_A_NO_MATCH = 'This is not a "no match": the glossary was not read, so the term was not checked against it.';
const UNEXPECTED_FAILURE_ADVICE = 'Trying again may help. If it keeps failing, the server log says what went wrong.';

// ── Harness ─────────────────────────────────────────────────────────────────

interface Upstream {
  /** What the MapsProvider's `getMaps` does. Unset, no MapsProvider is configured. */
  getMaps?: () => Promise<unknown>;
  /**
   * What learn.jamf.com's maps list answers: the maps, the error its request
   * throws, or a body that is not a list. Unset, the Jamf Pro and glossary maps.
   */
  maps?: FtMapInfo[] | Error | 'not a list';
  /** Whether support.jamf.com's home pages answer. Unset, they do. */
  supportUp?: boolean;
  /** The glossary's table of contents. Unset, the 123 live terms. */
  glossaryToc?: FtTocNode[];
}

interface Harness {
  ctx: ServerContext;
  /** Every request the server made, as `METHOD url`, in order. */
  requests: string[];
}

function upstream(given: Upstream): Harness {
  const requests: string[] = [];
  const offline = (url: string): Error => new Error(`offline: no fixture for ${url}`);
  const glossaryContent = serveGlossaryContent(() => new Set());
  const glossaryTocUrl = `${MAPS_LIST}/${encodeURIComponent(GLOSSARY_MAP_ID)}/toc`;

  const http: HttpClient = {
    getJson: async <T>(url: string) => {
      requests.push(`GET ${url}`);
      if (url === glossaryTocUrl) { return await Promise.resolve((given.glossaryToc ?? LIVE_GLOSSARY_TOC) as T); }
      if (url !== MAPS_LIST) { throw offline(url); }
      const maps = given.maps ?? [PRO_MAP, GLOSSARY_MAP];
      if (maps instanceof Error) { throw maps; }
      return await Promise.resolve((maps === 'not a list' ? {} : maps) as T);
    },
    getText: async (url) => {
      requests.push(`GET ${url}`);
      if (SUPPORT_HOMES.has(url)) {
        if (given.supportUp === false) { throw new HttpError(503, 'Service Unavailable', url); }
        return await Promise.resolve(SUPPORT_HOME);
      }
      const content = /^https:\/\/learn\.jamf\.com\/api\/khub\/maps\/([^/]+)\/topics\/([^/]+)\/content$/.exec(url);
      if (content === null) { throw offline(url); }
      return await glossaryContent(http, decodeURIComponent(content[1]), decodeURIComponent(content[2]));
    },
    postJson: async (url) => {
      requests.push(`POST ${url}`);
      return await Promise.reject(offline(url));
    },
  };

  const cache = createMockCache();
  const mapsRegistry = new MapsRegistry(
    cache, undefined, given.getMaps === undefined ? undefined : { getMaps: given.getMaps as () => Promise<FtMapInfo[]> },
    undefined, http,
  );
  const topicResolver = new TopicResolver(mapsRegistry, cache, undefined, undefined, http);
  return { ctx: createMockContext({ cache, http, mapsRegistry, topicResolver }), requests };
}

/**
 * A MapsProvider that rejects with `failure`, with learn.jamf.com able to
 * answer. A provider on untyped code can reject with a string, `undefined`,
 * or an object that is not an Error.
 */
function providerRejects(failure: unknown): Harness {
  return upstream({ getMaps: vi.fn<() => Promise<unknown>>().mockRejectedValue(failure) });
}

/** A MapsProvider that throws "KV namespace unavailable". */
function providerThrows(): Harness {
  return providerRejects(new Error(KV_DOWN));
}

/** A MapsProvider whose answer the registry cannot use, replaced by a learn.jamf.com fetch that fails. */
function replacedThenFails(error: Error = new HttpError(503, 'Service Unavailable', MAPS_LIST)): Harness {
  return upstream({ getMaps: async () => await Promise.resolve([NO_ID]), maps: error });
}

/** The requests to learn.jamf.com, by the host each one is sent to. */
function toLearnJamf(requests: string[]): string[] {
  return requests.filter(r => new URL(r.slice(r.indexOf(' ') + 1)).hostname === 'learn.jamf.com');
}

interface TextContent { type: 'text'; text: string }

interface Reply {
  isError?: boolean;
  /** Every text content item, joined. */
  text: string;
  structuredContent?: Record<string, unknown>;
}

/** A client connected to a whole server over `ctx`, as a host has it: every tool, resource and prompt. */
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

/**
 * Call a tool over MCP. The client lists the tools first, so it checks every
 * structuredContent against the published outputSchema.
 */
async function call(ctx: ServerContext, name: string, args: Record<string, unknown>): Promise<Reply> {
  const { client, close } = await connect(ctx);
  try {
    await client.listTools();
    const result = await client.callTool({ name, arguments: args });
    const text = (result.content as { type: string; text?: string }[])
      .filter((c): c is TextContent => c.type === 'text')
      .map(c => c.text)
      .join('\n\n');
    return {
      ...(result.isError !== undefined ? { isError: result.isError } : {}),
      text,
      ...(result.structuredContent !== undefined
        ? { structuredContent: result.structuredContent as Record<string, unknown> }
        : {}),
    };
  } finally {
    await close();
  }
}

/** Read a resource over MCP: its text, or the message of the error it answered with. */
async function read(ctx: ServerContext, uri: string): Promise<{ text?: string; error?: string }> {
  const { client, close } = await connect(ctx);
  try {
    const result = await client.readResource({ uri });
    return { text: (result.contents[0] as { text?: string } | undefined)?.text ?? '' };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  } finally {
    await close();
  }
}

async function description(name: string): Promise<string> {
  const { client, close } = await connect(upstream({}).ctx);
  try {
    const { tools } = await client.listTools();
    return tools.find(t => t.name === name)?.description ?? '';
  } finally {
    await close();
  }
}

/** A reply with the addresses the call itself named taken out, so what is left is what the server said. */
function said(reply: Reply, args: Record<string, unknown>): string {
  const asked = [args.url, ...(Array.isArray(args.urls) ? args.urls : [])]
    .filter((u): u is string => typeof u === 'string');
  return asked.reduce((text, url) => text.split(url).join('<asked url>'), reply.text);
}

interface IncompleteNote { unavailable: string[]; message: string }

function incompleteOf(reply: Reply): IncompleteNote | undefined {
  return reply.structuredContent?.incomplete as IncompleteNote | undefined;
}

// ── Every reader of the maps list ───────────────────────────────────────────

/** Each tool call that fails when the maps list cannot be read. */
const FAILING_READS: [string, string, Record<string, unknown>][] = [
  ['jamf_docs_glossary_lookup', 'jamf_docs_glossary_lookup', { term: 'MDM' }],
  ['jamf_docs_search with a product', 'jamf_docs_search', { query: 'setup manager', product: 'jamf-pro' }],
  ['jamf_docs_get_toc by product', 'jamf_docs_get_toc', { product: 'jamf-pro' }],
  ['jamf_docs_get_toc by publication', 'jamf_docs_get_toc', { publication: 'jamf-pro-release-notes' }],
  ['jamf_docs_get_article by a /bundle/ url', 'jamf_docs_get_article', { url: LEGACY_URL }],
  ['jamf_docs_get_article by a /r/ url', 'jamf_docs_get_article', { url: PRETTY_URL }],
  ['jamf_docs_batch_get_articles', 'jamf_docs_batch_get_articles', { urls: [LEGACY_URL, PRETTY_URL] }],
];

describe('a MapsProvider that throws is named by its own reason, and learn.jamf.com is not', () => {
  it.each(FAILING_READS)('%s', async (_label, name, args) => {
    const { ctx, requests } = providerThrows();

    const reply = await call(ctx, name, args);
    const text = said(reply, args);

    expect(reply.isError).toBe(true);
    expect(text).toContain(KV_DOWN);
    expect(text).not.toContain('learn.jamf.com');
    // Only the provider could say whether a retry helps.
    expect(text).not.toMatch(/may be temporary/i);
    expect(toLearnJamf(requests)).toEqual([]);
  });

  it('jamf_docs_list_products, whose note names the provider and not learn.jamf.com', async () => {
    const { ctx, requests } = providerThrows();

    const reply = await call(ctx, 'jamf_docs_list_products', { responseFormat: 'json' });
    const incomplete = incompleteOf(reply);

    expect(reply.isError).not.toBe(true);
    expect(incomplete?.unavailable).toEqual(['maps-registry']);
    expect(incomplete?.message).toContain(KV_DOWN);
    expect(incomplete?.message).not.toContain('learn.jamf.com');
    expect(incomplete?.message).not.toMatch(/may be temporary/i);
    expect(toLearnJamf(requests)).toEqual([]);
  });

  it('jamf://products/{productId}/toc, whose error is the provider\'s', async () => {
    const { ctx, requests } = providerThrows();

    const { error } = await read(ctx, 'jamf://products/jamf-pro/toc');

    expect(error).toContain(KV_DOWN);
    expect(error).not.toContain('learn.jamf.com');
    expect(toLearnJamf(requests)).toEqual([]);
  });

  it('jamf://products and jamf://products/{productId}/versions, which answer with the compiled-in fallback', async () => {
    const { ctx } = providerThrows();

    const products = await read(ctx, 'jamf://products');
    const versions = await read(ctx, 'jamf://products/jamf-pro/versions');

    expect(products.error).toBeUndefined();
    expect(products.text).toContain('"jamf-pro"');
    expect(versions.error).toBeUndefined();
    expect(JSON.parse(versions.text ?? '')).toMatchObject({ productId: 'jamf-pro', versions: ['current'] });
  });
});

describe('a MapsProvider answer replaced by learn.jamf.com, which then fails, is learn.jamf.com\'s failure', () => {
  it.each(FAILING_READS)('%s', async (_label, name, args) => {
    const { ctx, requests } = replacedThenFails();

    const reply = await call(ctx, name, args);
    const text = said(reply, args);

    expect(reply.isError).toBe(true);
    expect(text).toContain('learn.jamf.com');
    expect(text).toContain('503 Service Unavailable');
    expect(text).not.toContain('maps provider');
    expect(requests).toContain(`GET ${MAPS_LIST}`);
  });

  it('jamf_docs_list_products', async () => {
    const { ctx } = replacedThenFails();

    const incomplete = incompleteOf(await call(ctx, 'jamf_docs_list_products', { responseFormat: 'json' }));

    expect(incomplete?.message).toContain('The maps registry on learn.jamf.com could not be read.');
    expect(incomplete?.message).toContain('This may be temporary: try again in a minute.');
    expect(incomplete?.message).not.toContain('maps provider');
  });

  it('jamf://products/{productId}/toc', async () => {
    const { ctx } = replacedThenFails();

    const { error } = await read(ctx, 'jamf://products/jamf-pro/toc');

    expect(error).toContain('https://learn.jamf.com/api/khub/maps');
    expect(error).not.toContain('maps provider');
  });
});

// ── jamf_docs_glossary_lookup ───────────────────────────────────────────────

describe('jamf_docs_glossary_lookup says which source the maps list failed at', () => {
  const lead = 'Glossary lookup for "MDM" failed: the list of documentation maps, which says where the glossary is,';

  it('a MapsProvider that throws: its reason, and no advice, in either format', async () => {
    for (const responseFormat of ['markdown', 'json']) {
      const { ctx } = providerThrows();

      const reply = await call(ctx, 'jamf_docs_glossary_lookup', { term: 'MDM', responseFormat });

      expect(reply.isError).toBe(true);
      expect(reply.text).toBe(
        `${lead} could not be read from the configured maps provider (${KV_DOWN}).\n\n${NOT_A_NO_MATCH}`,
      );
      expect(reply.structuredContent).toBeUndefined();
    }
  });

  it('a MapsProvider that gives no reason: says so, instead of "()"', async () => {
    // An Error with no message or only whitespace, and what a provider on
    // untyped code can reject with: `undefined`, a blank string, or an object
    // that is not an Error.
    for (const failure of [new Error(''), new Error(' \n\t '), undefined, '  ', { code: 7 }]) {
      const { ctx } = providerRejects(failure);

      const reply = await call(ctx, 'jamf_docs_glossary_lookup', { term: 'MDM' });

      expect(reply.text).toBe(
        `${lead} could not be read from the configured maps provider, which gave no reason.\n\n${NOT_A_NO_MATCH}`,
      );
    }
  });

  it('a MapsProvider that rejects with a string: the string is its reason', async () => {
    const { ctx } = providerRejects('quota exceeded');

    const reply = await call(ctx, 'jamf_docs_glossary_lookup', { term: 'MDM' });

    expect(reply.text).toContain('could not be read from the configured maps provider (quota exceeded).');
  });

  it('a MapsProvider answer replaced by learn.jamf.com, which fails: learn.jamf.com, and its advice', async () => {
    const refused = new TypeError('fetch failed', {
      cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
    });

    const unavailable = await call(replacedThenFails().ctx, 'jamf_docs_glossary_lookup', { term: 'MDM' });
    const notFound = await call(
      replacedThenFails(new HttpError(404, 'Not Found', MAPS_LIST)).ctx, 'jamf_docs_glossary_lookup', { term: 'MDM' },
    );
    const unreachable = await call(replacedThenFails(refused).ctx, 'jamf_docs_glossary_lookup', { term: 'MDM' });

    expect(unavailable.text).toBe(
      `${lead} could not be fetched from learn.jamf.com (HTTP 503 Service Unavailable).\n\n${NOT_A_NO_MATCH}` +
      `\n\n${MAY_BE_TEMPORARY}`,
    );
    // A request refused is refused again: no retry sentence, by the rule the search follows.
    expect(notFound.text).toBe(
      `${lead} could not be fetched from learn.jamf.com (HTTP 404 Not Found).\n\n${NOT_A_NO_MATCH}`,
    );
    expect(unreachable.text).toContain('could not be fetched from learn.jamf.com (a network error: ECONNREFUSED).');
  });

  it('a maps list from learn.jamf.com that is not a list: plain words, not "a network error"', async () => {
    // The registry's `maps.map is not a function` is a TypeError, which
    // describeFetchFailure calls a network error. The search stopped saying
    // so in #354.
    const { ctx } = upstream({ maps: 'not a list' });

    const reply = await call(ctx, 'jamf_docs_glossary_lookup', { term: 'MDM' });

    expect(reply.text).toBe(`${lead} could not be read.\n\n${NOT_A_NO_MATCH}\n\n${UNEXPECTED_FAILURE_ADVICE}`);
  });

  it('a maps fetch that failed in a shape that is not a request\'s: plain words, as the search has said since #354', async () => {
    // isRequestFailure knows Node's: an HttpError, a timeout, undici's "fetch
    // failed" or a TypeError with a `cause.code`. An abort, or another
    // runtime's network TypeError, is none of them.
    for (const maps of [
      new DOMException('This operation was aborted', 'AbortError'),
      new TypeError('Network connection lost.'),
    ]) {
      const reply = await call(upstream({ maps }).ctx, 'jamf_docs_glossary_lookup', { term: 'MDM' });

      expect(reply.text).toBe(`${lead} could not be read.\n\n${NOT_A_NO_MATCH}\n\n${UNEXPECTED_FAILURE_ADVICE}`);
    }
  });

  it('a MapsProvider whose maps have no glossary: does not call them learn.jamf.com\'s', async () => {
    const { ctx, requests } = upstream({ getMaps: async () => await Promise.resolve([PRO_MAP]) });

    const reply = await call(ctx, 'jamf_docs_glossary_lookup', { term: 'MDM' });

    expect(reply.isError).toBe(true);
    expect(reply.text).toBe(
      'Glossary lookup for "MDM" failed: the list of documentation maps has no glossary in it.\n\n' +
      'This is not a "no match": there was no glossary to check the term against.',
    );
    expect(toLearnJamf(requests)).toEqual([]);
  });

  it('a table of contents with no terms still may be temporary: the other failures keep their advice', async () => {
    const { ctx } = upstream({ glossaryToc: glossaryToc([]) });

    const reply = await call(ctx, 'jamf_docs_glossary_lookup', { term: 'MDM' });

    expect(reply.text).toBe(
      'Glossary lookup for "MDM" failed: the glossary\'s table of contents came back from learn.jamf.com ' +
      `with no terms in it.\n\n${NOT_A_NO_MATCH}\n\n${MAY_BE_TEMPORARY}`,
    );
  });

  it('answers from the provider\'s maps once it recovers: no failure was kept', async () => {
    let fails = true;
    const { ctx } = upstream({
      getMaps: async () => (fails
        ? await Promise.reject(new Error(KV_DOWN))
        : await Promise.resolve([PRO_MAP, GLOSSARY_MAP])),
    });

    expect((await call(ctx, 'jamf_docs_glossary_lookup', { term: 'MDM' })).isError).toBe(true);

    fails = false;
    const recovered = await call(ctx, 'jamf_docs_glossary_lookup', { term: 'MDM' });

    expect(recovered.isError).not.toBe(true);
    expect(recovered.structuredContent?.totalMatches).toBe(2);
  });
});

// ── jamf_docs_list_products ─────────────────────────────────────────────────

describe('jamf_docs_list_products says which source the maps registry failed at', () => {
  const NOTE = '> **This catalogue is incomplete.** ';
  const STAND_INS = 'Product versions are compiled-in defaults. Every product is assumed to have a table of contents.';

  it('a MapsProvider that throws: its reason, and no advice while every other source answered', async () => {
    const { ctx } = providerThrows();

    const json = await call(ctx, 'jamf_docs_list_products', { responseFormat: 'json' });
    const full = await call(ctx, 'jamf_docs_list_products', {});
    const compact = await call(ctx, 'jamf_docs_list_products', { outputMode: 'compact' });
    const message =
      `The maps registry could not be read from the configured maps provider (${KV_DOWN}). ` +
      `The publication list has none of the documents the maps registry names. ${STAND_INS}`;

    expect(incompleteOf(json)).toEqual({ unavailable: ['maps-registry'], message });
    expect(JSON.parse(json.text)).toMatchObject({ incomplete: { unavailable: ['maps-registry'], message } });
    expect(full.text.startsWith(`# Jamf Documentation Products\n\n${NOTE}${message}\n\n`)).toBe(true);
    expect(compact.text.startsWith(`${NOTE}${message}\n\n`)).toBe(true);
  });

  it('a MapsProvider that gives no reason: says so', async () => {
    const { ctx } = providerRejects(new Error(''));

    const incomplete = incompleteOf(await call(ctx, 'jamf_docs_list_products', { responseFormat: 'json' }));

    expect(incomplete?.message).toContain(
      'The maps registry could not be read from the configured maps provider, which gave no reason.',
    );
  });

  it('a MapsProvider that throws while support.jamf.com is down: the advice is kept for support.jamf.com', async () => {
    const { ctx } = upstream({ getMaps: async () => await Promise.reject(new Error(KV_DOWN)), supportUp: false });

    const incomplete = incompleteOf(await call(ctx, 'jamf_docs_list_products', { responseFormat: 'json' }));

    expect(incomplete?.unavailable).toEqual(['maps-registry', 'jamf-support']);
    expect(incomplete?.message).toMatch(
      new RegExp(`^The maps registry could not be read from the configured maps provider \\(${KV_DOWN}\\)\\. `),
    );
    expect(incomplete?.message).toContain('support.jamf.com could not be read');
    expect(incomplete?.message).not.toContain('learn.jamf.com');
    expect(incomplete?.message.endsWith('This may be temporary: try again in a minute.')).toBe(true);
  });

  it('a maps list that could not be read for a reason that is not a request\'s: the search\'s and the glossary\'s words', async () => {
    const message =
      'The maps registry could not be read. The publication list has none of the documents the maps registry ' +
      `names. ${STAND_INS} ${UNEXPECTED_FAILURE_ADVICE}`;

    for (const maps of ['not a list', new DOMException('This operation was aborted', 'AbortError')] as const) {
      const incomplete = incompleteOf(await call(upstream({ maps }).ctx, 'jamf_docs_list_products', {
        responseFormat: 'json',
      }));

      expect(incomplete).toEqual({ unavailable: ['maps-registry'], message });
    }

    // With support.jamf.com down too, the one advice, which is true of both.
    const incomplete = incompleteOf(await call(upstream({ maps: 'not a list', supportUp: false }).ctx,
      'jamf_docs_list_products', { responseFormat: 'json' }));

    expect(incomplete?.unavailable).toEqual(['maps-registry', 'jamf-support']);
    expect(incomplete?.message).toMatch(/^The maps registry could not be read\. /);
    expect(incomplete?.message).toContain('support.jamf.com could not be read');
    expect(incomplete?.message.endsWith(`(\`jamf-support-*\`). ${UNEXPECTED_FAILURE_ADVICE}`)).toBe(true);
    expect(incomplete?.message).not.toMatch(/may be temporary/i);
  });

  it('learn.jamf.com failing reads as it did', async () => {
    const { ctx } = upstream({ maps: new HttpError(503, 'Service Unavailable', MAPS_LIST) });

    const incomplete = incompleteOf(await call(ctx, 'jamf_docs_list_products', { responseFormat: 'json' }));

    expect(incomplete?.message).toBe(
      'The maps registry on learn.jamf.com could not be read. The publication list has none of the documents ' +
      `published there. ${STAND_INS} This may be temporary: try again in a minute.`,
    );
  });

  it('a stand-in the product half\'s read forced, when learn.jamf.com failed it, keeps the note it had', async () => {
    // learn.jamf.com answers the publication list, then fails the product
    // half's read in the same call. The registry keeps nothing (a TTL of 0
    // and a cache that stores nothing), so each read asks again.
    const { ctx } = upstream({});
    let reads = 0;
    const keepsNothing: CacheProvider = { ...createMockCache(), get: async () => await Promise.resolve(null) };
    const mapsRegistry = new MapsRegistry(keepsNothing, async () => {
      reads++;
      if (reads > 1) { throw new HttpError(503, 'Service Unavailable', MAPS_LIST); }
      return await Promise.resolve([PRO_MAP, GLOSSARY_MAP]);
    }, undefined, 0, ctx.http);

    const incomplete = incompleteOf(await call({ ...ctx, mapsRegistry }, 'jamf_docs_list_products', {
      responseFormat: 'json',
    }));

    expect(reads).toBe(2);
    expect(incomplete).toEqual({
      unavailable: ['maps-registry'],
      message: `The maps registry on learn.jamf.com could not be read. ${STAND_INS} This may be temporary: try again in a minute.`,
    });
  });
});

// ── A provider's reason ─────────────────────────────────────────────────────

describe('a MapsProvider\'s reason, as a reply quotes it', () => {
  const lead = 'Glossary lookup for "MDM" failed: the list of documentation maps, which says where the glossary is,';
  const NOTE = '> **This catalogue is incomplete.** ';

  it('has file paths and stack lines removed, in the glossary and in list_products', async () => {
    const failure = new Error(
      'ENOENT: no such file or directory, open /srv/worker/secrets/maps.json\n' +
      '    at readMaps (/srv/worker/index.js:12:3)\n    at async getMaps (/srv/worker/index.js:40:9)',
    );
    const reason = '(ENOENT: no such file or directory, open <path>)';

    const glossary = await call(providerRejects(failure).ctx, 'jamf_docs_glossary_lookup', { term: 'MDM' });
    const products = incompleteOf(await call(providerRejects(failure).ctx, 'jamf_docs_list_products', {
      responseFormat: 'json',
    }));

    expect(glossary.text).toBe(`${lead} could not be read from the configured maps provider ${reason}.\n\n${NOT_A_NO_MATCH}`);
    expect(products?.message).toMatch(
      /^The maps registry could not be read from the configured maps provider \(ENOENT: no such file or directory, open <path>\)\. /,
    );
    for (const text of [glossary.text, products?.message ?? '']) {
      expect(text).not.toContain('/srv/worker');
      expect(text).not.toMatch(/\bat (async )?\w+ \(/);
    }
  });

  describe('is on one line and cut to 200 characters, so it cannot break a reply or its budget', () => {
    // A heading and a list item that would render outside the note's
    // blockquote, and more text than a 300-token budget allows.
    const failure = new Error(`KV failed\n\n# Injected heading\n- item\n${'x'.repeat(8_000)}`);
    // 199 characters and the ellipsis.
    const reason = `${'KV failed # Injected heading - item '.padEnd(199, 'x')}…`;

    it('jamf_docs_glossary_lookup', async () => {
      const reply = await call(providerRejects(failure).ctx, 'jamf_docs_glossary_lookup', { term: 'MDM' });

      expect(reply.text).toBe(
        `${lead} could not be read from the configured maps provider (${reason}).\n\n${NOT_A_NO_MATCH}`,
      );
    });

    it('jamf_docs_search', async () => {
      const reply = await call(providerRejects(failure).ctx, 'jamf_docs_search', {
        query: 'setup manager', product: 'jamf-pro',
      });

      expect(reply.isError).toBe(true);
      expect(reply.text).toContain(`could not be read from the configured maps provider (${reason}).\n\n`);
      expect(reply.text).not.toContain('\n# Injected heading');
    });

    it('jamf_docs_list_products, whose note is never cut: one line, and the reply within maxTokens', async () => {
      const { ctx } = providerRejects(failure);
      const message =
        `The maps registry could not be read from the configured maps provider (${reason}). ` +
        'The publication list has none of the documents the maps registry names. Product versions are ' +
        'compiled-in defaults. Every product is assumed to have a table of contents.';

      const json = incompleteOf(await call(ctx, 'jamf_docs_list_products', { responseFormat: 'json' }));
      const full = await call(ctx, 'jamf_docs_list_products', { maxTokens: 300 });
      const compact = await call(ctx, 'jamf_docs_list_products', { outputMode: 'compact', maxTokens: 300 });

      expect(json?.message).toBe(message);
      expect(full.text.startsWith(`# Jamf Documentation Products\n\n${NOTE}${message}\n\n`)).toBe(true);
      expect(compact.text.startsWith(`${NOTE}${message}\n\n`)).toBe(true);
      for (const { text } of [full, compact]) {
        expect(text).toContain('Content truncated');
        expect(estimateTokens(text)).toBeLessThanOrEqual(300);
      }
    });
  });
});

// ── Descriptions ────────────────────────────────────────────────────────────

describe('the descriptions name a configured maps provider beside learn.jamf.com', () => {
  it('jamf_docs_glossary_lookup lists a failed maps provider under Errors', async () => {
    const text = await description('jamf_docs_glossary_lookup');
    const errors = text.slice(text.indexOf('Errors:'), text.indexOf('Note: "No glossary')).replace(/\s+/g, ' ');

    expect(errors).toContain('a configured maps provider failed');
    expect(errors).toContain('The message says whether trying again may help.');
  });

  it('jamf_docs_list_products says maps-registry is the maps list, from learn.jamf.com or a maps provider', async () => {
    const text = (await description('jamf_docs_list_products')).replace(/\s+/g, ' ');

    expect(text).toContain(
      '"maps-registry" is the list of documentation maps, from learn.jamf.com or a configured maps provider,',
    );
    expect(text).toContain('The message says whether trying again may help.');
    expect(text).not.toContain('This may be temporary');
  });
});
