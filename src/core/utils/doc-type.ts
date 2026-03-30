/**
 * Document type utilities based on API result labels
 */

import { LABEL_TO_DOC_TYPE, type DocTypeId } from '../constants.js';
import type { ZoominLabel } from '../types.js';

/**
 * Derive document type from result labels.
 * Finds the first `content-*` label key that matches a known docType.
 * Falls back to 'documentation' if no match found.
 */
export function docTypeFromLabels(labels: ZoominLabel[] | undefined | null): DocTypeId {
  if (labels === undefined || labels === null || labels.length === 0) {
    return 'documentation';
  }

  for (const label of labels) {
    if (label.key.startsWith('content-')) {
      const docType = LABEL_TO_DOC_TYPE[label.key];
      if (docType !== undefined) {
        return docType;
      }
    }
  }

  return 'documentation';
}
