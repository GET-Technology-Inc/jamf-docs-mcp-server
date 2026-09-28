/**
 * Unit tests for cleanSnippet function
 */

import { describe, it, expect } from 'vitest';
import { cleanSnippet } from '../../src/core/services/content-parser.js';

describe('cleanSnippet', () => {
  it('should pass through normal snippets unchanged', () => {
    const snippet = 'This article explains how to deploy configuration profiles to managed devices using Jamf Pro.';
    expect(cleanSnippet(snippet, 'Config Profiles', 'Jamf Pro')).toBe(snippet);
  });

  it('should strip breadcrumb prefix starting with Home >', () => {
    const snippet = 'Home > Jamf Pro > Computer Management > Configuration Profiles';
    const result = cleanSnippet(snippet, 'Configuration Profiles', 'Jamf Pro');
    // After stripping "Home > ...", what remains is short, so fallback kicks in
    expect(result).toBe('Configuration Profiles \u2014 Jamf Pro');
  });

  it('should strip navigation prefix with > separators', () => {
    const snippet = 'Jamf Pro > Enrollment > Settings > This article explains how to configure automated device enrollment in your organization.';
    const result = cleanSnippet(snippet, 'Enrollment Settings', 'Jamf Pro');
    // The breadcrumb pattern matches, stripping the prefix
    expect(result).not.toContain('Jamf Pro > Enrollment > Settings');
  });

  it('should use fallback for empty snippets', () => {
    const result = cleanSnippet('', 'Test Article', 'Jamf Pro');
    expect(result).toBe('Test Article \u2014 Jamf Pro');
  });

  it('should use fallback for very short snippets (< 50 chars)', () => {
    const result = cleanSnippet('See also:', 'Test Article', 'Jamf Pro');
    expect(result).toBe('Test Article \u2014 Jamf Pro');
  });

  it('should use title-only fallback when product is null', () => {
    const result = cleanSnippet('', 'Test Article', null);
    expect(result).toBe('Test Article');
  });

  it('should use title-only fallback when product is empty', () => {
    const result = cleanSnippet('short', 'Test Article', '');
    expect(result).toBe('Test Article');
  });

  it('should keep snippets that are exactly 50 characters', () => {
    const snippet = 'A'.repeat(50);
    expect(cleanSnippet(snippet, 'Title', 'Product')).toBe(snippet);
  });

  it('should decode character references once, after the tags are stripped', () => {
    const snippet = '<span class="kwicstring">Set it to &quot;Basic&quot; in the user&#x27;s '
      + '&lt;dict&gt;, and write the text &amp;lt;key&amp;gt; as it is.</span>';
    expect(cleanSnippet(snippet, 'Title', 'Product'))
      .toBe('Set it to "Basic" in the user\'s <dict>, and write the text &lt;key&gt; as it is.');
  });

  it('should keep a < decoded from a reference, and still strip a stray raw one', () => {
    const snippet = 'A stray > from a cut fragment, then the text &lt;script&gt; a page shows as text.';
    expect(cleanSnippet(snippet, 'Title', 'Product'))
      .toBe('A stray  from a cut fragment, then the text <script> a page shows as text.');
  });
});
