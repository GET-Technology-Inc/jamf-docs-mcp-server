/**
 * A query to `jamf_docs_search` quoted as Japanese and Chinese quote, with
 * 「」 or 『』, or as French and German quote, with « » or » «: the registered
 * tool over MCP, with the real search service and suggestions, and Fluid
 * Topics stubbed.
 *
 * Fluid Topics searches a phrase in straight double quotes as one a page must
 * have, and reads these marks as if they were not there. Live on 2026-09-28,
 * `「プッシュ証明書」の更新` had 19,979 results in ja-JP, the pages with any one
 * of its words, and 6 of the first 10 had the phrase; `"プッシュ証明書"の更新`
 * had 442, and all of the first 10 had it. In fr-FR,
 * `Renouvellement du « certificat push »` had 12,983, 6 of the first 10 with
 * the phrase, and `Renouvellement du "certificat push"` 379, 10 of 10. Until
 * then such a query was sent as typed, so the phrase it quoted was searched as
 * loose words.
 *
 * Two cases are not searched as a phrase. A query of one word is sent as
 * typed, as a phrase of one word is that word in the form typed: live that
 * day, `"Konfigurationsprofil"` had 1,717 results in de-DE, and
 * `Konfigurationsprofil` 7,141, led by overview pages the quoted one's first
 * 10 lacked. And when Fluid Topics finds nothing for the phrase, the search
 * asks again with the marks as typed, and says so (`queryNote`): live that
 * day, `「プレステージ登録」` had no results as a phrase in ja-JP and 5,190 as
 * typed, and `« certificat push expiré »` none in fr-FR and 2,505.
 */

import { describe, it, expect } from 'vitest';
import {
  CLUSTERED_SEARCH,
  PRESTAGE,
  callSearch,
  searchRequests,
  searchUpstream,
} from '../../helpers/search-upstream.js';
import type { FtSearchRequest } from '../../../src/core/types.js';

const ANY_WORD = '- Check the spelling, or try other terms: the search finds pages with any one word of a query, ' +
  'so none of these words is in the documentation searched';
const REMOVE_QUOTES = '- Try removing quotes for a broader search';

/**
 * The queries sent to Fluid Topics for `args`, which it finds nothing for: a
 * phrase in 「」, 『』, ｢｣ or « », then the query with those marks as typed.
 */
async function sent(args: Record<string, unknown>): Promise<string[]> {
  const requests: FtSearchRequest[] = [];
  const { ctx } = searchUpstream({ clusteredSearch: (request) => { requests.push(request); return []; } });

  const reply = await callSearch(ctx, args);

  expect(reply.isError, reply.text).not.toBe(true);
  return requests.map(request => request.query);
}

/** The suggestions, the tips and the query note of the reply to `args`, which Fluid Topics finds nothing for. */
async function suggest(args: Record<string, unknown>): Promise<{ suggestions: unknown; tips: string[]; queryNote: unknown }> {
  const { ctx } = searchUpstream();
  const reply = await callSearch(ctx, args);

  expect(reply.isError, reply.text).not.toBe(true);
  expect(reply.structuredContent?.totalResults).toBe(0);
  const heading = '**Tips**:\n';
  const afterTips = reply.text.slice(reply.text.indexOf(heading) + heading.length);
  return {
    suggestions: reply.structuredContent?.suggestions,
    tips: (afterTips.split('\n\n')[0] ?? '').split('\n').filter(line => line !== ''),
    queryNote: reply.structuredContent?.queryNote,
  };
}

describe('the query sent to Fluid Topics', () => {
  it.each([
    ['「プッシュ証明書」の更新', 'ja-JP', '"プッシュ証明書"の更新'],
    ['『プッシュ証明書』を更新', 'ja-JP', '"プッシュ証明書"を更新'],
    // The half-width corner brackets, which NFKC makes 「」.
    ['｢プッシュ証明書｣を更新', 'ja-JP', '"プッシュ証明書"を更新'],
    ['更新「推播憑證」', 'zh-TW', '更新"推播憑證"'],
    ['créer un « groupe intelligent »', 'fr-FR', 'créer un " groupe intelligent "'],
    ['»Zertifikat erneuern«', 'de-DE', '"Zertifikat erneuern"'],
    // Two words to Fluid Topics, which splits at the hyphen.
    ['«Wi-Fi»', 'fr-FR', '"Wi-Fi"'],
    // One word in a query of more, which a page must have.
    ['「FileVault」を有効にする', 'ja-JP', '"FileVault"を有効にする'],
  ])('%s in %s is sent as %s, and then as typed', async (query, language, expected) => {
    expect(await sent({ query, language })).toEqual([expected, query]);
  });

  it.each([
    ['«Konfigurationsprofil»', 'de-DE'],
    ['« certificat »', 'fr-FR'],
    ['「ポリシー」', 'ja-JP'],
    ['「原則」', 'zh-TW'],
  ])('sends %s in %s, a query of one word, as typed', async (query, language) => {
    // Live on 2026-09-28, `"Konfigurationsprofil"` had 1,717 results in
    // de-DE and `Konfigurationsprofil` 7,141, and `"certificat"` 1,844 in
    // fr-FR and `certificat` 2,087, led by "Certificats"; `"ポリシー"` 2,879
    // in ja-JP and `ポリシー` 2,948.
    expect(await sent({ query, language })).toEqual([query]);
  });

  it('writes a full-width word in ASCII, in quotes sent as typed', async () => {
    expect(await sent({ query: '«ＳＳＯ»' })).toEqual(['«SSO»']);
  });

  it('keeps a no-break space inside guillemets, which Fluid Topics reads as a space', async () => {
    // Live on 2026-09-28, in fr-FR, `"certificat push"` with U+00A0 inside
    // its quotes had the 379 results of `"certificat push"`.
    expect(await sent({ query: 'créer un «\u00a0groupe intelligent\u00a0»', language: 'fr-FR' }))
      .toEqual(['créer un "\u00a0groupe intelligent\u00a0"', 'créer un «\u00a0groupe intelligent\u00a0»']);
  });

  it('sends a narrow no-break space as a space, which in a phrase finds nothing', async () => {
    // French puts one inside guillemets. Live on 2026-09-28, in fr-FR,
    // `"certificat push"` had 379 results, and none with U+202F inside its
    // quotes or between its words.
    expect(await sent({ query: 'créer un «\u202fgroupe intelligent\u202f»', language: 'fr-FR' }))
      .toEqual(['créer un " groupe intelligent "', 'créer un « groupe intelligent »']);
    expect(await sent({ query: '"certificat\u202fpush"', language: 'fr-FR' })).toEqual(['"certificat push"']);
  });

  it('sends the full-width ＇ as a straight single quote, as it does ‘ ’', async () => {
    // Live on 2026-09-28, in en-US, `＇push certificate＇` had the 462 results
    // of `push certificate`, and `Apple＇s` the 9,811 of `Apple's`.
    expect(await sent({ query: '＇push certificate＇ Apple＇s' })).toEqual(['\'push certificate\' Apple\'s']);
  });

  it('searches a pair of which one quote is straight as the phrase it is, and not again', async () => {
    // A straight quote is typed to make a phrase, whatever closes it.
    expect(await sent({ query: '"certificat push»', language: 'fr-FR' })).toEqual(['"certificat push"']);
  });

  it.each([
    ['"push certificate" renewal'],
    // Single guillemets, which quote nothing, as ‘ ’ do not: live on
    // 2026-09-28, `‹certificat push›` had the 2,284 results of
    // `certificat push` in fr-FR.
    ['‹certificat push›'],
  ])('%s is sent as typed, once', async (query) => {
    expect(await sent({ query })).toEqual([query]);
  });
});

describe('a phrase in corner brackets or guillemets that no page has', () => {
  it('is searched again as typed, and the reply serves what that finds and says so', async () => {
    const { ctx, requests } = searchUpstream({
      clusteredSearch: request => request.query === '「プレステージ登録」' ? [PRESTAGE] : [],
    });
    const note = 'No page has 「プレステージ登録」 as written, so these results are for the query searched ' +
      'without those quotes.';

    const markdown = await callSearch(ctx, { query: '「プレステージ登録」', language: 'ja-JP' });
    const json = await callSearch(ctx, { query: '「プレステージ登録」', language: 'ja-JP', responseFormat: 'json' });

    for (const reply of [markdown, json]) {
      expect(reply.isError, reply.text).not.toBe(true);
      expect(reply.structuredContent?.totalResults).toBe(1);
      expect((reply.structuredContent?.results as { title: string }[]).map(result => result.title))
        .toEqual(['Computer PreStage Enrollments']);
      expect(reply.structuredContent?.queryNote).toBe(note);
    }
    expect(markdown.text).toContain(`> **Query Note:** ${note}`);
    expect((JSON.parse(json.text) as { queryNote?: unknown }).queryNote).toBe(note);
    // Two requests, each cached: the second search asked for nothing.
    expect(searchRequests(requests)).toEqual([`POST ${CLUSTERED_SEARCH}`, `POST ${CLUSTERED_SEARCH}`]);
  });

  it('is searched again with the filters the search ended with', async () => {
    const bodies: FtSearchRequest[] = [];
    const { ctx } = searchUpstream({ clusteredSearch: (request) => { bodies.push(request); return []; } });

    await callSearch(ctx, { query: '「プレステージ登録」', language: 'ja-JP', product: 'jamf-pro', docType: 'documentation' });

    // With docType, then without it (see resolveSearchResults), then as typed.
    expect(bodies.map(body => body.query)).toEqual(['"プレステージ登録"', '"プレステージ登録"', '「プレステージ登録」']);
    expect(bodies[2]?.filters).toEqual(bodies[1]?.filters);
    expect(bodies[2]?.filters).not.toEqual(bodies[0]?.filters);
    expect(bodies[2]?.contentLocale).toBe('ja-JP');
  });

  it('names every phrase no page had, and keeps a phrase in straight quotes', async () => {
    const bodies: FtSearchRequest[] = [];
    const { ctx } = searchUpstream({ clusteredSearch: (request) => { bodies.push(request); return []; } });

    const reply = await callSearch(ctx, { query: '"Jamf Pro" 「プッシュ証明書」の「更新」', language: 'ja-JP' });

    expect(bodies.map(body => body.query))
      .toEqual(['"Jamf Pro" "プッシュ証明書"の"更新"', '"Jamf Pro" 「プッシュ証明書」の「更新」']);
    expect(reply.structuredContent?.queryNote).toBe(
      'No page has 「プッシュ証明書」 and 「更新」 as written, and the query searched without their quotes ' +
      'found nothing either.',
    );
  });

  it('is not searched again when the phrase finds something', async () => {
    const { ctx, requests } = searchUpstream({ clusteredSearch: () => [PRESTAGE] });

    const reply = await callSearch(ctx, { query: '「プッシュ証明書」の更新', language: 'ja-JP' });

    expect(searchRequests(requests)).toEqual([`POST ${CLUSTERED_SEARCH}`]);
    expect(reply.structuredContent?.queryNote).toBeUndefined();
    expect(reply.text).not.toContain('Query Note');
  });

  it('is not searched again as typed when a SearchProvider answered', async () => {
    const { ctx, requests } = searchUpstream({ provider: [] });

    const reply = await callSearch(ctx, { query: '「プレステージ登録」', language: 'ja-JP' });

    expect(searchRequests(requests)).toEqual([]);
    expect(reply.structuredContent?.queryNote).toBeUndefined();
  });
});

describe('a query in corner brackets or guillemets that found nothing', () => {
  it('is suggested none of its words, which were searched without the quotes too', async () => {
    const reply = await suggest({ query: '「プッシュ証明書の更新に失敗しました」', language: 'ja-JP' });

    expect(reply.suggestions).toEqual([]);
    expect(reply.tips).toContain(ANY_WORD);
    expect(reply.tips).not.toContain(REMOVE_QUOTES);
    expect(reply.queryNote).toBe(
      'No page has 「プッシュ証明書の更新に失敗しました」 as written, and the query searched without those quotes ' +
      'found nothing either.',
    );
  });

  it('in guillemets, is suggested what the same without quotes is, where straight quotes get its words', async () => {
    const quoted = await suggest({ query: '« renouveler le certificat push échoué »', language: 'fr-FR' });
    const loose = await suggest({ query: 'renouveler le certificat push échoué', language: 'fr-FR' });
    const straight = await suggest({ query: '"renouveler le certificat push échoué"', language: 'fr-FR' });

    expect(quoted.suggestions).toEqual(loose.suggestions);
    expect(quoted.tips).toEqual(loose.tips);
    expect(quoted.tips).not.toContain(REMOVE_QUOTES);
    expect(straight.suggestions).toEqual(['renouveler le certificat', 'deploy']);
    expect(straight.tips).toContain(REMOVE_QUOTES);
    expect(straight.queryNote).toBeUndefined();
  });

  it('of one word, is read as the any-word query it is sent as', async () => {
    const reply = await suggest({ query: '«xyzzyq»', language: 'fr-FR' });

    expect(reply.suggestions).toEqual([]);
    expect(reply.tips).toContain(ANY_WORD);
    expect(reply.tips).not.toContain(REMOVE_QUOTES);
    expect(reply.queryNote).toBeUndefined();
  });

  it('with a 「 that pairs with none, is read as the any-word query it is sent as', async () => {
    const reply = await suggest({ query: '「xyzzyq qwvzx plokm' });

    expect(reply.suggestions).toEqual([]);
    expect(reply.tips).toContain(ANY_WORD);
    expect(reply.tips).not.toContain(REMOVE_QUOTES);
  });
});
