/**
 * Guard tests for topic constants.
 *
 * Background: the previous TOOL_DESCRIPTION + Zod `topic.describe()` strings
 * hardcoded a topic-id hint list that drifted from the actual enum, including
 * IDs (`smart-groups`, `identity`) that no longer existed in `JAMF_TOPICS`.
 * LLMs read those hints, sent the bad IDs, and got validation errors.
 *
 * These tests pin the curated `COMMON_TOPIC_IDS` list against the authoritative
 * `JAMF_TOPICS` / `TOPIC_IDS` so the same drift cannot happen again.
 */

import { describe, it, expect } from 'vitest';
import { JAMF_TOPICS, TOPIC_IDS, COMMON_TOPIC_IDS } from '../../../src/core/constants.js';

describe('COMMON_TOPIC_IDS', () => {
  it('every entry must exist as a key in JAMF_TOPICS', () => {
    for (const id of COMMON_TOPIC_IDS) {
      expect(JAMF_TOPICS, `topic "${id}" missing from JAMF_TOPICS`).toHaveProperty(id);
    }
  });

  it('every entry must appear in TOPIC_IDS', () => {
    for (const id of COMMON_TOPIC_IDS) {
      expect(TOPIC_IDS, `topic "${id}" missing from TOPIC_IDS`).toContain(id);
    }
  });

  it('contains no duplicates', () => {
    const set = new Set(COMMON_TOPIC_IDS);
    expect(set.size).toBe(COMMON_TOPIC_IDS.length);
  });

  it('is a strict subset of TOPIC_IDS (not all topics)', () => {
    // Sanity check: keep the curated list smaller than the full enum so the
    // hint stays readable in LLM context.
    expect(COMMON_TOPIC_IDS.length).toBeLessThan(TOPIC_IDS.length);
    expect(COMMON_TOPIC_IDS.length).toBeGreaterThan(0);
  });
});

describe('JAMF_TOPICS keyword coverage', () => {
  it('every topic has at least one keyword', () => {
    for (const [id, topic] of Object.entries(JAMF_TOPICS)) {
      expect(topic.keywords.length, `topic "${id}" has no keywords`).toBeGreaterThan(0);
    }
  });

  it('all keywords are lowercase', () => {
    // search-service.ts pre-lowercases keywords before matching; storing them
    // already lowercase prevents accidental case-mismatch bugs.
    for (const [id, topic] of Object.entries(JAMF_TOPICS)) {
      for (const kw of topic.keywords) {
        expect(kw, `topic "${id}" keyword "${kw}" is not lowercase`).toBe(kw.toLowerCase());
      }
    }
  });
});
