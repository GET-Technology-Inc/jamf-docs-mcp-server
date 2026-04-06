/**
 * Unit tests for article-service — fetchArticleFromFt and resolveAndFetchArticle
 *
 * Mocks at the HTTP layer (http-client) so that ft-client, content-parser,
 * and topic-resolver all run their real code paths.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module mock: HTTP layer only ────────────────────────────────────────────

vi.mock('../../../src/core/http-client.js', async () => {
  const actual = await import('../../../src/core/http-client.js');
  return {
    httpGetJson: vi.fn(),
    httpGetText: vi.fn(),
    httpPostJson: vi.fn(),
    HttpError: actual.HttpError,
  };
});

// ── Imports after mock ──────────────────────────────────────────────────────

import { httpGetJson, httpGetText, HttpError } from '../../../src/core/http-client.js';
import {
  fetchArticleFromFt,
  resolveAndFetchArticle,
} from '../../../src/core/services/article-service.js';
import {
  createMockCache,
  createMockContext,
  createMockArticleProvider,
} from '../../helpers/mock-context.js';
import { loadFixture, createFetchArticleResult } from '../../helpers/fixtures.js';
import { JamfDocsError, JamfDocsErrorCode } from '../../../src/core/types.js';
import type { FtTopicInfo } from '../../../src/core/types.js';

// ── Typed mock helpers ──────────────────────────────────────────────────────

const mockedGetJson = vi.mocked(httpGetJson);
const mockedGetText = vi.mocked(httpGetText);

// ── Shared test data ────────────────────────────────────────────────────────

const MAP_ID = 'jamf-pro-documentation';
const CONTENT_ID = 'MDM_Profile_Settings';
const ARTICLE_URL =
  'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/MDM_Profile_Settings.html';

/** Default topic metadata fixture (from ft-topic-metadata.json) */
const defaultMetadata = loadFixture<FtTopicInfo>('ft-topic-metadata.json');

/** Simple HTML that the real content-parser can process */
const DEFAULT_HTML = [
  '<html><body>',
  '<h1>MDM Profile Settings</h1>',
  '<div class="taskbody">',
  '<h2>Overview</h2>',
  '<p>This article covers MDM profiles.</p>',
  '<h2>Prerequisites</h2>',
  '<p>You need Jamf Pro.</p>',
  '</div>',
  '</body></html>',
].join('');

/** Mutable per-test state used by the URL router */
let currentTopicMetadata: FtTopicInfo;
let currentArticleHtml: string;

// ── URL-based routing setup ─────────────────────────────────────────────────

function setupHttpRouting(): void {
  mockedGetJson.mockImplementation(async (url: string) => {
    if (url.endsWith('/api/khub/maps')) {
      return loadFixture('ft-maps-list.json');
    }
    // /api/khub/maps/{mapId}/topics/{contentId} -> topic metadata
    if (url.match(/\/topics\/[^/]+$/) && !url.includes('/content')) {
      return currentTopicMetadata;
    }
    throw new Error(`Unexpected GET JSON: ${url}`);
  });

  mockedGetText.mockImplementation(async (url: string) => {
    if (url.includes('/content')) {
      return currentArticleHtml;
    }
    throw new Error(`Unexpected GET text: ${url}`);
  });
}

// ── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  // Reset per-test state to defaults
  currentTopicMetadata = defaultMetadata;
  currentArticleHtml = DEFAULT_HTML;

  setupHttpRouting();
});

// =============================================================================
// fetchArticleFromFt
// =============================================================================

describe('fetchArticleFromFt()', () => {
  // ── Cache miss: normal fetch ──────────────────────────────────────────────

  describe('cache miss — normal fetch', () => {
    it('should return article with title, content, sections, and tokenInfo', async () => {
      const cache = createMockCache();

      const result = await fetchArticleFromFt(
        cache, MAP_ID, CONTENT_ID, ARTICLE_URL, {},
      );

      expect(result.title).toBe('Computer Configuration Profiles');
      expect(result.content).toContain('Overview');
      expect(result.content).toContain('MDM profiles');
      expect(result.sections).toBeDefined();
      expect(result.sections.length).toBeGreaterThan(0);
      expect(result.tokenInfo).toBeDefined();
      expect(result.tokenInfo.truncated).toBe(false);
      expect(result.mapId).toBe(MAP_ID);
      expect(result.contentId).toBe(CONTENT_ID);
    });

    it('should fetch metadata and content in parallel on cache miss', async () => {
      const cache = createMockCache();

      await fetchArticleFromFt(cache, MAP_ID, CONTENT_ID, ARTICLE_URL, {});

      // httpGetJson called once for metadata, httpGetText once for content
      expect(mockedGetJson).toHaveBeenCalledOnce();
      expect(mockedGetText).toHaveBeenCalledOnce();
      // Verify the correct URLs were requested
      expect(mockedGetJson).toHaveBeenCalledWith(
        expect.stringContaining(`/topics/${CONTENT_ID}`)
      );
      expect(mockedGetText).toHaveBeenCalledWith(
        expect.stringContaining(`/topics/${CONTENT_ID}/content`)
      );
    });

    it('should extract product and version from metadata', async () => {
      const cache = createMockCache();
      // Default fixture has version_bundle_stem=jamf-pro-documentation, version=11.25.0
      const result = await fetchArticleFromFt(cache, MAP_ID, CONTENT_ID, ARTICLE_URL, {});

      expect(result.product).toBe('Jamf Pro');
      expect(result.version).toBe('11.25.0');
    });

    it('should set version to "current" when metadata has no version value', async () => {
      const cache = createMockCache();
      currentTopicMetadata = {
        ...defaultMetadata,
        metadata: [],
      };

      const result = await fetchArticleFromFt(cache, MAP_ID, CONTENT_ID, ARTICLE_URL, {});

      expect(result.version).toBe('current');
    });

    it('should include breadcrumb when parser extracts entries', async () => {
      const cache = createMockCache();
      // Use HTML with a breadcrumb nav
      currentArticleHtml = [
        '<html><body>',
        '<nav aria-label="breadcrumb"><a href="/a">Jamf Pro</a><a href="/b">Device Management</a><a href="/c">MDM</a></nav>',
        '<h1>MDM Profile Settings</h1>',
        '<div class="taskbody"><p>Content here.</p></div>',
        '</body></html>',
      ].join('');

      const result = await fetchArticleFromFt(cache, MAP_ID, CONTENT_ID, ARTICLE_URL, {});

      expect(result.breadcrumb).toEqual(['Jamf Pro', 'Device Management', 'MDM']);
    });

    it('should omit breadcrumb when it is empty', async () => {
      const cache = createMockCache();
      // DEFAULT_HTML has no breadcrumb elements

      const result = await fetchArticleFromFt(cache, MAP_ID, CONTENT_ID, ARTICLE_URL, {});

      expect(result.breadcrumb).toBeUndefined();
    });

    it('should include relatedArticles when present and includeRelated is true', async () => {
      const cache = createMockCache();
      currentArticleHtml = [
        '<html><body>',
        '<h1>MDM Profile Settings</h1>',
        '<div class="taskbody"><p>Content here.</p></div>',
        '<nav class="related-links">',
        '<a href="https://learn.jamf.com/en-US/bundle/jamf-pro/page/Policies.html">Policies</a>',
        '</nav>',
        '</body></html>',
      ].join('');

      const result = await fetchArticleFromFt(
        cache, MAP_ID, CONTENT_ID, ARTICLE_URL, { includeRelated: true },
      );

      expect(result.relatedArticles).toBeDefined();
      expect(result.relatedArticles!.length).toBeGreaterThan(0);
      expect(result.relatedArticles![0].title).toBe('Policies');
    });

    it('should omit relatedArticles when includeRelated is false even if parsed', async () => {
      const cache = createMockCache();
      currentArticleHtml = [
        '<html><body>',
        '<h1>MDM Profile Settings</h1>',
        '<div class="taskbody"><p>Content here.</p></div>',
        '<nav class="related-links">',
        '<a href="https://learn.jamf.com/en-US/bundle/jamf-pro/page/Policies.html">Policies</a>',
        '</nav>',
        '</body></html>',
      ].join('');

      const result = await fetchArticleFromFt(
        cache, MAP_ID, CONTENT_ID, ARTICLE_URL, { includeRelated: false },
      );

      // Related articles filtered out at the result layer even though parser extracts them
      expect(result.relatedArticles).toBeUndefined();
    });

    it('should omit relatedArticles when empty', async () => {
      const cache = createMockCache();
      // DEFAULT_HTML has no related-links elements

      const result = await fetchArticleFromFt(cache, MAP_ID, CONTENT_ID, ARTICLE_URL, {});

      expect(result.relatedArticles).toBeUndefined();
    });

    it('should invoke parseArticle with includeRelated true for cache safety', async () => {
      const cache = createMockCache();
      // Even when caller passes includeRelated: false, the cached data should
      // include related articles. Verify by fetching twice with different flags.
      currentArticleHtml = [
        '<html><body>',
        '<h1>Test</h1>',
        '<div class="taskbody"><p>Content.</p></div>',
        '<nav class="related-links">',
        '<a href="https://learn.jamf.com/page/A.html">Link A</a>',
        '</nav>',
        '</body></html>',
      ].join('');

      // First fetch with includeRelated: false
      await fetchArticleFromFt(cache, MAP_ID, CONTENT_ID, ARTICLE_URL, { includeRelated: false });

      vi.clearAllMocks();

      // Second fetch with includeRelated: true should get cache hit with related articles
      const result = await fetchArticleFromFt(
        cache, MAP_ID, CONTENT_ID, ARTICLE_URL, { includeRelated: true },
      );

      // Cache hit — no HTTP calls made
      expect(mockedGetJson).not.toHaveBeenCalled();
      expect(mockedGetText).not.toHaveBeenCalled();
      // Related articles should be present from cached data
      expect(result.relatedArticles).toBeDefined();
      expect(result.relatedArticles!.length).toBeGreaterThan(0);
    });
  });

  // ── Cache hit ─────────────────────────────────────────────────────────────

  describe('cache hit', () => {
    it('should return cached article without calling FT API', async () => {
      const cache = createMockCache();
      // First call populates cache
      await fetchArticleFromFt(cache, MAP_ID, CONTENT_ID, ARTICLE_URL, {});
      vi.clearAllMocks();

      // Second call should be a cache hit
      const result = await fetchArticleFromFt(cache, MAP_ID, CONTENT_ID, ARTICLE_URL, {});

      expect(mockedGetJson).not.toHaveBeenCalled();
      expect(mockedGetText).not.toHaveBeenCalled();
      expect(result.title).toBe('Computer Configuration Profiles');
    });

    it('should use cache key scoped to mapId and contentId', async () => {
      const cache = createMockCache();

      // Call with two different content IDs
      await fetchArticleFromFt(cache, MAP_ID, 'article-A', ARTICLE_URL, {});
      await fetchArticleFromFt(cache, MAP_ID, 'article-B', ARTICLE_URL, {});

      // API should be called twice (different cache keys)
      expect(mockedGetText).toHaveBeenCalledTimes(2);
    });
  });

  // ── summaryOnly mode ──────────────────────────────────────────────────────

  describe('summaryOnly mode', () => {
    it('should return summary and outline instead of full content', async () => {
      const cache = createMockCache();
      currentArticleHtml = [
        '<html><body>',
        '<h1>MDM Profile Settings</h1>',
        '<div class="taskbody">',
        '<h2>Overview</h2><p>This article covers MDM.</p>',
        '<h2>Prerequisites</h2><p>You need Jamf Pro admin access.</p>',
        '</div>',
        '</body></html>',
      ].join('');

      const result = await fetchArticleFromFt(
        cache, MAP_ID, CONTENT_ID, ARTICLE_URL, { summaryOnly: true },
      );

      expect(result.content).toContain('## Summary');
      expect(result.content).toContain('## Article Outline');
      expect(result.content).toContain('sections');
      expect(result.tokenInfo).toBeDefined();
    });

    it('should include section token estimates in outline', async () => {
      const cache = createMockCache();
      currentArticleHtml = [
        '<html><body>',
        '<h1>MDM Profile Settings</h1>',
        '<div class="taskbody">',
        '<h2>Overview</h2><p>Content here.</p>',
        '<h2>Details</h2><p>More content here.</p>',
        '</div>',
        '</body></html>',
      ].join('');

      const result = await fetchArticleFromFt(
        cache, MAP_ID, CONTENT_ID, ARTICLE_URL, { summaryOnly: true },
      );

      expect(result.content).toMatch(/~\d+ tokens/);
    });
  });

  // ── Section extraction ────────────────────────────────────────────────────

  describe('section extraction', () => {
    it('should return only the specified section content', async () => {
      const cache = createMockCache();
      currentArticleHtml = [
        '<html><body>',
        '<h1>MDM Profile Settings</h1>',
        '<div class="taskbody">',
        '<h2>Overview</h2><p>This is the overview section.</p>',
        '<h2>Prerequisites</h2><p>Install Jamf Pro.</p>',
        '</div>',
        '</body></html>',
      ].join('');

      const result = await fetchArticleFromFt(
        cache, MAP_ID, CONTENT_ID, ARTICLE_URL, { section: 'Prerequisites' },
      );

      expect(result.content).toContain('Prerequisites');
      expect(result.content).toContain('Install Jamf Pro');
    });

    it('should return fallback message when section is not found', async () => {
      const cache = createMockCache();
      currentArticleHtml = [
        '<html><body>',
        '<h1>MDM Profile Settings</h1>',
        '<div class="taskbody">',
        '<h2>Overview</h2><p>Content.</p>',
        '<h2>Details</h2><p>More content.</p>',
        '</div>',
        '</body></html>',
      ].join('');

      const result = await fetchArticleFromFt(
        cache, MAP_ID, CONTENT_ID, ARTICLE_URL, { section: 'NonExistentSection' },
      );

      expect(result.content).toContain('Section "NonExistentSection" not found');
      expect(result.content).toContain('Available sections');
    });

    it('should list available sections in fallback message', async () => {
      const cache = createMockCache();
      currentArticleHtml = [
        '<html><body>',
        '<h1>MDM Profile Settings</h1>',
        '<div class="taskbody">',
        '<h2>Overview</h2><p>Content.</p>',
        '<h2>Configuration</h2><p>Steps.</p>',
        '</div>',
        '</body></html>',
      ].join('');

      const result = await fetchArticleFromFt(
        cache, MAP_ID, CONTENT_ID, ARTICLE_URL, { section: 'Missing' },
      );

      expect(result.content).toContain('- Overview');
      expect(result.content).toContain('- Configuration');
    });

    it('should treat empty string section as full content mode', async () => {
      const cache = createMockCache();
      currentArticleHtml = [
        '<html><body>',
        '<h1>MDM Profile Settings</h1>',
        '<div class="taskbody">',
        '<h2>Overview</h2><p>Full content here.</p>',
        '</div>',
        '</body></html>',
      ].join('');

      const result = await fetchArticleFromFt(
        cache, MAP_ID, CONTENT_ID, ARTICLE_URL, { section: '' },
      );

      // Full content returned (not a section-not-found message)
      expect(result.content).toContain('Full content here');
      expect(result.content).not.toContain('not found');
    });
  });

  // ── Token truncation ──────────────────────────────────────────────────────

  describe('token truncation', () => {
    it('should truncate content when it exceeds maxTokens', async () => {
      // Build long HTML that produces many sections
      const sections = Array.from({ length: 200 }, (_, i) =>
        `<h2>Section ${i}</h2><p>This is the content for section ${i} with enough text to consume tokens.</p>`
      ).join('');
      currentArticleHtml = `<html><body><h1>Long Article</h1><div class="taskbody">${sections}</div></body></html>`;

      const cache = createMockCache();

      // Very small token limit to force truncation
      const result = await fetchArticleFromFt(
        cache, MAP_ID, CONTENT_ID, ARTICLE_URL, { maxTokens: 50 },
      );

      expect(result.tokenInfo.truncated).toBe(true);
    });

    it('should not truncate content within token limit', async () => {
      const cache = createMockCache();
      currentArticleHtml = [
        '<html><body>',
        '<h1>Short</h1>',
        '<div class="taskbody"><p>Brief article.</p></div>',
        '</body></html>',
      ].join('');

      const result = await fetchArticleFromFt(
        cache, MAP_ID, CONTENT_ID, ARTICLE_URL, { maxTokens: 5000 },
      );

      expect(result.tokenInfo.truncated).toBe(false);
    });

    it('should use DEFAULT_MAX_TOKENS (5000) when maxTokens is not specified', async () => {
      const cache = createMockCache();

      const result = await fetchArticleFromFt(
        cache, MAP_ID, CONTENT_ID, ARTICLE_URL, {},
      );

      expect(result.tokenInfo.maxTokens).toBe(5000);
    });
  });

  // ── Network errors ────────────────────────────────────────────────────────

  describe('network errors', () => {
    it('should propagate fetchTopicContent errors', async () => {
      const cache = createMockCache();
      mockedGetText.mockRejectedValue(
        new HttpError(404, 'Not Found', 'https://learn.jamf.com/api/khub/maps/x/topics/y/content')
      );

      await expect(
        fetchArticleFromFt(cache, MAP_ID, CONTENT_ID, ARTICLE_URL, {}),
      ).rejects.toThrow('HTTP 404');
    });

    it('should propagate fetchTopicMetadata errors', async () => {
      const cache = createMockCache();
      mockedGetJson.mockRejectedValue(
        new HttpError(429, 'Too Many Requests', 'https://learn.jamf.com/api/khub/maps/x/topics/y')
      );

      await expect(
        fetchArticleFromFt(cache, MAP_ID, CONTENT_ID, ARTICLE_URL, {}),
      ).rejects.toThrow('HTTP 429');
    });

    it('should not cache results when fetch fails', async () => {
      const cache = createMockCache();

      // First call fails (text fetch rejects)
      mockedGetText.mockRejectedValueOnce(new Error('Network error'));

      await expect(
        fetchArticleFromFt(cache, MAP_ID, CONTENT_ID, ARTICLE_URL, {}),
      ).rejects.toThrow('Network error');

      // Restore normal routing for subsequent calls
      setupHttpRouting();

      // Second call should retry (cache should NOT have a stale entry)
      const result = await fetchArticleFromFt(cache, MAP_ID, CONTENT_ID, ARTICLE_URL, {});
      expect(result.title).toBeDefined();
      // httpGetText should have been called twice total (once for failure, once for success)
      expect(mockedGetText).toHaveBeenCalledTimes(2);
    });
  });

  // ── Display URL derivation ────────────────────────────────────────────────

  describe('display URL derivation', () => {
    it('should use readerUrl from metadata when available', async () => {
      const cache = createMockCache();
      // Default fixture has readerUrl as a full URL pointing to learn.jamf.com
      // buildDisplayUrl (running for real) returns absolute allowed URLs as-is

      const result = await fetchArticleFromFt(cache, MAP_ID, CONTENT_ID, ARTICLE_URL, {});

      // The fixture readerUrl is an absolute URL, so buildDisplayUrl returns it as-is
      expect(result.url).toBe(defaultMetadata.readerUrl);
    });

    it('should fall back to articleUrl when readerUrl is empty', async () => {
      const cache = createMockCache();
      currentTopicMetadata = {
        ...defaultMetadata,
        readerUrl: '',
      };

      const result = await fetchArticleFromFt(cache, MAP_ID, CONTENT_ID, ARTICLE_URL, {});

      expect(result.url).toBe(ARTICLE_URL);
    });

    it('should prepend DOCS_BASE_URL for relative readerUrl paths', async () => {
      const cache = createMockCache();
      const relativePath = '/r/en-US/jamf-pro-documentation/MDM_Profile_Settings';
      currentTopicMetadata = {
        ...defaultMetadata,
        readerUrl: relativePath,
      };

      const result = await fetchArticleFromFt(cache, MAP_ID, CONTENT_ID, ARTICLE_URL, {});

      // buildDisplayUrl adds the base URL for relative paths
      expect(result.url).toBe(`https://learn.jamf.com${relativePath}`);
    });
  });
});

// =============================================================================
// resolveAndFetchArticle
// =============================================================================

describe('resolveAndFetchArticle()', () => {
  // ── Direct IDs: skip URL resolution ───────────────────────────────────────

  describe('with direct mapId + contentId', () => {
    it('should skip topicResolver.resolve when both IDs are provided', async () => {
      const ctx = createMockContext({
        articleProvider: createMockArticleProvider(() => createFetchArticleResult()),
      });
      const resolveSpy = vi.fn();
      ctx.topicResolver.resolve = resolveSpy;

      await resolveAndFetchArticle(
        ctx, { url: ARTICLE_URL, mapId: MAP_ID, contentId: CONTENT_ID }, {},
      );

      expect(resolveSpy).not.toHaveBeenCalled();
    });

    it('should call topicResolver.resolve when mapId is missing', async () => {
      const ctx = createMockContext({
        articleProvider: createMockArticleProvider(() => createFetchArticleResult()),
      });
      ctx.topicResolver.resolve = vi.fn().mockResolvedValue({
        mapId: MAP_ID,
        contentId: CONTENT_ID,
        locale: 'en-US',
      });

      await resolveAndFetchArticle(ctx, { url: ARTICLE_URL, contentId: CONTENT_ID }, {});

      expect(ctx.topicResolver.resolve).toHaveBeenCalledWith({ url: ARTICLE_URL });
    });

    it('should call topicResolver.resolve when contentId is missing', async () => {
      const ctx = createMockContext({
        articleProvider: createMockArticleProvider(() => createFetchArticleResult()),
      });
      ctx.topicResolver.resolve = vi.fn().mockResolvedValue({
        mapId: MAP_ID,
        contentId: CONTENT_ID,
        locale: 'en-US',
      });

      await resolveAndFetchArticle(ctx, { url: ARTICLE_URL, mapId: MAP_ID }, {});

      expect(ctx.topicResolver.resolve).toHaveBeenCalledWith({ url: ARTICLE_URL });
    });
  });

  // ── ArticleProvider.getArticleByIds ───────────────────────────────────────

  describe('ArticleProvider.getArticleByIds', () => {
    it('should return provider result when non-null', async () => {
      const providerResult = createFetchArticleResult({ title: 'From Provider' });
      const ctx = createMockContext({
        articleProvider: createMockArticleProvider(() => providerResult),
      });
      ctx.topicResolver.resolve = vi.fn().mockResolvedValue({
        mapId: MAP_ID, contentId: CONTENT_ID, locale: 'en-US',
      });

      const result = await resolveAndFetchArticle(
        ctx, { url: ARTICLE_URL, mapId: MAP_ID, contentId: CONTENT_ID }, {},
      );

      expect(result.title).toBe('From Provider');
      expect(ctx.articleProvider!.getArticleByIds).toHaveBeenCalledWith(
        MAP_ID, CONTENT_ID, {},
      );
    });

    it('should attach mapId and contentId from resolution to provider result', async () => {
      const providerResult = createFetchArticleResult({
        mapId: undefined, contentId: undefined,
      });
      const ctx = createMockContext({
        articleProvider: createMockArticleProvider(() => providerResult),
      });

      const result = await resolveAndFetchArticle(
        ctx, { url: ARTICLE_URL, mapId: MAP_ID, contentId: CONTENT_ID }, {},
      );

      expect(result.mapId).toBe(MAP_ID);
      expect(result.contentId).toBe(CONTENT_ID);
    });
  });

  // ── ArticleProvider.getArticle URL fallback ───────────────────────────────

  describe('ArticleProvider.getArticle URL fallback', () => {
    it('should try URL-based getArticle when getArticleByIds returns null', async () => {
      const urlResult = createFetchArticleResult({ title: 'From URL Fallback' });
      const articleProvider = {
        getArticleByIds: vi.fn().mockResolvedValue(null),
        getArticle: vi.fn().mockResolvedValue(urlResult),
      };
      const ctx = createMockContext({ articleProvider });

      const result = await resolveAndFetchArticle(
        ctx, { url: ARTICLE_URL, mapId: MAP_ID, contentId: CONTENT_ID }, {},
      );

      expect(articleProvider.getArticle).toHaveBeenCalledWith(ARTICLE_URL, {});
      expect(result.title).toBe('From URL Fallback');
    });

    it('should not call getArticle when articleUrl is empty string', async () => {
      const articleProvider = {
        getArticleByIds: vi.fn().mockResolvedValue(null),
        getArticle: vi.fn().mockResolvedValue(createFetchArticleResult()),
      };
      const ctx = createMockContext({ articleProvider });

      // Falls through to FT API which uses the HTTP mocks
      await resolveAndFetchArticle(
        ctx, { url: '', mapId: MAP_ID, contentId: CONTENT_ID }, {},
      );

      expect(articleProvider.getArticle).not.toHaveBeenCalled();
    });
  });

  // ── Provider not configured ───────────────────────────────────────────────

  describe('no articleProvider configured', () => {
    it('should fall through to FT API when no provider is set', async () => {
      const ctx = createMockContext(); // no articleProvider

      const result = await resolveAndFetchArticle(
        ctx, { url: ARTICLE_URL, mapId: MAP_ID, contentId: CONTENT_ID }, {},
      );

      // HTTP layer was called (real ft-client, real content-parser ran)
      expect(mockedGetText).toHaveBeenCalled();
      expect(result.title).toBe('Computer Configuration Profiles');
    });
  });

  // ── Provider returns null: fall through to FT API ─────────────────────────

  describe('provider returns null', () => {
    it('should fall through to FT API when both provider methods return null', async () => {
      const articleProvider = {
        getArticleByIds: vi.fn().mockResolvedValue(null),
        getArticle: vi.fn().mockResolvedValue(null),
      };
      const ctx = createMockContext({ articleProvider });

      const result = await resolveAndFetchArticle(
        ctx, { url: ARTICLE_URL, mapId: MAP_ID, contentId: CONTENT_ID }, {},
      );

      // FT API was used via HTTP layer
      expect(mockedGetText).toHaveBeenCalledWith(
        expect.stringContaining(`/topics/${CONTENT_ID}/content`),
      );
      expect(result.title).toBe('Computer Configuration Profiles');
    });
  });

  // ── Resolution error propagation ──────────────────────────────────────────

  describe('resolution error propagation', () => {
    it('should propagate JamfDocsError from topicResolver', async () => {
      const ctx = createMockContext();
      const jamfError = new JamfDocsError(
        'URL not recognized',
        JamfDocsErrorCode.INVALID_URL,
        ARTICLE_URL,
      );
      ctx.topicResolver.resolve = vi.fn().mockRejectedValue(jamfError);

      await expect(
        resolveAndFetchArticle(ctx, { url: ARTICLE_URL }, {}),
      ).rejects.toBeInstanceOf(JamfDocsError);
    });

    it('should propagate generic errors from topicResolver', async () => {
      const ctx = createMockContext();
      ctx.topicResolver.resolve = vi.fn().mockRejectedValue(new Error('DNS failure'));

      await expect(
        resolveAndFetchArticle(ctx, { url: ARTICLE_URL }, {}),
      ).rejects.toThrow('DNS failure');
    });

    it('should propagate errors from articleProvider.getArticleByIds', async () => {
      const articleProvider = {
        getArticleByIds: vi.fn().mockRejectedValue(new Error('R2 storage unavailable')),
      };
      const ctx = createMockContext({ articleProvider });

      await expect(
        resolveAndFetchArticle(
          ctx, { url: ARTICLE_URL, mapId: MAP_ID, contentId: CONTENT_ID }, {},
        ),
      ).rejects.toThrow('R2 storage unavailable');
    });
  });
});
