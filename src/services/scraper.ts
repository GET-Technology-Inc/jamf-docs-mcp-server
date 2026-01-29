/**
 * Web scraping service for Jamf documentation
 *
 * This module handles fetching and parsing HTML from learn.jamf.com
 * (Jamf documentation has moved from docs.jamf.com to learn.jamf.com)
 */

import axios, { type AxiosError } from 'axios';
import * as cheerio from 'cheerio';
import TurndownService from 'turndown';

import {
  DOCS_BASE_URL,
  DOCS_API_URL,
  JAMF_PRODUCTS,
  JAMF_TOPICS,
  REQUEST_CONFIG,
  SELECTORS,
  CONTENT_LIMITS,
  TOKEN_CONFIG,
  PAGINATION_CONFIG,
  type ProductId,
  type TopicId
} from '../constants.js';
import {
  JamfDocsError,
  JamfDocsErrorCode,
  type SearchResult,
  type ParsedArticle,
  type TocEntry,
  type SearchParams,
  type ZoominSearchResponse,
  type TokenInfo,
  type PaginationInfo,
  type ArticleSection
} from '../types.js';
import { cache } from './cache.js';
import {
  estimateTokens,
  createTokenInfo,
  extractSections,
  extractSection,
  extractSummary,
  truncateToTokenLimit,
  calculatePagination
} from './tokenizer.js';
import { getBundleIdForVersion } from './metadata.js';

// Initialize Turndown for HTML to Markdown conversion
const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  emDelimiter: '*',
  strongDelimiter: '**'
});

// Custom Turndown rules
turndown.addRule('codeBlocks', {
  filter: 'pre',
  replacement: (content, node) => {
    // Handle code element extraction safely
    const nodeElement = node as unknown as { querySelector?: (selector: string) => { className?: string } | null };
    const codeElement = nodeElement.querySelector?.('code');
    const language = codeElement?.className?.replace('language-', '') ?? '';
    return `\n\`\`\`${language}\n${content.trim()}\n\`\`\`\n`;
  }
});

// Rate limiter
let lastRequestTime = 0;

async function throttle(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;

  if (elapsed < REQUEST_CONFIG.RATE_LIMIT_DELAY) {
    await new Promise(resolve =>
      setTimeout(resolve, REQUEST_CONFIG.RATE_LIMIT_DELAY - elapsed)
    );
  }

  lastRequestTime = Date.now();
}

// URL transformation between frontend (learn.jamf.com) and backend (learn-be.jamf.com)
const transformToBackendUrl = (url: string): string => url.replace('learn.jamf.com', 'learn-be.jamf.com');
const transformToFrontendUrl = (url: string): string => url.replace('learn-be.jamf.com', 'learn.jamf.com');

// HTML entity map for stripping HTML
const HTML_ENTITIES: Record<string, string> = {
  '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'"
};

/**
 * Strip HTML tags from a string
 * Uses iterative approach to handle nested/malformed tags
 */
function stripHtml(html: string): string {
  let text = html;
  // Iteratively remove HTML tags until none remain (handles nested cases like <scr<script>ipt>)
  let prev = '';
  while (prev !== text) {
    prev = text;
    text = text.replace(/<[^>]*>/g, '');
  }
  for (const [entity, char] of Object.entries(HTML_ENTITIES)) {
    text = text.replaceAll(entity, char);
  }
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Handle axios errors and convert to JamfDocsError
 */
function handleAxiosError(error: AxiosError, url: string, resourceType: string): never {
  const status = error.response?.status;

  if (status === 404) {
    throw new JamfDocsError(`${resourceType} not found: ${url}`, JamfDocsErrorCode.NOT_FOUND, url, 404);
  }
  if (status === 429) {
    throw new JamfDocsError('Rate limited. Please wait and try again.', JamfDocsErrorCode.RATE_LIMITED, url, 429);
  }
  if (error.code === 'ECONNABORTED') {
    throw new JamfDocsError('Request timed out', JamfDocsErrorCode.TIMEOUT, url);
  }
  throw new JamfDocsError(`Network error: ${error.message}`, JamfDocsErrorCode.NETWORK_ERROR, url);
}

/**
 * Fetch data from a URL with error handling
 */
async function fetchUrl<T>(url: string, accept: string, resourceType: string): Promise<T> {
  await throttle();

  try {
    const response = await axios.get<T>(url, {
      timeout: REQUEST_CONFIG.TIMEOUT,
      headers: {
        'User-Agent': REQUEST_CONFIG.USER_AGENT,
        'Accept': accept,
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      handleAxiosError(error, url, resourceType);
    }
    throw error;
  }
}

const fetchJson = async <T>(url: string): Promise<T> => await fetchUrl<T>(url, 'application/json', 'Resource');
const fetchHtml = async (url: string): Promise<string> => await fetchUrl<string>(url, 'text/html,application/xhtml+xml', 'Article');

/**
 * Clean HTML content by removing unwanted elements
 */
function cleanHtml($: cheerio.CheerioAPI): void {
  // Remove unwanted elements
  $(SELECTORS.REMOVE).remove();

  // Fix relative URLs
  $('a[href^="/"]').each((_, el) => {
    const href = $(el).attr('href');
    if (href !== undefined && href !== '') {
      $(el).attr('href', `${DOCS_BASE_URL}${href}`);
    }
  });

  $('img[src^="/"]').each((_, el) => {
    const src = $(el).attr('src');
    if (src !== undefined && src !== '') {
      $(el).attr('src', `${DOCS_BASE_URL}${src}`);
    }
  });
}

/**
 * Extract product and version from URL
 * Supports both old docs.jamf.com and new learn.jamf.com URL structures
 */
function extractProductInfo(url: string): { product: string | undefined; version: string | undefined } {
  // learn.jamf.com structure: /en-US/bundle/{product}-documentation/page/{page}.html
  const bundleMatch = /\/bundle\/([^/]+)-documentation\//.exec(url);
  if (bundleMatch !== null) {
    const product = Object.values(JAMF_PRODUCTS).find(p => p.bundleId.includes(bundleMatch[1] ?? ''));
    return { product: product?.name, version: 'current' };
  }

  // Legacy docs.jamf.com structure: /{version}/{product}/...
  const pathParts = new URL(url).pathname.split('/').filter(Boolean);
  const versionMatch = pathParts[0]?.match(/^\d+\.\d+(\.\d+)?$/);
  if (versionMatch !== null && versionMatch !== undefined) {
    const product = Object.values(JAMF_PRODUCTS).find(p => p.urlPattern.includes(pathParts[1] ?? ''));
    return { product: product?.name, version: pathParts[0] };
  }

  // Check for unversioned paths
  const matchedProduct = Object.values(JAMF_PRODUCTS).find(p => url.includes(p.bundleId) || url.includes(p.id));
  return { product: matchedProduct?.name, version: matchedProduct !== undefined ? 'current' : undefined };
}

/**
 * Search result with metadata for filtering
 */
interface SearchResultWithMeta {
  result: SearchResult;
  bundleSlug: string | null;
  matchedTopics: TopicId[];
}

/**
 * Check if a search result matches a topic based on keywords
 */
function matchesTopic(result: SearchResult, topicId: TopicId): boolean {
  const topic = JAMF_TOPICS[topicId];
  const searchText = `${result.title} ${result.snippet}`.toLowerCase();

  return topic.keywords.some(keyword =>
    searchText.includes(keyword.toLowerCase())
  );
}

/**
 * Search response with token and pagination info
 */
export interface SearchDocumentationResult {
  results: SearchResult[];
  pagination: PaginationInfo;
  tokenInfo: TokenInfo;
}

/**
 * Search Jamf documentation using Zoomin Search API
 */
export async function searchDocumentation(params: SearchParams): Promise<SearchDocumentationResult> {
  const page = params.page ?? PAGINATION_CONFIG.DEFAULT_PAGE;
  const pageSize = params.limit ?? CONTENT_LIMITS.DEFAULT_SEARCH_RESULTS;
  const maxTokens = params.maxTokens ?? TOKEN_CONFIG.DEFAULT_MAX_TOKENS;
  const cacheKey = `search:${JSON.stringify({ ...params, page: 1 })}`; // Cache without page for full results

  // Check cache for full results
  let allResults: SearchResultWithMeta[] | null = await cache.get<SearchResultWithMeta[]>(cacheKey);

  if (allResults === null) {
    // Fetch more results to allow for filtering
    const fetchLimit = CONTENT_LIMITS.MAX_SEARCH_RESULTS;

    // Build API URL with query params
    const apiUrl = new URL(`${DOCS_API_URL}/api/search`);
    apiUrl.searchParams.set('q', params.query);
    apiUrl.searchParams.set('rpp', fetchLimit.toString());

    console.error(`[SEARCH] Query: "${params.query}", Product: ${params.product ?? 'all'}, Topic: ${params.topic ?? 'all'}, URL: ${apiUrl.toString()}`);

    try {
      const response = await fetchJson<ZoominSearchResponse>(apiUrl.toString());

      // Transform Zoomin results to SearchResult format with metadata
      allResults = response.Results
        .filter((wrapper): wrapper is typeof wrapper & { leading_result: NonNullable<typeof wrapper.leading_result> } =>
          wrapper.leading_result !== null && wrapper.leading_result !== undefined
        )
        .map(wrapper => {
          const result = wrapper.leading_result;

          // Extract product from bundle_id
          const bundleId = result.bundle_id;
          const bundleMatch = /^(jamf-[a-z]+)-documentation/.exec(bundleId);
          const bundleSlug: string | null = bundleMatch?.[1] ?? null;
          const productEntry = bundleSlug !== null
            ? Object.entries(JAMF_PRODUCTS).find(([id]) => id === bundleSlug)
            : null;

          const searchResult: SearchResult = {
            title: result.title !== '' ? result.title : 'Untitled',
            url: transformToFrontendUrl(result.url !== '' ? result.url : ''),
            snippet: stripHtml(result.snippet !== '' ? result.snippet : '').slice(0, CONTENT_LIMITS.MAX_SNIPPET_LENGTH),
            product: productEntry !== null && productEntry !== undefined ? productEntry[1].name : (result.publication_title !== '' ? result.publication_title : 'Jamf'),
            version: 'current'
          };

          if (result.score !== undefined) {
            searchResult.relevance = result.score;
          }

          // Find matched topics
          const matchedTopics: TopicId[] = (Object.keys(JAMF_TOPICS) as TopicId[])
            .filter(topicId => matchesTopic(searchResult, topicId));

          return { result: searchResult, bundleSlug, matchedTopics };
        });

      // Cache full results
      await cache.set(cacheKey, allResults);
    } catch (error) {
      console.error('[SEARCH] Error:', error);

      if (error instanceof JamfDocsError) {
        throw error;
      }

      // Return empty results on error
      return {
        results: [],
        pagination: {
          page: 1,
          pageSize,
          totalPages: 0,
          totalItems: 0,
          hasNext: false,
          hasPrev: false
        },
        tokenInfo: createTokenInfo('', maxTokens)
      };
    }
  }

  // Apply filters
  let filteredResults = allResults;

  // Product filter
  if (params.product !== undefined) {
    filteredResults = filteredResults.filter(r => r.bundleSlug === params.product);
  }

  // Topic filter
  if (params.topic !== undefined) {
    const topicFilter = params.topic;
    filteredResults = filteredResults.filter(r => r.matchedTopics.includes(topicFilter));
  }

  // Calculate pagination
  const paginationInfo = calculatePagination(filteredResults.length, page, pageSize);

  // Get paginated results
  const paginatedResults = filteredResults
    .slice(paginationInfo.startIndex, paginationInfo.endIndex)
    .map(r => r.result);

  // Calculate token info
  const resultText = paginatedResults.map(r => `${r.title}\n${r.snippet}\n${r.url}`).join('\n\n');
  const tokenCount = estimateTokens(resultText);

  // Check if we need to truncate
  let finalResults = paginatedResults;
  let truncated = false;

  if (tokenCount > maxTokens) {
    // Truncate results to fit token limit
    let runningTokens = 0;
    finalResults = [];

    for (const result of paginatedResults) {
      const resultTokens = estimateTokens(`${result.title}\n${result.snippet}\n${result.url}`);
      if (runningTokens + resultTokens > maxTokens) {
        truncated = true;
        break;
      }
      finalResults.push(result);
      runningTokens += resultTokens;
    }
  }

  return {
    results: finalResults,
    pagination: {
      page: paginationInfo.page,
      pageSize: paginationInfo.pageSize,
      totalPages: paginationInfo.totalPages,
      totalItems: filteredResults.length,
      hasNext: paginationInfo.hasNext || truncated,
      hasPrev: paginationInfo.hasPrev
    },
    tokenInfo: {
      tokenCount: estimateTokens(finalResults.map(r => `${r.title}\n${r.snippet}\n${r.url}`).join('\n\n')),
      truncated,
      maxTokens
    }
  };
}

/**
 * Options for fetching articles
 */
export interface FetchArticleOptions {
  includeRelated?: boolean;
  section?: string;
  summaryOnly?: boolean;
  maxTokens?: number;
}

/**
 * Article result with token and section info
 */
export interface FetchArticleResult extends ParsedArticle {
  tokenInfo: TokenInfo;
  sections: ArticleSection[];
}

/**
 * Fetch and parse a documentation article
 * Uses backend URL (learn-be.jamf.com) for pre-rendered content
 */
export async function fetchArticle(
  url: string,
  options: FetchArticleOptions = {}
): Promise<FetchArticleResult> {
  const maxTokens = options.maxTokens ?? TOKEN_CONFIG.DEFAULT_MAX_TOKENS;

  // Store original URL for display, use backend URL for fetching
  const displayUrl = transformToFrontendUrl(url);
  const articleFetchUrl = transformToBackendUrl(url);
  const cacheKey = `article:${displayUrl}`;

  // Check cache for raw article (without section/token processing)
  let rawArticle = await cache.get<ParsedArticle>(cacheKey);

  if (rawArticle === null) {
    // Fetch HTML from backend URL (pre-rendered content, not SPA shell)
    const html = await fetchHtml(articleFetchUrl);
    const $ = cheerio.load(html);

    // Clean content
    cleanHtml($);

    // Extract content
    const contentHtml = $(SELECTORS.CONTENT).html() ?? '';
    const extractedTitle = $(SELECTORS.TITLE).first().text().trim();
    const title = extractedTitle !== '' ? extractedTitle : 'Untitled';

    // Convert to Markdown
    const content = turndown.turndown(contentHtml);

    // Extract breadcrumb
    const breadcrumb = $(SELECTORS.BREADCRUMB)
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean);

    // Extract related articles
    const relatedArticles = options.includeRelated === true
      ? $(SELECTORS.RELATED).map((_, el) => ({
          title: $(el).text().trim(),
          url: $(el).attr('href') ?? ''
        })).get().filter(r => r.title !== '' && r.url !== '')
      : undefined;

    // Extract product info from URL
    const { product, version } = extractProductInfo(displayUrl);

    rawArticle = {
      title,
      content,
      url: displayUrl,
      product,
      version,
      breadcrumb: breadcrumb.length > 0 ? breadcrumb : undefined,
      relatedArticles: relatedArticles !== undefined && relatedArticles.length > 0 ? relatedArticles : undefined
    };

    // Cache raw article
    await cache.set(cacheKey, rawArticle);
  }

  // At this point rawArticle is guaranteed to be non-null
  const article = rawArticle;

  // Extract all sections
  const allSections = extractSections(article.content);

  // Handle summaryOnly mode
  if (options.summaryOnly === true) {
    const summaryResult = extractSummary(article.content, article.title, maxTokens);

    // Build summary content
    let summaryContent = `## Summary\n\n${summaryResult.summary}\n\n`;
    summaryContent += `## Article Outline (${summaryResult.outline.length} sections)\n\n`;

    for (const section of summaryResult.outline) {
      const indent = '  '.repeat(Math.max(0, section.level - 1));
      summaryContent += `${indent}- ${section.title} (~${section.tokenCount} tokens)\n`;
    }

    summaryContent += `\n*Estimated read time: ${summaryResult.estimatedReadTime} min | Total: ${summaryResult.totalTokens.toLocaleString()} tokens*\n`;

    return {
      ...article,
      content: summaryContent,
      tokenInfo: summaryResult.tokenInfo,
      sections: allSections
    };
  }

  // Handle section extraction if requested
  let processedContent: string;
  let tokenInfo: TokenInfo;

  if (options.section !== undefined && options.section !== '') {
    // Extract specific section
    const sectionResult = extractSection(article.content, options.section, maxTokens);
    processedContent = sectionResult.content;
    tokenInfo = sectionResult.tokenInfo;

    if (sectionResult.section === null) {
      // Section not found, return error info
      processedContent = `*Section "${options.section}" not found.*\n\n**Available sections:**\n${allSections.map(s => `- ${s.title}`).join('\n')}`;
      tokenInfo = createTokenInfo(processedContent, maxTokens);
    }
  } else {
    // Apply token limit with smart truncation
    const truncateResult = truncateToTokenLimit(article.content, maxTokens);
    processedContent = truncateResult.content;
    tokenInfo = truncateResult.tokenInfo;
  }

  return {
    ...article,
    content: processedContent,
    tokenInfo,
    sections: allSections
  };
}

/**
 * Discover the latest bundle version for a product via search API
 */
async function discoverLatestBundleId(product: ProductId): Promise<string | null> {
  const productInfo = JAMF_PRODUCTS[product];
  const baseBundleId = productInfo.bundleId;

  try {
    // Search for any document from this product to discover the latest version
    const apiUrl = `${DOCS_API_URL}/api/search?q=${encodeURIComponent(productInfo.name)}&rpp=10`;
    const response = await fetchJson<ZoominSearchResponse>(apiUrl);

    // Find a result with a matching bundle prefix
    for (const wrapper of response.Results) {
      if (wrapper.leading_result === null || wrapper.leading_result === undefined) {
        continue;
      }
      const bundleId = wrapper.leading_result.bundle_id;
      if (bundleId.startsWith(baseBundleId)) {
        return bundleId;
      }
    }
  } catch (error) {
    console.error(`[TOC] Error discovering bundle version for ${product}:`, error);
  }

  return null;
}

/**
 * Parse TOC HTML from Zoomin backend
 */
function parseTocHtml(html: string): TocEntry[] {
  const $ = cheerio.load(html);
  const toc: TocEntry[] = [];

  // Parse the nested list structure
  $('ul.list-links > li.toc').each((_, el) => {
    const entry = parseTocEntry($, el);
    if (entry !== null) {
      toc.push(entry);
    }
  });

  return toc;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseTocEntry($: cheerio.CheerioAPI, el: any): TocEntry | null {
  const $el = $(el);
  const $link = $el.children('.inner').children('a').first();

  const title = $link.text().trim();
  let url = $link.attr('href') ?? '';

  if (title === '' || url === '') {
    return null;
  }

  // Transform to frontend URL for display
  url = transformToFrontendUrl(url);

  const entry: TocEntry = { title, url };

  // Check for children
  const $children = $el.children('ul.list-links');
  if ($children.length > 0) {
    const children: TocEntry[] = [];
    $children.children('li.toc').each((_, childEl) => {
      const childEntry = parseTocEntry($, childEl);
      if (childEntry !== null) {
        children.push(childEntry);
      }
    });
    if (children.length > 0) {
      entry.children = children;
    }
  }

  return entry;
}

/**
 * Options for fetching table of contents
 */
export interface FetchTocOptions {
  page?: number;
  maxTokens?: number;
}

/**
 * TOC result with pagination and token info
 */
export interface FetchTocResult {
  toc: TocEntry[];
  pagination: PaginationInfo;
  tokenInfo: TokenInfo;
}

/**
 * Convert TOC entry to string for token counting
 */
function tocEntryToString(entry: TocEntry, depth = 0): string {
  const indent = '  '.repeat(depth);
  const childrenStr = entry.children?.map(c => tocEntryToString(c, depth + 1)).join('') ?? '';
  return `${indent}- ${entry.title}\n${childrenStr}`;
}

/**
 * Count total TOC entries including children
 */
function countTocEntries(entries: TocEntry[]): number {
  return entries.reduce((count, entry) => count + 1 + (entry.children !== undefined ? countTocEntries(entry.children) : 0), 0);
}

/**
 * Fetch table of contents for a product
 * Uses backend TOC endpoint (learn-be.jamf.com/bundle/{bundleId}/toc)
 */
export async function fetchTableOfContents(
  product: ProductId,
  version = 'current',
  options: FetchTocOptions = {}
): Promise<FetchTocResult> {
  const page = options.page ?? PAGINATION_CONFIG.DEFAULT_PAGE;
  const maxTokens = options.maxTokens ?? TOKEN_CONFIG.DEFAULT_MAX_TOKENS;
  const cacheKey = `toc:${product}:${version}`;

  // Check cache
  let allToc = await cache.get<TocEntry[]>(cacheKey);

  if (allToc === null) {
    // Get bundle ID for the specified version (or latest if current)
    let bundleId = await getBundleIdForVersion(product, version);

    // Fallback to discovery if metadata service fails
    bundleId ??= await discoverLatestBundleId(product);

    if (bundleId === null || bundleId === '') {
      throw new JamfDocsError(
        `Could not find bundle for ${product} version ${version}`,
        JamfDocsErrorCode.NOT_FOUND
      );
    }

    // Fetch TOC from backend
    const tocUrl = `${DOCS_API_URL}/bundle/${bundleId}/toc`;
    console.error(`[TOC] Fetching TOC from: ${tocUrl}`);

    const tocJson = await fetchJson<Record<string, string>>(tocUrl);

    // Parse TOC
    allToc = [];
    for (const [, html] of Object.entries(tocJson)) {
      if (typeof html === 'string' && html.includes('<ul')) {
        const entries = parseTocHtml(html);
        allToc.push(...entries);
      }
    }

    // Cache result
    await cache.set(cacheKey, allToc);
  }

  // Count total entries
  const totalItems = countTocEntries(allToc);

  // For TOC, we paginate at the top-level entries
  const topLevelCount = allToc.length;
  const pageSize = PAGINATION_CONFIG.DEFAULT_PAGE_SIZE;
  const paginationInfo = calculatePagination(topLevelCount, page, pageSize);

  // Get paginated top-level entries (with their children)
  const paginatedToc = allToc.slice(paginationInfo.startIndex, paginationInfo.endIndex);

  // Calculate tokens for paginated TOC
  const tocText = paginatedToc.map(e => tocEntryToString(e)).join('');
  let tokenCount = estimateTokens(tocText);
  let truncated = false;
  let finalToc = paginatedToc;

  // Truncate if over token limit
  if (tokenCount > maxTokens) {
    truncated = true;
    finalToc = [];
    let runningTokens = 0;

    for (const entry of paginatedToc) {
      const entryText = tocEntryToString(entry);
      const entryTokens = estimateTokens(entryText);

      if (runningTokens + entryTokens > maxTokens) {
        break;
      }

      finalToc.push(entry);
      runningTokens += entryTokens;
    }

    tokenCount = runningTokens;
  }

  return {
    toc: finalToc,
    pagination: {
      page: paginationInfo.page,
      pageSize: paginationInfo.pageSize,
      totalPages: paginationInfo.totalPages,
      totalItems,
      hasNext: paginationInfo.hasNext || truncated,
      hasPrev: paginationInfo.hasPrev
    },
    tokenInfo: {
      tokenCount,
      truncated,
      maxTokens
    }
  };
}
