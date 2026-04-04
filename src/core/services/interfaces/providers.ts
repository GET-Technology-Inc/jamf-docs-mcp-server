/**
 * Optional data-source provider interfaces
 *
 * These interfaces allow external projects to inject custom backends
 * (e.g., Vectorize search, R2 article storage, D1 glossary database)
 * without modifying core tool handlers.
 *
 * Each provider method returns `T | null`:
 * - Non-null: the provider handled the request; core uses this result.
 * - null: fall through to the default implementation.
 */

import type { ProductId, LocaleId } from '../../constants.js';
import type {
  SearchParams,
  SearchResult,
  GlossaryLookupResult,
  FetchArticleResult,
  FetchArticleOptions,
  FetchTocResult,
  FetchTocOptions,
  FtMapInfo,
} from '../../types.js';

/**
 * Custom search backend (e.g., Vectorize semantic search).
 *
 * Return all matched results as a flat array. The core handles pagination,
 * token truncation, version deduplication, and filter relaxation.
 * Return `null` to fall through to the default Fluid Topics API search.
 */
export interface SearchProvider {
  search: (params: SearchParams) => Promise<SearchResult[] | null>;
}

/**
 * Custom article provider (e.g., R2 local storage).
 * Return null to fall through to the default Fluid Topics API fetch.
 *
 * Primary method is `getArticleByIds` — in the FT world, ID-based access
 * is the fast path (mapId + contentId are always resolved first).
 * The optional `getArticle` method provides a URL-based fallback.
 */
export interface ArticleProvider {
  /** ID-based fetch — primary method, used when mapId+contentId are known. */
  getArticleByIds: (
    mapId: string,
    contentId: string,
    options?: FetchArticleOptions,
  ) => Promise<FetchArticleResult | null>;

  /** Optional URL-based fallback — used when ID-based fetch returns null. */
  getArticle?: (
    url: string,
    options?: FetchArticleOptions,
  ) => Promise<FetchArticleResult | null>;
}

/**
 * Custom glossary provider (e.g., D1 database).
 * Return null to fall through to the default Fluid Topics API glossary.
 */
export interface GlossaryProvider {
  lookup: (params: {
    term: string;
    product?: ProductId | undefined;
    language?: LocaleId | undefined;
    maxTokens?: number | undefined;
  }) => Promise<GlossaryLookupResult | null>;
}

/**
 * Custom table-of-contents provider (e.g., D1/R2 stored TOC).
 * Return null to fall through to the default TOC fetching.
 */
export interface TocProvider {
  getTableOfContents: (
    product: ProductId,
    version: string,
    options?: FetchTocOptions,
  ) => Promise<FetchTocResult | null>;
}

/**
 * Custom maps provider (e.g., KV storage on Workers).
 * When present, MapsRegistry uses this instead of the FT API fetchMaps().
 */
export interface MapsProvider {
  getMaps: () => Promise<FtMapInfo[]>;
}
