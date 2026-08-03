/**
 * Guard tests for doc-type constants.
 *
 * Background: search results used to derive their docType by reverse-looking-up
 * `DOC_TYPE_CONTENT_TYPE_MAP`, a many-to-one map, in object-literal insertion
 * order. Release notes carry both 'Technical Documentation' and 'Release Notes',
 * `documentation` is declared first, so every release note was labelled
 * documentation and its own docType filter then dropped it.
 *
 * The derivation now reads FT's `content-*` labels, whose vocabulary is exactly
 * the DOC_TYPES labelKey set. These tests pin the two structures that direction
 * depends on so neither can silently lose an entry.
 */

import { describe, it, expect } from 'vitest';
import {
  DOC_TYPE_IDS,
  DOC_TYPE_LABEL_MAP,
  DOC_TYPE_PRECEDENCE,
  LABEL_KEY_DOC_TYPE_MAP,
} from '../../../src/core/constants.js';
import type { DocTypeId } from '../../../src/core/constants.js';

describe('LABEL_KEY_DOC_TYPE_MAP', () => {
  it('inverts DOC_TYPE_LABEL_MAP exactly', () => {
    for (const id of DOC_TYPE_IDS) {
      const labelKey = DOC_TYPE_LABEL_MAP[id as DocTypeId];
      expect(LABEL_KEY_DOC_TYPE_MAP[labelKey], `labelKey "${labelKey}" does not map back to "${id}"`)
        .toBe(id);
    }
  });

  it('is a bijection — no two docTypes share a labelKey', () => {
    expect(Object.keys(LABEL_KEY_DOC_TYPE_MAP)).toHaveLength(DOC_TYPE_IDS.length);
  });
});

describe('DOC_TYPE_PRECEDENCE', () => {
  it('lists every docType exactly once', () => {
    expect([...DOC_TYPE_PRECEDENCE].sort()).toEqual([...DOC_TYPE_IDS].sort());
  });

  // `content-techdocs` sits on ~93% of live topics, including every release
  // note, solution guide and getting-started page. It describes the least, so
  // anything else present must out-rank it.
  it('ranks documentation last', () => {
    expect(DOC_TYPE_PRECEDENCE.at(-1)).toBe('documentation');
  });
});
