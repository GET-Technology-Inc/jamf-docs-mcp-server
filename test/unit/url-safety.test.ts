/**
 * URL safety tests for scraper service
 *
 * Tests the security properties of the four private URL functions:
 *   - isAllowedHostname  — allowlist enforcement on external API results
 *   - transformToFrontendUrl — learn-be.jamf.com -> learn.jamf.com
 *   - transformToBackendUrl  — learn.jamf.com -> learn-be.jamf.com
 *   - validateBundleId   — bundle ID pattern enforcement
 *
 * All four functions are module-private, so they are exercised indirectly
 * through the three exported functions: searchDocumentation, fetchArticle,
 * and fetchTableOfContents.
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

// Mock metadata service so TOC tests do not depend on external discovery
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
// Shared helpers
// ============================================================================

/**
 * Build a minimal Zoomin API response containing the given raw result rows.
 */
function makeSearchResponse(
  rows: {
    title: string;
    url: string;
    snippet: string;
    bundle_id: string;
    publication_title?: string;
    score?: number;
  }[]
) {
  return {
    status: 'ok',
    Results: rows.map(r => ({
      leading_result: {
        title: r.title,
        url: r.url,
        snippet: r.snippet,
        bundle_id: r.bundle_id,
        page_id: 'page-1',
        publication_title: r.publication_title ?? 'Jamf',
        score: r.score
      }
    }))
  };
}

/** Minimal valid search result row pointing to the backend hostname. */
function validRow(overrides: Partial<{
  title: string;
  url: string;
  snippet: string;
  bundle_id: string;
}> = {}) {
  return {
    title: overrides.title ?? 'Valid Article',
    url: overrides.url ?? 'https://learn-be.jamf.com/en-US/bundle/jamf-pro-documentation/page/valid.html',
    snippet: overrides.snippet ?? 'Some content',
    bundle_id: overrides.bundle_id ?? 'jamf-pro-documentation'
  };
}

/** Simple TOC HTML fragment the parser understands. */
function makeTocHtml(entries: { href: string; label: string }[]): string {
  const items = entries
    .map(e => `<li class="toc"><div class="inner"><a href="${e.href}">${e.label}</a></div></li>`)
    .join('\n');
  return `<ul class="list-links">${items}</ul>`;
}

// ============================================================================
// isAllowedHostname — exercised through searchDocumentation hostname filter
// ============================================================================

describe('isAllowedHostname — search result filtering', () => {
  beforeEach(() => {
    vi.mocked(ctx.cache.get).mockResolvedValue(null);
    vi.mocked(ctx.cache.set).mockResolvedValue(undefined);
  });

  it('should keep results whose URL is on learn-be.jamf.com', async () => {
    mockedHttpGetJson.mockResolvedValue(makeSearchResponse([validRow()]));

    const { results } = await searchDocumentation(ctx, { query: 'test' });

    expect(results).toHaveLength(1);
    expect(results[0]?.title).toBe('Valid Article');
  });

  it('should keep results whose URL is on learn.jamf.com', async () => {
    mockedHttpGetJson.mockResolvedValue(
      makeSearchResponse([
        validRow({ url: 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/article.html' })
      ])
    );

    const { results } = await searchDocumentation(ctx, { query: 'test' });

    expect(results).toHaveLength(1);
  });

  it('should keep results whose URL is on docs.jamf.com', async () => {
    mockedHttpGetJson.mockResolvedValue(
      makeSearchResponse([
        validRow({ url: 'https://docs.jamf.com/jamf-pro/documentation/page.html' })
      ])
    );

    const { results } = await searchDocumentation(ctx, { query: 'test' });

    expect(results).toHaveLength(1);
  });

  it('should filter out results with an unexpected hostname', async () => {
    mockedHttpGetJson.mockResolvedValue(
      makeSearchResponse([
        validRow({ url: 'https://evil.example.com/steal-credentials' })
      ])
    );

    const { results } = await searchDocumentation(ctx, { query: 'test' });

    expect(results).toHaveLength(0);
  });

  it('should filter out results with an open-redirect look-alike hostname', async () => {
    mockedHttpGetJson.mockResolvedValue(
      makeSearchResponse([
        validRow({ url: 'https://learn.jamf.com.attacker.io/page.html' })
      ])
    );

    const { results } = await searchDocumentation(ctx, { query: 'test' });

    expect(results).toHaveLength(0);
  });

  it('should filter out results with a subdomain of learn.jamf.com that is not in the allowlist', async () => {
    mockedHttpGetJson.mockResolvedValue(
      makeSearchResponse([
        validRow({ url: 'https://staging.learn.jamf.com/page.html' })
      ])
    );

    const { results } = await searchDocumentation(ctx, { query: 'test' });

    expect(results).toHaveLength(0);
  });

  it('should filter out results with an http (non-https) URL on an allowed hostname', async () => {
    // isAllowedHostname now enforces https: protocol — http URLs are rejected
    // even when the hostname is in the allowlist.
    mockedHttpGetJson.mockResolvedValue(
      makeSearchResponse([
        validRow({ url: 'http://learn-be.jamf.com/page.html' })
      ])
    );

    const { results } = await searchDocumentation(ctx, { query: 'test' });

    // http: protocol is rejected — result is filtered out
    expect(results).toHaveLength(0);
  });

  it('should pass through allowed results and drop disallowed ones in the same response', async () => {
    mockedHttpGetJson.mockResolvedValue(
      makeSearchResponse([
        validRow({ title: 'Good 1', url: 'https://learn-be.jamf.com/page1.html' }),
        validRow({ title: 'Bad',   url: 'https://malicious.io/phish' }),
        validRow({ title: 'Good 2', url: 'https://learn.jamf.com/page2.html' }),
        validRow({ title: 'Also bad', url: 'https://learn-be.jamf.com.evil.net/page.html' })
      ])
    );

    const { results } = await searchDocumentation(ctx, { query: 'test' });

    const titles = results.map(r => r.title);
    expect(titles).toContain('Good 1');
    expect(titles).toContain('Good 2');
    expect(titles).not.toContain('Bad');
    expect(titles).not.toContain('Also bad');
  });

  it('should handle results with completely malformed URLs without crashing', async () => {
    mockedHttpGetJson.mockResolvedValue(
      makeSearchResponse([
        validRow({ url: 'not-a-url-at-all' }),
        validRow({ title: 'Safe Article' })
      ])
    );

    // The malformed URL fails new URL() inside isAllowedHostname -> returns false -> filtered out
    const { results } = await searchDocumentation(ctx, { query: 'test' });

    expect(results.some(r => r.title === 'Safe Article')).toBe(true);
    expect(results.every(r => r.title !== 'not-a-url-at-all')).toBe(true);
  });

  it('should return zero results when every result has a disallowed hostname', async () => {
    mockedHttpGetJson.mockResolvedValue(
      makeSearchResponse([
        validRow({ url: 'https://attacker.com/1' }),
        validRow({ url: 'https://attacker.com/2' }),
        validRow({ url: 'ftp://attacker.com/3' })
      ])
    );

    const { results } = await searchDocumentation(ctx, { query: 'test' });

    expect(results).toHaveLength(0);
  });
});

// ============================================================================
// transformToFrontendUrl — search results must expose learn.jamf.com
// ============================================================================

describe('transformToFrontendUrl — URLs in search results', () => {
  beforeEach(() => {
    vi.mocked(ctx.cache.get).mockResolvedValue(null);
    vi.mocked(ctx.cache.set).mockResolvedValue(undefined);
  });

  it('should rewrite learn-be.jamf.com to learn.jamf.com in result URLs', async () => {
    mockedHttpGetJson.mockResolvedValue(
      makeSearchResponse([
        validRow({ url: 'https://learn-be.jamf.com/en-US/bundle/jamf-pro-documentation/page/enrolling.html' })
      ])
    );

    const { results } = await searchDocumentation(ctx, { query: 'enroll' });

    expect(results[0]?.url).toContain('learn.jamf.com');
    expect(results[0]?.url).not.toContain('learn-be.jamf.com');
  });

  it('should preserve the full path when rewriting the hostname', async () => {
    const path = '/en-US/bundle/jamf-pro-documentation/page/some-page.html';
    mockedHttpGetJson.mockResolvedValue(
      makeSearchResponse([
        validRow({ url: `https://learn-be.jamf.com${path}` })
      ])
    );

    const { results } = await searchDocumentation(ctx, { query: 'test' });

    expect(results[0]?.url).toBe(`https://learn.jamf.com${path}`);
  });

  it('should leave learn.jamf.com URLs unchanged (no double-transformation)', async () => {
    const original = 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/article.html';
    mockedHttpGetJson.mockResolvedValue(
      makeSearchResponse([validRow({ url: original })])
    );

    const { results } = await searchDocumentation(ctx, { query: 'test' });

    expect(results[0]?.url).toBe(original);
  });

  it('should leave docs.jamf.com URLs unchanged', async () => {
    const original = 'https://docs.jamf.com/jamf-pro/documentation/page.html';
    mockedHttpGetJson.mockResolvedValue(
      makeSearchResponse([validRow({ url: original })])
    );

    const { results } = await searchDocumentation(ctx, { query: 'test' });

    expect(results[0]?.url).toBe(original);
  });

  it('should rewrite backend URLs in TOC entries to frontend URLs', async () => {
    const backendHref = 'https://learn-be.jamf.com/en-US/bundle/jamf-pro-documentation/page/toc-page.html';
    mockedHttpGetJson.mockResolvedValue(
      { 'nav-1': makeTocHtml([{ href: backendHref, label: 'TOC Page' }]) }
    );

    const { toc } = await fetchTableOfContents(ctx, 'jamf-pro');

    expect(toc[0]?.url).toBe(backendHref.replace('learn-be.jamf.com', 'learn.jamf.com'));
    expect(toc[0]?.url).not.toContain('learn-be.jamf.com');
  });

  it('should rewrite backend URLs in nested TOC children', async () => {
    const childHref = 'https://learn-be.jamf.com/en-US/bundle/jamf-pro-documentation/page/child.html';
    const html = `
      <ul class="list-links">
        <li class="toc">
          <div class="inner"><a href="https://learn-be.jamf.com/parent.html">Parent</a></div>
          <ul class="list-links">
            <li class="toc">
              <div class="inner"><a href="${childHref}">Child</a></div>
            </li>
          </ul>
        </li>
      </ul>`;
    mockedHttpGetJson.mockResolvedValue({ 'nav-1': html });

    const { toc } = await fetchTableOfContents(ctx, 'jamf-pro');

    const childUrl = toc[0]?.children?.[0]?.url;
    expect(childUrl).toContain('learn.jamf.com');
    expect(childUrl).not.toContain('learn-be.jamf.com');
  });
});

// ============================================================================
// transformToBackendUrl — fetchArticle must fetch from learn-be.jamf.com
// ============================================================================

describe('transformToBackendUrl — HTTP fetch target for fetchArticle', () => {
  beforeEach(() => {
    vi.mocked(ctx.cache.get).mockResolvedValue(null);
    vi.mocked(ctx.cache.set).mockResolvedValue(undefined);
  });

  const minimalHtml = (title = 'Article') =>
    `<html><body><article><h1>${title}</h1><p>Content.</p></article></body></html>`;

  it('should fetch from learn-be.jamf.com when given a learn.jamf.com URL', async () => {
    const frontendUrl = 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/test.html';
    const expectedBackendUrl = 'https://learn-be.jamf.com/bundle/jamf-pro-documentation/page/test.html';

    mockedHttpGetText.mockResolvedValue(minimalHtml());

    await fetchArticle(ctx, frontendUrl);

    expect(mockedHttpGetText).toHaveBeenCalledWith(expectedBackendUrl, expect.any(Object));
  });

  it('should expose the locale-stripped learn.jamf.com URL in the returned article', async () => {
    const frontendUrl = 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/test.html';
    const expectedDisplayUrl = 'https://learn.jamf.com/bundle/jamf-pro-documentation/page/test.html';

    mockedHttpGetText.mockResolvedValue(minimalHtml());

    const article = await fetchArticle(ctx, frontendUrl);

    expect(article.url).toBe(expectedDisplayUrl);
    expect(article.url).not.toContain('learn-be.jamf.com');
  });

  it('should not double-transform a URL that is already on learn-be.jamf.com', async () => {
    const backendUrl = 'https://learn-be.jamf.com/en-US/bundle/jamf-pro-documentation/page/test.html';
    const expectedBackendUrl = 'https://learn-be.jamf.com/bundle/jamf-pro-documentation/page/test.html';

    mockedHttpGetText.mockResolvedValue(minimalHtml());

    await fetchArticle(ctx, backendUrl);

    // locale prefix should be stripped
    expect(mockedHttpGetText).toHaveBeenCalledWith(expectedBackendUrl, expect.any(Object));
  });

  it('should preserve query parameters when transforming to backend URL', async () => {
    const frontendUrl = 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/test.html?version=11';
    const expectedBackendUrl = 'https://learn-be.jamf.com/bundle/jamf-pro-documentation/page/test.html?version=11';

    mockedHttpGetText.mockResolvedValue(minimalHtml());

    await fetchArticle(ctx, frontendUrl);

    expect(mockedHttpGetText).toHaveBeenCalledWith(expectedBackendUrl, expect.any(Object));
  });

  it('should preserve URL fragments when transforming to backend URL', async () => {
    const frontendUrl = 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/test.html#section-1';
    const expectedBackendUrl = 'https://learn-be.jamf.com/bundle/jamf-pro-documentation/page/test.html#section-1';

    mockedHttpGetText.mockResolvedValue(minimalHtml());

    await fetchArticle(ctx, frontendUrl);

    expect(mockedHttpGetText).toHaveBeenCalledWith(expectedBackendUrl, expect.any(Object));
  });

  it('should only replace the hostname and leave the path intact', async () => {
    const deepPath = '/en-US/bundle/jamf-pro-documentation/page/sub/dir/article.html';
    const expectedDeepPath = '/bundle/jamf-pro-documentation/page/sub/dir/article.html';
    const frontendUrl = `https://learn.jamf.com${deepPath}`;

    mockedHttpGetText.mockResolvedValue(minimalHtml());

    await fetchArticle(ctx, frontendUrl);

    expect(mockedHttpGetText).toHaveBeenCalledWith(
      `https://learn-be.jamf.com${expectedDeepPath}`,
      expect.any(Object)
    );
  });
});

// ============================================================================
// validateBundleId — exercised through discoverLatestBundleId inside fetchTableOfContents
// ============================================================================

describe('validateBundleId — bundle ID pattern enforcement', () => {
  beforeEach(() => {
    vi.mocked(ctx.cache.get).mockResolvedValue(null);
    vi.mocked(ctx.cache.set).mockResolvedValue(undefined);
  });

  // When getBundleIdForVersion returns null, fetchTableOfContents falls back
  // to discoverLatestBundleId which calls validateBundleId on bundle_id values
  // returned by the Zoomin search API.

  it('should accept a simple lowercase bundle ID from the discovery API', async () => {
    const { getBundleIdForVersion } = await import('../../src/core/services/metadata.js');
    vi.mocked(getBundleIdForVersion).mockResolvedValueOnce(null);

    // First call: discovery search; second: TOC fetch
    mockedHttpGetJson
      .mockResolvedValueOnce({
        status: 'ok',
        Results: [{
          leading_result: {
            title: 'Article',
            url: 'https://learn-be.jamf.com/page.html',
            snippet: '',
            bundle_id: 'jamf-pro-documentation',
            page_id: 'p1',
            publication_title: 'Jamf Pro'
          }
        }]
      })
      .mockResolvedValueOnce(
        { 'nav-1': makeTocHtml([{ href: 'https://learn-be.jamf.com/page.html', label: 'Page' }]) }
      );

    const { toc } = await fetchTableOfContents(ctx, 'jamf-pro');
    expect(toc.length).toBeGreaterThan(0);
  });

  it('should accept a versioned bundle ID (letters, digits, dots, hyphens)', async () => {
    const { getBundleIdForVersion } = await import('../../src/core/services/metadata.js');
    vi.mocked(getBundleIdForVersion).mockResolvedValueOnce(null);

    mockedHttpGetJson
      .mockResolvedValueOnce({
        status: 'ok',
        Results: [{
          leading_result: {
            title: 'Article',
            url: 'https://learn-be.jamf.com/page.html',
            snippet: '',
            bundle_id: 'jamf-pro-documentation-11.14.0',
            page_id: 'p1',
            publication_title: 'Jamf Pro'
          }
        }]
      })
      .mockResolvedValueOnce(
        { 'nav-1': makeTocHtml([{ href: 'https://learn-be.jamf.com/page.html', label: 'Page' }]) }
      );

    const { toc } = await fetchTableOfContents(ctx, 'jamf-pro');
    expect(toc.length).toBeGreaterThan(0);
  });

  it('should accept a bundle ID containing underscores represented as dots', async () => {
    const { getBundleIdForVersion } = await import('../../src/core/services/metadata.js');
    vi.mocked(getBundleIdForVersion).mockResolvedValueOnce(null);

    mockedHttpGetJson
      .mockResolvedValueOnce({
        status: 'ok',
        Results: [{
          leading_result: {
            title: 'Article',
            url: 'https://learn-be.jamf.com/page.html',
            snippet: '',
            bundle_id: 'jamf-pro-documentation.2024',
            page_id: 'p1',
            publication_title: 'Jamf Pro'
          }
        }]
      })
      .mockResolvedValueOnce(
        { 'nav-1': makeTocHtml([{ href: 'https://learn-be.jamf.com/page.html', label: 'Page' }]) }
      );

    const { toc } = await fetchTableOfContents(ctx, 'jamf-pro');
    expect(toc.length).toBeGreaterThan(0);
  });

  it('should reject a bundle ID containing a path traversal sequence and throw NOT_FOUND', async () => {
    const { getBundleIdForVersion } = await import('../../src/core/services/metadata.js');
    vi.mocked(getBundleIdForVersion).mockResolvedValueOnce(null);

    // Discovery returns a bundle_id that does NOT start with "jamf-pro-documentation"
    // so it is skipped and discoverLatestBundleId returns null -> NOT_FOUND.
    // This also verifies that a malicious bundle_id is never used.
    mockedHttpGetJson.mockResolvedValue({
      status: 'ok',
      Results: [{
        leading_result: {
          title: 'Evil',
          url: 'https://learn-be.jamf.com/page.html',
          snippet: '',
          bundle_id: '../../../etc/passwd',
          page_id: 'p1',
          publication_title: 'Evil'
        }
      }]
    });

    const { JamfDocsErrorCode } = await import('../../src/core/types.js');
    await expect(fetchTableOfContents(ctx, 'jamf-pro')).rejects.toMatchObject({
      code: JamfDocsErrorCode.NOT_FOUND
    });
  });

  it('should reject a bundle ID with uppercase letters and throw NOT_FOUND', async () => {
    const { getBundleIdForVersion } = await import('../../src/core/services/metadata.js');
    vi.mocked(getBundleIdForVersion).mockResolvedValueOnce(null);

    // Bundle starts with "jamf-pro-documentation" so validateBundleId IS called,
    // but the uppercase portion makes the entire bundle_id fail the regex.
    mockedHttpGetJson.mockResolvedValue({
      status: 'ok',
      Results: [{
        leading_result: {
          title: 'Article',
          url: 'https://learn-be.jamf.com/page.html',
          snippet: '',
          bundle_id: 'jamf-pro-documentation-UPPERCASE',
          page_id: 'p1',
          publication_title: 'Jamf Pro'
        }
      }]
    });

    const { JamfDocsErrorCode } = await import('../../src/core/types.js');
    await expect(fetchTableOfContents(ctx, 'jamf-pro')).rejects.toMatchObject({
      code: JamfDocsErrorCode.NOT_FOUND
    });
  });

  it('should reject a bundle ID with spaces and throw NOT_FOUND', async () => {
    const { getBundleIdForVersion } = await import('../../src/core/services/metadata.js');
    vi.mocked(getBundleIdForVersion).mockResolvedValueOnce(null);

    mockedHttpGetJson.mockResolvedValue({
      status: 'ok',
      Results: [{
        leading_result: {
          title: 'Article',
          url: 'https://learn-be.jamf.com/page.html',
          snippet: '',
          bundle_id: 'jamf-pro-documentation rm -rf /',
          page_id: 'p1',
          publication_title: 'Jamf Pro'
        }
      }]
    });

    const { JamfDocsErrorCode } = await import('../../src/core/types.js');
    await expect(fetchTableOfContents(ctx, 'jamf-pro')).rejects.toMatchObject({
      code: JamfDocsErrorCode.NOT_FOUND
    });
  });

  it('should reject a bundle ID beginning with a non-alphanumeric character', async () => {
    const { getBundleIdForVersion } = await import('../../src/core/services/metadata.js');
    vi.mocked(getBundleIdForVersion).mockResolvedValueOnce(null);

    // Leading "-" makes it fail the regex anchor ^[a-z0-9]
    mockedHttpGetJson.mockResolvedValue({
      status: 'ok',
      Results: [{
        leading_result: {
          title: 'Article',
          url: 'https://learn-be.jamf.com/page.html',
          snippet: '',
          bundle_id: '-jamf-pro-documentation',
          page_id: 'p1',
          publication_title: 'Jamf Pro'
        }
      }]
    });

    const { JamfDocsErrorCode } = await import('../../src/core/types.js');
    await expect(fetchTableOfContents(ctx, 'jamf-pro')).rejects.toMatchObject({
      code: JamfDocsErrorCode.NOT_FOUND
    });
  });
});

// ============================================================================
// Combined security scenario — end-to-end hostname + URL transform
// ============================================================================

describe('combined security — hostname filter + URL rewrite together', () => {
  beforeEach(() => {
    vi.mocked(ctx.cache.get).mockResolvedValue(null);
    vi.mocked(ctx.cache.set).mockResolvedValue(undefined);
  });

  it('should both filter dangerous hosts and rewrite safe backend URLs in one response', async () => {
    mockedHttpGetJson.mockResolvedValue(
      makeSearchResponse([
        validRow({
          title: 'Safe Article',
          url: 'https://learn-be.jamf.com/en-US/bundle/jamf-pro-documentation/page/safe.html'
        }),
        validRow({
          title: 'Injected Article',
          url: 'https://evil.example.com/steal'
        })
      ])
    );

    const { results } = await searchDocumentation(ctx, { query: 'safe' });

    expect(results).toHaveLength(1);
    expect(results[0]?.title).toBe('Safe Article');
    // Hostname must have been rewritten to the frontend domain
    expect(results[0]?.url).toBe(
      'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/safe.html'
    );
  });

  it('should not expose learn-be.jamf.com URLs to callers even for docs.jamf.com inputs', async () => {
    // docs.jamf.com is in the allowlist; transformToFrontendUrl only rewrites learn-be.
    // So docs.jamf.com URLs should pass through unchanged.
    const docsUrl = 'https://docs.jamf.com/jamf-pro/documentation/Enrollment.html';
    mockedHttpGetJson.mockResolvedValue(
      makeSearchResponse([validRow({ url: docsUrl })])
    );

    const { results } = await searchDocumentation(ctx, { query: 'enrollment' });

    expect(results[0]?.url).toBe(docsUrl);
  });

  it('should rewrite the URL in the returned article.url but use backend for the HTTP call', async () => {
    const frontendUrl = 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/combo.html';
    const expectedBackendUrl = 'https://learn-be.jamf.com/bundle/jamf-pro-documentation/page/combo.html';
    const expectedDisplayUrl = 'https://learn.jamf.com/bundle/jamf-pro-documentation/page/combo.html';

    mockedHttpGetText.mockResolvedValue(
      '<html><body><article><h1>Combo Test</h1><p>Content</p></article></body></html>'
    );

    const article = await fetchArticle(ctx, frontendUrl);

    // HTTP fetch goes to the backend (locale stripped)
    expect(mockedHttpGetText).toHaveBeenCalledWith(expectedBackendUrl, expect.any(Object));
    // The caller sees the frontend URL (locale stripped)
    expect(article.url).toBe(expectedDisplayUrl);
    expect(article.url).not.toContain('learn-be.jamf.com');
  });
});
