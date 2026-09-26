/**
 * What a client paging through `jamf_docs_get_toc` reaches, and what each page
 * tells it: the registered tool over MCP, with the real TOC services, and only
 * the upstream fetches mocked.
 *
 * Until 2026-09-26 a page was ten top-level entries cut to `maxTokens`
 * afterwards, and page N+1 began at entry 10·N, so what the cut dropped was on
 * no page. Live on 2026-09-26, paging Jamf Pro's 20 top-level entries reached
 * 1 at `maxTokens: 100`, 6 at 1000 and 17 at the default 5000. Page 2 at 100
 * was empty, reported `0 tokens`, and still said "TOC truncated due to token
 * limit. Use `page` parameter or increase `maxTokens`." And the MCP App's
 * "Show more" asked for the next page without the budget the page on screen
 * was cut to.
 *
 * The Jamf Pro tree here is built to the live costs of its 20 top-level
 * entries (see `JAMF_PRO_ROOT_COSTS`), so each page break falls where it falls
 * on the site.
 *
 * Pages are cut to `maxTokens` from whichever tree answered, so a next page
 * follows the one before it only when it is asked for the same way. The
 * footers used to name only the next `page`, and the app resent only the id,
 * the page and (since pages are cut this way) the budget: a model following
 * the footer at `maxTokens: 1000`, or the app paging a ja-JP or older-version
 * TOC, got a page of another cut or another tree.
 */

import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

vi.mock('../../../src/core/services/ft-client.js', async (importOriginal) => ({
  ...await importOriginal<typeof FtClientModule>(),
  fetchMapToc: vi.fn(),
}));

const mockHttpGetText = vi.fn<(url: string) => Promise<string>>();
vi.mock('../../../src/core/http-client.js', async (importOriginal) => ({
  ...await importOriginal<typeof HttpClientModule>(),
  httpGetText: async (url: string) => await mockHttpGetText(url),
}));

import { McpServer } from '@modelcontextprotocol/server';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import type * as FtClientModule from '../../../src/core/services/ft-client.js';
import type * as HttpClientModule from '../../../src/core/http-client.js';
import { fetchMapToc } from '../../../src/core/services/ft-client.js';
import { registerGetTocTool } from '../../../src/core/tools/get-toc.js';
import { TOKEN_CONFIG } from '../../../src/core/constants.js';
import { nextTocPageArgs, type TocPaging } from '../../../app-ui/toc.js';
import { createMockContext } from '../../helpers/mock-context.js';
import { JAMF_PRO_ROOT_COSTS, ftRootsCosting } from '../../helpers/toc-costs.js';
import type { ServerContext } from '../../../src/core/types/context.js';
import type { FtTocNode } from '../../../src/core/types.js';

interface TextContent { type: 'text'; text: string }

interface CallResult {
  isError?: boolean;
  content: unknown[];
  structuredContent?: Record<string, unknown>;
}

interface FlatEntry { title: string; url: string; depth: number }

const PRO_MAP = 'A4LI4vM0BILraYeOD89WGg';
const PRO_TREE = ftRootsCosting(JAMF_PRO_ROOT_COSTS);
const PRO_ROOT_URLS = PRO_TREE.map(n => `https://learn.jamf.com${n.prettyUrl}`);

let ctx: ServerContext;
let server: McpServer;
let client: Client;
let tree: FtTocNode[] = PRO_TREE;

beforeAll(async () => {
  server = new McpServer({ name: 'test', version: '0.0.1' });
  ctx = createMockContext();
  ctx.mapsRegistry.getVersions = vi.fn().mockResolvedValue(['11.26.0']);
  registerGetTocTool(server, ctx);

  client = new Client({ name: 'test-client', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  // The client checks structuredContent against the published outputSchema
  // only for tools it has listed.
  await client.listTools();
});

afterAll(async () => {
  await client.close();
  await server.close();
});

beforeEach(async () => {
  await ctx.cache.clear();
  delete ctx.tocProvider;
  ctx.mapsRegistry.resolveMap = vi.fn().mockResolvedValue({
    mapId: PRO_MAP, title: 'Jamf Pro Documentation', resolvedLocale: 'en-US',
  });
  tree = PRO_TREE;
  vi.mocked(fetchMapToc).mockImplementation(async () => await Promise.resolve(tree));
  mockHttpGetText.mockReset();
});

async function getToc(args: Record<string, unknown>): Promise<CallResult> {
  return await client.callTool({ name: 'jamf_docs_get_toc', arguments: args }) as CallResult;
}

function textOf(result: CallResult): string {
  return (result.content[0] as TextContent).text;
}

/**
 * Page 1 onwards until `hasMore` is false, each page asked for with the same
 * arguments as the first. What a model following the footer sends, and what
 * the MCP App's "Show more" sends, are walked on their own below.
 */
async function walk(args: Record<string, unknown>): Promise<CallResult[]> {
  const pages: CallResult[] = [];
  let next: Record<string, unknown> | null = { ...args, page: 1 };
  while (next !== null) {
    const result = await getToc(next);
    expect(result.isError, textOf(result)).not.toBe(true);
    pages.push(result);
    const sc = result.structuredContent ?? {};
    next = sc.hasMore === true ? { ...args, page: (sc.page as number) + 1 } : null;
    expect(pages.length).toBeLessThanOrEqual(100);
  }
  return pages;
}

function rootsOf(pages: CallResult[]): string[] {
  return pages.flatMap(p => (p.structuredContent?.entries as FlatEntry[]).filter(e => e.depth === 0).map(e => e.url));
}

describe('paging through a Fluid Topics map', () => {
  it.each([100, 500, 1000, 2000, 5000, 50000])('reaches all 20 of Jamf Pro\'s top-level entries at maxTokens %i', async (maxTokens) => {
    const pages = await walk({ product: 'jamf-pro', maxTokens });

    expect(rootsOf(pages)).toEqual(PRO_ROOT_URLS);
    pages.forEach((p, i) => {
      expect(p.structuredContent).toMatchObject({
        productId: 'jamf-pro',
        page: i + 1,
        totalPages: pages.length,
        hasMore: i + 1 < pages.length,
        maxTokens,
      });
    });
  });

  it('gives page 2 at maxTokens 100 the second entry, cut to fit, where it was an empty page', async () => {
    const result = await getToc({ product: 'jamf-pro', page: 2, maxTokens: 100 });
    const text = textOf(result);

    expect(text).not.toContain('| 0 tokens');
    expect(text).not.toContain('Use `page` parameter');
    expect(text).toContain('- [Root 1](https://learn.jamf.com/r/en-US/jamf-pro-documentation-current/Root_1)');
    expect(text).toContain('**Page 2 of 19** (99 tokens, 727 total entries) | Use `page=3` with `maxTokens: 100` for more');
    expect(text).toContain(
      '*"Root 1" is larger than `maxTokens: 100` on its own, so this page shows the first 9 of its 16 entries. ' +
      'Repeat with `maxTokens: 178` or more to see it whole; pages are cut to `maxTokens`, so it may then be on a different page.*',
    );
    expect(result.structuredContent?.truncatedEntry).toEqual({
      title: 'Root 1', shownEntries: 9, totalEntries: 16, estimatedTokens: 178,
    });
    expect(result.structuredContent?.entries).toHaveLength(9);
  });

  it('lists the cut entry in compact markdown, which shows top-level entries only', async () => {
    const text = textOf(await getToc({ product: 'jamf-pro', page: 2, maxTokens: 100, outputMode: 'compact' }));

    expect(text).toContain('- [Root 1](https://learn.jamf.com/r/en-US/jamf-pro-documentation-current/Root_1)');
    expect(text).toContain('*Page 2/19 | page=3, maxTokens=100 for more*');
    expect(text).not.toContain('Use `page` parameter');
  });

  it('shows the cut entry whole at the maxTokens it names', async () => {
    const pages = await walk({ product: 'jamf-pro', maxTokens: 178 });
    const holding = pages.find(p =>
      (p.structuredContent?.entries as FlatEntry[]).some(e => e.depth === 0 && e.title === 'Root 1'));

    // Page 2 again, as it happens: Root 0 (7 tokens) and Root 1 (178) do not
    // fit on one page of 178, so Root 1 still starts the second.
    expect(holding?.structuredContent?.page).toBe(2);
    expect(holding?.structuredContent?.truncatedEntry).toBeUndefined();
    expect((holding?.structuredContent?.entries as FlatEntry[]).filter(e => e.url.includes('/Root_1'))).toHaveLength(16);
  });

  it('says nothing was cut on a page the budget ended early', async () => {
    // Page 1 at 1000 holds four entries (263 tokens); the fifth costs 758.
    const result = await getToc({ product: 'jamf-pro', maxTokens: 1000 });
    const text = textOf(result);

    expect(text).toContain('**Page 1 of 9** (263 tokens, 727 total entries) | Use `page=2` with `maxTokens: 1000` for more');
    expect(text).not.toContain('truncated');
    expect(text).not.toContain('larger than');
    expect(result.structuredContent?.truncatedEntry).toBeUndefined();
  });

  it('carries the cut in the JSON body', async () => {
    const result = await getToc({ product: 'jamf-pro', page: 2, maxTokens: 100, responseFormat: 'json' });
    const json = JSON.parse(textOf(result)) as Record<string, unknown>;

    expect(json.tokenInfo).toEqual({ tokenCount: 99, truncated: true, maxTokens: 100 });
    expect(json.truncatedEntry).toEqual({ title: 'Root 1', shownEntries: 9, totalEntries: 16, estimatedTokens: 178 });
    expect(json.pagination).toEqual({
      page: 2, pageSize: 10, totalPages: 19, totalItems: 727, hasNext: true, hasPrev: true,
    });
  });

  it('escapes the cut entry\'s title in the notice', async () => {
    tree = ftRootsCosting([7, 178]);
    tree[1] = { ...tree[1], title: 'Root *1* [beta]' };
    const text = textOf(await getToc({ product: 'jamf-pro', page: 2, maxTokens: 100 }));

    expect(text).toContain('*"Root \\*1\\* \\[beta\\]" is larger than `maxTokens: 100` on its own');
    expect(text).not.toContain('Root *1* [beta]');
  });

  it.each([
    [50000, 'Repeat with `maxTokens: 50000` or more to see it whole', 'It needs'],
    [50001, 'It needs 50001 tokens, more than `maxTokens` allows (50000).', 'Repeat with'],
  ])('advises only a maxTokens the schema accepts, for an entry of %i tokens', async (tokens, advice, not) => {
    tree = ftRootsCosting([tokens]);
    const text = textOf(await getToc({ product: 'jamf-pro', maxTokens: 1000 }));

    expect(text).toContain(advice);
    expect(text).not.toContain(not);
  });

  it('says when no maxTokens the schema accepts shows the entry whole', async () => {
    tree = ftRootsCosting([60000]);
    const text = textOf(await getToc({ product: 'jamf-pro', maxTokens: TOKEN_CONFIG.MAX_TOKENS_LIMIT }));

    expect(text).toContain(
      '*"Root 0" is larger than `maxTokens: 50000` on its own, so this page shows the first 4167 of its 5001 entries. ' +
      'It needs 60000 tokens, more than `maxTokens` allows (50000).*',
    );
    expect(text).not.toContain('Repeat with');
  });

  it('gives only general advice when a TocProvider reports a cut it does not describe', async () => {
    ctx.tocProvider = {
      getTableOfContents: vi.fn().mockResolvedValue({
        toc: [{ title: 'Provided', url: 'https://learn.jamf.com/r/en-US/x/Provided' }],
        pagination: { page: 1, pageSize: 10, totalPages: 1, totalItems: 1, hasNext: false, hasPrev: false },
        tokenInfo: { tokenCount: 90, truncated: true, maxTokens: 100 },
      }),
    };
    const text = textOf(await getToc({ product: 'jamf-pro', maxTokens: 100 }));

    expect(text).toContain('*TOC truncated due to token limit: entries on this page were left out. Increase `maxTokens` to see them.*');
    expect(text).not.toContain('Use `page` parameter');
  });
});

describe('following the footer', () => {
  /**
   * Page 1 onwards the way a model reading only the markdown would: each
   * request after the first is the TOC's id plus the `page` and `maxTokens`
   * the footer names, and nothing else.
   */
  async function followFooter(maxTokens: number | undefined, outputMode: 'full' | 'compact'): Promise<CallResult[]> {
    const footer = outputMode === 'compact'
      ? /\| page=(\d+)(?:, maxTokens=(\d+))? for more/
      : /\| Use `page=(\d+)`(?: with `maxTokens: (\d+)`)? for more/;
    const pages: CallResult[] = [];
    let next: Record<string, unknown> | null = {
      product: 'jamf-pro', outputMode, ...(maxTokens !== undefined ? { maxTokens } : {}),
    };
    while (next !== null) {
      const result = await getToc(next);
      expect(result.isError, textOf(result)).not.toBe(true);
      pages.push(result);
      const match = footer.exec(textOf(result));
      // Absent when the footer names no budget.
      const budget: string | undefined = match?.[2];
      next = match === null
        ? null
        : { product: 'jamf-pro', outputMode, page: Number(match[1]), ...(budget !== undefined ? { maxTokens: Number(budget) } : {}) };
      expect(pages.length).toBeLessThanOrEqual(100);
    }
    return pages;
  }

  it.each([
    ['full', 100], ['full', 1000], ['full', undefined],
    ['compact', 100], ['compact', 1000], ['compact', undefined],
  ] as const)('reaches all 20 of Jamf Pro\'s top-level entries in %s markdown at maxTokens %s', async (outputMode, maxTokens) => {
    const pages = await followFooter(maxTokens, outputMode);

    expect(rootsOf(pages)).toEqual(PRO_ROOT_URLS);
    expect(pages.at(-1)?.structuredContent?.hasMore).toBe(false);
  });

  it('names no budget at the default, which asks for the same pages without one', async () => {
    for (const args of [{ product: 'jamf-pro' }, { product: 'jamf-pro', maxTokens: TOKEN_CONFIG.DEFAULT_MAX_TOKENS }]) {
      expect(textOf(await getToc(args))).toContain('**Page 1 of 3** (2,884 tokens, 727 total entries) | Use `page=2` for more');
      expect(textOf(await getToc({ ...args, outputMode: 'compact' }))).toContain('*Page 1/3 | page=2 for more*');
    }
  });
});

describe('more pages than page accepts', () => {
  // 150 top-level entries of 60 tokens: one to a page at maxTokens 100.
  const note = 'At `maxTokens: 100` this table of contents needs 150 pages, but `page` stops at 100, ' +
    'so the entries after page 100 cannot be reached at this budget. ' +
    'Repeat with `maxTokens: 120` or more to page through all of it.';

  it('points no footer, hasMore or Show more at a page the schema rejects, and names the budget that reaches the rest', async () => {
    tree = ftRootsCosting(Array.from({ length: 150 }, () => 60));

    const before = await getToc({ product: 'jamf-pro', page: 99, maxTokens: 100 });
    expect(textOf(before)).toContain('| Use `page=100` with `maxTokens: 100` for more');
    expect(before.structuredContent?.hasMore).toBe(true);

    const last = await getToc({ product: 'jamf-pro', page: 100, maxTokens: 100 });
    const text = textOf(last);
    expect(text).toContain('**Page 100 of 150**');
    expect(text).not.toContain('page=101');
    expect(text).toContain(`> **Pagination Note:** ${note}`);
    expect(last.structuredContent).toMatchObject({ page: 100, totalPages: 150, hasMore: false, paginationNote: note });
    expect(nextTocPageArgs(last.structuredContent as unknown as TocPaging)).toBeNull();

    const compact = textOf(await getToc({ product: 'jamf-pro', page: 100, maxTokens: 100, outputMode: 'compact' }));
    expect(compact).toContain('*Page 100/150*');
    expect(compact).not.toContain('page=101');

    // The page past it is still refused, as before.
    const past = await getToc({ product: 'jamf-pro', page: 101, maxTokens: 100 });
    expect(past.isError).toBe(true);
  });

  it('reaches every entry at the budget the note names', async () => {
    tree = ftRootsCosting(Array.from({ length: 150 }, () => 60));
    const pages = await walk({ product: 'jamf-pro', maxTokens: 120 });

    expect(pages).toHaveLength(75);
    expect(rootsOf(pages)).toHaveLength(150);
  });
});

describe('the next page the MCP App asks for', () => {
  /** One tree per map, as the site has: a translation or an older version is its own map. */
  const TREES: Record<string, FtTocNode[]> = {
    'MAP-en-US-current': PRO_TREE,
    'MAP-ja-JP-11.26.0': ftRootsCosting(JAMF_PRO_ROOT_COSTS.map(c => c + 40), 'ja-jamf-pro-11.26.0'),
    'MAP-ja-JP-current': ftRootsCosting(JAMF_PRO_ROOT_COSTS.map(c => c + 20), 'ja-jamf-pro-current'),
    'MAP-en-US-11.26.0': ftRootsCosting(JAMF_PRO_ROOT_COSTS.map(c => c + 10), 'jamf-pro-11.26.0'),
  };

  it.each([100, 1000, 5000])('comes from the tree on screen, at maxTokens %i, for a TOC in another language and version', async (maxTokens) => {
    ctx.mapsRegistry.resolveMap = vi.fn(async (_bundle: string, version?: string, locale?: string) => await Promise.resolve({
      mapId: `MAP-${locale ?? 'en-US'}-${version ?? 'current'}`, title: 'Jamf Pro Documentation', resolvedLocale: locale ?? 'en-US',
    }));
    vi.mocked(fetchMapToc).mockImplementation(async (_http, mapId: string) => await Promise.resolve(TREES[mapId] ?? []));

    // Page 1 as the model asked for it; every later page as "Show more" asks,
    // from structuredContent alone.
    const pages: CallResult[] = [];
    let next: { name: string; args: Record<string, unknown> } | null = {
      name: 'jamf_docs_get_toc', args: { product: 'jamf-pro', language: 'ja-JP', version: '11.26.0', maxTokens },
    };
    while (next !== null) {
      const result = await client.callTool({ name: next.name, arguments: next.args }) as CallResult;
      expect(result.isError, textOf(result)).not.toBe(true);
      pages.push(result);
      next = nextTocPageArgs(result.structuredContent as unknown as TocPaging);
      expect(pages.length).toBeLessThanOrEqual(100);
    }

    const ja = TREES['MAP-ja-JP-11.26.0'].map(n => `https://learn.jamf.com${n.prettyUrl}`);
    expect(rootsOf(pages)).toEqual(ja);
    expect(pages.map(p => p.structuredContent?.language)).toEqual(pages.map(() => 'ja-JP'));
  });

  it('echoes no language when none was asked for', async () => {
    const result = await getToc({ product: 'jamf-pro', maxTokens: 1000 });

    expect(result.structuredContent).not.toHaveProperty('language');
    expect(nextTocPageArgs(result.structuredContent as unknown as TocPaging)?.args)
      .toEqual({ product: 'jamf-pro', page: 2, maxTokens: 1000 });
  });
});

describe('paging through a static source and a Help Center collection', () => {
  function sitemapXml(paths: string[]): string {
    const urls = paths.map(p =>
      `<url><loc>https://concepts.jamf.com${p}</loc><lastmod>2026-09-02</lastmod></url>`).join('');
    return `<?xml version="1.0" encoding="UTF-8"?><urlset>${urls}</urlset>`;
  }

  it.each([100, 300, 5000])('reaches every concepts.jamf.com guide at maxTokens %i', async (maxTokens) => {
    // 25 guides, each with sub-pages, so the small budgets cut them. The tree
    // is ordered by slug, so the numbers are padded to keep that order theirs.
    const guides = Array.from({ length: 25 }, (_, i) => `/en/guides/guide-number-${String(i).padStart(2, '0')}`);
    mockHttpGetText.mockResolvedValue(sitemapXml(guides.flatMap(g => [
      g, ...Array.from({ length: 6 }, (_, j) => `${g}/a-sub-page-with-a-fairly-long-slug-${String(j)}`),
    ])));

    const pages = await walk({ publication: 'jamf-concepts-guides', maxTokens });

    expect(rootsOf(pages)).toEqual(guides.map(g => `https://concepts.jamf.com${g}/`));
  });

  it.each([100, 500, 5000])('reaches every support.jamf.com collection entry at maxTokens %i', async (maxTokens) => {
    // The shape of the live Jamf Pro collection: 11 articles directly in it,
    // then 24 subcollections.
    const page = (pageProps: unknown): string =>
      `<html><body><script id="__NEXT_DATA__" type="application/json" nonce="n">${
        JSON.stringify({ props: { pageProps } })}</script></body></html>`;
    const loose = Array.from({ length: 11 }, (_, i) => ({
      title: `Loose article ${String(i)}, titled at about the length Jamf's are`,
      url: `https://support.jamf.com/en/articles/${String(100 + i)}-loose-${String(i)}`,
    }));
    const subcollections = Array.from({ length: 24 }, (_sub, i) => ({
      name: `Subcollection ${String(i)}`,
      url: `https://support.jamf.com/en/collections/${String(200 + i)}-sub-${String(i)}`,
      articleSummaries: Array.from({ length: 1 + (i * 7) % 30 }, (_article, j) => ({
        title: `Article ${String(i)}.${String(j)} with a title of ordinary length`,
        url: `https://support.jamf.com/en/articles/${String(1000 * (i + 1) + j)}-a`,
      })),
    }));
    mockHttpGetText.mockImplementation(async (url: string) => await Promise.resolve(
      url === 'https://support.jamf.com/en/'
        ? page({ home: { collections: [{ id: '12369024', name: 'Jamf Pro', description: '', url: 'https://support.jamf.com/en/collections/12369024-jamf-pro' }] } })
        : page({ collection: { articleSummaries: loose, subcollections } }),
    ));

    const pages = await walk({ publication: 'jamf-support-jamf-pro', maxTokens });

    expect(rootsOf(pages)).toEqual([...loose.map(a => a.url), ...subcollections.map(s => s.url)]);
  });
});
