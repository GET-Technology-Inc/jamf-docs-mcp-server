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
