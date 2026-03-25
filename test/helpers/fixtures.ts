/**
 * Shared test fixtures — type-safe factory functions for all core data types
 */

import type {
  SearchResult,
  TocEntry,
  TokenInfo,
  PaginationInfo,
  ArticleSection,
} from '../../src/types.js';
import type { FetchArticleResult } from '../../src/services/scraper.js';

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
