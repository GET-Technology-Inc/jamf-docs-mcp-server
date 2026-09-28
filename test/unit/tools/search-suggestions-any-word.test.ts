/**
 * Which queries `jamf_docs_search` suggests when Fluid Topics finds nothing,
 * and what it advises: the registered tool over MCP, with the real search
 * service and suggestions, and Fluid Topics answering with no results.
 *
 * Fluid Topics finds a page with any one word of a query, unless the query
 * says otherwise. Live on 2026-09-28, in en-US: `certificate` had 2,768
 * results, and so did `certificate xyzzyq qwvzx plokm zzqqa jjjkk`;
 * `certificate renewal` had 3,007, more than either word alone. What says
 * otherwise is a phrase in straight double quotes, which a page must have
 * (`"push certificate renewal failed"` had none, and so did the same with
 * `certificate` after it), a word with `+` before it, which a page must have
 * (`certificate +xyzzyq` had none), and a word with `-` before it, which a
 * page must not have (`certificate -certificate` had none). An unpaired quote
 * is read as no quote: `"push certificate` had the 462 of `push certificate`.
 * Curly and full-width quotes, corner brackets and guillemets are sent as
 * straight ones, and read as those (see search-quote-marks.test.ts and
 * search-corner-brackets-and-guillemets.test.ts).
 *
 * So a query with none of those found nothing because the documentation
 * searched has none of its words, and a query made only of those words finds
 * nothing either. Until 2026-09-28 such a query was suggested its first three
 * keywords, and told to "Try using fewer, more specific keywords": live that
 * day, `Zertifikat erneuern fehlgeschlagen Anmeldung` had no results in
 * en-US and was suggested `zertifikat erneuern fehlgeschlagen`, which had none
 * either.
 *
 * Words are read as Fluid Topics reads them: it splits `wi-fi`, `11.32.0` and
 * `xyzzyq_pro` into their letters and digits (`wi-fi` and `wi fi` had 501
 * results each), and cuts Chinese and Thai into the words the Unicode rules
 * find (`推送證書續約失敗` and `推送 證書 續約 失敗` had 992 each in zh-TW).
 */

import { describe, it, expect } from 'vitest';
import { callSearch, searchUpstream } from '../../helpers/search-upstream.js';
import type { SearchResult } from '../../../src/core/types.js';

const ANY_WORD = '- Check the spelling, or try other terms: the search finds pages with any one word of a query, ' +
  'so none of these words is in the documentation searched';
const FEWER = '- Try using fewer, more specific keywords';
const REMOVE_QUOTES = '- Try removing quotes for a broader search';
const REMOVE_FILTERS = '- Try removing filters to broaden your search';
const TOC = '- Browse the table of contents with `jamf_docs_get_toc`';

/** Every channel of the reply to `args` when Fluid Topics finds nothing, or `provider` answers with nothing. */
async function suggest(args: Record<string, unknown>, provider?: SearchResult[]): Promise<{
  suggestions: unknown;
  tips: string[];
  markdown: string;
}> {
  const { ctx, providerCalls } = searchUpstream(provider !== undefined ? { provider } : {});
  const markdown = await callSearch(ctx, args);
  const json = await callSearch(ctx, { ...args, responseFormat: 'json' });
  for (const reply of [markdown, json]) {
    expect(reply.isError, reply.text).not.toBe(true);
    expect(reply.structuredContent?.totalResults).toBe(0);
  }
  expect(providerCalls()).toBe(provider !== undefined ? 2 : 0);
  const suggestions = markdown.structuredContent?.suggestions;
  expect(json.structuredContent?.suggestions).toEqual(suggestions);
  expect((JSON.parse(json.text) as { suggestions?: unknown }).suggestions).toEqual(suggestions);
  // The tips are the list under **Tips**, up to the blank line after it.
  const heading = '**Tips**:\n';
  const afterTips = markdown.text.slice(markdown.text.indexOf(heading) + heading.length);
  const tips = (afterTips.split('\n\n')[0] ?? '').split('\n').filter(line => line !== '');
  return { suggestions, tips, markdown: markdown.text };
}

describe('a query Fluid Topics matches on any one word', () => {
  it('is not suggested fewer of its own words, which find nothing either', async () => {
    const reply = await suggest({ query: 'Zertifikat erneuern fehlgeschlagen Anmeldung' });

    expect(reply.suggestions).toEqual([]);
    expect(reply.markdown).not.toContain('Try simpler query');
  });

  it('is told why, and what can find something, instead of to use fewer keywords', async () => {
    // Five keywords, so it used to be told to use fewer.
    const reply = await suggest({ query: 'xyzzyq qwvzx plokm zzqqa jjjkk' });

    expect(reply.suggestions).toEqual([]);
    expect(reply.tips).toContain(ANY_WORD);
    expect(reply.tips).not.toContain(FEWER);
  });

  it('keeps the synonyms, which are other words', async () => {
    const reply = await suggest({ query: 'how to configure the mdm enrollment process' });

    expect(reply.suggestions).toEqual(['config', 'mobile device management', 'device management']);
    expect(reply.tips).toContain(ANY_WORD);
  });

  it('drops a synonym made only of words of the query', async () => {
    // `smart group` and `static group` are synonyms of group, and both words
    // of each are in the query. Only `groups` is another word.
    const reply = await suggest({ query: 'smart static group xyzzyq' });

    expect(reply.suggestions).toEqual(['groups']);
  });

  it('still suggests five synonyms when one it drops was among the first five', async () => {
    // `smart group` would be the second; `sign-in` is the fifth after it.
    const reply = await suggest({ query: 'smart static group sso login xyzzyq' });

    expect(reply.suggestions).toEqual(['groups', 'single sign-on', 'authentication', 'identity', 'sign-in']);
  });

  it('reads a word written with a hyphen or an underscore as its parts, as Fluid Topics does', async () => {
    // `wi-fi vpn proxy` is three of the query's words, wi, fi, vpn and proxy.
    expect((await suggest({ query: 'wi-fi・vpn、proxy。settings' })).suggestions).toEqual(['network', 'config']);
    expect((await suggest({ query: 'xyzzyq_pro qwvzx plokm zzqqa' })).suggestions).toEqual([]);
    // smart-static is smart and static, so `smart group` and `static group`
    // are words of the query too.
    expect((await suggest({ query: 'group xyzzyq smart-static' })).suggestions).toEqual(['groups']);
  });

  it('reads Chinese as the words the Unicode rules find in it, as Fluid Topics does', async () => {
    expect((await suggest({ query: '推送證書續約失敗', language: 'zh-TW' })).suggestions).toEqual([]);
  });

  it('reads a Chinese word between two Latin ones as a word of its own, as Fluid Topics does', async () => {
    // Live on 2026-09-28, Fluid Topics read this as VPN, 設定, proxy, 設定,
    // Wi, Fi, 設定, settings in en-US.
    const reply = await suggest({ query: 'VPN設定proxy設定Wi-Fi設定settings' });

    expect(reply.suggestions).toEqual(['network', 'config']);
  });

  it('is not suggested its full-width words in half width, which are the words it was sent as', async () => {
    // Until 2026-09-28 it was suggested `sso login` first: live that day, in
    // en-US, ＳＳＯ ｌｏｇｉｎ had no results, and sso login 2,669. It is now
    // sent as `SSO login` (search-full-width-query.test.ts).
    const reply = await suggest({ query: 'ＳＳＯ ｌｏｇｉｎ' });

    expect(reply.suggestions).toEqual(['single sign-on', 'authentication', 'identity', 'sign-in', 'connect']);
    expect(reply.tips).toContain(ANY_WORD);
  });

  it('is told first to remove its product filter, as its words may be outside it', async () => {
    const reply = await suggest({ query: 'xyzzyq qwvzx plokm', product: 'jamf-pro' });

    expect(reply.tips).toEqual([REMOVE_FILTERS, ANY_WORD, TOC]);
  });

  it('is told first to remove a version filter, which Jamf may publish nothing at', async () => {
    // Live on 2026-09-28, `policy` had no results with version 11.5.0, and
    // the reply did not name the filter. It is spelled right: Fluid Topics
    // found none of its words at that version, which is what the second tip
    // says.
    const reply = await suggest({ query: 'policy', version: '11.5.0' });

    expect(reply.tips).toEqual([REMOVE_FILTERS, ANY_WORD, TOC]);
    expect((await suggest({ query: 'policy', version: 'current' })).tips).toEqual([ANY_WORD, TOC]);
  });

  it('is not told to remove its filters when its only filter is a topic, which did not empty the search', async () => {
    // A topic is not sent to Fluid Topics. It filters what was found, and is
    // set aside when it leaves nothing, so the search found nothing without it.
    // Until 2026-09-28 it was told to remove it, after the spelling (see
    // search-no-results-topic-advice.test.ts).
    const reply = await suggest({ query: 'xyzzyq qwvzx plokm', topic: 'enrollment' });

    expect(reply.tips).toEqual([ANY_WORD, TOC]);
  });

  it('reads a hyphen on its own as a space, not as a word a page must not have', async () => {
    // Live on 2026-09-28, `certificate - push` had the 3,010 results of
    // `certificate push`.
    const reply = await suggest({ query: 'xyzzyq - qwvzx plokm' });

    expect(reply.suggestions).toEqual([]);
    expect(reply.tips).toEqual([ANY_WORD, TOC]);
  });

  it('reads an accent typed apart from its letter as the letter with its accent, as Fluid Topics does', async () => {
    // sécurité réseau accès défaillant ("security network access failing"),
    // with each accent typed as a mark after its letter. Live on 2026-09-28,
    // sécurité typed so had the 2,231 results of sécurité in fr-FR, so
    // `sécurité réseau accès` is three of the query's words.
    const reply = await suggest({
      query: 'se\u0301curite\u0301 re\u0301seau acce\u0300s de\u0301faillant', language: 'fr-FR',
    });

    expect(reply.suggestions).toEqual([]);
    expect(reply.tips).toContain(ANY_WORD);
  });

  it('with an unpaired quote, which Fluid Topics reads as no quote, is not suggested fewer words', async () => {
    const reply = await suggest({ query: '"xyzzyq qwvzx plokm zzqqa' });

    expect(reply.suggestions).toEqual([]);
    expect(reply.tips).toContain(ANY_WORD);
    expect(reply.tips).not.toContain(REMOVE_QUOTES);
  });
});

describe('a query with a part a page must match, or must not', () => {
  // Each value is what the query was suggested before 2026-09-28, byte for
  // byte: fewer words, or none of the quotes, + or - can find what it did not.
  it.each([
    ['"renew push certificate failed"', ['renew push certificate', 'deploy', 'certificates', 'cert', 'ssl', 'tls']],
    ['certificate +xyzzyq qwvzx plokm', ['certificate xyzzyq qwvzx', 'certificates', 'cert', 'ssl', 'tls']],
    ['push -push xyzzyq qwvzx', ['push -push xyzzyq', 'deploy']],
  ])('%s is suggested fewer of its words, as before', async (query, expected) => {
    const reply = await suggest({ query });

    expect(reply.suggestions).toEqual(expected);
    expect(reply.tips).not.toContain(ANY_WORD);
  });

  it('is still told to use fewer keywords, and to remove its quotes', async () => {
    const reply = await suggest({ query: '"xyzzyq qwvzx plokm zzqqa jjjkk"' });

    expect(reply.suggestions).toEqual(['xyzzyq qwvzx plokm']);
    expect(reply.tips).toEqual([FEWER, REMOVE_QUOTES, TOC]);
  });

  it('is told to use fewer keywords before it is told to remove its filters, as before', async () => {
    const reply = await suggest({ query: '"xyzzyq qwvzx plokm zzqqa jjjkk"', product: 'jamf-pro' });

    expect(reply.tips).toEqual([FEWER, REMOVE_FILTERS, REMOVE_QUOTES, TOC]);
  });

  it('is not told to remove the corner brackets Fluid Topics was sent as typed, which it reads as no quotes', async () => {
    // A pair of 「」 around the query's one word is sent as typed, and so is
    // a phrase in them that no page had, when the search is asked again (see
    // search-corner-brackets-and-guillemets.test.ts). Until 2026-09-29, with a
    // word marked +, each was told to remove its quotes: the second in the
    // reply that says the query searched without them found nothing either.
    const oneWord = await suggest({ query: '+「xyzzyq」' });
    const loose = await suggest({ query: '「enrollment xyzzyq」 +qwvzx' });

    expect(oneWord.tips).toEqual([TOC]);
    expect(loose.markdown).toContain('the query searched without those quotes found nothing either');
    expect(loose.tips).toEqual([TOC]);
    // A phrase in straight quotes beside them is still one a page must have.
    expect((await suggest({ query: '「enrollment xyzzyq」 "qwvzx plokm"' })).tips).toEqual([REMOVE_QUOTES, TOC]);
  });
});

describe('a search a SearchProvider answered', () => {
  it('is suggested what it was before, as the provider may not match any one word', async () => {
    const reply = await suggest({ query: 'xyzzyq qwvzx plokm zzqqa jjjkk' }, []);

    expect(reply.suggestions).toEqual(['xyzzyq qwvzx plokm']);
    expect(reply.tips).toEqual([FEWER, TOC]);
  });

  it('is told to remove corner brackets around its one word, which the provider was handed as typed', async () => {
    // Fluid Topics is sent such a pair as typed, and reads it as no quotes.
    // A provider is handed the query as typed too, and may read them as quotes.
    const reply = await suggest({ query: '+「xyzzyq」' }, []);

    expect(reply.tips).toEqual([REMOVE_QUOTES, TOC]);
  });
});
