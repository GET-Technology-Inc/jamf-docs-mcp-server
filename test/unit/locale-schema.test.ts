/**
 * Unit tests for language parameter validation in schemas
 *
 * Ground truth: FluidTopics availableUiLocales config (verified 2026-03-29)
 */

import { describe, it, expect } from 'vitest';
import {
  SearchInputSchema,
  GetArticleInputSchema,
  GetTocInputSchema
} from '../../src/core/schemas/index.js';

// Ground truth from FluidTopics availableUiLocales + manual verification (2026-03-29)
const OFFICIAL_LOCALE_CODES = [
  'en-US', 'ja-JP', 'zh-TW', 'de-DE', 'es-ES', 'fr-FR', 'nl-NL', 'th-TH'
];

const VALID_URL = 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/Overview.html';

describe('SearchInputSchema language field', () => {
  it('should accept all official locale codes', () => {
    for (const locale of OFFICIAL_LOCALE_CODES) {
      const result = SearchInputSchema.safeParse({ query: 'test', language: locale });
      expect(result.success, `locale ${locale} should be accepted`).toBe(true);
    }
  });

  it('should accept omitted language (optional)', () => {
    const result = SearchInputSchema.safeParse({ query: 'enrollment' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.language).toBeUndefined();
    }
  });

  it('should reject locale without country code', () => {
    for (const short of ['ja', 'de', 'fr', 'es', 'nl', 'th']) {
      const result = SearchInputSchema.safeParse({ query: 'test', language: short });
      expect(result.success, `short code "${short}" should be rejected`).toBe(false);
    }
  });

  it('should reject unsupported locale code', () => {
    expect(SearchInputSchema.safeParse({ query: 'test', language: 'ko-KR' }).success).toBe(false);
  });

  it('should reject empty string', () => {
    expect(SearchInputSchema.safeParse({ query: 'test', language: '' }).success).toBe(false);
  });
});

describe('GetArticleInputSchema language field', () => {
  it('should accept all official locale codes', () => {
    for (const locale of OFFICIAL_LOCALE_CODES) {
      const result = GetArticleInputSchema.safeParse({ url: VALID_URL, language: locale });
      expect(result.success, `locale ${locale} should be accepted`).toBe(true);
    }
  });

  it('should accept omitted language', () => {
    const result = GetArticleInputSchema.safeParse({ url: VALID_URL });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.language).toBeUndefined();
    }
  });

  it('should reject unsupported locale', () => {
    expect(GetArticleInputSchema.safeParse({ url: VALID_URL, language: 'ko-KR' }).success).toBe(false);
  });
});

describe('GetTocInputSchema language field', () => {
  it('should accept all official locale codes', () => {
    for (const locale of OFFICIAL_LOCALE_CODES) {
      const result = GetTocInputSchema.safeParse({ product: 'jamf-pro', language: locale });
      expect(result.success, `locale ${locale} should be accepted`).toBe(true);
    }
  });

  it('should accept omitted language', () => {
    const result = GetTocInputSchema.safeParse({ product: 'jamf-pro' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.language).toBeUndefined();
    }
  });

  it('should reject unsupported locale', () => {
    expect(GetTocInputSchema.safeParse({ product: 'jamf-pro', language: 'sv-SE' }).success).toBe(false);
  });
});
