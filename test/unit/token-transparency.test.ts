/**
 * Unit tests for token transparency features
 */

import { describe, it, expect } from 'vitest';
import { truncateToTokenLimit } from '../../src/services/tokenizer.js';
import { TOKEN_CONFIG } from '../../src/constants.js';

describe('truncateToTokenLimit transparency', () => {
  it('should return remainingSections when content is truncated', () => {
    // Create content with multiple sections that exceeds a low token limit
    const content = '## Section One\n' + 'A'.repeat(200) + '\n## Section Two\n' + 'B'.repeat(200) + '\n## Section Three\n' + 'C'.repeat(200);

    const result = truncateToTokenLimit(content, 100);

    expect(result.tokenInfo.truncated).toBe(true);
    expect(result.remainingSections).toBeDefined();
    expect(result.remainingSections!.length).toBeGreaterThan(0);
    // Each remaining section should have title and tokenCount
    for (const section of result.remainingSections!) {
      expect(section.title).toBeDefined();
      expect(typeof section.tokenCount).toBe('number');
    }
  });

  it('should NOT have remainingSections when content fits', () => {
    const content = '## Short Section\nBrief content.';
    const result = truncateToTokenLimit(content, 50000);

    expect(result.tokenInfo.truncated).toBe(false);
    expect(result.remainingSections).toBeUndefined();
  });

  it('should include truncation notice in content when truncated', () => {
    const content = '## Section One\n' + 'A'.repeat(400) + '\n## Section Two\n' + 'B'.repeat(400);
    const result = truncateToTokenLimit(content, 100);

    expect(result.content).toContain('Content truncated due to token limit');
  });
});

describe('maxTokens limit', () => {
  it('should accept tokens up to 50000', () => {
    expect(TOKEN_CONFIG.MAX_TOKENS_LIMIT).toBe(50000);
  });
});
