/**
 * The case of each word in a title made from a slug, against the page's own.
 *
 * A slug keeps a title's letters but not their case, so every static title is
 * cased by rule: capitalise each word, except the words `TITLE_CASE_TERMS`
 * spells. Until 2026-09-28 that table held 40 words, and 203 of the 987 live
 * titles it could be checked against got one wrong by the rule below:
 * "Apns Certificate and Jamf Now", "How to Determine If an Idp Is Configured
 * to Use Ropg", "Managing Shared Ipads with Jamf School", "Pppc Utility". The
 * other-sources block of `jamf_docs_search` shows these titles, and
 * `jamf_docs_get_toc` shows concepts.jamf.com's.
 *
 * Checked against every live title in the fixture, through the index the
 * search tool reads. Two differences in a word's first letter alone are
 * style, not a term, and are not counted: a word this capitalises that the
 * page writes in lower case, as support.jamf.com's sentence case does ("How
 * to determine if…"), unless it opens the title; and a minor word this writes
 * in lower case that the page capitalises ("Via", "The"). Title case never
 * lower-cases any other word, so one that the page capitalises is a miss.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockHttpGetText = vi.fn<(url: string) => Promise<string>>();
vi.mock('../../../src/core/http-client.js', () => ({
  httpGetText: async (url: string) => await mockHttpGetText(url),
}));

import { loadStaticIndex } from '../../../src/core/services/static-search-service.js';
import { ORDINARY_WORDS, TITLE_CASE_TERMS, titleFromSlug } from '../../../src/core/services/sitemap-service.js';
import { STATIC_DOC_SOURCES, canonicalStaticUrl, type StaticDocSource } from '../../../src/core/constants/sources.js';
import { createMockContext } from '../../helpers/mock-context.js';
import { CONCEPTS_TITLES, SUPPORT_TITLES, type StaticTitle } from '../../fixtures/static-titles.js';

const SUPPORT = STATIC_DOC_SOURCES['jamf-support'];
const CONCEPTS = STATIC_DOC_SOURCES['jamf-concepts'];

/** A title's letters and digits, in order: what its slug keeps of it. */
const lettersOf = (text: string): string[] => text.match(/[\p{L}\p{N}]/gu) ?? [];

const isUpper = (char: string): boolean => char !== char.toLowerCase();
const isLower = (char: string): boolean => char !== char.toUpperCase();

/**
 * Each word of `ours` that the page's title cases otherwise, as `ours → page`.
 *
 * The fixture holds only titles whose slug keeps every letter and digit, in
 * order, so each word of ours has a place in the page's title. A word that
 * differs in its first letter alone, with the rest lower case in both, is
 * not returned when it is style:
 * - ours capitalised, the page's in lower case, as sentence case writes it,
 *   unless the page's title opens with it, which sentence case never does:
 *   "authchanger and Jamf Connect";
 * - ours in lower case and by no entry of the table, so a minor word, which
 *   title case writes so, and the page's capitalised: "Via", "The".
 */
function casingMisses(ours: string, page: string): string[] {
  const pageLetters = lettersOf(page);
  expect(pageLetters.join('').toLowerCase(), page).toBe(lettersOf(ours).join('').toLowerCase());

  const misses: string[] = [];
  let at = 0;
  for (const word of ours.split(' ')) {
    const mine = lettersOf(word).join('');
    const theirs = pageLetters.slice(at, at + lettersOf(word).length).join('');
    const opensTitle = at === 0;
    at += lettersOf(word).length;
    if (mine === theirs) { continue; }
    const rest = mine.slice(1);
    const onlyFirst = rest === theirs.slice(1) && rest === rest.toLowerCase();
    const sentenceCase = isUpper(mine.charAt(0)) && isLower(theirs.charAt(0)) && !opensTitle;
    const minorWord = isLower(mine.charAt(0)) && isUpper(theirs.charAt(0)) && !TITLE_CASE_TERMS.has(mine);
    if (!(onlyFirst && (sentenceCase || minorWord))) { misses.push(`${mine} → ${theirs}`); }
  }
  return misses;
}

/** Every casing miss over the fixture's titles for one source, counted by word. */
async function missesFor(source: StaticDocSource, titles: readonly StaticTitle[]): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const locales = [...new Set(titles.map(t => t.listed.split('/')[1]))];
  for (const locale of locales) {
    const listed = titles.filter(t => t.listed.startsWith(`/${locale}/`));
    // Listed raw and slashless, as both live sitemaps list them.
    mockHttpGetText.mockResolvedValue(`<urlset>${listed
      .map(t => `<url><loc>${source.baseUrl}${t.listed}</loc></url>`).join('')}</urlset>`);

    const entries = await loadStaticIndex(createMockContext(), source, locale);

    expect(entries).toHaveLength(listed.length);
    for (const [index, entry] of entries.entries()) {
      const page = listed[index];
      expect(entry.url).toBe(canonicalStaticUrl(source, `${source.baseUrl}${page.listed}`));
      for (const miss of casingMisses(entry.title, page.title)) {
        counts[miss] = (counts[miss] ?? 0) + 1;
      }
    }
  }
  return counts;
}

describe('the case of a static title made from its slug', () => {
  beforeEach(() => { mockHttpGetText.mockReset(); });

  it('changes only the case of a slug\'s words, so a search matches what it did', () => {
    // Fuse ignores case, so a title that differs from its slug's words in
    // case alone is matched and ranked as they would be. The site writes
    // `jamfplatform` as "Jamf Platform"; split, it moved the hits of 994 of
    // 61,976 queries taken from the live titles (2026-09-28).
    for (const { listed } of [...SUPPORT_TITLES, ...CONCEPTS_TITLES]) {
      const slug = (listed.split('/').pop() ?? '').replace(/^\d+-/, '');
      expect(titleFromSlug(slug).toLowerCase(), listed).toBe(slug.split('-').join(' ').toLowerCase());
    }
  });

  it('changes only the case of its key, in every entry of the table', () => {
    // The same, for an entry no live title holds, or whose titles the
    // fixture leaves out.
    expect(TITLE_CASE_TERMS.size).toBeGreaterThan(0);
    for (const [key, term] of TITLE_CASE_TERMS) {
      expect(term.toLowerCase(), term).toBe(key);
      expect(titleFromSlug(key), key).toBe(term);
    }
  });

  it('cases a word that names a property every object inherits as a word', () => {
    // Looked up on an object literal, `constructor` came out as
    // "function Object() { [native code] }", and `__proto__` as "[object Object]".
    expect(titleFromSlug('constructor')).toBe('Constructor');
    expect(titleFromSlug('the-constructor-pattern')).toBe('The Constructor Pattern');
    expect(titleFromSlug('__proto__')).toBe('__proto__');
    expect(titleFromSlug('tostring-and-hasownproperty')).toBe('Tostring and Hasownproperty');
    expect(titleFromSlug('toString-and-hasOwnProperty')).toBe('ToString and HasOwnProperty');
    expect(titleFromSlug('os-constructor', 'constructor')).toBe('OS Constructor');
    expect(titleFromSlug('os-constructor', '__proto__')).toBe('OS Constructor');
  });

  it('spells every term in a concepts.jamf.com title as the page does', async () => {
    expect(await missesFor(CONCEPTS, CONCEPTS_TITLES)).toEqual({});
  });

  it('spells every term in a support.jamf.com title as the article does, but for the words left alone', async () => {
    expect(await missesFor(SUPPORT, SUPPORT_TITLES)).toEqual({
      // Words the site spells two ways. The pronoun "it" is a word a slug
      // cannot tell from the abbreviation IT, which 3 titles hold.
      'IT → it': 4,
      'macOS → MacOS': 3,
      'Mac → MAC': 2,
      'URL → url': 1,
      // The same, where most titles spell it as Apple and Jamf do.
      'APNs → APNS': 1,
      'FileVault → Filevault': 1,
      // A tie, one title each way. An entry for eBooks would only trade one
      // for the other; "Pin" matched neither "PIN" nor this lower-case "pin".
      'Ebooks → eBooks': 1,
      'PIN → pin': 1,
      // Ordinary words a title spells in capitals, in a name or a quote.
      'Jamf → JAMF': 2,
      'Get → GET': 1,
      'None → NONE': 1,
      'Trial → TRIAL': 1,
      'Idea → IDEA': 1,
      'Insight → INSIGHT': 1,
      // Identifiers a title quotes from an error or a setting. "jamf-auth"
      // opens the en and de titles that quote it in lower case.
      'Jamf → jamf': 2,
      'Allowcloudpasswordvalidation → AllowCloudPasswordValidation': 1,
      'Allowmarketplaceappinstallation → allowMarketplaceAppInstallation': 1,
      'Appbundleid → AppBundleID': 2,
      'Asderrordomain → ASDErrorDomain': 1,
      'Bycloudconfigretrieveprofilefromweberrordomain → BYCloudConfigRetrieveProfileFromWebErrorDomain': 1,
      'Enablefirewall → enableFirewall': 1,
      'Enablestealthmode → enableStealthMode': 1,
      'Enrollmentstatusfail → ENROLLMENTSTATUSFAIL': 1,
      'Mdmclienterror → MDMClientError': 1,
      'Mdmresponsestatus → MDMResponseStatus': 1,
      'Mfaexcluded → MFAExcluded': 1,
      'Notnow → NotNow': 1,
      'Nssingle0bjectarray → NSSingle0bjectArray': 1,
      'Sperrordomain → SPErrorDomain': 1,
      'Submitvpprequest → submitVPPRequest': 1,
      'Supportphoneinvalid → SUPPORTPHONEINVALID': 1,
    });
  });
});

describe('a term that is also an ordinary word in the slug\'s language', () => {
  const capitalised = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

  beforeEach(() => { mockHttpGetText.mockReset(); });

  it('is cased as a word in that language, and as the term in any other', () => {
    // Each is a word in that language, and no slug in it holds one yet.
    expect(Object.fromEntries([...ORDINARY_WORDS].map(([language, words]) => [language, [...words].sort()])))
      .toEqual({
        de: ['ade', 'mime', 'mut', 'pin'],
        es: ['os', 'pin'],
        fr: ['ai', 'gui', 'laps', 'mime', 'oie', 'os', 'pin', 'soc'],
      });
    for (const [language, words] of ORDINARY_WORDS) {
      for (const word of words) {
        // An entry that changes more than the first letter, to pass over.
        const term = TITLE_CASE_TERMS.get(word);
        expect(term, word).toBeDefined();
        expect(term, word).not.toBe(capitalised(word));

        expect(titleFromSlug(`on-${word}`, language), language).toBe(`On ${capitalised(word)}`);
        for (const other of ['en', 'ja', 'zh-TW', undefined]) {
          expect(titleFromSlug(`on-${word}`, other), other).toBe(`On ${term ?? ''}`);
        }
      }
    }
  });

  it('reads a support.jamf.com slug as its locale\'s language, and a concepts.jamf.com one as English', async () => {
    // Made up: no de, es or fr slug holds one of these words (2026-09-28).
    const support = [
      '/es/articles/1-os-recomendamos-reiniciar-el-mac',
      '/de/articles/2-mut-zur-lucke',
      '/fr/articles/3-j-ai-perdu-mon-mot-de-passe',
      '/en/articles/4-pin-code-for-the-os-update',
    ];
    mockHttpGetText.mockImplementation(async (url) => await Promise.resolve(url === `${SUPPORT.baseUrl}/sitemap.xml`
      ? `<urlset>${support.map(path => `<url><loc>${SUPPORT.baseUrl}${path}</loc></url>`).join('')}</urlset>`
      : `<urlset><url><loc>${CONCEPTS.baseUrl}/fr/guides/ai-governance</loc></url></urlset>`));
    const ctx = createMockContext();
    const titles = async (source: StaticDocSource, locale: string): Promise<string[]> =>
      (await loadStaticIndex(ctx, source, locale)).map(entry => entry.title);

    expect(await titles(SUPPORT, 'es')).toEqual(['Os Recomendamos Reiniciar El Mac']);
    expect(await titles(SUPPORT, 'de')).toEqual(['Mut Zur Lucke']);
    expect(await titles(SUPPORT, 'fr')).toEqual(['J Ai Perdu Mon Mot De Passe']);
    expect(await titles(SUPPORT, 'en')).toEqual(['PIN Code for the OS Update']);
    // concepts.jamf.com lists the en slugs in every locale.
    expect(await titles(CONCEPTS, 'fr')).toEqual(['AI Governance']);
  });
});
