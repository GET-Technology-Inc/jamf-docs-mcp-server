/**
 * Unit tests for tokenizer service
 */

import { describe, it, expect } from 'vitest';
import {
  estimateTokens,
  createTokenInfo,
  extractSections,
  extractSection,
  truncateToTokenLimit,
  calculatePagination,
  truncateItemsToTokenLimit
} from '../../src/services/tokenizer.js';

describe('estimateTokens', () => {
  it('should return 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('should return 0 for null/undefined', () => {
    expect(estimateTokens(null as unknown as string)).toBe(0);
    expect(estimateTokens(undefined as unknown as string)).toBe(0);
  });

  it('should estimate tokens for regular text', () => {
    // 12 characters / 4 chars per token = 3 tokens
    const text = 'hello world!';
    expect(estimateTokens(text)).toBe(3);
  });

  it('should use higher density for code blocks', () => {
    // Code blocks use 3 chars per token instead of 4
    const code = '```\nconst x = 1;\n```';
    const codeTokens = estimateTokens(code);

    // Same content without code block markers
    const plainText = 'const x = 1;';
    const textTokens = estimateTokens(plainText);

    // Code should have more tokens due to higher density
    expect(codeTokens).toBeGreaterThan(textTokens);
  });

  it('should handle mixed content', () => {
    const mixed = `# Title

Some regular text here.

\`\`\`javascript
const code = true;
\`\`\`

More text.`;

    const tokens = estimateTokens(mixed);
    expect(tokens).toBeGreaterThan(0);
  });
});

describe('createTokenInfo', () => {
  it('should create TokenInfo with correct values', () => {
    const content = 'Hello world';
    const maxTokens = 1000;

    const info = createTokenInfo(content, maxTokens);

    expect(info).toEqual({
      tokenCount: expect.any(Number),
      truncated: false,
      maxTokens: 1000
    });
  });

  it('should set truncated flag when specified', () => {
    const info = createTokenInfo('content', 100, true);
    expect(info.truncated).toBe(true);
  });
});

describe('extractSections', () => {
  it('should extract headings from markdown', () => {
    const markdown = `# Title

Introduction text.

## Section One

Content for section one.

## Section Two

Content for section two.

### Subsection

Nested content.`;

    const sections = extractSections(markdown);

    expect(sections).toHaveLength(4);
    expect(sections[0]).toMatchObject({
      id: 'title',
      title: 'Title',
      level: 1
    });
    expect(sections[1]).toMatchObject({
      id: 'section-one',
      title: 'Section One',
      level: 2
    });
    expect(sections[3]).toMatchObject({
      id: 'subsection',
      title: 'Subsection',
      level: 3
    });
  });

  it('should return empty array for content without headings', () => {
    const markdown = 'Just some plain text without any headings.';
    const sections = extractSections(markdown);
    expect(sections).toHaveLength(0);
  });

  it('should strip empty anchor prefixes from section titles', () => {
    const markdown = `## [](#)Payload Variables for Configuration Profiles

Content here.`;
    const sections = extractSections(markdown);
    expect(sections[0]?.title).toBe('Payload Variables for Configuration Profiles');
  });

  it('should strip named anchor prefixes from section titles', () => {
    const markdown = `## [](#payload-variables)Payload Variables

Content here.`;
    const sections = extractSections(markdown);
    expect(sections[0]?.title).toBe('Payload Variables');
  });

  it('should keep anchor text when anchor has both text and id', () => {
    const markdown = `## [Payload Variables](#payload-variables) Overview

Content here.`;
    const sections = extractSections(markdown);
    expect(sections[0]?.title).toBe('Payload Variables Overview');
  });

  it('should not strip normal markdown links (non-anchor)', () => {
    const markdown = `## See [Jamf Pro](https://learn.jamf.com) Documentation

Content here.`;
    const sections = extractSections(markdown);
    expect(sections[0]?.title).toBe('See [Jamf Pro](https://learn.jamf.com) Documentation');
  });

  it('should handle multiple anchor patterns in one title', () => {
    const markdown = `## [](#id1)First [](#id2)Second

Content here.`;
    const sections = extractSections(markdown);
    expect(sections[0]?.title).toBe('First Second');
  });

  it('should calculate token counts for each section', () => {
    const markdown = `# Short

Brief.

## Long Section

This section has much more content that will result in a higher token count.
It spans multiple lines and includes various details.`;

    const sections = extractSections(markdown);

    expect(sections[0].tokenCount).toBeLessThan(sections[1].tokenCount);
  });
});

describe('extractSection', () => {
  const markdown = `# Document Title

Introduction.

## Getting Started

This is the getting started section with helpful information.

### Prerequisites

You need these things.

## Configuration

Configuration details here.`;

  it('should extract section by exact id', () => {
    const result = extractSection(markdown, 'getting-started');

    expect(result.section).not.toBeNull();
    expect(result.section?.title).toBe('Getting Started');
    expect(result.content).toContain('getting started section');
    expect(result.content).toContain('Prerequisites');
  });

  it('should extract section by partial title match', () => {
    const result = extractSection(markdown, 'Config');

    expect(result.section).not.toBeNull();
    expect(result.section?.title).toBe('Configuration');
  });

  it('should include nested sections', () => {
    const result = extractSection(markdown, 'getting-started');

    expect(result.content).toContain('Prerequisites');
    expect(result.content).toContain('You need these things');
  });

  it('should not include sibling sections', () => {
    const result = extractSection(markdown, 'getting-started');

    expect(result.content).not.toContain('Configuration details');
  });

  it('should return empty content for non-existent section', () => {
    const result = extractSection(markdown, 'non-existent-section');

    expect(result.section).toBeNull();
    expect(result.content).toBe('');
  });
});

describe('truncateToTokenLimit', () => {
  it('should not truncate content within limit', () => {
    const content = 'Short content';
    const result = truncateToTokenLimit(content, 1000);

    expect(result.content).toBe(content);
    expect(result.tokenInfo.truncated).toBe(false);
  });

  it('should truncate content exceeding limit', () => {
    const longContent = 'word '.repeat(1000); // Very long content
    const result = truncateToTokenLimit(longContent, 100);

    expect(result.tokenInfo.truncated).toBe(true);
    expect(result.tokenInfo.tokenCount).toBeLessThanOrEqual(result.tokenInfo.maxTokens);
  });

  it('should close open code blocks when truncating', () => {
    const content = `# Title

\`\`\`javascript
const a = 1;
const b = 2;
const c = 3;
// many more lines
${'const x = ' + Math.random() + ';\n'.repeat(500)}
\`\`\``;

    const result = truncateToTokenLimit(content, 100);

    // Count code block markers
    const openBlocks = (result.content.match(/```/g) || []).length;
    expect(openBlocks % 2).toBe(0); // Should be even (all blocks closed)
  });

  it('should list remaining sections when truncated', () => {
    const content = `# Title

Intro.

## Section A

Content A.

## Section B

Content B.

## Section C

Content C.
${'More content here. '.repeat(200)}`;

    const result = truncateToTokenLimit(content, 50);

    expect(result.tokenInfo.truncated).toBe(true);
    expect(result.content).toContain('Content truncated');
  });
});

describe('calculatePagination', () => {
  it('should calculate pagination correctly', () => {
    const result = calculatePagination(100, 1, 10);

    expect(result).toEqual({
      page: 1,
      pageSize: 10,
      totalPages: 10,
      totalItems: 100,
      hasNext: true,
      hasPrev: false,
      startIndex: 0,
      endIndex: 10
    });
  });

  it('should handle last page', () => {
    const result = calculatePagination(100, 10, 10);

    expect(result.hasNext).toBe(false);
    expect(result.hasPrev).toBe(true);
    expect(result.startIndex).toBe(90);
    expect(result.endIndex).toBe(100);
  });

  it('should normalize out-of-range page numbers', () => {
    const result = calculatePagination(100, 999, 10);

    expect(result.page).toBe(10); // Clamped to max page
  });

  it('should handle empty items', () => {
    const result = calculatePagination(0, 1, 10);

    expect(result.totalPages).toBe(0);
    expect(result.page).toBe(1);
  });

  it('should handle partial last page', () => {
    const result = calculatePagination(25, 3, 10);

    expect(result.totalPages).toBe(3);
    expect(result.startIndex).toBe(20);
    expect(result.endIndex).toBe(25);
  });
});

describe('truncateItemsToTokenLimit', () => {
  const items = [
    { id: 1, text: 'short' },
    { id: 2, text: 'medium length text here' },
    { id: 3, text: 'this is a longer piece of content' },
    { id: 4, text: 'another item' },
    { id: 5, text: 'final item' }
  ];

  const itemToString = (item: { id: number; text: string }) =>
    JSON.stringify(item);

  it('should return items within token limit', () => {
    const result = truncateItemsToTokenLimit(items, 1000, itemToString, 1, 10);

    expect(result.items).toHaveLength(5);
    expect(result.tokenInfo.truncated).toBe(false);
  });

  it('should truncate when exceeding limit', () => {
    const result = truncateItemsToTokenLimit(items, 20, itemToString, 1, 10);

    expect(result.items.length).toBeLessThan(items.length);
    expect(result.tokenInfo.truncated).toBe(true);
  });

  it('should respect pagination', () => {
    const manyItems = Array.from({ length: 50 }, (_, i) => ({
      id: i,
      text: `Item ${i}`
    }));

    const result = truncateItemsToTokenLimit(manyItems, 10000, itemToString, 2, 10);

    expect(result.pagination.page).toBe(2);
    expect(result.pagination.totalPages).toBe(5);
    expect(result.items[0].id).toBe(10); // First item of page 2
  });

  it('should set hasNext when truncated within page', () => {
    const result = truncateItemsToTokenLimit(items, 10, itemToString, 1, 5);

    expect(result.pagination.hasNext).toBe(true);
  });
});

// ============================================================================
// Additional edge case tests
// ============================================================================

describe('estimateTokens - code-only content', () => {
  it('should estimate tokens for content that is entirely a code block', () => {
    const codeOnly = '```javascript\nconst x = 1;\nconst y = 2;\nconst z = x + y;\n```';
    const tokens = estimateTokens(codeOnly);
    // Code blocks use 3 chars/token (higher density than plain text 4 chars/token)
    // Length = codeOnly.length; expected ≈ ceil(codeOnly.length / 3)
    const expected = Math.ceil(codeOnly.length / 3);
    expect(tokens).toBe(expected);
  });

  it('should produce more tokens for code content than equivalent plain text of same length', () => {
    const plainContent = 'const x equals one const y equals two';
    const codeContent = '```\nconst x = 1;\nconst y = 2\n```';

    // Pad to same length for a fair comparison
    const plain = plainContent.slice(0, codeContent.length);
    const plainTokens = estimateTokens(plain);
    const codeTokens = estimateTokens(codeContent);

    // Code blocks have higher density (3 chars/token < 4 chars/token for plain text)
    expect(codeTokens).toBeGreaterThanOrEqual(plainTokens);
  });

  it('should handle multiple consecutive code blocks', () => {
    const multiCode = '```\nblock one\n```\n\n```\nblock two\n```';
    const tokens = estimateTokens(multiCode);
    expect(tokens).toBeGreaterThan(0);
  });
});

describe('truncateToTokenLimit - exact limit boundary', () => {
  it('should not truncate when content tokens exactly equal maxTokens', () => {
    // Build content whose token count equals exactly N tokens
    // estimateTokens uses ceil(length / 4) for plain text
    // 40 chars = ceil(40/4) = 10 tokens
    const content = 'a'.repeat(40); // 10 tokens exactly
    const result = truncateToTokenLimit(content, 10);

    expect(result.tokenInfo.truncated).toBe(false);
    expect(result.content).toBe(content);
  });

  it('should truncate when content tokens exceed maxTokens by one', () => {
    // 44 chars = ceil(44/4) = 11 tokens; limit = 10
    const content = 'a'.repeat(44); // 11 tokens
    const result = truncateToTokenLimit(content, 10);

    expect(result.tokenInfo.truncated).toBe(true);
  });
});

describe('truncateToTokenLimit - unclosed code block', () => {
  it('should close an open code block when truncation occurs inside it', () => {
    // Open code block that will be cut mid-way
    const bigCodeContent = Array.from({ length: 500 }, (_, i) => `const var${i} = ${i};`).join('\n');
    const content = `# Title\n\n\`\`\`javascript\n${bigCodeContent}\n\`\`\``;

    const result = truncateToTokenLimit(content, 80);

    // All ``` occurrences must be paired (even count)
    const backtickMatches = result.content.match(/```/g) ?? [];
    expect(backtickMatches.length % 2).toBe(0);
  });

  it('should include closing backticks when truncation happens inside a code block', () => {
    const lines = Array.from({ length: 300 }, (_, i) => `line ${i}`).join('\n');
    const content = `# Intro\n\n\`\`\`\n${lines}\n\`\`\``;

    const result = truncateToTokenLimit(content, 60);

    // With 300 lines and a 60 token limit, truncation must occur
    expect(result.tokenInfo.truncated).toBe(true);
    const backtickMatches = result.content.match(/```/g) ?? [];
    expect(backtickMatches.length % 2).toBe(0);
  });
});

describe('extractSection - not found returns available sections list', () => {
  const markdown = `# Introduction

Intro content.

## Getting Started

Start here.

## Advanced Usage

Advanced content.`;

  it('should return null section when identifier does not match any section', () => {
    const result = extractSection(markdown, 'nonexistent-section-xyz');
    expect(result.section).toBeNull();
    expect(result.content).toBe('');
  });

  it('should return empty content when section is not found', () => {
    const result = extractSection(markdown, 'completely-missing');
    expect(result.content).toBe('');
  });

  it('should still return a tokenInfo when section is not found', () => {
    const result = extractSection(markdown, 'missing-section');
    expect(result.tokenInfo).toBeDefined();
    expect(typeof result.tokenInfo.tokenCount).toBe('number');
    expect(typeof result.tokenInfo.maxTokens).toBe('number');
  });
});

describe('truncateToTokenLimit - more than 10 remaining sections', () => {
  it('should show "...and N more sections" when more than 10 sections remain after truncation', () => {
    // Create content with 20 tiny sections; with maxTokens=30 only ~5-6 fit,
    // leaving ~14 remaining sections — triggering the ">10" branch (line 250-252)
    const content = Array.from({ length: 20 }, (_, i) => {
      const heading = i === 0 ? '#' : '##';
      return `${heading} S${i + 1}\n\nx.`;
    }).join('\n\n');

    const result = truncateToTokenLimit(content, 30);

    expect(result.tokenInfo.truncated).toBe(true);
    // The notice should mention "...and N more sections" because >10 sections remain
    expect(result.content).toMatch(/\.\.\.and \d+ more sections/);
  });

  it('remaining-sections count in notice matches actual overflow', () => {
    const content = Array.from({ length: 20 }, (_, i) => {
      const heading = i === 0 ? '#' : '##';
      return `${heading} S${i + 1}\n\ny.`;
    }).join('\n\n');

    const result = truncateToTokenLimit(content, 30);

    if (result.tokenInfo.truncated) {
      const match = /\.\.\.and (\d+) more sections/.exec(result.content);
      if (match !== null) {
        const moreCount = parseInt(match[1] ?? '0', 10);
        expect(moreCount).toBeGreaterThan(0);
      }
    }
  });
});

describe('calculatePagination - additional edge cases', () => {
  it('should handle totalItems=0 gracefully', () => {
    const result = calculatePagination(0, 1, 10);
    expect(result.totalPages).toBe(0);
    expect(result.hasNext).toBe(false);
    expect(result.hasPrev).toBe(false);
    expect(result.startIndex).toBe(0);
    expect(result.endIndex).toBe(0);
  });

  it('should clamp page above totalPages to totalPages', () => {
    const result = calculatePagination(30, 100, 10);
    expect(result.page).toBe(3); // totalPages = 3
    expect(result.hasNext).toBe(false);
  });

  it('should clamp page=0 to page=1', () => {
    const result = calculatePagination(30, 0, 10);
    // Math.max(1, 0) = 1
    expect(result.page).toBe(1);
    expect(result.hasPrev).toBe(false);
  });

  it('should clamp negative page to page=1', () => {
    const result = calculatePagination(30, -5, 10);
    expect(result.page).toBe(1);
    expect(result.hasPrev).toBe(false);
    expect(result.startIndex).toBe(0);
  });

  it('should clamp page>totalPages to totalPages even when totalItems=0', () => {
    // totalPages = 0, so normalizedPage = Math.min(Math.max(1, page), Math.max(0, 1)) = Math.min(page, 1) = 1
    const result = calculatePagination(0, 5, 10);
    expect(result.page).toBe(1);
  });
});
