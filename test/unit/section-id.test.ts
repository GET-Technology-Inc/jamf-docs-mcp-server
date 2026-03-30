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

  it('should preserve Unicode characters (CJK)', () => {
    expect(slugify('API ロールを作成する')).toBe('api-ロールを作成する');
  });

  it('should preserve Unicode characters (Korean)', () => {
    expect(slugify('설정 프로필 관리')).toBe('설정-프로필-관리');
  });

  it('should preserve Unicode characters (accented Latin)', () => {
    expect(slugify('Configuración de Perfiles')).toBe('configuración-de-perfiles');
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

describe('extractSection duplicate-aware ID matching', () => {
  const jaContent = [
    '## API ロールを作成する',
    'ロール作成の手順',
    '## API クライアントを作成する',
    'クライアント作成の手順',
    '## API ロールを編集する',
    '編集の手順'
  ].join('\n');

  it('should find all sections by IDs from extractSections', () => {
    const sections = extractSections(jaContent);
    for (const s of sections) {
      const result = extractSection(jaContent, s.id);
      expect(result.section).not.toBeNull();
      expect(result.section!.title).toBe(s.title);
    }
  });

  it('should handle ASCII duplicate IDs', () => {
    const content = '## Overview\nFirst\n## Details\nMiddle\n## Overview\nSecond';
    const sections = extractSections(content);
    expect(sections[2].id).toBe('overview-1');

    const result = extractSection(content, 'overview-1');
    expect(result.section).not.toBeNull();
    expect(result.section!.title).toBe('Overview');
    expect(result.content).toContain('Second');
  });

  it('should handle title cleaning consistently with extractSections', () => {
    const content = '## [Prerequisites](#prereq)\nSome prereq content\n## [Setup](#setup)\nSetup content';
    const sections = extractSections(content);
    expect(sections[0].id).toBe('prerequisites');

    const result = extractSection(content, 'prerequisites');
    expect(result.section).not.toBeNull();
    expect(result.section!.title).toBe('Prerequisites');
  });
});

describe('extractSection title-match guardrails', () => {
  const content = [
    '## API ロールとクライアント',
    'Introduction content.',
    '## API ロールを作成する',
    'Creating API roles.',
    '## Prerequisites',
    'Prereq content.'
  ].join('\n');

  it('should NOT match single-char substring like "a"', () => {
    const result = extractSection(content, 'a');
    expect(result.section).toBeNull();
  });

  it('should NOT match single CJK char like "の"', () => {
    const result = extractSection(content, 'の');
    expect(result.section).toBeNull();
  });

  it('should NOT match 2-char substring like "AP"', () => {
    const result = extractSection(content, 'AP');
    expect(result.section).toBeNull();
  });

  it('should NOT match short substring that covers small portion of title', () => {
    const result = extractSection(content, 'API');
    expect(result.section).toBeNull();
  });

  it('should match substantial title substring', () => {
    const result = extractSection(content, 'Prerequisites');
    expect(result.section).not.toBeNull();
    expect(result.section!.title).toBe('Prerequisites');
  });

  it('should match significant portion of Japanese title', () => {
    const result = extractSection(content, 'ロールを作成する');
    expect(result.section).not.toBeNull();
    expect(result.section!.title).toBe('API ロールを作成する');
  });

  it('should always match by exact slug ID regardless of length', () => {
    const sections = extractSections(content);
    for (const s of sections) {
      const result = extractSection(content, s.id);
      expect(result.section).not.toBeNull();
    }
  });
});
