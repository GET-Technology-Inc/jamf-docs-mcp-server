/**
 * Unit tests for bundle utilities
 */

import { describe, it, expect } from 'vitest';
import { extractVersionFromBundleId, extractProductSlug, compareVersions } from '../../../src/core/utils/bundle.js';

describe('extractVersionFromBundleId', () => {
  it('should extract version from standard documentation bundle', () => {
    expect(extractVersionFromBundleId('jamf-pro-documentation-11.25.0')).toBe('11.25.0');
  });

  it('should extract version from release notes bundle', () => {
    expect(extractVersionFromBundleId('jamf-pro-release-notes-11.25.1')).toBe('11.25.1');
  });

  it('should extract version 0.0.0', () => {
    expect(extractVersionFromBundleId('some-bundle-0.0.0')).toBe('0.0.0');
  });

  it('should return null for bundle without version suffix', () => {
    expect(extractVersionFromBundleId('jamf-pro-documentation')).toBeNull();
  });

  it('should return null for bundle with "current" suffix', () => {
    expect(extractVersionFromBundleId('jamf-pro-documentation-current')).toBeNull();
  });

  it('should return null for empty string', () => {
    expect(extractVersionFromBundleId('')).toBeNull();
  });

  it('should only match trailing semver (not mid-string)', () => {
    expect(extractVersionFromBundleId('jamf-pro-1.0.0-extra')).toBeNull();
  });
});

describe('extractProductSlug', () => {
  it('should extract product from documentation bundle', () => {
    expect(extractProductSlug('jamf-pro-documentation')).toBe('jamf-pro');
  });

  it('should extract product from versioned documentation bundle', () => {
    expect(extractProductSlug('jamf-pro-documentation-11.25.0')).toBe('jamf-pro');
  });

  it('should extract product from release notes bundle', () => {
    expect(extractProductSlug('jamf-pro-release-notes-11.25.0')).toBe('jamf-pro');
  });

  it('should distinguish jamf-protect from jamf-pro', () => {
    expect(extractProductSlug('jamf-protect-documentation')).toBe('jamf-protect');
  });

  it('should match multi-hyphenated product IDs', () => {
    expect(extractProductSlug('jamf-safe-internet-documentation')).toBe('jamf-safe-internet');
  });

  it('should match jamf-app-catalog (no -documentation suffix)', () => {
    expect(extractProductSlug('jamf-app-catalog')).toBe('jamf-app-catalog');
  });

  it('should match self-service-plus', () => {
    expect(extractProductSlug('self-service-plus-documentation')).toBe('self-service-plus');
  });

  it('should return null for unknown bundle', () => {
    expect(extractProductSlug('unknown-product-documentation')).toBeNull();
  });

  it('should return null for empty string', () => {
    expect(extractProductSlug('')).toBeNull();
  });
});

describe('compareVersions', () => {
  it('should return 0 for equal versions', () => {
    expect(compareVersions('11.25.0', '11.25.0')).toBe(0);
  });

  it('should compare major versions', () => {
    expect(compareVersions('12.0.0', '11.0.0')).toBeGreaterThan(0);
  });

  it('should compare minor versions', () => {
    expect(compareVersions('11.25.0', '11.0.0')).toBeGreaterThan(0);
  });

  it('should compare patch versions', () => {
    expect(compareVersions('11.25.1', '11.25.0')).toBeGreaterThan(0);
  });

  it('should treat "current" as maximum', () => {
    expect(compareVersions('current', '99.99.99')).toBeGreaterThan(0);
    expect(compareVersions('11.0.0', 'current')).toBeLessThan(0);
  });

  it('should return 0 for both "current"', () => {
    expect(compareVersions('current', 'current')).toBe(0);
  });

  it('should handle different length versions', () => {
    expect(compareVersions('11.25', '11.25.0')).toBe(0);
  });

  it('should handle negative comparison', () => {
    expect(compareVersions('11.0.0', '11.25.0')).toBeLessThan(0);
  });
});
