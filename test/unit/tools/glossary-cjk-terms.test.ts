/**
 * `jamf_docs_glossary_lookup` for a term in another language than the
 * glossary's: the registered tool over MCP, with the real glossary service
 * and formatter, and only the maps registry's glossary map and the two Fluid
 * Topics calls mocked.
 *
 * Jamf publishes its glossary in en-US only: the live maps list had one
 * glossary map on 2026-09-28, in en-US, and all 123 of its titles are ASCII.
 * For any other `language`, the lookup reads that one. Until 2026-09-28 a
 * term it did not have got "No glossary entries found" and nothing else,
 * so a user asking in Chinese was not told why: live that day, 憑證, 密碼,
 * 登入 and 裝置 in zh-TW, and 認証, 証明書, 暗号 and 登録 in ja-JP, all
 * answered so. The JSON reply did carry a warning, which said "Showing
 * English results." beside none.
 *
 * The lookup reads a glossary in the language asked for where Jamf publishes
 * one, and its word rules were written for Latin text. A term of four
 * characters or fewer is an abbreviation that must be a whole word of a
 * title, and a word ended where a letter or digit did not follow. Chinese and
 * Japanese put nothing between words, and Jamf's zh-TW titles write a Latin
 * word straight against a Chinese one, as in 解決APNs憑證不符問題 ("Resolve an
 * APNs certificate mismatch") and PKI憑證 ("PKI certificate"). So 憑證
 * ("certificate") did not match PKI憑證. Katakana, which spells loanwords
 * letter by letter as Latin does, keeps a rule of its own: ロック ("lock") is
 * not a word of ブロックページ ("block page"). The last describe blocks run
 * glossaries of such titles, in zh-TW and ja-JP; Jamf publishes neither today.
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

// ── Glossaries in zh-TW and ja-JP, which Jamf does not publish ──────────────

/**
 * Titles in the style of Jamf's documentation in each language. PKI憑證,
 * SSL憑證 and 設定Apple推播通知服務（APNs）憑證 are live zh-TW topic titles,
 * and ブロックページ, アクティベーションロック and
 * デバイスのロックまたはロック解除 live ja-JP ones; the rest are written the
 * same way.
 */
const OTHER_GLOSSARY_TITLES: Partial<Record<string, string[]>> = {
  'zh-TW': [
    '憑證授權單位（CA）',
    '推送憑證',
    'PKI憑證',
    'SSL憑證',
    '組態描述檔',
    'MDM描述檔',
    '行動裝置管理（MDM）',
    '設定Apple推播通知服務（APNs）憑證',
  ],
  'ja-JP': [
    'ブロックページ',
    'アクティベーションロック',
    'デバイスのロックまたはロック解除',
    'ロックダウンモード',
    'サーバーの設定',
  ],
};

const glossaryMapIdIn = (locale: string): string => `${locale}-glossary`;

/** The locale of one of the glossaries above, from its map id. */
function localeOfMap(mapId: string): string | undefined {
  return Object.keys(OTHER_GLOSSARY_TITLES).find(locale => glossaryMapIdIn(locale) === mapId);
}

function otherGlossaryToc(locale: string): FtTocNode[] {
  return glossaryToc((OTHER_GLOSSARY_TITLES[locale] ?? []).map((title, i): FtTocNode => ({
    tocId: `toc-${locale}-${String(i)}`,
    contentId: `${locale}-${String(i)}`,
    title,
    prettyUrl: `/r/${locale}/jamf-technical-glossary/${locale}-${String(i)}`,
    children: [],
  })));
}

function otherGlossaryContent(locale: string, contentId: string): string {
  const title = OTHER_GLOSSARY_TITLES[locale]?.[Number(contentId.slice(locale.length + 1))] ?? contentId;
  return `<div class="content-locale-${locale}"><div id="glossentry-1">` +
    `<div class="abstract glossdef"><p class="p">${title}。</p></div></div></div>`;
}

// ── Harness ─────────────────────────────────────────────────────────────────

let ctx: ServerContext;
let server: McpServer;
let client: Client;
/** Whether the glossaries above are published. Off, en-US is the only one, as live. */
let othersPublished = false;
/** Whether the maps registry fails when asked for the en-US glossary. */
let englishResolveFails = false;

/** The maps registry's, which falls back to en-US for a locale with no glossary. */
const resolveGlossaryMapId = vi.fn(async (locale?: string): Promise<string> => {
  if (englishResolveFails && locale === 'en-US') { throw new Error('maps list unreadable'); }
  return await Promise.resolve(
    othersPublished && locale !== undefined && locale in OTHER_GLOSSARY_TITLES
      ? glossaryMapIdIn(locale)
      : GLOSSARY_MAP_ID,
  );
});

beforeAll(async () => {
  server = new McpServer({ name: 'test', version: '0.0.1' });
  ctx = createMockContext();
  ctx.mapsRegistry.resolveGlossaryMapId = resolveGlossaryMapId;
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
  othersPublished = false;
  englishResolveFails = false;
  const en = serveGlossaryContent(() => new Set());
  vi.mocked(fetchMapToc).mockImplementation(async (_http, mapId) => {
    const locale = localeOfMap(mapId);
    return await Promise.resolve(locale !== undefined ? otherGlossaryToc(locale) : LIVE_GLOSSARY_TOC);
  });
  vi.mocked(fetchTopicContent).mockImplementation(async (http, mapId, contentId) => {
    const locale = localeOfMap(mapId);
    return locale !== undefined
      ? await Promise.resolve(otherGlossaryContent(locale, contentId))
      : await en(http, mapId, contentId);
  });
});

async function lookup(args: Record<string, unknown>): Promise<CallResult> {
  return await client.callTool({ name: 'jamf_docs_glossary_lookup', arguments: args }) as CallResult;
}

const TIP = '*Tip: Try using `jamf_docs_search` with `docType: "glossary"` for broader results.*';

/**
 * The note a no-match carries when the English glossary answered a term in
 * another script than Latin, asked in `language`.
 */
function notPublishedIn(language: string, code: (s: string) => string = s => s): string {
  return `${englishOnly(language)} Look up the English term ` +
    `instead, or search for it with ${code('jamf_docs_search')} and ${code(`language: "${language}"`)}.`;
}

/**
 * The note a no-match carries when the English glossary answered a Latin term
 * asked in `language`: it may be English already, so it is not told to look
 * up the English term.
 */
function englishOnly(language: string): string {
  return `Note: Jamf does not publish the glossary in ${language}, so the term was looked up in ` +
    'the English (en-US) glossary, whose entries are named in English.';
}

/** The note a no-match carries for a term in another script than Latin, looked up in English. */
function termNotInEnglish(code: (s: string) => string = s => s): string {
  return 'Note: The term was looked up in the English (en-US) glossary, whose entries are named in ' +
    `English. Look up the English term instead, or search for it with ${code('jamf_docs_search')} ` +
    'in the language it is written in.';
}

const md = (s: string): string => `\`${s}\``;

const NO_MATCH_STRUCTURED = (term: string): Record<string, unknown> => ({
  term, totalMatches: 0, entries: [], truncated: false,
});

// ── The English glossary, asked in another language ─────────────────────────

describe('a term the glossary does not have, asked in a language Jamf does not publish it in', () => {
  it.each([
    ['憑證', 'zh-TW'],
    ['認証', 'ja-JP'],
  ])('%s in %s says the English glossary answered, and to look up the English term', async (term, language) => {
    for (const outputMode of ['full', 'compact']) {
      const result = await lookup({ term, language, outputMode });

      expect(result.isError).not.toBe(true);
      expect(textOf(result)).toBe(
        `No glossary entries found for "${term}".\n\n> ${notPublishedIn(language, md)}\n\n${TIP}`,
      );
      expect(result.structuredContent).toEqual(NO_MATCH_STRUCTURED(term));
    }
  });

  it.each([
    // A typo of the English "Smart Group", asked by a zh-TW user.
    ['Smart Grup', 'zh-TW'],
    ['Zertifikat', 'de-DE'],
  ])('%s in %s, a Latin term, says only that the English glossary answered', async (term, language) => {
    // A Latin term may already be the English one, so "Look up the English
    // term instead" would send it back to what it asked.
    for (const outputMode of ['full', 'compact']) {
      const result = await lookup({ term, language, outputMode });

      expect(textOf(result)).toBe(`No glossary entries found for "${term}".\n\n> ${englishOnly(language)}\n\n${TIP}`);
      expect(result.structuredContent).toEqual(NO_MATCH_STRUCTURED(term));
    }
    const json = await lookup({ term, language, responseFormat: 'json' });
    expect(JSON.parse(textOf(json))).toMatchObject({ totalMatches: 0, warning: englishOnly(language) });
  });

  it('and in JSON, where the warning used to say "Showing English results." beside none', async () => {
    const result = await lookup({ term: '憑證', language: 'zh-TW', responseFormat: 'json' });

    expect(JSON.parse(textOf(result))).toEqual({
      term: '憑證',
      totalMatches: 0,
      entries: [],
      tokenInfo: { tokenCount: 0, truncated: false, maxTokens: 5000 },
      warning: notPublishedIn('zh-TW'),
    });
  });

  it('when the registry cannot say which glossary it read, takes it to be the English one', async () => {
    // The lookup asks the maps registry for the en-US glossary too, to tell
    // whether it fell back to it. If that fails, the lookup still answers.
    englishResolveFails = true;

    const result = await lookup({ term: '憑證', language: 'zh-TW' });

    expect(result.isError, textOf(result)).not.toBe(true);
    expect(textOf(result)).toBe(`No glossary entries found for "憑證".\n\n> ${notPublishedIn('zh-TW', md)}\n\n${TIP}`);
    expect(resolveGlossaryMapId.mock.calls).toEqual([['zh-TW'], ['en-US']]);
  });
});

describe('a term in another script than Latin, asked in English', () => {
  it.each([
    [{ term: '憑證' }],
    [{ term: '認証', language: 'en-US' }],
    [{ term: 'MDM 設定' }],
    // "certificate" in Thai.
    [{ term: 'ใบรับรอง' }],
  ])('%j says the glossary is English, in markdown and JSON', async (args) => {
    const markdown = await lookup(args);
    const json = await lookup({ ...args, responseFormat: 'json' });

    expect(textOf(markdown)).toBe(
      `No glossary entries found for "${args.term}".\n\n> ${termNotInEnglish(md)}\n\n${TIP}`,
    );
    expect(JSON.parse(textOf(json))).toMatchObject({ totalMatches: 0, warning: termNotInEnglish() });
  });
});

describe('what does not change', () => {
  it('a Latin term the glossary does not have, in English, gets no note', async () => {
    const markdown = await lookup({ term: 'Apple Classroom Pro' });
    const json = await lookup({ term: 'Apple Classroom Pro', language: 'en-US', responseFormat: 'json' });

    expect(textOf(markdown)).toBe(`No glossary entries found for "Apple Classroom Pro".\n\n${TIP}`);
    expect(JSON.parse(textOf(json))).not.toHaveProperty('warning');
  });

  it('a match asked in another language keeps its warning', async () => {
    const markdown = await lookup({ term: 'MDM', language: 'zh-TW' });
    const json = await lookup({ term: 'MDM', language: 'zh-TW', responseFormat: 'json' });

    const warning = 'Note: Glossary content is currently only available in English (en-US). Showing English results.';
    expect(textOf(markdown)).toContain(`# Glossary Lookup: "MDM"\n\n> ${warning}\n\nFound 2 matches`);
    expect(JSON.parse(textOf(json))).toMatchObject({ totalMatches: 2, warning });
  });
});

// ── A glossary in the language asked for ────────────────────────────────────

describe('a glossary Jamf publishes in the language asked for', () => {
  beforeEach(() => { othersPublished = true; });

  async function terms(term: string, language = 'zh-TW'): Promise<string[]> {
    const result = await lookup({ term, language });
    expect(result.isError, textOf(result)).not.toBe(true);
    return (result.structuredContent?.entries as { term: string }[]).map(e => e.term);
  }

  it('matches a Chinese term written against a Latin word', async () => {
    // Until 2026-09-28, PKI憑證 and SSL憑證 were not 憑證 as a word, because
    // a letter comes before it.
    expect(await terms('憑證')).toEqual([
      '憑證授權單位（CA）', '推送憑證', 'PKI憑證', 'SSL憑證', '設定Apple推播通知服務（APNs）憑證',
    ]);
    expect(await terms('描述檔')).toEqual(['組態描述檔', 'MDM描述檔']);
    // And after it: 設定 ("set up") is written against Apple.
    expect(await terms('設定')).toEqual(['設定Apple推播通知服務（APNs）憑證']);
  });

  it('holds a Katakana term to a whole word, as it does a Latin one', async () => {
    // Katakana spells loanwords letter by letter, so ロック ("lock") is in
    // ブロック ("block") the way lock is in block. Until 2026-09-28 it was a
    // word of ブロックページ ("block page"), since a Katakana letter counted as
    // a delimiter. Nor is it a word of ロックダウンモード ("Lockdown Mode") or
    // アクティベーションロック ("Activation Lock"), each written solid, as lock
    // is not of lockdown or activationlock. Hiragana beside it bounds it.
    expect(await terms('ロック', 'ja-JP')).toEqual(['デバイスのロックまたはロック解除']);
    // The long vowel mark is not a letter of its own: サーバー is サーバ
    // ("server") spelled with it.
    expect(await terms('サーバ', 'ja-JP')).toEqual(['サーバーの設定']);
  });

  it('still holds a Latin abbreviation to a whole word, which a Chinese one bounds', async () => {
    // The entry that defines it in full-width parentheses first: see
    // glossary-fullwidth-parentheses.test.ts. Until 2026-09-28 MDM描述檔 was.
    expect(await terms('MDM')).toEqual(['行動裝置管理（MDM）', 'MDM描述檔']);
    expect(await terms('DM')).toEqual([]);
  });

  it('says nothing about English, in either format', async () => {
    const markdown = await lookup({ term: '憑證', language: 'zh-TW' });
    const json = await lookup({ term: '憑證', language: 'zh-TW', responseFormat: 'json' });
    const none = await lookup({ term: '密碼', language: 'zh-TW' });

    expect(textOf(markdown)).not.toContain('English');
    expect(JSON.parse(textOf(json))).not.toHaveProperty('warning');
    expect(textOf(none)).toBe(`No glossary entries found for "密碼".\n\n${TIP}`);
  });
});
