/**
 * What `jamf_docs_search` finds outside the product documentation for a
 * two-character Chinese or Japanese query, driven end to end over MCP with
 * only the http client mocked.
 *
 * Two characters are a whole word in Chinese and a common one in Japanese:
 * 密碼 is "password", 憑證 "certificate", 認証 "authentication". The
 * other-sources index asked Fuse for a run of at least three matched
 * characters, a length chosen for Latin text, and a two-character query can
 * only ever match as a run of two. So every one of them matched nothing, even
 * a title that holds it verbatim: live on 2026-09-28, 20 of 20 two-character
 * ja-JP and zh-TW queries returned no other-source match, while Fluid Topics
 * answered 18 of them. Nothing went red, because nothing fails.
 *
 * The same three still holds for everything else, and these cases pin that
 * too: a two-letter Latin query (`ID`, in a locale whose titles are full of
 * it), and a Chinese or Japanese query of three characters or more.
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
import { STATIC_DOC_SOURCES } from '../../../src/core/constants/sources.js';
import { createMockContext, createStubMapsRegistry } from '../../helpers/mock-context.js';
import type { ServerContext } from '../../../src/core/types/context.js';
import {
  SUPPORT_NON_ASCII_ARTICLES, type SupportNonAsciiArticle,
} from '../../fixtures/support-non-ascii-articles.js';

const mockedGetText = vi.mocked(httpGetText);

const CONCEPTS = 'https://concepts.jamf.com';
const SUPPORT = 'https://support.jamf.com';
const SUPPORT_NAME = STATIC_DOC_SOURCES['jamf-support'].name;

/** The URL core reports for a listed path: WHATWG serialisation, percent-encoded. */
const canonical = (listed: string): string => new URL(`${SUPPORT}${listed}`).toString();

/** The reported URL of the fixture article whose path starts with this. */
function urlOf(prefix: string): string {
  const row = SUPPORT_NON_ASCII_ARTICLES.find(a => a.listed.startsWith(prefix));
  if (row === undefined) { throw new Error(`No fixture article at ${prefix}`); }
  return canonical(row.listed);
}

// English support articles, so the en index holds `ID` the way the ja one does.
const SUPPORT_EN = [
  '/en/articles/11155937-create-a-jamf-id',
  '/en/articles/11156264-change-your-jamf-id-password',
];

function serve(url: string, articles: readonly SupportNonAsciiArticle[] = SUPPORT_NON_ASCII_ARTICLES): string {
  const { origin, pathname } = new URL(url);
  if (pathname !== '/sitemap.xml') { throw new Error(`HTTP 404 ${url}`); }
  const locs = origin === SUPPORT
    // Raw, as support.jamf.com's sitemap lists them: by default every ja and
    // zh-TW article it has (2026-09-26).
    ? [...articles.map(a => a.listed), ...SUPPORT_EN].map(p => `${SUPPORT}${p}`)
    // concepts.jamf.com titles every locale's pages in English, from their slugs.
    : ['/ja/guides/zero-trust', '/zh-TW/guides/zero-trust', '/en/guides/zero-trust']
      .map(p => `${CONCEPTS}${p}`);
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
    // One Fluid Topics hit, so a search reaches its normal reply, as the live
    // searches for these queries did.
    searchProvider: {
      search: async () => await Promise.resolve([{
        title: 'Jamf ID',
        snippet: 'Jamf ID.',
        product: 'Jamf Account',
        url: 'https://learn.jamf.com/r/zh-TW/jamf-account-documentation/Jamf_ID',
      }]),
    },
  });
  registerSearchTool(server, ctx);
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

async function search(query: string, language: string): Promise<CallResult> {
  const result = await client.callTool({ name: 'jamf_docs_search', arguments: { query, language } }) as CallResult;
  expect(result.isError, result.content[0]?.text).not.toBe(true);
  return result;
}

/** The support.jamf.com hits `jamf_docs_search` reports for a query. */
async function supportHits(query: string, language: string): Promise<Hit[]> {
  const result = await search(query, language);
  return ((result.structuredContent?.otherSources ?? []) as Hit[])
    .filter(hit => hit.source === SUPPORT_NAME);
}

/** The URLs of those hits, sorted. */
async function supportUrls(query: string, language: string): Promise<string[]> {
  return (await supportHits(query, language)).map(hit => hit.url).sort();
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('jamf_docs_search: a two-character Chinese or Japanese query', () => {
  // Each finds every article whose title holds it, and nothing else. The
  // articles are named by their fixture path; every title here holds the
  // query verbatim.
  it.each([
    { query: '密碼', language: 'zh-TW', articles: ['/zh-TW/articles/11156264-'] },
    { query: '憑證', language: 'zh-TW', articles: ['/zh-TW/articles/11016634-', '/zh-TW/articles/11657440-'] },
    {
      query: '登入', language: 'zh-TW',
      articles: ['/zh-TW/articles/11645274-', '/zh-TW/articles/11657440-', '/zh-TW/articles/11657549-'],
    },
    {
      query: '續約', language: 'zh-TW',
      articles: ['/zh-TW/articles/11016566-', '/zh-TW/articles/11016591-', '/zh-TW/articles/11016594-'],
    },
    { query: '認証', language: 'ja-JP', articles: ['/ja/articles/11647778-', '/ja/articles/11657440-'] },
    { query: '証明', language: 'ja-JP', articles: ['/ja/articles/11016585-', '/ja/articles/11016634-'] },
    // Kana as well as ideographs. ログ is "log", and like `log` in a Latin
    // title it matches inside the longer word, ログイン.
    {
      query: 'ログ', language: 'ja-JP',
      articles: ['/ja/articles/11645274-', '/ja/articles/11657440-', '/ja/articles/11657549-'],
    },
    // Hiragana as well as Katakana: でき, of できない ("cannot").
    { query: 'でき', language: 'ja-JP', articles: ['/ja/articles/11645274-', '/ja/articles/11657440-'] },
  ])('finds the articles whose titles hold $query ($language)', async ({ query, language, articles }) => {
    const hits = await supportHits(query, language);

    expect(hits.map(hit => hit.url).sort()).toEqual(articles.map(urlOf).sort());
    for (const hit of hits) { expect(hit.title).toContain(query); }
  });

  // A space typed before or after the word is not part of it, nor is the
  // ideographic space (U+3000) a Chinese or Japanese keyboard types. Padded,
  // 密碼 is three characters long, and live it found nothing (2026-09-28).
  // Padded 登入 matched even so, because each title that holds it has a space
  // beside it; trimmed, it must still find all three.
  it.each([
    { query: '密碼 ', padding: 'a trailing space', language: 'zh-TW', articles: ['/zh-TW/articles/11156264-'] },
    {
      query: ' 登入', padding: 'a leading space', language: 'zh-TW',
      articles: ['/zh-TW/articles/11645274-', '/zh-TW/articles/11657440-', '/zh-TW/articles/11657549-'],
    },
    {
      query: '証明\u3000', padding: 'a trailing ideographic space', language: 'ja-JP',
      articles: ['/ja/articles/11016585-', '/ja/articles/11016634-'],
    },
  ])('finds the same articles when it comes with $padding ($language)', async ({ query, language, articles }) => {
    expect(await supportUrls(query, language)).toEqual(articles.map(urlOf).sort());
  });

  it('keeps to three per source when more titles hold it', async () => {
    // 證書 is in four zh-TW titles. Fluid Topics finds nothing for it in
    // zh-TW (live, 2026-09-28), so these are the reply's only answers.
    const holders = ['/zh-TW/articles/11016566-', '/zh-TW/articles/11016577-',
      '/zh-TW/articles/11016585-', '/zh-TW/articles/11016594-'].map(urlOf);

    const hits = await supportHits('證書', 'zh-TW');

    expect(hits).toHaveLength(3);
    for (const hit of hits) {
      expect(holders).toContain(hit.url);
      expect(hit.title).toContain('證書');
    }
  });

  it('lists the match in the Markdown reply too', async () => {
    const result = await search('密碼', 'zh-TW');

    expect(result.content[0].text).toContain(
      `- [變更您的 Jamf ID 密碼](${urlOf('/zh-TW/articles/11156264-')})`,
    );
  });
});

describe('jamf_docs_search: what still needs a run of three', () => {
  it.each([
    // Six ja titles and both en ones hold `ID`, each time as a run of two.
    { query: 'ID', language: 'ja-JP' },
    { query: 'ID', language: 'en-US' },
  ])('a two-letter Latin query, $query ($language), matches no title it merely occurs in', async ({ query, language }) => {
    expect(await supportHits(query, language)).toEqual([]);
  });

  it('a Japanese query of three characters matches no title that holds only two of them', async () => {
    // One title holds 付ける. Two more hold two of its characters in a row:
    // 関連付けられている and サポートを受ける. Fuse allows a three-character
    // pattern one error, so with a run of two enough, both would match.
    const hits = await supportHits('付ける', 'ja-JP');

    expect(hits.map(hit => hit.url)).toEqual([urlOf('/ja/articles/11014479-')]);
  });

  it('a Latin query after a Chinese one, on one server, is held to three', async () => {
    // The Fuse options are fixed when the index is built, and indexes are kept
    // per server: one built for 認証 must not answer `ID`.
    expect((await supportHits('認証', 'ja-JP')).length).toBeGreaterThan(0);
    expect(await supportHits('ID', 'ja-JP')).toEqual([]);
    expect((await supportHits('認証', 'ja-JP')).length).toBeGreaterThan(0);
  });
});

describe('jamf_docs_search: a title index that is built again', () => {
  it('is what both a two-character query and a longer one search, on the same server', async () => {
    // On one server, a Fuse for each minimum: 認証 is held to two, プッシュ
    // to three.
    expect(await supportUrls('認証', 'ja-JP'))
      .toEqual(['/ja/articles/11647778-', '/ja/articles/11657440-'].map(urlOf).sort());
    expect(await supportUrls('プッシュ', 'ja-JP'))
      .toEqual(['/ja/articles/11016585-', '/ja/articles/11016634-'].map(urlOf).sort());

    // The cached index expires, and the sitemap no longer lists one holder of
    // each. The index is built again from it, and neither Fuse built on the
    // old one may answer.
    const gone = ['/ja/articles/11657440-', '/ja/articles/11016585-'];
    const listed = SUPPORT_NON_ASCII_ARTICLES.filter(a => !gone.some(prefix => a.listed.startsWith(prefix)));
    await ctx.cache.clear();
    mockedGetText.mockImplementation(async (url: string) => await Promise.resolve(serve(url, listed)));

    expect(await supportUrls('認証', 'ja-JP')).toEqual([urlOf('/ja/articles/11647778-')]);
    expect(await supportUrls('プッシュ', 'ja-JP')).toEqual([urlOf('/ja/articles/11016634-')]);
  });
});
