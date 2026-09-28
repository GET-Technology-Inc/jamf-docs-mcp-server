/**
 * The writings `jamf_docs_search` tells apart, so it can say which languages'
 * documentation can have a query's words: every script a language this
 * server accepts is written in, and Thai, which it was missing until
 * 2026-09-28.
 *
 * The script of each language is read from the Unicode locale data
 * (`Intl.Locale.maximize`), not listed here, so a language added to
 * SUPPORTED_LOCALES in a script this server does not know fails the first
 * test, by name.
 */

import { describe, it, expect, vi } from 'vitest';
import { SUPPORTED_LOCALE_IDS } from '../../../src/core/constants.js';
import { blankForeignWriting, foreignWritingOf, splitWords } from '../../../src/core/utils/cjk.js';

/** A word or two in each script, by its ISO 15924 code, as `Intl.Locale` names it. */
const WORDS_IN: Partial<Record<string, string>> = {
  Latn: 'certificate',
  Hant: '憑證',
  Hans: '证书',
  Jpan: '証明書 パスワード',
  Thai: 'ใบรับรอง',
};

/** Split the way the search suggestions split Latin text, dropping empty words. */
function latin(part: string): string[] {
  return part.split(/\s+/).filter(word => word !== '');
}

describe('every language this server accepts', () => {
  it.each(SUPPORTED_LOCALE_IDS)('%s is written in a script whose words the documentation in it can have', locale => {
    const script = new Intl.Locale(locale).maximize().script ?? '';
    const words = WORDS_IN[script];

    expect(words, `${locale} is written in ${script}, which this test has no words in`).toBeDefined();
    if (words === undefined) { return; }
    expect(foreignWritingOf(words, locale)).toBeUndefined();
    expect(blankForeignWriting(words, locale)).toBe(words);
    if (script !== 'Latn') {
      // And en-US, whose documentation is in English, is not where they are.
      expect(foreignWritingOf(words, 'en-US')?.locales).toContain(locale);
    }
  });
});

describe('Thai', () => {
  it('is its own writing, which the th-TH documentation is written in', () => {
    expect(foreignWritingOf('ใบรับรอง', 'en-US')).toEqual({ name: 'Thai', locales: ['th-TH'] });
    expect(foreignWritingOf('ใบรับรอง', 'de-DE')).toEqual({ name: 'Thai', locales: ['th-TH'] });
    expect(foreignWritingOf('ใบรับรอง Jamf Teacher', 'th-TH')).toBeUndefined();
  });

  it('is read as spaces where the documentation is not in it, and kept where it is', () => {
    expect(blankForeignWriting('Zoom ใน Teacher', 'en-US')).toBe('Zoom    Teacher');
    expect(blankForeignWriting('Zoom ใน Teacher', 'th-TH')).toBe('Zoom ใน Teacher');
  });

  it('is cut into its words, which it writes without spaces between them', () => {
    // "Enabling Zoom in Jamf Teacher", a live th-TH title.
    expect(splitWords('การเปิดใช้งาน Zoom ใน Jamf Teacher', latin))
      .toEqual(['การ', 'เปิด', 'ใช้', 'งาน', 'Zoom', 'ใน', 'Jamf', 'Teacher']);
  });
});

describe('a query in two writings', () => {
  it('names the one the documentation searched is not written in', () => {
    const both = 'ใบรับรอง 憑證';

    expect(foreignWritingOf(both, 'th-TH')?.name).toBe('Chinese or Japanese');
    expect(foreignWritingOf(both, 'zh-TW')?.name).toBe('Thai');
    expect(foreignWritingOf(both, 'en-US')?.name).toBe('Chinese or Japanese');
  });

  it('keeps the words of the one the documentation is written in, and only those', () => {
    expect(blankForeignWriting('ใบ 憑證', 'th-TH')).toBe('ใบ   ');
    expect(blankForeignWriting('ใบ 憑證', 'zh-TW')).toBe('   憑證');
  });
});

describe('on a runtime without Intl.Segmenter', () => {
  it('reads a Thai run between spaces as one word, marks and all', async () => {
    const segmenter = Object.getOwnPropertyDescriptor(Intl, 'Segmenter');
    Reflect.deleteProperty(Intl, 'Segmenter');
    try {
      vi.resetModules();
      const cjk = await import('../../../src/core/utils/cjk.js');

      // Its vowel signs and tone marks are marks, not letters, and do not cut it.
      expect(cjk.splitWords('การสร้างชั้นเรียน Zoom', latin)).toEqual(['การสร้างชั้นเรียน', 'Zoom']);
    } finally {
      if (segmenter !== undefined) { Object.defineProperty(Intl, 'Segmenter', segmenter); }
      vi.resetModules();
    }
  });
});
