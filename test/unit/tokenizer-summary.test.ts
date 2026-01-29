/**
 * Unit tests for tokenizer extractSummary function
 */

import { describe, it, expect } from 'vitest';
import { extractSummary } from '../../src/services/tokenizer.js';

describe('extractSummary', () => {
  const sampleMarkdown = `# Configuration Profiles

Configuration profiles are XML files that contain settings for managing devices.
They provide a way to configure devices without user interaction.

## Overview

Configuration profiles can be distributed through various methods.

## Creating a Profile

To create a profile, follow these steps:

1. Open Jamf Pro
2. Navigate to Configuration Profiles
3. Click New

### Profile Settings

Configure the profile settings as needed.

## Deploying Profiles

Deploy profiles to devices using policies or scoping.`;

  describe('summary extraction', () => {
    it('should extract the first paragraph as summary', () => {
      const result = extractSummary(sampleMarkdown, 'Configuration Profiles');
      expect(result.summary).toContain('Configuration profiles are XML files');
    });

    it('should not include headings in summary', () => {
      const result = extractSummary(sampleMarkdown, 'Configuration Profiles');
      expect(result.summary).not.toContain('# ');
      expect(result.summary).not.toContain('## ');
    });

    it('should handle content starting with heading', () => {
      const markdown = `# Title

First paragraph here.

## Section

Content.`;
      const result = extractSummary(markdown, 'Title');
      expect(result.summary).toBe('First paragraph here.');
    });

    it('should handle content with no clear paragraphs', () => {
      const markdown = `# Title

- List item 1
- List item 2
- List item 3`;
      const result = extractSummary(markdown, 'Title');
      // Should fall back to first 200 chars of plain text
      expect(result.summary.length).toBeGreaterThan(0);
    });

    it('should skip code blocks when extracting summary', () => {
      const markdown = `# Code Example

\`\`\`javascript
const x = 1;
\`\`\`

This is the actual summary paragraph.`;
      const result = extractSummary(markdown, 'Code Example');
      expect(result.summary).toBe('This is the actual summary paragraph.');
    });
  });

  describe('outline generation', () => {
    it('should extract all sections', () => {
      const result = extractSummary(sampleMarkdown, 'Configuration Profiles');
      expect(result.outline.length).toBeGreaterThan(0);
    });

    it('should include section titles', () => {
      const result = extractSummary(sampleMarkdown, 'Configuration Profiles');
      const titles = result.outline.map(s => s.title);
      expect(titles).toContain('Configuration Profiles');
      expect(titles).toContain('Overview');
      expect(titles).toContain('Creating a Profile');
    });

    it('should include section levels', () => {
      const result = extractSummary(sampleMarkdown, 'Configuration Profiles');
      const h1Sections = result.outline.filter(s => s.level === 1);
      const h2Sections = result.outline.filter(s => s.level === 2);
      const h3Sections = result.outline.filter(s => s.level === 3);

      expect(h1Sections.length).toBe(1);
      expect(h2Sections.length).toBeGreaterThan(0);
      expect(h3Sections.length).toBeGreaterThan(0);
    });

    it('should estimate token counts for sections', () => {
      const result = extractSummary(sampleMarkdown, 'Configuration Profiles');

      for (const section of result.outline) {
        expect(section.tokenCount).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('metadata', () => {
    it('should include title', () => {
      const result = extractSummary(sampleMarkdown, 'My Title');
      expect(result.title).toBe('My Title');
    });

    it('should calculate total tokens', () => {
      const result = extractSummary(sampleMarkdown, 'Title');
      expect(result.totalTokens).toBeGreaterThan(0);
    });

    it('should estimate read time', () => {
      const result = extractSummary(sampleMarkdown, 'Title');
      expect(result.estimatedReadTime).toBeGreaterThanOrEqual(1);
    });

    it('should provide token info', () => {
      const result = extractSummary(sampleMarkdown, 'Title', 5000);
      expect(result.tokenInfo).toBeDefined();
      expect(result.tokenInfo.maxTokens).toBe(5000);
      expect(result.tokenInfo.truncated).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle empty content', () => {
      const result = extractSummary('', 'Empty');
      expect(result.summary).toBe('');
      expect(result.outline).toHaveLength(0);
    });

    it('should handle content with only headings', () => {
      const markdown = `# Title

## Section 1

## Section 2`;
      const result = extractSummary(markdown, 'Title');
      expect(result.outline.length).toBe(3);
    });

    it('should handle very long first paragraphs', () => {
      const longParagraph = 'Word '.repeat(500);
      const markdown = `# Title

${longParagraph}

## Next Section`;
      const result = extractSummary(markdown, 'Title');
      expect(result.summary.length).toBeGreaterThan(0);
    });
  });
});
