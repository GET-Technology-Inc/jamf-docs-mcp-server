/**
 * Search suggestions service
 *
 * Generates helpful suggestions when a search returns no results.
 */

import { DEFAULT_LOCALE, type TopicId } from '../constants.js';
import type { SearchRanker } from '../types.js';
import { blankForeignWriting, foldFullWidthLatin, splitWords } from '../utils/cjk.js';

/**
 * Search suggestion result
 */
export interface SearchSuggestions {
  simplifiedQuery: string | null;
  alternativeKeywords: string[];
  /**
   * @deprecated Empty since 2026-09-28, and not rendered by
   * `formatSearchSuggestions`. It listed topics to filter by, and a topic
   * filter narrows what the search found: after a search that found nothing,
   * it finds nothing either (see `generateSearchSuggestions`).
   */
  suggestedTopics: { id: TopicId; name: string }[];
  tips: string[];
}

/**
 * What else is known of the search that found nothing.
 */
export interface SearchSuggestionOptions {
  /**
   * The backend that ran it, whose way of matching says which queries can
   * find something. Unset, it is not known, and every suggestion that depends
   * on it is made, as until 2026-09-28. `fluid-topics` is Fluid Topics
   * searching the query as `searchDocumentation` sends it (see
   * `queryForFluidTopics`).
   */
  searchedBy?: SearchRanker | undefined;
  /**
   * Whether it was filtered by a version other than "current": removing that
   * filter can find what the version does not have. Live on 2026-09-28,
   * `policy` had no results with version 11.5.0, at which Jamf publishes
   * nothing, and was not told to remove it.
   */
  hasVersionFilter?: boolean;
  /**
   * Whether Fluid Topics, having found nothing for a phrase the query quotes
   * in 「」, 『』, ｢｣ or « », also searched it with those quotes sent as typed
   * (see `looseQueryForFluidTopics`), and found nothing either. Its words are
   * then those of that search, which no longer made a phrase of them: fewer
   * of them, or the words without the quotes, find nothing either.
   */
  searchedLoosely?: boolean;
  /**
   * Whether it was filtered by a document type. When Fluid Topics finds
   * nothing of one, it is searched again without it (`resolveSearchResults`
   * in search-service.ts): a search it ran that found nothing found nothing
   * without the document type either, and is not told to remove it. A
   * SearchProvider is handed the document type, and may filter by it itself,
   * so a search it answered is told to remove its filters. Until 2026-09-28
   * no search was told so for a document type alone.
   */
  hasDocTypeFilter?: boolean;
}

/**
 * Common word mappings for synonyms
 */
const KEYWORD_SYNONYMS: Record<string, string[]> = {
  'sso': ['single sign-on', 'authentication', 'identity', 'login'],
  'login': ['sign-in', 'authentication', 'sso', 'connect'],
  'mdm': ['mobile device management', 'device management', 'enrollment'],
  'deploy': ['deployment', 'install', 'distribute', 'push'],
  'config': ['configuration', 'settings', 'setup', 'configure'],
  'policy': ['policies', 'rule', 'rules', 'enforcement'],
  'profile': ['profiles', 'configuration profile', 'payload'],
  'app': ['application', 'apps', 'software'],
  'update': ['upgrade', 'patch', 'software update'],
  'security': ['protection', 'secure', 'compliance'],
  'user': ['users', 'account', 'accounts', 'identity'],
  'group': ['groups', 'smart group', 'static group'],
  'script': ['scripts', 'bash', 'shell', 'automation'],
  'api': ['rest api', 'classic api', 'jamf pro api'],
  'certificate': ['certificates', 'cert', 'ssl', 'tls'],
  'network': ['wifi', 'vpn', 'networking', 'proxy'],
  'filevault': ['encryption', 'disk encryption', 'recovery key'],
  'inventory': ['hardware', 'software', 'collection', 'attributes'],
  'remote': ['remote management', 'vnc', 'screen sharing'],
  'protect': ['protection', 'threat', 'malware', 'security']
};

/**
 * Stop words to filter out from queries
 */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'to', 'of',
  'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through',
  'during', 'before', 'after', 'above', 'below', 'between', 'under',
  'and', 'or', 'but', 'if', 'then', 'else', 'when', 'up', 'down', 'out',
  'how', 'what', 'where', 'why', 'who', 'which', 'this', 'that', 'these',
  'those', 'it', 'its', 'my', 'your', 'our', 'their', 'i', 'you', 'we',
  'they', 'me', 'him', 'her', 'us', 'them', 'jamf'
]);

/**
 * What a query's Latin text is split at: each character that is not a Latin
 * letter, a combining mark after one, a digit, `_`, whitespace or a hyphen.
 *
 * On ASCII this is `[^\w\s-]`, which until 2026-09-28 it was on every
 * character, so é, ñ and ü were read as spaces and cut their words in two.
 * Live that day, `"configurar política de seguridad avanzada"` had no results
 * in es-ES and was suggested `configurar pol tica`. A combining mark after a
 * Latin letter, or after another such mark, is an accent typed after its
 * letter, and is kept. Any other mark is a space, as a character outside a
 * Latin word is: an Arabic vowel mark, or the keycap U+20E3 drawn around #.
 * So is a zero-width joiner. A letter of another script is still read as a
 * space: Chinese, Japanese, Korean and Thai runs are cut into their words
 * before this (see `splitWords`), and Jamf publishes in no language written
 * in any other, such as Cyrillic.
 */
const NOT_IN_A_LATIN_WORD = /(?<!\p{Script=Latin}\p{M}*)\p{M}|[^\p{Script=Latin}\p{M}0-9_\s-]/gu;

/**
 * A variation selector, which picks how the character before it is drawn:
 * U+FE0F makes ⚠ an emoji. It is no part of a word, and is dropped rather
 * than read as a space, so that an accent after it stays with its letter
 * (see `foldLatin`).
 */
const VARIATION_SELECTOR = /\p{Variation_Selector}/gu;

/**
 * The words of a query, lowercased, with empty strings where it had runs of
 * spaces or punctuation.
 *
 * A Chinese, Japanese, Korean or Thai run is cut into its words (see
 * `splitWords`), and the text between runs is split at `NOT_IN_A_LATIN_WORD`.
 * Until 2026-09-28 such a run went the Latin way, and since none of its
 * characters was `\w` it was all read as spaces. So a Chinese, Japanese or
 * Thai query had no keywords, and its no-results reply suggested nothing to
 * run: live that day, the quoted `"推送 證書 續約 失敗"` ("push certificate
 * renewal failure") in zh-TW, while `"renew push certificate failed"` gets
 * `renew push certificate`. A query of ASCII alone goes the Latin way whole,
 * so it has the words it had.
 */
function wordsOf(query: string): string[] {
  return splitWords(
    query.toLowerCase(),
    part => part.replace(VARIATION_SELECTOR, '').replace(NOT_IN_A_LATIN_WORD, ' ').split(/\s+/),
  );
}

/**
 * A word written in Hiragana alone. In Japanese that is a particle, an
 * auxiliary or an inflection, and the meaning is in the Kanji and Katakana
 * around it: of the 16 such words of two characters or more in the 107 live
 * Japanese titles (2026-09-28), all but ようこそ ("welcome") were, such as
 * する "do", ない "not" and から "from". It is to a Japanese query what a stop
 * word is to an English one, read from the script rather than listed.
 */
const HIRAGANA_ONLY = /^\p{Script=Hiragana}+$/u;

/**
 * The keywords among `words`.
 *
 * One character is never one, in any script: a Latin letter is not a word,
 * and the one-character words of Chinese and Japanese include particles, such
 * as の and を, which the English stop words do not cover. Nor is a longer
 * Japanese word in Hiragana alone (see `HIRAGANA_ONLY`). Kept, such words
 * take the place of ones that carry meaning: the simpler query for
 * アカウントチームからのサポートを受ける ("get support from the account team")
 * would be `アカウント チーム から`, "account team from".
 */
function keywordsIn(words: string[]): string[] {
  return words.filter(word => word.length > 1 && !STOP_WORDS.has(word) && !HIRAGANA_ONLY.test(word));
}

/** A Latin letter with the combining marks typed after it. */
const LATIN_WITH_MARKS = /\p{Script=Latin}\p{M}+/gu;
const NOT_ASCII = /[^\p{ASCII}]/gu;
const LETTER_OR_NUMBER = /^[\p{L}\p{N}]$/u;
const LATIN_OR_DIGITS = /^[\p{Script=Latin}0-9]+$/u;

/**
 * `text` with each letter or number that NFKC makes Latin letters or digits
 * written as those, and each accent typed as a combining mark joined to its
 * letter: ＳＳＯ is SSO, ５ is 5, ﬁ is fi, and se\u0301curite\u0301 is
 * sécurité.
 *
 * Not NFKC whole, which takes more apart than it joins: it cuts the Thai
 * vowel ำ in two, so สำหรับ ("for") is read as สําห and รับ, and makes
 * Jamf－－, with two full-width hyphens, the word `jamf--`. Nor a symbol NFKC
 * spells in Latin letters, such as ™, №, ㎆ or Ⓜ, which is no part of the word
 * it is written after: `Jamf Pro™` would be the word `protm`, which live on
 * 2026-09-28 had no results, while `Jamf Pro™` had the 22,191 of `pro`. Text
 * of ASCII alone is as it was.
 */
function foldLatin(text: string): string {
  return text
    .replace(VARIATION_SELECTOR, '')
    .replace(LATIN_WITH_MARKS, letter => letter.normalize('NFC'))
    .replace(NOT_ASCII, character => {
      const folded = character.normalize('NFKC');
      return LETTER_OR_NUMBER.test(character) && LATIN_OR_DIGITS.test(folded) ? folded : character;
    });
}

/**
 * Extract meaningful keywords from a query
 *
 * With its full-width Latin letters and digits read as the ones they are (see
 * `foldLatin`). Until 2026-09-28 they were read as spaces, so a query written
 * in them had no keywords. In most languages Fluid Topics does not read them
 * so, and the search sends them to it in ASCII (see `queryForFluidTopics`):
 * live that day, ＳＳＯ had no results in en-US, and SSO 1,228.
 */
function extractKeywords(query: string): string[] {
  return keywordsIn(wordsOf(foldLatin(query)));
}

/**
 * Normalise a query for comparison against generated suggestions.
 *
 * Applies the same lowercasing / punctuation stripping / whitespace collapsing
 * as extractKeywords, but keeps stop words so the result is comparable to the
 * literal query the caller ran. Not folded (see `foldLatin`): a backend
 * handed the query as typed, a SearchProvider, ran `ＳＳＯ`, and `sso` is not
 * that query. Fluid Topics is sent `ＳＳＯ` as SSO (see `queryForFluidTopics`),
 * and `findsMore` in `generateSearchSuggestions` is what keeps `sso` from
 * being suggested for it.
 */
function normalizeQuery(query: string): string {
  return wordsOf(query)
    .filter(word => word.length > 0)
    .join(' ');
}

/**
 * Whether two runs of words are the same text. Compared in NFC, as a letter
 * and its accent typed apart are the letter with its accent (see
 * `foldLatin`): `sécurité` is the query se\u0301curite\u0301 that found
 * nothing, not another one to try.
 */
function sameWords(left: string, right: string): boolean {
  return left.normalize('NFC') === right.normalize('NFC');
}

/**
 * True when `phrase` already appears as a whole-word phrase inside `normalized`.
 *
 * Padding both sides keeps `group` from matching inside `groups`.
 */
function queryContainsPhrase(normalized: string, phrase: string): boolean {
  return ` ${normalized} `.includes(` ${phrase} `);
}

/**
 * Simplify a query by removing stop words and keeping key terms
 *
 * `quoted` is whether the query as it was searched has a phrase in it (see
 * `PHRASE`). Its words without the quotes are then another query, which a
 * page need not have as a phrase, and are suggested however few they are.
 * Until 2026-09-28 a quoted query of three keywords or fewer was suggested
 * none of them, since without its quotes it was compared with itself: live
 * that day, `"certificat push expiré"` had no results in fr-FR and was
 * suggested `deploy` alone, while `certificat push expiré` had 2,505, led by
 * "Suppression du certificat push" and "Certificats push".
 */
function simplifyQuery(query: string, quoted: boolean): string | null {
  const keywords = extractKeywords(query);

  if (keywords.length === 0) {
    return null;
  }

  // Keep the most important 2-3 keywords
  const simplified = keywords.slice(0, 3).join(' ');

  if (quoted) {
    return simplified;
  }

  // If query is already simple (2 words or less), no simplification needed,
  // unless folding changed its keywords: `ＳＳＯ` is simple, and `sso` is not
  // the query a backend handed it as typed ran (see `normalizeQuery`).
  if (keywords.length <= 2 && sameWords(keywords.join(' '), keywordsIn(wordsOf(query)).join(' '))) {
    return null;
  }

  // Suggesting the query that just returned nothing is not advice. A 3-keyword
  // query with no stop words "simplifies" to itself, so compare before emitting.
  if (sameWords(simplified, normalizeQuery(query))) {
    return null;
  }

  return simplified;
}

/**
 * Find alternative keywords based on synonyms: the first five that `findsMore`
 * holds for.
 */
function findAlternativeKeywords(query: string, findsMore: (suggestion: string) => boolean): string[] {
  const keywords = extractKeywords(query);
  const alternatives = new Set<string>();

  for (const keyword of keywords) {
    // Check if keyword has synonyms
    const synonyms = KEYWORD_SYNONYMS[keyword];
    if (synonyms !== undefined) {
      for (const syn of synonyms) {
        alternatives.add(syn);
      }
    }

    // Check if keyword is a synonym of another word
    for (const [key, syns] of Object.entries(KEYWORD_SYNONYMS)) {
      if (syns.includes(keyword)) {
        alternatives.add(key);
      }
    }
  }

  // Remove original keywords from alternatives
  for (const keyword of keywords) {
    alternatives.delete(keyword);
  }

  // Multi-word synonyms can reproduce the query itself (query "smart group"
  // reaches KEYWORD_SYNONYMS.group → "smart group"), which the single-keyword
  // deletion above cannot catch. Drop anything already in the query.
  const normalized = normalizeQuery(query);
  for (const alternative of alternatives) {
    if (queryContainsPhrase(normalized, alternative)) {
      alternatives.delete(alternative);
    }
  }

  return Array.from(alternatives).filter(findsMore).slice(0, 5);
}

const REMOVE_FILTERS = 'Try removing filters to broaden your search';

/**
 * Generate tips based on query characteristics
 *
 * `anyWord` is a query that found nothing though a page needed only one of
 * its words (see `MUST_OR_MUST_NOT`): fewer of them cannot find anything, and
 * nor can removing a quote that pairs with none. Other words can, or the same
 * spelled right. Until 2026-09-28 such a query of five keywords or more was
 * told to use fewer. Filtered by product or version (`filteredUpstream`), it
 * is told first to remove the filter, as its words may be spelled right and
 * outside it: live that day, `policy` had no results with version 11.5.0.
 *
 * `hasFilters` is whether the search had a filter whose removal can find
 * something (see `generateSearchSuggestions`), and `quoted` whether it had
 * quotes whose removal can (see `hasQuotesToRemove`). A pair of 「」, 『』, ｢｣
 * or « » that Fluid Topics was sent as typed, around the query's one word or
 * in the search asked again without its phrases (`searchedLoosely`), is no
 * phrase to it. Until 2026-09-29 such a pair was read as one when the query
 * also had a word marked `+` or `-`: offline that day,
 * `「enrollment xyzzyq」 +qwvzx`, which found nothing as a phrase and nothing
 * again without it, was told in one reply that the query searched without
 * those quotes found nothing either, and to try removing them.
 */
function generateTips(
  query: string, hasFilters: boolean, filteredUpstream: boolean, anyWord: boolean, quoted: boolean,
): string[] {
  const tips: string[] = [];
  const keywords = extractKeywords(query);

  if (anyWord) {
    if (filteredUpstream) {
      tips.push(REMOVE_FILTERS);
    }
    tips.push(
      'Check the spelling, or try other terms: the search finds pages with any one word of a query, ' +
      'so none of these words is in the documentation searched',
    );
  } else if (keywords.length > 4) {
    tips.push('Try using fewer, more specific keywords');
  }

  if (hasFilters && !tips.includes(REMOVE_FILTERS)) {
    tips.push(REMOVE_FILTERS);
  }

  if (quoted && !anyWord) {
    tips.push('Try removing quotes for a broader search');
  }

  tips.push('Browse the table of contents with `jamf_docs_get_toc`');

  return tips;
}

const DOUBLE_QUOTES = /[＂“”„‟「」『』｢｣«»]/gu;
const SINGLE_QUOTES = /[‘’＇]/gu;

/**
 * `query` with the full-width quotation mark ＂, the curly double quotes
 * “ ” „ ‟, the corner brackets 「」 and 『』 and the guillemets « » written as
 * a straight double quote, and the curly single quotes ‘ ’ and the full-width
 * ＇ as a straight one: its quotes as a reader reads them. Fluid Topics is
 * sent them so, but for a pair of 「」, 『』, ｢｣ or « » around the query's
 * one word, and in a second search, around any words (see
 * `queryForFluidTopics`).
 *
 * Fluid Topics searches a phrase in straight double quotes as one a page must
 * have. It reads the other quotes as if they were not there, and a query with
 * ＂ in it, paired or not, finds nothing. Live on 2026-09-28, in en-US,
 * `"push certificate"` had 398 results, `“push certificate”` the 462 of
 * `push certificate`, and `＂push certificate＂` and `＂push certificate`
 * none; in ja-JP, `"プッシュ証明書"` had 442 and `＂プッシュ証明書＂` none. So
 * until then a phrase quoted as a keyboard or an input method quotes it was
 * not searched as a phrase, or ＂ made the search find nothing. „ is here with
 * “ because a German phrase opens with „ and closes with “: with “ alone
 * straightened, `„Zertifikat erneuern“ „Push“` in de-DE was the phrase
 * `" „Push"`, 20 results led by a page on remote commands, against 42 for
 * `"Zertifikat erneuern" "Push"`.
 *
 * 「」 are how Japanese and Chinese quote, 『』 how they quote inside a quote
 * or name a title, and « » how French quotes, and German too, either way
 * round. ｢｣ are the half-width 「」. Until 2026-09-28 they were sent as typed,
 * so a phrase in them was searched as loose words (see `QUOTING_MARK` for
 * what that day measured, and what it costs).
 *
 * Single quotes of any of these kinds quote nothing (`'push certificate'`,
 * `‘push certificate’` and `＇push certificate＇` had 462 each). ‘ ’ are read
 * as ' is (`Apple's` and `Apple’s` had 9,811 each, in the same order), so
 * straightening them changes no result: it makes one request, and one cache
 * entry, of the same search. ＇ is ' typed in full width, as ＳＳＯ is SSO,
 * and until 2026-09-28 it was sent as typed: `Apple＇s` had the 9,811 of
 * `Apple's`, in another order. The single guillemets ‹ › quote nothing
 * either, and are sent as typed.
 */
export function straightenQuotes(query: string): string {
  return query.replace(DOUBLE_QUOTES, '"').replace(SINGLE_QUOTES, '\'');
}

/** A double quote, straight or one `straightenQuotes` makes straight. */
const ANY_DOUBLE_QUOTE = /["＂“”„‟「」『』｢｣«»]/gu;

/**
 * The marks Japanese, Chinese, French and German quote with: 「」, 『』, ｢｣
 * and « ». Since 2026-09-28 a pair of them is sent to Fluid Topics as a
 * phrase, in straight double quotes, but in two cases.
 *
 * Jamf's own titles quote a label with them, as
 * `構成プロファイルの「失敗」のステータスに関するトラブルシューティング` and
 * `Correction d’une erreur « Impossible de modifier la clé » dans FileVault`
 * do, and as a phrase a quoted label finds the pages that have it: live that
 * day, `「プッシュ証明書」の更新` had 19,979 results in ja-JP, and 6 of the
 * first 10 had the phrase, against 442 and 10 of 10 for `"プッシュ証明書"の更新`;
 * in fr-FR, `Renouvellement du « certificat push »` had 12,983 and 6 of 10,
 * against 379 and 10 of 10. A quoted word in a query of more is one a page
 * must have: `「FileVault」を有効にする` had 2 of its first 10 with FileVault in
 * the title, and `"FileVault"を有効にする` 8; `「原則」 無法執行` in zh-TW had 2
 * with 原則, and `"原則" 無法執行` 10.
 *
 * - A pair around the query's one word is sent as typed, which Fluid Topics
 *   reads as no quotes. A phrase of one word is that word in the form typed
 *   and no other: live that day, `"Konfigurationsprofil"` had 1,717 results
 *   in de-DE and `Konfigurationsprofil` 7,141, led by "Konfigurationsprofile
 *   für Computer", which the quoted one's first 10 lacked. Of 25 such words
 *   in 9 languages, 14 had fewer results quoted, and lost from 1 to 8 of the
 *   first 10, such as "Certificats" for `certificat` in fr-FR; the other 11
 *   had the same first 10. Of 9 Chinese and Japanese words Unicode's rules
 *   find no other word in (see `splitWords`), such as ポリシー and 原則, each
 *   had the same first 10 either way, 2 with fewer results quoted; and
 *   `「セルフサービス」` had none, where as typed it had 2,981.
 * - When Fluid Topics finds nothing for the query with such a phrase, the
 *   search asks again with every pair sent as typed (see
 *   `looseQueryForFluidTopics`). A term a query quotes may be one the
 *   documentation writes otherwise, and a message it quotes one it does not
 *   have word for word: of 44 queries quoted as a person would quote them,
 *   measured that day, 11 found nothing as phrases, such as
 *   `「プレステージ登録」` in ja-JP and `« certificat push expiré »` in fr-FR,
 *   which had 5,190 and 2,505 results as typed, led by 登録 and by
 *   "Suppression du certificat push". What is left is a phrase that finds
 *   little: 7 of the 44 found under 50 pages where as typed they found
 *   thousands, such as `「ユーザーの追加」` (4, where the documentation writes
 *   ユーザ) and `「インベントリ更新」` (43).
 */
const QUOTING_MARK = /[「」『』｢｣«»]/u;

/** The places in a query of the two quotes of a pair. */
interface QuotePair { open: number; close: number }

/**
 * The pairs of 「」, 『』, ｢｣ and « » in `query`: the double quotes that
 * Fluid Topics, sent them straightened, pairs, as it pairs straight ones: the
 * first with the second, the third with the fourth. A pair of which either
 * quote is another kind is not one, nor is a quote left over.
 */
function quotingPairs(query: string): QuotePair[] {
  const at = Array.from(query.matchAll(ANY_DOUBLE_QUOTE), match => match.index);
  const pairs: QuotePair[] = [];
  for (let i = 0; i + 1 < at.length; i += 2) {
    const [open, close] = [at[i], at[i + 1]];
    if (open !== undefined && close !== undefined &&
      QUOTING_MARK.test(query.charAt(open)) && QUOTING_MARK.test(query.charAt(close))) {
      pairs.push({ open, close });
    }
  }
  return pairs;
}

/** Whether `pair` is around the one word of `query`, as Fluid Topics reads words (see `wordsSearchedFor`). */
function aroundTheOneWord(query: string, pair: QuotePair): boolean {
  return wordsSearchedFor(query).size === 1 && wordsSearchedFor(query.slice(pair.open + 1, pair.close)).size === 1;
}

/** The narrow no-break space, which French writes inside « » and before ? ! ; and :. */
const NARROW_NO_BREAK_SPACE = /\u202F/gu;

/**
 * `query` as it is sent to Fluid Topics, with the quotes of `asTyped` as
 * typed: its other quotes straightened (see `straightenQuotes`), its
 * full-width Latin letters and digits written in ASCII (see
 * `foldFullWidthLatin`), and a narrow no-break space written as a space.
 */
function sendWith(query: string, asTyped: readonly QuotePair[]): string {
  const kept = new Set(asTyped.flatMap(pair => [pair.open, pair.close]));
  return foldFullWidthLatin(
    query
      .replace(DOUBLE_QUOTES, (mark: string, at: number) => kept.has(at) ? mark : '"')
      .replace(SINGLE_QUOTES, '\''),
  ).replace(NARROW_NO_BREAK_SPACE, ' ');
}

/**
 * `query` as it is sent to Fluid Topics: with its quotes straightened (see
 * `straightenQuotes`), but for a pair of 「」, 『』, ｢｣ or « » around its one
 * word (see `QUOTING_MARK`), its full-width Latin letters and digits written
 * in ASCII, and a narrow no-break space written as a space.
 *
 * Fluid Topics reads full-width letters as ASCII ones in ja-JP, zh-TW and
 * zh-CN only, and full-width digits in ja-JP only. Live on 2026-09-28: ＳＳＯ
 * had no results in en-US, and SSO 1,228; ＳＳＯ, ＦｉｌｅＶａｕｌｔ and
 * １１．３２ had none in en-US, de-DE, es-ES, fr-FR and nl-NL, and Ｊａｍｆ,
 * ｉＯＳ and Ａｐｐｌｅ none in th-TH, it-IT and pt-BR, each of which had
 * results in ASCII; １５ had none in zh-TW, and 15 had 1,599. An input method
 * in full-width mode types them, so until then such a query found nothing,
 * or not what it asked for. They are written in ASCII in every language: 12
 * queries in ja-JP, and 9 of letters alone in zh-TW and zh-CN, had the same
 * count and the same first ten results either way, so a list of the languages
 * whose analysis already reads them would change no result, and would go
 * wrong the day Fluid Topics changes one. Full-width punctuation is sent as
 * typed: Fluid Topics reads it as a space, and in ASCII it can be an
 * operator (`certificate －push` had the 3,010 results of `certificate push`,
 * where `certificate -push` leaves out every page with push, 2,188). So is
 * the ideographic space, which Fluid Topics reads as a space.
 *
 * A narrow no-break space, U+202F, joins the words either side of it in a
 * phrase: live that day, in fr-FR, `"certificat push"` had 379 results, and
 * none with U+202F for the space between its words, or inside its quotes.
 * Out of a phrase it is a space (`certificat push` with U+202F had the 2,284
 * of `certificat push`), and in one the no-break space U+00A0 is too. French
 * writes one of the two inside « », so without this a phrase quoted as French
 * quotes it could find nothing.
 *
 * A SearchProvider is handed the query as typed.
 */
export function queryForFluidTopics(query: string): string {
  return sendWith(query, quotingPairs(query).filter(pair => aroundTheOneWord(query, pair)));
}

/**
 * The second search `searchDocumentation` asks Fluid Topics for when it
 * found nothing for `queryForFluidTopics(query)`: `query` with every pair of
 * 「」, 『』, ｢｣ and « » sent as typed, which Fluid Topics reads as no quotes,
 * and `phrases`, what those pairs made phrases of in the first, as typed,
 * with their quotes. Undefined when the first had no such phrase.
 *
 * Its words then match as they did until 2026-09-28, when every such pair was
 * sent as typed: a page need have only one of them, if the query has no other
 * phrase and no word marked `+` or `-` (see `MUST_OR_MUST_NOT`). See
 * `QUOTING_MARK` for why.
 */
export function looseQueryForFluidTopics(query: string): { query: string; phrases: string[] } | undefined {
  const pairs = quotingPairs(query);
  const phrases = pairs.filter(pair => !aroundTheOneWord(query, pair));
  if (phrases.length === 0) { return undefined; }
  return {
    query: sendWith(query, pairs),
    phrases: phrases.map(pair => query.slice(pair.open, pair.close + 1)),
  };
}

/**
 * A part of a query that a page must match, or must not, in Fluid Topics: a
 * phrase in straight double quotes, or a word with `+` or `-` before it. It
 * is looked for in the query as sent (see `queryForFluidTopics`).
 *
 * Without one, Fluid Topics finds a page with any one word of a query. Live on
 * 2026-09-28, in en-US: `certificate` had 2,768 results, and so did
 * `certificate xyzzyq qwvzx plokm zzqqa jjjkk`; `certificate renewal` had
 * 3,007, more than either word alone. With one, a page must have the phrase
 * (`"push certificate renewal failed"` had no results, nor did it with
 * `certificate` after it), must have the word (`certificate +xyzzyq` had
 * none), or must not (`certificate -certificate` had none). A quote that
 * pairs with none is read as no quote (`"push certificate` had the 462 of
 * `push certificate`), and so is a hyphen inside a word, or one on its own
 * (`wi-fi` and `wi fi` had 501 each, and `certificate - push` the 3,010 of
 * `certificate push`).
 */
const MUST_OR_MUST_NOT = /"[^"]*"|(?:^|\s)[+-](?=\S)/u;

/** A phrase in straight double quotes (see `MUST_OR_MUST_NOT`). */
const PHRASE = /"[^"]*"/u;

/**
 * Whether `query`, sent to Fluid Topics as `sent`, has quotes that removing
 * can find more for (see `generateTips`): when Fluid Topics searched, a
 * phrase in `sent`, and for any other backend, or none named, a double quote
 * as a reader reads one (see `straightenQuotes`).
 */
function hasQuotesToRemove(query: string, sent: string, searchedBy: SearchRanker | undefined): boolean {
  return searchedBy === 'fluid-topics' ? PHRASE.test(sent) : straightenQuotes(query).includes('"');
}

/**
 * The words of `text` as Fluid Topics reads them: its runs of letters, marks
 * and digits, in NFC and lowercased, with a Chinese, Japanese, Korean or Thai
 * run cut into its words (see `splitWords`). Fluid Topics splits at every
 * other character. Live on 2026-09-28, in en-US, `11.32.0` had the 21,744
 * results of `11 32 0`, and `com.xyzzyq` and `xyzzyq_pro` the results of `com`
 * and of `pro`, with xyzzyq among the words they did not find. And it reads a
 * letter and its accent typed apart as the letter with its accent: política
 * had 2,409 in es-ES either way.
 */
function wordsSearchedFor(text: string): Set<string> {
  return new Set(
    splitWords(text.normalize('NFC').toLowerCase(), part => part.split(/[^\p{L}\p{M}\p{N}]+/u))
      .filter(word => word !== ''),
  );
}

/**
 * Generate search suggestions for a query that returned no results, searched
 * in `language` by `options.searchedBy`.
 *
 * A suggestion is made of the query's words, and only a word the
 * documentation in `language` can have is one to search it for. So a query's
 * Chinese, Japanese, Korean and Thai words are its words only in a language
 * whose documentation is written as they are (see `foreignWritingOf`).
 * Elsewhere those characters are read as spaces, as they were until
 * 2026-09-28, and the query's Latin words are what it is suggested: in
 * en-US, the default, whose documentation is in English,
 * `"Jamf Pro 版本資訊 失敗 11.32.0"` gets `pro 11 32`, not `pro 版本 資訊`.
 * Live that day, 推送 證書 續約 ("push certificate renewal") had 50 results
 * in zh-TW and none in en-US. The reply says where such words can be found
 * instead (`noResultsLocaleNote` in search.ts).
 *
 * And only a query that can find something is suggested. When Fluid Topics
 * searched, and the query as sent has no part a page must match or must not
 * (see `MUST_OR_MUST_NOT`), it found nothing because the documentation
 * searched has none of its words. So a suggestion made only of those words,
 * as it read them (see `wordsSearchedFor`), finds nothing either, and is not
 * made: fewer of its words, or a synonym whose words are all in it. Until
 * 2026-09-28 it was: live that day, `Zertifikat erneuern fehlgeschlagen
 * Anmeldung` had no results in en-US, and was suggested `zertifikat erneuern
 * fehlgeschlagen`, which had none either. The tips say so instead (see
 * `generateTips`). Its words are those of the query as sent, whose
 * full-width letters are in ASCII (see `queryForFluidTopics`), so `sso` is
 * not suggested for `ＳＳＯ`: until 2026-09-28 it was, in every language,
 * though in ja-JP Fluid Topics read the two as one. Any other backend, or
 * none named, may not match a page on any one word, and is handed the query
 * as typed: its query is suggested fewer of its words, as every query was,
 * and `sso` for `ＳＳＯ`.
 *
 * A query with a phrase in it is suggested its words without the quotes,
 * however few (see `simplifyQuery`). When its phrase was in 「」, 『』, ｢｣ or
 * « », Fluid Topics searched them so already (`searchedLoosely`), and its
 * words are those of that search.
 *
 * No topic is suggested, and a search Fluid Topics ran is not told to remove
 * its topic. A topic is not sent to Fluid Topics: it filters what the search
 * found, and is set aside when it would leave nothing
 * (`applyFiltersWithFallback` in search-service.ts). So a search that found
 * nothing found nothing without its topic, and filtering it by one cannot
 * find more. Until 2026-09-28 it was told to filter by the topics its words
 * suggested, and, when a topic was its only filter, to remove its filters.
 * Live that day, `ssoxyzzyq` had no results and was told to try
 * `topic="sso"`. With `topic: "sso"` it still had none, and was told to
 * filter by `topic="sso"` again and to remove filters, which gave back the
 * first search. A SearchProvider is handed the topic with the rest of the
 * search, and may filter by it itself, so a search it answered is still told
 * to remove it, as it is a document type (see `hasDocTypeFilter`).
 */
export function generateSearchSuggestions(
  query: string,
  hasProductFilter = false,
  hasTopicFilter = false,
  language: string = DEFAULT_LOCALE,
  { searchedBy, hasVersionFilter = false, searchedLoosely = false, hasDocTypeFilter = false }: SearchSuggestionOptions = {},
): SearchSuggestions {
  const hasFilters = hasProductFilter || hasVersionFilter
    || ((hasTopicFilter || hasDocTypeFilter) && searchedBy !== 'fluid-topics');
  const searchable = blankForeignWriting(query, language);
  const sent = (searchedLoosely ? looseQueryForFluidTopics(query)?.query : undefined) ?? queryForFluidTopics(query);
  const anyWord = searchedBy === 'fluid-topics' && !MUST_OR_MUST_NOT.test(sent);
  const searched = anyWord ? wordsSearchedFor(sent) : undefined;
  const findsMore = (suggestion: string): boolean =>
    searched === undefined || [...wordsSearchedFor(suggestion)].some(word => !searched.has(word));
  const simplified = simplifyQuery(searchable, PHRASE.test(sent));
  const quoted = hasQuotesToRemove(searchable, sent, searchedBy);

  return {
    simplifiedQuery: simplified !== null && findsMore(simplified) ? simplified : null,
    alternativeKeywords: findAlternativeKeywords(searchable, findsMore),
    suggestedTopics: [],
    tips: generateTips(searchable, hasFilters, hasProductFilter || hasVersionFilter, anyWord, quoted)
  };
}

/**
 * Format search suggestions as markdown
 */
export function formatSearchSuggestions(query: string, suggestions: SearchSuggestions): string {
  let output = `No results found for "${query}"\n\n`;
  output += '## Search Suggestions\n\n';

  if (suggestions.simplifiedQuery !== null) {
    output += `**Try simpler query**: \`${suggestions.simplifiedQuery}\`\n\n`;
  }

  if (suggestions.alternativeKeywords.length > 0) {
    output += `**Alternative keywords**: ${suggestions.alternativeKeywords.map(k => `\`${k}\``).join(', ')}\n\n`;
  }

  if (suggestions.tips.length > 0) {
    output += '**Tips**:\n';
    for (const tip of suggestions.tips) {
      output += `- ${tip}\n`;
    }
  }

  return output;
}
