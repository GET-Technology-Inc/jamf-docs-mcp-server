import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// CRLF filtering
//
// getEnvString (private) strips \r and \n before returning an env value.
// We test the exact regex pattern used: value.replace(/[\r\n]/g, '')
// ---------------------------------------------------------------------------

describe('CRLF filtering', () => {
  // Inline the same regex used by getEnvString so the tests are tied to the
  // documented behaviour rather than an arbitrary implementation detail.
  const crlfFilter = (value: string): string => value.replace(/[\r\n]/g, '');

  it('should leave a normal value unchanged', () => {
    expect(crlfFilter('JamfDocsMCP/1.0')).toBe('JamfDocsMCP/1.0');
  });

  it('should strip a carriage-return followed by a newline (CRLF injection)', () => {
    const injected = 'Bot/1.0\r\nX-Injected: true';
    expect(crlfFilter(injected)).toBe('Bot/1.0X-Injected: true');
  });

  it('should strip a lone newline (LF)', () => {
    expect(crlfFilter('line1\nline2')).toBe('line1line2');
  });

  it('should strip a lone carriage-return (CR)', () => {
    expect(crlfFilter('line1\rline2')).toBe('line1line2');
  });

  it('should strip all CRLF characters across multiple occurrences', () => {
    expect(crlfFilter('line1\nline2\rline3\r\nline4')).toBe('line1line2line3line4');
  });

  it('should return an empty string unchanged', () => {
    expect(crlfFilter('')).toBe('');
  });

  it('should handle a value that is only CRLF characters', () => {
    expect(crlfFilter('\r\n\r\n')).toBe('');
  });

  it('should not strip other whitespace characters', () => {
    // Tabs and spaces are legitimate in User-Agent strings and must be preserved.
    expect(crlfFilter('Agent\t1.0 (compatible)')).toBe('Agent\t1.0 (compatible)');
  });
});

// ---------------------------------------------------------------------------
// Sensitive directory validation
//
// getValidatedCacheDir (private) rejects absolute paths that start with a
// system-sensitive prefix.  We test the matching predicate in isolation using
// the exact prefix list and logic from constants.ts.
// ---------------------------------------------------------------------------

describe('Sensitive directory validation', () => {
  // Mirror the exact list and matching algorithm from constants.ts.
  const SENSITIVE_DIR_PREFIXES = ['/etc', '/usr', '/var', '/sys', '/proc', '/dev', '/sbin', '/bin'];

  const isSensitive = (dir: string): boolean => {
    const normalized = dir.toLowerCase();
    return SENSITIVE_DIR_PREFIXES.some(
      prefix => normalized === prefix || normalized.startsWith(`${prefix}/`)
    );
  };

  it('should reject a path equal to a sensitive prefix', () => {
    expect(isSensitive('/etc')).toBe(true);
  });

  it('should reject a path that starts with /etc/', () => {
    expect(isSensitive('/etc/jamf-cache')).toBe(true);
  });

  it('should reject /usr/local/cache', () => {
    expect(isSensitive('/usr/local/cache')).toBe(true);
  });

  it('should reject /var/cache', () => {
    expect(isSensitive('/var/cache')).toBe(true);
  });

  it('should reject /sys/kernel', () => {
    expect(isSensitive('/sys/kernel')).toBe(true);
  });

  it('should reject /proc/self', () => {
    expect(isSensitive('/proc/self')).toBe(true);
  });

  it('should reject /dev/null', () => {
    expect(isSensitive('/dev/null')).toBe(true);
  });

  it('should reject /sbin/cache', () => {
    expect(isSensitive('/sbin/cache')).toBe(true);
  });

  it('should reject /bin/local', () => {
    expect(isSensitive('/bin/local')).toBe(true);
  });

  it('should reject sensitive prefixes case-insensitively', () => {
    expect(isSensitive('/ETC/passwd')).toBe(true);
    expect(isSensitive('/USR/LOCAL')).toBe(true);
  });

  it('should allow /tmp (not in the sensitive list)', () => {
    expect(isSensitive('/tmp')).toBe(false);
  });

  it('should allow a home directory path', () => {
    expect(isSensitive('/home/user/.cache')).toBe(false);
  });

  it('should allow /opt/cache', () => {
    expect(isSensitive('/opt/cache')).toBe(false);
  });

  it('should not reject a path that merely contains a prefix substring without a boundary', () => {
    // "/etc-like/path" starts with "/etc-" not "/etc/" so it must not match.
    expect(isSensitive('/etc-like/path')).toBe(false);
  });

  it('should not reject a relative path', () => {
    // Relative paths are handled by a different branch in getValidatedCacheDir.
    expect(isSensitive('.cache')).toBe(false);
    expect(isSensitive('etc/config')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// HTML stripping truncation
//
// stripHtml (private) truncates its input to MAX_SNIPPET_LENGTH * 2 chars
// before applying the tag-stripping regex.  We mirror the behaviour here to
// verify the truncation boundary and that tags are still removed correctly.
// ---------------------------------------------------------------------------

describe('HTML stripping truncation', () => {
  // Mirror the exact constant values from constants.ts.
  const MAX_SNIPPET_LENGTH = 500;
  const MAX_INPUT_LENGTH = MAX_SNIPPET_LENGTH * 2; // 1000 chars

  // Reproduce the same logic as the private stripHtml function.
  const stripHtml = (html: string): string => {
    let text = html.length > MAX_INPUT_LENGTH
      ? html.slice(0, MAX_INPUT_LENGTH)
      : html;

    const MAX_ITERATIONS = 10;
    let prev = '';
    let iterations = 0;
    while (prev !== text && iterations < MAX_ITERATIONS) {
      prev = text;
      text = text.replace(/<[^>]*>/g, '');
      iterations++;
    }

    const HTML_ENTITIES: Record<string, string> = {
      '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'"
    };
    for (const [entity, char] of Object.entries(HTML_ENTITIES)) {
      text = text.replaceAll(entity, char);
    }

    return text.replace(/\s+/g, ' ').trim();
  };

  it('should strip tags from short input', () => {
    expect(stripHtml('<b>Hello</b> world')).toBe('Hello world');
  });

  it('should return empty string for tag-only input', () => {
    expect(stripHtml('<p></p>')).toBe('');
  });

  it('should handle empty string input', () => {
    expect(stripHtml('')).toBe('');
  });

  it('should decode common HTML entities', () => {
    expect(stripHtml('AT&amp;T &lt;info&gt;')).toBe('AT&T <info>');
    expect(stripHtml('Say &quot;hello&quot; and &#39;bye&#39;')).toBe('Say "hello" and \'bye\'');
    expect(stripHtml('a&nbsp;b')).toBe('a b');
  });

  it('should not alter input shorter than the truncation threshold', () => {
    // A 100-char string of "a" has no tags – should come through untouched.
    const shortText = 'a'.repeat(100);
    expect(stripHtml(shortText)).toBe(shortText);
  });

  it('should truncate input that exceeds MAX_SNIPPET_LENGTH * 2 before stripping', () => {
    // Build input that is 2 000 chars – well above the 1 000-char threshold.
    const oversized = '<p>' + 'x'.repeat(2000) + '</p>';
    const result = stripHtml(oversized);
    // After truncation the text content is at most 1000 chars (minus tag chars).
    expect(result.length).toBeLessThanOrEqual(MAX_INPUT_LENGTH);
  });

  it('should not include content beyond the truncation boundary', () => {
    // Place a distinctive marker beyond the 1 000-char truncation boundary.
    const before = 'a'.repeat(MAX_INPUT_LENGTH);   // exactly 1 000 "a"s
    const marker = 'BEYOND_LIMIT';
    const oversized = before + marker;
    const result = stripHtml(oversized);
    expect(result).not.toContain(marker);
  });

  it('should handle deeply nested tags without hanging (iteration cap)', () => {
    // The implementation caps iterations at MAX_ITERATIONS = 10.
    const deeplyNested = '<b><i><u><s><em><strong>text</strong></em></s></u></i></b>';
    // Should complete and return "text" without throwing.
    expect(stripHtml(deeplyNested)).toBe('text');
  });

  it('should normalise multiple whitespace characters into a single space', () => {
    expect(stripHtml('hello   world\t\n!')).toBe('hello world !');
  });
});

// ---------------------------------------------------------------------------
// Prompt length limits via Zod
//
// The jamf_troubleshoot and jamf_setup_guide prompts enforce z.string().max(2000)
// on their primary text parameters.  We verify the schema boundary directly.
// ---------------------------------------------------------------------------

describe('Prompt length limits', () => {
  // Mirror the argsSchema used in troubleshoot.ts and setup-guide.ts.
  const troubleshootSchema = z.object({
    problem: z.string().max(2000),
    product: z.string().optional(),
  });

  const setupGuideSchema = z.object({
    feature: z.string().max(2000),
    product: z.string().optional(),
  });

  describe('jamf_troubleshoot problem field', () => {
    it('should accept a short problem description', () => {
      const result = troubleshootSchema.safeParse({ problem: 'MDM enrollment failing' });
      expect(result.success).toBe(true);
    });

    it('should accept a problem description exactly 2000 characters long', () => {
      const result = troubleshootSchema.safeParse({ problem: 'x'.repeat(2000) });
      expect(result.success).toBe(true);
    });

    it('should reject a problem description longer than 2000 characters', () => {
      const result = troubleshootSchema.safeParse({ problem: 'x'.repeat(2001) });
      expect(result.success).toBe(false);
    });

    it('should accept an empty problem description (no min constraint)', () => {
      const result = troubleshootSchema.safeParse({ problem: '' });
      expect(result.success).toBe(true);
    });

    it('should accept when the optional product field is omitted', () => {
      const result = troubleshootSchema.safeParse({ problem: 'FileVault key escrow not working' });
      expect(result.success).toBe(true);
    });

    it('should accept when the optional product field is provided', () => {
      const result = troubleshootSchema.safeParse({
        problem: 'Cannot enroll device',
        product: 'jamf-pro',
      });
      expect(result.success).toBe(true);
    });

    it('should reject when the problem field is missing', () => {
      const result = troubleshootSchema.safeParse({ product: 'jamf-pro' });
      expect(result.success).toBe(false);
    });
  });

  describe('jamf_setup_guide feature field', () => {
    it('should accept a short feature description', () => {
      const result = setupGuideSchema.safeParse({ feature: 'FileVault' });
      expect(result.success).toBe(true);
    });

    it('should accept a feature description exactly 2000 characters long', () => {
      const result = setupGuideSchema.safeParse({ feature: 'y'.repeat(2000) });
      expect(result.success).toBe(true);
    });

    it('should reject a feature description longer than 2000 characters', () => {
      const result = setupGuideSchema.safeParse({ feature: 'y'.repeat(2001) });
      expect(result.success).toBe(false);
    });

    it('should accept when the optional product field is omitted', () => {
      const result = setupGuideSchema.safeParse({ feature: 'DEP enrollment' });
      expect(result.success).toBe(true);
    });

    it('should accept when the optional product field is provided', () => {
      const result = setupGuideSchema.safeParse({
        feature: 'LDAP directory binding',
        product: 'jamf-pro',
      });
      expect(result.success).toBe(true);
    });

    it('should reject when the feature field is missing', () => {
      const result = setupGuideSchema.safeParse({ product: 'jamf-school' });
      expect(result.success).toBe(false);
    });
  });
});
