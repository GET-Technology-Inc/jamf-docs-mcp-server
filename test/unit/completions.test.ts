/**
 * Unit tests for completion utilities
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { filterMatches, completeProduct, completeTopic, completeVersion } from '../../src/completions.js';

// Mock the metadata service to avoid real network calls
vi.mock('../../src/services/metadata.js', () => ({
  getAvailableVersions: vi.fn(),
}));

import { getAvailableVersions } from '../../src/services/metadata.js';

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
    // 'Jamf-pro' does not match 'jamf-pro' because startsWith is case-sensitive
    expect(filterMatches(values, 'Jamf')).toEqual([]);
  });

  it('should be case-sensitive for substring match', () => {
    // 'SCHOOL' does not match 'jamf-school' because includes is case-sensitive
    expect(filterMatches(values, 'SCHOOL')).toEqual([]);
  });

  it('should put prefix matches before substring matches', () => {
    const items = ['pro', 'jamf-pro', 'protect'];
    // 'pro' and 'protect' start with 'pro'; 'jamf-pro' contains 'pro' but doesn't start with it
    const result = filterMatches(items, 'pro');
    expect(result[0]).toBe('pro');
    expect(result[1]).toBe('protect');
    expect(result[2]).toBe('jamf-pro');
  });
});

describe('completeProduct', () => {
  it('should return all products for empty input', async () => {
    const result = await completeProduct('');
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain('jamf-pro');
    expect(result).toContain('jamf-school');
  });

  it('should return all products when value is undefined', async () => {
    const result = await completeProduct(undefined);
    expect(result.length).toBeGreaterThan(0);
  });

  it('should filter products by prefix', async () => {
    const result = await completeProduct('jamf-p');
    expect(result).toContain('jamf-pro');
    expect(result).toContain('jamf-protect');
    expect(result).not.toContain('jamf-school');
  });

  it('should return empty array for non-matching input', async () => {
    const result = await completeProduct('xyz-unknown');
    expect(result).toEqual([]);
  });
});

describe('completeTopic', () => {
  it('should return all topics for empty input', async () => {
    const result = await completeTopic('');
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain('enrollment');
  });

  it('should return all topics when value is undefined', async () => {
    const result = await completeTopic(undefined);
    expect(result.length).toBeGreaterThan(0);
  });

  it('should filter topics by prefix', async () => {
    const result = await completeTopic('enroll');
    expect(result).toContain('enrollment');
  });

  it('should return empty array for non-matching input', async () => {
    const result = await completeTopic('zzznonexistent');
    expect(result).toEqual([]);
  });
});

describe('completeVersion', () => {
  beforeEach(() => {
    vi.mocked(getAvailableVersions).mockReset();
  });

  it('should return empty array when context has no product', async () => {
    const result = await completeVersion('11', undefined);
    expect(result).toEqual([]);
  });

  it('should return empty array when context.arguments has no product', async () => {
    const result = await completeVersion('11', { arguments: {} });
    expect(result).toEqual([]);
  });

  it('should return empty array for invalid (non-existent) product', async () => {
    const result = await completeVersion('11', { arguments: { product: 'jamf-unknown' } });
    expect(result).toEqual([]);
    // getAvailableVersions should not be called for an invalid product
    expect(getAvailableVersions).not.toHaveBeenCalled();
  });

  it('should call getAvailableVersions with valid product in context', async () => {
    vi.mocked(getAvailableVersions).mockResolvedValue(['11.5.0', '11.4.0', '11.3.0']);
    const result = await completeVersion('', { arguments: { product: 'jamf-pro' } });
    expect(getAvailableVersions).toHaveBeenCalledWith('jamf-pro');
    expect(result).toEqual(['11.5.0', '11.4.0', '11.3.0']);
  });

  it('should filter versions by prefix when input given', async () => {
    vi.mocked(getAvailableVersions).mockResolvedValue(['11.5.0', '11.4.0', '10.50.0']);
    const result = await completeVersion('11', { arguments: { product: 'jamf-pro' } });
    expect(result).toContain('11.5.0');
    expect(result).toContain('11.4.0');
    expect(result).not.toContain('10.50.0');
  });

  it('should return all versions when value is empty string', async () => {
    vi.mocked(getAvailableVersions).mockResolvedValue(['11.5.0', '11.4.0']);
    const result = await completeVersion('', { arguments: { product: 'jamf-pro' } });
    expect(result).toEqual(['11.5.0', '11.4.0']);
  });

  it('should return all versions when value is undefined', async () => {
    vi.mocked(getAvailableVersions).mockResolvedValue(['11.5.0', '11.4.0']);
    const result = await completeVersion(undefined, { arguments: { product: 'jamf-protect' } });
    expect(result).toEqual(['11.5.0', '11.4.0']);
  });

  it('should return empty array when getAvailableVersions returns empty array', async () => {
    vi.mocked(getAvailableVersions).mockResolvedValue([]);
    const result = await completeVersion('11', { arguments: { product: 'jamf-school' } });
    expect(result).toEqual([]);
  });

  it('should return empty array when no match in versions list', async () => {
    vi.mocked(getAvailableVersions).mockResolvedValue(['11.5.0', '11.4.0']);
    const result = await completeVersion('99', { arguments: { product: 'jamf-pro' } });
    expect(result).toEqual([]);
  });
});
