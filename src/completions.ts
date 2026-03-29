/**
 * Completion utilities for argument autocompletion
 */

import { JAMF_PRODUCTS, PRODUCT_IDS, TOPIC_IDS, SUPPORTED_LOCALE_IDS, type ProductId } from './constants.js';
import { getAvailableVersions } from './services/metadata.js';

/**
 * Two-tier matching: prefix matches first, then substring matches.
 */
export function filterMatches(values: string[], input: string): string[] {
  if (input === '') {
    return values;
  }
  const prefix = values.filter(v => v.startsWith(input));
  const substring = values.filter(v => !v.startsWith(input) && v.includes(input));
  return [...prefix, ...substring];
}

export function completeProduct(
  value: string | undefined
): string[] {
  return filterMatches(PRODUCT_IDS, value ?? '');
}

export function completeTopic(
  value: string | undefined
): string[] {
  return filterMatches(TOPIC_IDS, value ?? '');
}

export function completeLanguage(
  value: string | undefined
): string[] {
  return filterMatches(SUPPORTED_LOCALE_IDS, value ?? '');
}

export async function completeVersion(
  value: string | undefined,
  context?: { arguments?: Record<string, string> }
): Promise<string[]> {
  const product = context?.arguments?.product;
  if (product === undefined || !(product in JAMF_PRODUCTS)) {
    return [];
  }
  const versions = await getAvailableVersions(product as ProductId);
  return filterMatches(versions, value ?? '');
}
