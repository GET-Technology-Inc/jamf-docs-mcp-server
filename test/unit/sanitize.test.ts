import { describe, it, expect } from 'vitest';
import {
  sanitizeMarkdownText,
  sanitizeMarkdownUrl,
  sanitizeErrorMessage
} from '../../src/core/utils/sanitize.js';

describe('sanitizeMarkdownText', () => {
  it('should return normal text unchanged', () => {
    expect(sanitizeMarkdownText('Configuration Profiles')).toBe('Configuration Profiles');
  });

  it('should escape Markdown link injection', () => {
    const malicious = '[malicious](https://evil.com)';
    const result = sanitizeMarkdownText(malicious);
    expect(result).toBe('\\[malicious\\]\\(https://evil.com\\)');
    expect(result).not.toContain('[malicious]');
  });

  it('should escape bold and italic markers', () => {
    const input = '**bold** and _italic_';
    const result = sanitizeMarkdownText(input);
    expect(result).toBe('\\*\\*bold\\*\\* and \\_italic\\_');
  });

  it('should escape heading markers', () => {
    expect(sanitizeMarkdownText('# heading')).toBe('\\# heading');
  });

  it('should escape code backticks', () => {
    expect(sanitizeMarkdownText('use `code` here')).toBe('use \\`code\\` here');
  });

  it('should handle empty string', () => {
    expect(sanitizeMarkdownText('')).toBe('');
  });

  it('should escape all special characters', () => {
    const input = '[]()#*_`~>!|\\';
    const result = sanitizeMarkdownText(input);
    expect(result).toBe('\\[\\]\\(\\)\\#\\*\\_\\`\\~\\>\\!\\|\\\\');
  });

  it('should escape javascript: injection via Markdown link syntax', () => {
    // [hack](javascript:alert(1)) - all special chars must be escaped
    const injection = '[hack](javascript:alert(1))';
    const result = sanitizeMarkdownText(injection);
    // After escaping: \[hack\]\(javascript:alert\(1\)\)
    expect(result).toContain('\\[');
    expect(result).toContain('\\]');
    expect(result).toContain('\\(');
    expect(result).toContain('\\)');
    // Should not contain unescaped [ or ] or ( or )
    expect(result).not.toMatch(/(?<!\\)\[/);
    expect(result).not.toMatch(/(?<!\\)\]/);
    expect(result).not.toMatch(/(?<!\\)\(/);
    expect(result).not.toMatch(/(?<!\\)\)/);
  });
});

describe('sanitizeMarkdownUrl', () => {
  it('should allow valid HTTPS URLs', () => {
    expect(sanitizeMarkdownUrl('https://learn.jamf.com/page.html')).toBe('https://learn.jamf.com/page.html');
  });

  it('should reject javascript: protocol', () => {
    expect(sanitizeMarkdownUrl('javascript:alert(1)')).toBe('#');
  });

  it('should reject http: protocol', () => {
    expect(sanitizeMarkdownUrl('http://example.com')).toBe('#');
  });

  it('should reject data: protocol', () => {
    expect(sanitizeMarkdownUrl('data:text/html,<script>alert(1)</script>')).toBe('#');
  });

  it('should percent-encode parentheses in URLs', () => {
    const url = 'https://example.com/page_(v2)';
    expect(sanitizeMarkdownUrl(url)).toBe('https://example.com/page_%28v2%29');
  });

  it('should encode both opening and closing parentheses as %28 and %29', () => {
    const url = 'https://learn.jamf.com/path/(section)';
    const result = sanitizeMarkdownUrl(url);
    expect(result).toContain('%28');
    expect(result).toContain('%29');
    expect(result).not.toContain('(');
    expect(result).not.toContain(')');
  });

  it('should return # for invalid URLs', () => {
    expect(sanitizeMarkdownUrl('not a url')).toBe('#');
  });

  it('should return # for empty string', () => {
    expect(sanitizeMarkdownUrl('')).toBe('#');
  });

  it('should allow https URLs without modification when no parentheses', () => {
    const url = 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/Overview.html';
    expect(sanitizeMarkdownUrl(url)).toBe(url);
  });
});

describe('sanitizeErrorMessage', () => {
  it('should pass through messages with no sensitive content', () => {
    const msg = 'Network error: connect ECONNREFUSED learn.jamf.com:443';
    expect(sanitizeErrorMessage(msg)).toContain('learn.jamf.com');
  });

  it('should remove Unix file paths', () => {
    const msg = 'Error in /Users/deploy/app/src/services/scraper.ts';
    const result = sanitizeErrorMessage(msg);
    expect(result).not.toContain('/Users/deploy');
  });

  it('should replace Unix file paths with <path>', () => {
    const msg = 'Error in /Users/deploy/app/src/services/scraper.ts line 42';
    const result = sanitizeErrorMessage(msg);
    expect(result).toContain('<path>');
  });

  it('should remove Windows file paths', () => {
    const msg = 'Error in C:\\Users\\admin\\app\\src\\index.ts line 5';
    const result = sanitizeErrorMessage(msg);
    expect(result).not.toContain('C:\\Users\\admin');
    expect(result).toContain('<path>');
  });

  it('should remove stack traces', () => {
    const msg = 'Error occurred\n    at Function.run (/app/index.js:10:5)\n    at main (/app/main.js:3:1)';
    const result = sanitizeErrorMessage(msg);
    expect(result).not.toContain('at Function.run');
    expect(result).not.toContain('at main');
    expect(result).toContain('Error occurred');
  });

  it('should remove multiple stack trace lines', () => {
    const msg = [
      'TypeError: Cannot read property',
      '    at Object.fn (/app/src/tool.ts:5:10)',
      '    at processTicksAndRejections (node:internal/process/task_queues:96:5)',
    ].join('\n');
    const result = sanitizeErrorMessage(msg);
    expect(result).not.toContain('at Object.fn');
    expect(result).not.toContain('at processTicksAndRejections');
    expect(result).toContain('TypeError');
  });

  it('should preserve full URLs and not strip URL path as file path', () => {
    const msg = 'Failed to fetch https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/Overview.html';
    const result = sanitizeErrorMessage(msg);
    expect(result).toContain('https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/Overview.html');
  });

  it('should pass through generic messages unchanged', () => {
    const msg = 'Request timed out';
    expect(sanitizeErrorMessage(msg)).toBe('Request timed out');
  });

  it('should preserve error details while stripping paths', () => {
    const msg = 'Error connecting to learn.jamf.com: timeout after 15000ms';
    const result = sanitizeErrorMessage(msg);
    expect(result).toContain('timeout after 15000ms');
    expect(result).toContain('learn.jamf.com');
  });
});
