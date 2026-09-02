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
