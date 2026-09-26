/**
 * What `lookupGlossaryTerm` reports when matching entries do not fit
 * `maxTokens`: which ones were left out, and what each costs.
 *
 * Entries are cut to the budget in rank order, stopping at the first that does
 * not fit, with no floor of one. So when the leading entry alone costs more
 * than `maxTokens`, the result is `entries: []` beside `totalMatches > 0`, and
 * until 2026-09-26 nothing in it said what budget would have held the entry.
 * The tool answered "No glossary entries found". Live on 2026-09-26, six of the
 * 123 terms came back that way when looked up by their own title at
 * `maxTokens: 100`, among them Apple School Manager (134 tokens) and Apple
 * Account (129).
 *
 * These drive the real lookup over the 123 live titles, with the two Fluid
 * Topics calls mocked and the four `Apple` entries served as their live
 * `/content`, so the costs below are the ones the live tool reports.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../src/core/services/ft-client.js', async (importOriginal) => ({
  ...await importOriginal<typeof FtClientModule>(),
  fetchMapToc: vi.fn(),
  fetchTopicContent: vi.fn(),
}));

import type * as FtClientModule from '../../../src/core/services/ft-client.js';
import { fetchMapToc, fetchTopicContent } from '../../../src/core/services/ft-client.js';
import { lookupGlossaryTerm } from '../../../src/core/services/glossary.js';
import { createMockContext } from '../../helpers/mock-context.js';
import {
  GLOSSARY_MAP_ID,
  LIVE_GLOSSARY_TOC,
  serveGlossaryContent,
} from '../../helpers/glossary-upstream.js';
import { APPLE_ENTRY_CONTENT } from '../../fixtures/glossary-apple-content.js';
import type { ServerContext } from '../../../src/core/types/context.js';

function makeCtx(): ServerContext {
  const ctx = createMockContext();
  ctx.mapsRegistry.resolveGlossaryMapId = vi.fn().mockResolvedValue(GLOSSARY_MAP_ID);
  return ctx;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchMapToc).mockResolvedValue(LIVE_GLOSSARY_TOC);
  vi.mocked(fetchTopicContent).mockImplementation(
    serveGlossaryContent(() => new Set(), APPLE_ENTRY_CONTENT),
  );
});

describe('a matching entry that does not fit maxTokens is reported, not dropped', () => {
  it('names the entry and what it costs when not even the leading one fits', async () => {
    const result = await lookupGlossaryTerm(makeCtx(), { term: 'Apple School Manager', maxTokens: 100 });

    expect(result.entries).toEqual([]);
    expect(result.totalMatches).toBe(1);
    expect(result.tokenInfo).toEqual({ tokenCount: 0, truncated: true, maxTokens: 100 });
    expect(result.truncatedContent).toEqual({
      omittedCount: 1,
      omittedItems: [{ title: 'Apple School Manager', estimatedTokens: 134 }],
    });
  });

  it('reports what the lookup charges: that budget returns the entry, one token less does not', async () => {
    // The figure is only worth giving if asking for it works. It is the
    // entry's share of `tokenCount`, the same estimate the cut is made with.
    const whole = await lookupGlossaryTerm(makeCtx(), { term: 'Apple School Manager', maxTokens: 5000 });
    const exact = await lookupGlossaryTerm(makeCtx(), { term: 'Apple School Manager', maxTokens: 134 });
    const short = await lookupGlossaryTerm(makeCtx(), { term: 'Apple School Manager', maxTokens: 133 });

    expect(whole.tokenInfo.tokenCount).toBe(134);
    expect(exact.entries.map(e => e.term)).toEqual(['Apple School Manager']);
    expect(exact.tokenInfo.truncated).toBe(false);
    expect(short.entries).toEqual([]);
    expect(short.truncatedContent?.omittedItems[0]?.estimatedTokens).toBe(134);
  });

  it('lists every omitted entry in rank order, so their costs add up to the whole answer', async () => {
    const nothing = await lookupGlossaryTerm(makeCtx(), { term: 'Apple', maxTokens: 100 });
    const all = await lookupGlossaryTerm(makeCtx(), { term: 'Apple', maxTokens: 5000 });

    expect(nothing.entries).toEqual([]);
    expect(nothing.totalMatches).toBe(4);
    expect(nothing.truncatedContent?.omittedCount).toBe(4);
    expect(nothing.truncatedContent?.omittedItems.map(e => e.title)).toEqual(all.entries.map(e => e.term));
    expect(nothing.truncatedContent?.omittedItems[0]).toEqual({ title: 'Apple Account', estimatedTokens: 129 });
    const sum = nothing.truncatedContent?.omittedItems.reduce((n, e) => n + e.estimatedTokens, 0);
    expect(sum).toBe(455);
    expect(all.tokenInfo.tokenCount).toBe(455);
  });

  it('reports the rest when some entries fit and the next does not', async () => {
    const result = await lookupGlossaryTerm(makeCtx(), { term: 'Apple', maxTokens: 129 });

    expect(result.entries.map(e => e.term)).toEqual(['Apple Account']);
    expect(result.tokenInfo).toEqual({ tokenCount: 129, truncated: true, maxTokens: 129 });
    expect(result.truncatedContent?.omittedCount).toBe(3);
    expect(result.truncatedContent?.omittedItems.map(e => e.title)).toEqual([
      'Apple Business', 'Apple School Manager', 'Apple File System (APFS)',
    ]);
  });

  it('adds nothing when every match fits, or nothing matches', async () => {
    const fits = await lookupGlossaryTerm(makeCtx(), { term: 'Apple', maxTokens: 455 });
    const none = await lookupGlossaryTerm(makeCtx(), { term: 'Apple Classroom Pro', maxTokens: 100 });

    expect(fits.entries).toHaveLength(4);
    expect(fits.tokenInfo.truncated).toBe(false);
    expect(fits).not.toHaveProperty('truncatedContent');
    expect(none.totalMatches).toBe(0);
    expect(none).not.toHaveProperty('truncatedContent');
  });
});
