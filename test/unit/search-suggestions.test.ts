/**
 * Unit tests for search suggestions service
 */

import { describe, it, expect } from 'vitest';
import {
  generateSearchSuggestions,
  formatSearchSuggestions
} from '../../src/services/search-suggestions.js';

describe('generateSearchSuggestions', () => {
  describe('simplifiedQuery', () => {
    it('should return null for short queries', () => {
      const result = generateSearchSuggestions('sso login');
      expect(result.simplifiedQuery).toBeNull();
    });

    it('should simplify long queries', () => {
      const result = generateSearchSuggestions('how do I configure the sso login settings for users');
      expect(result.simplifiedQuery).not.toBeNull();
      expect(result.simplifiedQuery?.split(' ').length).toBeLessThanOrEqual(3);
    });

    it('should remove stop words', () => {
      const result = generateSearchSuggestions('how to configure the mdm enrollment process');
      expect(result.simplifiedQuery).not.toBeNull();
      expect(result.simplifiedQuery).not.toContain('how');
      expect(result.simplifiedQuery).not.toContain('to');
      expect(result.simplifiedQuery).not.toContain('the');
    });
  });

  describe('alternativeKeywords', () => {
    it('should suggest synonyms for common terms', () => {
      const result = generateSearchSuggestions('sso configuration');
      expect(result.alternativeKeywords.length).toBeGreaterThan(0);
      expect(result.alternativeKeywords).toContain('single sign-on');
    });

    it('should suggest synonyms for login', () => {
      const result = generateSearchSuggestions('login settings');
      expect(result.alternativeKeywords).toContain('authentication');
    });

    it('should suggest synonyms for deploy', () => {
      const result = generateSearchSuggestions('deploy apps');
      expect(result.alternativeKeywords).toContain('deployment');
    });

    it('should return empty array for unknown terms', () => {
      const result = generateSearchSuggestions('xyznonexistent123');
      expect(result.alternativeKeywords).toHaveLength(0);
    });

    it('should limit alternatives to 5', () => {
      const result = generateSearchSuggestions('sso login config deploy policy');
      expect(result.alternativeKeywords.length).toBeLessThanOrEqual(5);
    });
  });

  describe('suggestedTopics', () => {
    it('should suggest SSO topic for sso query', () => {
      const result = generateSearchSuggestions('sso configuration');
      const topicIds = result.suggestedTopics.map(t => t.id);
      expect(topicIds).toContain('sso');
    });

    it('should suggest security topic for encryption query', () => {
      const result = generateSearchSuggestions('disk encryption');
      const topicIds = result.suggestedTopics.map(t => t.id);
      expect(topicIds.some(id => id === 'filevault' || id === 'security')).toBe(true);
    });

    it('should suggest enrollment topic for enrollment query', () => {
      const result = generateSearchSuggestions('device enrollment');
      const topicIds = result.suggestedTopics.map(t => t.id);
      expect(topicIds).toContain('enrollment');
    });

    it('should limit to 3 topics', () => {
      const result = generateSearchSuggestions('security policy configuration');
      expect(result.suggestedTopics.length).toBeLessThanOrEqual(3);
    });

    it('should return empty array for unrelated queries', () => {
      const result = generateSearchSuggestions('xyznonexistent123');
      expect(result.suggestedTopics).toHaveLength(0);
    });
  });

  describe('tips', () => {
    it('should suggest removing filters when filters are applied', () => {
      const result = generateSearchSuggestions('sso', true, false);
      expect(result.tips.some(t => t.includes('removing filters'))).toBe(true);
    });

    it('should suggest fewer keywords for long queries', () => {
      const result = generateSearchSuggestions('how to configure sso login for enterprise users in jamf');
      expect(result.tips.some(t => t.includes('fewer'))).toBe(true);
    });

    it('should always suggest browsing TOC', () => {
      const result = generateSearchSuggestions('anything');
      expect(result.tips.some(t => t.includes('jamf_docs_get_toc'))).toBe(true);
    });
  });
});

describe('formatSearchSuggestions', () => {
  it('should include query in output', () => {
    const suggestions = generateSearchSuggestions('test query');
    const output = formatSearchSuggestions('test query', suggestions);
    expect(output).toContain('test query');
  });

  it('should include no results message', () => {
    const suggestions = generateSearchSuggestions('test');
    const output = formatSearchSuggestions('test', suggestions);
    expect(output).toContain('No results found');
  });

  it('should format simplified query when present', () => {
    const suggestions = generateSearchSuggestions('how to configure sso login settings');
    const output = formatSearchSuggestions('how to configure sso login settings', suggestions);
    expect(output).toContain('Try simpler query');
  });

  it('should format alternative keywords', () => {
    const suggestions = generateSearchSuggestions('sso');
    // 'sso' is a known synonym term, so alternativeKeywords must be non-empty
    expect(suggestions.alternativeKeywords.length).toBeGreaterThan(0);
    const output = formatSearchSuggestions('sso', suggestions);
    expect(output).toContain('Alternative keywords');
  });

  it('should format suggested topics', () => {
    const suggestions = generateSearchSuggestions('enrollment');
    // 'enrollment' is a known topic term, so suggestedTopics must be non-empty
    expect(suggestions.suggestedTopics.length).toBeGreaterThan(0);
    const output = formatSearchSuggestions('enrollment', suggestions);
    expect(output).toContain('Try filtering by topic');
    expect(output).toContain('topic=');
  });

  it('should format tips', () => {
    const suggestions = generateSearchSuggestions('test');
    const output = formatSearchSuggestions('test', suggestions);
    expect(output).toContain('Tips');
  });
});

// ============================================================================
// Additional edge case tests
// ============================================================================

describe('generateSearchSuggestions - single word query', () => {
  it('should not simplify a single-word query', () => {
    const result = generateSearchSuggestions('enrollment');
    // Single word → extractKeywords returns 1 keyword → <= 2 → simplifyQuery returns null
    expect(result.simplifiedQuery).toBeNull();
  });

  it('should not simplify a two-word query', () => {
    const result = generateSearchSuggestions('sso configuration');
    // Two keywords after stop-word removal (both are non-stop words) → <= 2 → null
    expect(result.simplifiedQuery).toBeNull();
  });
});

describe('generateSearchSuggestions - all stop words query', () => {
  it('should produce empty alternativeKeywords when query is all stop words', () => {
    // All words are in STOP_WORDS: 'how', 'to', 'the', 'is', 'a'
    const result = generateSearchSuggestions('how to the is a');
    expect(result.alternativeKeywords).toHaveLength(0);
  });

  it('should produce empty suggestedTopics when query is all stop words', () => {
    const result = generateSearchSuggestions('how to the is a');
    expect(result.suggestedTopics).toHaveLength(0);
  });

  it('should produce null simplifiedQuery when query is all stop words', () => {
    const result = generateSearchSuggestions('how to the is a');
    // extractKeywords returns [] → simplifyQuery returns null
    expect(result.simplifiedQuery).toBeNull();
  });
});

describe('generateSearchSuggestions - synonym matching', () => {
  it('should map "sso" to "single sign-on" as an alternative keyword', () => {
    const result = generateSearchSuggestions('sso');
    expect(result.alternativeKeywords).toContain('single sign-on');
  });

  it('should map "login" to "authentication" as an alternative keyword', () => {
    const result = generateSearchSuggestions('login');
    expect(result.alternativeKeywords).toContain('authentication');
  });

  it('should map "mdm" to "mobile device management" as an alternative keyword', () => {
    const result = generateSearchSuggestions('mdm configuration');
    expect(result.alternativeKeywords).toContain('mobile device management');
  });

  it('should find reverse synonyms — "authentication" should suggest "sso" or "login"', () => {
    const result = generateSearchSuggestions('authentication settings');
    // "authentication" is a synonym of "sso" and "login" → both keys should appear
    const hasReverse = result.alternativeKeywords.includes('sso') ||
      result.alternativeKeywords.includes('login');
    expect(hasReverse).toBe(true);
  });

  it('should not include the original keyword in alternativeKeywords', () => {
    const result = generateSearchSuggestions('sso settings');
    // The keyword "sso" itself should not appear in alternatives
    expect(result.alternativeKeywords).not.toContain('sso');
  });
});

describe('generateSearchSuggestions - tips with active filters', () => {
  it('should include "removing filters" tip when product filter is active', () => {
    const result = generateSearchSuggestions('enrollment', true, false);
    expect(result.tips.some(t => t.includes('removing filters'))).toBe(true);
  });

  it('should include "removing filters" tip when topic filter is active', () => {
    const result = generateSearchSuggestions('enrollment', false, true);
    expect(result.tips.some(t => t.includes('removing filters'))).toBe(true);
  });

  it('should include "removing filters" tip when both filters are active', () => {
    const result = generateSearchSuggestions('enrollment', true, true);
    expect(result.tips.some(t => t.includes('removing filters'))).toBe(true);
  });

  it('should NOT include "removing filters" tip when no filters are active', () => {
    const result = generateSearchSuggestions('enrollment', false, false);
    expect(result.tips.some(t => t.includes('removing filters'))).toBe(false);
  });
});

describe('formatSearchSuggestions - filters active output', () => {
  it('should include removing filters suggestion in formatted output when filters are active', () => {
    const suggestions = generateSearchSuggestions('sso', true, false);
    const output = formatSearchSuggestions('sso', suggestions);
    expect(output).toContain('removing filters');
  });

  it('should always include TOC browsing tip in formatted output', () => {
    const suggestions = generateSearchSuggestions('anything', false, false);
    const output = formatSearchSuggestions('anything', suggestions);
    expect(output).toContain('jamf_docs_get_toc');
  });
});

describe('generateSearchSuggestions - query with quotes', () => {
  it('should include tip to remove quotes when query contains double quotes', () => {
    const result = generateSearchSuggestions('"exact phrase search"');
    expect(result.tips.some(t => t.includes('removing quotes'))).toBe(true);
  });

  it('should NOT include remove-quotes tip when query has no quotes', () => {
    const result = generateSearchSuggestions('enrollment configuration');
    expect(result.tips.some(t => t.includes('removing quotes'))).toBe(false);
  });

  it('should include remove-quotes tip in formatted output when query has quotes', () => {
    const suggestions = generateSearchSuggestions('"jamf pro enrollment"');
    const output = formatSearchSuggestions('"jamf pro enrollment"', suggestions);
    expect(output).toContain('removing quotes');
  });
});
