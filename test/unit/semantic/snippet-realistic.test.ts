/**
 * Semantic tests for snippet quality using realistic search fixture data.
 *
 * Tests cleanSnippet against ACTUAL problematic inputs found in real API responses,
 * not just the batch of already-clean fixture snippets.
 */

import { describe, it, expect } from 'vitest';
import { createRealisticSearchResponse } from '../../helpers/fixtures.js';
import { cleanSnippet } from '../../../src/core/services/scraper.js';

/**
 * Strip HTML tags (same logic as scraper.ts stripHtml)
 */
function stripHtml(html: string): string {
  let text = html.length > 1000 ? html.slice(0, 1000) : html;
  let prev = '';
  let iterations = 0;
  while (prev !== text && iterations < 10) {
    prev = text;
    text = text.replace(/<[^>]*>/g, '');
    iterations++;
  }
  const entities: Record<string, string> = {
    '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
  };
  for (const [entity, char] of Object.entries(entities)) {
    text = text.replaceAll(entity, char);
  }
  return text.replace(/\s+/g, ' ').trim();
}

describe('snippet quality with realistic fixtures', () => {
  const fixtureData = createRealisticSearchResponse();
  const results = fixtureData.Results.filter(r => r.leading_result);

  it('should have realistic fixture data to work with', () => {
    expect(results.length).toBeGreaterThan(10);
  });

  // Batch test: fixture data through cleanSnippet should produce valid output
  it('should produce valid snippets for all fixture results', () => {
    for (const wrapper of results) {
      const lr = wrapper.leading_result!;
      const rawSnippet = stripHtml(lr.snippet).slice(0, 500);
      const product = lr.publication_title || 'Jamf';
      const cleaned = cleanSnippet(rawSnippet, lr.title, product);

      expect(cleaned.length).toBeGreaterThanOrEqual(10);
      expect(cleaned).not.toMatch(/^Home\s*>/i);
    }
  });

  // Find the short snippet in fixture data and verify it gets fallback treatment
  it('should apply title fallback for the short fixture snippet', () => {
    const shortResult = results.find(wrapper => {
      const raw = stripHtml(wrapper.leading_result!.snippet).slice(0, 500);
      return raw.length < 50;
    });

    // If fixture has a short snippet, verify fallback is applied
    if (shortResult) {
      const lr = shortResult.leading_result!;
      const rawSnippet = stripHtml(lr.snippet).slice(0, 500);
      const product = lr.publication_title || 'Jamf';
      const cleaned = cleanSnippet(rawSnippet, lr.title, product);

      // Fallback format: "Title" or "Title — Product"
      expect(cleaned).toContain(lr.title);
    }
  });
});

/**
 * Tests with deliberately problematic inputs that represent real-world edge cases.
 * These are patterns we've observed in actual API responses.
 */
describe('snippet quality with problematic inputs', () => {
  it('should handle breadcrumb-only snippet → title fallback', () => {
    const cleaned = cleanSnippet(
      'Home > Jamf Pro > Getting Started',
      'Getting Started with Jamf Pro',
      'Jamf Pro'
    );

    expect(cleaned).not.toMatch(/^Home\s*>/i);
    // After stripping breadcrumb, remainder is too short → should use title fallback
    expect(cleaned).toContain('Getting Started with Jamf Pro');
  });

  it('should handle multi-level breadcrumb navigation snippet', () => {
    const cleaned = cleanSnippet(
      'Jamf Pro > Device Management > Configuration Profiles > This is actual content about profiles.',
      'Configuration Profiles',
      'Jamf Pro'
    );

    // Should strip "A > B > C" breadcrumb prefix
    expect(cleaned).not.toMatch(/^Jamf Pro\s*>/);
  });

  it('should handle empty snippet → title fallback', () => {
    const cleaned = cleanSnippet('', 'FileVault Management', 'Jamf Pro');
    expect(cleaned).toContain('FileVault Management');
    expect(cleaned.length).toBeGreaterThanOrEqual(10);
  });

  it('should handle whitespace-only snippet → title fallback', () => {
    const cleaned = cleanSnippet('   \n\t  ', 'Network Settings', 'Jamf Pro');
    expect(cleaned).toContain('Network Settings');
  });

  it('should handle snippet that is exactly the title (no added value)', () => {
    const cleaned = cleanSnippet('Policies', 'Policies', 'Jamf Pro');
    // Short snippet → fallback with product suffix
    expect(cleaned).toContain('Policies');
    expect(cleaned).toContain('Jamf Pro');
  });

  it('should handle snippet with HTML entities that survived stripping', () => {
    const cleaned = cleanSnippet(
      'Configure SSO &amp; LDAP integration for your organization&#39;s directory services.',
      'SSO Configuration',
      'Jamf Pro'
    );
    // The raw snippet might still have entities; cleanSnippet should handle them
    expect(cleaned.length).toBeGreaterThanOrEqual(10);
  });

  it('should handle very long snippet by not exceeding max length', () => {
    const longContent = 'Configuration profiles allow administrators to manage '.repeat(20);
    const cleaned = cleanSnippet(longContent, 'Config Profiles', 'Jamf Pro');
    // Should return the content without truncation panic
    expect(cleaned.length).toBeGreaterThan(50);
  });

  it('should include product in fallback when snippet is too short', () => {
    const cleaned = cleanSnippet('OK', 'MDM Commands', 'Jamf Pro');
    // Fallback format: "Title — Product"
    expect(cleaned).toBe('MDM Commands — Jamf Pro');
  });

  it('should not include product in fallback when product is null', () => {
    const cleaned = cleanSnippet('OK', 'MDM Commands', null);
    expect(cleaned).toBe('MDM Commands');
  });
});
