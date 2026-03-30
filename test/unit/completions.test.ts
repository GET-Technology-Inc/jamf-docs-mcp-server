/**
 * Unit tests for completion utilities
 */

import { describe, it, expect } from 'vitest';
import { filterMatches, completeProduct, completeTopic, completeVersion } from '../../src/core/completions.js';

describe('filterMatches', () => {
  const values = ['jamf-pro', 'jamf-school', 'jamf-connect', 'jamf-protect'];

  it('should return all values for empty input', () => {
    expect(filterMatches(values, '')).toEqual(values);
  });

  it('should return prefix matches first', () => {
    const result = filterMatches(values, 'jamf-p');
    expect(result).toEqual(['jamf-pro', 'jamf-protect']);
  });

  it('should include substring matches after prefix matches', () => {
    const items = ['enrollment', 'user-enrollment', 'profiles'];
    const result = filterMatches(items, 'enroll');
    expect(result[0]).toBe('enrollment');
    expect(result[1]).toBe('user-enrollment');
    expect(result).not.toContain('profiles');
  });

  it('should return empty array when no matches', () => {
    expect(filterMatches(values, 'nonexistent')).toEqual([]);
  });

  it('should handle single character input', () => {
    const result = filterMatches(values, 'j');
    expect(result).toHaveLength(4);
  });

  it('should handle exact match with substring overlap', () => {
    const result = filterMatches(values, 'jamf-pro');
    expect(result[0]).toBe('jamf-pro');
    expect(result).toContain('jamf-protect');
    expect(result).not.toContain('jamf-school');
  });

  it('should not match when input has no match (no prefix, no substring)', () => {
    expect(filterMatches(values, 'xyz-nothing')).toEqual([]);
  });

  it('should be case-sensitive (startsWith is case-sensitive)', () => {
    expect(filterMatches(values, 'Jamf')).toEqual([]);
  });

  it('should be case-sensitive for substring match', () => {
    expect(filterMatches(values, 'SCHOOL')).toEqual([]);
  });

  it('should put prefix matches before substring matches', () => {
    const items = ['pro', 'jamf-pro', 'protect'];
    const result = filterMatches(items, 'pro');
    expect(result[0]).toBe('pro');
    expect(result[1]).toBe('protect');
    expect(result[2]).toBe('jamf-pro');
  });
});

describe('completeProduct', () => {
  it('should return all products for empty input', () => {
    const result = completeProduct('');
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain('jamf-pro');
    expect(result).toContain('jamf-school');
  });

  it('should return all products when value is undefined', () => {
    const result = completeProduct(undefined);
    expect(result.length).toBeGreaterThan(0);
  });

  it('should filter products by prefix', () => {
    const result = completeProduct('jamf-p');
    expect(result).toContain('jamf-pro');
    expect(result).toContain('jamf-protect');
    expect(result).not.toContain('jamf-school');
  });

  it('should return empty array for non-matching input', () => {
    const result = completeProduct('xyz-unknown');
    expect(result).toEqual([]);
  });
});

describe('completeTopic', () => {
  it('should return all topics for empty input', () => {
    const result = completeTopic('');
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain('enrollment');
  });

  it('should return all topics when value is undefined', () => {
    const result = completeTopic(undefined);
    expect(result.length).toBeGreaterThan(0);
  });

  it('should filter topics by prefix', () => {
    const result = completeTopic('enroll');
    expect(result).toContain('enrollment');
  });

  it('should return empty array for non-matching input', () => {
    const result = completeTopic('zzznonexistent');
    expect(result).toEqual([]);
  });
});

describe('completeVersion', () => {
  it('should return empty array when context has no product', () => {
    const result = completeVersion('11', undefined);
    expect(result).toEqual([]);
  });

  it('should return empty array when context.arguments has no product', () => {
    const result = completeVersion('11', { arguments: {} });
    expect(result).toEqual([]);
  });

  it('should return empty array for invalid (non-existent) product', () => {
    const result = completeVersion('11', { arguments: { product: 'jamf-unknown' } });
    expect(result).toEqual([]);
  });

  it('should return static versions for a valid product', () => {
    const result = completeVersion('', { arguments: { product: 'jamf-pro' } });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it('should filter versions by prefix when input given', () => {
    const result = completeVersion('cur', { arguments: { product: 'jamf-pro' } });
    expect(result).toContain('current');
  });

  it('should return all versions when value is empty string', () => {
    const result = completeVersion('', { arguments: { product: 'jamf-pro' } });
    expect(result.length).toBeGreaterThan(0);
  });

  it('should return all versions when value is undefined', () => {
    const result = completeVersion(undefined, { arguments: { product: 'jamf-protect' } });
    expect(result.length).toBeGreaterThan(0);
  });

  it('should return empty array when no match in versions list', () => {
    const result = completeVersion('99.99', { arguments: { product: 'jamf-pro' } });
    expect(result).toEqual([]);
  });
});
