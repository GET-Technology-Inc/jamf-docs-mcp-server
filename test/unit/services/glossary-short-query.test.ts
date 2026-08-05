/**
 * Matching a short abbreviation against glossary TOC titles.
 *
 * Fuse's `threshold` is a fraction of the *pattern* length, so one value
 * cannot serve both a three-letter abbreviation and a multi-word term. At the
 * previous flat 0.4, `DEP` answered with `patch definition` — which shares no
 * substring with the query at all — and `zero-touch deployment`.
 *
 * Ranking by fuzzy distance alone was also wrong in the other direction: a
 * title that contains the term *as a word* is the better answer, but scored
 * behind shorter titles that merely came close.
 *
 * The numbers behind the chosen threshold, measured against the live glossary
 * (125 terms, ground truth taken from the 18 entries that publish their own
 * abbreviation in parentheses), are recorded on `SHORT_QUERY_THRESHOLD`.
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
import type { FtTocNode } from '../../../src/core/types.js';
import type { ServerContext } from '../../../src/core/types/context.js';
import { GLOSSARY_TITLES } from '../../fixtures/glossary-titles.js';

const mockedFetchMapToc = vi.mocked(fetchMapToc);
const mockedFetchTopicContent = vi.mocked(fetchTopicContent);

/**
 * The whole live glossary, not a sample.
 *
 * Short-query matching is a question about how a pattern scores against a
 * *distribution* of titles. A ten-title fixture answered `DEP` correctly under
 * the old flat threshold and so could not show the defect at all — the wrong
 * neighbours simply were not in it.
 */
const TITLES = GLOSSARY_TITLES;

/** contentId -> the exact TOC title, so the page echoes the title verbatim. */
const TITLE_BY_ID = new Map<string, string>();

function idFor(title: string): string {
  return title.replace(/[^A-Za-z0-9]+/g, '_');
}

function node(title: string): FtTocNode {
  const id = idFor(title);
  TITLE_BY_ID.set(id, title);
  return {
    tocId: `toc-${id}`,
    contentId: id,
    title,
    prettyUrl: `/en-US/bundle/jamf-technical-glossary/page/${id}.html`,
    children: [],
  };
}

function glossaryHtml(term: string): string {
  return `
    <html><body><main role="main">
      <article class="dita" role="article">
        <h1 class="title glossterm topictitle1"><span class="ph">${term}</span></h1>
        <div class="abstract glossdef"><p class="p">Definition of ${term}.</p></div>
      </article>
    </main></body></html>
  `;
}

function makeCtx(): ServerContext {
  const ctx = createMockContext();
  ctx.mapsRegistry.resolveGlossaryMapId = vi.fn().mockResolvedValue('glossary-map');
  return ctx;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedFetchMapToc.mockResolvedValue([
    {
      tocId: 'toc-root',
      contentId: 'root',
      title: 'Jamf Platform Technical Glossary',
      prettyUrl: '/en-US/bundle/jamf-technical-glossary/page/root.html',
      children: TITLES.map(node),
    },
  ] as FtTocNode[]);
  // Echo the title exactly as the TOC published it. Deriving it from the id
  // instead drops the parentheses that carry the abbreviation, which is the
  // one part of the title these assertions are about.
  mockedFetchTopicContent.mockImplementation(async (_mapId: string, contentId: string) => {
    await Promise.resolve();
    return glossaryHtml(TITLE_BY_ID.get(contentId) ?? contentId);
  });
});

describe('short-abbreviation glossary lookup', () => {
  it('does not answer DEP with terms that merely score close', async () => {
    // The tool description offers "What does DEP stand for?" as an example.
    // Jamf renamed the term away, so no entry is correct — but `patch
    // definition` shares no substring with `DEP` and was returned anyway.
    const result = await lookupGlossaryTerm(makeCtx(), { term: 'DEP' });

    const terms = result.entries.map((e) => e.term.toLowerCase());
    expect(terms).not.toContain('patch definition');
    expect(terms).not.toContain('patch management');
  });

  it('prefers the term that contains the abbreviation as a word', async () => {
    // Both titles contain MDM. Fuzzy distance put the shorter one first, which
    // ranks by string similarity rather than by which entry defines the term.
    const result = await lookupGlossaryTerm(makeCtx(), { term: 'MDM' });

    // Ordering, not membership: both titles matched before and after, and
    // what the word-boundary preference changes is which one leads.
    expect(result.entries[0]?.term).toBe('mobile device management (MDM)');
  });

  it('finds an abbreviation published in parentheses', async () => {
    const result = await lookupGlossaryTerm(makeCtx(), { term: 'EFI' });

    expect(result.entries[0]?.term).toBe('Extensible Firmware Interface (EFI)');
  });

  it('still resolves a transposed abbreviation through the fuzzy fallback', async () => {
    // The reason the short threshold is 0.3 and not lower: every value at or
    // below 0.2 scored identically on precision and lost this.
    const result = await lookupGlossaryTerm(makeCtx(), { term: 'LDPA' });

    expect(result.entries.map((e) => e.term)).toContain(
      'Lightweight Directory Access Protocol (LDAP)',
    );
  });

  it('does not fetch a page for every term that scores near a 3-letter query', async () => {
    // The cost the threshold controls. Candidate selection happens at the TOC,
    // before any page is read, and each surviving candidate is an upstream
    // fetch (capped at 10). At the old flat 0.4 a query like DEP admitted
    // roughly a fifth of the glossary and spent the whole cap; measured over
    // the live 125 terms, the two unanswerable queries returned 52 results
    // between them and now return 1.
    await lookupGlossaryTerm(makeCtx(), { term: 'DEP' });

    expect(mockedFetchTopicContent.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('still reads the pages a long query legitimately matches', async () => {
    // The control for the case above: a threshold tight enough to fetch
    // nothing would pass it and break every real lookup.
    mockedFetchTopicContent.mockClear();
    await lookupGlossaryTerm(makeCtx(), { term: 'enrollment' });

    expect(mockedFetchTopicContent.mock.calls.length).toBeGreaterThan(0);
  });

  it('leaves multi-word terms on the original threshold', async () => {
    // The control. A change that tightened long queries too would satisfy the
    // cases above by matching almost nothing.
    const result = await lookupGlossaryTerm(makeCtx(), { term: 'configuration profile' });

    expect(result.entries.map((e) => e.term)).toContain('configuration profile');
  });
});
