/**
 * Unit tests for scraper service
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

// Mock cache to avoid file system interaction
vi.mock('../../../src/services/cache.js', () => ({
  cache: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined)
  }
}));

// Mock metadata service
vi.mock('../../../src/services/metadata.js', () => ({
  getBundleIdForVersion: vi.fn().mockResolvedValue('jamf-pro-documentation')
}));

import axios from 'axios';
import { cache } from '../../../src/services/cache.js';
import {
  searchDocumentation,
  fetchArticle,
  fetchTableOfContents
} from '../../../src/services/scraper.js';
import { JamfDocsErrorCode } from '../../../src/types.js';

// ============================================================================
// Helpers
// ============================================================================

function makeAxiosError(status?: number, code?: string, message = 'network error') {
  const error = new Error(message) as Error & {
    isAxiosError: boolean;
    response?: { status: number };
    code?: string;
  };
  error.isAxiosError = true;
  if (status !== undefined) {
    error.response = { status };
  }
  if (code !== undefined) {
    error.code = code;
  }
  return error;
}

function makeSearchResponse(results: { title: string; url: string; snippet: string; bundle_id: string; publication_title?: string; score?: number }[]) {
  return {
    status: 'ok',
    Results: results.map(r => ({
      leading_result: {
        title: r.title,
        url: r.url,
        snippet: r.snippet,
        bundle_id: r.bundle_id,
        page_id: 'p1',
        publication_title: r.publication_title ?? 'Jamf',
        score: r.score
      }
    }))
  };
}

// ============================================================================
// Search filtering tests
// ============================================================================

describe('searchDocumentation - filtering', () => {
  beforeEach(() => {
    vi.mocked(cache.get).mockResolvedValue(null);
    vi.mocked(cache.set).mockResolvedValue(undefined);
  });

  it('should filter results by product only', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: makeSearchResponse([
        { title: 'Pro Article', url: 'https://learn-be.jamf.com/pro/page.html', snippet: 'pro content', bundle_id: 'jamf-pro-documentation' },
        { title: 'School Article', url: 'https://learn-be.jamf.com/school/page.html', snippet: 'school content', bundle_id: 'jamf-school-documentation' }
      ])
    });

    const result = await searchDocumentation({ query: 'enrollment', product: 'jamf-pro' });
    expect(result.results.every(r => r.product === 'Jamf Pro')).toBe(true);
    expect(result.results.some(r => r.product === 'Jamf School')).toBe(false);
  });

  it('should filter results by topic only', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: makeSearchResponse([
        {
          title: 'SSO Configuration',
          url: 'https://learn-be.jamf.com/page.html',
          snippet: 'Configure single sign-on SAML for your organization',
          bundle_id: 'jamf-pro-documentation'
        },
        {
          title: 'FileVault Setup',
          url: 'https://learn-be.jamf.com/fv.html',
          snippet: 'Enable FileVault disk encryption',
          bundle_id: 'jamf-pro-documentation'
        }
      ])
    });

    const result = await searchDocumentation({ query: 'sso', topic: 'sso' });
    // SSO topic keywords include 'sso', 'single sign-on', 'saml'
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results.some(r => r.title === 'SSO Configuration')).toBe(true);
  });

  it('should apply combined product and topic filter', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: makeSearchResponse([
        {
          title: 'Jamf Pro SSO',
          url: 'https://learn-be.jamf.com/pro-sso.html',
          snippet: 'single sign-on saml configuration for jamf pro',
          bundle_id: 'jamf-pro-documentation'
        },
        {
          title: 'Jamf School SSO',
          url: 'https://learn-be.jamf.com/school-sso.html',
          snippet: 'single sign-on saml configuration for jamf school',
          bundle_id: 'jamf-school-documentation'
        }
      ])
    });

    const result = await searchDocumentation({ query: 'sso', product: 'jamf-pro', topic: 'sso' });
    expect(result.results.every(r => r.product === 'Jamf Pro')).toBe(true);
  });

  it('should return empty results when filter matches nothing', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: makeSearchResponse([
        {
          title: 'General Article',
          url: 'https://learn-be.jamf.com/gen.html',
          snippet: 'general content with no relevant keywords',
          bundle_id: 'jamf-school-documentation'
        }
      ])
    });

    const result = await searchDocumentation({ query: 'test', product: 'jamf-pro' });
    expect(result.results).toHaveLength(0);
    expect(result.pagination.totalItems).toBe(0);
  });
});

// ============================================================================
// URL transformation tests
// ============================================================================

describe('URL transformation', () => {
  beforeEach(() => {
    vi.mocked(cache.get).mockResolvedValue(null);
    vi.mocked(cache.set).mockResolvedValue(undefined);
  });

  it('should transform backend URL to frontend URL in search results', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: makeSearchResponse([
        {
          title: 'Article',
          url: 'https://learn-be.jamf.com/en-US/bundle/jamf-pro-documentation/page/article.html',
          snippet: 'content',
          bundle_id: 'jamf-pro-documentation'
        }
      ])
    });

    const result = await searchDocumentation({ query: 'article' });
    expect(result.results[0]?.url).toContain('learn.jamf.com');
    expect(result.results[0]?.url).not.toContain('learn-be.jamf.com');
  });

  it('should transform frontend URL to backend URL when fetching articles', async () => {
    const frontendUrl = 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/test.html';
    const expectedBackendUrl = frontendUrl.replace('learn.jamf.com', 'learn-be.jamf.com');

    vi.mocked(axios.get).mockImplementation((url: string) => {
      if (url === expectedBackendUrl) {
        return Promise.resolve({
          data: '<html><body><article><h1>Test Article</h1><p>Content</p></article></body></html>'
        });
      }
      return Promise.reject(new Error('Unexpected URL: ' + url));
    });

    const result = await fetchArticle(frontendUrl);
    expect(result.url).toBe(frontendUrl);
    // axios.get should have been called with backend URL
    expect(vi.mocked(axios.get)).toHaveBeenCalledWith(expectedBackendUrl, expect.any(Object));
  });

  it('should not double-transform an already-backend URL', async () => {
    const backendUrl = 'https://learn-be.jamf.com/en-US/bundle/jamf-pro-documentation/page/test.html';

    vi.mocked(axios.get).mockResolvedValue({
      data: '<html><body><article><h1>Test</h1></article></body></html>'
    });

    await fetchArticle(backendUrl);
    // Should still call with backend URL (transformToBackendUrl on already-backend URL is a no-op)
    expect(vi.mocked(axios.get)).toHaveBeenCalledWith(backendUrl, expect.any(Object));
  });
});

// ============================================================================
// Error code mapping tests
// ============================================================================

describe('error code mapping', () => {
  beforeEach(() => {
    vi.mocked(cache.get).mockResolvedValue(null);
    vi.mocked(cache.set).mockResolvedValue(undefined);
  });

  it('should throw JamfDocsError with NOT_FOUND for HTTP 404', async () => {
    vi.mocked(axios.get).mockRejectedValue(makeAxiosError(404));

    await expect(
      fetchArticle('https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/missing.html')
    ).rejects.toMatchObject({ code: JamfDocsErrorCode.NOT_FOUND, statusCode: 404 });
  });

  it('should throw JamfDocsError with RATE_LIMITED for HTTP 429', async () => {
    vi.mocked(axios.get).mockRejectedValue(makeAxiosError(429));

    await expect(
      fetchArticle('https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/rate.html')
    ).rejects.toMatchObject({ code: JamfDocsErrorCode.RATE_LIMITED, statusCode: 429 });
  });

  it('should throw JamfDocsError with TIMEOUT for ECONNABORTED', async () => {
    vi.mocked(axios.get).mockRejectedValue(makeAxiosError(undefined, 'ECONNABORTED', 'timeout of 15000ms exceeded'));

    await expect(
      fetchArticle('https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/slow.html')
    ).rejects.toMatchObject({ code: JamfDocsErrorCode.TIMEOUT });
  });

  it('should throw JamfDocsError with NETWORK_ERROR for HTTP 500', async () => {
    vi.mocked(axios.get).mockRejectedValue(makeAxiosError(500));

    await expect(
      fetchArticle('https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/error.html')
    ).rejects.toMatchObject({ code: JamfDocsErrorCode.NETWORK_ERROR });
  });

  it('should throw JamfDocsError with NETWORK_ERROR for ECONNREFUSED', async () => {
    vi.mocked(axios.get).mockRejectedValue(makeAxiosError(undefined, 'ECONNREFUSED', 'connect ECONNREFUSED'));

    await expect(
      fetchArticle('https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/refused.html')
    ).rejects.toMatchObject({ code: JamfDocsErrorCode.NETWORK_ERROR });
  });

  it('should throw JamfDocsError (not return empty) for search with HTTP 500', async () => {
    // searchDocumentation re-throws JamfDocsError instances, including NETWORK_ERROR.
    // Only non-JamfDocsError exceptions yield empty results.
    vi.mocked(axios.get).mockRejectedValue(makeAxiosError(500));

    await expect(searchDocumentation({ query: 'test-500-fallback' })).rejects.toMatchObject({
      code: JamfDocsErrorCode.NETWORK_ERROR
    });
  });

  it('should return empty results when a non-JamfDocsError is thrown during search', async () => {
    // Non-axios errors fall through to the empty-results return path
    vi.mocked(axios.get).mockRejectedValue(new Error('generic error'));

    const result = await searchDocumentation({ query: 'test-generic-fallback' });
    expect(result.results).toHaveLength(0);
    expect(result.pagination.totalItems).toBe(0);
  });
});

// ============================================================================
// HTML parsing edge cases
// ============================================================================

describe('fetchArticle - HTML parsing edge cases', () => {
  beforeEach(() => {
    vi.mocked(cache.get).mockResolvedValue(null);
    vi.mocked(cache.set).mockResolvedValue(undefined);
  });

  it('should handle an article with empty content gracefully', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: '<html><body><article></article></body></html>'
    });

    const url = 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/empty.html';
    const result = await fetchArticle(url);
    expect(result.title).toBe('Untitled');
    expect(result.content).toBe('');
  });

  it('should handle deeply nested HTML without throwing', async () => {
    // Build 20 levels of nested divs with content at the bottom
    const inner = '<p>Deep content</p>';
    const nested = Array.from({ length: 20 }, () => '<div>').join('') +
      inner +
      Array.from({ length: 20 }, () => '</div>').join('');
    const html = `<html><body><article><h1>Deep Article</h1>${nested}</article></body></html>`;

    vi.mocked(axios.get).mockResolvedValue({ data: html });

    const url = 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/deep.html';
    const result = await fetchArticle(url);
    expect(result.title).toBe('Deep Article');
    expect(result.content).toContain('Deep content');
  });

  it('should strip script and style elements from article content', async () => {
    const html = `<html><body><article>
      <h1>Clean Article</h1>
      <script>alert('xss')</script>
      <style>.hidden { display: none; }</style>
      <p>Real content here</p>
    </article></body></html>`;

    vi.mocked(axios.get).mockResolvedValue({ data: html });

    const url = 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/clean.html';
    const result = await fetchArticle(url);
    expect(result.content).not.toContain('alert(');
    expect(result.content).not.toContain('.hidden');
    expect(result.content).toContain('Real content here');
  });

  it('should extract h1 as article title', async () => {
    const html = `<html><body><article>
      <h1>My Article Title</h1>
      <p>Some content</p>
    </article></body></html>`;

    vi.mocked(axios.get).mockResolvedValue({ data: html });

    const url = 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/titled.html';
    const result = await fetchArticle(url);
    expect(result.title).toBe('My Article Title');
  });

  it('should return Untitled when no h1 is present', async () => {
    const html = '<html><body><article><p>No heading here</p></article></body></html>';
    vi.mocked(axios.get).mockResolvedValue({ data: html });

    const url = 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/no-h1.html';
    const result = await fetchArticle(url);
    expect(result.title).toBe('Untitled');
  });
});

// ============================================================================
// TOC parsing edge cases
// ============================================================================

describe('fetchTableOfContents - TOC parsing edge cases', () => {
  beforeEach(() => {
    vi.mocked(cache.get).mockResolvedValue(null);
    vi.mocked(cache.set).mockResolvedValue(undefined);
  });

  it('should handle a deeply nested TOC without throwing', async () => {
    // Build a 3-level nested TOC HTML
    const html = `
      <ul class="list-links">
        <li class="toc">
          <div class="inner"><a href="https://learn-be.jamf.com/page1.html">Level 1</a></div>
          <ul class="list-links">
            <li class="toc">
              <div class="inner"><a href="https://learn-be.jamf.com/page2.html">Level 2</a></div>
              <ul class="list-links">
                <li class="toc">
                  <div class="inner"><a href="https://learn-be.jamf.com/page3.html">Level 3</a></div>
                </li>
              </ul>
            </li>
          </ul>
        </li>
      </ul>
    `;

    vi.mocked(axios.get).mockResolvedValue({
      data: { 'nav-1': html }
    });

    const result = await fetchTableOfContents('jamf-pro');
    expect(result.toc.length).toBeGreaterThan(0);
    expect(result.toc[0]?.children).toBeDefined();
    expect(result.toc[0]?.children?.[0]?.children).toBeDefined();
  });

  it('should skip TOC entries that have no href', async () => {
    const html = `
      <ul class="list-links">
        <li class="toc">
          <div class="inner"><a href="">No Href Entry</a></div>
        </li>
        <li class="toc">
          <div class="inner"><a href="https://learn-be.jamf.com/valid.html">Valid Entry</a></div>
        </li>
      </ul>
    `;

    vi.mocked(axios.get).mockResolvedValue({
      data: { 'nav-1': html }
    });

    const result = await fetchTableOfContents('jamf-pro');
    // The entry with empty href should be skipped
    const titles = result.toc.map(e => e.title);
    expect(titles).not.toContain('No Href Entry');
    expect(titles).toContain('Valid Entry');
  });

  it('should skip TOC entries that have no title', async () => {
    const html = `
      <ul class="list-links">
        <li class="toc">
          <div class="inner"><a href="https://learn-be.jamf.com/notitle.html"></a></div>
        </li>
        <li class="toc">
          <div class="inner"><a href="https://learn-be.jamf.com/with-title.html">With Title</a></div>
        </li>
      </ul>
    `;

    vi.mocked(axios.get).mockResolvedValue({
      data: { 'nav-1': html }
    });

    const result = await fetchTableOfContents('jamf-pro');
    const titles = result.toc.map(e => e.title);
    expect(titles).toContain('With Title');
    expect(titles.filter(t => t === '')).toHaveLength(0);
  });

  it('should transform backend URLs to frontend URLs in TOC entries', async () => {
    const html = `
      <ul class="list-links">
        <li class="toc">
          <div class="inner"><a href="https://learn-be.jamf.com/en-US/bundle/jamf-pro-documentation/page/test.html">Test Page</a></div>
        </li>
      </ul>
    `;

    vi.mocked(axios.get).mockResolvedValue({
      data: { 'nav-1': html }
    });

    const result = await fetchTableOfContents('jamf-pro');
    expect(result.toc[0]?.url).toContain('learn.jamf.com');
    expect(result.toc[0]?.url).not.toContain('learn-be.jamf.com');
  });

  it('should return empty toc when API response has no ul elements', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: { 'nav-1': '<div>No lists here</div>' }
    });

    const result = await fetchTableOfContents('jamf-pro');
    expect(result.toc).toHaveLength(0);
  });

  it('should throw NOT_FOUND when getBundleIdForVersion returns null and discovery also fails', async () => {
    const { getBundleIdForVersion } = await import('../../../src/services/metadata.js');
    vi.mocked(getBundleIdForVersion).mockResolvedValue(null);

    // Discovery also returns empty/null — make search return empty results
    vi.mocked(axios.get).mockResolvedValue({
      data: { status: 'ok', Results: [] }
    });

    await expect(fetchTableOfContents('jamf-pro')).rejects.toMatchObject({
      code: JamfDocsErrorCode.NOT_FOUND
    });

    // Restore
    vi.mocked(getBundleIdForVersion).mockResolvedValue('jamf-pro-documentation');
  });

  it('should handle null leading_result entries in bundle discovery and return NOT_FOUND', async () => {
    // When getBundleIdForVersion returns null, discoverLatestBundleId is called.
    // If all Results have leading_result===null, it returns null → NOT_FOUND.
    const { getBundleIdForVersion } = await import('../../../src/services/metadata.js');
    vi.mocked(getBundleIdForVersion).mockResolvedValue(null);

    vi.mocked(axios.get).mockResolvedValue({
      data: {
        status: 'ok',
        Results: [
          { leading_result: null },
          { leading_result: null },
          { leading_result: null }
        ]
      }
    });

    await expect(fetchTableOfContents('jamf-pro')).rejects.toMatchObject({
      code: JamfDocsErrorCode.NOT_FOUND
    });

    // Restore
    vi.mocked(getBundleIdForVersion).mockResolvedValue('jamf-pro-documentation');
  });
});

// ============================================================================
// fetchTableOfContents — TOC token truncation
// ============================================================================

describe('fetchTableOfContents - TOC token truncation', () => {
  beforeEach(() => {
    vi.mocked(cache.get).mockResolvedValue(null);
    vi.mocked(cache.set).mockResolvedValue(undefined);
  });

  it('should truncate TOC entries when token count exceeds maxTokens', async () => {
    // Create many TOC entries using the correct HTML structure the parser expects
    const manyLinks = Array.from({ length: 100 }, (_, i) =>
      `<li class="toc"><div class="inner"><a href="https://learn-be.jamf.com/article-${i}.html">Long Article Title Number ${i} For Enrollment</a></div></li>`
    ).join('\n');
    const html = `<ul class="list-links">${manyLinks}</ul>`;

    vi.mocked(axios.get).mockResolvedValue({
      data: { 'nav-1': html }
    });

    // Use a very small maxTokens so truncation is forced
    const result = await fetchTableOfContents('jamf-pro', 'current', { maxTokens: 20 });

    expect(result.tokenInfo.truncated).toBe(true);
    expect(result.toc.length).toBeLessThan(100);
  });

  it('should not truncate TOC entries when total tokens are within limit', async () => {
    const html = `<ul>
      <li><a href="/a">A</a></li>
      <li><a href="/b">B</a></li>
    </ul>`;

    vi.mocked(axios.get).mockResolvedValue({
      data: { 'nav-1': html }
    });

    // Large maxTokens — no truncation needed
    const result = await fetchTableOfContents('jamf-pro', 'current', { maxTokens: 20000 });

    expect(result.tokenInfo.truncated).toBe(false);
  });
});
