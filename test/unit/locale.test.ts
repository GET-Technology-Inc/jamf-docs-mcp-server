/**
 * Unit tests for locale/i18n support
 *
 * Ground truth: FluidTopics availableUiLocales config (verified 2026-03-29)
 * These locale codes are hardcoded here as the source of truth.
 * If a test fails, it means the code drifted from the official values.
 */

import { describe, it, expect } from 'vitest';
import {
  SUPPORTED_LOCALES,
  SUPPORTED_LOCALE_IDS,
  DEFAULT_LOCALE,
  buildDocUrl,
  buildUrlPattern,
} from '../../src/core/constants.js';
import { extractLocaleFromUrl } from '../../src/core/utils/url.js';
import { completeLanguage } from '../../src/core/completions.js';

// Ground truth from FluidTopics availableUiLocales + manual verification (2026-03-29)
// These 8 locales have actual documentation content accessible via the language switcher.
// availableContentLocales includes 3 more (it-IT, pt-BR, zh-CN) but they have no content.
const OFFICIAL_LOCALES: Record<string, string> = {
  'en-US': 'English',
  'ja-JP': '日本語',
  'zh-TW': '繁體中文',
  'de-DE': 'Deutsch',
  'es-ES': 'Español',
  'fr-FR': 'Français',
  'nl-NL': 'Nederlands',
  'th-TH': 'ไทย',
};
const OFFICIAL_LOCALE_CODES = Object.keys(OFFICIAL_LOCALES);

describe('SUPPORTED_LOCALES', () => {
  it('should default to en-US', () => {
    expect(DEFAULT_LOCALE).toBe('en-US');
  });

  it('should contain exactly the 8 official Jamf locales', () => {
    expect(SUPPORTED_LOCALE_IDS).toEqual(OFFICIAL_LOCALE_CODES);
  });

  it('should have correct display names matching official values', () => {
    for (const [code, name] of Object.entries(OFFICIAL_LOCALES)) {
      expect(SUPPORTED_LOCALES[code as keyof typeof SUPPORTED_LOCALES].name).toBe(name);
    }
  });
});

describe('buildDocUrl', () => {
  it('should build URL with en-US locale', () => {
    expect(buildDocUrl('en-US', 'jamf-pro-documentation', 'Overview.html'))
      .toBe('https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/Overview.html');
  });

  it('should build URL with ja-JP locale', () => {
    expect(buildDocUrl('ja-JP', 'jamf-pro-documentation', 'Overview.html'))
      .toBe('https://learn.jamf.com/ja-JP/bundle/jamf-pro-documentation/page/Overview.html');
  });

  it('should build URL with zh-TW locale', () => {
    expect(buildDocUrl('zh-TW', 'jamf-pro-documentation', 'Overview.html'))
      .toBe('https://learn.jamf.com/zh-TW/bundle/jamf-pro-documentation/page/Overview.html');
  });

  it('should build URL with th-TH locale', () => {
    expect(buildDocUrl('th-TH', 'jamf-pro-documentation', 'Overview.html'))
      .toBe('https://learn.jamf.com/th-TH/bundle/jamf-pro-documentation/page/Overview.html');
  });
});

describe('buildUrlPattern', () => {
  it('should build pattern with locale prefix', () => {
    expect(buildUrlPattern('ja-JP', 'jamf-pro-documentation'))
      .toBe('ja-JP/bundle/jamf-pro-documentation/page');
  });

  it('should build pattern with default locale', () => {
    expect(buildUrlPattern('en-US', 'jamf-pro-documentation'))
      .toBe('en-US/bundle/jamf-pro-documentation/page');
  });
});

describe('extractLocaleFromUrl', () => {
  it('should extract each official locale from its URL', () => {
    for (const code of OFFICIAL_LOCALE_CODES) {
      const url = `https://learn.jamf.com/${code}/bundle/jamf-pro-documentation/page/Overview.html`;
      expect(extractLocaleFromUrl(url)).toBe(code);
    }
  });

  it('should return en-US for unsupported locale in URL', () => {
    expect(extractLocaleFromUrl(
      'https://learn.jamf.com/ko-KR/bundle/jamf-pro-documentation/page/Overview.html'
    )).toBe('en-US');
  });

  it('should return en-US for invalid URL', () => {
    expect(extractLocaleFromUrl('not-a-url')).toBe('en-US');
  });

  it('should return en-US for URL without path', () => {
    expect(extractLocaleFromUrl('https://learn.jamf.com')).toBe('en-US');
  });
});

describe('completeLanguage', () => {
  it('should return all 8 official locales for empty input', () => {
    expect(completeLanguage('')).toEqual(OFFICIAL_LOCALE_CODES);
  });

  it('should return all 8 official locales for undefined input', () => {
    expect(completeLanguage(undefined)).toEqual(OFFICIAL_LOCALE_CODES);
  });

  it('should filter by prefix "zh"', () => {
    expect(completeLanguage('zh')).toEqual(['zh-TW']);
  });

  it('should filter by prefix "ja"', () => {
    expect(completeLanguage('ja')).toEqual(['ja-JP']);
  });

  it('should filter by prefix "th"', () => {
    expect(completeLanguage('th')).toEqual(['th-TH']);
  });

  it('should return empty array for non-matching input', () => {
    expect(completeLanguage('xx')).toEqual([]);
  });
});
