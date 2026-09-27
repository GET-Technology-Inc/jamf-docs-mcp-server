/**
 * What `jamf_docs_list_products` and `jamf_docs_get_toc` answer when a
 * support.jamf.com page answers 200 without the data the Intercom reader
 * takes from it: the registered tools over MCP, with the real reader and
 * cache keys, and only the http client stubbed.
 *
 * Until 2026-09-28 the reader took a home page without its collection list
 * for a locale that publishes nothing, and cached that for
 * `cacheTtl.products`, 7 days by default. A 503 is reported and not cached; a
 * maintenance page, a page with no `home`, or an empty en list was neither.
 * So for up to 7 days:
 *
 * - `list_products` listed no `jamf-support-*` publication, and had no
 *   `incomplete` to say so (#345);
 * - `get_toc` in en-US said the site "publishes nothing in en-US";
 * - `get_toc` in another locale served the en-US edition with a note that
 *   Jamf does not publish the collection in that locale, when that locale's
 *   own page was the one that failed;
 * - `get_toc` in another locale could read ids only from its own slugs when
 *   the en page was the one that failed, and logged nothing, where a 503 is
 *   logged and retried on the next call (#352).
 *
 * An empty list in another locale is an answer: that locale publishes
 * nothing, as `nl` and `th` do. The same went for a collection page without
 * its `collection`: its TOC was cached as 0 entries for 7 days, with no
 * error.
 *
 * Each case runs for each way a page can fail. `503` is the control: the
 * reader has always reported it, and the others now read the same.
 */

import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { registerGetTocTool } from '../../../src/core/tools/get-toc.js';
import { registerListProductsTool } from '../../../src/core/tools/list-products.js';
import { STATIC_DOC_SOURCES, canonicalStaticUrl } from '../../../src/core/constants/sources.js';
import { cacheKey } from '../../../src/core/services/cache-key.js';
import { createMockContext, createStubMapsRegistry } from '../../helpers/mock-context.js';
import type { ServerContext } from '../../../src/core/types/context.js';
import type { Logger } from '../../../src/core/services/interfaces/index.js';
import type { SupportCollectionFixture } from '../../fixtures/support-collections-by-locale.js';
import {
  COLLECTION_FAILURES,
  HOME_FAILURES,
  UNREADABLE_HOMES,
  collectionIn,
  createSupportUpstream,
  homeUrl,
  listedUrl,
  type HomeFailure,
} from '../../helpers/support-upstream.js';

interface TextContent { type: 'text'; text: string }

interface CallResult {
  isError?: boolean;
  content: unknown[];
  structuredContent?: Record<string, unknown>;
}

interface Incomplete { unavailable: string[]; message: string }

const SUPPORT = STATIC_DOC_SOURCES['jamf-support'];
const JAMF_PRO = '12369024';

const upstream = createSupportUpstream();

let ctx: ServerContext;
let server: McpServer;
let client: Client;

beforeAll(async () => {
  // One context for the whole suite, as a running server has: what one call
  // caches, the next one reads. That is the point here.
  ctx = createMockContext({ http: upstream.http, mapsRegistry: createStubMapsRegistry([]) });
  server = new McpServer({ name: 'test', version: '0.0.1' });
  registerGetTocTool(server, ctx);
  registerListProductsTool(server, ctx);

  client = new Client({ name: 'test-client', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  // The client checks structuredContent against each published outputSchema
  // only for the tools it has listed.
  await client.listTools();
});

afterAll(async () => {
  await client.close();
  await server.close();
});

beforeEach(async () => {
  await ctx.cache.clear();
  upstream.reset();
  vi.mocked(ctx.cache.set).mockClear();
  vi.mocked(ctx.logger.createLogger).mockClear();
});

async function listProducts(): Promise<CallResult> {
  return await client.callTool({
    name: 'jamf_docs_list_products',
    arguments: { responseFormat: 'json' },
  }) as CallResult;
}

async function getToc(publication: string, language: string): Promise<CallResult> {
  return await client.callTool({
    name: 'jamf_docs_get_toc',
    arguments: { publication, language, responseFormat: 'json' },
  }) as CallResult;
}

function textOf(result: CallResult): string {
  return (result.content[0] as TextContent).text;
}

function supportIds(result: CallResult): string[] {
  return (result.structuredContent?.publications as { id: string }[])
    .map(p => p.id)
    .filter(id => id.startsWith('jamf-support-'));
}

function incompleteOf(result: CallResult): Incomplete | undefined {
  return result.structuredContent?.incomplete as Incomplete | undefined;
}

/** What `get_toc` lists for `code`'s own copy of a collection, with no note. */
function expectOwnEdition(result: CallResult, code: string, collection: SupportCollectionFixture): void {
  expect(result.isError, textOf(result)).not.toBe(true);
  const entries = result.structuredContent?.entries as { url: string }[];
  expect(entries.map(e => e.url)).toEqual([canonicalStaticUrl(SUPPORT, collection.first.url)]);
  expect(new URL(entries[0]?.url ?? '').pathname.split('/')[1]).toBe(code);
  expect(result.structuredContent?.localeNote).toBeUndefined();
}

/** The listing cache entries written, by the locale each names. */
function listingsCached(): string[] {
  return vi.mocked(ctx.cache.set).mock.calls
    .map(([key]) => key)
    .filter(key => key.startsWith('intercom-collections:'))
    .map(key => (JSON.parse(key.slice(key.indexOf('{'))) as { locale: string }).locale);
}

/** Every warning the server logged since the last `mockClear`, across its loggers. */
function warnings(): string[] {
  return vi.mocked(ctx.logger.createLogger).mock.results
    .flatMap(({ value }) => vi.mocked((value as Logger).warning).mock.calls)
    .map(([message]) => String(message));
}

describe('jamf_docs_list_products: the en home page lists no collections', () => {
  it.each(HOME_FAILURES)('%s: names jamf-support as unavailable instead of listing none of its sections unmarked', async (failure) => {
    upstream.failing.set('en', failure);

    const result = await listProducts();

    expect(result.isError, textOf(result)).not.toBe(true);
    expect(supportIds(result)).toEqual([]);
    const incomplete = incompleteOf(result);
    expect(incomplete?.unavailable).toEqual(['jamf-support']);
    expect(incomplete?.message).toContain(
      `The ${SUPPORT.name} on ${SUPPORT.hostname} could not be read, so the publication list ` +
      'has none of its sections (`jamf-support-*`).',
    );
    expect((JSON.parse(textOf(result)) as { incomplete?: Incomplete }).incomplete).toEqual(incomplete);
  });

  it.each(HOME_FAILURES)('%s: caches nothing for the page, so the next call lists the sections once it answers', async (failure) => {
    upstream.failing.set('en', failure);
    await listProducts();
    expect(listingsCached()).not.toContain('en');

    upstream.failing.clear();
    const recovered = await listProducts();

    expect(supportIds(recovered)).toHaveLength(9);
    expect(recovered.structuredContent).not.toHaveProperty('incomplete');
  });

  it('reads an empty listing an earlier build cached as a miss', async () => {
    // What a build before this one left behind for such a page, for
    // `cacheTtl.products`. Served as it stands, it would go on hiding every
    // section after an upgrade.
    await ctx.cache.set(cacheKey('intercom-collections', { source: SUPPORT.id, locale: 'en' }), []);

    const result = await listProducts();

    expect(supportIds(result)).toHaveLength(9);
    expect(upstream.requests).toContain(homeUrl('en'));
  });
});

describe('jamf_docs_get_toc: the requested locale\'s home page lists no collections', () => {
  it.each(HOME_FAILURES)('%s: an en-US request is an error naming the page, not "publishes nothing"', async (failure) => {
    upstream.failing.set('en', failure);

    const result = await getToc('jamf-support-jamf-pro', 'en-US');

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain(homeUrl('en'));
    expect(textOf(result)).not.toContain('publishes nothing');
  });

  it.each(UNREADABLE_HOMES)('%s: a ja-JP request is an error, not the en-US edition "because Jamf does not publish it in ja-JP"', async (failure) => {
    upstream.failing.set('ja', failure);

    const result = await getToc('jamf-support-jamf-pro', 'ja-JP');

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain(homeUrl('ja'));
    expect(textOf(result)).not.toContain('does not publish');
  });

  it.each(UNREADABLE_HOMES)('%s: serves the locale\'s own edition on the next call once the page answers', async (failure) => {
    upstream.failing.set('ja', failure);
    await getToc('jamf-support-jamf-pro', 'ja-JP');

    upstream.failing.clear();

    expectOwnEdition(await getToc('jamf-support-jamf-pro', 'ja-JP'), 'ja', collectionIn('ja', JAMF_PRO)!);
  });

  it('empty: serves a ja-JP request the en-US edition, since ja publishes nothing, and keeps that answer', async () => {
    // What support.jamf.com serves for `nl` and `th`. A locale that listed
    // nothing would be read this way until `locales` in sources.ts dropped
    // it, where taking the page as unreadable would fail every call.
    upstream.failing.set('ja', 'empty');

    const first = await getToc('jamf-support-jamf-pro', 'ja-JP');
    expect(first.isError, textOf(first)).not.toBe(true);
    expect((first.structuredContent?.entries as { url: string }[]).map(e => e.url))
      .toEqual([canonicalStaticUrl(SUPPORT, collectionIn('en', JAMF_PRO)!.first.url)]);
    expect(first.structuredContent?.localeNote)
      .toBe('Jamf does not publish this document in ja-JP. Showing the en-US edition instead.');
    expect(listingsCached()).toContain('ja');

    upstream.requests.length = 0;
    const second = await getToc('jamf-support-jamf-pro', 'ja-JP');
    expect(second.structuredContent).toEqual(first.structuredContent);
    expect(upstream.requests).toEqual([]);
  });
});

describe('jamf_docs_get_toc: the en home page lists no collections, asked in another locale', () => {
  it.each(HOME_FAILURES)('%s: reads ids from the locale\'s own listing and logs why, each call', async (failure: HomeFailure) => {
    upstream.failing.set('en', failure);

    expectOwnEdition(await getToc('jamf-support-jamf-pro', 'ja-JP'), 'ja', collectionIn('ja', JAMF_PRO)!);
    expectOwnEdition(await getToc('jamf-support-jamf-pro-相關', 'zh-TW'), 'zh-TW', collectionIn('zh-TW', JAMF_PRO)!);

    // One warning per call: the en page is asked for again each time, since
    // what could not be read was not cached.
    const logged = warnings();
    expect(logged).toHaveLength(2);
    for (const message of logged) {
      expect(message).toContain(`Could not list ${SUPPORT.name} collections in en`);
      expect(message).toContain(homeUrl('en'));
    }
    expect(upstream.requests.filter(url => url === homeUrl('en'))).toHaveLength(2);
  });

  it.each(HOME_FAILURES)('%s: takes list_products\' zh-TW id for Jamf Pro again once the page answers', async (failure) => {
    upstream.failing.set('en', failure);
    const down = await getToc('jamf-support-jamf-pro', 'zh-TW');
    expect(down.isError).toBe(true);
    expect(textOf(down)).toContain('Unknown Jamf Support Knowledge Base collection');

    upstream.failing.clear();

    expectOwnEdition(await getToc('jamf-support-jamf-pro', 'zh-TW'), 'zh-TW', collectionIn('zh-TW', JAMF_PRO)!);
  });
});

describe('jamf_docs_get_toc: a collection page without its data', () => {
  const EN_PRO = collectionIn('en', JAMF_PRO)!;
  const SCHOOL = '12379841';

  it.each(COLLECTION_FAILURES)('%s: is an error naming the page, not a TOC of 0 entries', async (failure) => {
    upstream.failingCollections.set(`en/${JAMF_PRO}`, failure);

    const result = await getToc('jamf-support-jamf-pro', 'en-US');

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain(canonicalStaticUrl(SUPPORT, listedUrl('en', EN_PRO)));
  });

  it.each(COLLECTION_FAILURES)('%s: caches nothing, so the next call lists the tree once the page answers', async (failure) => {
    upstream.failingCollections.set(`en/${JAMF_PRO}`, failure);
    await getToc('jamf-support-jamf-pro', 'en-US');
    expect(vi.mocked(ctx.cache.set).mock.calls.map(([key]) => key)
      .filter(key => key.startsWith('intercom-collection-toc'))).toEqual([]);

    upstream.failingCollections.clear();

    expectOwnEdition(await getToc('jamf-support-jamf-pro', 'en-US'), 'en', EN_PRO);
  });

  it('fails an en-only collection in another locale too, rather than serving it empty there', async () => {
    // #352 serves the en-US edition where a locale has none, so one such en
    // page emptied Jamf School's TOC in all six locales, for 7 days.
    upstream.failingCollections.set(`en/${SCHOOL}`, 'no-next-data');

    for (const language of ['en-US', 'ja-JP', 'zh-TW']) {
      const result = await getToc('jamf-support-jamf-school', language);
      expect(result.isError, language).toBe(true);
      expect(textOf(result)).toBe(
        'Error fetching table of contents: Could not read the Jamf Support Knowledge Base collection at ' +
        `${canonicalStaticUrl(SUPPORT, listedUrl('en', collectionIn('en', SCHOOL)!))}: the page carries no collection.`,
      );
    }
  });

  it('reads an empty tree an earlier build cached as a miss', async () => {
    // What a build before this one left behind for such a page, for
    // `cacheTtl.products`.
    const url = canonicalStaticUrl(SUPPORT, listedUrl('en', EN_PRO));
    await ctx.cache.set(cacheKey('intercom-collection-toc-v3', { source: SUPPORT.id, url }), []);

    expectOwnEdition(await getToc('jamf-support-jamf-pro', 'en-US'), 'en', EN_PRO);
    expect(upstream.requests).toContain(url);
  });
});
