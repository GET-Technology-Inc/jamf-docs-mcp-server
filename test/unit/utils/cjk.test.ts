/**
 * `splitCjkWords`, which cuts a Chinese, Japanese or Korean run into its
 * words and leaves the rest of a text to the caller's own splitter, and
 * `cjkWritingOf`, which says what such a run is written in, and so which
 * languages' documentation can have its words.
 *
 * Two promises the search suggestions rest on:
 *
 * - Text with no Chinese, Japanese or Korean character goes to the caller's
 *   splitter whole, so a Latin query has exactly the words it had before
 *   (2026-09-28). That includes text whose only such marks are ー, ・, 、 or
 *   。: they are in the Common script, and a run of them alone is not cut.
 * - The module imports on a runtime without `Intl.Segmenter`. The schemas,
 *   the search suggestions and the glossary all import it, so a segmenter
 *   made at import would stop the server from starting there.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  NON_LATIN_LETTER,
  cjkWritingOf,
  documentationCanHaveCjkOf,
  splitCjkWords,
} from '../../../src/core/utils/cjk.js';

/** Split the way the search suggestions split Latin text, dropping empty words. */
function latin(part: string): string[] {
  return part.split(/\s+/).filter(word => word !== '');
}

const MIXED = '推送證書、續約 renew パスワード・リセット';

describe('splitCjkWords', () => {
  it('cuts a run into its words, and leaves its punctuation out', () => {
    expect(splitCjkWords(MIXED, latin)).toEqual(['推送', '證書', '續約', 'renew', 'パスワード', 'リセット']);
  });

  it.each([
    'configure mdm enrollment ー',
    'wi-fi・vpn、proxy。settings',
    // Halfwidth ｡ and ･, an ideographic space, ー and a non-breaking hyphen.
    '\uFF61 protect \uFF65 \u3000 ー Wi\u2011Fi',
  ])('hands %j to the other splitter whole', (text) => {
    const parts: string[] = [];

    const words = splitCjkWords(text, (part) => { parts.push(part); return ['word']; });

    expect(parts).toEqual([text]);
    expect(words).toEqual(['word']);
  });
});

describe('NON_LATIN_LETTER', () => {
  it.each(['憑證', 'パスワード', '인증서', 'ใบรับรอง', 'сертификат', 'MDM 設定'])(
    'finds a letter of another script than Latin in %j', (text) => {
      expect(NON_LATIN_LETTER.test(text)).toBe(true);
    },
  );

  it.each([
    'Smart Grup',
    'Größe',
    // Full-width Latin letters are Latin.
    'ＳＳＯ',
    // µ and ー are letters of the Common script, which several scripts share.
    'µs',
    'configure ー',
  ])('finds none in %j', (text) => {
    expect(NON_LATIN_LETTER.test(text)).toBe(false);
  });
});

describe('cjkWritingOf', () => {
  it.each([
    // Han alone: Chinese, or Japanese Kanji. Nor does it tell zh-TW from zh-CN.
    ['推送證書 renew', 'Chinese or Japanese', ['zh-TW', 'zh-CN', 'ja-JP']],
    // ・ and ー are in the Common script, written with Kana and also without.
    ['推送・證書', 'Chinese or Japanese', ['zh-TW', 'zh-CN', 'ja-JP']],
    // Kana, alone or with Kanji, is Japanese.
    ['パスワードの変更', 'Japanese', ['ja-JP']],
    ['ログイン', 'Japanese', ['ja-JP']],
    // Hangul, alone or with Hanja, is Korean, which Jamf publishes nothing in.
    ['인증서', 'Korean', []],
    ['韓國 인증서', 'Korean', []],
  ])('reads %j as %s', (text, name, locales) => {
    expect(cjkWritingOf(text)).toEqual({ name, locales });
  });

  it.each(['renew push certificate', 'wi-fi・vpn、proxy。settings', 'configure ー', 'ใบรับรอง'])(
    'finds no Chinese, Japanese or Korean character in %j', (text) => {
      expect(cjkWritingOf(text)).toBeUndefined();
    },
  );
});

describe('documentationCanHaveCjkOf', () => {
  it.each([
    ['推送證書', 'zh-TW', true],
    ['推送證書', 'zh-CN', true],
    ['推送證書', 'ja-JP', true],
    ['推送證書', 'en-US', false],
    ['推送證書', 'de-DE', false],
    ['パスワード', 'ja-JP', true],
    ['パスワード', 'zh-TW', false],
    ['인증서', 'en-US', false],
    // Nothing to rule out.
    ['renew push certificate', 'en-US', true],
    ['ใบรับรอง', 'en-US', true],
  ])('%j in %s: %s', (text, language, expected) => {
    expect(documentationCanHaveCjkOf(text, language)).toBe(expected);
  });
});

describe('on a runtime without Intl.Segmenter', () => {
  it('imports, and cuts a run at its punctuation only', async () => {
    const segmenter = Object.getOwnPropertyDescriptor(Intl, 'Segmenter');
    Reflect.deleteProperty(Intl, 'Segmenter');
    try {
      vi.resetModules();
      const cjk = await import('../../../src/core/utils/cjk.js');
      const { SearchInputSchema } = await import('../../../src/core/schemas/index.js');

      // No dictionary to find 推送 and 證書 in 推送證書 by, so it is one word,
      // as a Latin word written without spaces would be.
      expect(cjk.splitCjkWords(MIXED, latin)).toEqual(['推送證書', '續約', 'renew', 'パスワード', 'リセット']);
      expect(SearchInputSchema.safeParse({ query: '鎖' }).success).toBe(true);
    } finally {
      if (segmenter !== undefined) { Object.defineProperty(Intl, 'Segmenter', segmenter); }
      vi.resetModules();
    }
    expect(typeof Intl.Segmenter).toBe('function');
  });
});
