/**
 * One page, one URL: what `jamf_docs_search`, `jamf_docs_get_toc` and
 * `jamf_docs_get_article` call the same concepts.jamf.com or support.jamf.com
 * page, and which spelling of it core asks the site for (#338).
 *
 * The two sites disagree about the trailing slash, measured 2026-09-26 with
 * redirects not followed. concepts.jamf.com answers `…/apiutil` with a 301 to
 * `…/apiutil/` (11 of 11 sampled); support.jamf.com answers
 * `…/get-started-with-jamf-now/` with a 301 to the slashless form (19 of 19
 * sampled, and the slashless form is the page's `<link rel="canonical">`).
 * Both sitemaps list every page without the slash, 990 of 990 and 916 of 916.
 *
 * Until #338 one rule, written for concepts.jamf.com, ran on both: every
 * uncached support article was requested in the spelling that redirects, and
 * `get_article` reported that spelling as the article's `url`. Search, on
 * the other hand, reported sitemap `<loc>` values as listed, so a concepts
 * page came back slashless there and slashed everywhere else; and a support
 * page with a non-ASCII slug came back raw from search and the TOC but
 * percent-encoded from `get_article`. Nothing went red: every spelling
 * serves the same page.
 *
 * So each case drives the three registered tools end to end over MCP, with
 * only the http client mocked. The mock models each site from the
 * measurements above, not from anything in the registry — the point is that
 * the registry agrees with the site.
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
import { httpGetText } from '../../../src/core/http-client.js';
import { registerSearchTool } from '../../../src/core/tools/search.js';
import { registerGetTocTool } from '../../../src/core/tools/get-toc.js';
import { registerGetArticleTool } from '../../../src/core/tools/get-article.js';
import { STATIC_DOC_SOURCES } from '../../../src/core/constants/sources.js';
import { createMockContext, createStubMapsRegistry } from '../../helpers/mock-context.js';
import type { ServerContext } from '../../../src/core/types/context.js';

const mockedGetText = vi.mocked(httpGetText);

type SourceId = keyof typeof STATIC_DOC_SOURCES;

/**
 * The spelling each site answers with a 200, as measured. Keyed on every
 * registered source, so a third one does not compile here until someone has
 * looked at how its site answers.
 */
const SERVES: Record<SourceId, 'slashed' | 'slashless'> = {
  'jamf-concepts': 'slashed',
  'jamf-support': 'slashless',
};

const CONCEPTS = 'https://concepts.jamf.com';
const SUPPORT = 'https://support.jamf.com';

/** One page, as each place that lists it lists it. */
interface PageCase {
  name: string;
  source: SourceId;
  /** As the sitemap and (for support.jamf.com) the collection page list it. */
  listed: string;
  /** What every tool should call it, and the one URL the site answers with a 200. */
  canonical: string;
  query: string;
  language: string;
  publication: string;
}

const CASES: PageCase[] = [
  {
    name: 'a concepts.jamf.com tool page',
    source: 'jamf-concepts',
    listed: `${CONCEPTS}/en/concepts/apiutil`,
    canonical: `${CONCEPTS}/en/concepts/apiutil/`,
    query: 'apiutil',
    language: 'en-US',
    publication: 'jamf-concepts-tools',
  },
  {
    name: 'a support.jamf.com article',
    source: 'jamf-support',
    listed: `${SUPPORT}/en/articles/10631322-get-started-with-jamf-now`,
    canonical: `${SUPPORT}/en/articles/10631322-get-started-with-jamf-now`,
    query: 'get started with jamf now',
    language: 'en-US',
    publication: 'jamf-support-jamf-now',
  },
  {
    // 31 of support.jamf.com's 916 sitemap entries carry a non-ASCII slug (13
    // ja and 16 zh-TW articles, 2 zh-TW collections), listed raw there and on
    // Intercom's collection pages alike. `get_article` has always reported
    // the percent-encoded form — WHATWG serialisation, which is also what
    // goes on the wire — so that is the one spelling here too.
    name: 'a support.jamf.com article with a non-ASCII slug',
    source: 'jamf-support',
    listed: `${SUPPORT}/ja/articles/10631329-self-service-は-jamf-サーバーに関連付けられている必要があります`,
    canonical: `${SUPPORT}/ja/articles/10631329-self-service-`
      + '%E3%81%AF-jamf-%E3%82%B5%E3%83%BC%E3%83%90%E3%83%BC%E3%81%AB%E9%96%A2%E9%80%A3'
      + '%E4%BB%98%E3%81%91%E3%82%89%E3%82%8C%E3%81%A6%E3%81%84%E3%82%8B%E5%BF%85%E8%A6%81'
      + '%E3%81%8C%E3%81%82%E3%82%8A%E3%81%BE%E3%81%99',
    query: 'self service',
    language: 'ja-JP',
    publication: 'jamf-support-jamf-pro',
  },
];

// ── The two sites ───────────────────────────────────────────────────────────

const nextData = (props: Record<string, unknown>): string =>
  '<html><body><script id="__NEXT_DATA__" type="application/json" nonce="n">'
  + `${JSON.stringify({ props: { pageProps: props } })}</script></body></html>`;

/** A path with its trailing slash dropped, so both spellings name one page. */
function pageKey(url: string): string {
  const parsed = new URL(url);
  return `${parsed.origin}${parsed.pathname.replace(/\/$/, '')}`;
}

const SITEMAPS: Record<string, string[]> = {
  // No trailing slash on any <loc>, as on both live sitemaps.
  [CONCEPTS]: [`${CONCEPTS}/en/concepts`, `${CONCEPTS}/en/concepts/apiutil`],
  [SUPPORT]: CASES.filter(c => c.source === 'jamf-support').map(c => c.listed),
};

const COLLECTIONS: Record<string, { home: string; collection: Record<string, unknown> }> = {
  [`${SUPPORT}/en/collections/12369100-jamf-now`]: {
    home: 'en',
    collection: {
      id: '12369100', slug: 'jamf-now', name: 'Jamf Now',
      articleSummaries: [{ title: 'Get started with Jamf Now', url: CASES[1].listed }],
    },
  },
  // Live shape: the ja Jamf Pro collection files everything under
  // subcollections, whose own URLs carry non-ASCII slugs as well.
  [`${SUPPORT}/ja/collections/12369024-jamf-pro`]: {
    home: 'ja',
    collection: {
      id: '12369024', slug: 'jamf-pro', name: 'Jamf Pro',
      articleSummaries: [],
      subcollections: [{
        name: 'Self Service',
        url: `${SUPPORT}/ja/collections/12380114-self-service`,
        articleSummaries: [{
          title: 'Self Service は Jamf サーバーに関連付けられている必要があります',
          url: CASES[2].listed,
        }],
      }, {
        name: 'プッシュ証明書',
        url: `${SUPPORT}/ja/collections/12468624-プッシュ証明書`,
        articleSummaries: [],
      }],
    },
  },
};

const PAGES = new Map<string, string>([
  [pageKey(CASES[0].listed), `<html><head><meta property="og:title" content="API Utility"></head><body>
    <article class="prose"><h2>What it does</h2><p>Calls the Jamf Pro API.</p></article></body></html>`],
  [pageKey(CASES[1].listed), nextData({
    articleContent: { title: 'Get started with Jamf Now', blocks: [{ type: 'paragraph', text: 'Enrol a device.' }] },
    breadcrumbs: [],
  })],
  [pageKey(CASES[2].listed), nextData({
    articleContent: { title: 'Self Service は Jamf サーバーに関連付けられている必要があります', blocks: [{ type: 'paragraph', text: '本文。' }] },
    breadcrumbs: [],
  })],
]);

/** Every page request core made, as the string it handed the http client. */
let pageRequests: string[];

/** The source a URL's host belongs to. */
function sourceOf(url: string): SourceId {
  const { hostname } = new URL(url);
  const id = (Object.keys(STATIC_DOC_SOURCES) as SourceId[])
    .find(key => STATIC_DOC_SOURCES[key].hostname === hostname);
  if (id === undefined) { throw new Error(`Not a static source: ${url}`); }
  return id;
}

/** Whether the site would answer this request with a redirect rather than the page. */
function redirects(url: string): boolean {
  const slashed = new URL(url).pathname.endsWith('/');
  return SERVES[sourceOf(url)] === 'slashed' ? !slashed : slashed;
}

function serve(url: string): string {
  const parsed = new URL(url);
  if (parsed.pathname === '/sitemap.xml') {
    const locs = SITEMAPS[parsed.origin] ?? [];
    return `<urlset>${locs.map(loc => `<url><loc>${loc}</loc></url>`).join('')}</urlset>`;
  }
  if (parsed.origin === SUPPORT && /^\/[^/]+\/?$/.test(parsed.pathname)) {
    const locale = parsed.pathname.replace(/\//g, '');
    return nextData({
      home: {
        collections: Object.entries(COLLECTIONS)
          .filter(([, c]) => c.home === locale)
          .map(([collectionUrl, c]) => ({ ...c.collection, url: collectionUrl, articleCount: 1 })),
      },
    });
  }
  const collection = Object.entries(COLLECTIONS).find(([key]) => pageKey(key) === pageKey(url));
  if (collection !== undefined) {
    return nextData({ collection: collection[1].collection });
  }
  const page = PAGES.get(pageKey(url));
  if (page === undefined) { throw new Error(`HTTP 404 ${url}`); }
  pageRequests.push(url);
  return page;
}

// ── Harness ─────────────────────────────────────────────────────────────────

interface CallResult {
  isError?: boolean;
  content: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
}

let ctx: ServerContext;
let server: McpServer;
let client: Client;

beforeAll(async () => {
  server = new McpServer({ name: 'test-server', version: '0.0.1' });
  ctx = createMockContext({
    mapsRegistry: createStubMapsRegistry(),
    // One Fluid Topics hit, so a search reaches its normal reply: with none
    // it answers with the no-results reply, which carries no other sources.
    searchProvider: {
      search: async () => await Promise.resolve([{
        title: 'API Roles and Clients',
        snippet: 'Roles and clients.',
        product: 'Jamf Pro',
        url: 'https://learn.jamf.com/r/en-US/jamf-pro-documentation-current/API_Roles_and_Clients',
      }]),
    },
  });
  registerSearchTool(server, ctx);
  registerGetTocTool(server, ctx);
  registerGetArticleTool(server, ctx);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test-client', version: '0.0.1' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  await client.listTools();
});

afterAll(async () => {
  await client.close();
  await server.close();
});

beforeEach(async () => {
  await ctx.cache.clear();
  pageRequests = [];
  mockedGetText.mockReset();
  mockedGetText.mockImplementation(async (url: string) => await Promise.resolve(serve(url)));
});

async function call(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await client.callTool({ name, arguments: args }) as CallResult;
  expect(result.isError, result.content[0]?.text).not.toBe(true);
  expect(result.structuredContent, `${name} structuredContent`).toBeDefined();
  return result.structuredContent ?? {};
}

/** What `jamf_docs_search` calls the page, found by its title's source. */
async function searchUrl(page: PageCase): Promise<string> {
  const content = await call('jamf_docs_search', { query: page.query, language: page.language });
  const hits = (content.otherSources ?? []) as { url: string; source: string }[];
  const hit = hits.find(h => h.source === STATIC_DOC_SOURCES[page.source].name);
  expect(hit, `otherSources for "${page.query}": ${JSON.stringify(hits)}`).toBeDefined();
  return hit?.url ?? '';
}

/** What `jamf_docs_get_toc` calls the page. */
async function tocUrl(page: PageCase): Promise<string> {
  const content = await call('jamf_docs_get_toc', { publication: page.publication, language: page.language });
  const entries = (content.entries ?? []) as { url: string }[];
  const urls = entries.map(e => e.url);
  const match = urls.find(url => pageKey(url) === pageKey(page.canonical));
  expect(match, `get_toc entries for ${page.publication}: ${JSON.stringify(urls)}`).toBeDefined();
  return match ?? '';
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('static-source URLs, across tools (#338)', () => {
  it('models every registered source', () => {
    // A registry row this suite has no measured answer for is a source whose
    // canonical spelling nobody has checked.
    expect(Object.keys(SERVES).sort()).toEqual(Object.keys(STATIC_DOC_SOURCES).sort());
    for (const source of Object.keys(STATIC_DOC_SOURCES) as SourceId[]) {
      expect(CASES.some(c => c.source === source), `a page case for ${source}`).toBe(true);
    }
  });

  describe.each(CASES)('$name', (page) => {
    it('is the same URL in search, the TOC and the article', async () => {
      const fromSearch = await searchUrl(page);
      const fromToc = await tocUrl(page);
      const article = await call('jamf_docs_get_article', { url: fromSearch });

      expect({ search: fromSearch, toc: fromToc, article: article.url }).toEqual({
        search: page.canonical,
        toc: page.canonical,
        article: page.canonical,
      });
    });

    it('requests the spelling the site answers with a 200, not the redirect', async () => {
      await call('jamf_docs_get_article', { url: page.listed });

      expect(pageRequests).toEqual([page.canonical]);
      expect(pageRequests.filter(redirects)).toEqual([]);
    });

    it('serves either spelling from the one cache entry, under the one URL', async () => {
      const slashed = `${pageKey(page.listed)}/`;
      const slashless = pageKey(page.listed);

      const first = await call('jamf_docs_get_article', { url: slashed });
      const second = await call('jamf_docs_get_article', { url: slashless });

      expect([first.url, second.url]).toEqual([page.canonical, page.canonical]);
      expect(pageRequests).toHaveLength(1);
    });
  });

  it('names every Intercom TOC entry in the one spelling, subcollections included', async () => {
    const content = await call('jamf_docs_get_toc', { publication: 'jamf-support-jamf-pro', language: 'ja-JP' });
    const urls = ((content.entries ?? []) as { url: string }[]).map(e => e.url);

    expect(urls).toEqual([
      `${SUPPORT}/ja/collections/12380114-self-service`,
      CASES[2].canonical,
      `${SUPPORT}/ja/collections/12468624-%E3%83%97%E3%83%83%E3%82%B7%E3%83%A5%E8%A8%BC%E6%98%8E%E6%9B%B8`,
    ]);
  });
});
