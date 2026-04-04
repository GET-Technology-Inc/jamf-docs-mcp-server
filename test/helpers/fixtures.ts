/**
 * Shared test fixtures — type-safe factory functions for all core data types
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  SearchResult,
  TocEntry,
  TokenInfo,
  PaginationInfo,
  ArticleSection,
  FetchArticleResult,
  FtClusteredSearchResponse,
  FtMetadataEntry,
} from '../../src/core/types.js';

/** Legacy Zoomin search response shape (used only by fixture loader). */
interface ZoominSearchResponse {
  status: string;
  Results: {
    leading_result?: {
      title: string;
      url: string;
      snippet: string;
      bundle_id: string;
      page_id: string;
      publication_title: string;
      score?: number;
      labels?: { key: string; navtitle: string }[];
    } | null;
  }[];
}

// ============================================================================
// Fixture loading
// ============================================================================

const FIXTURES_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'fixtures');

/**
 * Load a JSON fixture file from test/fixtures/
 */
export function loadFixture<T>(name: string): T {
  const filePath = path.join(FIXTURES_DIR, name);
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
}

export function createSearchResult(overrides?: Partial<SearchResult>): SearchResult {
  return {
    title: 'Configuration Profiles',
    url: 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/Configuration_Profiles.html',
    snippet: 'Configuration profiles let you manage settings on devices.',
    product: 'jamf-pro',
    version: 'current',
    ...overrides,
  };
}

export function createTocEntry(overrides?: Partial<TocEntry>): TocEntry {
  return {
    title: 'Getting Started',
    url: 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/Getting_Started.html',
    ...overrides,
  };
}

export function createTokenInfo(overrides?: Partial<TokenInfo>): TokenInfo {
  return {
    tokenCount: 1500,
    truncated: false,
    maxTokens: 5000,
    ...overrides,
  };
}

export function createPaginationInfo(overrides?: Partial<PaginationInfo>): PaginationInfo {
  return {
    page: 1,
    pageSize: 10,
    totalPages: 3,
    totalItems: 25,
    hasNext: true,
    hasPrev: false,
    ...overrides,
  };
}

export function createArticleSection(overrides?: Partial<ArticleSection>): ArticleSection {
  return {
    id: 'prerequisites',
    title: 'Prerequisites',
    level: 2,
    tokenCount: 200,
    ...overrides,
  };
}

export function createFetchArticleResult(overrides?: Partial<FetchArticleResult>): FetchArticleResult {
  return {
    title: 'Configuration Profiles',
    content: '# Configuration Profiles\n\nThis article covers configuration profiles.',
    url: 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/Configuration_Profiles.html',
    product: 'Jamf Pro',
    version: 'current',
    lastUpdated: '2025-01-15',
    breadcrumb: ['Jamf Pro', 'Device Management', 'Configuration Profiles'],
    relatedArticles: [
      { title: 'Policies', url: 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/Policies.html' },
    ],
    tokenInfo: createTokenInfo(),
    sections: [
      createArticleSection({ id: 'prerequisites', title: 'Prerequisites', level: 2, tokenCount: 200 }),
      createArticleSection({ id: 'configuration', title: 'Configuration', level: 2, tokenCount: 500 }),
    ],
    ...overrides,
  };
}

// ============================================================================
// Realistic factory functions (based on real API response fixtures)
// ============================================================================

interface ArticleFixture {
  articles: { url: string; html: string }[];
}

/**
 * Create a realistic Zoomin search response from the fixture file.
 * Supports partial overrides on the top-level response.
 */
export function createRealisticSearchResponse(
  overrides?: Partial<ZoominSearchResponse>
): ZoominSearchResponse {
  const data = loadFixture<ZoominSearchResponse>('search-response.json');
  return { ...data, ...overrides };
}

/**
 * Get realistic article HTML from the fixture file.
 * @param index — article index (0 = Configuration Profiles, 1 = SSO with special chars)
 */
export function createRealisticArticleHtml(index = 0): { url: string; html: string } {
  const data = loadFixture<ArticleFixture>('article-html.json');
  const article = data.articles[index];
  if (!article) {
    throw new Error(`Article fixture index ${index} not found (available: ${data.articles.length})`);
  }
  return article;
}

/**
 * Get realistic TOC response from the fixture file.
 * @param product — 'jamf-pro' for populated TOC, 'jamf-routines' for empty TOC
 */
export function createRealisticTocResponse(
  product: 'jamf-pro' | 'jamf-routines' = 'jamf-pro'
): Record<string, unknown> {
  if (product === 'jamf-routines') {
    return loadFixture<Record<string, unknown>>('toc-jamf-routines-documentation.json');
  }
  // Find the jamf-pro TOC fixture (may have versioned filename)
  const files = fs.readdirSync(FIXTURES_DIR);
  const proTocFile = files.find(f => f.startsWith('toc-jamf-pro-documentation') && f.endsWith('.json'));
  if (!proTocFile) {
    throw new Error('No jamf-pro TOC fixture found');
  }
  return loadFixture<Record<string, unknown>>(proTocFile);
}

// ============================================================================
// FT API response factories
// ============================================================================

/**
 * Build a minimal FT clustered search response containing TOPIC entries.
 *
 * Shared across filter-fallback, filter-combination, and similar tests.
 */
export function makeFtSearchResponse(
  entries: {
    title: string;
    mapId: string;
    contentId?: string;
    snippet?: string;
    productLabel?: string;
    contentType?: string;
  }[]
): FtClusteredSearchResponse {
  return {
    facets: [],
    announcements: [],
    paging: {
      currentPage: 0,
      isLastPage: true,
      totalResultsCount: entries.length,
      totalClustersCount: 1,
    },
    results: [{
      metadataVariableAxis: '',
      entries: entries.map(e => {
        const metadata: FtMetadataEntry[] = [
          {
            key: 'ft:prettyUrl',
            label: 'URL',
            values: [
              `/en-US/bundle/${e.mapId}/page/${e.contentId ?? 'page-1'}.html`,
            ],
          },
        ];
        if (e.productLabel) {
          metadata.push({
            key: 'zoominmetadata',
            label: 'zoominmetadata',
            values: [e.productLabel],
          });
        }
        if (e.contentType) {
          metadata.push({
            key: 'jamf:contentType',
            label: 'Content Type',
            values: [e.contentType],
          });
        }
        return {
          type: 'TOPIC' as const,
          missingTerms: [],
          topic: {
            mapId: e.mapId,
            contentId: e.contentId ?? 'page-1',
            tocId: 'toc-1',
            title: e.title,
            htmlTitle: e.title,
            mapTitle: 'Docs',
            breadcrumb: [],
            htmlExcerpt: e.snippet ?? `Snippet for ${e.title}`,
            metadata,
          },
        };
      }),
    }],
  };
}
