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
 *
 * The same whole-glossary fixture also carries the longer queries that the
 * ranker's own fuzzy pass rejects, and the `product` input the lookup ignores.
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

/**
 * A topic body in the shape `/content` serves: the definition alone, with no
 * heading and no term name (all 123 live topics, 2026-09-24). The lookup names
 * the entry from its TOC title. A `h1.glossterm` page, which this used to
 * serve, sends every entry down a parser branch no live term reaches.
 */
function glossaryHtml(term: string): string {
  return '<div class="content-locale-en-US content-locale-en"><div id="glossentry-1">' +
    `<div class="abstract glossdef"><p class="p">Definition of ${term}.</p></div>` +
    '</div></div>';
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
  mockedFetchTopicContent.mockImplementation(async (_http, _mapId: string, contentId: string) => {
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

  it('does not answer DEP with the "dep" inside "deployment"', async () => {
    // Live on 2026-09-24 this was the whole answer: `zero-touch deployment`,
    // an exact substring hit, so it survived every threshold #209 measured.
    // No glossary entry is named DEP, in its title or its definition.
    for (const term of ['DEP', 'dep']) {
      const result = await lookupGlossaryTerm(makeCtx(), { term });

      expect(result.entries, term).toEqual([]);
      expect(result.totalMatches, term).toBe(0);
    }
  });

  it('does not answer APNs with abbreviations one letter away', async () => {
    // `Apps` and `APFS` are each one substitution from `APNs` — the same
    // distance as the `LDPA` typo below, so no threshold separates them. What
    // does is the kind of edit: a changed letter spells another word.
    for (const term of ['APNs', 'APNS']) {
      const result = await lookupGlossaryTerm(makeCtx(), { term });

      expect(result.entries.map((e) => e.term), term).toEqual([]);
    }
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

  it('still resolves the plural of an abbreviation', async () => {
    // A plural `s`, like the swap above, keeps an abbreviation the same one.
    // `MDMs` is not a word of either title, so a whole-word rule without it
    // would drop both.
    const result = await lookupGlossaryTerm(makeCtx(), { term: 'MDMs' });

    expect(result.entries.map((e) => e.term).sort()).toEqual([
      'User Approved MDM',
      'mobile device management (MDM)',
    ]);
  });

  it('does not read any other extra letter as a typo of a shorter word', async () => {
    // Accepting every extra letter, live on 2026-09-24, answered `prof` and
    // `prop` with `policy (Jamf Pro)` alone, and `defi` and `exfi` with
    // `Extensible Firmware Interface (EFI)` alone. Each is the start of a
    // longer word (profile, property, definition, exfiltration), not `Pro` or
    // `EFI` mistyped, and no title has that start as a whole word.
    for (const term of ['prof', 'prop', 'defi', 'exfi']) {
      const result = await lookupGlossaryTerm(makeCtx(), { term });

      expect(result.entries.map((e) => e.term), term).toEqual([]);
    }
  });

  it('resolves a short word with a missed letter to that word alone', async () => {
    // Every four-letter query is read as an abbreviation, including the typos
    // of five-letter titles. Before the word rule these found their title
    // among fuzzy noise; they should still find it, without the noise.
    for (const [term, title] of [['scpe', 'scope'], ['clam', 'claim']]) {
      const result = await lookupGlossaryTerm(makeCtx(), { term });

      expect(result.entries.map((e) => e.term), term).toEqual([title]);
    }
  });

  it('gives a two-letter query no slip', async () => {
    // One letter is half of `OS`. It used to answer with every title holding
    // the substring — `Composer`, `macOS Security portal` — and a slip would
    // still make it `DoS`. No entry is named OS.
    const result = await lookupGlossaryTerm(makeCtx(), { term: 'OS' });

    expect(result.entries.map((e) => e.term)).toEqual([]);
  });

  it('does not fetch a page for every term that scores near a 3-letter query', async () => {
    // The cost the threshold controls. Candidate selection happens at the TOC,
    // before any page is read, and each surviving candidate is an upstream
    // fetch (capped at 10). At the old flat 0.4 a query like DEP admitted
    // roughly a fifth of the glossary and spent the whole cap; measured over
    // the live 125 terms, the two unanswerable queries returned 52 results
    // between them, and 1 at 0.3. Since titles must name a short query as a
    // word, `DEP` has no candidate left to fetch.
    await lookupGlossaryTerm(makeCtx(), { term: 'DEP' });

    expect(mockedFetchTopicContent).not.toHaveBeenCalled();
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

describe('glossary lookup when the ranker finds nothing', () => {
  it('does not report candidates the ranker rejected as matches', async () => {
    // Live on 2026-09-24, `group` answered "2 matches": `property list
    // (PLIST)` and `resource owner password credentials (ROPC)`, admitted at
    // the TOC on `prop` and `ROP`, then rejected by the ranker's own fuzzy
    // pass — which returned every candidate when it found none.
    for (const term of ['group', 'groups']) {
      const result = await lookupGlossaryTerm(makeCtx(), { term });

      expect(result.entries.map((e) => e.term), term).toEqual([]);
      expect(result.totalMatches, term).toBe(0);
    }
  });

  it('keeps a candidate the ranker rejects only if it shares a word', async () => {
    // Fuse at 0.3 rejects every candidate for these: a truncated word, or a
    // swap that it counts as two edits in six letters. Returning everything
    // used to answer them by accident, along with the noise beside them.
    for (const [term, title] of [['ext attr', 'extension attribute'], ['deamon', 'daemon']]) {
      const result = await lookupGlossaryTerm(makeCtx(), { term });

      expect(result.entries.map((e) => e.term), term).toEqual([title]);
    }
  });

  it('still answers a retired name through the words it shares', async () => {
    // The control that rules out returning nothing instead. The ranker finds
    // nothing for this query either — the extra word puts it past 0.3 — and
    // the two entries it shares whole words with are the right answer.
    const result = await lookupGlossaryTerm(makeCtx(), { term: 'Device Enrollment Program' });

    expect(result.entries.map((e) => e.term)).toEqual([
      'device enrollment',
      'Automated Device Enrollment',
    ]);
  });

  it.each([
    ['MDM', 'mobile device management (MDM)'],
    ['Automated Device Enrollment', 'Automated Device Enrollment'],
    ['Configuration Profile', 'configuration profile'],
  ])('still answers %s with its own entry first', async (term, expected) => {
    const result = await lookupGlossaryTerm(makeCtx(), { term });

    expect(result.entries[0]?.term).toBe(expected);
  });
});

describe('glossary lookup product input', () => {
  it.each(['MDM', 'Configuration Profile', 'enrollment'])(
    'returns the same entries for %s with or without a product',
    async (term) => {
      // Jamf's glossary has no product classification — the map and every
      // topic have empty jamf:portal, jamf:app and jamf:utility — so there is
      // nothing for `product` to select on, and the tool says so.
      const unfiltered = await lookupGlossaryTerm(makeCtx(), { term });
      const withProduct = await lookupGlossaryTerm(makeCtx(), { term, product: 'jamf-protect' });

      expect(unfiltered.entries.length).toBeGreaterThan(0);
      expect(withProduct).toEqual(unfiltered);
      expect(withProduct.entries.every((e) => e.product === undefined)).toBe(true);
    },
  );
});
