/**
 * Which entry `jamf_docs_glossary_lookup` puts first for an abbreviation that
 * a Chinese title defines in full-width parentheses, 行動裝置管理（MDM）
 * ("mobile device management (MDM)"): the registered tool over MCP, with the
 * real glossary service and formatter, and only the maps registry's glossary
 * map and the two Fluid Topics calls mocked.
 *
 * The entry whose title writes the abbreviation in parentheses defines it, and
 * ranks before one that only mentions it (see `boundaryMatchRank`). Until
 * 2026-09-28 only ASCII parentheses counted, so in a zh-TW glossary MDM描述檔
 * ("MDM profile") came first, as the shorter title. Jamf's zh-TW translations
 * write them full-width: 第7課：行動裝置管理（MDM） and
 * 設定Apple推播通知服務（APNs）憑證, live on 2026-09-28, where the ja-JP
 * titles of the same pages write `(MDM)` and `(APNs)`. Jamf publishes its
 * glossary in en-US only today, so these suites serve one in zh-TW.
 */

import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

vi.mock('../../../src/core/services/ft-client.js', async (importOriginal) => ({
  ...await importOriginal<typeof FtClientModule>(),
  fetchMapToc: vi.fn(),
  fetchTopicContent: vi.fn(),
}));

import { McpServer } from '@modelcontextprotocol/server';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import type * as FtClientModule from '../../../src/core/services/ft-client.js';
import { fetchMapToc, fetchTopicContent } from '../../../src/core/services/ft-client.js';
import { registerGlossaryLookupTool } from '../../../src/core/tools/glossary-lookup.js';
import { createMockContext } from '../../helpers/mock-context.js';
import {
  GLOSSARY_MAP_ID,
  LIVE_GLOSSARY_TOC,
  glossaryToc,
  http503,
  serveGlossaryContent,
} from '../../helpers/glossary-upstream.js';
import type { FtTocNode } from '../../../src/core/types.js';
import type { ServerContext } from '../../../src/core/types/context.js';

interface TextContent { type: 'text'; text: string }

interface CallResult {
  isError?: boolean;
  content: unknown[];
  structuredContent?: Record<string, unknown>;
}

function textOf(result: CallResult): string {
  return (result.content[0] as TextContent).text;
}

const ZH_TW_MAP_ID = 'zh-TW-glossary';

/**
 * A zh-TW glossary, its titles written as Jamf's zh-TW translations write
 * them. The last names MDM in parentheses without defining it: the term does
 * not close them.
 */
const ZH_TW_TITLES = [
  'MDM描述檔',
  '行動裝置管理（MDM）',
  'APNs憑證',
  '設定Apple推播通知服務（APNs）憑證',
  '註冊描述檔（MDM描述檔）',
];

const idOf = (i: number): string => `zh-TW-${String(i)}`;

const ZH_TW_TOC: FtTocNode[] = glossaryToc(ZH_TW_TITLES.map((title, i): FtTocNode => ({
  tocId: `toc-${idOf(i)}`,
  contentId: idOf(i),
  title,
  prettyUrl: `/r/zh-TW/jamf-technical-glossary/${idOf(i)}`,
  children: [],
})));

function titleOf(contentId: string): string {
  return ZH_TW_TITLES[Number(contentId.slice('zh-TW-'.length))] ?? contentId;
}

let ctx: ServerContext;
let server: McpServer;
let client: Client;
/** zh-TW titles whose definition answers 503. */
let failing = new Set<string>();

beforeAll(async () => {
  server = new McpServer({ name: 'test', version: '0.0.1' });
  ctx = createMockContext();
  ctx.mapsRegistry.resolveGlossaryMapId = vi.fn(async (locale?: string) =>
    await Promise.resolve(locale === 'zh-TW' ? ZH_TW_MAP_ID : GLOSSARY_MAP_ID));
  registerGlossaryLookupTool(server, ctx);

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
  vi.clearAllMocks();
  await ctx.cache.clear();
  failing = new Set();
  const en = serveGlossaryContent(() => new Set());
  vi.mocked(fetchMapToc).mockImplementation(async (_http, mapId) =>
    await Promise.resolve(mapId === ZH_TW_MAP_ID ? ZH_TW_TOC : LIVE_GLOSSARY_TOC));
  vi.mocked(fetchTopicContent).mockImplementation(async (http, mapId, contentId) => {
    if (mapId !== ZH_TW_MAP_ID) { return await en(http, mapId, contentId); }
    const title = titleOf(contentId);
    if (failing.has(title)) {
      throw http503(`https://learn.jamf.com/api/khub/maps/${mapId}/topics/${contentId}/content`);
    }
    return await Promise.resolve('<div class="content-locale-zh-TW"><div id="glossentry-1">' +
      `<div class="abstract glossdef"><p class="p">${title}。</p></div></div></div>`);
  });
});

async function lookup(args: Record<string, unknown>): Promise<CallResult> {
  return await client.callTool({ name: 'jamf_docs_glossary_lookup', arguments: args }) as CallResult;
}

async function terms(term: string, language: string): Promise<string[]> {
  const result = await lookup({ term, language });
  expect(result.isError, textOf(result)).not.toBe(true);
  return (result.structuredContent?.entries as { term: string }[]).map(e => e.term);
}

describe('an abbreviation a title defines in full-width parentheses', () => {
  it('puts the entry that defines it first, before one that starts with it', async () => {
    // 註冊描述檔（MDM描述檔） neither defines MDM nor starts with it.
    expect(await terms('MDM', 'zh-TW')).toEqual(['行動裝置管理（MDM）', 'MDM描述檔', '註冊描述檔（MDM描述檔）']);
    expect(await terms('APNs', 'zh-TW')).toEqual(['設定Apple推播通知服務（APNs）憑證', 'APNs憑證']);
  });

  it('is an error, not an answer led by another entry, when the entry that defines it cannot be fetched', async () => {
    // The ranker's order is also what decides which entry would have led the
    // answer: until 2026-09-28 the lookup answered MDM描述檔 first here, with
    // a note that 行動裝置管理（MDM） could not be fetched.
    failing = new Set(['行動裝置管理（MDM）']);

    const result = await lookup({ term: 'MDM', language: 'zh-TW' });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain(
      'Glossary lookup for "MDM" failed: the entry whose title names it, 行動裝置管理（MDM）, could not be fetched',
    );
  });
});

describe('what does not change', () => {
  it('ASCII parentheses rank as before, in the English glossary too', async () => {
    expect(await terms('MDM', 'en-US')).toEqual(['mobile device management (MDM)', 'User Approved MDM']);
  });
});
