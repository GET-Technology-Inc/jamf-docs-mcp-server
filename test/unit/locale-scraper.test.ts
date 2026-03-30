/**
 * Unit tests for locale-aware scraper behavior (cache keys, Accept-Language header)
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock http-client before importing the module under test
vi.mock('../../src/core/http-client.js', async () => {
  return {
    httpGetText: vi.fn(),
    httpGetJson: vi.fn(),
    HttpError: (await import('../../src/core/http-client.js')).HttpError
  };
});

// Mock metadata service
vi.mock('../../src/core/services/metadata.js', () => ({
  getBundleIdForVersion: vi.fn().mockResolvedValue('jamf-pro-documentation')
}));

import { httpGetText, httpGetJson } from '../../src/core/http-client.js';
import {
  searchDocumentation,
  fetchArticle,
  fetchTableOfContents
} from '../../src/core/services/scraper.js';
import { createMockContext } from '../helpers/mock-context.js';

const ctx = createMockContext();

const mockedHttpGetJson = vi.mocked(httpGetJson);
const mockedHttpGetText = vi.mocked(httpGetText);

// ============================================================================
// Helpers
// ============================================================================

function mockSearchResponse(): void {
  mockedHttpGetJson.mockResolvedValueOnce({
    status: 'OK',
    Results: [],
    Pagination: { CurrentPage: 1, TotalPages: 0, ResultsPerPage: 10, TotalResults: 0 }
  });
}

function mockArticleHtml(title = 'Test Article'): void {
  mockedHttpGetText.mockResolvedValueOnce(
    `<html><body><article><h1>${title}</h1><p>Content here</p></article></body></html>`
  );
}

function mockTocJson(): void {
  mockedHttpGetJson.mockResolvedValueOnce(
    { section1: '<ul><li><a href="/page/test.html">Test</a></li></ul>' }
  );
}

// ============================================================================
// Tests
// ============================================================================

describe('Locale-aware cache keys', () => {
  beforeEach(() => {
    vi.mocked(ctx.cache.get).mockReset().mockResolvedValue(null);
    vi.mocked(ctx.cache.set).mockReset().mockResolvedValue(undefined);
    mockedHttpGetJson.mockReset();
    mockedHttpGetText.mockReset();
  });

  it('search cache key should include locale prefix', async () => {
    mockSearchResponse();
    await searchDocumentation(ctx, { query: 'test', language: 'ja-JP' });

    expect(vi.mocked(ctx.cache.get)).toHaveBeenCalledWith(
      expect.stringMatching(/^ja-JP:search:/)
    );
  });

  it('search cache key should use en-US prefix by default', async () => {
    mockSearchResponse();
    await searchDocumentation(ctx, { query: 'test' });

    expect(vi.mocked(ctx.cache.get)).toHaveBeenCalledWith(
      expect.stringMatching(/^en-US:search:/)
    );
  });

  it('different locales should produce different cache keys', async () => {
    mockSearchResponse();
    await searchDocumentation(ctx, { query: 'enrollment', language: 'ja-JP' });
    const jaKey = vi.mocked(ctx.cache.get).mock.calls[0][0];

    vi.mocked(ctx.cache.get).mockReset().mockResolvedValue(null);
    mockSearchResponse();
    await searchDocumentation(ctx, { query: 'enrollment', language: 'de-DE' });
    const deKey = vi.mocked(ctx.cache.get).mock.calls[0][0];

    expect(jaKey).not.toBe(deKey);
    expect(jaKey).toMatch(/^ja-JP:/);
    expect(deKey).toMatch(/^de-DE:/);
  });

  it('article cache key should include locale prefix', async () => {
    mockArticleHtml();
    await fetchArticle(ctx,
      'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/test.html',
      { locale: 'fr-FR' }
    );

    expect(vi.mocked(ctx.cache.get)).toHaveBeenCalledWith(
      expect.stringMatching(/^fr-FR:article:/)
    );
  });

  it('TOC cache key should include locale prefix', async () => {
    mockTocJson();
    await fetchTableOfContents(ctx, 'jamf-pro', 'current', { locale: 'es-ES' });

    expect(vi.mocked(ctx.cache.get)).toHaveBeenCalledWith(
      expect.stringMatching(/^es-ES:toc:/)
    );
  });
});

describe('Accept-Language header', () => {
  beforeEach(() => {
    vi.mocked(ctx.cache.get).mockReset().mockResolvedValue(null);
    vi.mocked(ctx.cache.set).mockReset().mockResolvedValue(undefined);
    mockedHttpGetJson.mockReset();
    mockedHttpGetText.mockReset();
  });

  it('should set Accept-Language to en-US,en;q=0.9 for default locale', async () => {
    mockSearchResponse();
    await searchDocumentation(ctx, { query: 'test' });

    expect(mockedHttpGetJson).toHaveBeenCalledWith(
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
    await searchDocumentation(ctx, { query: 'test', language: 'ja-JP' });

    expect(mockedHttpGetJson).toHaveBeenCalledWith(
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
    await fetchArticle(ctx,
      'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/test.html',
      { locale: 'de-DE' }
    );

    expect(mockedHttpGetText).toHaveBeenCalledWith(
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
    vi.mocked(ctx.cache.get).mockReset().mockResolvedValue(null);
    vi.mocked(ctx.cache.set).mockReset().mockResolvedValue(undefined);
    mockedHttpGetJson.mockReset();
    mockedHttpGetText.mockReset();
  });

  it('should include lang parameter for non-default locale', async () => {
    mockSearchResponse();
    await searchDocumentation(ctx, { query: 'test', language: 'ja-JP' });

    const calledUrl = mockedHttpGetJson.mock.calls[0][0] as string;
    expect(calledUrl).toContain('lang=ja-JP');
  });

  it('should not include lang parameter for default locale', async () => {
    mockSearchResponse();
    await searchDocumentation(ctx, { query: 'test' });

    const calledUrl = mockedHttpGetJson.mock.calls[0][0] as string;
    expect(calledUrl).not.toContain('lang=');
  });
});
