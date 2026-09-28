/**
 * Which words `titleFromSlug` keeps in lower case: the minor words of the
 * language the slug is written in.
 *
 * Until 2026-09-28 the English ones were applied to every slug, so a French
 * one read "Mettre a Jour La Licence Jamf Connect Apres Le Renouvellement":
 * `a` is an English article, `la` and `le` are not. support.jamf.com is the
 * one source whose slugs are in their locale's language, and it writes de, es
 * and fr slugs in Latin letters. A title is made from one only where the
 * article's collection page cannot be read (static-titles.ts).
 */

import { describe, it, expect } from 'vitest';
import { titleFromSlug } from '../../../src/core/services/sitemap-service.js';
import { SUPPORT_LATIN_TITLES } from '../../fixtures/support-latin-titles.js';

const slugOf = (listed: string): string => (listed.split('/').pop() ?? '').replace(/^\d+-/, '');
const languageOf = (listed: string): string => listed.split('/')[1] ?? '';

/** A title's words as a slug keeps them: letters and digits, without accents, in lower case. */
const wordsOf = (text: string): string[] => text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const bare = (word: string): string => word.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const isUpper = (char: string): boolean => char !== char.toLowerCase();

describe('the minor words of a slug\'s own language', () => {
  it('are kept in lower case in a de, es or fr slug, and English\'s are not', () => {
    expect(titleFromSlug('mettre-a-jour-la-licence-jamf-connect-apres-le-renouvellement', 'fr'))
      .toBe('Mettre a Jour la Licence Jamf Connect Apres le Renouvellement');
    expect(titleFromSlug('actualizar-la-licencia-de-jamf-connect-despues-de-la-renovacion', 'es'))
      .toBe('Actualizar la Licencia de Jamf Connect Despues de la Renovacion');
    expect(titleFromSlug('self-service-muss-mit-dem-jamf-server-verknupft-sein', 'de'))
      .toBe('Self Service Muss mit dem Jamf Server Verknupft Sein');
    // English's `on`, `to` and `as` are no French or German minor words.
    expect(titleFromSlug('on-to-as-de', 'fr')).toBe('On To As de');
    expect(titleFromSlug('in-an-auf-the', 'de')).toBe('In an auf The');
  });

  it('are capitalised where they open the title', () => {
    expect(titleFromSlug('la-licence', 'fr')).toBe('La Licence');
    expect(titleFromSlug('der-server', 'de')).toBe('Der Server');
  });

  it('are English\'s in an en slug, in the Latin words of a ja or zh-TW one, and with no language', () => {
    for (const language of ['en', undefined]) {
      expect(titleFromSlug('how-to-determine-if-an-idp-is-configured-to-use-ropg', language))
        .toBe('How to Determine If an IdP Is Configured to Use ROPG');
    }
    // Their slugs spell only English words in Latin letters.
    expect(titleFromSlug('jamf-inでjamf-の-the-guide', 'ja')).toBe('Jamf inでJamf の the Guide');
    expect(titleFromSlug('jamf-pro-of-the-憑證', 'zh-TW')).toBe('Jamf Pro of the 憑證');
    // A language with none of its own: English's, as every slug had.
    expect(titleFromSlug('jamf-and-the-guide', 'nl')).toBe('Jamf and the Guide');
  });

  it('case the words of support.jamf.com\'s de, es and fr titles as the pages do more often than English\'s did', () => {
    // The first letter of each word, against the title Intercom's collection
    // page gives the article, where the slug keeps every word of it: 44 of
    // the 45 titles. English's minor words cased 188 of their 433 words as
    // the page does, and capitalising every word 181. The rest are words a
    // slug cannot tell apart: a German noun, capitalised, from any other
    // word, and a French or Spanish one, in lower case in their sentence-case
    // titles.
    let words = 0;
    let agree = 0;
    let titles = 0;
    for (const { listed, title } of SUPPORT_LATIN_TITLES) {
      const ours = wordsOf(titleFromSlug(slugOf(listed), languageOf(listed)));
      const theirs = wordsOf(title);
      if (theirs.map(bare).join(' ') !== ours.map(bare).join(' ')) { continue; }
      titles++;
      ours.forEach((word, index) => {
        words++;
        if (isUpper(word.charAt(0)) === isUpper(theirs[index]?.charAt(0) ?? '')) { agree++; }
      });
    }

    expect(SUPPORT_LATIN_TITLES).toHaveLength(45);
    expect({ titles, words, agree }).toEqual({ titles: 44, words: 433, agree: 289 });
  });
});
