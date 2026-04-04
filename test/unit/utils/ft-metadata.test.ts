/**
 * Unit tests for ft-metadata utilities
 */

import { describe, it, expect } from 'vitest';
import {
  getMetaValue,
  getMetaValues,
  bundleStemToDisplayName,
} from '../../../src/core/utils/ft-metadata.js';
import type { FtMetadataEntry } from '../../../src/core/types.js';

// ─── Helpers ────────────────────────────────────────────────────

function makeMeta(entries: Record<string, string[]>): FtMetadataEntry[] {
  return Object.entries(entries).map(([key, values]) => ({
    key,
    label: key,
    values,
  }));
}

// ============================================================================
// getMetaValue()
// ============================================================================

describe('getMetaValue()', () => {
  it('should return the first value for a matching key', () => {
    const metadata = makeMeta({ 'ft:locale': ['en-US', 'en-GB'] });
    expect(getMetaValue(metadata, 'ft:locale')).toBe('en-US');
  });

  it('should return empty string when key is not present', () => {
    const metadata = makeMeta({ 'version': ['11.0'] });
    expect(getMetaValue(metadata, 'ft:locale')).toBe('');
  });

  it('should return empty string when metadata array is empty', () => {
    expect(getMetaValue([], 'ft:locale')).toBe('');
  });

  it('should return empty string when the entry has an empty values array', () => {
    const metadata: FtMetadataEntry[] = [{ key: 'ft:locale', label: 'ft:locale', values: [] }];
    expect(getMetaValue(metadata, 'ft:locale')).toBe('');
  });

  it('should return the correct value when multiple keys exist', () => {
    const metadata = makeMeta({
      'version': ['11.26.0'],
      'ft:locale': ['en-US'],
      'bundle': ['jamf-pro-documentation-current'],
    });
    expect(getMetaValue(metadata, 'version')).toBe('11.26.0');
    expect(getMetaValue(metadata, 'bundle')).toBe('jamf-pro-documentation-current');
  });
});

// ============================================================================
// getMetaValues()
// ============================================================================

describe('getMetaValues()', () => {
  it('should return all values for a matching key', () => {
    const metadata = makeMeta({
      'bundle': ['jamf-pro-documentation-current', 'jamf-pro-documentation-11.26.0'],
    });
    expect(getMetaValues(metadata, 'bundle')).toEqual([
      'jamf-pro-documentation-current',
      'jamf-pro-documentation-11.26.0',
    ]);
  });

  it('should return empty array when key is not present', () => {
    const metadata = makeMeta({ 'version': ['11.0'] });
    expect(getMetaValues(metadata, 'bundle')).toEqual([]);
  });

  it('should return empty array when metadata array is empty', () => {
    expect(getMetaValues([], 'bundle')).toEqual([]);
  });

  it('should return empty array when entry has empty values', () => {
    const metadata: FtMetadataEntry[] = [{ key: 'bundle', label: 'bundle', values: [] }];
    expect(getMetaValues(metadata, 'bundle')).toEqual([]);
  });

  it('should return a single-element array for single value', () => {
    const metadata = makeMeta({ 'ft:locale': ['en-US'] });
    expect(getMetaValues(metadata, 'ft:locale')).toEqual(['en-US']);
  });
});

// ============================================================================
// bundleStemToDisplayName()
// ============================================================================

describe('bundleStemToDisplayName()', () => {
  it('should capitalize a single-word stem', () => {
    expect(bundleStemToDisplayName('jamf')).toBe('Jamf');
  });

  it('should capitalize each word in a multi-word stem', () => {
    expect(bundleStemToDisplayName('jamf-pro')).toBe('Jamf Pro');
  });

  it('should strip the -documentation suffix before formatting', () => {
    expect(bundleStemToDisplayName('jamf-pro-documentation')).toBe('Jamf Pro');
  });

  it('should strip -documentation suffix from a longer stem', () => {
    expect(bundleStemToDisplayName('jamf-connect-documentation')).toBe('Jamf Connect');
  });

  it('should strip -documentation suffix from jamf-school-documentation', () => {
    expect(bundleStemToDisplayName('jamf-school-documentation')).toBe('Jamf School');
  });

  it('should not strip -documentation from the middle of a stem', () => {
    // "documentation" only stripped at end
    expect(bundleStemToDisplayName('documentation-guide')).toBe('Documentation Guide');
  });

  it('should handle a stem with many words', () => {
    expect(bundleStemToDisplayName('jamf-pro-security-guide')).toBe('Jamf Pro Security Guide');
  });

  it('should handle a stem that is already all lowercase', () => {
    expect(bundleStemToDisplayName('protect')).toBe('Protect');
  });

  it('should handle a stem that ends with -documentation after multi-word prefix', () => {
    expect(bundleStemToDisplayName('jamf-protect-documentation')).toBe('Jamf Protect');
  });
});
