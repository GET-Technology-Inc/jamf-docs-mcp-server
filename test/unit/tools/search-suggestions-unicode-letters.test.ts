/**
 * The words `jamf_docs_search` suggests when a query written with letters
 * other than ASCII finds nothing: the registered tool over MCP, with the real
 * search service and suggestions, and Fluid Topics answering with no results.
 *
 * A word was a run of `\w` until 2026-09-28: ASCII letters, digits and `_`.
 * Every other letter was read as a space, so a word with an accent was cut in
 * two at it, and the pieces were suggested as words. Live that day,
 * `"configurar política de seguridad avanzada"` in es-ES had no results and
 * the suggestion `configurar pol tica`. Full-width Latin (ＳＳＯ) and Thai were
 * read as spaces whole, so such a query had no suggestion at all; and a Thai
 * query in a language whose documentation is not in Thai was not told that
 * the th-TH documentation is.
 *
 * Most queries here are quoted: Fluid Topics matches any one word of a query
 * without quotes, so fewer of its own words are suggested only to a quoted one
 * (see search-suggestions-any-word.test.ts). Since 2026-09-28 a quoted one is
 * also suggested its words without the quotes, however few; a query whose
 * words a page must have, marked `+`, is not, and is what shows here that a
 * suggestion is not the query that found nothing.
 */

import { describe, it, expect } from 'vitest';
import { callSearch, searchUpstream } from '../../helpers/search-upstream.js';

/** `structuredContent.suggestions`, the JSON text's suggestions and locale note, and the markdown. */
async function suggest(args: Record<string, unknown>): Promise<{
  structured: unknown;
  json: { suggestions?: unknown; localeNote?: unknown };
  markdown: string;
}> {
  const { ctx } = searchUpstream();
  const markdown = await callSearch(ctx, args);
  const json = await callSearch(ctx, { ...args, responseFormat: 'json' });
  for (const reply of [markdown, json]) {
    expect(reply.isError, reply.text).not.toBe(true);
    expect(reply.structuredContent?.totalResults).toBe(0);
  }
  expect(json.structuredContent?.suggestions).toEqual(markdown.structuredContent?.suggestions);
  return {
    structured: markdown.structuredContent?.suggestions,
    json: JSON.parse(json.text) as { suggestions?: unknown; localeNote?: unknown },
    markdown: markdown.text,
  };
}

describe('a Latin word with an accent is one word', () => {
  it.each([
    // Live on 2026-09-28, each had no results, and was suggested the pieces
    // shown: `configurar pol tica`, `configurer la curit`, `gr der bersicht`.
    ['"configurar política de seguridad avanzada"', 'es-ES', 'configurar política de'],
    ['"configurer la sécurité avancée échouée"', 'fr-FR', 'configurer la sécurité'],
    ['"Größe der Übersicht ändern fehlgeschlagen"', 'de-DE', 'größe der übersicht'],
  ])('%s in %s suggests %j', async (query, language, expected) => {
    const reply = await suggest({ query, language });

    expect(reply.structured).toEqual([expected]);
    expect(reply.json.suggestions).toEqual([expected]);
    expect(reply.markdown).toContain(`**Try simpler query**: \`${expected}\``);
  });

  it('writes an accent typed as a combining mark as the letter it makes', async () => {
    // "se\u0301curite\u0301" is sécurité with each é typed as e and U+0301.
    // Split at the mark, it would suggest `se`, `curite`.
    const reply = await suggest({ query: '"configurer la se\u0301curite\u0301 avance\u0301e"', language: 'fr-FR' });

    expect(reply.structured).toEqual(['configurer la sécurité']);
  });

  it('joins two accents typed after one letter to it', async () => {
    // Vietnamese "update the system", each ậ and ệ typed as a letter and two
    // marks. As the three words of the query, `cập nhật hệ` is not suggested
    // to it again, and quoted, it is its words without the quotes.
    const reply = await suggest({ query: '"ca\u0323\u0302p nha\u0323\u0302t he\u0323\u0302 tho\u0302ng"' });

    expect(reply.structured).toEqual(['cập nhật hệ']);
    expect((await suggest({ query: '+ca\u0323\u0302p nha\u0323\u0302t he\u0323\u0302' })).structured).toEqual([]);
    expect((await suggest({ query: '"ca\u0323\u0302p nha\u0323\u0302t he\u0323\u0302"' })).structured)
      .toEqual(['cập nhật hệ']);
  });

  it('is not suggested again when its accents were typed apart from their letters', async () => {
    // "se\u0301curite\u0301" joined is sécurité, the same query, which Fluid
    // Topics reads the same way (live on 2026-09-28, 2,231 results in fr-FR
    // either way). Quoted, it is suggested its word, joined, without them.
    const reply = await suggest({ query: '+se\u0301curite\u0301', language: 'fr-FR' });

    expect(reply.structured).toEqual([]);
    expect((await suggest({ query: '"se\u0301curite\u0301"', language: 'fr-FR' })).structured).toEqual(['sécurité']);
  });

  it('keeps a mark Unicode writes no letter with inside its word', async () => {
    // q with a tilde is two characters in any form. Read as a space, the
    // mark would cut sq̃l into sq and l.
    const reply = await suggest({ query: '"configurar sq\u0303l avanzado ahora"', language: 'es-ES' });

    expect(reply.structured).toEqual(['configurar sq\u0303l avanzado']);
  });
});

describe('a mark that follows no Latin letter is no part of a word', () => {
  it('reads the vowel marks of an Arabic query as spaces, as its letters are', async () => {
    // "Teacher, instructor, Muhammad, registered", with their short vowels
    // written. Read as parts of words, the marks alone would be suggested,
    // as a query of three words.
    const reply = await suggest({ query: '"مُدَرِّس مُعَلِّم مُحَمَّد مُسَجَّل"' });

    expect(reply.structured).toEqual([]);
  });

  it('reads an emoji\'s variation selector and keycap as no part of the word after them', async () => {
    // U+FE0F draws ⚠ as an emoji, and U+20E3 draws a keycap around #. Read
    // as part of a word, U+FE0F would make the keyword "\ufe0fsso", which has
    // no synonyms, and the keycap a word of its own.
    expect((await suggest({ query: '\u26a0\ufe0fsso' })).structured).toEqual([
      'single sign-on', 'authentication', 'identity', 'login',
    ]);
    expect((await suggest({ query: '"#\ufe0f\u20e3 tag mdm config setup"' })).structured).toEqual([
      'tag mdm config', 'mobile device management', 'device management', 'enrollment', 'configuration', 'settings',
    ]);
  });

  it('keeps an accent typed after a variation selector with its letter', async () => {
    const reply = await suggest({ query: '"cafe\ufe0f\u0301 policy settings xyzzyq"' });

    expect(reply.structured).toEqual(['café policy settings', 'policies', 'rule', 'rules', 'enforcement', 'config']);
    // Two words, and the same two as café policy: no query of fewer.
    expect((await suggest({ query: '+cafe\ufe0f\u0301 policy' })).structured).toEqual([
      'policies', 'rule', 'rules', 'enforcement',
    ]);
  });
});

describe('full-width Latin letters are read as the letters they are', () => {
  // Live on 2026-09-28, in en-US, ＳＳＯ had no results and SSO 1,228:
  // Fluid Topics does not read one as the other there, and the search sends
  // it SSO since (search-full-width-query.test.ts). Until then ＳＳＯ was
  // read as spaces, and a query written in full width had no suggestion.

  it('suggests a quoted full-width query its words in half width, with their synonyms', async () => {
    const reply = await suggest({ query: '"ＳＳＯ ｌｏｇｉｎ ｆａｉｌｅｄ"' });

    expect(reply.structured).toEqual([
      'sso login failed', 'single sign-on', 'authentication', 'identity', 'sign-in', 'connect',
    ]);
  });

  it('reads full-width digits as the digits they are', async () => {
    const reply = await suggest({ query: '"ｍａｃＯＳ １５ ｕｐｄａｔｅ ｆａｉｌｅｄ"' });

    expect(reply.structured).toEqual(['macos 15 update', 'upgrade', 'patch', 'software update']);
  });

  it('reads a full-width hyphen as a space, as before, not as a hyphen that joins words', async () => {
    // A live zh-TW title. Folded whole, as NFKC folds it, Jamf－－ would be the
    // word jamf--; read as spaces, it is Jamf, which is a stop word.
    const reply = await suggest({ query: '"Jamf－－建議的進階電腦搜尋"', language: 'zh-TW' });

    expect(reply.structured).toEqual(['建議 電腦 搜尋']);
  });

  it('reads a symbol that NFKC spells in Latin letters as a space, as before, not as part of a word', async () => {
    // Live on 2026-09-28, `Jamf Pro\u2122` had the 22,191 results of `pro`,
    // and `protm`, what NFKC makes of Pro\u2122, none.
    expect((await suggest({ query: '"Jamf Pro\u2122 policy settings"' })).structured).toEqual([
      'pro policy settings', 'policies', 'rule', 'rules', 'enforcement', 'config',
    ]);
    expect((await suggest({ query: 'Jamf Pro\u2122' })).structured).toEqual([]);
  });

  it('reads one full-width word as the half-width word, whose synonyms it is suggested', async () => {
    // Not `sso` itself: since 2026-09-28 ＳＳＯ is sent to Fluid Topics as
    // SSO, so `sso` is the query that found nothing. A SearchProvider, handed
    // ＳＳＯ as typed, is still suggested `sso` (search-full-width-query.test.ts).
    const reply = await suggest({ query: 'ＳＳＯ' });

    expect(reply.structured).toEqual(['single sign-on', 'authentication', 'identity', 'login']);
    expect(reply.markdown).not.toContain('Try simpler query');
  });
});

describe('a Thai query with no results', () => {
  const thai = (language: string, byDefault: boolean): string => language === 'en-US'
    ? `This query has words in Thai, and the documentation in "en-US"${byDefault ? ' (the default language)' : ''} ` +
      'is in English, so it does not have them. Search it with the English terms. Or search with language: ' +
      '"th-TH", where the documentation is in Thai.'
    : `This query has words in Thai, and the documentation in "${language}" is not in Thai, so it does not ` +
      'have them. The en-US documentation is in English: to search it, use the English terms, with language: ' +
      '"en-US". Or search with language: "th-TH", where the documentation is in Thai.';

  it('in th-TH, suggests its words, cut where Thai puts no space between them', async () => {
    // "Creating a remote class failed", from the live th-TH Jamf Teacher
    // guide's การสร้างชั้นเรียน ("Creating a class"). The words are the
    // Unicode rules': การ | สร้าง | ชั้น | เรียน | ระยะ | ไกล | ล้ม | เหลว.
    const reply = await suggest({ query: '"การสร้างชั้นเรียนระยะไกลล้มเหลว"', language: 'th-TH' });

    expect(reply.structured).toEqual(['การ สร้าง ชั้น']);
  });

  it('keeps a Thai word whole across its vowel ำ, which NFKC would take apart', async () => {
    // The live title of the th-TH Jamf Parent guide, "Jamf Parent guide for
    // parents". NFKC writes ำ as two characters, and สำหรับ ("for") would be
    // cut into สําห and รับ.
    const reply = await suggest({ query: '"คู่มือ Jamf Parent สำหรับผู้ปกครอง"', language: 'th-TH' });

    expect(reply.structured).toEqual(['คู่มือ parent สำหรับ']);
  });

  it('in the default language, suggests none of its Thai words, and names th-TH', async () => {
    // ใบรับรอง is "certificate". Live on 2026-09-28 it had no results in
    // en-US, and the reply had no note.
    const reply = await suggest({ query: 'ใบรับรอง' });

    expect(reply.structured).toEqual([]);
    expect(reply.json.localeNote).toBe(thai('en-US', true));
    expect(reply.markdown).toContain(`\n\n${thai('en-US', true)}`);
  });

  it('says the same when en-US is asked for, without calling it the default', async () => {
    expect((await suggest({ query: 'ใบรับรอง', language: 'en-US' })).json.localeNote).toBe(thai('en-US', false));
  });

  it('in another language than en-US, names en-US and th-TH', async () => {
    // Until 2026-09-28 the note named en-US only.
    const reply = await suggest({ query: 'ใบรับรอง', language: 'de-DE' });

    expect(reply.structured).toEqual([]);
    expect(reply.json.localeNote).toBe(thai('de-DE', false));
  });

  it('keeps the Latin words of a mixed query everywhere, and its Thai words in th-TH only', async () => {
    // "Enabling Zoom in Jamf Teacher" with FaceTime added, after the live
    // th-TH title การเปิดใช้งาน Zoom ใน Jamf Teacher.
    const query = '"Jamf Teacher Zoom การเปิดใช้งาน FaceTime"';

    expect((await suggest({ query })).structured).toEqual(['teacher zoom facetime']);
    expect((await suggest({ query, language: 'th-TH' })).structured).toEqual(['teacher zoom การ']);
  });
});

describe('a query in a script no documentation is written in', () => {
  it('is suggested none of its words, as before', async () => {
    // "Certificate renewal error" in Russian. Jamf publishes no documentation
    // in Cyrillic, so these words are not in any, and are read as spaces.
    const reply = await suggest({ query: '"сертификат продление ошибка"', language: 'de-DE' });

    expect(reply.structured).toEqual([]);
  });
});

describe('a query of ASCII alone is suggested what it was before', () => {
  // Byte for byte what each was suggested on 2026-09-28, before letters other
  // than ASCII were read as letters. Quoted, so the queries of fewer words
  // are still made (see search-suggestions-any-word.test.ts).
  it.each([
    ['"renew push certificate failed"', 'en-US', ['renew push certificate', 'deploy', 'certificates', 'cert', 'ssl', 'tls']],
    ['"how to configure the mdm enrollment process"', 'en-US', ['configure mdm enrollment', 'config', 'mobile device management', 'device management']],
    ['"Jamf Pro 11.32.0 release notes"', 'de-DE', ['pro 11 32']],
    ['"wi-fi_config: vpn/proxy (settings)"', 'es-ES', ['wi-fi_config vpn proxy', 'network', 'config']],
  ])('%s in %s', async (query, language, expected) => {
    const reply = await suggest({ query, language });

    expect(reply.structured).toEqual(expected);
    expect(reply.json.suggestions).toEqual(expected);
  });
});
