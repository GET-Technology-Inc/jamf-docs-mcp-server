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
    const output = formatSearchSuggestions('sso', suggestions);
    if (suggestions.alternativeKeywords.length > 0) {
      expect(output).toContain('Alternative keywords');
    }
  });

  it('should format suggested topics', () => {
    const suggestions = generateSearchSuggestions('enrollment');
    const output = formatSearchSuggestions('enrollment', suggestions);
    if (suggestions.suggestedTopics.length > 0) {
      expect(output).toContain('Try filtering by topic');
      expect(output).toContain('topic=');
    }
  });

  it('should format tips', () => {
    const suggestions = generateSearchSuggestions('test');
    const output = formatSearchSuggestions('test', suggestions);
    expect(output).toContain('Tips');
  });
});
