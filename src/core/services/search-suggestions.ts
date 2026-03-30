/**
 * Search suggestions service
 *
 * Generates helpful suggestions when a search returns no results.
 */

import { JAMF_TOPICS, type TopicId } from '../constants.js';

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
 * Extract meaningful keywords from a query
 */
function extractKeywords(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 1 && !STOP_WORDS.has(word));
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
  return keywords.slice(0, 3).join(' ');
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

/**
 * Generate search suggestions for a query that returned no results
 */
export function generateSearchSuggestions(
  query: string,
  hasProductFilter = false,
  hasTopicFilter = false
): SearchSuggestions {
  const hasFilters = hasProductFilter || hasTopicFilter;

  return {
    simplifiedQuery: simplifyQuery(query),
    alternativeKeywords: findAlternativeKeywords(query),
    suggestedTopics: findRelevantTopics(query),
    tips: generateTips(query, hasFilters)
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
