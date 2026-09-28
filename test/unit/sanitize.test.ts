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
    const input = '[]()#*_`~<>!|\\';
    const result = sanitizeMarkdownText(input);
    expect(result).toBe('\\[\\]\\(\\)\\#\\*\\_\\`\\~\\<\\>\\!\\|\\\\');
  });

  it('should escape a tag, a comment and an autolink, which CommonMark passes through as HTML', () => {
    expect(sanitizeMarkdownText('<img src=x onerror=alert(1)>'))
      .toBe('\\<img src=x onerror=alert\\(1\\)\\>');
    expect(sanitizeMarkdownText('<!-- c -->')).toBe('\\<\\!-- c --\\>');
    expect(sanitizeMarkdownText('<https://example.com>')).toBe('\\<https://example.com\\>');
  });

  it('should keep a character reference from being decoded, which CommonMark does', () => {
    // A named one by escaping its `&`; a numeric one by escaping its `#`.
    expect(sanitizeMarkdownText('&lt;key&gt; &amp; &nbsp; &#60; &#x3C;'))
      .toBe('\\&lt;key\\&gt; \\&amp; \\&nbsp; &\\#60; &\\#x3C;');
    // Names are case-sensitive and can hold digits, and CommonMark decodes
    // these too: `&LT;` is "<", `&frac12;` "½", `&sup2;` "²", `&Ouml;` "Ö".
    expect(sanitizeMarkdownText('&LT; &AMP; &frac12; &sup2; &Ouml;'))
      .toBe('\\&LT; \\&AMP; \\&frac12; \\&sup2; \\&Ouml;');
  });

  it('should write the text on one line: a line break or tab, with the spaces around it, is one space', () => {
    // A newline ends the list item, heading or quote the text is written
    // into, and the next line can start a block of its own: a list item.
    expect(sanitizeMarkdownText('Policies\n- Injected')).toBe('Policies - Injected');
    expect(sanitizeMarkdownText('Policies\n1. Injected')).toBe('Policies 1. Injected');
    expect(sanitizeMarkdownText('a \r\n\t b')).toBe('a b');
    // Each line break Unicode or a Markdown reader knows: CR, LF, VT, FF,
    // NEL, the line and paragraph separators.
    expect(sanitizeMarkdownText('a\rb\nc\vd\fe\u0085f\u2028g\u2029h\ti')).toBe('a b c d e f g h i');
  });

  it('should leave the spaces of a line as they are', () => {
    // A no-break space before a French colon, a double space, a leading and
    // a trailing one: none ends a line.
    expect(sanitizeMarkdownText(' Remarque\u00a0: a  b\u202fc ')).toBe(' Remarque\u00a0: a  b\u202fc ');
  });

  it('should drop the other controls, and the bidi marks, embeddings, overrides and isolates', () => {
    expect(sanitizeMarkdownText('a\u0000b\u0007c\u001bd\u007fe\u0080f\u009bg')).toBe('abcdefg');
    // "Policies" then a right-to-left override that shows "exe.gnp" as "png.exe".
    expect(sanitizeMarkdownText('Policies\u202eexe.gnp')).toBe('Policiesexe.gnp');
    expect(sanitizeMarkdownText('\u200ea\u200fb\u061cc\u202ad\u202be\u202cf\u202dg\u2066h\u2067i\u2068j\u2069'))
      .toBe('abcdefghij');
  });

  it('should keep the joiners some scripts and emoji need', () => {
    expect(sanitizeMarkdownText('\u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u0645 \ud83d\udc69\u200d\ud83d\udcbb'))
      .toBe('\u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u0645 \ud83d\udc69\u200d\ud83d\udcbb');
  });

  it('should escape what dropping a control brings together', () => {
    expect(sanitizeMarkdownText('&\u0000lt; <\u200eb>')).toBe('\\&lt; \\<b\\>');
  });

  it('should leave an & that starts no reference as it is', () => {
    expect(sanitizeMarkdownText('Authentication & Assurance, AT&T, R&D, a&b=c, &;, & amp;, &lt'))
      .toBe('Authentication & Assurance, AT&T, R&D, a&b=c, &;, & amp;, &lt');
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
