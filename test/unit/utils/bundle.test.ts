/**
 * Unit tests for extractVersionFromBundleId
 */

import { describe, it, expect } from 'vitest';
import { extractVersionFromBundleId } from '../../../src/utils/bundle.js';

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
