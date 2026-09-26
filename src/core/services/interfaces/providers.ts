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
 *
 * A provider changes where an article comes from, not which of the caller's
 * arguments decide or what the caller is told about them: the pair decides,
 * the caller's or the one core resolved the url to, as it does without a
 * provider (see `getArticle`), and core ends the reply with the note it would
 * end it with without one (see `ArticleProviderOptions.noteFor`). The `mapId`
 * and `contentId` an article carries are kept; the ones core asked for fill in
 * only when it carries none.
 */
export interface ArticleProvider {
  /** ID-based fetch — primary method, used when mapId+contentId are known. */
  getArticleByIds: (
    mapId: string,
    contentId: string,
    options?: ArticleProviderOptions,
  ) => Promise<FetchArticleResult | null>;

  /**
   * Optional URL-based fallback, asked when `getArticleByIds` returns null and
   * the call has a url.
   *
   * The article returned here is used only when it is the one core would
   * fetch without a provider: when it carries a `mapId` and `contentId` equal
   * to the pair `getArticleByIds` was just asked for, the caller's or the one
   * the url resolved to. One that carries neither cannot be checked, and is
   * used only when the url alone chose that pair: no pair from the caller, and
   * no `language` that moved the lookup to another locale. Otherwise the call
   * goes on to Fluid Topics by the pair.
   *
   * A url does not always name the pair's topic. Two topics can share one:
   * the LAPS technical paper publishes "Use LAPS" and its child at the same
   * `…/Using_LAPS`. A topic keeps its `contentId` from one Jamf Pro version to
   * the next, so only the `mapId` tells an older version's pair from the
   * `-current` url's page. And `language` names another locale's topic.
   */
  getArticle?: (
    url: string,
    options?: ArticleProviderOptions,
  ) => Promise<FetchArticleResult | null>;
}

/**
 * The options core passes an {@link ArticleProvider}: the caller's, and what
 * core will say about how the call was resolved.
 */
export interface ArticleProviderOptions extends FetchArticleOptions {
  /**
   * The note core ends this reply with, given the address the article is
   * labelled with and its place in the TOC; `undefined` for none. It says when
   * one of the caller's arguments went unused: a url the pair overruled, or a
   * `language` that could not apply.
   *
   * Only core can decide it, because it depends on things a provider is not
   * told: the caller's url, and whether the pair came from the caller or from
   * resolving that url. It is the `noteFor` `fetchArticleFromFt` takes, so a
   * provider that renders through it passes the options on and the note is
   * charged to `maxTokens` with the body. A provider that renders its own reply
   * and leaves the note out gets it added by core, and when the two do not fit
   * `maxTokens` together, core cuts the reply to make room for the note.
   *
   * The note belongs to one call. It depends on the caller's url and on
   * whether the caller gave the pair, so the same article gets another note,
   * or none, on another call. A reply rendered with it must not be cached
   * under a key that leaves those out: the next call would get this call's
   * note, and core cannot take a note back out of a reply. Cache the article
   * unrendered and render it per call, or render without `noteFor` and let
   * core add the note.
   *
   * Core adds the note only when the reply does not already contain it, and
   * never removes one. A provider that passes these options on and also
   * appends its own copy of the sentence prints it twice, so a provider that
   * passes `noteFor` on must drop any copy of its own.
   */
  noteFor?: (labelled: Pick<FetchArticleResult, 'url' | 'navigation'>) => string | undefined;
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
