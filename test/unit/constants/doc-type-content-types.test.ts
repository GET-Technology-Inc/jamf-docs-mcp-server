/**
 * `DOC_TYPE_CONTENT_TYPE_MAP` gives each docType the en-US `jamf:contentType`
 * value Jamf gives the maps it labels with that docType's `content-*` label,
 * as the maps list of 2026-09-28 pairs them (test/fixtures/maps-content-types.ts).
 *
 * Until that day three docTypes were mapped to 'Technical Documentation',
 * the value of `content-techdocs`: `training`, whose 16 en-US maps all carry
 * "Training Content" and none of them 'Technical Documentation';
 * `solution-guide`, whose 5 carry "Solution Guide", 2 of them beside
 * 'Technical Documentation' because Jamf labels them techdocs too; and
 * `getting-started`, whose 2 carry "Getting Started Guide", 1 of them beside
 * 'Technical Documentation'. The map was therefore described as many-to-one.
 * Jamf's own pairing is one-to-one.
 */

import { describe, it, expect } from 'vitest';
import { DOC_TYPE_CONTENT_TYPE_MAP, DOC_TYPE_IDS, DOC_TYPE_LABEL_MAP } from '../../../src/core/constants.js';
import type { DocTypeId } from '../../../src/core/constants.js';
import { MAPS_CONTENT_TYPES } from '../../fixtures/maps-content-types.js';

const EN_US = MAPS_CONTENT_TYPES.filter(row => row.locale === 'en-US');

/**
 * The en-US values every map labelled `labelKey` carries and no map without
 * the label does: what Jamf calls that kind of document in `jamf:contentType`.
 */
function pairedValues(labelKey: string): string[] {
  const labelled = EN_US.filter(row => row.labelKeys.includes(labelKey));
  const others = EN_US.filter(row => !row.labelKeys.includes(labelKey));
  const carriedByAll = (labelled[0]?.contentTypes ?? [])
    .filter(value => labelled.every(row => row.contentTypes.includes(value)));
  return carriedByAll.filter(value => others.every(row => !row.contentTypes.includes(value)));
}

describe('DOC_TYPE_CONTENT_TYPE_MAP', () => {
  it.each(DOC_TYPE_IDS)('gives %s the value Jamf pairs with its content-* label', (docType) => {
    const labelKey = DOC_TYPE_LABEL_MAP[docType as DocTypeId];
    expect(EN_US.some(row => row.labelKeys.includes(labelKey)), `no en-US map is labelled ${labelKey}`).toBe(true);
    expect([DOC_TYPE_CONTENT_TYPE_MAP[docType]]).toEqual(pairedValues(labelKey));
  });

  it('is one-to-one, so a value names one docType', () => {
    const values = DOC_TYPE_IDS.map(docType => DOC_TYPE_CONTENT_TYPE_MAP[docType]);
    expect(new Set(values).size).toBe(DOC_TYPE_IDS.length);
  });
});
