/**
 * The `locales` `jamf_docs_list_products` gives each support.jamf.com
 * publication: the registered tools over MCP, with the real Intercom reader
 * and cache keys, and only the http client stubbed with the collections each
 * of the six locale home pages listed live on 2026-09-28.
 *
 * Until 2026-09-28 every `jamf-support-*` row carried the six locales the
 * source routes, which is the site's list and not the collection's. Only 22
 * of those 54 (collection, locale) pairs exist upstream: Jamf Pro and Jamf
 * Account in all six, Jamf Connect for macOS in en, fr, de and es, and the
 * other six collections in en alone. A Fluid Topics row's `locales` are the
 * languages Jamf publishes it in, and `get_toc` serves a missing locale the
 * en-US edition with a `localeNote` (#352), so a row listing zh-TW for Jamf
 * School said it has a zh-TW edition it does not have.
 *
 * Each row's locales are now the locales whose home page lists its
 * collection, by the Intercom id every locale shares. A home page that cannot
 * be read costs its locale in every row, and `incomplete` says so, as #345
 * made it say that a whole source could not be read. It is not asked for
 * again for a minute, so an outage does not cost five failing requests on
 * every call.
 */

import { vi, describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { registerGetTocTool } from '../../../src/core/tools/get-toc.js';
import { registerListProductsTool } from '../../../src/core/tools/list-products.js';
import { STATIC_DOC_SOURCES, canonicalStaticUrl, dynamicSectionId } from '../../../src/core/constants/sources.js';
import { createMockContext, createStubMapsRegistry } from '../../helpers/mock-context.js';
import type { ServerContext } from '../../../src/core/types/context.js';
import type { Logger } from '../../../src/core/services/interfaces/index.js';
import { SUPPORT_COLLECTIONS_BY_LOCALE } from '../../fixtures/support-collections-by-locale.js';
import {
  UNREADABLE_HOMES,
  collectionIn,
  createSupportUpstream,
  homeUrl,
  listedUrl,
} from '../../helpers/support-upstream.js';

interface TextContent { type: 'text'; text: string }

interface CallResult {
  isError?: boolean;
  content: unknown[];
  structuredContent?: Record<string, unknown>;
}

interface Incomplete { unavailable: string[]; message: string }

interface PublicationRow { id: string; title: string; locales: string[] }

const SUPPORT = STATIC_DOC_SOURCES['jamf-support'];

/** This server's locale ids, each with support.jamf.com's own code for it. */
const LOCALES = Object.entries(SUPPORT.locales);

const EN_COLLECTIONS = SUPPORT_COLLECTIONS_BY_LOCALE.en ?? [];

/** The locales whose home page lists collection `id`, as this server names them. */
function publishedIn(id: string): string[] {
  return LOCALES
    .filter(([, code]) => collectionIn(code, id) !== undefined)
    .map(([locale]) => locale)
    .sort();
}

const upstream = createSupportUpstream();

let ctx: ServerContext;
let server: McpServer;
let client: Client;

beforeAll(async () => {
  // One context for the whole suite, as a running server has: what one call
  // caches, the next one reads.
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
  vi.mocked(ctx.logger.createLogger).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Every home page but en's, as support.jamf.com names the locales. */
const OTHER_CODES = LOCALES.map(([, code]) => code).filter(code => code !== 'en');

/** Move the clock past the minute a listing that could not be read is remembered. */
function aMinuteLater(): void {
  const later = Date.now() + 61_000;
  vi.spyOn(Date, 'now').mockReturnValue(later);
}

async function listProducts(args: Record<string, unknown> = { responseFormat: 'json' }): Promise<CallResult> {
  return await client.callTool({ name: 'jamf_docs_list_products', arguments: args }) as CallResult;
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

function supportRows(result: CallResult): PublicationRow[] {
  expect(result.isError, textOf(result)).not.toBe(true);
  return (result.structuredContent?.publications as PublicationRow[])
    .filter(row => row.id.startsWith('jamf-support-'));
}

function incompleteOf(result: CallResult): Incomplete | undefined {
  return result.structuredContent?.incomplete as Incomplete | undefined;
}

/** Every warning the server logged since the last `mockClear`, across its loggers. */
function warnings(): string[] {
  return vi.mocked(ctx.logger.createLogger).mock.results
    .flatMap(({ value }) => vi.mocked((value as Logger).warning).mock.calls)
    .map(([message]) => String(message));
}

describe('jamf_docs_list_products: each support.jamf.com publication\'s locales', () => {
  it('are the locales whose home page lists its collection', async () => {
    const rows = supportRows(await listProducts());

    expect(rows.map(row => [row.id, row.locales])).toEqual(
      EN_COLLECTIONS.map(c => [dynamicSectionId(SUPPORT, c.slug), publishedIn(c.id)]),
    );
  });

  it('are 22 (publication, locale) pairs, the editions upstream has, and not 54', async () => {
    const rows = supportRows(await listProducts());
    const byId = new Map(rows.map(row => [row.id, row.locales]));

    expect(byId.get('jamf-support-jamf-pro')).toEqual(['de-DE', 'en-US', 'es-ES', 'fr-FR', 'ja-JP', 'zh-TW']);
    expect(byId.get('jamf-support-jamf-account')).toEqual(['de-DE', 'en-US', 'es-ES', 'fr-FR', 'ja-JP', 'zh-TW']);
    expect(byId.get('jamf-support-jamf-connect-for-macos')).toEqual(['de-DE', 'en-US', 'es-ES', 'fr-FR']);
    expect(byId.get('jamf-support-jamf-school')).toEqual(['en-US']);
    expect(rows.flatMap(row => row.locales)).toHaveLength(22);
    expect(rows.filter(row => row.locales.length === 1)).toHaveLength(6);
  });

  it('name exactly the locales get_toc serves an edition of their own', async () => {
    const rows = supportRows(await listProducts());

    for (const row of rows) {
      for (const [locale] of LOCALES) {
        const toc = await getToc(row.id, locale);
        expect(toc.isError, textOf(toc)).not.toBe(true);
        // No note means the locale's own edition; the note means en-US.
        expect(
          toc.structuredContent?.localeNote === undefined,
          `${row.id} in ${locale}`,
        ).toBe(row.locales.includes(locale));
      }
    }
  });

  it('mark the en-only publications "en-US only" in the markdown, as a Fluid Topics row is', async () => {
    const full = textOf(await listProducts({}));

    expect(full).toContain(`- **\`jamf-support-jamf-school\`**: ${SUPPORT.name}: Jamf School *(en-US only)*\n`);
    expect(full).toContain(`- **\`jamf-support-jamf-pro\`**: ${SUPPORT.name}: Jamf Pro\n`);
    expect(full).toContain(`- **\`jamf-support-jamf-connect-for-macos\`**: ${SUPPORT.name}: Jamf Connect for macOS\n`);
  });
});

describe('jamf_docs_list_products: what the support.jamf.com locales cost', () => {
  it('reads each locale\'s home page once on a cold call, en first, and nothing on the next', async () => {
    await listProducts();

    const homes = LOCALES.map(([, code]) => homeUrl(code));
    expect(upstream.requests[0]).toBe(homeUrl('en'));
    expect([...upstream.requests].sort()).toEqual([...homes].sort());

    upstream.requests.length = 0;
    await listProducts();
    expect(upstream.requests).toEqual([]);
  });

  it('shares those pages with get_toc, which then reads only the collection page', async () => {
    await listProducts();
    upstream.requests.length = 0;

    const toc = await getToc('jamf-support-jamf-pro', 'ja-JP');

    expect(toc.isError, textOf(toc)).not.toBe(true);
    expect(upstream.requests).toEqual([
      canonicalStaticUrl(SUPPORT, listedUrl('ja', collectionIn('ja', '12369024')!)),
    ]);
  });

  it('asks the maps registry beside the home pages, not after them', async () => {
    // The six pages are read in two rounds, en and then the other five, and
    // the registry's build waits on neither. A cold call waits on the slower
    // of the two, not on their sum.
    let requestedBefore = -1;
    vi.spyOn(ctx.mapsRegistry, 'listPublications').mockImplementationOnce(async () => {
      requestedBefore = upstream.requests.length;
      return await Promise.resolve([]);
    });

    await listProducts();

    expect(requestedBefore).toBe(0);
    expect(upstream.requests).toHaveLength(6);
  });

  it('reads no other locale when the en home page cannot be read', async () => {
    upstream.failing.set('en', '503');

    const result = await listProducts();

    expect(upstream.requests).toEqual([homeUrl('en')]);
    expect(supportRows(result)).toEqual([]);
    expect(incompleteOf(result)?.unavailable).toEqual(['jamf-support']);
  });

  it('asks each other page that cannot be read once a minute, not on every call, while en is cached', async () => {
    // en cached, then support.jamf.com down: each call would otherwise wait
    // on five failing requests, each up to the request timeout.
    await getToc('jamf-support-jamf-pro', 'en-US');
    for (const code of OTHER_CODES) { upstream.failing.set(code, '503'); }
    upstream.requests.length = 0;

    const first = await listProducts();
    expect([...upstream.requests].sort()).toEqual(OTHER_CODES.map(homeUrl).sort());

    upstream.requests.length = 0;
    const second = await listProducts();
    expect(upstream.requests).toEqual([]);
    // Still said: the pages have not been read.
    expect(incompleteOf(second)).toEqual(incompleteOf(first));
    expect(supportRows(second)).toEqual(supportRows(first));

    aMinuteLater();
    await listProducts();
    expect([...upstream.requests].sort()).toEqual(OTHER_CODES.map(homeUrl).sort());
  });
});

describe('jamf_docs_list_products: a home page other than en that cannot be read', () => {
  const FR_SENTENCE =
    `The ${SUPPORT.name} on ${SUPPORT.hostname} could not be read in fr-FR, so its sections ` +
    '(`jamf-support-*`) list no fr-FR edition in `locales`, whether or not they have one.';

  it.each(UNREADABLE_HOMES)('%s on fr: lists every section, without fr-FR, and says so', async (failure) => {
    upstream.failing.set('fr', failure);

    const result = await listProducts();

    const rows = supportRows(result);
    expect(rows.map(row => row.id)).toEqual(EN_COLLECTIONS.map(c => dynamicSectionId(SUPPORT, c.slug)));
    expect(rows.map(row => [row.id, row.locales])).toEqual(
      EN_COLLECTIONS.map(c => [
        dynamicSectionId(SUPPORT, c.slug),
        publishedIn(c.id).filter(locale => locale !== 'fr-FR'),
      ]),
    );

    const incomplete = incompleteOf(result);
    expect(incomplete?.unavailable).toEqual(['jamf-support']);
    expect(incomplete?.message).toContain(FR_SENTENCE);
    expect(incomplete?.message).not.toContain('has none of its sections');
    expect(incomplete?.message).toContain('try again in a minute');
    expect((JSON.parse(textOf(result)) as { incomplete?: Incomplete }).incomplete).toEqual(incomplete);

    const logged = warnings();
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain(`Could not list ${SUPPORT.name} collections in fr`);
  });

  it('says so at the top of the markdown, and still calls the list every document', async () => {
    upstream.failing.set('fr', 'no-next-data');

    const full = textOf(await listProducts({}));

    expect(full.startsWith(`# Jamf Documentation Products\n\n> **This catalogue is incomplete.** ${FR_SENTENCE}`)).toBe(true);
    // Every document is listed; only which languages some are in is not known.
    expect(full).toContain('Every document Jamf publishes');
  });

  it('names each locale it could not read, in the order the source declares them', async () => {
    upstream.failing.set('ja', '503');
    upstream.failing.set('fr', 'no-home');

    const incomplete = incompleteOf(await listProducts());

    expect(incomplete?.unavailable).toEqual(['jamf-support']);
    expect(incomplete?.message).toContain('could not be read in fr-FR and ja-JP, so');
    expect(incomplete?.message).toContain('list no fr-FR or ja-JP edition in `locales`');
  });

  it('names five the same way, and calls no section "en-US only" when it cannot know', async () => {
    for (const code of OTHER_CODES) { upstream.failing.set(code, '503'); }

    const full = textOf(await listProducts({}));

    expect(full).toContain(
      `> **This catalogue is incomplete.** The ${SUPPORT.name} on ${SUPPORT.hostname} could not be read in ` +
      'de-DE, es-ES, fr-FR, ja-JP and zh-TW, so its sections (`jamf-support-*`) list no ' +
      'de-DE, es-ES, fr-FR, ja-JP or zh-TW edition in `locales`, whether or not they have one.',
    );
    // Jamf Pro is in all six and Jamf School in en alone, but with the other
    // five unread the two cannot be told apart, so neither is marked.
    expect(full).toContain(`- **\`jamf-support-jamf-pro\`**: ${SUPPORT.name}: Jamf Pro\n`);
    expect(full).toContain(`- **\`jamf-support-jamf-school\`**: ${SUPPORT.name}: Jamf School\n`);
    expect(full).not.toMatch(/jamf-support-[^\n]*en-US only/);
  });

  it('marks the en-only sections again once every page is read', async () => {
    upstream.failing.set('fr', '503');
    expect(textOf(await listProducts({}))).not.toContain('*(en-US only)*');

    upstream.failing.clear();
    aMinuteLater();

    expect(textOf(await listProducts({})))
      .toContain(`- **\`jamf-support-jamf-school\`**: ${SUPPORT.name}: Jamf School *(en-US only)*\n`);
  });

  it('caches nothing for the page, so fr-FR is listed again once it answers, a minute later at most', async () => {
    upstream.failing.set('fr', 'no-next-data');
    await listProducts();

    upstream.failing.clear();
    upstream.requests.length = 0;
    const within = await listProducts();
    expect(upstream.requests).toEqual([]);
    expect(incompleteOf(within)?.unavailable).toEqual(['jamf-support']);

    aMinuteLater();
    const recovered = await listProducts();

    expect(upstream.requests).toEqual([homeUrl('fr')]);
    expect(supportRows(recovered).find(row => row.id === 'jamf-support-jamf-pro')?.locales).toContain('fr-FR');
    expect(recovered.structuredContent).not.toHaveProperty('incomplete');
  });

  it('takes a page get_toc has read since it failed, without waiting out the minute', async () => {
    upstream.failing.set('fr', '503');
    await listProducts();

    // get_toc does not remember a failure: a call in fr-FR asks for the page.
    upstream.failing.clear();
    const toc = await getToc('jamf-support-jamf-pro', 'fr-FR');
    expect(toc.isError, textOf(toc)).not.toBe(true);

    upstream.requests.length = 0;
    const result = await listProducts();

    expect(upstream.requests).toEqual([]);
    expect(supportRows(result).find(row => row.id === 'jamf-support-jamf-pro')?.locales).toContain('fr-FR');
    expect(result.structuredContent).not.toHaveProperty('incomplete');
  });
});

describe('jamf_docs_list_products: a home page other than en that lists no collections', () => {
  it('takes it as the locale publishing nothing, says nothing is missing, and keeps the answer', async () => {
    // What support.jamf.com serves for `nl` and `th`, which it routes and
    // does not publish in.
    upstream.failing.set('fr', 'empty');

    const result = await listProducts();

    expect(supportRows(result).map(row => [row.id, row.locales])).toEqual(
      EN_COLLECTIONS.map(c => [
        dynamicSectionId(SUPPORT, c.slug),
        publishedIn(c.id).filter(locale => locale !== 'fr-FR'),
      ]),
    );
    expect(result.structuredContent).not.toHaveProperty('incomplete');
    expect(warnings()).toEqual([]);

    upstream.requests.length = 0;
    await listProducts();
    expect(upstream.requests).toEqual([]);
  });
});
