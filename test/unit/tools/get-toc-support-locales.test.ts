/**
 * What `jamf_docs_get_toc` serves for a support.jamf.com collection in each of
 * the six languages that site publishes: the registered tools over MCP, with
 * the real Intercom reader and cache keys, and only the http client stubbed
 * with the collections each locale's home page listed live on 2026-09-28.
 *
 * Intercom gives a collection one id in every locale: Jamf Pro is 12369024 in
 * all six. The collection TOC cache was keyed on that id and the source, and
 * not on the locale, so whichever language asked first was served to every
 * other one for `cacheTtl.products` (7 days by default). Live on 2026-09-28,
 * `jamf-support-jamf-pro` in ja-JP after en-US listed the 384 English entries
 * under `/en/` URLs, and en-US after ja-JP listed the 7 Japanese ones.
 *
 * A collection's slug is the locale's own, though, and a publication id is
 * built from one. `jamf_docs_list_products` names each collection by its en
 * slug, and `get_toc` looked that id up among the requested locale's slugs, so
 * 5 of the 22 collections the six locales publish could not be reached by the
 * id `list_products` gives them: Jamf Pro and Jamf Account in zh-TW (slugged
 * `jamf-pro-相關` and `jamf-帳號` there), and Jamf Connect for macOS in fr, de
 * and es (`jamf-connect-pour-macos`, `-fur-`, `-para-`).
 *
 * `list_products` offers each of its 9 ids in all six locales, and 32 of those
 * 54 pairs have no translation upstream. Those were "Unknown collection" too;
 * they now get the en-US edition with a `localeNote`, as an untranslated
 * Fluid Topics publication does.
 */

import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { registerGetTocTool } from '../../../src/core/tools/get-toc.js';
import { registerListProductsTool } from '../../../src/core/tools/list-products.js';
import { STATIC_DOC_SOURCES, canonicalStaticUrl, dynamicSectionId } from '../../../src/core/constants/sources.js';
import type { CacheKey } from '../../../src/core/services/cache-key.js';
import { HttpError, type HttpClient } from '../../../src/core/http-client.js';
import { createMockContext, createStubMapsRegistry } from '../../helpers/mock-context.js';
import type { ServerContext } from '../../../src/core/types/context.js';
import type { Logger } from '../../../src/core/services/interfaces/index.js';
import {
  SUPPORT_COLLECTIONS_BY_LOCALE,
  type SupportCollectionFixture,
} from '../../fixtures/support-collections-by-locale.js';

interface TextContent { type: 'text'; text: string }

interface TocEntry { title: string; url: string; depth: number }

interface CallResult {
  isError?: boolean;
  content: unknown[];
  structuredContent?: Record<string, unknown>;
}

const SUPPORT = STATIC_DOC_SOURCES['jamf-support'];
const ORIGIN = SUPPORT.baseUrl;

/** This server's locale ids, each with support.jamf.com's own code for it. */
const LOCALES = Object.entries(SUPPORT.locales);

const JAMF_PRO = '12369024';

/** A page carrying `pageProps` the way Intercom's Next.js pages do. */
function page(pageProps: unknown): string {
  return `<html><body><script id="__NEXT_DATA__" type="application/json" nonce="n">${
    JSON.stringify({ props: { pageProps } })}</script></body></html>`;
}

/** A collection's URL as its locale's home page lists it: the slug raw. */
function listedUrl(code: string, collection: SupportCollectionFixture): string {
  return `${ORIGIN}/${code}/collections/${collection.id}-${collection.slug}`;
}

/**
 * Listings a test serves in place of the live ones, by locale code. Only the
 * case that no live listing has sets one.
 */
let listingOverrides: Partial<Record<string, readonly SupportCollectionFixture[]>> = {};

function listingOf(code: string): readonly SupportCollectionFixture[] | undefined {
  return listingOverrides[code] ?? SUPPORT_COLLECTIONS_BY_LOCALE[code];
}

function collectionIn(code: string, id: string): SupportCollectionFixture | undefined {
  return listingOf(code)?.find(c => c.id === id);
}

/** Locale codes whose home page answers 503, as a site outage would. */
let unreadableHomes = new Set<string>();

/** The page for one locale's copy of a collection, holding its first entry. */
function collectionPage(collection: SupportCollectionFixture): string {
  const { kind, title, url } = collection.first;
  return page({
    collection: kind === 'article'
      ? { articleSummaries: [{ title, url }] }
      : { subcollections: [{ name: title, url, articleSummaries: [] }] },
  });
}

/** Every url requested, in order. */
const requests: string[] = [];

const http: HttpClient = {
  getText: async (url) => {
    requests.push(url);
    const segments = new URL(url).pathname.split('/').filter(Boolean);
    const [code = '', kind = '', leaf = ''] = segments;
    if (segments.length === 1 && unreadableHomes.has(code)) {
      throw new HttpError(503, 'Service Unavailable', url);
    }
    const listing = listingOf(code);
    if (listing !== undefined && segments.length === 1) {
      return await Promise.resolve(page({
        home: {
          collections: listing.map(c => ({
            id: c.id, slug: c.slug, name: c.name, description: '', url: listedUrl(code, c), articleCount: c.entries,
          })),
        },
      }));
    }
    const collection = kind === 'collections' ? collectionIn(code, leaf.split('-')[0] ?? '') : undefined;
    if (collection !== undefined) { return await Promise.resolve(collectionPage(collection)); }
    throw new HttpError(404, 'Not Found', url);
  },
  getJson: async (url) => await Promise.reject(new HttpError(404, 'Not Found', url)),
  postJson: async (url) => await Promise.reject(new HttpError(404, 'Not Found', url)),
};

let ctx: ServerContext;
let server: McpServer;
let client: Client;

beforeAll(async () => {
  // One context for the whole suite, as a running server has: what one call
  // caches, the next one reads.
  ctx = createMockContext({ http, mapsRegistry: createStubMapsRegistry([]) });
  server = new McpServer({ name: 'test', version: '0.0.1' });
  registerGetTocTool(server, ctx);
  registerListProductsTool(server, ctx);

  client = new Client({ name: 'test-client', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  await client.listTools();
});

afterAll(async () => {
  await client.close();
  await server.close();
});

beforeEach(async () => {
  await ctx.cache.clear();
  requests.length = 0;
  listingOverrides = {};
  unreadableHomes = new Set();
});

async function getToc(publication: string, language: string): Promise<CallResult> {
  return await client.callTool({
    name: 'jamf_docs_get_toc',
    arguments: { publication, language, responseFormat: 'json' },
  }) as CallResult;
}

function textOf(result: CallResult): string {
  return (result.content[0] as TextContent).text;
}

function entriesOf(result: CallResult): TocEntry[] {
  expect(result.isError, textOf(result)).not.toBe(true);
  return result.structuredContent?.entries as TocEntry[];
}

/** The id a locale's own home page gives a collection. */
function ownId(code: string, id: string): string {
  return dynamicSectionId(SUPPORT, collectionIn(code, id)?.slug ?? '');
}

/** What `get_toc` must list for `code`'s copy of a collection. */
function expectOwnEdition(result: CallResult, code: string, collection: SupportCollectionFixture): void {
  const entries = entriesOf(result);
  expect(entries.map(e => e.title)).toEqual([collection.first.title]);
  expect(entries.map(e => e.url)).toEqual([canonicalStaticUrl(SUPPORT, collection.first.url)]);
  expect(new URL(entries[0]?.url ?? '').pathname.split('/')[1]).toBe(code);
  expect(result.structuredContent?.product).toBe(`${SUPPORT.name}: ${collection.name}`);
}

/** The `localeNote` for an en-US edition served to `language`. */
function englishEditionNote(language: string): string {
  return `Jamf does not publish this document in ${language}. Showing the en-US edition instead.`;
}

/** The ids an error offers, each with whether it is marked as the en-US edition. */
function offeredIn(text: string): [string, boolean][] {
  return [...text.matchAll(/^- `([^`]+)`( \(en-US edition\))?$/gm)]
    .map((m): [string, boolean] => [m[1], m[2] === ' (en-US edition)']);
}

/** Every warning the server logged since the last `mockClear`, across its loggers. */
function warnings(): string[] {
  return vi.mocked(ctx.logger.createLogger).mock.results
    .flatMap(({ value }) => vi.mocked((value as Logger).warning).mock.calls)
    .map(([message]) => String(message));
}

/** Every ordered pair of distinct locales. */
const PAIRS = LOCALES.flatMap(first => LOCALES
  .filter(second => second !== first)
  .map(second => [first, second] as const));

describe('jamf_docs_get_toc: one support.jamf.com collection asked for in two languages', () => {
  it.each(PAIRS.map(([[a, codeA], [b, codeB]]) => [a, b, codeA, codeB]))(
    'serves %s its own Jamf Pro, then %s its own', async (first, second, codeA, codeB) => {
      // Each locale asks by the id its own home page gives the collection, so
      // nothing but the cache stands between it and its own edition.
      const a = await getToc(ownId(codeA, JAMF_PRO), first);
      const b = await getToc(ownId(codeB, JAMF_PRO), second);

      expectOwnEdition(a, codeA, collectionIn(codeA, JAMF_PRO)!);
      expectOwnEdition(b, codeB, collectionIn(codeB, JAMF_PRO)!);
    },
  );

  it('caches the two editions under two keys, each naming its own locale', async () => {
    vi.mocked(ctx.cache.set).mockClear();
    await getToc('jamf-support-jamf-pro', 'en-US');
    await getToc('jamf-support-jamf-pro', 'ja-JP');

    const tocKeys = vi.mocked(ctx.cache.set).mock.calls
      .map(([key]) => key)
      .filter(key => key.startsWith('intercom-collection-toc'));

    expect(tocKeys).toHaveLength(2);
    expect(new Set(tocKeys).size).toBe(2);
    expect(tocKeys[0]).toContain(`${ORIGIN}/en/collections/`);
    expect(tocKeys[1]).toContain(`${ORIGIN}/ja/collections/`);
  });

  it('never reads an entry cached under the old key, which held whichever language asked first', async () => {
    // What a build before this one left behind: the en-US tree under the one
    // key every locale shared. It is kept for `cacheTtl.products`, so without
    // a new namespace an upgrade would go on serving it to ja-JP.
    const english = collectionIn('en', JAMF_PRO)!;
    await ctx.cache.set(
      `intercom-collection-toc-v2:{"collection":"${JAMF_PRO}","source":"${SUPPORT.id}"}` as CacheKey,
      [{ title: english.first.title, url: english.first.url }],
    );

    expectOwnEdition(await getToc('jamf-support-jamf-pro', 'ja-JP'), 'ja', collectionIn('ja', JAMF_PRO)!);
  });
});

describe('jamf_docs_get_toc: the id jamf_docs_list_products gives a collection, in every language', () => {
  let listed: string[];

  beforeAll(async () => {
    await ctx.cache.clear();
    const result = await client.callTool({
      name: 'jamf_docs_list_products',
      arguments: { responseFormat: 'json' },
    }) as CallResult;
    const publications = result.structuredContent?.publications as { id: string }[];
    listed = publications.map(p => p.id).filter(id => id.startsWith('jamf-support-'));
  });

  it('lists one id per en collection, from its en slug', () => {
    expect(listed).toEqual((SUPPORT_COLLECTIONS_BY_LOCALE.en ?? []).map(c => dynamicSectionId(SUPPORT, c.slug)));
  });

  /** Intercom's id for the collection `list_products` names `publication`. */
  function idOf(publication: string): string {
    return (SUPPORT_COLLECTIONS_BY_LOCALE.en ?? []).find(c => dynamicSectionId(SUPPORT, c.slug) === publication)?.id ?? '';
  }

  const CASES = LOCALES.flatMap(([language, code]) =>
    (SUPPORT_COLLECTIONS_BY_LOCALE.en ?? []).map(c => [dynamicSectionId(SUPPORT, c.slug), language, code] as const));

  it.each(CASES)('%s in %s: its own edition where it has one, else the en-US edition with a note', async (publication, language, code) => {
    const result = await getToc(publication, language);
    const edition = collectionIn(code, idOf(publication));

    if (edition !== undefined) {
      expectOwnEdition(result, code, edition);
      expect(result.structuredContent?.localeNote).toBeUndefined();
      return;
    }
    expectOwnEdition(result, 'en', collectionIn('en', idOf(publication))!);
    expect(result.structuredContent?.localeNote).toBe(englishEditionNote(language));
    expect(result.structuredContent?.language).toBe(language);
  });

  it('serves the 22 editions upstream has as themselves, and the other 32 pairs in en-US', async () => {
    let own = 0;
    let english = 0;
    for (const [publication, language, code] of CASES) {
      await ctx.cache.clear();
      const result = await getToc(publication, language);
      const served = new URL(entriesOf(result)[0]?.url ?? '').pathname.split('/')[1];
      if (result.structuredContent?.localeNote === undefined) {
        own++;
        expect(served).toBe(code);
      } else {
        english++;
        expect(collectionIn(code, idOf(publication))).toBeUndefined();
        expect(served).toBe('en');
      }
    }
    expect(own).toBe(Object.values(SUPPORT_COLLECTIONS_BY_LOCALE).flat().length);
    expect([own, english]).toEqual([22, 32]);
  });

  it('says so in the markdown and in the JSON text, not only in structuredContent', async () => {
    const json = await getToc('jamf-support-jamf-school', 'ja-JP');
    expect((JSON.parse(textOf(json)) as { localeNote?: unknown }).localeNote).toBe(englishEditionNote('ja-JP'));

    const markdown = await client.callTool({
      name: 'jamf_docs_get_toc',
      arguments: { publication: 'jamf-support-jamf-school', language: 'ja-JP' },
    }) as CallResult;
    expect(markdown.isError, textOf(markdown)).not.toBe(true);
    expect(textOf(markdown)).toContain(`> **Language Note:** ${englishEditionNote('ja-JP')}`);
  });

  it.each([
    ['jamf-support-jamf-pro-相關', 'zh-TW', JAMF_PRO],
    ['jamf-support-jamf-帳號', 'zh-TW', '11814179'],
    ['jamf-support-jamf-connect-pour-macos', 'fr-FR', '12380144'],
    ['jamf-support-jamf-connect-fur-macos', 'de-DE', '12380144'],
    ['jamf-support-jamf-connect-para-macos', 'es-ES', '12380144'],
  ])('still takes %s, the id the %s home page gives it', async (publication, language, id) => {
    const code = SUPPORT.locales[language as keyof typeof SUPPORT.locales];
    expectOwnEdition(await getToc(publication, language), code, collectionIn(code, id)!);
  });

  it('names the collection list_products names, where another one\'s local slug spells the same', async () => {
    // No live listing does this. If fr ever slugged some other collection
    // `jamf-now`, `jamf-support-jamf-now` would still be Jamf Now, which fr
    // does not publish, so its en-US edition, and not that collection.
    const [jamfPro, ...rest] = SUPPORT_COLLECTIONS_BY_LOCALE.fr ?? [];
    listingOverrides = { fr: [{ ...jamfPro, slug: 'jamf-now' }, ...rest] };

    const result = await getToc('jamf-support-jamf-now', 'fr-FR');

    expectOwnEdition(result, 'en', collectionIn('en', '12369113')!);
    expect(result.structuredContent?.localeNote).toBe(englishEditionNote('fr-FR'));
  });

  it('offers list_products\' ids when no locale has the one asked for, the en-US editions marked', async () => {
    const result = await getToc('jamf-support-jamf-pro-docs', 'zh-TW');

    expect(result.isError).toBe(true);
    const text = textOf(result);
    expect(text).toContain('Unknown Jamf Support Knowledge Base collection: "jamf-support-jamf-pro-docs"');
    expect(offeredIn(text)).toEqual([
      ['jamf-support-jamf-pro', false],
      ['jamf-support-jamf-account', false],
      ['jamf-support-jamf-protect-macos-security-portal', true],
      ['jamf-support-jamf-security-cloud-portal', true],
      ['jamf-support-jamf-connect-for-macos', true],
      ['jamf-support-jamf-school', true],
      ['jamf-support-jamf-safe-internet', true],
      ['jamf-support-jamf-now', true],
      ['jamf-support-elevate', true],
    ]);
  });

  it('offers and serves a collection only the requested locale lists, by its own slug', async () => {
    // No live listing does this either: every locale's ids are en's, which
    // the contract tests check. list_products would give such a collection
    // no id, so the locale's slug is the only name it has.
    const jaOnly: SupportCollectionFixture = {
      id: '99999999', slug: 'jamf-ja-only', name: 'Jamf ja only', entries: 1,
      first: { kind: 'article', title: 'ja only', url: `${ORIGIN}/ja/articles/1-ja-only` },
    };
    listingOverrides = { ja: [...(SUPPORT_COLLECTIONS_BY_LOCALE.ja ?? []), jaOnly] };

    const unknown = await getToc('jamf-support-jamf-pro-docs', 'ja-JP');
    expect(offeredIn(textOf(unknown)).slice(0, 3)).toEqual([
      ['jamf-support-jamf-pro', false],
      ['jamf-support-jamf-account', false],
      ['jamf-support-jamf-ja-only', false],
    ]);
    expectOwnEdition(await getToc('jamf-support-jamf-ja-only', 'ja-JP'), 'ja', jaOnly);
  });

  it('says the locale publishes nothing when neither its listing nor en\'s has a collection', async () => {
    listingOverrides = { ja: [], en: [] };

    const result = await getToc('jamf-support-jamf-pro', 'ja-JP');

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      'Unknown Jamf Support Knowledge Base collection: "jamf-support-jamf-pro".\n\n' +
      'Jamf Support Knowledge Base publishes nothing in ja-JP.',
    );
  });
});

describe('jamf_docs_get_toc: what a support.jamf.com TOC requests', () => {
  /** The page `code`'s copy of a collection is read from. */
  function collectionUrl(code: string, id: string): string {
    return canonicalStaticUrl(SUPPORT, listedUrl(code, collectionIn(code, id)!));
  }

  it('asks nothing of another locale for an en-US TOC', async () => {
    const result = await getToc('jamf-support-jamf-pro', 'en-US');

    expect(result.isError, textOf(result)).not.toBe(true);
    expect(requests).toEqual([`${ORIGIN}/en/`, collectionUrl('en', JAMF_PRO)]);
  });

  it('reads the en home page for another locale\'s first TOC, and not again while it is cached', async () => {
    const ja = await getToc('jamf-support-jamf-pro', 'ja-JP');
    expect(ja.isError, textOf(ja)).not.toBe(true);
    expect(requests).toEqual([`${ORIGIN}/ja/`, `${ORIGIN}/en/`, collectionUrl('ja', JAMF_PRO)]);

    requests.length = 0;
    const fr = await getToc('jamf-support-jamf-account', 'fr-FR');
    expect(fr.isError, textOf(fr)).not.toBe(true);
    expect(requests).toEqual([`${ORIGIN}/fr/`, collectionUrl('fr', '11814179')]);
  });

  it('reads the en-US edition from the page an en-US TOC reads, and caches it for both', async () => {
    await getToc('jamf-support-jamf-school', 'ja-JP');
    expect(requests).toEqual([`${ORIGIN}/ja/`, `${ORIGIN}/en/`, collectionUrl('en', '12379841')]);

    requests.length = 0;
    const en = await getToc('jamf-support-jamf-school', 'en-US');
    expectOwnEdition(en, 'en', collectionIn('en', '12379841')!);
    expect(requests).toEqual([]);
  });
});

describe('jamf_docs_get_toc: support.jamf.com\'s en home page unreadable', () => {
  beforeEach(() => {
    unreadableHomes = new Set(['en']);
    vi.mocked(ctx.logger.createLogger).mockClear();
  });

  it('still serves an id the requested locale\'s own listing gives, and logs why it read no other', async () => {
    expectOwnEdition(await getToc('jamf-support-jamf-pro', 'ja-JP'), 'ja', collectionIn('ja', JAMF_PRO)!);
    expectOwnEdition(await getToc('jamf-support-jamf-pro-相關', 'zh-TW'), 'zh-TW', collectionIn('zh-TW', JAMF_PRO)!);

    const logged = warnings();
    expect(logged).toHaveLength(2);
    for (const message of logged) {
      expect(message).toContain('Could not list Jamf Support Knowledge Base collections in en');
      expect(message).toContain('503');
    }
  });

  it('answers an id only the en listing gives as unknown, offering the locale\'s own ids', async () => {
    const result = await getToc('jamf-support-jamf-pro', 'zh-TW');

    expect(result.isError).toBe(true);
    const text = textOf(result);
    expect(text).toContain('Unknown Jamf Support Knowledge Base collection: "jamf-support-jamf-pro"');
    expect(text).not.toContain(`${ORIGIN}/en/`);
    expect(offeredIn(text)).toEqual([['jamf-support-jamf-pro-相關', false], ['jamf-support-jamf-帳號', false]]);
  });
});
