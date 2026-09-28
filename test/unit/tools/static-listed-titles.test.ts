/**
 * The titles `jamf_docs_search` and `jamf_docs_get_toc` give the pages of
 * support.jamf.com and concepts.jamf.com: the registered tools over MCP, with
 * the real readers and cache keys and only the http client stubbed, serving
 * what the sites listed on 2026-09-28.
 *
 * A sitemap names each page and not its title, so until 2026-09-28 both tools
 * made every title from a URL slug. A slug loses a title's case and accents,
 * and concepts.jamf.com keeps its en slugs in every locale while it
 * translates the titles. So a de-DE search listed "Self Service Muss Mit Dem
 * Jamf Server Verknupft Sein" for Intercom's "Self Service muss mit dem
 * Jamf-Server verknüpft sein", a ja-JP table of contents listed "Threat and
 * Risk Management" for 脅威とリスク管理, and no Japanese query could find that
 * page. Of the titles the two sources' search indexes hold in the eight
 * locales, 1,558 could be checked against the page's own (all but the 80
 * category pages of the five locales whose category pages were not read):
 * 528 were the page's title, and 1,544 are now. The other 14 are category
 * pages the guides index links by a name other than their own title. Each
 * site lists its pages' titles on a few pages per locale, which these tools
 * now read: support.jamf.com's collection pages, which `get_toc` already
 * read, and concepts.jamf.com's two section index pages. The guides index
 * also gives the order the site's sidebar lists the guides in, which
 * `get_toc` follows since the same day, where it went by slug.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { registerSearchTool } from '../../../src/core/tools/search.js';
import { registerGetTocTool } from '../../../src/core/tools/get-toc.js';
import { STATIC_DOC_SOURCES, canonicalStaticUrl, type StaticDocSource } from '../../../src/core/constants/sources.js';
import { HttpError, type HttpClient } from '../../../src/core/http-client.js';
import { createMockContext, createStubMapsRegistry } from '../../helpers/mock-context.js';
import type { ServerContext } from '../../../src/core/types/context.js';
import { nextDataPage } from '../../helpers/support-upstream.js';
import { conceptsIndexPages, conceptsIndexUrl, listedPaths } from '../../helpers/concepts-index-pages.js';
import { CONCEPTS_LISTINGS } from '../../fixtures/concepts-listings.js';

interface CallResult {
  isError?: boolean;
  content: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
}

interface Hit { title: string; url: string; source: string }

const SUPPORT = STATIC_DOC_SOURCES['jamf-support'];
const CONCEPTS = STATIC_DOC_SOURCES['jamf-concepts'];
const MINUTE = 60 * 1000;

/** One support.jamf.com article, as a collection page lists it. */
interface Article { url: string; title: string }

/**
 * Live articles, each in the collection it is listed in, by locale code.
 * Each is in a subcollection, as on the live pages.
 */
const SUPPORT_COLLECTIONS: Record<string, { id: string; slug: string; articles: Article[] }[]> = {
  en: [
    {
      id: '12369024', slug: 'jamf-pro', articles: [{
        url: 'https://support.jamf.com/en/articles/10631329-self-service-must-be-associated-with-jamf-server',
        title: 'Self Service must be associated with Jamf Server',
      }],
    },
    {
      id: '12380144', slug: 'jamf-connect-for-macos', articles: [{
        url: 'https://support.jamf.com/en/articles/11003436-how-to-determine-if-an-idp-is-configured-to-use-ropg',
        title: 'How to determine if an IdP is configured to use ROPG',
      }],
    },
  ],
  de: [{
    id: '12369024', slug: 'jamf-pro', articles: [{
      url: 'https://support.jamf.com/de/articles/10631329-self-service-muss-mit-dem-jamf-server-verknupft-sein',
      title: 'Self Service muss mit dem Jamf-Server verknüpft sein',
    }],
  }],
  fr: [
    {
      id: '12369024', slug: 'jamf-pro', articles: [{
        url: 'https://support.jamf.com/fr/articles/10631329-self-service-doit-etre-associe-au-serveur-jamf',
        title: 'Self Service doit être associé au serveur Jamf',
      }],
    },
    {
      id: '12380144', slug: 'jamf-connect-pour-macos', articles: [{
        url: 'https://support.jamf.com/fr/articles/11003438-mettre-a-jour-la-licence-jamf-connect-apres-le-renouvellement',
        title: 'Mettre à jour la licence Jamf Connect après le renouvellement',
      }],
    },
  ],
  ja: [{
    id: '12369024', slug: 'jamf-pro', articles: [{
      url: 'https://support.jamf.com/ja/articles/10631329-self-service-は-jamf-サーバーに関連付けられている必要があります',
      title: 'Self Service は Jamf サーバーに関連付けられている必要があります',
    }],
  }],
};

const collectionUrl = (code: string, id: string, slug: string): string =>
  `${SUPPORT.baseUrl}/${code}/collections/${id}-${slug}`;

function sitemap(locs: string[]): string {
  return `<urlset>${locs.map(loc => `<url><loc>${loc}</loc></url>`).join('')}</urlset>`;
}

/** Every page served, by the URL the readers request it at. */
function livePages(): Map<string, string> {
  const pages = conceptsIndexPages();
  pages.set(`${CONCEPTS.baseUrl}/sitemap.xml`, sitemap(['en', 'ja', 'fr'].flatMap(code => [
    `${CONCEPTS.baseUrl}/${code}/guides`,
    `${CONCEPTS.baseUrl}/${code}/concepts`,
    ...listedPaths(code as 'en' | 'ja' | 'fr').map(path => `${CONCEPTS.baseUrl}/${code}/${path}`),
  ])));
  pages.set(`${SUPPORT.baseUrl}/sitemap.xml`, sitemap(Object.values(SUPPORT_COLLECTIONS)
    .flatMap(collections => collections.flatMap(collection => collection.articles.map(a => a.url)))));
  for (const [code, collections] of Object.entries(SUPPORT_COLLECTIONS)) {
    pages.set(`${SUPPORT.baseUrl}/${code}/`, nextDataPage({
      home: {
        collections: collections.map(({ id, slug, articles }) => ({
          id, slug, name: slug, description: '', url: collectionUrl(code, id, slug), articleCount: articles.length,
        })),
      },
    }));
    for (const { id, slug, articles } of collections) {
      pages.set(canonicalStaticUrl(SUPPORT, collectionUrl(code, id, slug)), nextDataPage({
        collection: {
          articleSummaries: [],
          subcollections: [{ name: 'Self Service', url: collectionUrl(code, '12380114', 'self-service'), articleSummaries: articles }],
        },
      }));
    }
  }
  return pages;
}

const pages = livePages();
/** URLs that answer 503, whatever `pages` holds for them. */
const failing = new Set<string>();
/** Every page requested, in order. */
const requests: string[] = [];
/** What a request waits on before it is answered, when a case sets it. */
let before: ((url: string) => Promise<void>) | undefined;

const http: HttpClient = {
  getText: async (url) => {
    requests.push(url);
    if (before !== undefined) { await before(url); }
    const page = pages.get(url);
    if (failing.has(url)) { throw new HttpError(503, 'Service Unavailable', url); }
    if (page === undefined) { throw new HttpError(404, 'Not Found', url); }
    return await Promise.resolve(page);
  },
  getJson: async (url) => await Promise.reject(new HttpError(404, 'Not Found', url)),
  postJson: async (url) => await Promise.reject(new HttpError(404, 'Not Found', url)),
};

let ctx: ServerContext;
let server: McpServer;
let client: Client;

beforeAll(async () => {
  ctx = createMockContext({
    http,
    mapsRegistry: createStubMapsRegistry(),
    // One Fluid Topics hit, so a search reaches its normal reply.
    searchProvider: {
      search: async () => await Promise.resolve([{
        title: 'Self Service',
        snippet: 'Self Service.',
        product: 'Jamf Pro',
        url: 'https://learn.jamf.com/r/en-US/jamf-pro-documentation/Self_Service',
      }]),
    },
  });
  server = new McpServer({ name: 'test-server', version: '0.0.1' });
  registerSearchTool(server, ctx);
  registerGetTocTool(server, ctx);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test-client', version: '0.0.1' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  // Listing the tools first makes the client check each `structuredContent`
  // against the published outputSchema.
  await client.listTools();
});

afterAll(async () => {
  await client.close();
  await server.close();
});

beforeEach(async () => {
  await ctx.cache.clear();
  vi.mocked(ctx.cache.set).mockClear();
  failing.clear();
  requests.length = 0;
  before = undefined;
});

afterEach(() => { vi.useRealTimers(); });

async function call(name: string, args: Record<string, unknown>): Promise<CallResult> {
  const result = await client.callTool({ name, arguments: args }) as CallResult;
  expect(result.isError, result.content[0]?.text).not.toBe(true);
  return result;
}

/** The other-source matches `jamf_docs_search` reports from `source`. */
async function hits(query: string, language: string, source: StaticDocSource = SUPPORT): Promise<Hit[]> {
  const result = await call('jamf_docs_search', { query, language });
  return ((result.structuredContent?.otherSources ?? []) as Hit[]).filter(hit => hit.source === source.name);
}

/** Every title in a table of contents, over all its pages, depth first. */
async function tocTitles(publication: string, language: string): Promise<string[]> {
  const titles: string[] = [];
  const walk = (entries: { title: string; children?: unknown[] }[]): void => {
    for (const entry of entries) {
      titles.push(entry.title);
      walk((entry.children ?? []) as { title: string; children?: unknown[] }[]);
    }
  };
  for (let page = 1; ; page++) {
    const result = await call('jamf_docs_get_toc', { publication, language, page, maxTokens: 50000 });
    walk(result.structuredContent?.entries as { title: string }[]);
    if (result.structuredContent?.hasMore !== true) { return titles; }
  }
}

/** The titles of a table of contents' top-level entries, over all its pages, in order. */
async function topLevelTitles(publication: string, language: string): Promise<string[]> {
  const titles: string[] = [];
  for (let page = 1; ; page++) {
    const result = await call('jamf_docs_get_toc', { publication, language, page, maxTokens: 50000 });
    titles.push(...(result.structuredContent?.entries as { title: string; depth: number }[])
      .filter(entry => entry.depth === 0).map(entry => entry.title));
    if (result.structuredContent?.hasMore !== true) { return titles; }
  }
}

describe('jamf_docs_search: support.jamf.com\'s articles', () => {
  it('are titled as Intercom\'s collection pages list them, accents and case', async () => {
    expect((await hits('verknüpft', 'de-DE')).map(hit => hit.title))
      .toEqual(['Self Service muss mit dem Jamf-Server verknüpft sein']);
    expect((await hits('Mettre à jour la licence', 'fr-FR')).map(hit => hit.title))
      .toContain('Mettre à jour la licence Jamf Connect après le renouvellement');
    expect((await hits('determine if an IdP', 'en-US')).map(hit => hit.title))
      .toEqual(['How to determine if an IdP is configured to use ROPG']);
  });

  it('keep the URL get_toc and get_article report', async () => {
    expect((await hits('verknüpft', 'de-DE')).map(hit => hit.url)).toEqual([canonicalStaticUrl(SUPPORT,
      'https://support.jamf.com/de/articles/10631329-self-service-muss-mit-dem-jamf-server-verknupft-sein')]);
  });

  it('are written into the Markdown reply by the same title', async () => {
    const result = await call('jamf_docs_search', { query: 'verknüpft', language: 'de-DE' });

    expect(result.content[0]?.text).toContain('[Self Service muss mit dem Jamf-Server verknüpft sein](');
    expect(result.content[0]?.text).not.toContain('Verknupft');
  });

  it('are found by the words of their slug too', async () => {
    // Without the accent, as the slug spells it.
    expect((await hits('verknupft', 'de-DE')).map(hit => hit.title))
      .toEqual(['Self Service muss mit dem Jamf-Server verknüpft sein']);
  });

  it('carry their title, URL and source, and not the slug\'s title, in both JSON channels', async () => {
    // The index holds each page's slug title beside its listed one, and a
    // match on it is found. It is not a title the page is shown by.
    const markdown = await call('jamf_docs_search', { query: 'verknupft', language: 'de-DE' });
    const json = await call('jamf_docs_search', { query: 'verknupft', language: 'de-DE', responseFormat: 'json' });
    const body = JSON.parse(json.content[0]?.text ?? '{}') as { otherSources?: Record<string, unknown>[] };

    for (const otherSources of [
      markdown.structuredContent?.otherSources,
      json.structuredContent?.otherSources,
      body.otherSources,
    ] as Record<string, unknown>[][]) {
      expect(otherSources.length).toBeGreaterThan(0);
      for (const hit of otherSources) { expect(Object.keys(hit).sort()).toEqual(['source', 'title', 'url']); }
    }
  });
});

describe('jamf_docs_search: concepts.jamf.com\'s pages', () => {
  const THREAT = `${CONCEPTS.baseUrl}/ja/guides/threat-and-risk-management/`;

  it('are titled in the locale\'s language, so a query in it finds them', async () => {
    const found = await hits('脅威とリスク管理', 'ja-JP', CONCEPTS);

    expect(found[0]).toMatchObject({ title: '脅威とリスク管理', url: THREAT });
  });

  it('are still found by the English words of their slug, under the title the site gives them', async () => {
    const found = await hits('Threat and Risk Management', 'ja-JP', CONCEPTS);

    expect(found.find(hit => hit.url === THREAT)?.title).toBe('脅威とリスク管理');
    expect(found.map(hit => hit.title)).not.toContain('Threat and Risk Management');
  });

  it('are titled as the site titles them in en too', async () => {
    expect((await hits('API Utility', 'en-US', CONCEPTS))[0]?.title).toBe('API Utility');
  });
});

describe('jamf_docs_get_toc: concepts.jamf.com', () => {
  it('lists the guides by the titles the guides index gives them, in the locale\'s language', async () => {
    const ja = await tocTitles('jamf-concepts-guides', 'ja-JP');
    const fr = await tocTitles('jamf-concepts-guides', 'fr-FR');

    expect(ja).toEqual(expect.arrayContaining(['脅威とリスク管理', 'Android フル管理デバイス', '概要', 'SaaS テナンシー制御']));
    expect(ja).not.toContain('Threat and Risk Management');
    expect(fr).toEqual(expect.arrayContaining(['Gestion des menaces et des risques', 'IA']));
    expect(ja).toHaveLength(56);
  });

  it('lists the tools by the titles the tools index gives them', async () => {
    const en = await tocTitles('jamf-concepts-tools', 'en-US');

    expect(en).toEqual(expect.arrayContaining(['API Utility', 'RapidID MCP Server', 'Jamf Platform Go SDK']));
    expect(en).not.toContain('Apiutil');
  });

  it('lists the guides in the order the site\'s sidebar does, in every locale', async () => {
    // Until 2026-09-28 by slug: AI Governance first, and the overview between
    // Jamf for Mobile and Resource Access Control.
    expect(await topLevelTitles('jamf-concepts-guides', 'en-US')).toEqual([
      'Overview',
      'Device Trust Identity and Deployment',
      'Examples and Demos',
      'Getting Started with Jamf for Mac',
      'Infrastructure As Code',
      'IT Workflows',
      'Resource Access Control',
      'Threat and Risk Management',
      'Jamf for Mobile',
      'AI Governance',
    ]);
    const ja = await topLevelTitles('jamf-concepts-guides', 'ja-JP');
    expect(ja[0]).toBe('概要');
    expect(ja.at(-1)).toBe('AI Governance');
  });

  it('lists the tools by slug, as their index gives no order', async () => {
    // The index lists them by title: Jamf MCP Hub (`mcp-hub`) after Jamf
    // Extender, where by slug it follows JAWA.
    const bySlug = CONCEPTS_LISTINGS.en.concepts
      .filter(tool => tool.slug !== 'mut')
      .sort((a, b) => a.slug.localeCompare(b.slug))
      .map(tool => tool.title);

    expect(await topLevelTitles('jamf-concepts-tools', 'en-US')).toEqual(bySlug);
    expect(bySlug).not.toEqual(CONCEPTS_LISTINGS.en.concepts.filter(tool => tool.slug !== 'mut').map(tool => tool.title));
  });
});

describe('a listing that cannot be read', () => {
  it('costs its pages their titles, not the reply: they are titled from their slugs, in the slug\'s language', async () => {
    failing.add(`${SUPPORT.baseUrl}/fr/`);
    failing.add(conceptsIndexUrl('ja', 'guides'));

    // The French minor words, not the English ones: "la" and "le", not "La"
    // and "Le" beside an English "a".
    expect((await hits('Mettre a Jour', 'fr-FR')).map(hit => hit.title))
      .toContain('Mettre a Jour la Licence Jamf Connect Apres le Renouvellement');
    expect(await tocTitles('jamf-concepts-guides', 'ja-JP')).toContain('Threat and Risk Management');
    // And their order: by slug, as until 2026-09-28.
    expect((await topLevelTitles('jamf-concepts-guides', 'ja-JP')).slice(0, 2))
      .toEqual(['AI Governance', 'Device Trust Identity and Deployment']);
  });

  it('keeps a search index built without it for a minute, and the next one reads it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    failing.add(`${SUPPORT.baseUrl}/fr/`);

    await hits('Mettre a Jour', 'fr-FR');
    const written = vi.mocked(ctx.cache.set).mock.calls.filter(([key]) => key.startsWith('static-search-index-'));
    expect(written.map(([key, , ttl]) => [key.includes('"source":"jamf-support"'), ttl]))
      .toEqual(expect.arrayContaining([[true, MINUTE]]));

    failing.clear();
    vi.setSystemTime(Date.now() + MINUTE + 1);

    expect((await hits('Mettre à jour', 'fr-FR')).map(hit => hit.title))
      .toContain('Mettre à jour la licence Jamf Connect après le renouvellement');
  });
});

describe('the pages the titles are read from', () => {
  it('are requested once each by a cold search, and not again by the search or a table of contents after it', async () => {
    await hits('Self Service', 'fr-FR');
    const cold = [...requests].sort();

    expect(cold).toEqual([
      conceptsIndexUrl('fr', 'concepts'),
      conceptsIndexUrl('fr', 'guides'),
      `${CONCEPTS.baseUrl}/sitemap.xml`,
      `${SUPPORT.baseUrl}/fr/`,
      canonicalStaticUrl(SUPPORT, collectionUrl('fr', '12369024', 'jamf-pro')),
      canonicalStaticUrl(SUPPORT, collectionUrl('fr', '12380144', 'jamf-connect-pour-macos')),
      `${SUPPORT.baseUrl}/sitemap.xml`,
    ].sort());

    requests.length = 0;
    await hits('licence', 'fr-FR');
    await tocTitles('jamf-concepts-guides', 'fr-FR');
    await tocTitles('jamf-support-jamf-pro', 'fr-FR');

    // get_toc reads en's listing for the ids (#352), and nothing it has read.
    expect(requests).toEqual([`${SUPPORT.baseUrl}/en/`]);
  });

  it('are requested for both sources at once, not for one after the other\'s', async () => {
    // concepts.jamf.com's pages answer once support.jamf.com's sitemap has
    // been asked for, or after a second. Searched one after the other, as
    // until 2026-09-28, the support index waited on the concepts one, and a
    // cold search on both builds in turn.
    let supportAsked = (): void => undefined;
    const asked = new Promise<'asked'>((resolve) => { supportAsked = () => { resolve('asked'); }; });
    const released: string[] = [];
    before = async (url) => {
      if (url === `${SUPPORT.baseUrl}/sitemap.xml`) { supportAsked(); }
      if (new URL(url).hostname === 'concepts.jamf.com') {
        released.push(await Promise.race([
          asked,
          new Promise<'timed out'>((resolve) => { setTimeout(() => { resolve('timed out'); }, 1000); }),
        ]));
      }
    };

    await hits('Self Service', 'fr-FR');

    expect(released.length).toBeGreaterThan(0);
    expect(released).not.toContain('timed out');
  });
});
