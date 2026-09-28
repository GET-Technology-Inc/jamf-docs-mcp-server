/**
 * Type definitions for Jamf Docs MCP Server
 */

import type { ResponseFormat, ProductId, TopicId, DocTypeId, LocaleId } from './constants.js';

// ============================================================================
// Context7-style Token and Pagination Types
// ============================================================================

/**
 * Token information for response size management
 */
export interface TokenInfo {
  tokenCount: number;
  truncated: boolean;
  maxTokens: number;
}

/**
 * Pagination information for paginated responses
 */
export interface PaginationInfo {
  page: number;
  /**
   * The most items a page holds. A table of contents page holds at most this
   * many top-level entries and fewer when they do not fit `maxTokens`, so its
   * page bounds cannot be computed from this; see `paginateTocEntries`.
   */
  pageSize: number;
  totalPages: number;
  totalItems: number;
  hasNext: boolean;
  hasPrev: boolean;
}

/**
 * Article section information for section filtering
 */
export interface ArticleSection {
  id: string;
  title: string;
  level: number;  // Heading level (1-6)
  tokenCount: number;
}

// Product types
export interface JamfProduct {
  id: ProductId;
  name: string;
  description: string;
  bundleId: string;
  latestVersion: string;
  versions: readonly string[];
}

export interface ProductInfo {
  id: string;
  name: string;
  description: string;
  currentVersion: string;
  availableVersions: string[];
  hasContent: boolean;
}

export interface ProductListResponse {
  products: ProductInfo[];
  tokenInfo: TokenInfo;
}

// Search types
export interface SearchParams {
  query: string;
  product?: ProductId | undefined;
  version?: string | undefined;
  topic?: TopicId | undefined;
  docType?: DocTypeId | undefined;
  language?: LocaleId | undefined;
  limit?: number | undefined;
  page?: number | undefined;
  maxTokens?: number | undefined;
  responseFormat?: ResponseFormat | undefined;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  product: string | null;  // API may return null for some results
  version?: string;
  docType?: DocTypeId;
  mapId?: string;
  contentId?: string;
  breadcrumb?: string[];
  mapTitle?: string;
  /**
   * Set when a `product` search shows this result under the product searched
   * for, although Jamf files it first under another product and `mapTitle`
   * does not name the product it is shown under — the Jamf Trust release
   * notes, returned for jamf-protect. `product` alone would then pass the
   * document off as that product's own, so the markdown output names the
   * publication beside it. Absent otherwise.
   */
  crossFiled?: boolean;
  /**
   * Set, to true, on a result that is not a page of the documentation and
   * that `jamf_docs_get_article` cannot read: a page Jamf's search lists
   * beside the documentation, to be opened at `url` in a browser. On the
   * Fluid Topics path that is a DOCUMENT entry ({@link FtSearchDocument}),
   * and every one measured is a Jamf Training Catalog course, whose `docType`
   * is `training`, as Jamf classifies it. It has no `mapId` + `contentId`
   * pair. Absent otherwise.
   */
  external?: boolean;
  /**
   * Other versions of this same topic that the search collapsed away.
   *
   * Fluid Topics publishes one entry per product version, all sharing an
   * `ft:clusterId`; `dedupeToLatestVersions` keeps the newest so a broad
   * query does not return fifteen copies of one page. Listing what it
   * dropped is what makes that reversible: the reader can see the topic
   * exists in 11.26 and ask for it by version. Newest first; absent when
   * nothing was collapsed.
   *
   * A SearchProvider's results are collapsed by the same rule
   * (`dedupeResultsToLatestVersions`), with two differences. A requested
   * `version` is kept over a newer one; Fluid Topics needs no such rule,
   * because it sends the version upstream and gets back only that version.
   * And every provider result at the version kept stays, with this set on the
   * first-ranked of them only. A provider may set this itself. What it lists
   * is kept, and any versions collapsed into the result are added to it.
   */
  otherVersions?: string[];
}

export interface FilterRelaxation {
  removed: string[];
  original: Record<string, string>;
  message: string;
}

export interface TruncatedContentInfo {
  omittedCount: number;
  omittedItems: { title: string; estimatedTokens: number }[];
}

export interface SearchResponse {
  total: number;
  results: SearchResult[];
  query: string;
  filters?: {
    product?: string;
    version?: string;
    topic?: string;
  };
  tokenInfo: TokenInfo;
  pagination: PaginationInfo;
  filterRelaxation?: FilterRelaxation;
  /** See {@link SearchDocumentationResult.queryNote}. */
  queryNote?: string;
  versionNote?: string;
  relevanceNote?: string;
  /** Set when the requested page was clamped to the last available page. */
  paginationNote?: string;
  /**
   * @deprecated Not sent since 2026-09-28: no result is left off every page
   * any more. See {@link SearchDocumentationResult.truncatedContent}.
   */
  truncatedContent?: TruncatedContentInfo;
  /** See {@link SearchDocumentationResult.truncatedResult}. */
  truncatedResult?: SearchTruncatedResult;
}

/**
 * A search result larger than `maxTokens` on its own, as its page shows it:
 * alone, with its snippet cut to the longest start that fits and ended with
 * `…`. Its title and URL are shown whole.
 */
export interface SearchTruncatedResult {
  title: string;
  /**
   * What the whole result costs: the smallest `maxTokens` at which it is
   * shown whole. Pages are cut to `maxTokens`, so at that budget it may be on
   * a different page.
   */
  estimatedTokens: number;
}

// Article fetch types

/**
 * Options for fetching articles
 */
export interface FetchArticleOptions {
  includeRelated?: boolean;
  section?: string;
  summaryOnly?: boolean;
  maxTokens?: number;
  locale?: LocaleId | undefined;
}

/**
 * Article result with token and section info
 */
export interface FetchArticleResult extends ParsedArticle {
  tokenInfo: TokenInfo;
  sections: ArticleSection[];
  /**
   * True when `section` was requested and matched no heading, so `content` is
   * the not-found reply rather than that section.
   *
   * Carried so the formatter does not announce `*Showing section: "…"*` above
   * a reply saying there is no such section — which it did, because it only
   * ever saw the requested name.
   */
  sectionNotFound?: boolean;
}

/**
 * Options for fetching table of contents
 */
export interface FetchTocOptions {
  page?: number;
  maxTokens?: number;
  locale?: LocaleId | undefined;
}

/**
 * TOC result with pagination and token info
 */
export interface FetchTocResult {
  toc: TocEntry[];
  pagination: PaginationInfo;
  tokenInfo: TokenInfo;
  /**
   * The Fluid Topics map the entries came from.
   *
   * Together with an entry's `contentId` this is the pair `jamf_docs_get_article`
   * documents as obtainable "from search results or TOC", so it is carried out
   * of here rather than staying an implementation detail of the fetch.
   *
   * Optional because a `TocProvider` serving its own cache need not know it,
   * and a sitemap or Intercom source has no map. A tree from the `ft-toc-v2`
   * cache carries the id it was fetched under: until 2026-09-28 it was named
   * by asking the registry again, which could name a newer map than the one
   * its entries came from.
   */
  mapId?: string;
  /**
   * Set when the requested page was clamped to the last available page, or
   * when `maxTokens` makes more pages than `page` accepts (see
   * `paginateTocEntries`).
   */
  paginationNote?: string;
  /**
   * Set when this page is one top-level entry cut to fit `maxTokens`.
   *
   * Only that case sets `tokenInfo.truncated`: every other page holds whole
   * entries, and the rest are on the pages after it. A `TocProvider` that
   * sets `truncated` without this gets general advice to raise `maxTokens`.
   */
  truncatedEntry?: TocTruncatedEntry;
  /**
   * The locale of the map that actually answered.
   *
   * Differs from the requested one whenever Jamf does not publish this
   * publication in it — most families are en-US only, and
   * `jamf-school-documentation` has no zh-TW map at all. The registry has
   * always fallen back to en-US; carrying the answer out is what lets the
   * caller say so rather than presenting English as a translation.
   *
   * This server's locale id (`ja-JP`), whichever source answered, since
   * `get_toc` compares it with the `language` it was asked in. A static
   * source's own code (`ja`) is not one: see `fetchStaticToc`.
   */
  resolvedLocale?: string;
}

/**
 * The backend that ordered a search's results: the Fluid Topics clustered
 * search, or an injected `SearchProvider` that answered instead of it.
 */
export type SearchRanker = 'fluid-topics' | 'provider';

/**
 * Search response with token and pagination info
 */
export interface SearchDocumentationResult {
  results: SearchResult[];
  pagination: PaginationInfo;
  tokenInfo: TokenInfo;
  filterRelaxation?: FilterRelaxation;
  versionNote?: string;
  /**
   * Set when no page had a phrase the query quotes in 「」, 『』, ｢｣ or « » as
   * written, and Fluid Topics was asked again with those quotes as typed,
   * which it reads as none (see `looseQueryForFluidTopics`): which phrases,
   * and that `results` are for that second search, or that it found nothing
   * either. Since 2026-09-28.
   */
  queryNote?: string;
  /**
   * How many results come before this page's first one, which is result
   * `offset + 1` of `pagination.totalItems`. A page holds as many whole
   * results as fit `maxTokens`, so this is not `(page - 1) * pageSize` in
   * general. Absent from a result not built by `searchDocumentation`.
   */
  offset?: number;
  /**
   * Results left off this page by the token budget.
   *
   * @deprecated Not set since 2026-09-28. Until then a page was `pageSize`
   * results cut to `maxTokens`, and this listed the ones cut, which were on no
   * page at all: page N+1 began at result `pageSize`·N whatever the cut left
   * out. Pages are now cut to `maxTokens` as they are walked, so every result
   * is on some page and none is left out. See `truncatedResult` for the one
   * cut that remains.
   */
  truncatedContent?: TruncatedContentInfo;
  /**
   * Set on a page that is one result larger than `maxTokens` on its own,
   * shown with its snippet cut to fit. Only that page has
   * `tokenInfo.truncated`: every other page holds whole results, as many as
   * fit, and the rest are on the pages after it.
   */
  truncatedResult?: SearchTruncatedResult;
  /**
   * Set when the requested page was clamped to the last available page, or
   * when the budget and page size make more pages than `page` accepts; it then
   * says what reaches the rest.
   */
  paginationNote?: string;
  /**
   * Set when the search could not be completed, whatever stopped it: the
   * SearchProvider threw, a request to learn.jamf.com failed or answered with
   * something that could not be read, the maps list a product filter needs
   * could not be read (from learn.jamf.com or a MapsProvider), or anything
   * else threw on the way, such as the cache. `results` is then empty, and
   * says nothing about what matches. The error as `String()` gives it, for
   * logs.
   */
  searchError?: string;
  /**
   * Set with `searchError`: the same failure, written for the caller. It says
   * in plain words what failed and, where that is known, why ("HTTP 503
   * Service Unavailable", "the request timed out", a provider's own message),
   * that this is not a "no results", and whether trying again may help.
   * `jamf_docs_search` returns it as its error.
   */
  searchErrorMessage?: string;
  /**
   * Which backend ranked `results`. The order is that backend's: filtering,
   * paging and token truncation all keep it.
   *
   * What lets the tool say who ranked them. Without it the tool could not
   * tell, and its relevanceNote named Fluid Topics on every reply, including
   * the ones a provider answered without a single request to Fluid Topics.
   * Absent when `searchError` is set, because then nothing ranked anything.
   */
  rankedBy?: SearchRanker;
}

// Article types
export interface GetArticleParams {
  url: string;
  language?: LocaleId | undefined;
  includeRelated?: boolean;
  section?: string | undefined;
  maxTokens?: number | undefined;
  responseFormat?: ResponseFormat;
}

/** One table-of-contents neighbour, under the title the TOC gives it. */
export interface ArticleNavigationLink {
  title: string;
  url: string;
}

/**
 * Where an article sits in its product's table of contents.
 *
 * `siblingCount`/`childCount` are the totals in the tree, not the lengths of
 * the arrays above them: a provider caps those lists (a root page's siblings
 * are the product's ~20 top-level nodes), and a truncated list that does not
 * say so is a list a reader will treat as exhaustive.
 */
export interface ArticleNavigation {
  /** The node itself. */
  self: ArticleNavigationLink;
  parent?: ArticleNavigationLink | undefined;
  siblings: ArticleNavigationLink[];
  children: ArticleNavigationLink[];
  siblingCount: number;
  childCount: number;
}

/**
 * An article as a provider hands it over — and, `content` aside, exactly what
 * the structured channel publishes.
 *
 * This is the contract, not a superset of one: `buildArticleStructuredContent`
 * in tools/get-article.ts assigns every key here a disposition through a
 * `Record<keyof ParsedArticle, …>`, so adding a field below without deciding
 * what the structured channel does with it is a compile error. That is the
 * point of routing provider signals through this interface rather than through
 * an intersection type on the provider side — a field an `ArticleProvider`
 * returns that is not declared here is published on no channel and reported
 * nowhere.
 */
export interface ParsedArticle {
  title: string;
  content: string;
  url: string;
  product?: string | undefined;
  version?: string | undefined;
  lastUpdated?: string | undefined;
  breadcrumb?: string[] | undefined;
  relatedArticles?: {
    title: string;
    url: string;
  }[] | undefined;
  mapId?: string | undefined;
  contentId?: string | undefined;
  /**
   * Whether this copy came from the release upstream still flags as current.
   *
   * Absent means "not known" — no map, no cached map, or no flag on it — which
   * is three different silences, none of which is `'superseded'`.
   */
  versionStatus?: 'latest' | 'superseded' | undefined;
  /**
   * The language of the bytes in `content`.
   *
   * Not the requested locale and not the locale in `url`, both of which still
   * say e.g. `th-TH` when Jamf has no translation and served English. A
   * concepts.jamf.com or support.jamf.com page sets it to the edition served
   * (since 2026-09-28), and there `url` is that edition's own address. A
   * learn.jamf.com topic sets it to its `ft:locale` (since the same day).
   *
   * An `ArticleProvider` sets it to one of the tool's locale ids
   * (`SUPPORTED_LOCALES`, such as `ja-JP`). The note that says whether
   * `language` was served compares it with `language` exactly. It reads any
   * other value, `ja`, `en` or `''`, as saying nothing, and then reads the
   * language off the article's own address, if it has one.
   */
  contentLocale?: string | undefined;
  /** Where the page sits in its product's table of contents. */
  navigation?: ArticleNavigation | undefined;
}

export interface ArticleResponse extends ParsedArticle {
  format: ResponseFormat;
  tokenInfo: TokenInfo;
  sections: ArticleSection[];
}

// Glossary types
export interface GlossaryEntry {
  term: string;
  definition: string;
  url: string;
  product?: string | undefined;
}

export interface GlossaryLookupResult {
  entries: GlossaryEntry[];
  totalMatches: number;
  tokenInfo: TokenInfo;
  /**
   * Set when matching entries were left out to fit `maxTokens`: each one, in
   * rank order, with the tokens it costs against that budget. `entries` can be
   * empty while `totalMatches` is not, when not even the leading entry fits;
   * the first item's `estimatedTokens` is then the smallest `maxTokens` that
   * returns it. Absent when every match fits.
   */
  truncatedContent?: TruncatedContentInfo | undefined;
  /**
   * Set when some candidate entries could not be fetched but the others
   * answered the term. `entries` is then an answer from part of the glossary:
   * `unfetched` names the rest, and `message` says so in a sentence. Absent
   * when every candidate was read. (When none could be, or what was read does
   * not answer the term, the lookup throws instead: see
   * `GlossaryUnavailableError`.)
   */
  incomplete?: {
    unfetched: { term: string; url: string }[];
    message: string;
  } | undefined;
}

// Fluid Topics API types

export interface FtTocNode {
  tocId: string;
  contentId: string;
  /**
   * Optional for the same reason as {@link FtTopicInfo.title}: this shape is a
   * bare cast over `response.json()` (`httpGetJson<FtTocNode | FtTocNode[]>`)
   * with no runtime validation behind it.
   */
  title?: string;
  prettyUrl: string;
  hasRating?: boolean;
  /**
   * Optional for the same reason as `title`. Fluid Topics omits the key
   * entirely on leaf nodes rather than sending `[]`. Declaring it required
   * told the compiler that `if (node.children && ...)` was dead code, and
   * removing that guard in 4.0.1 turned a leaf node into
   * `TypeError: Cannot read properties of undefined (reading 'length')`.
   */
  children?: FtTocNode[];
}

export interface FtMetadataEntry {
  key: string;
  label: string;
  values: string[];
}

export interface FtSearchTopic {
  mapId: string;
  contentId: string;
  tocId: string;
  /** Optional for the same reason as {@link FtTopicInfo.title}. */
  title?: string;
  htmlTitle: string;
  mapTitle: string;
  breadcrumb: string[];
  htmlExcerpt: string;
  /** Optional for the same reason as `title`; readers go through getMetaValue(s). */
  metadata?: FtMetadataEntry[];
}

export interface FtSearchMap {
  mapId: string;
  mapUrl: string;
  readerUrl: string;
  /** Optional for the same reason as {@link FtTopicInfo.title}. */
  title?: string;
  htmlTitle: string;
  htmlExcerpt: string;
  /** Optional for the same reason as `title`; readers go through getMetaValue(s). */
  metadata?: FtMetadataEntry[];
  editorialType: string;
  lastEditionDate?: string;
  lastPublicationDate?: string;
  openMode: string;
}

/**
 * A document Fluid Topics indexes beside the maps: not a topic of any map,
 * and not something `jamf_docs_get_article` can read.
 *
 * Every one measured is a course or learning path of the Jamf Training
 * Catalog, crawled from trainingcatalog.jamf.com: the 67 DOCUMENT entries of
 * 127 searches on 2026-09-28, in en-US, ja-JP and zh-TW, all with `openMode`
 * EXTERNAL, the course as `originUrl`, Jamf's product classification and a
 * `jamf:contentType` of "Training Content" (in the language searched), and
 * no `version` or `content-*` label.
 */
export interface FtSearchDocument {
  documentId: string;
  /** Optional for the same reason as {@link FtTopicInfo.title}. */
  title?: string;
  htmlTitle?: string;
  htmlExcerpt?: string;
  /** Optional for the same reason as `title`; readers go through getMetaValue(s). */
  metadata?: FtMetadataEntry[];
  /** `EXTERNAL` on a document Jamf's portal opens at `originUrl`. */
  openMode?: string;
  /** Where the document is: the course, for a Jamf Training Catalog course. */
  originUrl?: string;
  /** Fluid Topics' own page for the document, on learn.jamf.com. */
  viewerUrl?: string;
}

export interface FtSearchEntry {
  type: 'TOPIC' | 'MAP' | 'DOCUMENT';
  missingTerms: string[];
  topic?: FtSearchTopic;
  map?: FtSearchMap;
  document?: FtSearchDocument;
}

export interface FtSearchCluster {
  metadataVariableAxis: string;
  entries: FtSearchEntry[];
}

export interface FtSearchPaging {
  currentPage: number;
  isLastPage: boolean;
  totalResultsCount: number;
  totalClustersCount: number;
}

export interface FtClusteredSearchResponse {
  facets: unknown[];
  results: FtSearchCluster[];
  announcements: unknown[];
  paging: FtSearchPaging;
}

export interface FtSearchFilter {
  key: string;
  values: string[];
}

export interface FtSearchRequest {
  query: string;
  contentLocale?: string;
  paging?: { perPage: number; page: number };
  filters?: FtSearchFilter[];
  sortId?: string;
}

export interface FtMapInfo {
  /** Optional for the same reason as {@link FtTopicInfo.title}. */
  title?: string;
  id: string;
  mapApiEndpoint: string;
  /** Optional for the same reason as `title`; readers go through getMetaValue(s). */
  metadata?: FtMetadataEntry[];
}

export interface FtTopicInfo {
  /**
   * Optional because this shape is a bare cast over `response.json()`
   * (`httpGetJson<FtTopicInfo>`) with no runtime validation behind it — it
   * describes what Fluid Topics usually sends, not what it is obliged to.
   * Declaring `title` required told the compiler a guard against a missing one
   * was dead code, and removing that guard was how a titleless payload started
   * producing an article with `undefined` for a title instead of falling back
   * to the parsed `<h1>`.
   */
  title?: string;
  id: string;
  contentApiEndpoint: string;
  readerUrl?: string;
  breadcrumb?: string[];
  /** Optional for the same reason as `title`; readers go through getMetaValue(s). */
  metadata?: FtMetadataEntry[];
}

// TOC types
export interface GetTocParams {
  product: ProductId;
  language?: LocaleId | undefined;
  version?: string;
  page?: number | undefined;
  maxTokens?: number | undefined;
}

export interface TocEntry {
  title: string;
  url: string;
  contentId?: string;
  tocId?: string;
  children?: TocEntry[];
}

/**
 * A top-level TOC entry larger than `maxTokens` on its own, as its page shows
 * it: alone, with its subtree cut to the entries, in document order, that fit.
 */
export interface TocTruncatedEntry {
  title: string;
  /** Entries of its subtree the page shows, itself included. */
  shownEntries: number;
  /** Entries of its subtree, itself included. */
  totalEntries: number;
  /**
   * What the whole subtree costs: the smallest `maxTokens` at which it is
   * shown whole. Pages are cut to `maxTokens`, so at that budget it may be on
   * a different page.
   */
  estimatedTokens: number;
}

export interface TocResponse {
  product: string;
  version: string;
  /** See {@link FetchTocResult.mapId}. Pairs with each entry's `contentId`. */
  mapId?: string;
  toc: TocEntry[];
  tokenInfo: TokenInfo;
  pagination: PaginationInfo;
  /** See {@link FetchTocResult.truncatedEntry}. */
  truncatedEntry?: TocTruncatedEntry;
  /** See {@link FetchTocResult.paginationNote}. */
  paginationNote?: string;
}

// Cache types
export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

export interface CacheOptions {
  ttl?: number;
  forceRefresh?: boolean;
}

// Error types
export class JamfDocsError extends Error {
  constructor(
    message: string,
    public readonly code: JamfDocsErrorCode,
    public readonly url?: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = 'JamfDocsError';
  }
}

export enum JamfDocsErrorCode {
  NOT_FOUND = 'NOT_FOUND',
  RATE_LIMITED = 'RATE_LIMITED',
  PARSE_ERROR = 'PARSE_ERROR',
  NETWORK_ERROR = 'NETWORK_ERROR',
  INVALID_URL = 'INVALID_URL',
  INVALID_PRODUCT = 'INVALID_PRODUCT',
  CACHE_ERROR = 'CACHE_ERROR',
  TIMEOUT = 'TIMEOUT'
}

// MCP Tool types - compatible with MCP SDK CallToolResult
export interface ToolResult {
  [key: string]: unknown;
  content: {
    type: 'text';
    text: string;
  }[];
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}
