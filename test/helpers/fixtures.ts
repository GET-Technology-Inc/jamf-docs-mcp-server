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
 *
 * Returns `unknown`: the file's contents are whatever is on disk, and a
 * `loadFixture<T>()` type parameter would be a cast wearing a generic's
 * clothes. Callers assert the shape they expect, so the assumption is visible
 * at the point it is made.
 */
export function loadFixture(name: string): unknown {
  const filePath = path.join(FIXTURES_DIR, name);
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

/**
 * Overrides that may name `version` explicitly as `undefined`.
 *
 * `Partial<SearchResult>` cannot express `{ version: undefined }` under
 * `exactOptionalPropertyTypes`, but "a result the API returned without a
 * version" is a state the tools are expected to handle, so the fixtures have
 * to be able to build it.
 */
type SearchResultOverrides = Omit<Partial<SearchResult>, 'version'> & { version?: string | undefined };

export function createSearchResult(overrides?: SearchResultOverrides): SearchResult {
  const merged = {
    title: 'Configuration Profiles',
    url: 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/Configuration_Profiles.html',
    snippet: 'Configuration profiles let you manage settings on devices.',
    product: 'jamf-pro' as string | null,
    version: 'current' as string | undefined,
    ...overrides,
  };
  // `version: undefined` means "a result the API returned without a version".
  // Keep the key absent rather than present-and-undefined, which
  // `exactOptionalPropertyTypes` forbids on SearchResult — and which is
  // indistinguishable to every `!== undefined` check downstream anyway.
  const { version, ...withoutVersion } = merged;
  return version === undefined ? withoutVersion : { ...withoutVersion, version };
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
  const data = loadFixture('search-response.json') as ZoominSearchResponse;
  return { ...data, ...overrides };
}

/**
 * Get realistic article HTML from the fixture file.
 * @param index — article index (0 = Configuration Profiles, 1 = SSO with special chars)
 */
export function createRealisticArticleHtml(index = 0): { url: string; html: string } {
  const data = loadFixture('article-html.json') as ArticleFixture;
  const article = data.articles.at(index);
  if (article === undefined) {
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
    return loadFixture('toc-jamf-routines-documentation.json') as Record<string, unknown>;
  }
  // Find the jamf-pro TOC fixture (may have versioned filename)
  const files = fs.readdirSync(FIXTURES_DIR);
  const proTocFile = files.find(f => f.startsWith('toc-jamf-pro-documentation') && f.endsWith('.json'));
  if (proTocFile === undefined) {
    throw new Error('No jamf-pro TOC fixture found');
  }
  return loadFixture(proTocFile) as Record<string, unknown>;
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
        if (e.productLabel !== undefined && e.productLabel !== '') {
          metadata.push({
            key: 'zoominmetadata',
            label: 'zoominmetadata',
            values: [e.productLabel],
          });
        }
        if (e.contentType !== undefined && e.contentType !== '') {
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

/** One entry of a `readResource` result: MCP resources carry text or a blob. */
type ResourceContent = { text: string } | { blob: string };

/**
 * Read the text payload out of a `readResource` result.
 *
 * `ReadResourceResult.contents` is a union of text-bearing and blob-bearing
 * entries, so `.text` is not reachable without narrowing. Every resource this
 * server exposes is text, which makes a blob — or a missing entry — a real
 * failure rather than something to assert past; both throw here so the test
 * reports what actually came back.
 */
export function resourceText(contents: readonly ResourceContent[], index = 0): string {
  const entry = contents.at(index);
  if (entry === undefined) {
    throw new Error(`No resource content at index ${index} (length ${contents.length})`);
  }
  if (!('text' in entry)) {
    throw new Error(`Resource content at index ${index} is a blob; expected text`);
  }
  return entry.text;
}

/**
 * Assert that a parsed JSON value is an object and hand it back indexable.
 *
 * `Response.json()` is typed `Promise<unknown>`, so asserting on a field of a
 * decoded body needs a narrowing step. Doing it here rather than with a cast
 * means a body that is not an object fails the test where it happens, with the
 * value in the message, instead of throwing a bare `undefined` later.
 */
export function asJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Expected a JSON object, got: ${JSON.stringify(value)}`);
  }
  return value as Record<string, unknown>;
}

/**
 * Return a copy of `obj` without `key`.
 *
 * The usual destructure-and-drop idiom (`const { key: _k, ...rest } = obj`)
 * needs an unused binding, which `no-unused-vars` only tolerates with a
 * leading underscore and `naming-convention` rejects for exactly that reason.
 * Building the copy explicitly sidesteps both.
 */
export function omitKey<T extends object, K extends keyof T>(obj: T, key: K): Omit<T, K> {
  return Object.fromEntries(
    Object.entries(obj).filter(([k]) => k !== key)
  ) as Omit<T, K>;
}
