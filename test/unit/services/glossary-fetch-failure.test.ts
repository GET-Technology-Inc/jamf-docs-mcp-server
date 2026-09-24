/**
 * A glossary that could not be read is not a glossary without the term.
 *
 * Until 2026-09-24 every failure on the way to a definition returned the empty
 * result a real no-match returns, and the tool turned both into "No glossary
 * entries found" with no `isError`. Reproduced over stdio against the built
 * server, with learn.jamf.com behind a local proxy that answered 503 (or was
 * unreachable):
 *
 *   503 on /api/khub/maps                    MDM → No glossary entries found
 *   503 on the glossary /toc                 MDM → No glossary entries found
 *   503 on every /content                    MDM, Automated Device Enrollment → No glossary entries found
 *   503 on User Approved MDM's /content      MDM → "Found 1 match", nothing missing
 *   503 on Automated Device Enrollment's     Automated Device Enrollment → device enrollment, "1 match"
 *
 * These drive the real `lookupGlossaryTerm` over the 123 live titles, with the
 * two Fluid Topics calls it makes mocked and failing the way `http-client`
 * fails: an `HttpError`, fetch's `TypeError`, or a timeout.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../src/core/services/ft-client.js', async (importOriginal) => ({
  ...await importOriginal<typeof FtClientModule>(),
  fetchMapToc: vi.fn(),
  fetchTopicContent: vi.fn(),
}));

import type * as FtClientModule from '../../../src/core/services/ft-client.js';
import { fetchMapToc, fetchTopicContent } from '../../../src/core/services/ft-client.js';
import {
  lookupGlossaryTerm,
  GlossaryUnavailableError,
} from '../../../src/core/services/glossary.js';
import { MapsRegistry } from '../../../src/core/services/maps-registry.js';
import { createMockContext, createMockCache } from '../../helpers/mock-context.js';
import {
  GLOSSARY_MAP_ID as MAP_ID,
  LIVE_GLOSSARY_TOC,
  glossaryToc,
  glossaryEntryUrl,
  http503,
  serveGlossaryContent,
} from '../../helpers/glossary-upstream.js';
import type { FtMapInfo } from '../../../src/core/types.js';
import type { ServerContext } from '../../../src/core/types/context.js';

const mockedFetchMapToc = vi.mocked(fetchMapToc);
const mockedFetchTopicContent = vi.mocked(fetchTopicContent);

/** Titles whose `/content` answers 503, as the repro proxy served them. */
let failingTitles = new Set<string>();

function makeCtx(): ServerContext {
  const ctx = createMockContext();
  ctx.mapsRegistry.resolveGlossaryMapId = vi.fn().mockResolvedValue(MAP_ID);
  return ctx;
}

beforeEach(() => {
  vi.clearAllMocks();
  failingTitles = new Set();
  mockedFetchMapToc.mockResolvedValue(LIVE_GLOSSARY_TOC);
  mockedFetchTopicContent.mockImplementation(serveGlossaryContent(() => failingTitles));
});

/** The rejection of `promise`, which must be a GlossaryUnavailableError. */
async function unavailable(promise: Promise<unknown>): Promise<GlossaryUnavailableError> {
  const error = await promise.then(
    (result) => { throw new Error(`expected a rejection, got ${JSON.stringify(result)}`); },
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(GlossaryUnavailableError);
  return error as GlossaryUnavailableError;
}

describe('the glossary could not be read at all', () => {
  it('reports a map list that failed to fetch, instead of "no entries"', async () => {
    const ctx = makeCtx();
    ctx.mapsRegistry.resolveGlossaryMapId = vi.fn().mockRejectedValue(
      http503('https://learn.jamf.com/api/khub/maps'),
    );

    const error = await unavailable(lookupGlossaryTerm(ctx, { term: 'MDM' }));

    expect(error.message).toContain('Glossary lookup for "MDM" failed');
    expect(error.message).toContain('list of documentation maps');
    expect(error.message).toContain('(HTTP 503 Service Unavailable)');
    expect(error.message).toContain('This is not a "no match"');
    expect(error.message).toContain('This may be temporary: try again in a moment.');
    // The URL is in the server log, not in the caller's message.
    expect(error.message).not.toContain('https://');
    expect(mockedFetchMapToc).not.toHaveBeenCalled();
  });

  it('reports a map list with no glossary in it, without promising a retry will help', async () => {
    const ctx = makeCtx();
    ctx.mapsRegistry.resolveGlossaryMapId = vi.fn().mockResolvedValue(null);

    const error = await unavailable(lookupGlossaryTerm(ctx, { term: 'MDM' }));

    expect(error.message).toContain('has no glossary in it');
    expect(error.message).toContain('This is not a "no match"');
    expect(error.message).not.toContain('temporary');
  });

  it('reports a TOC that failed to fetch', async () => {
    mockedFetchMapToc.mockRejectedValue(
      http503(`https://learn.jamf.com/api/khub/maps/${MAP_ID}/toc`),
    );

    const error = await unavailable(lookupGlossaryTerm(makeCtx(), { term: 'MDM' }));

    expect(error.message).toContain("the glossary's table of contents could not be fetched");
    expect(error.message).toContain('(HTTP 503 Service Unavailable)');
    expect(error.message).toContain('the glossary was not read');
    expect(mockedFetchTopicContent).not.toHaveBeenCalled();
  });

  it('names a network error and a timeout rather than "fetch failed"', async () => {
    mockedFetchMapToc.mockRejectedValueOnce(
      new TypeError('fetch failed', { cause: Object.assign(new Error('connect'), { code: 'ECONNREFUSED' }) }),
    );
    const refused = await unavailable(lookupGlossaryTerm(makeCtx(), { term: 'MDM' }));
    expect(refused.message).toContain('(a network error: ECONNREFUSED)');

    mockedFetchMapToc.mockRejectedValueOnce(
      new DOMException('The operation was aborted due to timeout', 'TimeoutError'),
    );
    const timedOut = await unavailable(lookupGlossaryTerm(makeCtx(), { term: 'MDM' }));
    expect(timedOut.message).toContain('(the request timed out)');
  });

  it('reports a TOC that lists no terms, and does not cache it as an empty glossary', async () => {
    // A 200 that is not the glossary's TOC. Cached, it answered every lookup
    // with "No glossary entries found" for the article TTL after
    // learn.jamf.com recovered (reproduced over stdio, 2026-09-24).
    const ctx = makeCtx();
    mockedFetchMapToc.mockResolvedValueOnce(glossaryToc([]));

    const error = await unavailable(lookupGlossaryTerm(ctx, { term: 'MDM' }));
    expect(error.message).toContain('came back from learn.jamf.com with no terms in it');

    const recovered = await lookupGlossaryTerm(ctx, { term: 'MDM' });
    expect(recovered.entries[0]?.term).toBe('mobile device management (MDM)');
    expect(mockedFetchMapToc).toHaveBeenCalledTimes(2);
  });

  it('does not cache a failed TOC fetch: the next lookup fetches it again', async () => {
    const ctx = makeCtx();
    mockedFetchMapToc.mockRejectedValueOnce(
      http503(`https://learn.jamf.com/api/khub/maps/${MAP_ID}/toc`),
    );

    await unavailable(lookupGlossaryTerm(ctx, { term: 'MDM' }));
    const recovered = await lookupGlossaryTerm(ctx, { term: 'MDM' });

    expect(recovered.entries.map(e => e.term)).toEqual([
      'mobile device management (MDM)',
      'User Approved MDM',
    ]);
    expect(recovered.incomplete).toBeUndefined();
  });

  it('reports a failed map list through the real registry, and does not cache the failure', async () => {
    // The registry's own path, not a stub: `ensureBuilt` rethrows, and a
    // failed build leaves it unbuilt for the next call.
    const glossaryMap: FtMapInfo = {
      id: MAP_ID,
      title: 'Jamf Platform Technical Glossary',
      mapApiEndpoint: `/api/khub/maps/${MAP_ID}`,
      metadata: [
        { key: 'version_bundle_stem', label: 'version_bundle_stem', values: ['jamf-technical-glossary'] },
        { key: 'ft:locale', label: 'ft:locale', values: ['en-US'] },
      ],
    };
    const fetchMaps = vi.fn()
      .mockRejectedValueOnce(http503('https://learn.jamf.com/api/khub/maps'))
      .mockResolvedValueOnce([glossaryMap]);
    const cache = createMockCache();
    const ctx = createMockContext({ cache, mapsRegistry: new MapsRegistry(cache, fetchMaps) });

    const error = await unavailable(lookupGlossaryTerm(ctx, { term: 'MDM' }));
    expect(error.message).toContain('list of documentation maps');

    const recovered = await lookupGlossaryTerm(ctx, { term: 'MDM' });
    expect(recovered.entries[0]?.term).toBe('mobile device management (MDM)');
    expect(fetchMaps).toHaveBeenCalledTimes(2);
  });
});

describe('definitions that could not be fetched', () => {
  it('reports every candidate failing, naming them, instead of "no entries"', async () => {
    failingTitles = new Set(['mobile device management (MDM)', 'User Approved MDM']);

    const error = await unavailable(lookupGlossaryTerm(makeCtx(), { term: 'MDM' }));

    expect(error.message).toContain(
      'the glossary has 2 entries whose titles are close to it, and none of their definitions ' +
      'could be fetched from learn.jamf.com (HTTP 503 Service Unavailable): ',
    );
    expect(error.message).toContain('mobile device management (MDM)');
    expect(error.message).toContain('User Approved MDM');
    expect(error.message).toContain('This may be temporary');
  });

  it('reports a lone candidate failing in the singular', async () => {
    failingTitles = new Set(['FileVault']);

    const error = await unavailable(lookupGlossaryTerm(makeCtx(), { term: 'FileVault' }));

    expect(error.message).toContain('1 entry whose title is close to it, and its definition could be fetched');
  });

  it('answers from what was fetched, and names the entry it may be missing', async () => {
    failingTitles = new Set(['User Approved MDM']);

    const result = await lookupGlossaryTerm(makeCtx(), { term: 'MDM' });

    expect(result.entries.map(e => e.term)).toEqual(['mobile device management (MDM)']);
    expect(result.totalMatches).toBe(1);
    expect(result.incomplete?.unfetched).toEqual([{
      term: 'User Approved MDM',
      url: glossaryEntryUrl('User Approved MDM'),
    }]);
    expect(result.incomplete?.message).toBe(
      'Could not fetch 1 of the 2 glossary entries whose titles are close to "MDM" from ' +
      'learn.jamf.com (HTTP 503 Service Unavailable): User Approved MDM. These results may be ' +
      'missing its definition. This may be temporary: repeat the lookup, or fetch it with ' +
      'jamf_docs_get_article.',
    );
  });

  it('does not answer with a neighbour when the entry itself failed', async () => {
    // Live on 2026-09-24: `device enrollment`, "1 match", with the exact entry
    // silently missing. The ranker does accept `device enrollment` for this
    // term, so a note alone would still have put it forward as the answer.
    failingTitles = new Set(['Automated Device Enrollment']);

    const error = await unavailable(
      lookupGlossaryTerm(makeCtx(), { term: 'Automated Device Enrollment' }),
    );

    expect(error.message).toContain(
      'the entry whose title names it, Automated Device Enrollment, could not be fetched from ' +
      'learn.jamf.com (HTTP 503 Service Unavailable).',
    );
    expect(error.message).toContain('would put another entry in its place');
  });

  it('does not lead with a lesser entry when the defining one failed', async () => {
    // Both titles name MDM; the one that publishes the abbreviation leads.
    failingTitles = new Set(['mobile device management (MDM)']);

    const error = await unavailable(lookupGlossaryTerm(makeCtx(), { term: 'MDM' }));

    expect(error.message).toContain(
      'the entry whose title names it, mobile device management (MDM), could not be fetched',
    );
  });

  it('reports a partial read where what was fetched does not answer the term', async () => {
    // `ext attr` reaches `extension attribute` only through the ranker's
    // word-start fallback (#321); the other candidates, `cyber attack` and
    // `brute force attack`, are turned down. With the answer's own page
    // failing, "No glossary entries found" would have been a claim about
    // pages that were never read.
    failingTitles = new Set(['extension attribute']);

    const error = await unavailable(lookupGlossaryTerm(makeCtx(), { term: 'ext attr' }));

    expect(error.message).toMatch(
      /\d+ of the \d+ glossary entries whose titles are close to it could not be fetched from learn\.jamf\.com \(HTTP 503 Service Unavailable\): extension attribute\. The other/,
    );
    expect(error.message).toContain('do not match it');
    expect(error.message).toContain('checked against only part of the glossary');
  });

  it('does not cache a failed definition: the next lookup is whole', async () => {
    const ctx = makeCtx();
    failingTitles = new Set(['User Approved MDM']);
    const partial = await lookupGlossaryTerm(ctx, { term: 'MDM' });
    expect(partial.incomplete).toBeDefined();

    failingTitles = new Set();
    const whole = await lookupGlossaryTerm(ctx, { term: 'MDM' });

    expect(whole.entries.map(e => e.term)).toEqual([
      'mobile device management (MDM)',
      'User Approved MDM',
    ]);
    expect(whole.incomplete).toBeUndefined();
  });
});

describe('a glossary that was read keeps its answers', () => {
  it('still answers a term with no entry with an empty result, not an error', async () => {
    // `Smart Group` has no candidate; `group` has candidates the ranker turns
    // down (#321). Both read the glossary and found nothing.
    for (const term of ['Smart Group', 'group']) {
      const result = await lookupGlossaryTerm(makeCtx(), { term });

      expect(result.entries, term).toEqual([]);
      expect(result.totalMatches, term).toBe(0);
      expect(result.incomplete, term).toBeUndefined();
    }
  });

  it('carries no incomplete note when every definition was fetched', async () => {
    const result = await lookupGlossaryTerm(makeCtx(), { term: 'Automated Device Enrollment' });

    expect(result.entries[0]?.term).toBe('Automated Device Enrollment');
    expect('incomplete' in result).toBe(false);
  });
});
