/**
 * A title made from a slug that is not ASCII.
 *
 * `titleFromSlug` is handed a path segment as `URL.pathname` spells it, and
 * that spelling percent-encodes every non-ASCII character. So each of the 29
 * support.jamf.com articles with a Japanese or Chinese slug was indexed under
 * a title like "Jamf ID %E3%81%AE%E4%BD%9C%E6%88%90", which no query in either
 * language can match, since Fuse compares the query with the escapes. Those 29
 * are every ja and zh-TW article support.jamf.com lists, so a search in either
 * language never matched a support article on its own words: only a query
 * that shared an ASCII word with the slug, such as "Jamf ID", matched at all.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockHttpGetText = vi.fn<(url: string) => Promise<string>>();
vi.mock('../../../src/core/http-client.js', () => ({
  httpGetText: async (url: string) => await mockHttpGetText(url),
}));

import { titleFromSlug } from '../../../src/core/services/sitemap-service.js';
import { loadStaticIndex } from '../../../src/core/services/static-search-service.js';
import { STATIC_DOC_SOURCES } from '../../../src/core/constants/sources.js';
import { createMockContext } from '../../helpers/mock-context.js';
import { SUPPORT_NON_ASCII_ARTICLES } from '../../fixtures/support-non-ascii-articles.js';

const SUPPORT = STATIC_DOC_SOURCES['jamf-support'];

/** A slug as `URL.pathname` hands it over: percent-encoded. */
const encoded = (slug: string): string => new URL(`https://x.invalid/${slug}`).pathname.slice(1);

describe('titleFromSlug on a percent-encoded slug', () => {
  it('decodes it before making a heading of it', () => {
    expect(encoded('jamf-id-の作成')).toBe('jamf-id-%E3%81%AE%E4%BD%9C%E6%88%90');
    expect(titleFromSlug(encoded('jamf-id-の作成'))).toBe('Jamf ID の作成');
    expect(titleFromSlug(encoded('在-jamf-pro-中更新您的-mdm-推播通知憑證')))
      .toBe('在 Jamf Pro 中更新您的 MDM 推播通知憑證');
  });

  it('gives a slug that is already decoded the same title', () => {
    expect(titleFromSlug('jamf-id-の作成')).toBe('Jamf ID の作成');
  });

  it('decodes every live slug run by run to what decoding it whole gives', () => {
    // A slug is decoded one run of escapes at a time, so that one bad escape
    // cannot cost the rest. The escapes of one character always stand side
    // by side, so on a slug that decodes whole that must change nothing.
    for (const { listed } of SUPPORT_NON_ASCII_ARTICLES) {
      const raw = listed.split('/').pop() ?? '';
      expect(titleFromSlug(encoded(raw)), listed).toBe(titleFromSlug(raw));
    }
  });

  it('decodes escapes spelled in lower-case hex', () => {
    // `URL.pathname` keeps an escape as the sitemap spells it.
    expect(new URL('https://x.invalid/%e3%81%ae').pathname).toBe('/%e3%81%ae');
    expect(titleFromSlug('jamf-id-%e3%81%ae%e4%bd%9c%e6%88%90')).toBe('Jamf ID の作成');
  });

  it.each([
    // `decodeURI` would keep each of these five: it decodes no reserved character.
    ['a%2Fb-guide', 'A/b Guide'],
    ['why%3F-jamf', 'Why? Jamf'],
    ['q%26a-jamf', 'Q&a Jamf'],
    ['faq%23setup', 'Faq#setup'],
    ['c%2B%2B-guide', 'C++ Guide'],
    // A path's "+" is a plus, not a space, as it would be in a query string.
    ['c++-guide', 'C++ Guide'],
    ['50%25-off', '50% Off'],
    // RFC 3986 makes `%2D` and `-` the same URI, so they make the same title.
    ['e%2Dmail-setup', 'E Mail Setup'],
  ])('decodes the escape of a reserved or unreserved character: %s', (slug, title) => {
    expect(titleFromSlug(slug)).toBe(title);
  });

  it.each([
    // The controls and the line and paragraph separators. A newline, or
    // anything else that ends a line, would end the Markdown list item the
    // title is written into.
    ['line%0Abreak', 'Line%0Abreak'],
    ['nul%00x', 'Nul%00x'],
    ['del%7Fx', 'Del%7Fx'],
    ['nel%C2%85x', 'Nel%C2%85x'],
    ['ls%E2%80%A8x', 'Ls%E2%80%A8x'],
    ['ps%E2%80%A9x', 'Ps%E2%80%A9x'],
    // The bidi formatting characters reorder the text around them: U+202A
    // to U+202E, U+2066 to U+2069, and the marks U+200E, U+200F and U+061C.
    ['lre%E2%80%AAx', 'Lre%E2%80%AAx'],
    ['rtl%E2%80%AEtxet', 'Rtl%E2%80%AEtxet'],
    ['lri%E2%81%A6x', 'Lri%E2%81%A6x'],
    ['pdi%E2%81%A9x', 'Pdi%E2%81%A9x'],
    ['lrm%E2%80%8Ex', 'Lrm%E2%80%8Ex'],
    ['rlm%E2%80%8Fx', 'Rlm%E2%80%8Fx'],
    ['alm%D8%9Cx', 'Alm%D8%9Cx'],
    // Inside a run that decodes, only that character stays escaped.
    ['jamf-%E3%81%AE%0A%E4%BD%9C', 'Jamf の%0A作'],
  ])('keeps a control or bidi character as its escape: %s', (slug, title) => {
    expect(titleFromSlug(slug)).toBe(title);
  });

  it('escapes a control character in a slug that is already decoded', () => {
    const newline = String.fromCharCode(0x0A);
    expect(titleFromSlug(`line${newline}break`)).toBe('Line%0Abreak');
  });

  it.each([
    // A truncated UTF-8 sequence: `decodeURIComponent` throws URIError on it.
    ['jamf-%E3%81', 'Jamf %E3%81'],
    // A byte that starts no UTF-8 sequence at all.
    ['jamf-%FF-pro', 'Jamf %FF Pro'],
    // One run that decodes and one that does not, in the same slug.
    ['jamf-id-%E3%81%AE%E4%BD%9C%E6%88%90-%E3%81', 'Jamf ID の作成 %E3%81'],
    // A `%` that is not an escape at all.
    ['100%-jamf', '100% Jamf'],
  ])('keeps an escape it cannot decode as written, rather than throwing: %s', (slug, title) => {
    expect(() => titleFromSlug(slug)).not.toThrow();
    expect(titleFromSlug(slug)).toBe(title);
  });

  it('decodes an escaped `%` once, not twice', () => {
    // `%2541` is the text "%41". Decoding it again would make it "A".
    expect(titleFromSlug('50%2541-off')).toBe('50%41 Off');
  });

  it('cases the Latin words inside a word the slug wrote without spaces', () => {
    // Japanese puts no space between words, so Intercom's slug does not
    // either, and one hyphen-separated "word" can hold several.
    expect(titleFromSlug(encoded('jamf-accountでjamf-idを組織に関連付ける')))
      .toBe('Jamf AccountでJamf IDを組織に関連付ける');
    expect(titleFromSlug(encoded('プッシュ証明書の作成に使用されたappleアカウントの確認')))
      .toBe('プッシュ証明書の作成に使用されたAppleアカウントの確認');
  });

  it('exempts only the run that opens the title from the minor-word rule', () => {
    expect(titleFromSlug(encoded('inでjamf'))).toBe('InでJamf');
    expect(titleFromSlug(encoded('jamf-inでjamf'))).toBe('Jamf inでJamf');
    expect(titleFromSlug(encoded('jamfでin'))).toBe('Jamfでin');
  });

  it('keeps the digits of a Latin run with it, as a word keeps them', () => {
    expect(titleFromSlug('2fa')).toBe('2fa');
    expect(titleFromSlug(encoded('2faで'))).toBe('2faで');
  });

  it('still cases a word in one script as one word, whichever script', () => {
    expect(titleFromSlug(encoded('über-jamf'))).toBe('Über Jamf');
    // No source publishes a Cyrillic slug; this is the case-bearing script
    // that per-run casing would leave lower-case if it ran on every word.
    expect(titleFromSlug(encoded('привет-jamf'))).toBe('Привет Jamf');
  });

  it('does not count a letter of the Common script as another script', () => {
    // µ belongs to no one script, so `10µs` is one Latin word, cased whole.
    expect(titleFromSlug(encoded('10µs-latency'))).toBe('10µs Latency');
  });
});

describe('the support.jamf.com index in ja and zh-TW', () => {
  beforeEach(() => { mockHttpGetText.mockReset(); });

  /** What survives into a slug: letters and digits, not punctuation, spacing or case. */
  const letters = (text: string): string =>
    text.normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();

  it.each(['ja', 'zh-TW'])('titles every %s article with the words of its own title', async (locale) => {
    const articles = SUPPORT_NON_ASCII_ARTICLES.filter(a => a.listed.startsWith(`/${locale}/`));
    // Listed raw, as the live sitemap lists them.
    mockHttpGetText.mockResolvedValue(`<urlset>${articles
      .map(a => `<url><loc>https://support.jamf.com${a.listed}</loc></url>`).join('')}</urlset>`);

    const entries = await loadStaticIndex(createMockContext(), SUPPORT, locale);

    expect(entries).toHaveLength(articles.length);
    for (const [index, entry] of entries.entries()) {
      expect(entry.title, entry.url).not.toMatch(/%[0-9A-F]{2}/i);
      expect(letters(entry.title), entry.url).toBe(letters(articles[index].title));
    }
  });
});
