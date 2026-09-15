/**
 * Operational limits, token config, pagination, response formats, and HTML selectors
 */

// Response format
export enum ResponseFormat {
  MARKDOWN = 'markdown',
  JSON = 'json'
}

// Output mode (detail level)
export enum OutputMode {
  FULL = 'full',
  COMPACT = 'compact'
}

// Content limits
export const CONTENT_LIMITS = {
  MAX_SEARCH_RESULTS: 50,
  DEFAULT_SEARCH_RESULTS: 10,
  FILTER_OVERFETCH_MULTIPLIER: 3,       // fetch 3x when client-side filters need post-filtering
  FILTER_OVERFETCH_CAP: 150,            // absolute cap on over-fetched results
  MAX_CONTENT_LENGTH: 100000,           // 100KB
  MAX_SNIPPET_LENGTH: 500
} as const;

// Token configuration (Context7 style)
export const TOKEN_CONFIG = {
  DEFAULT_MAX_TOKENS: 5000,
  /**
   * The default for `jamf_docs_list_products`, which answers with a whole
   * catalogue rather than one document.
   *
   * Measured against live data (28 products, 108 publications in 33 groups, 40
   * topics, 6 docTypes): the full markdown is ~5639 estimated tokens and the
   * JSON payload ~8006. The shared 5000 held neither, and the two formats fail
   * differently. Markdown is cut by `truncateToTokenLimit`, which works line by
   * line from the end — so the cut landed inside the publication list and took
   * the Topics and Document Types sections with it. JSON is never actually
   * truncated; it only reports `tokenInfo.truncated`, so the shared default
   * made every JSON call claim a truncation that had not happened.
   *
   * The markdown was already over budget before the classification fix widened
   * it (~5082 tokens, 15 of the 40 topic rows surviving) — this is not new,
   * only newly total. What makes it worth fixing rather than documenting is
   * what the cut lands on: Topics and Document Types are the `topic` and
   * `docType` filter vocabularies for `jamf_docs_search`, and Publications
   * addresses `jamf_docs_get_toc`. A caller that cannot see a value cannot
   * pass it, and the truncation notice names the section, not the values.
   *
   * 10000 clears both formats — markdown by ~4361 tokens after the notice
   * reserve, JSON by ~1994 — so no reader is told the catalogue was cut when
   * it was not. This is a ceiling, not a cost: the response is only as large
   * as the catalogue, so headroom is free. `list-products-fits-its-budget` in
   * the integration suite fails if Jamf's catalogue ever outgrows it.
   */
  CATALOGUE_MAX_TOKENS: 10000,
  MAX_TOKENS_LIMIT: 50000,
  MIN_TOKENS: 100,
  CHARS_PER_TOKEN: 4,  // Estimation ratio
  CODE_CHARS_PER_TOKEN: 3  // Code blocks have higher token density
} as const;

// Pagination configuration
export const PAGINATION_CONFIG = {
  DEFAULT_PAGE: 1,
  DEFAULT_PAGE_SIZE: 10,
  MAX_PAGE: 100
} as const;

// HTML selectors for learn.jamf.com (React-based site)
/**
 * The CSS selectors one documentation source needs to be readable.
 *
 * Extracted as a type because `SELECTORS` below describes learn.jamf.com
 * specifically — its `<article>` markup, its breadcrumb classes, the wrappers
 * Fluid Topics emits — and a second source has different ones. Declaring the
 * shape lets each source carry its own set instead of every source being
 * parsed as though it were Fluid Topics.
 */
export interface SelectorSet {
  /** Where the article body lives. */
  readonly CONTENT: string;
  /** The page title. */
  readonly TITLE: string;
  /** Breadcrumb trail anchors. */
  readonly BREADCRUMB: string;
  /** Related-article anchors. */
  readonly RELATED: string;
  /** Everything to strip before converting to Markdown. */
  readonly REMOVE: string;
}

export const SELECTORS = {
  // Main content - learn.jamf.com uses semantic article tag
  CONTENT: 'article, .article-content, main article, #content',
  TITLE: 'h1',

  // Navigation - learn.jamf.com structure
  BREADCRUMB: '[class*="breadcrumb"] a, nav[aria-label="breadcrumb"] a',

  // Related content
  RELATED: 'nav.related-links a, .related-topics a, [class*="related"] a',

  // Elements to remove (scripts, tracking, etc.)
  REMOVE: 'script, style, noscript, footer, [id="initial-data"], [class*="cookie"], [class*="tracking"], [class*="analytics"]'
} as const satisfies SelectorSet;
