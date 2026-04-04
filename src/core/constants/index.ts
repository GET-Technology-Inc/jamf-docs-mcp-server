/**
 * Constants barrel — re-exports everything for backward compatibility.
 *
 * Consumers can import from '../constants.js' (which resolves to this barrel)
 * or directly from the sub-modules (e.g. '../constants/products.js').
 */

export {
  SERVER_ICON,
  DOCS_BASE_URL,
  FT_API_BASE,
  buildDocUrl,
  buildUrlPattern,
  JAMF_PRODUCTS,
  PRODUCT_IDS,
} from './products.js';
export type { ProductId } from './products.js';

export {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  SUPPORTED_LOCALE_IDS,
  toValidLocale,
} from './locales.js';
export type { LocaleId } from './locales.js';

export {
  JAMF_TOPICS,
  TOPIC_IDS,
} from './topics.js';
export type { TopicId } from './topics.js';

export {
  DOC_TYPES,
  DOC_TYPE_LABEL_MAP,
  DOC_TYPE_CONTENT_TYPE_MAP,
  DOC_TYPE_IDS,
} from './doc-types.js';
export type { DocTypeId } from './doc-types.js';

export {
  ResponseFormat,
  OutputMode,
  CONTENT_LIMITS,
  TOKEN_CONFIG,
  PAGINATION_CONFIG,
  SELECTORS,
} from './limits.js';
