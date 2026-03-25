/**
 * Unit tests for inferDocType function
 */

import { describe, it, expect } from 'vitest';
import { inferDocType } from '../../src/utils/doc-type.js';

describe('inferDocType', () => {
  it('should return "documentation" for standard product bundles', () => {
    expect(inferDocType('jamf-pro-documentation')).toBe('documentation');
    expect(inferDocType('jamf-pro-documentation-11.25.0')).toBe('documentation');
    expect(inferDocType('jamf-connect-documentation-current')).toBe('documentation');
    expect(inferDocType('jamf-school-documentation')).toBe('documentation');
  });

  it('should return "release-notes" for release notes bundles', () => {
    expect(inferDocType('jamf-pro-release-notes-11.25.0')).toBe('release-notes');
    expect(inferDocType('jamf-pro-release-notes-11.25.1')).toBe('release-notes');
    expect(inferDocType('jamf-connect-release-notes')).toBe('release-notes');
    expect(inferDocType('jamf-protect-release-notes')).toBe('release-notes');
    expect(inferDocType('jamf-school-release-notes')).toBe('release-notes');
  });

  it('should return "install-guide" for installation guide bundles', () => {
    expect(inferDocType('jamf-pro-install-guide-windows-11.25.0')).toBe('install-guide');
    expect(inferDocType('jamf-pro-install-guide-linux-11.25.0')).toBe('install-guide');
    expect(inferDocType('jamf-pro-install-guide-windows-current')).toBe('install-guide');
  });

  it('should return "technical-paper" for technical paper bundles', () => {
    expect(inferDocType('technical-paper-deploying-macos-upgrades-current')).toBe('technical-paper');
    expect(inferDocType('technical-paper-splunk-current')).toBe('technical-paper');
    expect(inferDocType('technical-paper-microsoft-intune-current')).toBe('technical-paper');
    expect(inferDocType('technical-paper-aws-verified-access')).toBe('technical-paper');
  });

  it('should return "configuration-guide" for config guide bundles', () => {
    expect(inferDocType('jamf-pro-blueprints-configuration-guide')).toBe('configuration-guide');
    expect(inferDocType('jamf-compliance-benchmarks-configuration-guide')).toBe('configuration-guide');
    expect(inferDocType('jamf-teacher-configuration-guide')).toBe('configuration-guide');
  });

  it('should return "training" for training content bundles', () => {
    expect(inferDocType('training-video-shorts-jamf-pro')).toBe('training');
    expect(inferDocType('training-video-shorts-jamf-school')).toBe('training');
    expect(inferDocType('jamf-100-course-current')).toBe('training');
    expect(inferDocType('jamf-170-course-current')).toBe('training');
  });

  it('should return "documentation" for unknown bundle patterns', () => {
    expect(inferDocType('unknown-bundle')).toBe('documentation');
    expect(inferDocType('')).toBe('documentation');
    expect(inferDocType('jamf-technical-glossary')).toBe('documentation');
  });
});
