import { describe, it, expect } from 'vitest';
import {
  sanitizeMarkdownText,
  sanitizeMarkdownUrl,
  sanitizeErrorMessage
} from '../../src/core/utils/sanitize.js';

describe('Markdown output sanitization integration', () => {
  describe('search result title sanitization', () => {
    it('should produce safe Markdown link with normal title', () => {
      const title = 'Configuration Profiles';
      const url = 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/Configuration_Profiles.html';
      const result = `### [${sanitizeMarkdownText(title)}](${sanitizeMarkdownUrl(url)})`;
      expect(result).toContain('[Configuration Profiles]');
      expect(result).toContain('(https://learn.jamf.com');
    });

    it('should neutralize Markdown injection in title', () => {
      const title = '](https://evil.com)[Click me';
      const url = 'https://learn.jamf.com/page.html';
      const result = `### [${sanitizeMarkdownText(title)}](${sanitizeMarkdownUrl(url)})`;
      // The escaped title should not create a functional link to evil.com
      expect(result).not.toContain('](https://evil.com)');
      expect(result).toContain('\\]\\(https://evil.com\\)');
    });

    it('should reject non-https URLs in search results', () => {
      const title = 'Safe Title';
      const maliciousUrl = 'javascript:alert(document.cookie)';
      const result = `[${sanitizeMarkdownText(title)}](${sanitizeMarkdownUrl(maliciousUrl)})`;
      expect(result).toBe('[Safe Title](#)');
    });
  });

  describe('article footer sanitization', () => {
    it('should produce safe source link', () => {
      const url = 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/Test.html';
      const safeUrl = sanitizeMarkdownUrl(url);
      const safeText = sanitizeMarkdownText(url);
      const result = `*Source: [${safeText}](${safeUrl})*`;
      expect(result).toContain('https://learn.jamf.com');
    });
  });

  describe('related article sanitization', () => {
    it('should sanitize related article links', () => {
      const articles = [
        { title: 'Normal Article', url: 'https://learn.jamf.com/page1.html' },
        { title: '[Evil](https://evil.com)', url: 'https://learn.jamf.com/page2.html' }
      ];

      const results = articles.map(a =>
        `- [${sanitizeMarkdownText(a.title)}](${sanitizeMarkdownUrl(a.url)})`
      );

      expect(results[0]).toBe('- [Normal Article](https://learn.jamf.com/page1.html)');
      expect(results[1]).toContain('\\[Evil\\]\\(https://evil.com\\)');
    });
  });

  describe('error message sanitization in tool context', () => {
    it('should sanitize network errors before returning to client', () => {
      const rawError = 'getaddrinfo ENOTFOUND learn.jamf.com';
      const sanitized = sanitizeErrorMessage(rawError);
      expect(sanitized).toContain('learn.jamf.com');
    });

    it('should sanitize axios error messages', () => {
      const rawError = 'Request failed with status code 500 at /Users/deploy/app/node_modules/axios/lib/core/settle.js:19:12';
      const sanitized = sanitizeErrorMessage(rawError);
      expect(sanitized).not.toContain('/Users/deploy');
    });
  });
});
