/**
 * Search suggestions service
 *
 * Generates helpful suggestions when a search returns no results.
 */

import { DEFAULT_LOCALE, JAMF_TOPICS, type TopicId } from '../constants.js';
import type { SearchRanker } from '../types.js';
import { blankForeignWriting, splitWords } from '../utils/cjk.js';

/**
 * Search suggestion result
 */
export interface SearchSuggestions {
  simplifiedQuery: string | null;
  alternativeKeywords: string[];
  suggestedTopics: { id: TopicId; name: string }[];
  tips: string[];
}

/**
 * What else is known of the search that found nothing.
 */
export interface SearchSuggestionOptions {
  /**
   * The backend that ran it, whose way of matching says which queries can
   * find something. Unset, it is not known, and every suggestion is made, as
   * every one was until 2026-09-28. `fluid-topics` is Fluid Topics searching
   * the query with its quotes straightened, as `searchDocumentation` sends it
   * (see `straightenQuotes`).
   */
  searchedBy?: SearchRanker | undefined;
  /**
   * Whether it was filtered by a version other than "current": removing that
   * filter can find what the version does not have. Live on 2026-09-28,
   * `policy` had no results with version 11.5.0, at which Jamf publishes
   * nothing, and was not told to remove it.
   */
  hasVersionFilter?: boolean;
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
 * in them had no keywords. The search does not read them so: live that day,
 * ＳＳＯ had no results in en-US, and SSO 1,228.
 */
function extractKeywords(query: string): string[] {
  return keywordsIn(wordsOf(foldLatin(query)));
}

/**
 * Normalise a query for comparison against generated suggestions.
 *
 * Applies the same lowercasing / punctuation stripping / whitespace collapsing
 * as extractKeywords, but keeps stop words so the result is comparable to the
 * literal query the caller ran. Not folded (see `foldLatin`): the query the
 * caller ran is the one typed, and `sso` is not the query `ＳＳＯ` that found
 * nothing.
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
 */
function simplifyQuery(query: string): string | null {
  const keywords = extractKeywords(query);

  if (keywords.length === 0) {
    return null;
  }

  // If query is already simple (2 words or less), no simplification needed,
  // unless folding changed its keywords: `ＳＳＯ` is simple, and `sso` is not it.
  if (keywords.length <= 2 && sameWords(keywords.join(' '), keywordsIn(wordsOf(query)).join(' '))) {
    return null;
  }

  // Keep the most important 2-3 keywords
  const simplified = keywords.slice(0, 3).join(' ');

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

/**
 * Find relevant topics based on query keywords
 */
function findRelevantTopics(query: string): { id: TopicId; name: string }[] {
  const keywords = extractKeywords(query);
  const scoredTopics: { id: TopicId; name: string; score: number }[] = [];

  for (const [topicId, topic] of Object.entries(JAMF_TOPICS)) {
    let score = 0;

    // Check topic name
    const topicNameLower = topic.name.toLowerCase();
    for (const keyword of keywords) {
      if (topicNameLower.includes(keyword)) {
        score += 3;
      }
    }

    // Check topic keywords
    for (const topicKeyword of topic.keywords) {
      const tkLower = topicKeyword.toLowerCase();
      for (const keyword of keywords) {
        if (tkLower.includes(keyword) || keyword.includes(tkLower)) {
          score += 1;
        }
      }
    }

    if (score > 0) {
      scoredTopics.push({
        id: topicId as TopicId,
        name: topic.name,
        score
      });
    }
  }

  // Sort by score and return top 3
  return scoredTopics
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(({ id, name }) => ({ id, name }));
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
 * outside it: live that day, `policy` had no results with version 11.5.0. A
 * topic filter does not come first. It is applied to what Fluid Topics found,
 * and set aside when it removes all of it (`applyFiltersWithFallback` in
 * search-service.ts), so it is not what left nothing.
 *
 * The quotes are the ones Fluid Topics searched (see `straightenQuotes`).
 */
function generateTips(query: string, hasFilters: boolean, filteredUpstream: boolean, anyWord: boolean): string[] {
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

  if (straightenQuotes(query).includes('"') && !anyWord) {
    tips.push('Try removing quotes for a broader search');
  }

  tips.push('Browse the table of contents with `jamf_docs_get_toc`');

  return tips;
}

const CURLY_DOUBLE_QUOTES = /[＂“”„‟]/gu;
const CURLY_SINGLE_QUOTES = /[‘’]/gu;

/**
 * `query` as it is sent to Fluid Topics: with the full-width quotation mark ＂
 * and the curly double quotes “ ” „ ‟ written as a straight double quote,
 * and the curly single quotes ‘ ’ as a straight one.
 *
 * Fluid Topics searches a phrase in straight double quotes as one a page must
 * have. It reads the curly quotes as if they were not there, and a query with
 * ＂ in it, paired or not, finds nothing. Live on 2026-09-28, in en-US,
 * `"push certificate"` had 398 results, `“push certificate”` the 462 of
 * `push certificate`, and `＂push certificate＂` and `＂push certificate`
 * none; in ja-JP, `"プッシュ証明書"` had 442 and `＂プッシュ証明書＂` none. So
 * until then a phrase quoted as a keyboard or an input method quotes it was
 * not searched as a phrase, or ＂ made the search find nothing. „ is here with
 * “ because a German phrase opens with „ and closes with “: with “ alone
 * straightened, `„Zertifikat erneuern“ „Push“` in de-DE was the phrase
 * `" „Push"`, 20 results led by a page on remote commands, against 42 for
 * `"Zertifikat erneuern" "Push"`. Single quotes of either kind quote nothing
 * (`'push certificate'` and `‘push certificate’` had 462 each), and an
 * apostrophe is read the same either way (`Apple's` and `Apple’s` 9,811
 * each), so straightening them changes no result: it makes one request, and
 * one cache entry, of two that are the same search. «», 「」 and ＇, which
 * Fluid Topics also reads as if they were not there, are sent as typed.
 */
export function straightenQuotes(query: string): string {
  return query.replace(CURLY_DOUBLE_QUOTES, '"').replace(CURLY_SINGLE_QUOTES, '\'');
}

/**
 * A part of a query that a page must match, or must not, in Fluid Topics: a
 * phrase in straight double quotes, or a word with `+` or `-` before it. It
 * is looked for in the query as sent (see `straightenQuotes`).
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
 * `generateTips`). A query's full-width letters, folded (see `foldLatin`),
 * are other words to Fluid Topics, so `sso` is suggested for `ＳＳＯ`. Any
 * other backend, or none named, may not match a page on any one word, and
 * its query is suggested fewer of its words, as every query was.
 */
export function generateSearchSuggestions(
  query: string,
  hasProductFilter = false,
  hasTopicFilter = false,
  language: string = DEFAULT_LOCALE,
  { searchedBy, hasVersionFilter = false }: SearchSuggestionOptions = {},
): SearchSuggestions {
  const hasFilters = hasProductFilter || hasTopicFilter || hasVersionFilter;
  const searchable = blankForeignWriting(query, language);
  const anyWord = searchedBy === 'fluid-topics' && !MUST_OR_MUST_NOT.test(straightenQuotes(query));
  const searched = anyWord ? wordsSearchedFor(query) : undefined;
  const findsMore = (suggestion: string): boolean =>
    searched === undefined || [...wordsSearchedFor(suggestion)].some(word => !searched.has(word));
  const simplified = simplifyQuery(searchable);

  return {
    simplifiedQuery: simplified !== null && findsMore(simplified) ? simplified : null,
    alternativeKeywords: findAlternativeKeywords(searchable, findsMore),
    suggestedTopics: findRelevantTopics(searchable),
    tips: generateTips(searchable, hasFilters, hasProductFilter || hasVersionFilter, anyWord)
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

  if (suggestions.suggestedTopics.length > 0) {
    output += '**Try filtering by topic**:\n';
    for (const topic of suggestions.suggestedTopics) {
      output += `- \`topic="${topic.id}"\` - ${topic.name}\n`;
    }
    output += '\n';
  }

  if (suggestions.tips.length > 0) {
    output += '**Tips**:\n';
    for (const tip of suggestions.tips) {
      output += `- ${tip}\n`;
    }
  }

  return output;
}
