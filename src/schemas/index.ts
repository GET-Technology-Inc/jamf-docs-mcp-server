/**
 * Zod schemas for input validation
 */

import { z } from 'zod';
import { completable } from '@modelcontextprotocol/sdk/server/completable.js';
import {
  ResponseFormat,
  OutputMode,
  CONTENT_LIMITS,
  TOKEN_CONFIG,
  PAGINATION_CONFIG,
  PRODUCT_IDS,
  TOPIC_IDS,
  DOC_TYPE_IDS,
  SUPPORTED_LOCALE_IDS,
  DEFAULT_LOCALE
} from '../constants.js';
import { completeProduct, completeTopic, completeVersion, completeLanguage } from '../completions.js';
import { isAllowedHostname } from '../utils/url.js';

// Response format enum
const ResponseFormatSchema = z.nativeEnum(ResponseFormat);

// Output mode enum
const OutputModeSchema = z.nativeEnum(OutputMode);

// Common maxTokens parameter schema
const MaxTokensSchema = z.number()
  .int()
  .min(TOKEN_CONFIG.MIN_TOKENS)
  .max(TOKEN_CONFIG.MAX_TOKENS_LIMIT)
  .default(TOKEN_CONFIG.DEFAULT_MAX_TOKENS)
  .describe(`Maximum tokens in response (${TOKEN_CONFIG.MIN_TOKENS}-${TOKEN_CONFIG.MAX_TOKENS_LIMIT}, default: ${TOKEN_CONFIG.DEFAULT_MAX_TOKENS})`);

// Common language/locale parameter (completable() mutates in place, so each call needs a fresh schema)
const LANGUAGE_DESCRIPTION = `Documentation language/locale (default: ${DEFAULT_LOCALE}). Options: ${SUPPORTED_LOCALE_IDS.join(', ')}`;

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

  outputMode: OutputModeSchema
    .default(OutputMode.FULL)
    .describe('Output detail level: "full" for detailed output or "compact" for brief output'),

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

  product: completable(
    z.enum(PRODUCT_IDS)
      .optional()
      .describe('Filter by product: jamf-pro, jamf-school, jamf-connect, jamf-protect'),
    completeProduct
  ),

  topic: completable(
    z.enum(TOPIC_IDS)
      .optional()
      .describe('Filter by topic: enrollment, profiles, security, inventory, policies, smart-groups, apps, identity, api, network'),
    completeTopic
  ),

  version: completable(
    z.string()
      .optional()
      .describe('Filter by version (e.g., "11.5.0", "10.x")'),
    completeVersion
  ),

  language: completable(
    z.enum(SUPPORTED_LOCALE_IDS).optional().describe(LANGUAGE_DESCRIPTION),
    completeLanguage
  ),

  docType: z.enum(DOC_TYPE_IDS)
    .optional()
    .describe('Filter by document type: documentation, release-notes, training, solution-guide, glossary, getting-started, archive'),

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

  outputMode: OutputModeSchema
    .default(OutputMode.FULL)
    .describe('Output detail level: "full" for detailed output or "compact" for brief output'),

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
      (url) => isAllowedHostname(url),
      'URL must be from docs.jamf.com or learn.jamf.com'
    )
    .describe('Full URL of the Jamf documentation article'),

  language: completable(
    z.enum(SUPPORTED_LOCALE_IDS).optional().describe(LANGUAGE_DESCRIPTION),
    completeLanguage
  ),

  section: z.string()
    .optional()
    .describe('Extract only a specific section by title or ID (e.g., "Prerequisites", "Configuration")'),

  summaryOnly: z.boolean()
    .default(false)
    .describe('Return only article summary and outline instead of full content (token-efficient)'),

  includeRelated: z.boolean()
    .default(false)
    .describe('Include related article links in the response'),

  maxTokens: MaxTokensSchema
    .optional()
    .describe(`Maximum tokens in response (${TOKEN_CONFIG.MIN_TOKENS}-${TOKEN_CONFIG.MAX_TOKENS_LIMIT}, default: ${TOKEN_CONFIG.DEFAULT_MAX_TOKENS})`),

  outputMode: OutputModeSchema
    .default(OutputMode.FULL)
    .describe('Output detail level: "full" for detailed output or "compact" for brief output'),

  responseFormat: ResponseFormatSchema
    .default(ResponseFormat.MARKDOWN)
    .describe('Output format: "markdown" for human-readable or "json" for machine-readable')
}).strict();

export type GetArticleInput = z.infer<typeof GetArticleInputSchema>;

/**
 * Schema for jamf_docs_get_toc
 */
export const GetTocInputSchema = z.object({
  product: completable(
    z.enum(PRODUCT_IDS)
      .describe('Product ID: jamf-pro, jamf-school, jamf-connect, jamf-protect'),
    completeProduct
  ),

  language: completable(
    z.enum(SUPPORTED_LOCALE_IDS).optional().describe(LANGUAGE_DESCRIPTION),
    completeLanguage
  ),

  version: completable(
    z.string()
      .optional()
      .describe('Specific version (defaults to latest)'),
    completeVersion
  ),

  page: PageSchema
    .optional()
    .describe(`Page number for pagination (1-${PAGINATION_CONFIG.MAX_PAGE}, default: 1)`),

  maxTokens: MaxTokensSchema
    .optional()
    .describe(`Maximum tokens in response (${TOKEN_CONFIG.MIN_TOKENS}-${TOKEN_CONFIG.MAX_TOKENS_LIMIT}, default: ${TOKEN_CONFIG.DEFAULT_MAX_TOKENS})`),

  outputMode: OutputModeSchema
    .default(OutputMode.FULL)
    .describe('Output detail level: "full" for detailed output or "compact" for brief output'),

  responseFormat: ResponseFormatSchema
    .default(ResponseFormat.MARKDOWN)
    .describe('Output format: "markdown" for human-readable or "json" for machine-readable')
}).strict();

export type GetTocInput = z.infer<typeof GetTocInputSchema>;
