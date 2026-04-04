/**
 * Unit tests for article-service — fetchArticleFromFt and resolveAndFetchArticle
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module mocks must be declared before any imports ──────────────────────────

vi.mock('../../../src/core/services/ft-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/core/services/ft-client.js')>();
  return {
    ...actual,
    fetchTopicContent: vi.fn(),
    fetchTopicMetadata: vi.fn(),
  };
});

vi.mock('../../../src/core/services/content-parser.js', () => ({
  parseArticle: vi.fn(),
}));

vi.mock('../../../src/core/services/topic-resolver.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/core/services/topic-resolver.js')>();
  return {
    ...actual,
    buildDisplayUrl: vi.fn((url: string) => url),
  };
});

// ── Imports after mocks ───────────────────────────────────────────────────────

import { fetchTopicContent, fetchTopicMetadata } from '../../../src/core/services/ft-client.js';
import { parseArticle } from '../../../src/core/services/content-parser.js';
import {
  fetchArticleFromFt,
  resolveAndFetchArticle,
} from '../../../src/core/services/article-service.js';
import { createMockCache, createMockContext, createMockArticleProvider } from '../../helpers/mock-context.js';
import { createFetchArticleResult } from '../../helpers/fixtures.js';
import { JamfDocsError, JamfDocsErrorCode } from '../../../src/core/types.js';

// ── Typed mock helpers ────────────────────────────────────────────────────────

const mockedFetchTopicContent = vi.mocked(fetchTopicContent);
const mockedFetchTopicMetadata = vi.mocked(fetchTopicMetadata);
const mockedParseArticle = vi.mocked(parseArticle);

// ── Shared test data ──────────────────────────────────────────────────────────

const MAP_ID = 'jamf-pro-documentation';
const CONTENT_ID = 'MDM_Profile_Settings';
const ARTICLE_URL = 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/MDM_Profile_Settings.html';

/** Minimal FtTopicInfo returned by fetchTopicMetadata */
function makeFtTopicInfo(overrides: {
  readerUrl?: string;
  versionBundleStem?: string;
  version?: string;
} = {}) {
  return {
    title: 'MDM Profile Settings',
    id: CONTENT_ID,
    contentApiEndpoint: `/api/khub/maps/${MAP_ID}/topics/${CONTENT_ID}/content`,
    readerUrl: overrides.readerUrl ?? '/r/en-US/jamf-pro-documentation/MDM_Profile_Settings',
    metadata: [
      {
        key: 'version_bundle_stem',
        label: 'Version Bundle Stem',
        values: [overrides.versionBundleStem ?? 'jamf-pro-documentation'],
      },
      {
        key: 'version',
        label: 'Version',
        values: [overrides.version ?? '11.0'],
      },
    ],
  };
}

/** Minimal ParsedArticleContent returned by parseArticle */
function makeParsedContent(overrides: {
  title?: string;
  content?: string;
  breadcrumb?: string[];
  relatedArticles?: { title: string; url: string }[];
} = {}) {
  return {
    title: overrides.title ?? 'MDM Profile Settings',
    content: overrides.content
      ?? '## Overview\n\nThis article covers MDM profiles.\n\n## Prerequisites\n\nYou need Jamf Pro.',
    breadcrumb: overrides.breadcrumb ?? ['Jamf Pro', 'Device Management'],
    relatedArticles: overrides.relatedArticles ?? [],
  };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockedFetchTopicContent.mockResolvedValue('<div>article html</div>');
  mockedFetchTopicMetadata.mockResolvedValue(makeFtTopicInfo());
  mockedParseArticle.mockReturnValue(makeParsedContent());
});

// =============================================================================
// fetchArticleFromFt
// =============================================================================

describe('fetchArticleFromFt()', () => {
  // ── Cache miss: normal fetch ────────────────────────────────────────────────

  describe('cache miss — normal fetch', () => {
    it('should return article with title, content, sections, and tokenInfo', async () => {
      // Arrange
      const cache = createMockCache();

      // Act
      const result = await fetchArticleFromFt(
        cache,
        MAP_ID,
        CONTENT_ID,
        ARTICLE_URL,
        {},
      );

      // Assert
      expect(result.title).toBe('MDM Profile Settings');
      expect(result.content).toContain('Overview');
      expect(result.sections).toBeDefined();
      expect(result.sections.length).toBeGreaterThan(0);
      expect(result.tokenInfo).toBeDefined();
      expect(result.tokenInfo.truncated).toBe(false);
      expect(result.mapId).toBe(MAP_ID);
      expect(result.contentId).toBe(CONTENT_ID);
    });

    it('should fetch metadata and content in parallel on cache miss', async () => {
      // Arrange
      const cache = createMockCache();

      // Act
      await fetchArticleFromFt(cache, MAP_ID, CONTENT_ID, ARTICLE_URL, {});

      // Assert — both fetchers called exactly once
      expect(mockedFetchTopicContent).toHaveBeenCalledOnce();
      expect(mockedFetchTopicMetadata).toHaveBeenCalledOnce();
      expect(mockedFetchTopicContent).toHaveBeenCalledWith(MAP_ID, CONTENT_ID);
      expect(mockedFetchTopicMetadata).toHaveBeenCalledWith(MAP_ID, CONTENT_ID);
    });

    it('should extract product and version from metadata', async () => {
      // Arrange
      const cache = createMockCache();
      mockedFetchTopicMetadata.mockResolvedValue(
        makeFtTopicInfo({ versionBundleStem: 'jamf-pro-documentation', version: '11.5' })
      );

      // Act
      const result = await fetchArticleFromFt(cache, MAP_ID, CONTENT_ID, ARTICLE_URL, {});

      // Assert
      expect(result.product).toBe('Jamf Pro');
      expect(result.version).toBe('11.5');
    });

    it('should set version to "current" when metadata has no version value', async () => {
      // Arrange
      const cache = createMockCache();
      mockedFetchTopicMetadata.mockResolvedValue({
        title: 'Article',
        id: CONTENT_ID,
        contentApiEndpoint: '',
        metadata: [],
      });

      // Act
      const result = await fetchArticleFromFt(cache, MAP_ID, CONTENT_ID, ARTICLE_URL, {});

      // Assert
      expect(result.version).toBe('current');
    });

    it('should include breadcrumb when it has entries', async () => {
      // Arrange
      const cache = createMockCache();
      mockedParseArticle.mockReturnValue(
        makeParsedContent({ breadcrumb: ['Jamf Pro', 'Device Management', 'MDM'] })
      );

      // Act
      const result = await fetchArticleFromFt(cache, MAP_ID, CONTENT_ID, ARTICLE_URL, {});

      // Assert
      expect(result.breadcrumb).toEqual(['Jamf Pro', 'Device Management', 'MDM']);
    });

    it('should omit breadcrumb when it is empty', async () => {
      // Arrange
      const cache = createMockCache();
      mockedParseArticle.mockReturnValue(makeParsedContent({ breadcrumb: [] }));

      // Act
      const result = await fetchArticleFromFt(cache, MAP_ID, CONTENT_ID, ARTICLE_URL, {});

      // Assert
      expect(result.breadcrumb).toBeUndefined();
    });

    it('should include relatedArticles when present', async () => {
      // Arrange
      const cache = createMockCache();
      const related = [{ title: 'Policies', url: 'https://learn.jamf.com/bundle/jamf-pro/page/Policies.html' }];
      mockedParseArticle.mockReturnValue(makeParsedContent({ relatedArticles: related }));

      // Act
      const result = await fetchArticleFromFt(cache, MAP_ID, CONTENT_ID, ARTICLE_URL, {});

      // Assert
      expect(result.relatedArticles).toEqual(related);
    });

    it('should omit relatedArticles when empty', async () => {
      // Arrange
      const cache = createMockCache();
      mockedParseArticle.mockReturnValue(makeParsedContent({ relatedArticles: [] }));

      // Act
      const result = await fetchArticleFromFt(cache, MAP_ID, CONTENT_ID, ARTICLE_URL, {});

      // Assert
      expect(result.relatedArticles).toBeUndefined();
    });

    it('should pass includeRelated option to parseArticle', async () => {
      // Arrange
      const cache = createMockCache();

      // Act
      await fetchArticleFromFt(cache, MAP_ID, CONTENT_ID, ARTICLE_URL, { includeRelated: true });

      // Assert
      expect(mockedParseArticle).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        { includeRelated: true }
      );
    });

    it('should not pass includeRelated option when false', async () => {
      // Arrange
      const cache = createMockCache();

      // Act
      await fetchArticleFromFt(cache, MAP_ID, CONTENT_ID, ARTICLE_URL, { includeRelated: false });

      // Assert
      expect(mockedParseArticle).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        undefined
      );
    });
  });

  // ── Cache hit ───────────────────────────────────────────────────────────────

  describe('cache hit', () => {
    it('should return cached article without calling FT API', async () => {
      // Arrange
      const cache = createMockCache();
      // First call — populates cache
      await fetchArticleFromFt(cache, MAP_ID, CONTENT_ID, ARTICLE_URL, {});
      vi.clearAllMocks();

      // Act — second call should be a cache hit
      const result = await fetchArticleFromFt(cache, MAP_ID, CONTENT_ID, ARTICLE_URL, {});

      // Assert
      expect(mockedFetchTopicContent).not.toHaveBeenCalled();
      expect(mockedFetchTopicMetadata).not.toHaveBeenCalled();
      expect(mockedParseArticle).not.toHaveBeenCalled();
      expect(result.title).toBe('MDM Profile Settings');
    });

    it('should use cache key scoped to mapId and contentId', async () => {
      // Arrange
      const cache = createMockCache();

      // Act — call with two different content IDs
      await fetchArticleFromFt(cache, MAP_ID, 'article-A', ARTICLE_URL, {});
      await fetchArticleFromFt(cache, MAP_ID, 'article-B', ARTICLE_URL, {});

      // Assert — API should be called twice (different cache keys)
      expect(mockedFetchTopicContent).toHaveBeenCalledTimes(2);
    });
  });

  // ── summaryOnly mode ────────────────────────────────────────────────────────

  describe('summaryOnly mode', () => {
    it('should return summary and outline instead of full content', async () => {
      // Arrange
      const cache = createMockCache();
      mockedParseArticle.mockReturnValue(
        makeParsedContent({
          content: '## Overview\n\nThis article covers MDM.\n\n## Prerequisites\n\nYou need Jamf Pro admin access.',
        })
      );

      // Act
      const result = await fetchArticleFromFt(
        cache, MAP_ID, CONTENT_ID, ARTICLE_URL, { summaryOnly: true }
      );

      // Assert
      expect(result.content).toContain('## Summary');
      expect(result.content).toContain('## Article Outline');
      expect(result.content).toContain('sections');
      expect(result.tokenInfo).toBeDefined();
    });

    it('should include section token estimates in outline', async () => {
      // Arrange
      const cache = createMockCache();
      mockedParseArticle.mockReturnValue(
        makeParsedContent({
          content: '## Overview\n\nContent here.\n\n## Details\n\nMore content here.',
        })
      );

      // Act
      const result = await fetchArticleFromFt(
        cache, MAP_ID, CONTENT_ID, ARTICLE_URL, { summaryOnly: true }
      );

      // Assert
      expect(result.content).toMatch(/~\d+ tokens/);
    });
  });

  // ── Section extraction ──────────────────────────────────────────────────────

  describe('section extraction', () => {
    it('should return only the specified section content', async () => {
      // Arrange
      const cache = createMockCache();
      mockedParseArticle.mockReturnValue(
        makeParsedContent({
          content: '## Overview\n\nThis is the overview section.\n\n## Prerequisites\n\nInstall Jamf Pro.',
        })
      );

      // Act
      const result = await fetchArticleFromFt(
        cache, MAP_ID, CONTENT_ID, ARTICLE_URL, { section: 'Prerequisites' }
      );

      // Assert
      expect(result.content).toContain('Prerequisites');
      expect(result.content).toContain('Install Jamf Pro');
    });

    it('should return fallback message when section is not found', async () => {
      // Arrange
      const cache = createMockCache();
      mockedParseArticle.mockReturnValue(
        makeParsedContent({
          content: '## Overview\n\nContent.\n\n## Details\n\nMore content.',
        })
      );

      // Act
      const result = await fetchArticleFromFt(
        cache, MAP_ID, CONTENT_ID, ARTICLE_URL, { section: 'NonExistentSection' }
      );

      // Assert
      expect(result.content).toContain('Section "NonExistentSection" not found');
      expect(result.content).toContain('Available sections');
    });

    it('should list available sections in fallback message', async () => {
      // Arrange
      const cache = createMockCache();
      mockedParseArticle.mockReturnValue(
        makeParsedContent({
          content: '## Overview\n\nContent.\n\n## Configuration\n\nSteps.',
        })
      );

      // Act
      const result = await fetchArticleFromFt(
        cache, MAP_ID, CONTENT_ID, ARTICLE_URL, { section: 'Missing' }
      );

      // Assert
      expect(result.content).toContain('- Overview');
      expect(result.content).toContain('- Configuration');
    });

    it('should treat empty string section as full content mode', async () => {
      // Arrange
      const cache = createMockCache();
      mockedParseArticle.mockReturnValue(
        makeParsedContent({
          content: '## Overview\n\nFull content here.',
        })
      );

      // Act
      const result = await fetchArticleFromFt(
        cache, MAP_ID, CONTENT_ID, ARTICLE_URL, { section: '' }
      );

      // Assert — full content returned (not a section-not-found message)
      expect(result.content).toContain('Full content here');
      expect(result.content).not.toContain('not found');
    });
  });

  // ── Token truncation ────────────────────────────────────────────────────────

  describe('token truncation', () => {
    it('should truncate content when it exceeds maxTokens', async () => {
      // Arrange — long content that will exceed a tiny maxTokens budget
      const longContent = Array.from({ length: 200 }, (_, i) =>
        `## Section ${i}\n\nThis is the content for section ${i} with enough text to consume tokens.\n`
      ).join('\n');

      const cache = createMockCache();
      mockedParseArticle.mockReturnValue(makeParsedContent({ content: longContent }));

      // Act — very small token limit to force truncation
      const result = await fetchArticleFromFt(
        cache, MAP_ID, CONTENT_ID, ARTICLE_URL, { maxTokens: 50 }
      );

      // Assert
      expect(result.tokenInfo.truncated).toBe(true);
      expect(result.tokenInfo.tokenCount).toBeLessThan(longContent.length / 4);
    });

    it('should not truncate content within token limit', async () => {
      // Arrange
      const cache = createMockCache();
      mockedParseArticle.mockReturnValue(
        makeParsedContent({ content: '## Short\n\nBrief article.' })
      );

      // Act
      const result = await fetchArticleFromFt(
        cache, MAP_ID, CONTENT_ID, ARTICLE_URL, { maxTokens: 5000 }
      );

      // Assert
      expect(result.tokenInfo.truncated).toBe(false);
    });

    it('should use DEFAULT_MAX_TOKENS (5000) when maxTokens is not specified', async () => {
      // Arrange
      const cache = createMockCache();

      // Act
      const result = await fetchArticleFromFt(
        cache, MAP_ID, CONTENT_ID, ARTICLE_URL, {}
      );

      // Assert
      expect(result.tokenInfo.maxTokens).toBe(5000);
    });
  });

  // ── Network errors ──────────────────────────────────────────────────────────

  describe('network errors', () => {
    it('should propagate fetchTopicContent errors', async () => {
      // Arrange
      const cache = createMockCache();
      mockedFetchTopicContent.mockRejectedValue(new Error('HTTP 404 Not Found'));

      // Act & Assert
      await expect(
        fetchArticleFromFt(cache, MAP_ID, CONTENT_ID, ARTICLE_URL, {})
      ).rejects.toThrow('HTTP 404 Not Found');
    });

    it('should propagate fetchTopicMetadata errors', async () => {
      // Arrange
      const cache = createMockCache();
      mockedFetchTopicMetadata.mockRejectedValue(new Error('HTTP 429 Too Many Requests'));

      // Act & Assert
      await expect(
        fetchArticleFromFt(cache, MAP_ID, CONTENT_ID, ARTICLE_URL, {})
      ).rejects.toThrow('HTTP 429 Too Many Requests');
    });

    it('should not cache results when fetch fails', async () => {
      // Arrange
      const cache = createMockCache();
      mockedFetchTopicContent.mockRejectedValueOnce(new Error('Network error'));
      // Second call succeeds normally
      mockedFetchTopicContent.mockResolvedValue('<div>html</div>');

      // Act — first call fails
      await expect(
        fetchArticleFromFt(cache, MAP_ID, CONTENT_ID, ARTICLE_URL, {})
      ).rejects.toThrow('Network error');

      // Act — second call should retry (cache should NOT have a stale entry)
      const result = await fetchArticleFromFt(cache, MAP_ID, CONTENT_ID, ARTICLE_URL, {});
      expect(result.title).toBeDefined();
      expect(mockedFetchTopicContent).toHaveBeenCalledTimes(2);
    });
  });

  // ── Display URL derivation ──────────────────────────────────────────────────

  describe('display URL derivation', () => {
    it('should use readerUrl from metadata when available', async () => {
      // Arrange
      const cache = createMockCache();
      const readerPath = '/r/en-US/jamf-pro-documentation/MDM_Profile_Settings';
      mockedFetchTopicMetadata.mockResolvedValue(
        makeFtTopicInfo({ readerUrl: readerPath })
      );

      // Act
      const result = await fetchArticleFromFt(cache, MAP_ID, CONTENT_ID, ARTICLE_URL, {});

      // Assert — url should be derived from readerUrl (via buildDisplayUrl mock which returns as-is)
      expect(result.url).toBe(readerPath);
    });

    it('should fall back to articleUrl when readerUrl is empty', async () => {
      // Arrange
      const cache = createMockCache();
      mockedFetchTopicMetadata.mockResolvedValue({
        title: 'Article',
        id: CONTENT_ID,
        contentApiEndpoint: '',
        readerUrl: '',
        metadata: [],
      });

      // Act
      const result = await fetchArticleFromFt(cache, MAP_ID, CONTENT_ID, ARTICLE_URL, {});

      // Assert
      expect(result.url).toBe(ARTICLE_URL);
    });
  });
});

// =============================================================================
// resolveAndFetchArticle
// =============================================================================

describe('resolveAndFetchArticle()', () => {
  // ── Direct IDs: skip URL resolution ────────────────────────────────────────

  describe('with direct mapId + contentId', () => {
    it('should skip topicResolver.resolve when both IDs are provided', async () => {
      // Arrange
      const ctx = createMockContext({
        articleProvider: createMockArticleProvider(() => createFetchArticleResult()),
      });
      const resolveSpy = vi.fn();
      ctx.topicResolver.resolve = resolveSpy;

      // Act
      await resolveAndFetchArticle(ctx, { url: ARTICLE_URL, mapId: MAP_ID, contentId: CONTENT_ID }, {});

      // Assert
      expect(resolveSpy).not.toHaveBeenCalled();
    });

    it('should call topicResolver.resolve when mapId is missing', async () => {
      // Arrange
      const ctx = createMockContext({
        articleProvider: createMockArticleProvider(() => createFetchArticleResult()),
      });
      ctx.topicResolver.resolve = vi.fn().mockResolvedValue({
        mapId: MAP_ID,
        contentId: CONTENT_ID,
        locale: 'en-US',
      });

      // Act
      await resolveAndFetchArticle(ctx, { url: ARTICLE_URL, contentId: CONTENT_ID }, {});

      // Assert
      expect(ctx.topicResolver.resolve).toHaveBeenCalledWith({ url: ARTICLE_URL });
    });

    it('should call topicResolver.resolve when contentId is missing', async () => {
      // Arrange
      const ctx = createMockContext({
        articleProvider: createMockArticleProvider(() => createFetchArticleResult()),
      });
      ctx.topicResolver.resolve = vi.fn().mockResolvedValue({
        mapId: MAP_ID,
        contentId: CONTENT_ID,
        locale: 'en-US',
      });

      // Act
      await resolveAndFetchArticle(ctx, { url: ARTICLE_URL, mapId: MAP_ID }, {});

      // Assert
      expect(ctx.topicResolver.resolve).toHaveBeenCalledWith({ url: ARTICLE_URL });
    });
  });

  // ── ArticleProvider.getArticleByIds ────────────────────────────────────────

  describe('ArticleProvider.getArticleByIds', () => {
    it('should return provider result when non-null', async () => {
      // Arrange
      const providerResult = createFetchArticleResult({ title: 'From Provider' });
      const ctx = createMockContext({
        articleProvider: createMockArticleProvider(() => providerResult),
      });
      ctx.topicResolver.resolve = vi.fn().mockResolvedValue({
        mapId: MAP_ID, contentId: CONTENT_ID, locale: 'en-US',
      });

      // Act
      const result = await resolveAndFetchArticle(ctx, { url: ARTICLE_URL, mapId: MAP_ID, contentId: CONTENT_ID }, {});

      // Assert
      expect(result.title).toBe('From Provider');
      expect(ctx.articleProvider!.getArticleByIds).toHaveBeenCalledWith(
        MAP_ID, CONTENT_ID, {}
      );
    });

    it('should attach mapId and contentId from resolution to provider result', async () => {
      // Arrange
      const providerResult = createFetchArticleResult({ mapId: undefined, contentId: undefined });
      const ctx = createMockContext({
        articleProvider: createMockArticleProvider(() => providerResult),
      });

      // Act
      const result = await resolveAndFetchArticle(ctx, { url: ARTICLE_URL, mapId: MAP_ID, contentId: CONTENT_ID }, {});

      // Assert
      expect(result.mapId).toBe(MAP_ID);
      expect(result.contentId).toBe(CONTENT_ID);
    });
  });

  // ── ArticleProvider.getArticle URL fallback ────────────────────────────────

  describe('ArticleProvider.getArticle URL fallback', () => {
    it('should try URL-based getArticle when getArticleByIds returns null', async () => {
      // Arrange
      const urlResult = createFetchArticleResult({ title: 'From URL Fallback' });
      const articleProvider = {
        getArticleByIds: vi.fn().mockResolvedValue(null),
        getArticle: vi.fn().mockResolvedValue(urlResult),
      };
      const ctx = createMockContext({ articleProvider });

      // Act
      const result = await resolveAndFetchArticle(ctx, { url: ARTICLE_URL, mapId: MAP_ID, contentId: CONTENT_ID }, {});

      // Assert
      expect(articleProvider.getArticle).toHaveBeenCalledWith(ARTICLE_URL, {});
      expect(result.title).toBe('From URL Fallback');
    });

    it('should not call getArticle when articleUrl is empty string', async () => {
      // Arrange
      const articleProvider = {
        getArticleByIds: vi.fn().mockResolvedValue(null),
        getArticle: vi.fn().mockResolvedValue(createFetchArticleResult()),
      };
      const ctx = createMockContext({ articleProvider });
      // Make FT API succeed so the function completes
      mockedFetchTopicContent.mockResolvedValue('<div>html</div>');
      mockedFetchTopicMetadata.mockResolvedValue(makeFtTopicInfo());
      mockedParseArticle.mockReturnValue(makeParsedContent());

      // Act
      await resolveAndFetchArticle(ctx, { url: '', mapId: MAP_ID, contentId: CONTENT_ID }, {});

      // Assert
      expect(articleProvider.getArticle).not.toHaveBeenCalled();
    });
  });

  // ── Provider not configured ────────────────────────────────────────────────

  describe('no articleProvider configured', () => {
    it('should fall through to FT API when no provider is set', async () => {
      // Arrange
      const ctx = createMockContext(); // no articleProvider
      mockedFetchTopicContent.mockResolvedValue('<div>html</div>');
      mockedFetchTopicMetadata.mockResolvedValue(makeFtTopicInfo());
      mockedParseArticle.mockReturnValue(makeParsedContent());

      // Act
      const result = await resolveAndFetchArticle(ctx, { url: ARTICLE_URL, mapId: MAP_ID, contentId: CONTENT_ID }, {});

      // Assert
      expect(mockedFetchTopicContent).toHaveBeenCalled();
      expect(result.title).toBe('MDM Profile Settings');
    });
  });

  // ── Provider returns null: fall through to FT API ─────────────────────────

  describe('provider returns null', () => {
    it('should fall through to FT API when both provider methods return null', async () => {
      // Arrange
      const articleProvider = {
        getArticleByIds: vi.fn().mockResolvedValue(null),
        getArticle: vi.fn().mockResolvedValue(null),
      };
      const ctx = createMockContext({ articleProvider });
      mockedFetchTopicContent.mockResolvedValue('<div>html</div>');
      mockedFetchTopicMetadata.mockResolvedValue(makeFtTopicInfo());
      mockedParseArticle.mockReturnValue(makeParsedContent());

      // Act
      const result = await resolveAndFetchArticle(ctx, { url: ARTICLE_URL, mapId: MAP_ID, contentId: CONTENT_ID }, {});

      // Assert — FT API was used
      expect(mockedFetchTopicContent).toHaveBeenCalledWith(MAP_ID, CONTENT_ID);
      expect(result.title).toBe('MDM Profile Settings');
    });
  });

  // ── Resolution error propagation ───────────────────────────────────────────

  describe('resolution error propagation', () => {
    it('should propagate JamfDocsError from topicResolver', async () => {
      // Arrange
      const ctx = createMockContext();
      const jamfError = new JamfDocsError(
        'URL not recognized',
        JamfDocsErrorCode.INVALID_URL,
        ARTICLE_URL
      );
      ctx.topicResolver.resolve = vi.fn().mockRejectedValue(jamfError);

      // Act & Assert
      await expect(
        resolveAndFetchArticle(ctx, { url: ARTICLE_URL }, {})
      ).rejects.toBeInstanceOf(JamfDocsError);
    });

    it('should propagate generic errors from topicResolver', async () => {
      // Arrange
      const ctx = createMockContext();
      ctx.topicResolver.resolve = vi.fn().mockRejectedValue(new Error('DNS failure'));

      // Act & Assert
      await expect(
        resolveAndFetchArticle(ctx, { url: ARTICLE_URL }, {})
      ).rejects.toThrow('DNS failure');
    });

    it('should propagate errors from articleProvider.getArticleByIds', async () => {
      // Arrange
      const articleProvider = {
        getArticleByIds: vi.fn().mockRejectedValue(new Error('R2 storage unavailable')),
      };
      const ctx = createMockContext({ articleProvider });

      // Act & Assert
      await expect(
        resolveAndFetchArticle(ctx, { url: ARTICLE_URL, mapId: MAP_ID, contentId: CONTENT_ID }, {})
      ).rejects.toThrow('R2 storage unavailable');
    });
  });
});
