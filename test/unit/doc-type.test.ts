/**
 * Unit tests for docTypeFromLabels function
 */

import { describe, it, expect } from 'vitest';
import { docTypeFromLabels } from '../../src/utils/doc-type.js';

describe('docTypeFromLabels', () => {
  it('should return "documentation" for content-techdocs label', () => {
    expect(docTypeFromLabels([{ key: 'content-techdocs' }])).toBe('documentation');
  });

  it('should return "release-notes" for content-releasenotes label', () => {
    expect(docTypeFromLabels([{ key: 'content-releasenotes' }])).toBe('release-notes');
  });

  it('should return "training" for content-training label', () => {
    expect(docTypeFromLabels([{ key: 'content-training' }])).toBe('training');
  });

  it('should return "solution-guide" for content-solutionguide label', () => {
    expect(docTypeFromLabels([{ key: 'content-solutionguide' }])).toBe('solution-guide');
  });

  it('should return "glossary" for content-glossary label', () => {
    expect(docTypeFromLabels([{ key: 'content-glossary' }])).toBe('glossary');
  });

  it('should return "getting-started" for content-gettingstarted label', () => {
    expect(docTypeFromLabels([{ key: 'content-gettingstarted' }])).toBe('getting-started');
  });

  it('should return "documentation" for content-archive label (archive type removed)', () => {
    expect(docTypeFromLabels([{ key: 'content-archive' }])).toBe('documentation');
  });

  it('should use first content-* match when multiple labels present', () => {
    const labels = [
      { key: 'product-pro' },
      { key: 'content-releasenotes' },
      { key: 'content-techdocs' },
    ];
    expect(docTypeFromLabels(labels)).toBe('release-notes');
  });

  it('should skip non-content labels', () => {
    const labels = [
      { key: 'product-pro' },
      { key: 'product-pro-11.25.0' },
      { key: 'content-techdocs' },
    ];
    expect(docTypeFromLabels(labels)).toBe('documentation');
  });

  it('should return "documentation" for undefined labels', () => {
    expect(docTypeFromLabels(undefined)).toBe('documentation');
  });

  it('should return "documentation" for null labels', () => {
    expect(docTypeFromLabels(null)).toBe('documentation');
  });

  it('should return "documentation" for empty labels array', () => {
    expect(docTypeFromLabels([])).toBe('documentation');
  });

  it('should return "documentation" for unknown content-* label', () => {
    expect(docTypeFromLabels([{ key: 'content-unknown' }])).toBe('documentation');
  });

  it('should return "documentation" for labels with no content-* keys', () => {
    const labels = [
      { key: 'product-pro' },
      { key: 'product-pro-11.25.0' },
    ];
    expect(docTypeFromLabels(labels)).toBe('documentation');
  });
});
