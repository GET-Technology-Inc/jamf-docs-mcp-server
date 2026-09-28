/**
 * The queries `jamf_docs_search` suggests when a Chinese or Japanese search
 * finds nothing: the registered tool over MCP, with the real search service
 * and suggestions, and Fluid Topics answering with no results.
 *
 * The suggestions are built from a query's words, and until 2026-09-28 a word
 * was a run of `\w`: ASCII letters, digits and `_`. Every Chinese and Japanese
 * character was read as a space, so such a query had no words, and its
 * no-results reply offered nothing to run. Live on 2026-09-28, the quoted
 * `"推送證書續約失敗"` ("push certificate renewal failure") in zh-TW had no
 * results and no suggestion, while `"renew push certificate failed"` had
 * `renew push certificate`: without the quotes, and without its last word.
 *
 * Those words are suggested only in a language whose documentation is written
 * as they are. The en-US documentation, the default, is in English: there such
 * a query is suggested its Latin words only, as before, and is told to search
 * with the English terms or in the languages its words are written in.
 *
 * What is not here: a suggestion for a single word, such as 證書, which Fluid
 * Topics does not have in zh-TW. The alternatives a word gets come from an
 * English table of synonyms, so a Chinese or Japanese word has none.
 */

import { describe, it, expect } from 'vitest';
import { callSearch, searchUpstream } from '../../helpers/search-upstream.js';

/** `structuredContent.suggestions`, the JSON text's, and the markdown, for one query. */
async function suggest(query: string, language: string): Promise<{
  structured: unknown;
  json: unknown;
  markdown: string;
}> {
  const { ctx } = searchUpstream();
  const markdown = await callSearch(ctx, { query, language });
  const json = await callSearch(ctx, { query, language, responseFormat: 'json' });
  for (const reply of [markdown, json]) {
    expect(reply.isError, reply.text).not.toBe(true);
    expect(reply.structuredContent?.totalResults).toBe(0);
  }
  return {
    structured: markdown.structuredContent?.suggestions,
    json: (JSON.parse(json.text) as { suggestions?: unknown }).suggestions,
    markdown: markdown.text,
  };
}

describe('a Chinese or Japanese query with no results', () => {
  it('suggests its words, unquoted, as a Latin query gets', async () => {
    // The Latin query this mirrors: `"renew push certificate failed"` gets
    // `renew push certificate` (pinned below).
    const reply = await suggest('"推送證書續約失敗"', 'zh-TW');

    expect(reply.structured).toEqual(['推送 證書 續約']);
    expect(reply.json).toEqual(['推送 證書 續約']);
    expect(reply.markdown).toContain('**Try simpler query**: `推送 證書 續約`');
  });

  it('finds the same words when they are typed with spaces', async () => {
    expect((await suggest('"推送 證書 續約 失敗"', 'zh-TW')).structured).toEqual(['推送 證書 續約']);
  });

  it('keeps a Japanese word whole across its long vowel mark', async () => {
    // ー is in the Common script. Read as a separator, it would cut
    // パスワード ("password") into パスワ and ド.
    const reply = await suggest('"パスワードの変更とリセットの方法"', 'ja-JP');

    expect(reply.structured).toEqual(['パスワード 変更 リセット']);
  });

  it('leaves out a Japanese word in Hiragana alone, as it does an English stop word', async () => {
    // From a live support.jamf.com title, "Get support from the Jamf account team".
    // から ("from") would otherwise be the third word.
    const reply = await suggest('"アカウントチームからのサポートを受ける"', 'ja-JP');

    expect(reply.structured).toEqual(['アカウント チーム サポート']);
  });

  it('keeps a Japanese word of Kanji and Hiragana, which is not Hiragana alone', async () => {
    // "Change the settings for receiving notifications": 受け取る ("receive")
    // is Kanji and Hiragana, and the second of its four words; を is left out.
    const reply = await suggest('"通知を受け取る設定を変更"', 'ja-JP');

    expect(reply.structured).toEqual(['通知 受け取る 設定']);
  });

  it('does not suggest the query it was given, with the 、 between its words left out', async () => {
    // 、 is punctuation, not a word, so 推送、證書、續約 is already as simple
    // as a query of three words gets. Read as a word, it would make the query
    // look longer than its suggestion, and the suggestion would be the query.
    expect((await suggest('推送、證書、續約', 'zh-TW')).structured).toEqual([]);
  });

  it('keeps the Latin words of a mixed query, and adds its Chinese ones', async () => {
    // Until 2026-09-28 the Chinese words were read as spaces, so this query's
    // only word was `apns`, and it had no simpler query to suggest.
    const reply = await suggest('"APNs證書 續約 失敗"', 'zh-TW');

    expect(reply.structured).toEqual(['apns 證書 續約']);
  });

  it('gives a Latin word written against Chinese its own synonyms, as before', async () => {
    // SSO設定 is "SSO settings". The Latin part is a word of its own, as it
    // was when the Chinese one was read as a space.
    const reply = await suggest('SSO設定', 'zh-TW');

    expect(reply.structured).toEqual(['single sign-on', 'authentication', 'identity', 'login']);
  });
});

describe('a Chinese, Japanese or Korean query with no results, in a language whose documentation is not in its script', () => {
  // The en-US documentation is in English, so a suggestion made of a query's
  // Chinese words cannot match anything in it: live on 2026-09-28,
  // 推送 證書 續約 ("push certificate renewal") had no results in en-US, the
  // default, and 50 in zh-TW. Such a query is suggested what it was before
  // its Chinese, Japanese and Korean words were read, its Latin words only,
  // and is told where its words can be found.

  const han = 'This query has words in Chinese or Japanese, and the documentation in "en-US" (the default language) ' +
    'is in English, so it does not have them. Search it with the English terms. Or search with language: ' +
    '"zh-TW", "zh-CN" or "ja-JP", where the documentation is in Chinese or Japanese.';

  /** Every channel of the reply to `args`, with no results, in markdown, compact markdown and JSON. */
  async function replies(args: Record<string, unknown>): Promise<{
    structured: unknown[];
    json: { suggestions?: unknown; localeNote?: unknown };
    markdowns: string[];
  }> {
    const { ctx } = searchUpstream();
    const markdown = await callSearch(ctx, args);
    const compact = await callSearch(ctx, { ...args, outputMode: 'compact' });
    const json = await callSearch(ctx, { ...args, responseFormat: 'json' });
    for (const reply of [markdown, compact, json]) {
      expect(reply.isError, reply.text).not.toBe(true);
      expect(reply.structuredContent?.totalResults).toBe(0);
    }
    return {
      structured: [markdown, compact, json].map(reply => reply.structuredContent?.suggestions),
      json: JSON.parse(json.text) as { suggestions?: unknown; localeNote?: unknown },
      markdowns: [markdown.text, compact.text],
    };
  }

  it('in the default language, suggests none of its Chinese words, and says to search in English or in Chinese or Japanese', async () => {
    const reply = await replies({ query: '"推送 證書 續約 失敗"' });

    expect(reply.structured).toEqual([[], [], []]);
    expect(reply.json.suggestions).toEqual([]);
    expect(reply.json.localeNote).toBe(han);
    for (const markdown of reply.markdowns) {
      expect(markdown).not.toContain('Try simpler query');
      expect(markdown).toContain(`\n\n${han}`);
    }
  });

  it('says the same when en-US is asked for, without calling it the default', async () => {
    const reply = await replies({ query: '"推送 證書 續約 失敗"', language: 'en-US' });

    expect(reply.structured).toEqual([[], [], []]);
    expect(reply.json.localeNote).toBe(han.replace(' (the default language)', ''));
  });

  it('keeps the Latin words of a mixed query, as it did before its Chinese words were read', async () => {
    // "Jamf Pro release notes failure 11.32.0". In zh-TW it is suggested
    // `pro 版本 資訊`; here, `pro 11 32`, which en-US can match.
    const reply = await replies({ query: '"Jamf Pro 版本資訊 失敗 11.32.0"' });

    expect(reply.structured).toEqual([['pro 11 32'], ['pro 11 32'], ['pro 11 32']]);
    expect(reply.json.suggestions).toEqual(['pro 11 32']);
    expect(reply.json.localeNote).toBe(han);
  });

  it('reads a Chinese word between two Latin ones as a space, which parts them', async () => {
    // 設定 is "settings". Left out without a space, it would join the Latin
    // words into one, vpnproxywi-fisettings, and there would be no simpler query.
    // Quoted, as a query of fewer of its words is suggested only to a query
    // Fluid Topics does not match on any one word (see
    // search-suggestions-any-word.test.ts).
    const reply = await replies({ query: '"VPN設定proxy設定Wi-Fi設定settings"' });

    expect(reply.json.suggestions).toEqual(['vpn proxy wi-fi', 'network', 'config']);
  });

  it('sends a query with Kana to ja-JP alone', async () => {
    // Hiragana and Katakana are written in Japanese only; Han, in Chinese and
    // Japanese both, so a query of Han alone is sent to all three.
    const reply = await replies({ query: '"パスワードの変更とリセットの方法"' });

    expect(reply.structured).toEqual([[], [], []]);
    expect(reply.json.localeNote).toBe(
      'This query has words in Japanese, and the documentation in "en-US" (the default language) ' +
      'is in English, so it does not have them. Search it with the English terms. Or search with language: ' +
      '"ja-JP", where the documentation is in Japanese.',
    );
  });

  it('sends a query in Korean to the English terms, as Jamf publishes nothing in Korean', async () => {
    // "Certificate renewal failure".
    const reply = await replies({ query: '"인증서 갱신 실패"' });

    expect(reply.structured).toEqual([[], [], []]);
    expect(reply.json.localeNote).toBe(
      'This query has words in Korean, and the documentation in "en-US" (the default language) ' +
      'is in English, so it does not have them. Search it with the English terms. ' +
      'Jamf publishes no documentation in Korean.',
    );
  });

  it('in another language than en-US, names en-US and the languages its words are in', async () => {
    const reply = await replies({ query: '"推送 證書 續約 失敗"', language: 'de-DE' });

    expect(reply.structured).toEqual([[], [], []]);
    expect(reply.json.localeNote).toBe(
      'This query has words in Chinese or Japanese, and the documentation in "de-DE" is not in Chinese or ' +
      'Japanese, so it does not have them. The en-US documentation is in English: to search it, use the ' +
      'English terms, with language: "en-US". Or search with language: "zh-TW", "zh-CN" or "ja-JP", ' +
      'where the documentation is in Chinese or Japanese.',
    );
  });

  it('in zh-TW, suggests none of the words of a query with Kana, and sends it to ja-JP', async () => {
    const reply = await replies({ query: '"パスワードの変更とリセットの方法"', language: 'zh-TW' });

    expect(reply.structured).toEqual([[], [], []]);
    expect(reply.json.localeNote).toBe(
      'This query has words in Japanese, and the documentation in "zh-TW" is not in Japanese, so it does not ' +
      'have them. The en-US documentation is in English: to search it, use the English terms, with ' +
      'language: "en-US". Or search with language: "ja-JP", where the documentation is in Japanese.',
    );
  });

  it.each(['zh-TW', 'zh-CN', 'ja-JP'])('in %s, suggests the words of a query of Han alone', async language => {
    // Han is written in Chinese and Japanese both, so its words may be in any
    // of the three, and the reply does not guess which.
    const reply = await replies({ query: '"推送證書續約失敗"', language });

    expect(reply.structured).toEqual([['推送 證書 續約'], ['推送 證書 續約'], ['推送 證書 續約']]);
    expect(reply.json.localeNote).toBe(
      `Not all documentation is available in "${language}". The en-US documentation is in English: ` +
      'to search it, use the English terms, with language: "en-US".',
    );
  });

  it('adds no note to a Latin query in en-US, whose marks are also written in Japanese', async () => {
    const reply = await replies({ query: 'wi-fi・vpn、proxy。settings' });

    expect(reply.json).not.toHaveProperty('localeNote');
    for (const markdown of reply.markdowns) {
      expect(markdown).not.toContain('documentation in "en-US"');
    }
  });
});

describe('a Latin query with no results is suggested what it was before', () => {
  // Each value is what the query was suggested before Chinese and Japanese
  // words were read (2026-09-28), byte for byte. Quoted where a query of fewer
  // of its words is among them: Fluid Topics matches a query without quotes
  // on any one word, so since 2026-09-28 such a query is not suggested fewer
  // of its words (see search-suggestions-any-word.test.ts).
  it.each([
    ['"renew push certificate failed"', ['renew push certificate', 'deploy', 'certificates', 'cert', 'ssl', 'tls']],
    ['"how to configure the mdm enrollment process"', ['configure mdm enrollment', 'config', 'mobile device management', 'device management']],
    ['smart group', ['groups', 'static group']],
    ['xqzvbnmplk', []],
    // Marks written with Chinese and Japanese, in the Common script, and no
    // Chinese, Japanese or Korean character: the query is split the Latin way
    // whole, so ー is read as a space and is not a word of its own.
    ['configure mdm enrollment ー', ['config', 'mobile device management', 'device management']],
    ['"wi-fi・vpn、proxy。settings"', ['wi-fi vpn proxy', 'network', 'config']],
  ])('%s', async (query, expected) => {
    const reply = await suggest(query, 'en-US');

    expect(reply.structured).toEqual(expected);
    expect(reply.json).toEqual(expected);
  });
});

describe('the locale note on a query with no results in another language than en-US', () => {
  const unavailable = (language: string): string => `Not all documentation is available in "${language}".`;

  it.each([
    ['"推送證書續約失敗"', 'zh-TW'],
    ['"パスワードの変更とリセットの方法"', 'ja-JP'],
    // "certificate" in Thai, another script than Latin.
    ['ใบรับรอง', 'th-TH'],
  ])('sends %s to the English terms, which the en-US documentation has, not its own words', async (query, language) => {
    // Until 2026-09-28 it said only "Try searching with language: "en-US"",
    // which searches the English documentation for these words: live that
    // day, "推送 證書 續約" had 50 results in zh-TW and none in en-US.
    const { ctx } = searchUpstream();
    const note = `${unavailable(language)} The en-US documentation is in English: to search it, ` +
      'use the English terms, with language: "en-US".';

    const json = await callSearch(ctx, { query, language, responseFormat: 'json' });
    const markdown = await callSearch(ctx, { query, language });

    expect((JSON.parse(json.text) as { localeNote?: unknown }).localeNote).toBe(note);
    expect(markdown.text).toContain(`\n\n${note}`);
  });

  it('sends a Latin query to en-US, as before', async () => {
    const { ctx } = searchUpstream();

    const json = await callSearch(ctx, { query: '"Zertifikat erneuern fehlgeschlagen"', language: 'de-DE', responseFormat: 'json' });

    expect((JSON.parse(json.text) as { localeNote?: unknown }).localeNote)
      .toBe(`${unavailable('de-DE')} Try searching with language: "en-US".`);
  });
});
