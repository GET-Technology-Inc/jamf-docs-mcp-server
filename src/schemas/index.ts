/**
 * Zod schemas for input validation
 */

import { z } from 'zod';
import {
  ResponseFormat,
  JAMF_PRODUCTS,
  CONTENT_LIMITS,
  TOKEN_CONFIG,
  PAGINATION_CONFIG,
  JAMF_TOPICS
} from '../constants.js';

// Valid product IDs
const productIds = Object.keys(JAMF_PRODUCTS) as [string, ...string[]];

// Valid topic IDs
const topicIds = Object.keys(JAMF_TOPICS) as [string, ...string[]];

// Response format enum
const ResponseFormatSchema = z.nativeEnum(ResponseFormat);

// Common maxTokens parameter schema
const MaxTokensSchema = z.number()
  .int()
  .min(TOKEN_CONFIG.MIN_TOKENS)
  .max(TOKEN_CONFIG.MAX_TOKENS_LIMIT)
  .default(TOKEN_CONFIG.DEFAULT_MAX_TOKENS)
  .describe(`Maximum tokens in response (${TOKEN_CONFIG.MIN_TOKENS}-${TOKEN_CONFIG.MAX_TOKENS_LIMIT}, default: ${TOKEN_CONFIG.DEFAULT_MAX_TOKENS})`);

// Common page parameter schema
const PageSchema = z.number()
  .int()
  .min(1)
  .max(PAGINATION_CONFIG.MAX_PAGE)
  .default(PAGINATION_CONFIG.DEFAULT_PAGE)
  .describe(`Page number (1-${PAGINATION_CONFIG.MAX_PAGE}, default: 1)`);

/**
 * Schema for jamf_docs_list_products
 */
export const ListProductsInputSchema = z.object({
  maxTokens: MaxTokensSchema
    .optional()
    .describe(`Maximum tokens in response (${TOKEN_CONFIG.MIN_TOKENS}-${TOKEN_CONFIG.MAX_TOKENS_LIMIT}, default: ${TOKEN_CONFIG.DEFAULT_MAX_TOKENS})`),

  responseFormat: ResponseFormatSchema
    .default(ResponseFormat.MARKDOWN)
    .describe('Output format: "markdown" for human-readable or "json" for machine-readable')
}).strict();

export type ListProductsInput = z.infer<typeof ListProductsInputSchema>;

/**
 * Schema for jamf_docs_search
 */
export const SearchInputSchema = z.object({
  query: z.string()
    .min(2, 'Query must be at least 2 characters')
    .max(200, 'Query must not exceed 200 characters')
    .describe('Search keywords to find in Jamf documentation'),

  product: z.enum(productIds)
    .optional()
    .describe('Filter by product: jamf-pro, jamf-school, jamf-connect, jamf-protect'),

  topic: z.enum(topicIds)
    .optional()
    .describe('Filter by topic: enrollment, profiles, security, inventory, policies, smart-groups, apps, identity, api, network'),

  version: z.string()
    .optional()
    .describe('Filter by version (e.g., "11.5.0", "10.x")'),

  limit: z.number()
    .int()
    .min(1)
    .max(CONTENT_LIMITS.MAX_SEARCH_RESULTS)
    .default(CONTENT_LIMITS.DEFAULT_SEARCH_RESULTS)
    .describe(`Maximum number of results per page (1-${CONTENT_LIMITS.MAX_SEARCH_RESULTS})`),

  page: PageSchema
    .optional()
    .describe(`Page number for pagination (1-${PAGINATION_CONFIG.MAX_PAGE}, default: 1)`),

  maxTokens: MaxTokensSchema
    .optional()
    .describe(`Maximum tokens in response (${TOKEN_CONFIG.MIN_TOKENS}-${TOKEN_CONFIG.MAX_TOKENS_LIMIT}, default: ${TOKEN_CONFIG.DEFAULT_MAX_TOKENS})`),

  responseFormat: ResponseFormatSchema
    .default(ResponseFormat.MARKDOWN)
    .describe('Output format: "markdown" for human-readable or "json" for machine-readable')
}).strict();

export type SearchInput = z.infer<typeof SearchInputSchema>;

/**
 * Schema for jamf_docs_get_article
 */
export const GetArticleInputSchema = z.object({
  url: z.string()
    .url('Must be a valid URL')
    .refine(
      (url) => url.includes('docs.jamf.com') || url.includes('learn.jamf.com'),
      'URL must be from docs.jamf.com or learn.jamf.com'
    )
    .describe('Full URL of the Jamf documentation article'),

  section: z.string()
    .optional()
    .describe('Extract only a specific section by title or ID (e.g., "Prerequisites", "Configuration")'),

  includeRelated: z.boolean()
    .default(false)
    .describe('Include related article links in the response'),

  maxTokens: MaxTokensSchema
    .optional()
    .describe(`Maximum tokens in response (${TOKEN_CONFIG.MIN_TOKENS}-${TOKEN_CONFIG.MAX_TOKENS_LIMIT}, default: ${TOKEN_CONFIG.DEFAULT_MAX_TOKENS})`),

  responseFormat: ResponseFormatSchema
    .default(ResponseFormat.MARKDOWN)
    .describe('Output format: "markdown" for human-readable or "json" for machine-readable')
}).strict();

export type GetArticleInput = z.infer<typeof GetArticleInputSchema>;

/**
 * Schema for jamf_docs_get_toc
 */
export const GetTocInputSchema = z.object({
  product: z.enum(productIds)
    .describe('Product ID: jamf-pro, jamf-school, jamf-connect, jamf-protect'),

  version: z.string()
    .optional()
    .describe('Specific version (defaults to latest)'),

  page: PageSchema
    .optional()
    .describe(`Page number for pagination (1-${PAGINATION_CONFIG.MAX_PAGE}, default: 1)`),

  maxTokens: MaxTokensSchema
    .optional()
    .describe(`Maximum tokens in response (${TOKEN_CONFIG.MIN_TOKENS}-${TOKEN_CONFIG.MAX_TOKENS_LIMIT}, default: ${TOKEN_CONFIG.DEFAULT_MAX_TOKENS})`),

  responseFormat: ResponseFormatSchema
    .default(ResponseFormat.MARKDOWN)
    .describe('Output format: "markdown" for human-readable or "json" for machine-readable')
}).strict();

export type GetTocInput = z.infer<typeof GetTocInputSchema>;
