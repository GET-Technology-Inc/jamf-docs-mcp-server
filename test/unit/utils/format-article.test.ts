/**
 * Unit tests for format-article utility functions:
 *   formatArticleFull, formatArticleCompact, and the internal formatSectionsList
 *   (tested indirectly through formatArticleFull with truncated tokenInfo).
 */

import { describe, it, expect } from 'vitest';
import {
  formatArticleFull,
  formatArticleCompact,
  buildArticleContentView,
  buildCompactArticleView,
} from '../../../src/core/utils/format-article.js';
import { estimateTokens } from '../../../src/core/services/tokenizer.js';
import {
  createFetchArticleResult,
  createTokenInfo,
  createArticleSection,
} from '../../helpers/fixtures.js';
import type { FetchArticleResult, ArticleSection } from '../../../src/core/types.js';

// ── Shared helpers ────────────────────────────────────────────────────────────

function makeArticle(overrides?: Partial<FetchArticleResult>): FetchArticleResult {
  return createFetchArticleResult({
    title: 'Configuration Profiles',
    content: 'This article explains configuration profiles.',
    url: 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/Configuration_Profiles.html',
    product: 'Jamf Pro',
    version: '11.0',
    breadcrumb: undefined,
    relatedArticles: undefined,
    sections: [],
    ...overrides,
  });
}

function makeSections(count: number): ArticleSection[] {
  return Array.from({ length: count }, (_, i) =>
    createArticleSection({
      id: `section-${i}`,
      title: `Section ${i + 1}`,
      level: 2,
      tokenCount: 100 + i * 10,
    })
  );
}

/**
 * Content well above the ~500 token preview limit.
 * At ~4 chars/token, ~3400 chars ≈ 850 tokens — clearly exceeds the preview.
 */
function makeLongContent(): string {
  const paragraph = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. ';
  return `${Array.from({ length: 60 }, () => paragraph).join('')  }\n\n`
    + '## Deep Section\n\nMore detailed content that should not appear in preview.';
}

/**
 * Long content split into many paragraphs, so the preview can actually stop at
 * a boundary. `makeLongContent()` is one 850-token paragraph, which every
 * budget returns whole — useless for observing where the budget landed.
 */
function makeParagraphedContent(count = 60): string {
  return Array.from(
    { length: count },
    (_, i) => `Paragraph ${i + 1}: lorem ipsum dolor sit amet, consectetur adipiscing elit.`
  ).join('\n\n');
}

// =============================================================================
// formatArticleFull
// =============================================================================

describe('formatArticleFull()', () => {
  // ── Normal article ──────────────────────────────────────────────────────────

  describe('normal article', () => {
    it('should include the article title as h1', () => {
      // Arrange
      const article = makeArticle();

      // Act
      const output = formatArticleFull(article);

      // Assert
      expect(output).toContain('# Configuration Profiles');
    });

    it('should include article content after the separator', () => {
      // Arrange
      const article = makeArticle({ content: 'Detailed content body.' });

      // Act
      const output = formatArticleFull(article);

      // Assert
      expect(output).toContain('---');
      expect(output).toContain('Detailed content body.');
    });

    it('should include product and version in metadata line', () => {
      // Arrange
      const article = makeArticle({ product: 'Jamf Pro', version: '11.5' });

      // Act
      const output = formatArticleFull(article);

      // Assert
      expect(output).toContain('**Product**: Jamf Pro');
      expect(output).toContain('**Version**: 11.5');
    });

    it('should include token count in metadata line', () => {
      // Arrange
      const article = makeArticle({
        tokenInfo: createTokenInfo({ tokenCount: 1234, maxTokens: 5000 }),
      });

      // Act
      const output = formatArticleFull(article);

      // Assert
      expect(output).toContain('**Tokens**: 1,234/5,000');
    });

    it('should include source link in footer', () => {
      // Arrange
      const article = makeArticle();

      // Act
      const output = formatArticleFull(article);

      // Assert
      expect(output).toContain('*Source:');
      expect(output).toContain('learn.jamf.com');
    });

    it('should omit product from metadata when undefined', () => {
      // Arrange
      const article = makeArticle({ product: undefined });

      // Act
      const output = formatArticleFull(article);

      // Assert
      expect(output).not.toContain('**Product**');
    });

    it('should omit version from metadata when undefined', () => {
      // Arrange
      const article = makeArticle({ version: undefined });

      // Act
      const output = formatArticleFull(article);

      // Assert
      expect(output).not.toContain('**Version**');
    });
  });

  // ── Breadcrumb ──────────────────────────────────────────────────────────────

  describe('breadcrumb option', () => {
    it('should render breadcrumb as italic text above the title', () => {
      // Arrange
      const article = makeArticle();

      // Act
      const output = formatArticleFull(article, {
        breadcrumb: ['Jamf Pro', 'Device Management', 'Configuration Profiles'],
      });

      // Assert — breadcrumb precedes title in the output
      expect(output).toContain('*Jamf Pro > Device Management > Configuration Profiles*');
      const breadcrumbPos = output.indexOf('*Jamf Pro');
      const titlePos = output.indexOf('# Configuration Profiles');
      expect(breadcrumbPos).toBeLessThan(titlePos);
    });

    it('should not render breadcrumb when option is omitted', () => {
      // Arrange
      const article = makeArticle();

      // Act
      const output = formatArticleFull(article);

      // Assert
      expect(output).not.toContain(' > ');
    });

    it('should not render breadcrumb when array is empty', () => {
      // Arrange
      const article = makeArticle();

      // Act
      const output = formatArticleFull(article, { breadcrumb: [] });

      // Assert
      expect(output).not.toMatch(/\*.* > .*\*/);
    });
  });

  // ── lastUpdated option ──────────────────────────────────────────────────────

  describe('lastUpdated option', () => {
    it('should include lastUpdated in metadata line', () => {
      // Arrange
      const article = makeArticle();

      // Act
      const output = formatArticleFull(article, { lastUpdated: '2025-03-15' });

      // Assert
      expect(output).toContain('**Last Updated**: 2025-03-15');
    });

    it('should omit lastUpdated when not provided', () => {
      // Arrange
      const article = makeArticle();

      // Act
      const output = formatArticleFull(article);

      // Assert
      expect(output).not.toContain('Last Updated');
    });
  });

  // ── Section note ────────────────────────────────────────────────────────────

  describe('section option', () => {
    it('should show section note when section is specified', () => {
      // Arrange
      const article = makeArticle();

      // Act
      const output = formatArticleFull(article, { section: 'Prerequisites' });

      // Assert
      expect(output).toContain('*Showing section: "Prerequisites"*');
    });

    it('should not show section note when section is undefined', () => {
      // Arrange
      const article = makeArticle();

      // Act
      const output = formatArticleFull(article, { section: undefined });

      // Assert
      expect(output).not.toContain('Showing section');
    });

    it('should not show section note when section is empty string', () => {
      // Arrange
      const article = makeArticle();

      // Act
      const output = formatArticleFull(article, { section: '' });

      // Assert
      expect(output).not.toContain('Showing section');
    });
  });

  // ── Related articles ────────────────────────────────────────────────────────

  describe('relatedArticles option', () => {
    it('should include related articles section', () => {
      // Arrange
      const article = makeArticle();
      const related = [
        { title: 'Policies', url: 'https://learn.jamf.com/bundle/jamf-pro/page/Policies.html' },
        { title: 'Scripts', url: 'https://learn.jamf.com/bundle/jamf-pro/page/Scripts.html' },
      ];

      // Act
      const output = formatArticleFull(article, { relatedArticles: related });

      // Assert
      expect(output).toContain('## Related Articles');
      expect(output).toContain('Policies');
      expect(output).toContain('Scripts');
    });

    it('should not include related articles section when omitted', () => {
      // Arrange
      const article = makeArticle();

      // Act
      const output = formatArticleFull(article);

      // Assert
      expect(output).not.toContain('## Related Articles');
    });

    it('should not include related articles section when array is empty', () => {
      // Arrange
      const article = makeArticle();

      // Act
      const output = formatArticleFull(article, { relatedArticles: [] });

      // Assert
      expect(output).not.toContain('## Related Articles');
    });
  });

  // ── Truncation indication ───────────────────────────────────────────────────

  describe('truncated tokenInfo', () => {
    it('should show "(truncated)" marker in metadata line when truncated', () => {
      // Arrange
      const article = makeArticle({
        tokenInfo: createTokenInfo({ truncated: true, tokenCount: 4800, maxTokens: 5000 }),
      });

      // Act
      const output = formatArticleFull(article);

      // Assert
      expect(output).toContain('*(truncated)*');
    });

    it('should include truncation note in footer when truncated', () => {
      // Arrange
      const article = makeArticle({
        tokenInfo: createTokenInfo({ truncated: true, tokenCount: 4800, maxTokens: 5000 }),
      });

      // Act
      const output = formatArticleFull(article);

      // Assert
      expect(output).toContain('truncated from original');
      expect(output).toContain('max: 5,000');
    });

    it('should not show truncation note in footer when not truncated', () => {
      // Arrange
      const article = makeArticle({
        tokenInfo: createTokenInfo({ truncated: false }),
      });

      // Act
      const output = formatArticleFull(article);

      // Assert
      expect(output).not.toContain('truncated from original');
    });
  });

  // ── Sections list (shown when truncated and sections provided) ──────────────

  describe('sections list (formatSectionsList)', () => {
    it('should show sections list when truncated and sections are provided', () => {
      // Arrange
      const article = makeArticle({
        tokenInfo: createTokenInfo({ truncated: true }),
      });
      const sections = makeSections(3);

      // Act
      const output = formatArticleFull(article, { sections });

      // Assert
      expect(output).toContain('## Available Sections');
      expect(output).toContain('Section 1');
      expect(output).toContain('Section 2');
      expect(output).toContain('Section 3');
    });

    it('should not show sections list when not truncated', () => {
      // Arrange
      const article = makeArticle({
        tokenInfo: createTokenInfo({ truncated: false }),
      });
      const sections = makeSections(3);

      // Act
      const output = formatArticleFull(article, { sections });

      // Assert
      expect(output).not.toContain('## Available Sections');
    });

    it('should not show sections list when sections array is empty', () => {
      // Arrange
      const article = makeArticle({
        tokenInfo: createTokenInfo({ truncated: true }),
      });

      // Act
      const output = formatArticleFull(article, { sections: [] });

      // Assert
      expect(output).not.toContain('## Available Sections');
    });

    it('should cap sections list at 15 entries and show overflow count', () => {
      // Arrange
      const article = makeArticle({
        tokenInfo: createTokenInfo({ truncated: true }),
      });
      const sections = makeSections(20);

      // Act
      const output = formatArticleFull(article, { sections });

      // Assert
      expect(output).toContain('Section 15');
      expect(output).not.toContain('Section 16');
      expect(output).toContain('...and 5 more sections');
    });

    it('should show all sections when count is exactly 15', () => {
      // Arrange
      const article = makeArticle({
        tokenInfo: createTokenInfo({ truncated: true }),
      });
      const sections = makeSections(15);

      // Act
      const output = formatArticleFull(article, { sections });

      // Assert
      expect(output).toContain('Section 15');
      expect(output).not.toContain('more sections');
    });

    it('should indent nested sections (level > 1)', () => {
      // Arrange
      const article = makeArticle({
        tokenInfo: createTokenInfo({ truncated: true }),
      });
      const sections = [
        createArticleSection({ id: 'parent', title: 'Parent Section', level: 2, tokenCount: 100 }),
        createArticleSection({ id: 'child', title: 'Child Section', level: 3, tokenCount: 50 }),
      ];

      // Act
      const output = formatArticleFull(article, { sections });

      // Assert — child section has indentation (2 spaces for level 3, which is level-1=2 repeats)
      expect(output).toMatch(/\s{2,}- \*\*Child Section\*\*/);
    });

    it('should omit sections list when a specific section is set', () => {
      // Arrange — section option suppresses sections list per formatArticleFull logic
      const article = makeArticle({
        tokenInfo: createTokenInfo({ truncated: true }),
      });
      const sections = makeSections(5);

      // Act
      const output = formatArticleFull(article, {
        sections,
        section: 'Prerequisites',
      });

      // Assert
      expect(output).not.toContain('## Available Sections');
    });

    it('should include "Use section parameter" hint in sections list', () => {
      // Arrange
      const article = makeArticle({
        tokenInfo: createTokenInfo({ truncated: true }),
      });
      const sections = makeSections(3);

      // Act
      const output = formatArticleFull(article, { sections });

      // Assert
      expect(output).toContain('`section` parameter');
    });

    it('should include token count per section in sections list', () => {
      // Arrange
      const article = makeArticle({
        tokenInfo: createTokenInfo({ truncated: true }),
      });
      const sections = [
        createArticleSection({ id: 'intro', title: 'Introduction', level: 2, tokenCount: 250 }),
      ];

      // Act
      const output = formatArticleFull(article, { sections });

      // Assert
      expect(output).toContain('~250 tokens');
    });
  });

  // ── Truncation advice must be actionable ────────────────────────────────────

  describe('sections list advice (formatSectionAdvice)', () => {
    it('should not advise the `section` parameter when no section fits maxTokens', () => {
      // Arrange — the reported case: one 402-token section, budget of 100.
      const article = makeArticle({
        tokenInfo: createTokenInfo({ truncated: true, tokenCount: 100, maxTokens: 100 }),
      });
      const sections = [
        createArticleSection({ id: 'smart-groups', title: 'Smart Groups', level: 2, tokenCount: 402 }),
      ];

      // Act
      const output = formatArticleFull(article, { sections });

      // Assert — the list still helps, the advice must not point at `section`
      expect(output).toContain('## Available Sections');
      expect(output).toContain('~402 tokens');
      expect(output).not.toContain('Use `section` parameter to retrieve a specific section.');
      expect(output).toContain('No section fits within `maxTokens`');
      expect(output).toContain('`summaryOnly`');
    });

    it('should not advise the `section` parameter when every section is over budget', () => {
      // Arrange — several sections, all larger than the budget
      const article = makeArticle({
        tokenInfo: createTokenInfo({ truncated: true, tokenCount: 200, maxTokens: 200 }),
      });
      const sections = [
        createArticleSection({ id: 'a', title: 'Alpha', level: 2, tokenCount: 900 }),
        createArticleSection({ id: 'b', title: 'Beta', level: 2, tokenCount: 350 }),
      ];

      // Act
      const output = formatArticleFull(article, { sections });

      // Assert — smallest section is named so the caller knows the budget to set
      expect(output).not.toContain('Use `section` parameter to retrieve a specific section.');
      expect(output).toContain('the smallest is ~350 tokens');
    });

    it('should advise the `section` parameter when at least one section fits', () => {
      // Arrange — Beta fits inside the 400-token budget
      const article = makeArticle({
        tokenInfo: createTokenInfo({ truncated: true, tokenCount: 400, maxTokens: 400 }),
      });
      const sections = [
        createArticleSection({ id: 'a', title: 'Alpha', level: 2, tokenCount: 900 }),
        createArticleSection({ id: 'b', title: 'Beta', level: 2, tokenCount: 350 }),
      ];

      // Act
      const output = formatArticleFull(article, { sections });

      // Assert
      expect(output).toContain('Use `section` parameter to retrieve a specific section.');
      expect(output).not.toContain('No section fits');
    });

    it('should not imply a choice when there is only one section to pick', () => {
      // Arrange — the lone section fits, so `section` works, but nothing to choose
      const article = makeArticle({
        tokenInfo: createTokenInfo({ truncated: true, tokenCount: 5000, maxTokens: 5000 }),
      });
      const sections = [
        createArticleSection({ id: 'only', title: 'Overview', level: 2, tokenCount: 402 }),
      ];

      // Act
      const output = formatArticleFull(article, { sections });

      // Assert — mentions `section`, but not as a selection among several
      expect(output).not.toContain('Use `section` parameter to retrieve a specific section.');
      expect(output).toContain('the one listed section');
      expect(output).toContain('`maxTokens`');
    });

    it('should treat a section exactly at the budget as fitting', () => {
      // Arrange — boundary: tokenCount === maxTokens
      const article = makeArticle({
        tokenInfo: createTokenInfo({ truncated: true, tokenCount: 500, maxTokens: 500 }),
      });
      const sections = [
        createArticleSection({ id: 'a', title: 'Alpha', level: 2, tokenCount: 500 }),
        createArticleSection({ id: 'b', title: 'Beta', level: 2, tokenCount: 900 }),
      ];

      // Act
      const output = formatArticleFull(article, { sections });

      // Assert
      expect(output).toContain('Use `section` parameter to retrieve a specific section.');
    });
  });

  // ── briefFooter option ──────────────────────────────────────────────────────

  describe('briefFooter option', () => {
    it('should use brief footer (source link only, no token count line) when briefFooter is true', () => {
      // Arrange
      const article = makeArticle({
        tokenInfo: createTokenInfo({ tokenCount: 600, maxTokens: 5000 }),
      });

      // Act
      const output = formatArticleFull(article, { briefFooter: true });

      // Assert — brief footer has source link but no token count line
      expect(output).toContain('*Source:');
      expect(output).not.toContain('600 tokens');
    });

    it('should use full footer with token count when briefFooter is false (default)', () => {
      // Arrange
      const article = makeArticle({
        tokenInfo: createTokenInfo({ tokenCount: 600, maxTokens: 5000 }),
      });

      // Act
      const output = formatArticleFull(article);

      // Assert
      expect(output).toContain('600 tokens');
    });

    it('should use full footer with token count when briefFooter is explicitly false', () => {
      // Arrange
      const article = makeArticle({
        tokenInfo: createTokenInfo({ tokenCount: 600, maxTokens: 5000 }),
      });

      // Act
      const output = formatArticleFull(article, { briefFooter: false });

      // Assert
      expect(output).toContain('600 tokens');
    });
  });

  // ── URL sanitization ────────────────────────────────────────────────────────

  describe('URL sanitization', () => {
    it('should encode parentheses in URLs to prevent markdown link breakage', () => {
      // Arrange
      const article = makeArticle({
        url: 'https://learn.jamf.com/bundle/jamf-pro/page/article(1).html',
      });

      // Act
      const output = formatArticleFull(article);

      // Assert — parentheses encoded as %28/%29 in the link href
      expect(output).toContain('%28');
      expect(output).toContain('%29');
    });

    it('should return # for non-https URLs to prevent injection', () => {
      // Arrange — javascript: URL injection attempt
      const article = makeArticle({ url: 'javascript:alert(1)' });

      // Act
      const output = formatArticleFull(article);

      // Assert — the href in the footer should be sanitized to '#'
      expect(output).toContain('](#)');
    });
  });
});

// =============================================================================
// formatArticleCompact
// =============================================================================

describe('formatArticleCompact()', () => {
  // ── Normal output ───────────────────────────────────────────────────────────

  describe('normal compact output', () => {
    it('should include the article title as h1', () => {
      // Arrange
      const article = makeArticle({ title: 'MDM Profile Settings' });

      // Act
      const output = formatArticleCompact(article);

      // Assert
      expect(output).toContain('# MDM Profile Settings');
    });

    it('should include short article content in full (no truncation notice)', () => {
      // Arrange — content is well under ~500 tokens so it is shown completely
      const article = makeArticle({ content: 'Compact content here.' });

      // Act
      const output = formatArticleCompact(article);

      // Assert
      expect(output).toContain('Compact content here.');
      expect(output).not.toContain('Showing preview');
    });

    it('should include compact metadata with product and version', () => {
      // Arrange
      const article = makeArticle({ product: 'Jamf Pro', version: '11.0' });

      // Act
      const output = formatArticleCompact(article);

      // Assert
      expect(output).toContain('*Jamf Pro | v11.0*');
    });

    it('should include compact footer with source link and token count', () => {
      // Arrange
      const article = makeArticle({
        tokenInfo: createTokenInfo({ tokenCount: 350 }),
      });

      // Act
      const output = formatArticleCompact(article);

      // Assert
      expect(output).toContain('[Source]');
      expect(output).toContain('350 tokens');
    });

    it('should show "(truncated)" in footer when content is truncated', () => {
      // Arrange
      const article = makeArticle({
        tokenInfo: createTokenInfo({ truncated: true, tokenCount: 4500, maxTokens: 5000 }),
      });

      // Act
      const output = formatArticleCompact(article);

      // Assert
      expect(output).toContain('(truncated)');
    });

    it('should not show "(truncated)" in footer when not truncated', () => {
      // Arrange
      const article = makeArticle({
        tokenInfo: createTokenInfo({ truncated: false }),
      });

      // Act
      const output = formatArticleCompact(article);

      // Assert
      expect(output).not.toContain('(truncated)');
    });
  });

  // ── Content preview / truncation ────────────────────────────────────────────

  describe('content preview (summary-only compact mode)', () => {
    it('should truncate long content and show truncation notice', () => {
      // Arrange
      const article = makeArticle({ content: makeLongContent() });

      // Act
      const output = formatArticleCompact(article);

      // Assert — truncation notice present
      expect(output).toContain('Showing preview');
      expect(output).toContain('outputMode="full"');
      expect(output).toContain('section="<name>"');
    });

    it('should produce shorter output than full mode for a long article', () => {
      // Arrange
      const article = makeArticle({ content: makeLongContent() });

      // Act
      const compact = formatArticleCompact(article);
      const full = formatArticleFull(article);

      // Assert — compact should be noticeably smaller
      expect(compact.length).toBeLessThan(full.length);
    });

    it('should not show truncation notice when content fits in preview', () => {
      // Arrange — short content
      const article = makeArticle({ content: 'Short paragraph.' });

      // Act
      const output = formatArticleCompact(article);

      // Assert
      expect(output).not.toContain('Showing preview');
    });
  });

  // ── Sections list ───────────────────────────────────────────────────────────

  describe('available sections list', () => {
    it('should list available sections when the preview withheld content', () => {
      // Arrange
      const article = makeArticle({ content: makeLongContent(), sections: makeSections(3) });

      // Act
      const output = formatArticleCompact(article);

      // Assert
      expect(output).toContain('## Available Sections (3)');
      expect(output).toContain('Section 1');
      expect(output).toContain('Section 2');
      expect(output).toContain('Section 3');
    });

    it('should not show sections list when sections array is empty', () => {
      // Arrange
      const article = makeArticle({ content: makeLongContent(), sections: [] });

      // Act
      const output = formatArticleCompact(article);

      // Assert
      expect(output).not.toContain('Available Sections');
    });

    it('should cap sections list at 15 entries and show overflow count', () => {
      // Arrange
      const article = makeArticle({ content: makeLongContent(), sections: makeSections(20) });

      // Act
      const output = formatArticleCompact(article);

      // Assert
      expect(output).toContain('Section 15');
      expect(output).not.toContain('Section 16');
      expect(output).toContain('...and 5 more sections');
    });

    it('should omit the sections list when the whole article fits the preview', () => {
      // Arrange — the article is sent whole, so there is nothing left to fetch
      // by section and the list is pure overhead.
      const article = makeArticle({ content: 'Short body.', sections: makeSections(20) });

      // Act
      const output = formatArticleCompact(article);

      // Assert
      expect(output).not.toContain('Available Sections');
    });

    it('should not make compact output longer than full output for a short article', () => {
      // Arrange — regression: the unconditional sections list made compact
      // *bigger* than full whenever the body was short enough to send whole.
      const article = makeArticle({ content: 'Short body.', sections: makeSections(20) });

      // Act
      const compact = formatArticleCompact(article);
      const full = formatArticleFull(article, { sections: article.sections });

      // Assert
      expect(compact.length).toBeLessThan(full.length);
    });
  });

  // ── Footer token count ──────────────────────────────────────────────────────

  describe('footer token accounting', () => {
    it('should report the preview token count, not the whole article count', () => {
      // Arrange — the article claims 9999 tokens; only a preview is sent.
      const article = makeArticle({
        content: makeLongContent(),
        tokenInfo: createTokenInfo({ tokenCount: 9999, maxTokens: 50000, truncated: false }),
      });

      // Act
      const output = formatArticleCompact(article);

      // Assert — the article's own count must not be quoted for a partial send
      expect(output).not.toContain('9999 tokens');
      const match = /\| (\d+) tokens/.exec(output);
      expect(match).not.toBeNull();
      expect(Number(match?.[1])).toBeLessThan(9999);
    });

    it('should mark the footer truncated when only a preview was sent', () => {
      // Arrange — upstream did not truncate; the compact preview did
      const article = makeArticle({
        content: makeLongContent(),
        tokenInfo: createTokenInfo({ truncated: false }),
      });

      // Act
      const output = formatArticleCompact(article);

      // Assert
      expect(output).toContain('(truncated)');
    });
  });

  // ── Compact metadata edge cases ─────────────────────────────────────────────

  describe('compact metadata edge cases', () => {
    it('should omit product line when product is undefined', () => {
      // Arrange
      const article = makeArticle({ product: undefined, version: '11.0' });

      // Act
      const output = formatArticleCompact(article);

      // Assert — should have version only
      expect(output).toContain('*v11.0*');
      expect(output).not.toMatch(/\| v11\.0/);
    });

    it('should omit version from metadata line when version is undefined', () => {
      // Arrange
      const article = makeArticle({ product: 'Jamf Pro', version: undefined });

      // Act
      const output = formatArticleCompact(article);

      // Assert — product shown without version
      expect(output).toContain('*Jamf Pro*');
    });

    it('should omit metadata line entirely when both product and version are undefined', () => {
      // Arrange
      const article = makeArticle({ product: undefined, version: undefined });

      // Act
      const output = formatArticleCompact(article);

      // Assert — no metadata line before the content
      expect(output).not.toMatch(/\*[^\n]+\|\s*v/);
    });
  });

  // ── Layout order ─────────────────────────────────────────────────────────────

  describe('output layout order', () => {
    it('should place title before metadata before content before footer', () => {
      // Arrange
      const article = makeArticle({
        title: 'My Article',
        content: 'Article body.',
        product: 'Jamf Pro',
        version: '11.0',
      });

      // Act
      const output = formatArticleCompact(article);

      // Assert — check relative ordering
      const titlePos = output.indexOf('# My Article');
      const metaPos = output.indexOf('*Jamf Pro');
      const contentPos = output.indexOf('Article body.');
      const footerPos = output.indexOf('[Source]');

      expect(titlePos).toBeLessThan(metaPos);
      expect(metaPos).toBeLessThan(contentPos);
      expect(contentPos).toBeLessThan(footerPos);
    });
  });

  // ── URL sanitization ────────────────────────────────────────────────────────

  describe('URL sanitization', () => {
    it('should encode parentheses in URLs', () => {
      // Arrange
      const article = makeArticle({
        url: 'https://learn.jamf.com/bundle/jamf-pro/page/article(2).html',
      });

      // Act
      const output = formatArticleCompact(article);

      // Assert
      expect(output).toContain('%28');
      expect(output).toContain('%29');
    });
  });
});

// =============================================================================
// buildCompactArticleView / buildArticleContentView
// =============================================================================

describe('buildCompactArticleView()', () => {
  it('should carry a preview shorter than the article for a long body', () => {
    // Arrange
    const article = makeArticle({ content: makeLongContent() });

    // Act
    const view = buildCompactArticleView(article);

    // Assert
    expect(view.content.length).toBeLessThan(article.content.length);
    expect(view.truncated).toBe(true);
  });

  it('should report the token count of the preview it carries', () => {
    // Arrange
    const article = makeArticle({
      content: makeLongContent(),
      tokenInfo: createTokenInfo({ tokenCount: 9999, maxTokens: 50000 }),
    });

    // Act
    const view = buildCompactArticleView(article);

    // Assert — the count describes view.content, not the article
    expect(view.tokenCount).toBe(estimateTokens(view.content));
    expect(view.tokenCount).toBeLessThan(9999);
  });

  it('should charge the sections list against the preview budget', () => {
    // Arrange — same body, one with a long sections list that will accompany
    // the preview and one with none
    const content = makeParagraphedContent();
    const withSections = makeArticle({ content, sections: makeSections(15) });
    const withoutSections = makeArticle({ content, sections: [] });

    // Act
    const listed = buildCompactArticleView(withSections);
    const bare = buildCompactArticleView(withoutSections);

    // Assert — the sections list takes its share out of the content budget
    expect(listed.tokenCount).toBeLessThan(bare.tokenCount);
  });

  it('should carry the whole body and the pipeline token count when it fits', () => {
    // Arrange
    const article = makeArticle({
      content: 'Short body.',
      tokenInfo: createTokenInfo({ tokenCount: 42, truncated: false }),
    });

    // Act
    const view = buildCompactArticleView(article);

    // Assert
    expect(view.content).toBe('Short body.');
    expect(view.tokenCount).toBe(42);
    expect(view.truncated).toBe(false);
  });

  it('should stay truncated when upstream truncated even if the preview fits', () => {
    // Arrange
    const article = makeArticle({
      content: 'Short body.',
      tokenInfo: createTokenInfo({ truncated: true }),
    });

    // Act
    const view = buildCompactArticleView(article);

    // Assert
    expect(view.truncated).toBe(true);
  });
});

describe('buildArticleContentView()', () => {
  it('should return the whole body untouched when not compact', () => {
    // Arrange
    const article = makeArticle({
      content: makeLongContent(),
      tokenInfo: createTokenInfo({ tokenCount: 850, truncated: false }),
    });

    // Act
    const view = buildArticleContentView(article, false);

    // Assert
    expect(view.content).toBe(article.content);
    expect(view.tokenCount).toBe(850);
    expect(view.truncated).toBe(false);
  });

  it('should return a strictly smaller view when compact', () => {
    // Arrange
    const article = makeArticle({ content: makeLongContent() });

    // Act
    const compact = buildArticleContentView(article, true);
    const full = buildArticleContentView(article, false);

    // Assert
    expect(compact.content.length).toBeLessThan(full.content.length);
  });
});

// =============================================================================
// formatArticleFull — comprehensive with both articles together
// =============================================================================

describe('formatArticleFull() — comprehensive article with all options', () => {
  it('should produce well-structured output combining all optional features', () => {
    // Arrange
    const article = createFetchArticleResult({
      title: 'MDM Profile Settings',
      content: 'Full article content here.\n\n## Advanced\n\nAdvanced details.',
      url: 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/MDM.html',
      product: 'Jamf Pro',
      version: '11.0',
      tokenInfo: createTokenInfo({ tokenCount: 3000, truncated: true, maxTokens: 5000 }),
    });
    const sections = makeSections(5);
    const related = [
      { title: 'Smart Groups', url: 'https://learn.jamf.com/bundle/jamf-pro/page/Smart_Groups.html' },
    ];

    // Act
    const output = formatArticleFull(article, {
      breadcrumb: ['Jamf Pro', 'Configuration'],
      lastUpdated: '2025-01-01',
      sections,
      relatedArticles: related,
    });

    // Assert — all sections present in correct order
    expect(output).toContain('*Jamf Pro > Configuration*');
    expect(output).toContain('# MDM Profile Settings');
    expect(output).toContain('**Product**: Jamf Pro');
    expect(output).toContain('**Version**: 11.0');
    expect(output).toContain('**Last Updated**: 2025-01-01');
    expect(output).toContain('*(truncated)*');
    expect(output).toContain('Full article content here.');
    expect(output).toContain('## Available Sections');
    expect(output).toContain('## Related Articles');
    expect(output).toContain('Smart Groups');
    expect(output).toContain('*Source:');
    expect(output).toContain('truncated from original');
  });
});
