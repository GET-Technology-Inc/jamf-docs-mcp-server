/**
 * Search suggestions service
 *
 * Generates helpful suggestions when a search returns no results.
 */

import { DEFAULT_LOCALE, JAMF_TOPICS, type TopicId } from '../constants.js';
import { CJK_CHARACTER, documentationCanHaveCjkOf, splitCjkWords } from '../utils/cjk.js';

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
 * The words of a query, lowercased, with empty strings where it had runs of
 * spaces or punctuation.
 *
 * Latin text is split as it always was: each character that is not `\w`,
 * whitespace or a hyphen is read as a space. A Chinese, Japanese or Korean run
 * is cut into its words instead (see `splitCjkWords`). Until 2026-09-28 it
 * went the Latin way, and since none of its characters is `\w` it was all
 * read as spaces. So a Chinese or Japanese query had no keywords, and its
 * no-results reply suggested nothing to run: live that day, the quoted
 * `"推送 證書 續約 失敗"` ("push certificate renewal failure") in zh-TW, while
 * `"renew push certificate failed"` gets `renew push certificate`. A query
 * with none of those characters goes the Latin way whole, so it has the words
 * it had.
 */
function wordsOf(query: string): string[] {
  return splitCjkWords(
    query.toLowerCase(),
    part => part.replace(/[^\w\s-]/g, ' ').split(/\s+/),
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
 * Extract meaningful keywords from a query
 *
 * One character is never one, in any script: a Latin letter is not a word,
 * and the one-character words of Chinese and Japanese include particles, such
 * as の and を, which the English stop words do not cover. Nor is a longer
 * Japanese word in Hiragana alone (see `HIRAGANA_ONLY`). Kept, such words
 * take the place of ones that carry meaning: the simpler query for
 * アカウントチームからのサポートを受ける ("get support from the account team")
 * would be `アカウント チーム から`, "account team from".
 */
function extractKeywords(query: string): string[] {
  return wordsOf(query)
    .filter(word => word.length > 1 && !STOP_WORDS.has(word) && !HIRAGANA_ONLY.test(word));
}

/**
 * Normalise a query for comparison against generated suggestions.
 *
 * Applies the same lowercasing / punctuation stripping / whitespace collapsing
 * as extractKeywords, but keeps stop words so the result is comparable to the
 * literal query the caller ran.
 */
function normalizeQuery(query: string): string {
  return wordsOf(query)
    .filter(word => word.length > 0)
    .join(' ');
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

  // If query is already simple (2 words or less), no simplification needed
  if (keywords.length <= 2) {
    return null;
  }

  // Keep the most important 2-3 keywords
  const simplified = keywords.slice(0, 3).join(' ');

  // Suggesting the query that just returned nothing is not advice. A 3-keyword
  // query with no stop words "simplifies" to itself, so compare before emitting.
  if (simplified === normalizeQuery(query)) {
    return null;
  }

  return simplified;
}

/**
 * Find alternative keywords based on synonyms
 */
function findAlternativeKeywords(query: string): string[] {
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

  return Array.from(alternatives).slice(0, 5);
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

/**
 * Generate tips based on query characteristics
 */
function generateTips(query: string, hasFilters: boolean): string[] {
  const tips: string[] = [];
  const keywords = extractKeywords(query);

  if (keywords.length > 4) {
    tips.push('Try using fewer, more specific keywords');
  }

  if (hasFilters) {
    tips.push('Try removing filters to broaden your search');
  }

  if (query.includes('"')) {
    tips.push('Try removing quotes for a broader search');
  }

  tips.push('Browse the table of contents with `jamf_docs_get_toc`');

  return tips;
}

/** Each Chinese, Japanese or Korean character, for `replace`. */
const CJK_CHARACTERS = new RegExp(CJK_CHARACTER.source, 'gu');

/**
 * Generate search suggestions for a query that returned no results, searched
 * in `language`.
 *
 * A suggestion is made of the query's words, and only a word the
 * documentation in `language` can have is one to search it for. So a query's
 * Chinese, Japanese and Korean words are its words only in a language whose
 * documentation is written as they are (see `cjkWritingOf`). Elsewhere those
 * characters are read as spaces, as they were until 2026-09-28, and the
 * query's Latin words are what it is suggested: in en-US, the default, whose
 * documentation is in English, `"Jamf Pro 版本資訊 失敗 11.32.0"` gets
 * `pro 11 32`, not `pro 版本 資訊`. Live that day, 推送 證書 續約 ("push
 * certificate renewal") had 50 results in zh-TW and none in en-US. The reply
 * says where such words can be found instead (`noResultsLocaleNote` in
 * search.ts).
 */
export function generateSearchSuggestions(
  query: string,
  hasProductFilter = false,
  hasTopicFilter = false,
  language: string = DEFAULT_LOCALE
): SearchSuggestions {
  const hasFilters = hasProductFilter || hasTopicFilter;
  const searchable = documentationCanHaveCjkOf(query, language) ? query : query.replace(CJK_CHARACTERS, ' ');

  return {
    simplifiedQuery: simplifyQuery(searchable),
    alternativeKeywords: findAlternativeKeywords(searchable),
    suggestedTopics: findRelevantTopics(searchable),
    tips: generateTips(searchable, hasFilters)
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
