/**
 * Semantic tests for section ID generation using realistic article fixtures.
 *
 * Real-world edge cases discovered in actual API responses:
 * 1. Turndown produces `## [](#)Title` anchor prefixes — slugify must strip these
 * 2. Parentheses in headings like "Single Sign-On (SSO)"
 * 3. Long heading titles that produce long slugs
 */

import { describe, it, expect } from 'vitest';
import * as cheerio from 'cheerio';
import TurndownService from 'turndown';
import { createRealisticArticleHtml } from '../../helpers/fixtures.js';
import { extractSections, slugify } from '../../../src/services/tokenizer.js';

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
});

function htmlToMarkdown(html: string): string {
  const $ = cheerio.load(html);
  const contentHtml = $('article').html() ?? $('main').html() ?? html;
  return turndown.turndown(contentHtml);
}

describe('section ID generation with realistic fixtures', () => {
  it('should produce non-empty valid IDs for article with [](#) anchor prefixes', () => {
    // Article 0 has headings like "## [](#)Payload Variables for Configuration Profiles"
    // which is a real Turndown conversion artifact from learn.jamf.com
    const { html } = createRealisticArticleHtml(0);
    const markdown = htmlToMarkdown(html);
    const sections = extractSections(markdown);

    expect(sections.length).toBeGreaterThan(0);

    for (const section of sections) {
      expect(section.id, `ID for "${section.title}" should not be empty`).toBeTruthy();
      expect(section.id).toMatch(/^[a-z0-9][a-z0-9-]*$/);
    }
  });

  it('should handle parentheses in heading titles', () => {
    // Article 1: "Single Sign-On (SSO)" — parentheses are real special chars
    const { html } = createRealisticArticleHtml(1);
    const markdown = htmlToMarkdown(html);
    const sections = extractSections(markdown);

    const ssoSection = sections.find(s => s.title.includes('SSO') || s.title.includes('Sign-On'));
    if (ssoSection) {
      expect(ssoSection.id).toMatch(/^[a-z0-9][a-z0-9-]*$/);
      expect(ssoSection.id).not.toContain('(');
      expect(ssoSection.id).not.toContain(')');
      // Should produce something like "single-sign-on-sso"
      expect(ssoSection.id).toContain('sso');
    }
  });

  it('should produce unique IDs (no duplicates) across all headings', () => {
    const { html } = createRealisticArticleHtml(0);
    const markdown = htmlToMarkdown(html);
    const sections = extractSections(markdown);

    const ids = sections.map(s => s.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('should include correct heading levels', () => {
    const { html } = createRealisticArticleHtml(0);
    const markdown = htmlToMarkdown(html);
    const sections = extractSections(markdown);

    for (const section of sections) {
      expect(section.level).toBeGreaterThanOrEqual(1);
      expect(section.level).toBeLessThanOrEqual(6);
    }
  });
});

describe('slugify edge cases from real content', () => {
  it('should strip [](#) anchor prefix from Turndown output', () => {
    const id = slugify('[](#)Payload Variables for Configuration Profiles');
    expect(id).toBe('payload-variables-for-configuration-profiles');
  });

  it('should handle parentheses', () => {
    const id = slugify('Single Sign-On (SSO)');
    expect(id).toBe('single-sign-on-sso');
  });

  it('should handle ampersand', () => {
    const id = slugify('PSSO (Platform SSO) & Entra ID');
    expect(id).toBe('psso-platform-sso-entra-id');
  });

  it('should handle numbers in heading', () => {
    const id = slugify('macOS 14.0 Sequoia Requirements');
    expect(id).toBe('macos-14-0-sequoia-requirements');
  });

  it('should handle all-special-chars heading', () => {
    const id = slugify('### --- ###');
    // After removing all non-alphanumeric → empty → fallback handled by extractSections
    expect(id).toBe('');
  });

  it('should handle leading special chars', () => {
    const id = slugify('(Optional) Advanced Settings');
    expect(id).toBe('optional-advanced-settings');
  });
});
