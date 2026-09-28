/**
 * Chinese, Japanese and Korean text, and Thai: what tells it apart from Latin
 * text, and how to find its words.
 *
 * Latin text puts a space or a punctuation mark between words; Chinese,
 * Japanese and Thai put nothing. So a rule that finds a word by what surrounds
 * it, `\w+` or a non-alphanumeric on either side, finds no word in them at
 * all. And a length that makes a Latin query too short to be a word does not
 * make a Chinese one so: 密碼 ("password") is two characters, and 鎖 ("lock")
 * one.
 */

import type { LocaleId } from '../constants.js';

/** A Chinese, Japanese or Korean character: Han, Hiragana, Katakana or Hangul. */
export const CJK_CHARACTER = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/** Hiragana or Katakana, which are written in Japanese only. */
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;

/** Hangul, which is written in Korean only. */
const HANGUL = /\p{Script=Hangul}/u;

/** Thai, which is written in Thai only. */
const THAI = /\p{Script=Thai}/u;

/**
 * What a text's letters of one script say it is written in: `name`, for a
 * sentence such as "This query has words in Japanese", and the languages Jamf
 * publishes documentation in that are written in it.
 */
export interface Writing {
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
export function cjkWritingOf(text: string): Writing | undefined {
  if (!CJK_CHARACTER.test(text)) { return undefined; }
  if (HANGUL.test(text)) { return { name: 'Korean', locales: [] }; }
  if (KANA.test(text)) { return { name: 'Japanese', locales: ['ja-JP'] }; }
  return { name: 'Chinese or Japanese', locales: ['zh-TW', 'zh-CN', 'ja-JP'] };
}

/** Thai, the th-TH documentation's. */
const THAI_WRITING: Writing = { name: 'Thai', locales: ['th-TH'] };

/** Each Chinese, Japanese or Korean character, and each Thai one, for `replace`. */
const CJK_CHARACTERS = new RegExp(CJK_CHARACTER.source, 'gu');
const THAI_CHARACTERS = new RegExp(THAI.source, 'gu');

/**
 * Each writing of `text` that not every language's documentation is written
 * in, with the characters written in it: its Chinese, Japanese or Korean (see
 * `cjkWritingOf`), then its Thai.
 *
 * Latin is not one: the documentation in every language has Latin words, such
 * as product names, SSO and MDM. Han, Kana and Thai are the scripts the other
 * languages in SUPPORTED_LOCALES are written in; Hangul is one so that a reply
 * can say Jamf publishes nothing in Korean. Until 2026-09-28 Thai was not one,
 * so a Thai query in a language whose documentation is not in Thai was not
 * told that the th-TH documentation is. Any other script, such as Cyrillic,
 * is the script of no language Jamf publishes in, and is not one either.
 */
function writingsOf(text: string): { writing: Writing; characters: RegExp }[] {
  const cjk = cjkWritingOf(text);
  return [
    ...(cjk !== undefined ? [{ writing: cjk, characters: CJK_CHARACTERS }] : []),
    ...(THAI.test(text) ? [{ writing: THAI_WRITING, characters: THAI_CHARACTERS }] : []),
  ];
}

/**
 * The writing of `text` that the documentation in `language` is not written
 * in, so does not have the words of, or undefined when it has none. The first,
 * of a text in two: 憑證 ใบรับรอง is Thai in zh-TW, and Chinese or Japanese in
 * th-TH.
 */
export function foreignWritingOf(text: string, language: string): Writing | undefined {
  return writingsOf(text).find(({ writing }) => !writing.locales.some(locale => locale === language))?.writing;
}

/**
 * `text`, with each character of a writing the documentation in `language` is
 * not written in read as a space: what of it the documentation can have.
 */
export function blankForeignWriting(text: string, language: string): string {
  return writingsOf(text).reduce(
    (kept, { writing, characters }) =>
      writing.locales.some(locale => locale === language) ? kept : kept.replace(characters, ' '),
    text,
  );
}

/**
 * A run of Chinese, Japanese, Korean or Thai text, with the marks written
 * inside it: the Katakana long vowel mark ー, the middle dot ・, 、 and 。.
 * Those are in the Common script, used by more than one, and belong to the
 * first four by their Script_Extensions. By the Script property alone, ー
 * would cut パスワード ("password") in two. Capturing, so that a split keeps
 * the runs.
 */
const RUN = new RegExp(
  String.raw`([\p{Script_Extensions=Han}\p{Script_Extensions=Hiragana}` +
    String.raw`\p{Script_Extensions=Katakana}\p{Script_Extensions=Hangul}\p{Script_Extensions=Thai}]+)`,
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
 * Word boundaries by the Unicode rules, which find Chinese, Japanese and Thai
 * words with a dictionary: 推送證書續約失敗 is 推送 | 證書 | 續約 | 失敗
 * ("push", "certificate", "renewal", "failure"). The locale does not change
 * them for these scripts: und, zh-TW, zh-CN, ja-JP, ko-KR and en-US cut all
 * 214 live Chinese and Japanese titles the same way (Node 26, 2026-09-28).
 * Fluid Topics cuts them as these rules do: live that day, 推送證書續約失敗
 * and 推送 證書 續約 失敗 had the same 992 results in zh-TW, and the words it
 * did not find of ใบรับรอง ("certificate") and ล้มเหลว ("failed") in th-TH
 * were ใบรับ and เหลว, as cut here.
 *
 * Made on first use, not when this module is imported: the schemas, the
 * search suggestions and the glossary all import it, so a runtime without
 * `Intl.Segmenter` would otherwise fail to start the server at all. Null on
 * such a runtime, where `splitWords` cuts a run at its punctuation only.
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

/** The words of one Chinese, Japanese, Korean or Thai run, without its punctuation. */
function wordsOfRun(run: string): string[] {
  const words = segmenter();
  if (words === null) {
    // No dictionary to cut by: each stretch between punctuation marks is a
    // word, as each stretch between spaces is in Latin text. ー is a letter
    // (Lm), so it stays inside パスワード, and Thai vowel signs and tone marks
    // are marks, so they stay inside their word.
    return run.split(/[^\p{L}\p{M}\p{N}]+/u).filter(word => word !== '');
  }
  return [...words.segment(run)].filter(s => s.isWordLike === true).map(s => s.segment);
}

/**
 * The words of `text`: those of each Chinese, Japanese, Korean or Thai run,
 * and whatever `splitOther` makes of the text between the runs, in order.
 *
 * Text with no Chinese, Japanese, Korean or Thai character in it goes to
 * `splitOther` whole, so for it this is `splitOther` and nothing else. That
 * includes text whose only such marks are ー, ・, 、 or 。, which are in the
 * Common script: a run of them alone is not cut here. A run's punctuation is
 * not a word, and is dropped. Until 2026-09-28 this was `splitCjkWords`,
 * which cut no Thai run: Thai went to `splitOther` with the rest.
 */
export function splitWords(text: string, splitOther: (part: string) => string[]): string[] {
  if (!CJK_CHARACTER.test(text) && !THAI.test(text)) { return splitOther(text); }
  // A capturing split alternates the text between runs with the runs, so the
  // runs are at the odd indexes.
  return text.split(RUN).flatMap((part, i) => i % 2 === 0 ? splitOther(part) : wordsOfRun(part));
}
