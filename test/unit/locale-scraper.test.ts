/**
 * Unit tests for locale-aware scraper behavior (cache keys, Accept-Language header)
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock axios before importing the module under test
vi.mock('axios', async () => {
  const actual = await vi.importActual<typeof import('axios')>('axios');
  return {
    default: {
      ...actual.default,
      get: vi.fn(),
      isAxiosError: actual.default.isAxiosError
    },
    isAxiosError: actual.default.isAxiosError
  };
});

// Mock cache to track cache key usage
vi.mock('../../src/services/cache.js', () => ({
  cache: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined)
  }
}));

// Mock metadata service
vi.mock('../../src/services/metadata.js', () => ({
  getBundleIdForVersion: vi.fn().mockResolvedValue('jamf-pro-documentation')
}));

import axios from 'axios';
import { cache } from '../../src/services/cache.js';
import {
  searchDocumentation,
  fetchArticle,
  fetchTableOfContents
} from '../../src/services/scraper.js';

// ============================================================================
// Helpers
// ============================================================================

function mockSearchResponse(): void {
  vi.mocked(axios.get).mockResolvedValueOnce({
    data: {
      status: 'OK',
      Results: [],
      Pagination: { CurrentPage: 1, TotalPages: 0, ResultsPerPage: 10, TotalResults: 0 }
    }
  });
}

function mockArticleHtml(title = 'Test Article'): void {
  vi.mocked(axios.get).mockResolvedValueOnce({
    data: `<html><body><article><h1>${title}</h1><p>Content here</p></article></body></html>`
  });
}

function mockTocJson(): void {
  vi.mocked(axios.get).mockResolvedValueOnce({
    data: { section1: '<ul><li><a href="/page/test.html">Test</a></li></ul>' }
  });
}

// ============================================================================
// Tests
// ============================================================================

describe('Locale-aware cache keys', () => {
  beforeEach(() => {
    vi.mocked(cache.get).mockReset().mockResolvedValue(null);
    vi.mocked(cache.set).mockReset().mockResolvedValue(undefined);
    vi.mocked(axios.get).mockReset();
  });

  it('search cache key should include locale prefix', async () => {
    mockSearchResponse();
    await searchDocumentation({ query: 'test', language: 'ja-JP' });

    expect(vi.mocked(cache.get)).toHaveBeenCalledWith(
      expect.stringMatching(/^ja-JP:search:/)
    );
  });

  it('search cache key should use en-US prefix by default', async () => {
    mockSearchResponse();
    await searchDocumentation({ query: 'test' });

    expect(vi.mocked(cache.get)).toHaveBeenCalledWith(
      expect.stringMatching(/^en-US:search:/)
    );
  });

  it('different locales should produce different cache keys', async () => {
    mockSearchResponse();
    await searchDocumentation({ query: 'enrollment', language: 'ja-JP' });
    const jaKey = vi.mocked(cache.get).mock.calls[0][0];

    vi.mocked(cache.get).mockReset().mockResolvedValue(null);
    mockSearchResponse();
    await searchDocumentation({ query: 'enrollment', language: 'de-DE' });
    const deKey = vi.mocked(cache.get).mock.calls[0][0];

    expect(jaKey).not.toBe(deKey);
    expect(jaKey).toMatch(/^ja-JP:/);
    expect(deKey).toMatch(/^de-DE:/);
  });

  it('article cache key should include locale prefix', async () => {
    mockArticleHtml();
    await fetchArticle(
      'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/test.html',
      { locale: 'fr-FR' }
    );

    expect(vi.mocked(cache.get)).toHaveBeenCalledWith(
      expect.stringMatching(/^fr-FR:article:/)
    );
  });

  it('TOC cache key should include locale prefix', async () => {
    mockTocJson();
    await fetchTableOfContents('jamf-pro', 'current', { locale: 'es-ES' });

    expect(vi.mocked(cache.get)).toHaveBeenCalledWith(
      expect.stringMatching(/^es-ES:toc:/)
    );
  });
});

describe('Accept-Language header', () => {
  beforeEach(() => {
    vi.mocked(cache.get).mockReset().mockResolvedValue(null);
    vi.mocked(cache.set).mockReset().mockResolvedValue(undefined);
    vi.mocked(axios.get).mockReset();
  });

  it('should set Accept-Language to en-US,en;q=0.9 for default locale', async () => {
    mockSearchResponse();
    await searchDocumentation({ query: 'test' });

    expect(vi.mocked(axios.get)).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          'Accept-Language': 'en-US,en;q=0.9'
        })
      })
    );
  });

  it('should set Accept-Language to ja,en;q=0.5 for Japanese locale', async () => {
    mockSearchResponse();
    await searchDocumentation({ query: 'test', language: 'ja-JP' });

    expect(vi.mocked(axios.get)).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          'Accept-Language': 'ja-JP,en;q=0.5'
        })
      })
    );
  });

  it('should set Accept-Language to de,en;q=0.5 for German locale', async () => {
    mockArticleHtml();
    await fetchArticle(
      'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/test.html',
      { locale: 'de-DE' }
    );

    expect(vi.mocked(axios.get)).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          'Accept-Language': 'de-DE,en;q=0.5'
        })
      })
    );
  });
});

describe('Search API locale parameter', () => {
  beforeEach(() => {
    vi.mocked(cache.get).mockReset().mockResolvedValue(null);
    vi.mocked(cache.set).mockReset().mockResolvedValue(undefined);
    vi.mocked(axios.get).mockReset();
  });

  it('should include lang parameter for non-default locale', async () => {
    mockSearchResponse();
    await searchDocumentation({ query: 'test', language: 'ja-JP' });

    const calledUrl = vi.mocked(axios.get).mock.calls[0][0] as string;
    expect(calledUrl).toContain('lang=ja-JP');
  });

  it('should not include lang parameter for default locale', async () => {
    mockSearchResponse();
    await searchDocumentation({ query: 'test' });

    const calledUrl = vi.mocked(axios.get).mock.calls[0][0] as string;
    expect(calledUrl).not.toContain('lang=');
  });
});
