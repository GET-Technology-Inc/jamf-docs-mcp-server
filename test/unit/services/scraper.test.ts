/**
 * Unit tests for scraper service
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock http-client before importing the module under test
vi.mock('../../../src/core/http-client.js', async () => {
  return {
    httpGetText: vi.fn(),
    httpGetJson: vi.fn(),
    HttpError: (await import('../../../src/core/http-client.js')).HttpError
  };
});

// Mock metadata service
vi.mock('../../../src/core/services/metadata.js', () => ({
  getBundleIdForVersion: vi.fn().mockResolvedValue('jamf-pro-documentation')
}));

import { httpGetText, httpGetJson, HttpError } from '../../../src/core/http-client.js';
import {
  searchDocumentation,
  fetchArticle,
  fetchTableOfContents,
  stripLocalePrefix
} from '../../../src/core/services/scraper.js';
import { JamfDocsErrorCode } from '../../../src/core/types.js';
import { createMockContext } from '../../helpers/mock-context.js';

const ctx = createMockContext();

const mockedHttpGetJson = vi.mocked(httpGetJson);
const mockedHttpGetText = vi.mocked(httpGetText);

// ============================================================================
// Helpers
// ============================================================================

function makeHttpError(status: number): HttpError {
  return new HttpError(status, `HTTP ${status}`, 'https://test.example.com');
}

function makeSearchResponse(results: {
  title: string;
  url: string;
  snippet: string;
  bundle_id: string;
  publication_title?: string;
  score?: number;
  labels?: { key: string; navtitle?: string }[];
  follower_result?: { title: string; url: string; snippet: string; bundle_id: string; page_id: string; publication_title: string; labels?: { key: string; navtitle?: string }[] }[];
}[]) {
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
        score: r.score,
        labels: r.labels
      },
      follower_result: r.follower_result
    }))
  };
}

// ============================================================================
// Search filtering tests
// ============================================================================

describe('searchDocumentation - filtering', () => {
  beforeEach(() => {
    vi.mocked(ctx.cache.get).mockResolvedValue(null);
    vi.mocked(ctx.cache.set).mockResolvedValue(undefined);
  });

  it('should filter results by product only', async () => {
    mockedHttpGetJson.mockResolvedValue(
      makeSearchResponse([
        { title: 'Pro Article', url: 'https://learn-be.jamf.com/pro/page.html', snippet: 'pro content', bundle_id: 'jamf-pro-documentation' },
        { title: 'School Article', url: 'https://learn-be.jamf.com/school/page.html', snippet: 'school content', bundle_id: 'jamf-school-documentation' }
      ])
    );

    const result = await searchDocumentation(ctx, { query: 'enrollment', product: 'jamf-pro' });
    expect(result.results.every(r => r.product === 'Jamf Pro')).toBe(true);
    expect(result.results.some(r => r.product === 'Jamf School')).toBe(false);
  });

  it('should filter results by topic only', async () => {
    mockedHttpGetJson.mockResolvedValue(
      makeSearchResponse([
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
    );

    const result = await searchDocumentation(ctx, { query: 'sso', topic: 'sso' });
    // SSO topic keywords include 'sso', 'single sign-on', 'saml'
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results.some(r => r.title === 'SSO Configuration')).toBe(true);
  });

  it('should apply combined product and topic filter', async () => {
    mockedHttpGetJson.mockResolvedValue(
      makeSearchResponse([
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
    );

    const result = await searchDocumentation(ctx, { query: 'sso', product: 'jamf-pro', topic: 'sso' });
    expect(result.results.every(r => r.product === 'Jamf Pro')).toBe(true);
  });

  it('should pass product searchLabel to API URL when product is specified', async () => {
    mockedHttpGetJson.mockResolvedValue(
      makeSearchResponse([
        { title: 'Routines Article', url: 'https://learn-be.jamf.com/page/routines.html', snippet: 'routines content', bundle_id: 'jamf-routines-documentation' }
      ])
    );

    await searchDocumentation(ctx, { query: 'test', product: 'jamf-routines' });
    const calls = mockedHttpGetJson.mock.calls;
    const calledUrl = calls[calls.length - 1]?.[0] as string;
    expect(calledUrl).toContain('label=product-routines');
  });

  it('should not add label param to API URL when no product is specified', async () => {
    mockedHttpGetJson.mockResolvedValue(
      makeSearchResponse([
        { title: 'Article', url: 'https://learn-be.jamf.com/page/test.html', snippet: 'content', bundle_id: 'jamf-pro-documentation' }
      ])
    );

    await searchDocumentation(ctx, { query: 'test' });
    const calls = mockedHttpGetJson.mock.calls;
    const calledUrl = calls[calls.length - 1]?.[0] as string;
    expect(calledUrl).not.toContain('label=');
  });

  it('should relax filter and return results with filterRelaxation when filter matches nothing', async () => {
    mockedHttpGetJson.mockResolvedValue(
      makeSearchResponse([
        {
          title: 'General Article',
          url: 'https://learn-be.jamf.com/gen.html',
          snippet: 'general content with no relevant keywords',
          bundle_id: 'jamf-school-documentation'
        }
      ])
    );

    const result = await searchDocumentation(ctx, { query: 'test', product: 'jamf-pro' });
    // Filter fallback should relax the product filter and return the result
    expect(result.results).toHaveLength(1);
    expect(result.filterRelaxation).toBeDefined();
    expect(result.filterRelaxation!.removed).toContain('product');
    expect(result.filterRelaxation!.original['product']).toBe('jamf-pro');
  });
});

// ============================================================================
// URL transformation tests
// ============================================================================

describe('URL transformation', () => {
  beforeEach(() => {
    vi.mocked(ctx.cache.get).mockResolvedValue(null);
    vi.mocked(ctx.cache.set).mockResolvedValue(undefined);
  });

  it('should transform backend URL to frontend URL in search results', async () => {
    mockedHttpGetJson.mockResolvedValue(
      makeSearchResponse([
        {
          title: 'Article',
          url: 'https://learn-be.jamf.com/en-US/bundle/jamf-pro-documentation/page/article.html',
          snippet: 'content',
          bundle_id: 'jamf-pro-documentation'
        }
      ])
    );

    const result = await searchDocumentation(ctx, { query: 'article' });
    expect(result.results[0]?.url).toContain('learn.jamf.com');
    expect(result.results[0]?.url).not.toContain('learn-be.jamf.com');
  });

  it('should transform frontend URL to backend URL when fetching articles', async () => {
    const frontendUrl = 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/test.html';
    const expectedBackendUrl = 'https://learn-be.jamf.com/bundle/jamf-pro-documentation/page/test.html';

    mockedHttpGetText.mockImplementation(async (url: string) => {
      if (url === expectedBackendUrl) {
        return '<html><body><article><h1>Test Article</h1><p>Content</p></article></body></html>';
      }
      throw new Error('Unexpected URL: ' + url);
    });

    const result = await fetchArticle(ctx, frontendUrl);
    expect(result.url).toBe('https://learn.jamf.com/bundle/jamf-pro-documentation/page/test.html');
    // httpGetText should have been called with backend URL
    expect(mockedHttpGetText).toHaveBeenCalledWith(expectedBackendUrl, expect.any(Object));
  });

  it('should not double-transform an already-backend URL', async () => {
    const backendUrl = 'https://learn-be.jamf.com/en-US/bundle/jamf-pro-documentation/page/test.html';

    mockedHttpGetText.mockResolvedValue(
      '<html><body><article><h1>Test</h1></article></body></html>'
    );

    await fetchArticle(ctx, backendUrl);
    // Should call with locale-stripped backend URL
    expect(mockedHttpGetText).toHaveBeenCalledWith(
      'https://learn-be.jamf.com/bundle/jamf-pro-documentation/page/test.html',
      expect.any(Object)
    );
  });
});

// ============================================================================
// Error code mapping tests
// ============================================================================

describe('error code mapping', () => {
  beforeEach(() => {
    vi.mocked(ctx.cache.get).mockResolvedValue(null);
    vi.mocked(ctx.cache.set).mockResolvedValue(undefined);
  });

  it('should throw JamfDocsError with NOT_FOUND for HTTP 404', async () => {
    mockedHttpGetText.mockRejectedValue(makeHttpError(404));

    await expect(
      fetchArticle(ctx, 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/missing.html')
    ).rejects.toMatchObject({ code: JamfDocsErrorCode.NOT_FOUND, statusCode: 404 });
  });

  it('should throw JamfDocsError with RATE_LIMITED for HTTP 429', async () => {
    mockedHttpGetText.mockRejectedValue(makeHttpError(429));

    await expect(
      fetchArticle(ctx, 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/rate.html')
    ).rejects.toMatchObject({ code: JamfDocsErrorCode.RATE_LIMITED, statusCode: 429 });
  });

  it('should throw JamfDocsError with NETWORK_ERROR for HTTP 500', async () => {
    mockedHttpGetText.mockRejectedValue(makeHttpError(500));

    await expect(
      fetchArticle(ctx, 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/error.html')
    ).rejects.toMatchObject({ code: JamfDocsErrorCode.NETWORK_ERROR });
  });

  it('should throw JamfDocsError with NETWORK_ERROR for non-HttpError network failures', async () => {
    mockedHttpGetText.mockRejectedValue(new TypeError('fetch failed'));

    await expect(
      fetchArticle(ctx, 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/refused.html')
    ).rejects.toThrow();
  });

  it('should throw JamfDocsError (not return empty) for search with HTTP 500', async () => {
    // searchDocumentation re-throws JamfDocsError instances, including NETWORK_ERROR.
    // Only non-JamfDocsError exceptions yield empty results.
    mockedHttpGetJson.mockRejectedValue(makeHttpError(500));

    await expect(searchDocumentation(ctx, { query: 'test-500-fallback' })).rejects.toMatchObject({
      code: JamfDocsErrorCode.NETWORK_ERROR
    });
  });

  it('should return empty results when a non-HttpError is thrown during search', async () => {
    // Non-HttpError errors fall through to the empty-results return path
    mockedHttpGetJson.mockRejectedValue(new Error('generic error'));

    const result = await searchDocumentation(ctx, { query: 'test-generic-fallback' });
    expect(result.results).toHaveLength(0);
    expect(result.pagination.totalItems).toBe(0);
  });
});

// ============================================================================
// HTML parsing edge cases
// ============================================================================

describe('fetchArticle - HTML parsing edge cases', () => {
  beforeEach(() => {
    vi.mocked(ctx.cache.get).mockResolvedValue(null);
    vi.mocked(ctx.cache.set).mockResolvedValue(undefined);
  });

  it('should handle an article with empty content gracefully', async () => {
    mockedHttpGetText.mockResolvedValue(
      '<html><body><article></article></body></html>'
    );

    const url = 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/empty.html';
    const result = await fetchArticle(ctx, url);
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

    mockedHttpGetText.mockResolvedValue(html);

    const url = 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/deep.html';
    const result = await fetchArticle(ctx, url);
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

    mockedHttpGetText.mockResolvedValue(html);

    const url = 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/clean.html';
    const result = await fetchArticle(ctx, url);
    expect(result.content).not.toContain('alert(');
    expect(result.content).not.toContain('.hidden');
    expect(result.content).toContain('Real content here');
  });

  it('should extract h1 as article title', async () => {
    const html = `<html><body><article>
      <h1>My Article Title</h1>
      <p>Some content</p>
    </article></body></html>`;

    mockedHttpGetText.mockResolvedValue(html);

    const url = 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/titled.html';
    const result = await fetchArticle(ctx, url);
    expect(result.title).toBe('My Article Title');
  });

  it('should return Untitled when no h1 is present', async () => {
    const html = '<html><body><article><p>No heading here</p></article></body></html>';
    mockedHttpGetText.mockResolvedValue(html);

    const url = 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/no-h1.html';
    const result = await fetchArticle(ctx, url);
    expect(result.title).toBe('Untitled');
  });
});

// ============================================================================
// TOC parsing edge cases
// ============================================================================

describe('fetchTableOfContents - TOC parsing edge cases', () => {
  beforeEach(() => {
    vi.mocked(ctx.cache.get).mockResolvedValue(null);
    vi.mocked(ctx.cache.set).mockResolvedValue(undefined);
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

    mockedHttpGetJson.mockResolvedValue({ 'nav-1': html });

    const result = await fetchTableOfContents(ctx, 'jamf-pro');
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

    mockedHttpGetJson.mockResolvedValue({ 'nav-1': html });

    const result = await fetchTableOfContents(ctx, 'jamf-pro');
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

    mockedHttpGetJson.mockResolvedValue({ 'nav-1': html });

    const result = await fetchTableOfContents(ctx, 'jamf-pro');
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

    mockedHttpGetJson.mockResolvedValue({ 'nav-1': html });

    const result = await fetchTableOfContents(ctx, 'jamf-pro');
    expect(result.toc[0]?.url).toContain('learn.jamf.com');
    expect(result.toc[0]?.url).not.toContain('learn-be.jamf.com');
  });

  it('should return empty toc when API response has no ul elements', async () => {
    mockedHttpGetJson.mockResolvedValue({ 'nav-1': '<div>No lists here</div>' });

    const result = await fetchTableOfContents(ctx, 'jamf-pro');
    expect(result.toc).toHaveLength(0);
  });

  it('should throw NOT_FOUND when getBundleIdForVersion returns null and discovery also fails', async () => {
    const { getBundleIdForVersion } = await import('../../../src/core/services/metadata.js');
    vi.mocked(getBundleIdForVersion).mockResolvedValue(null);

    // Discovery also returns empty/null — make search return empty results
    mockedHttpGetJson.mockResolvedValue({ status: 'ok', Results: [] });

    await expect(fetchTableOfContents(ctx, 'jamf-pro')).rejects.toMatchObject({
      code: JamfDocsErrorCode.NOT_FOUND
    });

    // Restore
    vi.mocked(getBundleIdForVersion).mockResolvedValue('jamf-pro-documentation');
  });

  it('should handle null leading_result entries in bundle discovery and return NOT_FOUND', async () => {
    // When getBundleIdForVersion returns null, discoverLatestBundleId is called.
    // If all Results have leading_result===null, it returns null -> NOT_FOUND.
    const { getBundleIdForVersion } = await import('../../../src/core/services/metadata.js');
    vi.mocked(getBundleIdForVersion).mockResolvedValue(null);

    mockedHttpGetJson.mockResolvedValue({
      status: 'ok',
      Results: [
        { leading_result: null },
        { leading_result: null },
        { leading_result: null }
      ]
    });

    await expect(fetchTableOfContents(ctx, 'jamf-pro')).rejects.toMatchObject({
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
    vi.mocked(ctx.cache.get).mockResolvedValue(null);
    vi.mocked(ctx.cache.set).mockResolvedValue(undefined);
  });

  it('should truncate TOC entries when token count exceeds maxTokens', async () => {
    // Create many TOC entries using the correct HTML structure the parser expects
    const manyLinks = Array.from({ length: 100 }, (_, i) =>
      `<li class="toc"><div class="inner"><a href="https://learn-be.jamf.com/article-${i}.html">Long Article Title Number ${i} For Enrollment</a></div></li>`
    ).join('\n');
    const html = `<ul class="list-links">${manyLinks}</ul>`;

    mockedHttpGetJson.mockResolvedValue({ 'nav-1': html });

    // Use a very small maxTokens so truncation is forced
    const result = await fetchTableOfContents(ctx, 'jamf-pro', 'current', { maxTokens: 20 });

    expect(result.tokenInfo.truncated).toBe(true);
    expect(result.toc.length).toBeLessThan(100);
  });

  it('should not truncate TOC entries when total tokens are within limit', async () => {
    const html = `<ul>
      <li><a href="/a">A</a></li>
      <li><a href="/b">B</a></li>
    </ul>`;

    mockedHttpGetJson.mockResolvedValue({ 'nav-1': html });

    // Large maxTokens — no truncation needed
    const result = await fetchTableOfContents(ctx, 'jamf-pro', 'current', { maxTokens: 20000 });

    expect(result.tokenInfo.truncated).toBe(false);
  });
});

// ============================================================================
// Search deduplication tests
// ============================================================================

describe('searchDocumentation - cross-version deduplication', () => {
  beforeEach(() => {
    vi.mocked(ctx.cache.get).mockResolvedValue(null);
    vi.mocked(ctx.cache.set).mockResolvedValue(undefined);
  });

  it('should deduplicate articles with same title but different page slugs across versions', async () => {
    mockedHttpGetJson.mockResolvedValue(
      makeSearchResponse([
        {
          title: 'FileVault Recovery Key Escrow',
          url: 'https://learn-be.jamf.com/bundle/jamf-pro-documentation-11.25.0/page/FileVault_Recovery_Key_Escrow.html',
          snippet: 'FileVault content',
          bundle_id: 'jamf-pro-documentation-11.25.0'
        },
        {
          title: 'FileVault Recovery Key Escrow',
          url: 'https://learn-be.jamf.com/bundle/jamf-pro-documentation-11.0.0/page/FileVault-Escrow.html',
          snippet: 'FileVault content old',
          bundle_id: 'jamf-pro-documentation-11.0.0'
        }
      ])
    );

    const result = await searchDocumentation(ctx, { query: 'FileVault' });
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.version).toBe('11.25.0');
  });

  it('should NOT deduplicate articles with different titles in same product', async () => {
    mockedHttpGetJson.mockResolvedValue(
      makeSearchResponse([
        {
          title: 'FileVault Recovery Key Escrow',
          url: 'https://learn-be.jamf.com/bundle/jamf-pro-documentation-11.25.0/page/FileVault_Recovery.html',
          snippet: 'escrow content',
          bundle_id: 'jamf-pro-documentation-11.25.0'
        },
        {
          title: 'FileVault Disk Encryption',
          url: 'https://learn-be.jamf.com/bundle/jamf-pro-documentation-11.25.0/page/FileVault_Encryption.html',
          snippet: 'encryption content',
          bundle_id: 'jamf-pro-documentation-11.25.0'
        }
      ])
    );

    const result = await searchDocumentation(ctx, { query: 'FileVault' });
    expect(result.results).toHaveLength(2);
  });

  it('should NOT deduplicate articles with same title across different products', async () => {
    mockedHttpGetJson.mockResolvedValue(
      makeSearchResponse([
        {
          title: 'FileVault Recovery Key',
          url: 'https://learn-be.jamf.com/bundle/jamf-pro-documentation/page/FileVault.html',
          snippet: 'pro content',
          bundle_id: 'jamf-pro-documentation'
        },
        {
          title: 'FileVault Recovery Key',
          url: 'https://learn-be.jamf.com/bundle/jamf-school-documentation/page/FileVault.html',
          snippet: 'school content',
          bundle_id: 'jamf-school-documentation'
        }
      ])
    );

    const result = await searchDocumentation(ctx, { query: 'FileVault' });
    expect(result.results).toHaveLength(2);
  });
});

describe('related article URL resolution', () => {
  it('should resolve relative URLs against base', () => {
    const base = 'https://learn-be.jamf.com/bundle/jamf-pro-documentation-11.25.0/page/Policies.html';
    const relative = 'Log_Flushing.html#ID-00007b1e';
    const resolved = new URL(relative, base).toString();
    expect(resolved).toBe('https://learn-be.jamf.com/bundle/jamf-pro-documentation-11.25.0/page/Log_Flushing.html#ID-00007b1e');
  });

  it('should keep absolute URLs as-is', () => {
    const base = 'https://learn-be.jamf.com/bundle/jamf-pro-documentation-11.25.0/page/Policies.html';
    const absolute = 'https://support.apple.com/guide/deployment/dep1234';
    const resolved = new URL(absolute, base).toString();
    expect(resolved).toBe('https://support.apple.com/guide/deployment/dep1234');
  });

  it('should identify hash-only URLs for filtering', () => {
    const hashOnly = ['#', '#section-name', '#ID-00007b1e'];
    for (const h of hashOnly) {
      expect(h.startsWith('#')).toBe(true);
    }
    expect('page.html#anchor'.startsWith('#')).toBe(false);
  });
});

describe('stripLocalePrefix', () => {
  it('should strip /en-US/ locale prefix', () => {
    expect(stripLocalePrefix('https://learn.jamf.com/en-US/bundle/jamf-pro-documentation-11.25.0/page/Smart_Groups.html'))
      .toBe('https://learn.jamf.com/bundle/jamf-pro-documentation-11.25.0/page/Smart_Groups.html');
  });

  it('should strip /ja-JP/ locale prefix', () => {
    expect(stripLocalePrefix('https://learn.jamf.com/ja-JP/bundle/jamf-pro-documentation/page/Test.html'))
      .toBe('https://learn.jamf.com/bundle/jamf-pro-documentation/page/Test.html');
  });

  it('should not modify URL without locale prefix', () => {
    const url = 'https://learn.jamf.com/bundle/jamf-pro-documentation-11.25.0/page/Smart_Groups.html';
    expect(stripLocalePrefix(url)).toBe(url);
  });

  it('should not strip non-locale path segments', () => {
    const url = 'https://learn.jamf.com/bundle/jamf-pro-documentation/page/Test.html';
    expect(stripLocalePrefix(url)).toBe(url);
  });

  it('should handle backend URLs', () => {
    expect(stripLocalePrefix('https://learn-be.jamf.com/en-US/bundle/jamf-pro-documentation/page/Test.html'))
      .toBe('https://learn-be.jamf.com/bundle/jamf-pro-documentation/page/Test.html');
  });
});
