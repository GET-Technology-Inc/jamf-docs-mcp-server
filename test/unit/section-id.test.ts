/**
 * Unit tests for slugify and section ID generation
 */

import { describe, it, expect } from 'vitest';
import { slugify, extractSections, extractSection } from '../../src/services/tokenizer.js';

describe('slugify', () => {
  it('should convert standard heading to lowercase slug', () => {
    expect(slugify('Managing Configuration Profiles')).toBe('managing-configuration-profiles');
  });

  it('should handle special characters', () => {
    expect(slugify('PSSO (Platform Single Sign-On) & Entra ID')).toBe('psso-platform-single-sign-on-entra-id');
  });

  it('should collapse consecutive hyphens', () => {
    expect(slugify('Hello --- World')).toBe('hello-world');
  });

  it('should trim leading and trailing hyphens', () => {
    expect(slugify('---Hello World---')).toBe('hello-world');
  });

  it('should return empty string for whitespace-only input', () => {
    expect(slugify('   ')).toBe('');
  });

  it('should return empty string for empty input', () => {
    expect(slugify('')).toBe('');
  });

  it('should handle numbers', () => {
    expect(slugify('Version 11.25.0 Release Notes')).toBe('version-11-25-0-release-notes');
  });

  it('should handle single word', () => {
    expect(slugify('Overview')).toBe('overview');
  });
});

describe('extractSections duplicate handling', () => {
  it('should generate unique IDs for duplicate headings', () => {
    const content = '## Overview\nFirst section\n## Details\nSome details\n## Overview\nSecond overview';
    const sections = extractSections(content);

    expect(sections).toHaveLength(3);
    expect(sections[0].id).toBe('overview');
    expect(sections[1].id).toBe('details');
    expect(sections[2].id).toBe('overview-1');
  });

  it('should handle three duplicate headings', () => {
    const content = '## Overview\nA\n## Overview\nB\n## Overview\nC';
    const sections = extractSections(content);

    expect(sections[0].id).toBe('overview');
    expect(sections[1].id).toBe('overview-1');
    expect(sections[2].id).toBe('overview-2');
  });

  it('should use section-N for empty headings', () => {
    const content = '##    \nSome content';
    const sections = extractSections(content);

    expect(sections).toHaveLength(1);
    expect(sections[0].id).toMatch(/^section-\d+$/);
  });
});

describe('extractSection ID and title matching', () => {
  const content = '## Managing Configuration Profiles\nProfile content here.\n\n## Prerequisites\nPrereq content here.';

  it('should match by generated slug ID', () => {
    const result = extractSection(content, 'managing-configuration-profiles');
    expect(result.section).not.toBeNull();
    expect(result.section!.title).toBe('Managing Configuration Profiles');
  });

  it('should match by title text (case-insensitive)', () => {
    const result = extractSection(content, 'prerequisites');
    expect(result.section).not.toBeNull();
    expect(result.section!.title).toBe('Prerequisites');
  });

  it('should return null section when no match', () => {
    const result = extractSection(content, 'nonexistent-section');
    expect(result.section).toBeNull();
  });
});
