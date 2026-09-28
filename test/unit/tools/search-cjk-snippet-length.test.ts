/**
 * Which excerpts `jamf_docs_search` shows as a result's snippet, and which it
 * replaces with the title and product as too short to say anything: the
 * registered tool over MCP, with the real search service and Fluid Topics
 * stubbed with live excerpts (2026-09-28).
 *
 * The minimum is 50 characters of Latin text. Until 2026-09-28 it was 50
 * characters of any text, and a Chinese or Japanese sentence says in 50
 * characters what an English one says in two to three times as many. So
 * whole sentences were replaced: the ja-JP course "構成プロファイル
 * (Configuration Profiles)", whose 40-character excerpt says "Create and
 * deploy configuration profiles to enrolled computers and mobile devices.",
 * had the snippet "構成プロファイル (Configuration Profiles) — Jamf Pro".
 * A Han character now counts as four Latin ones and a Hiragana or Katakana
 * one as one and a half (see `latinLength` in content-parser.ts).
 *
 * The topic filter reads a result's snippet with its title, unless the
 * snippet is the title and product. So an excerpt that is now kept can match
 * a topic its title does not, and a search filtered by that topic keeps the
 * result where the topic used to be removed.
 */

import { describe, it, expect } from 'vitest';
import { callSearch, PRESTAGE, searchUpstream } from '../../helpers/search-upstream.js';
import { cleanSnippet } from '../../../src/core/services/content-parser.js';
import { loadFixture } from '../../helpers/fixtures.js';
import type { FtSearchEntry, FtSearchTopic } from '../../../src/core/types.js';

function prestageTopic(): FtSearchTopic {
  const { topic } = PRESTAGE;
  if (topic === undefined) { throw new Error('PRESTAGE is a topic'); }
  return topic;
}

const topic = prestageTopic();

/** A Jamf Pro topic titled `title` whose excerpt is `htmlExcerpt`, as Fluid Topics returns it. */
function entry(title: string, htmlExcerpt: string): FtSearchEntry {
  return {
    ...PRESTAGE,
    topic: {
      ...topic,
      contentId: title,
      title,
      htmlTitle: title,
      htmlExcerpt,
      metadata: (topic.metadata ?? []).map(m => m.key === 'ft:clusterId' ? { ...m, values: [title] } : m),
    },
  };
}

/** The snippet `jamf_docs_search` returns for `found`, searched in `language`. */
async function snippetOf(found: FtSearchEntry, language: string): Promise<string> {
  const { ctx } = searchUpstream({ clusteredSearch: () => [found] });
  const reply = await callSearch(ctx, { query: 'profiles', language, responseFormat: 'json' });
  expect(reply.isError, reply.text).not.toBe(true);
  const [result] = (reply.structuredContent?.results ?? []) as ({ snippet: string } | undefined)[];
  const [inText] = (JSON.parse(reply.text) as { results: ({ snippet: string } | undefined)[] }).results;
  expect(inText?.snippet).toBe(result?.snippet);
  return result?.snippet ?? '';
}

interface Group { entries: (FtSearchEntry | undefined)[] }

describe('an excerpt in Chinese or Japanese', () => {
  it('that is a whole sentence is the snippet, however few its characters', async () => {
    // The live course entry, as Fluid Topics returned it.
    const groups = loadFixture('ft-search-training-courses.json') as Partial<Record<string, Group>>;
    const course = groups.configurationProfilesJa?.entries[0];
    if (course === undefined) { throw new Error('no fixture group configurationProfilesJa'); }
    expect(course.type).toBe('DOCUMENT');

    expect(await snippetOf(course, 'ja-JP'))
      .toBe('登録済みのコンピュータとモバイルデバイスに構成プロファイルを作成して展開します。');
    // "The VPP Codes category shows a list of the VPP codes users redeemed":
    // 29 characters, 17 of them Han.
    expect(await snippetOf(entry('VPP 代碼類別', '<span class="kwicstring">「</span><span class="kwicmatch">VPP</span>'
      + '<span class="kwicstring"> 代碼」類別顯示使用者已兌換的 </span><span class="kwicmatch">VPP</span>'
      + '<span class="kwicstring"> 代碼清單。</span>'), 'zh-TW'))
      .toBe('「VPP 代碼」類別顯示使用者已兌換的 VPP 代碼清單。');
  });

  it('that is a few words is replaced, as the same few words in English are', async () => {
    // Release notes of one line, "Third-party library update": 15 and 8
    // characters, 26 in English.
    expect(await snippetOf(entry('2.6.3 (2026/03/03)', '<span class="kwicstring">サードパーティライブラリの更新</span>'), 'ja-JP'))
      .toBe('2.6.3 (2026/03/03) — Jamf Pro');
    expect(await snippetOf(entry('2.6.3（2026 年 3 月 3 日）', '<span class="kwicstring">更新第三方程式庫</span>'), 'zh-TW'))
      .toBe('2.6.3（2026 年 3 月 3 日） — Jamf Pro');
  });
});

describe('an excerpt of Latin text', () => {
  it('is held to 50 characters, as it was', async () => {
    // Live, the course "Shared iPad in Jamf School" (37 characters).
    expect(await snippetOf(entry('Shared iPad in Jamf School', 'Enroll Shared iPads into Jamf School.'), 'en-US'))
      .toBe('Shared iPad in Jamf School — Jamf Pro');
    const fifty = 'Enable the setting to deploy it to managed devices.'.slice(0, 50);
    expect(cleanSnippet(fifty, 'Title', 'Jamf Pro')).toBe(fifty);
    expect(cleanSnippet(fifty.slice(0, 49), 'Title', 'Jamf Pro')).toBe('Title — Jamf Pro');
  });

  it('counts a combining mark as one, though Unicode lists the dot below as written with Kana too', () => {
    // "Third-party libraries updated." in Vietnamese, written decomposed: 49
    // UTF-16 units, three of them the combining dot below (U+0323).
    const marked = 'Cập nhật các thư viện của bên thứ ba.'.normalize('NFD');
    expect(marked).toHaveLength(49);
    expect(marked.split('\u0323')).toHaveLength(4);
    expect(cleanSnippet(marked, 'Title', 'Jamf Pro')).toBe('Title — Jamf Pro');
  });
});

describe('the topic filter', () => {
  it('matches a Chinese or Japanese result by its excerpt, now that the excerpt is its snippet', async () => {
    // Live, 2026-09-28: "Using LAPS" in zh-TW, whose excerpt ("Once LAPS is
    // enabled, you can use the Jamf Pro interface or the Jamf Pro API to
    // implement LAPS.") names the API, and whose title has no word of topic
    // api. Until then the excerpt was replaced, the filter matched nothing,
    // and the topic was removed.
    const laps = entry('使用LAPS', '<span class="kwicstring">啟用LAPS後，您就可以使用Jamf Pro介面或Jamf Pro </span>'
      + '<span class="kwicmatch">API</span><span class="kwicstring">來實作LAPS。</span>');
    const { ctx } = searchUpstream({ clusteredSearch: () => [laps] });

    const reply = await callSearch(ctx, { query: 'LAPS', language: 'zh-TW', topic: 'api', responseFormat: 'json' });

    expect(reply.isError, reply.text).not.toBe(true);
    expect(reply.structuredContent?.filterRelaxation).toBeUndefined();
    expect(reply.structuredContent?.results).toEqual([expect.objectContaining({
      title: '使用LAPS',
      snippet: '啟用LAPS後，您就可以使用Jamf Pro介面或Jamf Pro API來實作LAPS。',
    })]);
  });

  it('still reads the title alone where the excerpt is replaced', async () => {
    const note = entry('2.6.3 (2026/03/03)', '<span class="kwicstring">サードパーティライブラリの更新</span>');
    const { ctx } = searchUpstream({ clusteredSearch: () => [note] });

    const reply = await callSearch(ctx, { query: 'library', language: 'ja-JP', topic: 'api', responseFormat: 'json' });

    expect((reply.structuredContent?.filterRelaxation as { removed?: unknown } | undefined)?.removed).toEqual(['topic']);
  });
});

describe('the length an excerpt is held to', () => {
  it('counts a Han character as four Latin ones, and Hiragana and Katakana as one and a half', () => {
    const han = '設定描述檔部署到受管理的裝置上'; // 15 Han: 60
    expect(cleanSnippet(han.slice(0, 13), 'T', null)).toBe(han.slice(0, 13)); // 52
    expect(cleanSnippet(han.slice(0, 12), 'T', null)).toBe('T'); // 48
    const kana = 'コンピュータとモバイルデバイスにプロファイルをインストールしました'; // 33 Kana: 49.5
    expect(cleanSnippet(`${kana}。`, 'T', null)).toBe(`${kana}。`); // 。 is written in Kana too: 51
    expect(cleanSnippet(kana, 'T', null)).toBe('T');
    // Latin letters beside them count as one each, as ever.
    expect(cleanSnippet(`Jamf Pro: ${han.slice(0, 10)}`, 'T', null)).toBe(`Jamf Pro: ${han.slice(0, 10)}`); // 10 + 40
    expect(cleanSnippet(`Jamf Pro ${han.slice(0, 10)}`, 'T', null)).toBe('T'); // 9 + 40
  });
});
