/**
 * What `jamf_docs_search` and `jamf_docs_get_toc` call a page whose slug is
 * not ASCII, driven end to end over MCP with only the http client mocked.
 *
 * Both tools title a static page from its URL slug, and both were handed the
 * slug as `URL.pathname` spells it, percent-encoded. support.jamf.com lists
 * 29 such articles (13 ja, 16 zh-TW, 2026-09-26), which are every article it
 * lists in either language. So the other-sources block titled each one like
 * "Jamf ID %E3%81%AE%E4%BD%9C%E6%88%90", and a query in Japanese or Chinese
 * found none of them: measured live over this tool, 0 of the 8 all-CJK
 * queries tried matched a support article. Nothing went red, because nothing
 * fails: the search returns, and every URL is right.
 *
 * The URLs are not what is wrong. core hands out the percent-encoded form on
 * purpose (see `canonicalStaticUrl`), and these cases keep it.
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
import { STATIC_DOC_SOURCES } from '../../../src/core/constants/sources.js';
import type { CacheKey } from '../../../src/core/services/cache-key.js';
import { createMockContext, createStubMapsRegistry } from '../../helpers/mock-context.js';
import type { ServerContext } from '../../../src/core/types/context.js';
import { SUPPORT_NON_ASCII_ARTICLES } from '../../fixtures/support-non-ascii-articles.js';

const mockedGetText = vi.mocked(httpGetText);

const CONCEPTS = 'https://concepts.jamf.com';
const SUPPORT = 'https://support.jamf.com';
const SUPPORT_NAME = STATIC_DOC_SOURCES['jamf-support'].name;

/** The URL core reports for a listed path: WHATWG serialisation, percent-encoded. */
const canonical = (listed: string): string => new URL(`${SUPPORT}${listed}`).toString();

/** The fixture row whose path starts with this, e.g. `/ja/articles/11156264-`. */
function article(prefix: string): { listed: string; title: string } {
  const row = SUPPORT_NON_ASCII_ARTICLES.find(a => a.listed.startsWith(prefix));
  if (row === undefined) { throw new Error(`No fixture article at ${prefix}`); }
  return row;
}

// concepts.jamf.com has no non-ASCII path today (0 of 990, 2026-09-26). Its
// TOC titles every page with the same function, so this one stands in for
// the first that does.
const CONCEPTS_NON_ASCII = `${CONCEPTS}/ja/guides/ゼロトラスト/デバイスの信頼`;
const CONCEPTS_ASCII = `${CONCEPTS}/ja/guides/zero-trust`;

function serve(url: string): string {
  const { origin, pathname } = new URL(url);
  if (pathname !== '/sitemap.xml') { throw new Error(`HTTP 404 ${url}`); }
  const locs = origin === SUPPORT
    // Raw, as support.jamf.com's sitemap lists them.
    ? SUPPORT_NON_ASCII_ARTICLES.map(a => `${SUPPORT}${a.listed}`)
    : [`${CONCEPTS}/ja/guides`, CONCEPTS_NON_ASCII, CONCEPTS_ASCII];
  return `<urlset>${locs.map(loc => `<url><loc>${loc}</loc></url>`).join('')}</urlset>`;
}

// ── Harness ─────────────────────────────────────────────────────────────────

interface CallResult {
  isError?: boolean;
  content: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
}

interface Hit { title: string; url: string; source: string }

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
        title: 'Jamf ID',
        snippet: 'Jamf ID.',
        product: 'Jamf Account',
        url: 'https://learn.jamf.com/r/ja-JP/jamf-account-documentation/Jamf_ID',
      }]),
    },
  });
  registerSearchTool(server, ctx);
  registerGetTocTool(server, ctx);
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
  mockedGetText.mockReset();
  mockedGetText.mockImplementation(async (url: string) => await Promise.resolve(serve(url)));
});

async function call(name: string, args: Record<string, unknown>): Promise<CallResult> {
  const result = await client.callTool({ name, arguments: args }) as CallResult;
  expect(result.isError, result.content[0]?.text).not.toBe(true);
  return result;
}

/** The support.jamf.com hits `jamf_docs_search` reports for a query. */
async function supportHits(query: string, language: string): Promise<Hit[]> {
  const result = await call('jamf_docs_search', { query, language });
  return ((result.structuredContent?.otherSources ?? []) as Hit[])
    .filter(hit => hit.source === SUPPORT_NAME);
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('jamf_docs_search: support.jamf.com articles with a non-ASCII slug', () => {
  it('finds a Japanese article by the words of its Japanese title', async () => {
    const page = article('/ja/articles/11156264-');

    expect(await supportHits('パスワードを変更', 'ja-JP')).toEqual([
      { title: 'Jamf ID のパスワードを変更する', url: canonical(page.listed), source: SUPPORT_NAME },
    ]);
  });

  it('finds Traditional Chinese articles by the words of their titles', async () => {
    const hits = await supportHits('推送證書', 'zh-TW');

    // The three whose title holds the phrase; the limit is three per source.
    expect(hits.map(hit => hit.title).sort()).toEqual([
      'Jamf Pro 推送證書在嘗試續約時下載為 Cer 檔案',
      '尋找用於推送證書創建的 Apple 帳戶',
      '您上傳了無效的檔案類型 在續約 Jamf Pro 推送證書時出現的錯誤訊息',
    ].sort());
    expect(hits.map(hit => hit.url).sort()).toEqual([
      canonical(article('/zh-TW/articles/11016566-').listed),
      canonical(article('/zh-TW/articles/11016585-').listed),
      canonical(article('/zh-TW/articles/11016594-').listed),
    ].sort());
  });

  it('titles a hit in the Markdown reply as well, and links it by its encoded URL', async () => {
    const page = article('/zh-TW/articles/11016634-');

    const result = await call('jamf_docs_search', { query: '推播通知憑證', language: 'zh-TW' });

    const { text } = result.content[0];
    expect(text).toContain(`- [在 Jamf Pro 中更新您的 MDM 推播通知憑證](${canonical(page.listed)})`);
    // Linked by the encoded URL, not by the raw path the sitemap lists.
    expect(text).toContain('](https://support.jamf.com/zh-TW/articles/11016634-%E5%9C%A8-jamf-pro-');
    expect(text).not.toContain(`](${SUPPORT}${page.listed})`);
  });

  it('does not serve a title index cached before titles were decoded', async () => {
    // What a build before this one left behind, under the key it used: every
    // ja title as its escapes. The index's entries hold titles and are kept
    // for `cacheTtl.products`, 7 days by default, so without a new namespace
    // an upgrade would go on answering with these.
    const stale = SUPPORT_NON_ASCII_ARTICLES
      .filter(a => a.listed.startsWith('/ja/'))
      .map(a => ({
        title: new URL(`${SUPPORT}${a.listed}`).pathname.split('/').pop() ?? '',
        url: canonical(a.listed),
        source: SUPPORT_NAME,
      }));
    await ctx.cache.set(
      'static-search-index-v2:{"locale":"ja","source":"jamf-support"}' as CacheKey,
      stale,
    );

    const hits = await supportHits('Jamf ID', 'ja-JP');

    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) { expect(hit.title).not.toMatch(/%[0-9A-F]{2}/i); }
  });
});

describe('jamf_docs_get_toc: a concepts.jamf.com page with a non-ASCII slug', () => {
  it('titles the entry with the words of its slug, and sorts it by them, not by their escapes', async () => {
    const result = await call('jamf_docs_get_toc', { publication: 'jamf-concepts-guides', language: 'ja-JP' });
    const entries = (result.structuredContent?.entries ?? []) as { title: string; url: string; depth: number }[];

    // Sorted by its escapes, `%E3%82%BC…` would come ahead of every ASCII slug.
    expect(entries).toEqual([
      { title: 'Zero Trust', url: `${CONCEPTS_ASCII}/`, depth: 0 },
      { title: 'ゼロトラスト', url: '', depth: 0 },
      { title: 'デバイスの信頼', url: `${new URL(CONCEPTS_NON_ASCII).toString()}/`, depth: 1 },
    ]);
  });
});
