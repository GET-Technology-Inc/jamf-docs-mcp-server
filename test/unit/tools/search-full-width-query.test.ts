/**
 * A query to `jamf_docs_search` typed in full-width Latin letters or digits,
 * as an input method in full-width mode types them: the registered tool over
 * MCP, with the real search service and suggestions, and Fluid Topics stubbed.
 *
 * Fluid Topics reads full-width letters as the ASCII ones in ja-JP, zh-TW and
 * zh-CN only, and full-width digits in ja-JP only. Live on 2026-09-28: ＳＳＯ
 * had no results in en-US and SSO 1,228, while in ja-JP both had 712; ＳＳＯ,
 * ＦｉｌｅＶａｕｌｔ and １１．３２ had none in en-US, de-DE, es-ES, fr-FR and
 * nl-NL, and Ｊａｍｆ, ｉＯＳ and Ａｐｐｌｅ none in th-TH, it-IT and pt-BR;
 * １５ had none in zh-TW (15 had 1,599) or zh-CN. Until then the query was
 * sent as typed, so such a query found nothing, or less than it asked for.
 */

import { describe, it, expect } from 'vitest';
import {
  CLUSTERED_SEARCH,
  CONCEPTS_MATCH,
  PRESTAGE,
  callSearch,
  searchRequests,
  searchUpstream,
} from '../../helpers/search-upstream.js';
import { SUPPORTED_LOCALE_IDS } from '../../../src/core/constants.js';
import type { FtSearchRequest } from '../../../src/core/types.js';

const ANY_WORD = '- Check the spelling, or try other terms: the search finds pages with any one word of a query, ' +
  'so none of these words is in the documentation searched';

/** The queries sent to Fluid Topics for `args`, which it finds nothing for. */
async function sent(args: Record<string, unknown>): Promise<string[]> {
  const requests: FtSearchRequest[] = [];
  const { ctx } = searchUpstream({ clusteredSearch: (request) => { requests.push(request); return []; } });

  const reply = await callSearch(ctx, args);

  expect(reply.isError, reply.text).not.toBe(true);
  return requests.map(request => request.query);
}

/** The suggestions and the tips of the reply to `args`, which Fluid Topics finds nothing for. */
async function suggest(args: Record<string, unknown>): Promise<{ suggestions: unknown; tips: string[]; markdown: string }> {
  const { ctx } = searchUpstream();
  const reply = await callSearch(ctx, args);

  expect(reply.isError, reply.text).not.toBe(true);
  expect(reply.structuredContent?.totalResults).toBe(0);
  const heading = '**Tips**:\n';
  const afterTips = reply.text.slice(reply.text.indexOf(heading) + heading.length);
  return {
    suggestions: reply.structuredContent?.suggestions,
    tips: (afterTips.split('\n\n')[0] ?? '').split('\n').filter(line => line !== ''),
    markdown: reply.text,
  };
}

describe('the query sent to Fluid Topics', () => {
  it.each([undefined, ...SUPPORTED_LOCALE_IDS])('has its full-width letters and digits in ASCII in %s', async (language) => {
    expect(await sent({ query: 'ＳＳＯ ｌｏｇｉｎ ｍａｃＯＳ １５', ...(language !== undefined ? { language } : {}) }))
      .toEqual(['SSO login macOS 15']);
  });

  it('has each full-width letter and digit in ASCII, from the first to the last of each range', async () => {
    expect(await sent({ query: 'ＡＢＹＺ ａｂｙｚ ０１８９' })).toEqual(['ABYZ abyz 0189']);
  });

  it('keeps full-width punctuation, which Fluid Topics reads as a space, not as its ASCII form', async () => {
    // Live on 2026-09-28, in en-US, `certificate －push` had the 3,010
    // results of `certificate push`, where `certificate -push` excludes push
    // (2,188), and `certificate ＋xyzzyq` the 2,768 of `certificate`, where
    // `certificate +xyzzyq` requires xyzzyq (none).
    expect(await sent({ query: 'certificate －push ＋xyzzyq' })).toEqual(['certificate －push ＋xyzzyq']);
    expect(await sent({ query: 'Ｊａｍｆ Ｐｒｏ １１．３２．０' })).toEqual(['Jamf Pro 11．32．0']);
    expect(await sent({ query: 'Ｊａｍｆ－－建議的進階電腦搜尋', language: 'zh-TW' }))
      .toEqual(['Jamf－－建議的進階電腦搜尋']);
  });

  it('keeps the ideographic space, which Fluid Topics reads as a space', async () => {
    // U+3000. Live on 2026-09-28, in en-US, `macOS 15` with it for the space
    // had the 93 results of `macOS 15`.
    expect(await sent({ query: 'ｍａｃＯＳ\u3000１５' })).toEqual(['macOS\u300015']);
  });

  it('keeps a symbol or ligature NFKC spells in Latin letters, which is not a full-width letter', async () => {
    // Fluid Topics reads the ligature U+FB01 as fi itself: live on 2026-09-28,
    // in en-US, `Configuration Profile` written with it had the 11,602
    // results of `Configuration Profile`. ™ is no part of the word before it.
    expect(await sent({ query: 'Jamf Pro\u2122 Con\uFB01guration Pro\uFB01le' }))
      .toEqual(['Jamf Pro\u2122 Con\uFB01guration Pro\uFB01le']);
  });
});

describe('a query typed in full width', () => {
  it('finds what the same query in ASCII finds', async () => {
    const { ctx } = searchUpstream({ clusteredSearch: (request) => request.query === 'PreStage' ? [PRESTAGE] : [] });

    const reply = await callSearch(ctx, { query: 'ＰｒｅＳｔａｇｅ', responseFormat: 'json' });

    expect(reply.isError, reply.text).not.toBe(true);
    expect(reply.structuredContent?.totalResults).toBe(1);
    expect((reply.structuredContent?.results as { title: string }[] | undefined)?.map(result => result.title))
      .toEqual(['Computer PreStage Enrollments']);
  });

  it('is the one search the same query in ASCII is, cached once', async () => {
    const { ctx, requests } = searchUpstream({ clusteredSearch: () => [PRESTAGE] });

    await callSearch(ctx, { query: 'ＰｒｅＳｔａｇｅ' });
    await callSearch(ctx, { query: 'PreStage' });

    expect(searchRequests(requests)).toEqual([`POST ${CLUSTERED_SEARCH}`]);
  });
});

describe('a full-width query that found nothing', () => {
  it('is not suggested its words in ASCII, which are the words Fluid Topics searched', async () => {
    // Sent as `SSO login`, which found nothing: `sso login` would find
    // nothing either. The synonyms are other words.
    const reply = await suggest({ query: 'ＳＳＯ ｌｏｇｉｎ' });

    expect(reply.suggestions).toEqual(['single sign-on', 'authentication', 'identity', 'sign-in', 'connect']);
    expect(reply.markdown).not.toContain('Try simpler query');
    expect(reply.tips).toContain(ANY_WORD);
  });

  it('is not suggested its words in ASCII in ja-JP either, where Fluid Topics reads them as ASCII itself', async () => {
    // Until 2026-09-28 this was suggested `xyzzyq qwvzx`, which Fluid Topics
    // reads as the query that found nothing: live that day, ＭＤＭ and MDM
    // had 2,397 results each in ja-JP.
    const reply = await suggest({ query: 'ｘｙｚｚｙｑ ｑｗｖｚｘ', language: 'ja-JP' });

    expect(reply.suggestions).toEqual([]);
    expect(reply.tips).toContain(ANY_WORD);
  });

  it('in quotes, is still suggested its words in ASCII, which the phrase required together', async () => {
    const reply = await suggest({ query: '"ＳＳＯ ｌｏｇｉｎ ｆａｉｌｅｄ"' });

    expect(reply.suggestions).toEqual([
      'sso login failed', 'single sign-on', 'authentication', 'identity', 'sign-in', 'connect',
    ]);
  });

  it('from a SearchProvider, which is handed the query as typed, is suggested its words in ASCII', async () => {
    const { ctx, providerCalls } = searchUpstream({ provider: [] });

    const reply = await callSearch(ctx, { query: 'ＳＳＯ' });

    expect(providerCalls()).toBe(1);
    expect(reply.structuredContent?.suggestions).toEqual(['sso', 'single sign-on', 'authentication', 'identity', 'login']);
    expect(reply.text).toContain('**Try simpler query**: `sso`');
  });
});

describe('a full-width query matched against the other sites\' titles', () => {
  it.each([['ｊａｍｆｏｒｍｅｒ', 'jamformer'], ['ｓｅｔｕｐ ｍａｎａｇｅｒ', 'setup manager']] as const)(
    '%s finds the page %s finds, whose title is in ASCII',
    async (query, ascii) => {
      // Until 2026-09-28 Fuse was given the query as typed, whose letters
      // are in no title, and found nothing.
      const { ctx } = searchUpstream();

      const reply = await callSearch(ctx, { query });

      expect(reply.isError, reply.text).not.toBe(true);
      expect(reply.structuredContent?.otherSources).toEqual([CONCEPTS_MATCH[ascii]]);
    },
  );
});
