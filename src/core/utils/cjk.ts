/**
 * Chinese, Japanese and Korean text: what tells it apart from Latin text, and
 * how to find its words.
 *
 * Latin text puts a space or a punctuation mark between words; Chinese and
 * Japanese put nothing. So a rule that finds a word by what surrounds it,
 * `\w+` or a non-alphanumeric on either side, finds no word in them at all.
 * And a length that makes a Latin query too short to be a word does not make
 * a Chinese one so: 密碼 ("password") is two characters, and 鎖 ("lock") one.
 */

import type { LocaleId } from '../constants.js';

/** A Chinese, Japanese or Korean character: Han, Hiragana, Katakana or Hangul. */
export const CJK_CHARACTER = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/** Hiragana or Katakana, which are written in Japanese only. */
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;

/** Hangul, which is written in Korean only. */
const HANGUL = /\p{Script=Hangul}/u;

/**
 * What a text's Chinese, Japanese or Korean characters say it is written in:
 * `name`, for a sentence such as "This query has words in Japanese", and the
 * languages Jamf publishes documentation in that are written in it.
 */
export interface CjkWriting {
  name: string;
  locales: readonly LocaleId[];
}

/**
 * The writing of the Chinese, Japanese or Korean characters in `text`, or
 * undefined when it has none. Only the script is read, and it says this much:
 * Kana is Japanese, Hangul is Korean, and Han alone is Chinese or Japanese,
 * whose Kanji are Han too. Nor does Han tell zh-TW from zh-CN.
 *
 * Jamf publishes no documentation in Korean (see SUPPORTED_LOCALES), so a
 * text with Hangul has no language it can be searched in as written.
 */
export function cjkWritingOf(text: string): CjkWriting | undefined {
  if (!CJK_CHARACTER.test(text)) { return undefined; }
  if (HANGUL.test(text)) { return { name: 'Korean', locales: [] }; }
  if (KANA.test(text)) { return { name: 'Japanese', locales: ['ja-JP'] }; }
  return { name: 'Chinese or Japanese', locales: ['zh-TW', 'zh-CN', 'ja-JP'] };
}

/**
 * Whether the documentation in `language` is written the way the Chinese,
 * Japanese or Korean words of `text` are, so could have them. True for a text
 * with none: its words are not ruled out by their script.
 */
export function documentationCanHaveCjkOf(text: string, language: string): boolean {
  const writing = cjkWritingOf(text);
  return writing === undefined || writing.locales.some(locale => locale === language);
}

/**
 * A run of text in those scripts, with the marks written inside it: the
 * Katakana long vowel mark ー, the middle dot ・, 、 and 。. Those are in the
 * Common script, used by more than one, and belong to these four by their
 * Script_Extensions. By the Script property alone, ー would cut パスワード
 * ("password") in two. Capturing, so that a split keeps the runs.
 */
const CJK_RUN = new RegExp(
  String.raw`([\p{Script_Extensions=Han}\p{Script_Extensions=Hiragana}` +
    String.raw`\p{Script_Extensions=Katakana}\p{Script_Extensions=Hangul}]+)`,
  'u',
);

/**
 * A letter of a script other than Latin: Han, Hangul, Thai, Cyrillic and the
 * rest. A word with one is not an English word, so the English documentation
 * and glossary do not contain it as written. Letters of the Common script,
 * such as ー and µ, are shared by several scripts and do not count.
 */
export const NON_LATIN_LETTER = /(?![\p{Script=Latin}\p{Script=Common}])\p{L}/u;

/**
 * Word boundaries by the Unicode rules, which find Chinese and Japanese words
 * with a dictionary: 推送證書續約失敗 is 推送 | 證書 | 續約 | 失敗 ("push",
 * "certificate", "renewal", "failure"). The locale does not change them for
 * these scripts: und, zh-TW, zh-CN, ja-JP, ko-KR and en-US cut all 214 live
 * Chinese and Japanese titles the same way (Node 26, 2026-09-28).
 *
 * Made on first use, not when this module is imported: the schemas, the
 * search suggestions and the glossary all import it, so a runtime without
 * `Intl.Segmenter` would otherwise fail to start the server at all. Null on
 * such a runtime, where `splitCjkWords` cuts a run at its punctuation only.
 * Node 24 and 26 and Cloudflare's workerd have it (2026-09-28).
 */
let wordSegmenter: Intl.Segmenter | null | undefined;

function segmenter(): Intl.Segmenter | null {
  if (wordSegmenter === undefined) {
    try {
      wordSegmenter = new Intl.Segmenter('und', { granularity: 'word' });
    } catch {
      wordSegmenter = null;
    }
  }
  return wordSegmenter;
}

/** The words of one Chinese, Japanese or Korean run, without its punctuation. */
function wordsOfRun(run: string): string[] {
  const words = segmenter();
  if (words === null) {
    // No dictionary to cut by: each stretch between punctuation marks is a
    // word, as each stretch between spaces is in Latin text. ー is a letter
    // (Lm), so it stays inside パスワード.
    return run.split(/[^\p{L}\p{M}\p{N}]+/u).filter(word => word !== '');
  }
  return [...words.segment(run)].filter(s => s.isWordLike === true).map(s => s.segment);
}

/**
 * The words of `text`: those of each Chinese, Japanese or Korean run, and
 * whatever `splitOther` makes of the text between the runs, in order.
 *
 * Text with no Chinese, Japanese or Korean character in it goes to
 * `splitOther` whole, so for it this is `splitOther` and nothing else. That
 * includes text whose only such marks are ー, ・, 、 or 。, which are in the
 * Common script: a run of them alone is not cut here. A run's punctuation is
 * not a word, and is dropped.
 */
export function splitCjkWords(text: string, splitOther: (part: string) => string[]): string[] {
  if (!CJK_CHARACTER.test(text)) { return splitOther(text); }
  // A capturing split alternates the text between runs with the runs, so the
  // runs are at the odd indexes.
  return text.split(CJK_RUN).flatMap((part, i) => i % 2 === 0 ? splitOther(part) : wordsOfRun(part));
}
