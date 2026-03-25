/**
 * Document type inference utility
 */

import { DOC_TYPES, type DocTypeId } from '../constants.js';

/**
 * Infer document type from bundle ID using pattern matching
 */
export function inferDocType(bundleId: string): DocTypeId {
  for (const [id, docType] of Object.entries(DOC_TYPES)) {
    if ('bundlePattern' in docType && docType.bundlePattern.test(bundleId)) {
      return id as DocTypeId;
    }
  }
  return 'documentation';
}
