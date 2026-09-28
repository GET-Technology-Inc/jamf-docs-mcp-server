/**
 * A query to `jamf_docs_search` quoted with marks other than the straight
 * double quote: the registered tool over MCP, with the real search service and
 * suggestions, and Fluid Topics stubbed.
 *
 * Fluid Topics searches a phrase in straight double quotes as one a page must
 * have, reads the curly quotes as if they were not there, and finds nothing
 * for a query with the full-width ＂ in it. Live on 2026-09-28, in en-US,
 * `"push certificate"` had 398 results, `“push certificate”` the 462 of
 * `push certificate`, and `＂push certificate＂` none; in ja-JP,
 * `"プッシュ証明書"` had 442 and `＂プッシュ証明書＂` none. Until then each was
 * sent as typed, so a phrase quoted as a keyboard or an input method quotes it
 * was searched as loose words, or not at all.
 */

import { describe, it, expect } from 'vitest';
import { callSearch, searchUpstream } from '../../helpers/search-upstream.js';
import type { FtSearchRequest } from '../../../src/core/types.js';

const ANY_WORD = '- Check the spelling, or try other terms: the search finds pages with any one word of a query, ' +
  'so none of these words is in the documentation searched';
const REMOVE_QUOTES = '- Try removing quotes for a broader search';

/** The queries sent to Fluid Topics for `args`, which it finds nothing for. */
async function sent(args: Record<string, unknown>): Promise<string[]> {
  const requests: FtSearchRequest[] = [];
  const { ctx } = searchUpstream({ clusteredSearch: (request) => { requests.push(request); return []; } });

  const reply = await callSearch(ctx, args);

  expect(reply.isError, reply.text).not.toBe(true);
  return requests.map(request => request.query);
}

/** The suggestions and the tips of the reply to `args`, which Fluid Topics finds nothing for. */
async function suggest(args: Record<string, unknown>): Promise<{ suggestions: unknown; tips: string[] }> {
  const { ctx } = searchUpstream();
  const reply = await callSearch(ctx, args);

  expect(reply.isError, reply.text).not.toBe(true);
  const heading = '**Tips**:\n';
  const afterTips = reply.text.slice(reply.text.indexOf(heading) + heading.length);
  return {
    suggestions: reply.structuredContent?.suggestions,
    tips: (afterTips.split('\n\n')[0] ?? '').split('\n').filter(line => line !== ''),
  };
}

describe('the query sent to Fluid Topics', () => {
  it.each([
    ['＂push certificate＂', '"push certificate"'],
    ['＂プッシュ証明書', '"プッシュ証明書'],
    ['“push certificate” renewal', '"push certificate" renewal'],
    ['‟push certificate‟', '"push certificate"'],
    ['‘push certificate’ Apple’s', '\'push certificate\' Apple\'s'],
  ])('%s is sent as %s', async (query, expected) => {
    expect(await sent({ query })).toEqual([expected]);
  });

  it('straightens the German „, which opens a phrase that “ closes', async () => {
    // With “ alone straightened, this was the phrase `" „Push"`: live on
    // 2026-09-28, 20 results in de-DE, led by a page on remote commands,
    // against 42 for the two phrases.
    expect(await sent({ query: '„Zertifikat erneuern“ „Push“', language: 'de-DE' }))
      .toEqual(['"Zertifikat erneuern" "Push"']);
  });

  it('sends a straight quote as typed', async () => {
    // «», 「」 and ＇ were sent as typed too until 2026-09-28
    // (search-corner-brackets-and-guillemets.test.ts).
    expect(await sent({ query: '"push certificate" renewal' })).toEqual(['"push certificate" renewal']);
  });
});

describe('a query in curly or full-width quotes that found nothing', () => {
  it('is suggested fewer of its words, which its quotes made a phrase of', async () => {
    // Live on 2026-09-28, in ja-JP, the phrase had no results either way, and
    // プッシュ 証明書 更新 had 3,818. Read as any one of its words, it would
    // be told none of them is in the documentation, and be suggested nothing.
    const reply = await suggest({ query: '＂プッシュ証明書の更新に失敗しました＂', language: 'ja-JP' });

    expect(reply.suggestions).toEqual(['プッシュ 証明書 更新']);
    expect(reply.tips).toContain(REMOVE_QUOTES);
    expect(reply.tips).not.toContain(ANY_WORD);
  });

  it.each([
    ['“renew push certificate failed”', 'en-US', ['renew push certificate', 'deploy', 'certificates', 'cert', 'ssl', 'tls']],
    ['„Zertifikat erneuern fehlgeschlagen Anmeldung“', 'de-DE', ['zertifikat erneuern fehlgeschlagen']],
  ])('%s in %s is suggested what the same in straight quotes is', async (query, language, expected) => {
    const reply = await suggest({ query, language });

    expect(reply.suggestions).toEqual(expected);
    expect(reply.tips).toContain(REMOVE_QUOTES);
  });

  it('with a ＂ that pairs with none, is read as the any-word query it is sent as', async () => {
    // Sent as `"xyzzyq qwvzx plokm`, whose quote Fluid Topics reads as none
    // (live on 2026-09-28, `"push certificate` had the 462 of
    // `push certificate`).
    const reply = await suggest({ query: '＂xyzzyq qwvzx plokm' });

    expect(reply.suggestions).toEqual([]);
    expect(reply.tips).toContain(ANY_WORD);
    expect(reply.tips).not.toContain(REMOVE_QUOTES);
  });
});

describe('a quoted query of three keywords or fewer that found nothing', () => {
  it.each([
    // Live on 2026-09-28, in fr-FR, the phrase had no results and was
    // suggested `deploy` alone, while `certificat push expiré` had 2,505,
    // led by "Suppression du certificat push" and "Certificats push".
    ['"certificat push expiré"', 'fr-FR', ['certificat push expiré', 'deploy']],
    ['“push certificate”', 'en-US', ['push certificate', 'deploy', 'certificates', 'cert', 'ssl', 'tls']],
    // A phrase of one word is that word in the form typed: live that day,
    // `"certificat"` had 1,844 results in fr-FR and `certificat` 2,087.
    ['"xyzzyq"', 'en-US', ['xyzzyq']],
  ])('%s in %s is suggested its words without the quotes, a query that is not a phrase', async (query, language, expected) => {
    const reply = await suggest({ query, language });

    expect(reply.suggestions).toEqual(expected);
    expect(reply.tips).toContain(REMOVE_QUOTES);
  });

  it('is not suggested its words when they have no quotes to remove', async () => {
    // `+` makes a word one a page must have, as a phrase does, but its words
    // with no quotes are the query that found nothing.
    const reply = await suggest({ query: '+certificat push expiré', language: 'fr-FR' });

    expect(reply.suggestions).toEqual(['deploy']);
    expect(reply.tips).not.toContain(REMOVE_QUOTES);
  });
});
