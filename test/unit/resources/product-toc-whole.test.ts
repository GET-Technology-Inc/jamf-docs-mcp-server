/**
 * What a client reads from `jamf://products/{productId}/toc`: the registered
 * resource over MCP (`resources/read`), with the real TOC services, and only
 * the upstream fetch mocked.
 *
 * Until 2026-09-28 the resource answered with page 1 of `jamf_docs_get_toc` at
 * `maxTokens: 20000`, and a page holds at most 10 top-level entries. Live on
 * 2026-09-28 that was 10 of Jamf Pro's 20 top-level entries (289 of 794
 * entries) beside `totalEntries: 794`, and nothing in the body said the rest
 * was missing. 11 of the 28 products it serves were cut the same way; the 17
 * with 10 top-level entries or fewer came back whole. The budget never came
 * into it: the whole of Jamf Pro, the largest, is 8447 tokens as the TOC
 * services count them.
 *
 * The Jamf Pro tree here is built to the live costs of its 20 top-level
 * entries (see `JAMF_PRO_ROOT_COSTS`).
 */

import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

vi.mock('../../../src/core/services/ft-client.js', async (importOriginal) => ({
  ...await importOriginal<typeof FtClientModule>(),
  fetchMapToc: vi.fn(),
}));

import { McpServer } from '@modelcontextprotocol/server';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import type * as FtClientModule from '../../../src/core/services/ft-client.js';
import { fetchMapToc } from '../../../src/core/services/ft-client.js';
import { registerResources } from '../../../src/core/resources/index.js';
import { registerGetTocTool } from '../../../src/core/tools/get-toc.js';
import { transformFtTocToTocEntries } from '../../../src/core/services/toc-service.js';
import { countTocEntries, paginateTocEntries } from '../../../src/core/services/toc-helpers.js';
import { JAMF_PRODUCTS } from '../../../src/core/constants.js';
import { createMockContext } from '../../helpers/mock-context.js';
import { JAMF_PRO_ROOT_COSTS, ftRootsCosting, tocRootsCosting } from '../../helpers/toc-costs.js';
import type { ServerContext } from '../../../src/core/types/context.js';
import type { FetchTocOptions, FetchTocResult, FtTocNode, TocEntry } from '../../../src/core/types.js';

interface TextContent { type: 'text'; text: string }

interface CallResult {
  isError?: boolean;
  content: unknown[];
  structuredContent?: Record<string, unknown>;
}

interface TocBody {
  product: string;
  totalEntries: number;
  complete?: boolean;
  shownEntries?: number;
  missing?: string;
  toc: TocEntry[];
}

const PRO_MAP = 'A4LI4vM0BILraYeOD89WGg';
const PRO_TREE = ftRootsCosting(JAMF_PRO_ROOT_COSTS);
const URI = 'jamf://products/jamf-pro/toc';

let ctx: ServerContext;
let server: McpServer;
let client: Client;
let tree: FtTocNode[] = PRO_TREE;

beforeAll(async () => {
  server = new McpServer({ name: 'test', version: '0.0.1' });
  ctx = createMockContext();
  ctx.mapsRegistry.getVersions = vi.fn().mockResolvedValue(['11.32.0']);
  registerResources(server, ctx);
  // Registered beside the resource so a test can follow what the resource
  // says to call for the part it left out.
  registerGetTocTool(server, ctx);

  client = new Client({ name: 'test-client', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
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
  vi.mocked(fetchMapToc).mockReset();
  vi.mocked(fetchMapToc).mockImplementation(async () => await Promise.resolve(tree));
});

async function readToc(uri = URI): Promise<TocBody> {
  const result = await client.readResource({ uri });
  expect(result.contents).toHaveLength(1);
  const [content] = result.contents;
  expect(content.mimeType).toBe('application/json');
  return JSON.parse((content as { text: string }).text) as TocBody;
}

function rootUrls(toc: TocEntry[]): string[] {
  return toc.map(entry => entry.url);
}

function titleOf(node: FtTocNode): string {
  return node.title ?? '';
}

function urlsOf(nodes: FtTocNode[]): string[] {
  return nodes.map(node => `https://learn.jamf.com${node.prettyUrl}`);
}

/**
 * Serve `entries` from a `TocProvider`, paged as `paginateTocEntries` pages
 * them at the budget asked for, with `change` applied to each page.
 */
function provide(
  entries: TocEntry[],
  change: (result: FetchTocResult, page: number) => FetchTocResult = result => result,
): ReturnType<typeof vi.fn> {
  const getTableOfContents = vi.fn(async (_product: string, _version: string, options?: FetchTocOptions) => {
    const page = options?.page ?? 1;
    return await Promise.resolve(change(paginateTocEntries(entries, page, options?.maxTokens ?? 5000), page));
  });
  ctx.tocProvider = { getTableOfContents };
  return getTableOfContents;
}

/** `entries`' page `served` at 20000, numbered as the page asked for. */
function servedAs(entries: TocEntry[], served: number, page: number): FetchTocResult {
  const result = paginateTocEntries(entries, served, 20000);
  return { ...result, pagination: { ...result.pagination, page } };
}

/** The sentence for a source that ended the read, as the resource words it. */
function notPaged(asked: number, what: string): string {
  return `Asked for page ${String(asked)}, the table-of-contents source returned ${what}, so it did not page as asked ` +
    `and this holds nothing after page ${String(asked - 1)}; \`jamf_docs_get_toc\` reads the same source.`;
}

/** The sentence for a page cut without saying what it cut. */
function cutUnsaid(page: number): string {
  return `Page ${String(page)} of \`jamf_docs_get_toc\` with \`product: "jamf-pro"\` and \`maxTokens: 20000\` left out ` +
    'entries to fit that budget, without saying which; a larger `maxTokens` leaves out less.';
}

describe('a table of contents the resource holds whole', () => {
  it('lists every one of Jamf Pro\'s 20 top-level entries, where it listed the first 10', async () => {
    const body = await readToc();

    expect(rootUrls(body.toc)).toEqual(urlsOf(PRO_TREE));
  });

  it('is the whole tree, every entry with every field, and says so', async () => {
    const body = await readToc();

    expect(body.toc).toEqual(transformFtTocToTocEntries(PRO_TREE));
    expect(countTocEntries(body.toc)).toBe(727);
    expect(body).toMatchObject({ product: 'Jamf Pro', totalEntries: 727, complete: true });
    expect(body).not.toHaveProperty('shownEntries');
    expect(body).not.toHaveProperty('missing');
  });

  it('puts the completeness marker before the entries, where a reader meets it first', async () => {
    const result = await client.readResource({ uri: URI });
    const { text } = result.contents[0] as { text: string };

    expect(Object.keys(JSON.parse(text) as object)).toEqual(['product', 'totalEntries', 'complete', 'toc']);
  });

  it('fetches the tree once, however many pages it reads', async () => {
    await readToc();

    expect(fetchMapToc).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['one top-level entry', [7]],
    ['ten, a single page', [7, 178, 11, 67, 758, 963, 183, 447, 122, 148]],
    ['eleven, one past a page', [7, 178, 11, 67, 758, 963, 183, 447, 122, 148, 621]],
    ['forty, the most any Jamf publication has', Array.from({ length: 40 }, (_, i) => 20 + i)],
  ])('holds %s whole', async (_label, costs) => {
    tree = ftRootsCosting(costs);
    const body = await readToc();

    expect(rootUrls(body.toc)).toEqual(urlsOf(tree));
    expect(countTocEntries(body.toc)).toBe(body.totalEntries);
    expect(body.complete).toBe(true);
  });

  it('holds a tree that costs exactly what the resource holds', async () => {
    // Two pages at 20000: ten entries of 1000, then one of 10000.
    tree = ftRootsCosting([...Array.from({ length: 10 }, () => 1000), 10000]);
    const body = await readToc();

    expect(rootUrls(body.toc)).toEqual(urlsOf(tree));
    expect(body.complete).toBe(true);
  });

  it('holds a TocProvider\'s tree whole, read page by page', async () => {
    const provided = transformFtTocToTocEntries(PRO_TREE);
    ctx.tocProvider = {
      getTableOfContents: vi.fn(async (_product: string, _version: string, options?: FetchTocOptions) =>
        await Promise.resolve(paginateTocEntries(provided, options?.page ?? 1, options?.maxTokens ?? 5000))),
    };
    const body = await readToc();

    expect(body.toc).toEqual(provided);
    expect(body.complete).toBe(true);
    expect(ctx.tocProvider.getTableOfContents).toHaveBeenCalledTimes(2);
  });

  it('holds a TocProvider\'s tree whole when its entries carry no tocId', async () => {
    const provided = tocRootsCosting(JAMF_PRO_ROOT_COSTS);
    provide(provided);
    const body = await readToc();

    expect(body.toc).toEqual(provided);
    expect(body.complete).toBe(true);
  });

  it('holds a topic placed at two points of the tree, one on each page', async () => {
    // One url at two points of the tree, as a topic placed twice would have;
    // each point keeps its own tocId.
    tree = PRO_TREE.map((node, i) => i === 12 ? { ...node, prettyUrl: PRO_TREE[2].prettyUrl } : node);
    const body = await readToc();

    expect(body.toc).toEqual(transformFtTocToTocEntries(tree));
    expect(body.complete).toBe(true);
  });

  it('serves every product the resource accepts', async () => {
    tree = ftRootsCosting([7, 178, 11, 67, 758, 963, 183, 447, 122, 148, 621, 48, 2366]);
    for (const [id, product] of Object.entries(JAMF_PRODUCTS)) {
      const body = await readToc(`jamf://products/${id}/toc`);
      expect(body.product, id).toBe(product.name);
      expect(body.toc, id).toHaveLength(13);
      expect(body.complete, id).toBe(true);
    }
  });
});

describe('a table of contents larger than the resource holds', () => {
  // Jamf Pro three times over: 25341 tokens. At maxTokens 20000 its first
  // page is the first ten top-level entries (8652 tokens) and its second the
  // other ten (16689), so the second does not fit beside the first.
  const TRIPLE = ftRootsCosting(JAMF_PRO_ROOT_COSTS.map(cost => cost * 3));

  it('says what it left out and exactly where to get it', async () => {
    tree = TRIPLE;
    const body = await readToc();
    const shown = countTocEntries(body.toc);

    expect(rootUrls(body.toc)).toEqual(urlsOf(TRIPLE.slice(0, 10)));
    expect(body.complete).toBe(false);
    expect(body.shownEntries).toBe(shown);
    expect(shown).toBeLessThan(body.totalEntries);
    expect(body.missing).toBe(
      `This is the first 10 top-level entries, each whole (${String(shown)} of ${String(body.totalEntries)} entries): ` +
      'the table of contents is larger than the 20000 tokens this resource holds, counted from entry titles as ' +
      `\`jamf_docs_get_toc\` counts \`maxTokens\`. The rest, from "${titleOf(TRIPLE[10])}" on, is on page 2 of \`jamf_docs_get_toc\` ` +
      'with `product: "jamf-pro"` and `maxTokens: 20000`.',
    );
  });

  it('puts the marker before the entries', async () => {
    tree = TRIPLE;
    const result = await client.readResource({ uri: URI });
    const { text } = result.contents[0] as { text: string };

    expect(Object.keys(JSON.parse(text) as object))
      .toEqual(['product', 'totalEntries', 'complete', 'shownEntries', 'missing', 'toc']);
  });

  it('names a range of pages when the rest is on more than one', async () => {
    tree = ftRootsCosting(Array.from({ length: 30 }, () => 1900));
    const body = await readToc();

    expect(body.toc).toHaveLength(10);
    expect(body.missing).toContain(`The rest, from "${titleOf(tree[10])}" on, is on pages 2 to 3 of \`jamf_docs_get_toc\``);
  });

  it('reaches every top-level entry once, with the resource and the pages it names', async () => {
    tree = ftRootsCosting([...JAMF_PRO_ROOT_COSTS.map(cost => cost * 3), ...JAMF_PRO_ROOT_COSTS.map(cost => cost * 2)]);
    const body = await readToc();
    const named = /on pages? (\d+)(?: to (\d+))? of `jamf_docs_get_toc` with `product: "([^"]+)"` and `maxTokens: (\d+)`/
      .exec(body.missing ?? '');
    expect(named).not.toBeNull();

    const [, from, to, product, maxTokens] = named!;
    // Absent when the note names one page.
    const last = Number((to as string | undefined) ?? from);
    const roots = rootUrls(body.toc);
    for (let page = Number(from); page <= last; page++) {
      const result = await client.callTool({
        name: 'jamf_docs_get_toc',
        arguments: { product, maxTokens: Number(maxTokens), page, responseFormat: 'json' },
      }) as CallResult;
      expect(result.isError).not.toBe(true);
      const json = JSON.parse((result.content[0] as TextContent).text) as { toc: TocEntry[]; pagination: { hasNext: boolean } };
      roots.push(...rootUrls(json.toc));
      expect(json.pagination.hasNext).toBe(page < last);
    }

    expect(roots).toEqual(urlsOf(tree));
  });

  it('says which entry it cut, and the budget that shows it whole', async () => {
    // One entry of 25000 tokens is page 1 on its own, cut to 20000.
    tree = ftRootsCosting([25000, 7]);
    const body = await readToc();

    expect(body.complete).toBe(false);
    expect(body.toc).toHaveLength(1);
    const shown = countTocEntries(body.toc);
    expect(body.shownEntries).toBe(shown);
    expect(shown).toBeLessThan(2085);
    expect(body.missing).toBe(
      `"Root 0" is larger on its own than the 20000 tokens this resource holds, so this shows the first ${String(shown)} ` +
      'of its 2085 entries; `jamf_docs_get_toc` with `product: "jamf-pro"` and `maxTokens: 25000` shows it whole. ' +
      `This is the first top-level entry (${String(shown)} of ${String(body.totalEntries)} entries): the table of ` +
      'contents is larger than the 20000 tokens this resource holds, counted from entry titles as `jamf_docs_get_toc` ' +
      'counts `maxTokens`. The rest, from "Root 1" on, is on page 2 of `jamf_docs_get_toc` with `product: "jamf-pro"` ' +
      'and `maxTokens: 20000`.',
    );
  });

  it('says "whole" of a single top-level entry that is', async () => {
    // Page 1 is one entry of 15000; the next, of 10000, does not fit beside it.
    tree = ftRootsCosting([15000, 10000]);
    const body = await readToc();

    expect(body.toc).toEqual(transformFtTocToTocEntries(tree.slice(0, 1)));
    expect(body.missing).toMatch(/^This is the first top-level entry, whole \(\d+ of \d+ entries\)/);
  });

  it('names the most maxTokens the tool accepts when that is what shows the cut entry whole', async () => {
    tree = ftRootsCosting([50000]);
    const body = await readToc();

    expect(body.complete).toBe(false);
    expect(body.missing).toBe(
      '"Root 0" is larger on its own than the 20000 tokens this resource holds, so this shows the first ' +
      `${String(body.shownEntries)} of its ${String(body.totalEntries)} entries; \`jamf_docs_get_toc\` with ` +
      '`product: "jamf-pro"` and `maxTokens: 50000` shows it whole.',
    );
  });

  it('says so when no maxTokens the tool accepts shows the cut entry whole', async () => {
    tree = ftRootsCosting([60000]);
    const body = await readToc();

    expect(body.complete).toBe(false);
    expect(body.missing).toContain('It needs 60000 tokens, more than `jamf_docs_get_toc` accepts as `maxTokens` (50000).');
    expect(body.missing).not.toContain('shows it whole');
  });

  it('holds an entry cut to fit on a later page, and says which', async () => {
    // Page 1 is an entry of 5 tokens; page 2 the next, cut to 19995, and the
    // two together are exactly what the resource holds.
    tree = ftRootsCosting([5, 25000]);
    const body = await readToc();

    expect(rootUrls(body.toc)).toEqual(urlsOf(tree));
    expect(body.complete).toBe(false);
    expect(body.missing).toBe(
      `"${titleOf(tree[1])}" is larger on its own than the 20000 tokens this resource holds, so this shows the first ` +
      `${String(body.shownEntries! - 2)} of its 2085 entries; \`jamf_docs_get_toc\` with \`product: "jamf-pro"\` and ` +
      '`maxTokens: 25000` shows it whole.',
    );
  });
});

describe('more top-level entries than 100 pages hold', () => {
  it('holds the first 100 pages and passes on why the rest cannot be reached', async () => {
    // A page holds at most ten top-level entries, whatever the budget.
    tree = ftRootsCosting(Array.from({ length: 1005 }, () => 5));
    const body = await readToc();

    expect(body.toc).toHaveLength(1000);
    expect(body.complete).toBe(false);
    expect(body.missing).toBe(
      `Only ${String(body.shownEntries)} of 2010 entries are here. ` +
      'At `maxTokens: 20000` this table of contents needs 101 pages, but `page` stops at 100, ' +
      'so the entries after page 100 cannot be reached at this budget. ' +
      'Not even `maxTokens: 50000` fits it in 100 pages.',
    );
  });

  it('names no page past 100 for the rest, and passes on why', async () => {
    // Page 1 is an entry of 19000 and nine of 5; pages 2 to 20 hold ten of 5
    // each, and page 21 would take the resource past 20000.
    tree = ftRootsCosting([19000, ...Array.from({ length: 1000 }, () => 5)]);
    const body = await readToc();

    expect(body.toc).toHaveLength(200);
    expect(body.missing).toContain(`The rest, from "${titleOf(tree[200])}" on, is on pages 21 to 100 of \`jamf_docs_get_toc\``);
    expect(body.missing).toMatch(/ At `maxTokens: 20000` this table of contents needs 101 pages, but `page` stops at 100,/);
  });

  it('reads no page past 100 from a TocProvider that always has another, and says so', async () => {
    const provided = transformFtTocToTocEntries(ftRootsCosting(Array.from({ length: 1500 }, () => 5)));
    const getTableOfContents = vi.fn(async (_product: string, _version: string, options?: FetchTocOptions) => {
      const page = options?.page ?? 1;
      return await Promise.resolve({
        toc: provided.slice((page - 1) * 10, page * 10),
        pagination: { page, pageSize: 10, totalPages: 150, totalItems: countTocEntries(provided), hasNext: page < 150, hasPrev: page > 1 },
        tokenInfo: { tokenCount: 50, truncated: false, maxTokens: options?.maxTokens ?? 5000 },
      });
    });
    ctx.tocProvider = { getTableOfContents };
    const body = await readToc();

    expect(getTableOfContents).toHaveBeenCalledTimes(100);
    expect(body.toc).toHaveLength(1000);
    expect(body.complete).toBe(false);
    // No call to point at: the tool's `page` stops at 100 as well.
    expect(body.missing).toBe(
      `Only ${String(body.shownEntries)} of ${String(countTocEntries(provided))} entries are here. ` +
      'The table-of-contents source has pages after page 100, the last one `jamf_docs_get_toc` accepts as `page`, ' +
      'so this holds nothing after it.',
    );
  });
});

describe('a TocProvider that does not page as asked', () => {
  // Thirty top-level entries of 100 tokens: three pages at 20000, all of
  // which the resource holds when they come as asked.
  const THIRTY = transformFtTocToTocEntries(ftRootsCosting(Array.from({ length: 30 }, () => 100)));

  it('stops at a page numbered other than the one asked for, and points at no call', async () => {
    const provided = transformFtTocToTocEntries(PRO_TREE);
    // Page 1 whatever page is asked for.
    const getTableOfContents = provide(provided, () => paginateTocEntries(provided, 1, 20000));
    const body = await readToc();

    expect(getTableOfContents).toHaveBeenCalledTimes(2);
    expect(rootUrls(body.toc)).toEqual(urlsOf(PRO_TREE.slice(0, 10)));
    expect(body.complete).toBe(false);
    expect(body.shownEntries).toBe(countTocEntries(body.toc));
    expect(body.missing).toBe(`Only ${String(body.shownEntries)} of 727 entries are here. ${notPaged(2, 'page 1')}`);
  });

  it.each([
    ['page 1 for every page, numbered as the page asked for', 2, (page: number) => servedAs(THIRTY, 1, page)],
    ['page 2 again for page 3, numbered 3', 3, (page: number) => servedAs(THIRTY, Math.min(page, 2), page)],
    ['entries page 1 held after new ones on page 2', 2, (page: number) => {
      const result = servedAs(THIRTY, page, page);
      return page === 1 ? result : { ...result, toc: [...result.toc.slice(0, 5), ...THIRTY.slice(0, 5)] };
    }],
  ])('stops at a page repeating top-level entries it held: %s', async (_label, asked, serve) => {
    const getTableOfContents = provide(THIRTY, (_result, page) => serve(page));
    const body = await readToc();

    expect(getTableOfContents).toHaveBeenCalledTimes(asked);
    // Each held once, and nothing from the page that repeated them.
    expect(body.toc).toEqual(THIRTY.slice(0, (asked - 1) * 10));
    expect(body.complete).toBe(false);
    const stopped = notPaged(asked, 'top-level entries an earlier page held');
    expect(body.missing).toBe(`Only ${String(body.shownEntries)} of ${String(countTocEntries(THIRTY))} entries are here. ${stopped}`);
  });

  it('names no page for the rest when that page repeats one it held', async () => {
    // Page 1 is ten entries of 1500 tokens; the same page again for page 2
    // would not fit beside it, but the rest is not on that page.
    const provided = transformFtTocToTocEntries(ftRootsCosting(Array.from({ length: 20 }, () => 1500)));
    provide(provided, (_result, page) => servedAs(provided, 1, page));
    const body = await readToc();

    expect(body.toc).toEqual(provided.slice(0, 10));
    const stopped = notPaged(2, 'top-level entries an earlier page held');
    expect(body.missing).toBe(`Only ${String(body.shownEntries)} of ${String(countTocEntries(provided))} entries are here. ${stopped}`);
  });

  it('names every cause: an entry cut on page 1, then a source that did not page', async () => {
    const provided = transformFtTocToTocEntries(ftRootsCosting([25000, 7, 9]));
    provide(provided, () => paginateTocEntries(provided, 1, 20000));
    const body = await readToc();

    expect(body.toc).toHaveLength(1);
    expect(body.missing).toBe(
      '"Root 0" is larger on its own than the 20000 tokens this resource holds, so this shows the first ' +
      `${String(body.shownEntries)} of its 2085 entries; \`jamf_docs_get_toc\` with \`product: "jamf-pro"\` and ` +
      '`maxTokens: 25000` shows it whole. ' +
      `Only ${String(body.shownEntries)} of ${String(countTocEntries(provided))} entries are here. ${notPaged(2, 'page 1')}`,
    );
  });
});

describe('a TocProvider that reports a cut without saying what it cut', () => {
  it('says which page was cut, and calls no page "whole"', async () => {
    // Two pages of ten entries of 1500 tokens; page 2 does not fit beside
    // page 1, and page 1 reports a cut it does not describe.
    const provided = transformFtTocToTocEntries(ftRootsCosting(Array.from({ length: 20 }, () => 1500)));
    provide(provided, (result, page) =>
      page === 1 ? { ...result, tokenInfo: { ...result.tokenInfo, truncated: true } } : result);
    const body = await readToc();

    expect(body.toc).toEqual(provided.slice(0, 10));
    expect(body.complete).toBe(false);
    expect(body.missing).toBe(
      `${cutUnsaid(1)} This is the first 10 top-level entries (${String(body.shownEntries)} of ` +
      `${String(body.totalEntries)} entries): the table of contents is larger than the 20000 tokens this resource ` +
      'holds, counted from entry titles as `jamf_docs_get_toc` counts `maxTokens`. The rest, from "Root 10" on, is on ' +
      'page 2 of `jamf_docs_get_toc` with `product: "jamf-pro"` and `maxTokens: 20000`.',
    );
  });

  it('marks a body whose every entry is here, when a later page it holds says it was cut', async () => {
    const provided = transformFtTocToTocEntries(PRO_TREE);
    provide(provided, (result, page) =>
      page === 2 ? { ...result, tokenInfo: { ...result.tokenInfo, truncated: true } } : result);
    const body = await readToc();

    expect(body.toc).toEqual(provided);
    expect(body.complete).toBe(false);
    expect(body.missing).toBe(cutUnsaid(2));
  });
});

describe('a TocProvider whose count is not the tree\'s', () => {
  it('says what the pages lack when they end short of the count', async () => {
    const provided = transformFtTocToTocEntries(PRO_TREE);
    provide(provided, result => ({ ...result, pagination: { ...result.pagination, totalItems: 732 } }));
    const body = await readToc();

    expect(body.toc).toEqual(provided);
    expect(body.complete).toBe(false);
    expect(body.missing).toBe(
      'Only 727 of 732 entries are here: the pages of the table-of-contents source, read to the last, hold fewer ' +
      'entries than it counts.',
    );
  });

  // `totalItems` counting top-level entries alone, so the count never falls
  // short: each cause the read found has to mark the body by itself.
  const topLevelOnly = (entries: TocEntry[]) => (result: FetchTocResult): FetchTocResult =>
    ({ ...result, pagination: { ...result.pagination, totalItems: entries.length } });
  const TRIPLE = transformFtTocToTocEntries(ftRootsCosting(JAMF_PRO_ROOT_COSTS.map(cost => cost * 3)));
  const PRO = transformFtTocToTocEntries(PRO_TREE);
  const ONE_CUT = transformFtTocToTocEntries(ftRootsCosting([25000]));
  const THIRTY = transformFtTocToTocEntries(ftRootsCosting(Array.from({ length: 30 }, () => 100)));
  // 150 pages of ten at 20000.
  const MANY = transformFtTocToTocEntries(ftRootsCosting(Array.from({ length: 1500 }, () => 5)));

  it.each([
    ['an entry cut to fit', ONE_CUT, (result: FetchTocResult) => result, 'shows it whole'],
    ['an entry cut to fit, named without `truncated` set', ONE_CUT,
      (result: FetchTocResult) => ({ ...result, tokenInfo: { ...result.tokenInfo, truncated: false } }), 'shows it whole'],
    ['a page cut without saying what', PRO.slice(0, 3),
      (result: FetchTocResult) => ({ ...result, tokenInfo: { ...result.tokenInfo, truncated: true } }), 'left out entries'],
    ['pages past the budget', TRIPLE, (result: FetchTocResult) => result, 'The rest, from'],
    ['a page numbered other than the one asked for', PRO, () => paginateTocEntries(PRO, 1, 20000), 'returned page 1'],
    ['a page repeating one held', THIRTY, (_result: FetchTocResult, page: number) => servedAs(THIRTY, 1, page),
      'an earlier page held'],
    ['pages past 100', MANY, (result: FetchTocResult, page: number) =>
      ({ ...result, pagination: { ...result.pagination, page, hasNext: true } }), 'pages after page 100'],
  ])('marks the body for %s', async (_label, entries, change, cause) => {
    const count = topLevelOnly(entries);
    provide(entries, (result, page) => count(change(result, page)));
    const body = await readToc();

    expect(body.shownEntries).toBeGreaterThanOrEqual(body.totalEntries);
    expect(body.complete).toBe(false);
    expect(body.missing).toContain(cause);
    expect(body.missing).not.toContain('Only ');
  });
});

describe('the resource as listed', () => {
  it('describes the whole table of contents, and the marker when it is not', async () => {
    const { resourceTemplates } = await client.listResourceTemplates();
    const toc = resourceTemplates.find(t => t.name === 'product-toc');

    expect(toc?.description).toContain('whole table of contents');
    expect(toc?.description).toContain('20000 tokens');
    // A bound on titles, which a host must not read as the body's size.
    expect(toc?.description).toContain('That bound is not the size of this body');
    expect(toc?.description).toContain('`complete`');
    expect(toc?.description).toContain('`missing`');
  });

  it('names every product in the products list, or none', async () => {
    // It named four, as though they were the list, beside a body of 28.
    const { resources } = await client.listResources();
    const description = resources.find(r => r.uri === 'jamf://products')?.description ?? '';
    const named = Object.values(JAMF_PRODUCTS).filter(p => description.includes(p.name));

    expect([0, Object.keys(JAMF_PRODUCTS).length]).toContain(named.length);
  });
});
