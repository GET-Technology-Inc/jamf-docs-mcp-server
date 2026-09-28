/**
 * What every reader of the list of documentation maps says when
 * learn.jamf.com answers it with something that is not a list of maps.
 * `jamf_docs_get_toc`, `jamf_docs_get_article`,
 * `jamf_docs_batch_get_articles` and `jamf://products/{productId}/toc` quote
 * the error; `jamf_docs_search`, `jamf_docs_glossary_lookup` and
 * `jamf_docs_list_products` word the list's failure themselves
 * (describeMapsListFailure).
 *
 * Until 2026-09-28 the first four quoted the JavaScript error the registry
 * hit reading it: "maps.map is not a function" for a `{}`, "Cannot read
 * properties of null (reading 'map')" for a `null`, and "Cannot destructure
 * property 'metadata' of 'map' as it is null" for a list with one `null` in
 * it, which also cost every other map in the list. The other three said the
 * list "could not be read", and that the server log says what went wrong.
 * A list of numbers, or of maps without ids, was no failure: it read as a
 * list with no publications, so a TOC said "Could not resolve map for
 * jamf-pro", the glossary that the list had no glossary in it, and
 * list_products nothing of the list, with every table of contents marked
 * unavailable.
 *
 * Now all seven name learn.jamf.com, and say it answered in a form this
 * server could not read. The maps are read as a MapsProvider's are
 * (readProviderMaps): a map the registry cannot use is left out, and a list
 * with none it can use is the failure.
 *
 * Over MCP, against a whole server with a real MapsRegistry and TopicResolver
 * and only the http client stubbed.
 */

import { describe, it, expect } from 'vitest';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createMcpServer } from '../../../src/core/create-server.js';
import { MapsRegistry } from '../../../src/core/services/maps-registry.js';
import { TopicResolver } from '../../../src/core/services/topic-resolver.js';
import type { HttpClient } from '../../../src/core/http-client.js';
import { STATIC_DOC_SOURCES } from '../../../src/core/constants/sources.js';
import { createMockCache, createMockContext } from '../../helpers/mock-context.js';
import type { FtMapInfo } from '../../../src/core/types.js';
import type { ServerContext } from '../../../src/core/types/context.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

const MAPS_LIST = 'https://learn.jamf.com/api/khub/maps';
const PRO_MAP = 'A4LI4vM0BILraYeOD89WGg';
const PRETTY_URL = 'https://learn.jamf.com/r/en-US/jamf-pro-documentation-current/Computer_PreStage_Enrollments';

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
    meta('jamf:portal', 'Jamf Pro'),
  ],
};

const TOC = [{
  tocId: 'prestage', contentId: 'JyVp2nkOM1zB2lCgV~IgAA', title: 'Computer PreStage Enrollments',
  prettyUrl: '/r/en-US/jamf-pro-documentation-current/Computer_PreStage_Enrollments',
}];

/** What learn.jamf.com can answer the maps list with that is not a list of maps. */
const NOT_A_LIST: [string, unknown][] = [
  ['an object', {}],
  ['null', null],
  ['a string', '<html><body>Maintenance</body></html>'],
  ['a list of nulls', [null, null]],
  ['a list of numbers', [1, 2, 3]],
  ['a list of maps without ids', [{ title: 'Jamf Pro' }]],
];

const UNREADABLE = 'learn.jamf.com answered with the list of documentation maps in a form this server could not read';

/** How the search, the glossary and list_products end a sentence whose subject is the list. */
const CAME_BACK_UNREADABLE = 'came back from learn.jamf.com in a form this server could not read';

/**
 * support.jamf.com's home page, reduced to the data the collection reader
 * takes, so that list_products' note is about the maps list alone.
 */
const SUPPORT_HOME = `<html><body><script id="__NEXT_DATA__" type="application/json" nonce="n">${
  JSON.stringify({ props: { pageProps: { home: { collections: [{
    id: '12369024', slug: 'jamf-pro', name: 'Jamf Pro',
    url: 'https://support.jamf.com/en/collections/12369024-jamf-pro', articleCount: 3,
  }] } } } })
}</script></body></html>`;

const SUPPORT_HOMES = new Set(Object.values(STATIC_DOC_SOURCES['jamf-support'].locales)
  .map(code => `https://support.jamf.com/${code}/`));

// ── Harness ─────────────────────────────────────────────────────────────────

/**
 * Answer the maps list with `list`, or with what `answer.list` holds when the
 * list is read, so a test can change it between calls.
 */
function upstream(list: unknown): { ctx: ServerContext; answer: { list: unknown }; reads: () => number } {
  const answer = { list };
  let reads = 0;
  const http: HttpClient = {
    getJson: async <T>(url: string) => {
      await Promise.resolve();
      if (url === MAPS_LIST) {
        reads += 1;
        return answer.list as T;
      }
      if (url === `${MAPS_LIST}/${PRO_MAP}/toc`) { return TOC as T; }
      throw new Error(`offline: no fixture for ${url}`);
    },
    getText: async (url) => {
      await Promise.resolve();
      if (SUPPORT_HOMES.has(url)) { return SUPPORT_HOME; }
      throw new Error(`offline: no fixture for ${url}`);
    },
    postJson: async url => await Promise.reject(new Error(`offline: no fixture for ${url}`)),
  };
  const cache = createMockCache();
  const mapsRegistry = new MapsRegistry(cache, undefined, undefined, undefined, http);
  const topicResolver = new TopicResolver(mapsRegistry, cache, undefined, undefined, http);
  return { ctx: createMockContext({ cache, http, mapsRegistry, topicResolver }), answer, reads: () => reads };
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

interface Reply { isError?: boolean; text: string; structuredContent?: Record<string, unknown> }

async function call(ctx: ServerContext, name: string, args: Record<string, unknown>): Promise<Reply> {
  const { client, close } = await connect(ctx);
  try {
    const result = await client.callTool({ name, arguments: args });
    const text = (result.content as { type: string; text?: string }[]).map(c => c.text ?? '').join('\n\n');
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

/** The error a resource read answered with, or undefined when it answered. */
async function readError(ctx: ServerContext, uri: string): Promise<string | undefined> {
  const { client, close } = await connect(ctx);
  try {
    await client.readResource({ uri }, { timeout: 5_000 });
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  } finally {
    await close();
  }
}

// ── The readers ─────────────────────────────────────────────────────────────

describe('a maps list that is not a list of maps is said to be one, in plain words, by the four that quote it', () => {
  it.each(NOT_A_LIST)('%s', async (_label, list) => {
    const toc = await call(upstream(list).ctx, 'jamf_docs_get_toc', { product: 'jamf-pro' });
    const article = await call(upstream(list).ctx, 'jamf_docs_get_article', { url: PRETTY_URL });
    const json = await call(upstream(list).ctx, 'jamf_docs_batch_get_articles', {
      urls: [PRETTY_URL], responseFormat: 'json',
    });
    const markdown = await call(upstream(list).ctx, 'jamf_docs_batch_get_articles', { urls: [PRETTY_URL] });
    const resource = await readError(upstream(list).ctx, 'jamf://products/jamf-pro/toc');

    expect(toc).toEqual({ isError: true, text: `Error fetching table of contents: ${UNREADABLE}` });
    expect(article).toEqual({ isError: true, text: `Error fetching article: ${UNREADABLE}` });
    expect((JSON.parse(json.text) as { results: { error?: string }[] }).results.map(r => r.error))
      .toEqual([UNREADABLE]);
    expect(markdown.text).toContain(`**Error**: ${UNREADABLE}\n`);
    expect(resource).toBe(`Error fetching table of contents: ${UNREADABLE}`);
  });
});

describe('and by the three that word the list\'s failure themselves, with the retry advice', () => {
  const MAY_BE_TEMPORARY = 'This may be temporary: try again in a moment.';

  it.each(NOT_A_LIST)('%s', async (_label, list) => {
    const search = await call(upstream(list).ctx, 'jamf_docs_search', { query: 'setup manager', product: 'jamf-pro' });
    const glossary = await call(upstream(list).ctx, 'jamf_docs_glossary_lookup', { term: 'MDM' });
    const products = await call(upstream(list).ctx, 'jamf_docs_list_products', { responseFormat: 'json' });

    expect(search).toMatchObject({
      isError: true,
      text: 'Search for "setup manager" failed: the list of documentation maps, which the product filter ' +
        `"jamf-pro" is built from, ${CAME_BACK_UNREADABLE}.\n\nThis is not a "no results": the search did not ` +
        `complete, so it cannot say whether the documentation has anything for this query.\n\n${MAY_BE_TEMPORARY}`,
    });
    expect(glossary).toMatchObject({
      isError: true,
      text: 'Glossary lookup for "MDM" failed: the list of documentation maps, which says where the glossary ' +
        `is, ${CAME_BACK_UNREADABLE}.\n\nThis is not a "no match": the glossary was not read, so the term was ` +
        `not checked against it.\n\n${MAY_BE_TEMPORARY}`,
    });
    // list_products keeps the retry sentence its note gives learn.jamf.com.
    expect(products.structuredContent?.incomplete).toEqual({
      unavailable: ['maps-registry'],
      message: `The maps registry ${CAME_BACK_UNREADABLE}. The publication list has none of the documents ` +
        'the maps registry names. Product versions are compiled-in defaults. Every product is assumed to ' +
        'have a table of contents. This may be temporary: try again in a minute.',
    });
  });
});

describe('what is read of a list that is one', () => {
  it('a map the registry cannot use is left out, and costs no other map', async () => {
    const mixed = [null, 42, { title: 'no id' }, PRO];

    const reply = await call(upstream(mixed).ctx, 'jamf_docs_get_toc', {
      product: 'jamf-pro', responseFormat: 'json',
    });
    const products = await call(upstream(mixed).ctx, 'jamf_docs_list_products', { responseFormat: 'json' });

    expect(reply.isError).toBeUndefined();
    expect(reply.text).toContain('Computer PreStage Enrollments');
    expect(products.structuredContent?.incomplete).toBeUndefined();
  });

  it('an empty list is a list: no product is found in it', async () => {
    const reply = await call(upstream([]).ctx, 'jamf_docs_get_toc', { product: 'jamf-pro' });

    expect(reply.isError).toBe(true);
    expect(reply.text).not.toContain(UNREADABLE);
  });

  it('nothing is kept of a list that could not be read: the next call reads it again', async () => {
    const { ctx, answer, reads } = upstream({});

    const first = await call(ctx, 'jamf_docs_get_toc', { product: 'jamf-pro' });
    const readByFirst = reads();
    answer.list = [PRO];
    const second = await call(ctx, 'jamf_docs_get_toc', { product: 'jamf-pro' });

    expect(first.text).toBe(`Error fetching table of contents: ${UNREADABLE}`);
    expect(second.isError).toBeUndefined();
    expect(reads()).toBe(readByFirst + 1);
  });
});
