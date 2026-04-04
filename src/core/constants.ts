/**
 * Constants barrel — backward-compatible re-export.
 *
 * The actual constants are split into sub-modules under ./constants/:
 *   products.ts, topics.ts, doc-types.ts, limits.ts, locales.ts
 *
 * This file ensures existing imports from '../constants.js' keep working.
 */

export {
  // products
  SERVER_ICON,
  DOCS_BASE_URL,
  FT_API_BASE,
  buildDocUrl,
  buildUrlPattern,
  JAMF_PRODUCTS,
  PRODUCT_IDS,

  // locales
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  SUPPORTED_LOCALE_IDS,
  toValidLocale,

  // topics
  JAMF_TOPICS,
  TOPIC_IDS,

  // doc-types
  DOC_TYPES,
  DOC_TYPE_LABEL_MAP,
  DOC_TYPE_CONTENT_TYPE_MAP,
  DOC_TYPE_IDS,

  // limits
  ResponseFormat,
  OutputMode,
  CONTENT_LIMITS,
  TOKEN_CONFIG,
  PAGINATION_CONFIG,
  SELECTORS,
} from './constants/index.js';

export type {
  ProductId,
  LocaleId,
  TopicId,
  DocTypeId,
} from './constants/index.js';
