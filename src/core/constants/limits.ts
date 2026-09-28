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
  MAX_SNIPPET_LENGTH: 500,
  /**
   * The longest `url` an article tool takes, in characters. The longest
   * article url measured is far shorter: 273 characters over the 1,932 reader
   * urls of three learn.jamf.com maps on 2026-09-28, and 381 for the 29 ja
   * and zh-TW support.jamf.com articles captured on 2026-09-26, whose urls are
   * percent-encoded. 2,048 is a common bound on a url, and over five times the
   * longest of those. Until 2026-09-28 there was none, and the replies quote
   * a url whole: a url of 100,023 characters got an error of 100,072.
   */
  MAX_URL_LENGTH: 2048,
  /**
   * The longest `section` `jamf_docs_get_article` takes, in characters: 200,
   * as for `mapId`, `contentId` and `publication`. A section is asked for by
   * its heading or a sub-topic's title, and the longest topic title measured
   * is 149 characters, over the 3,549 topics of six learn.jamf.com maps on
   * 2026-09-28. At 200, the reply's 'Section "…" not found' line still fits
   * the smallest `maxTokens`. Until 2026-09-28 there was none, and a section
   * of 100,000 characters got a reply with an empty body and nothing saying
   * it was not found: that line was larger than `maxTokens`.
   */
  MAX_SECTION_LENGTH: 200,
  /**
   * The longest `version` a tool takes, in characters: 50, as for
   * `jamf_compare_versions`' `version_a` and `version_b`. The longest of the
   * 46 versions in the maps list on 2026-09-28 was 7 (`11.32.1`). Until
   * 2026-09-28 there was none: a 100,000-digit version went to Fluid Topics
   * as a search body of 100,143 bytes, and `jamf_docs_get_toc` answered it
   * with 100,063 characters.
   */
  MAX_VERSION_LENGTH: 50,
  /**
   * The longest product ID a prompt takes as `product`, and a resource
   * template reads as `{productId}`, in characters: 100, as
   * `jamf_compare_versions` has taken. The tools take one of the IDs, the
   * longest of which is 31 (`jamf-cloud-distribution-service`). Until
   * 2026-09-28 `jamf_troubleshoot` and `jamf_setup_guide` took a `product` of
   * any length and wrote it into the prompt twice, and both templates quoted
   * a `productId` of any length back, in the uri and in the text: offline
   * that day, one of 100,000 characters got prompts of 200,773 and 200,902
   * characters, and reads of 200,616 and 200,621.
   */
  MAX_PRODUCT_LENGTH: 100
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
  // The ARIA clause carries `i` because CSS attribute values are case-sensitive
  // by default and sites do not agree on the casing: concepts.jamf.com marks its
  // trail `aria-label="Breadcrumb"`, which the lowercase form missed entirely.
  BREADCRUMB: '[class*="breadcrumb"] a, nav[aria-label="breadcrumb" i] a',

  // Related content
  RELATED: 'nav.related-links a, .related-topics a, [class*="related"] a',

  // Elements to remove (scripts, tracking, etc.)
  REMOVE: 'script, style, noscript, footer, [id="initial-data"], [class*="cookie"], [class*="tracking"], [class*="analytics"]'
} as const satisfies SelectorSet;
