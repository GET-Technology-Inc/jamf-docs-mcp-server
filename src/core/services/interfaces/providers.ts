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
import type { SearchParams, GlossaryLookupResult } from '../../types.js';
import type {
  SearchDocumentationResult,
  FetchArticleResult,
  FetchArticleOptions,
  FetchTocResult,
  FetchTocOptions,
} from '../scraper.js';

/**
 * Custom search backend (e.g., Vectorize semantic search).
 * Return null to fall through to the default Zoomin API search.
 */
export interface SearchProvider {
  search(params: SearchParams): Promise<SearchDocumentationResult | null>;
}

/**
 * Custom article provider (e.g., R2 local storage).
 * Return null to fall through to the default web scraping.
 */
export interface ArticleProvider {
  getArticle(
    url: string,
    options?: FetchArticleOptions,
  ): Promise<FetchArticleResult | null>;
}

/**
 * Custom glossary provider (e.g., D1 database).
 * Return null to fall through to the default glossary scraping.
 */
export interface GlossaryProvider {
  lookup(params: {
    term: string;
    product?: ProductId | undefined;
    language?: LocaleId | undefined;
    maxTokens?: number | undefined;
  }): Promise<GlossaryLookupResult | null>;
}

/**
 * Custom table-of-contents provider (e.g., D1/R2 stored TOC).
 * Return null to fall through to the default TOC fetching.
 */
export interface TocProvider {
  getTableOfContents(
    product: ProductId,
    version: string,
    options?: FetchTocOptions,
  ): Promise<FetchTocResult | null>;
}
