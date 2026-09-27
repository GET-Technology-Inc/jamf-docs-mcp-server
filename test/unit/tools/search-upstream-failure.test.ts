/**
 * What a client reads from `jamf_docs_search` when the search cannot be
 * completed: the registered tool over MCP, with the real search service,
 * MapsRegistry and other-source search, and only the backends stubbed.
 *
 * Until 2026-09-28 a search whose backend failed answered as if it had run
 * and found nothing: `No results found for "…"`, search suggestions, and no
 * `isError`. `searchDocumentation` caught the failure and set `searchError`,
 * and the tool never read it. Reproduced on 6.0.12 over stdio with
 * learn.jamf.com unreachable (`fetch failed`), in markdown and in JSON, with
 * and without a product filter, and offline with the clustered search
 * answering HTTP 503. A client reading that reply concludes the documentation
 * has nothing on the subject, and the suggestions tell it to change a query
 * that was never checked. This is the defect #324 fixed for the glossary: a
 * query can only be said to match nothing in an index that was searched.
 */

import { describe, it, expect, vi } from 'vitest';
import { searchDocumentation } from '../../../src/core/services/search-service.js';
import type { SearchResult } from '../../../src/core/types.js';
import {
  CONCEPTS_MATCH,
  MAPS_LIST,
  PRESTAGE,
  callSearch,
  connectionRefused,
  httpStatus,
  malformed,
  notJson,
  rejectsWith,
  searchRequests,
  searchUpstream,
  timedOut,
  type SearchReply,
} from '../../helpers/search-upstream.js';

const NOT_A_NO_RESULTS =
  'This is not a "no results": the search did not complete, so it cannot say whether the ' +
  'documentation has anything for this query.';

const MAY_BE_TEMPORARY = 'This may be temporary: try again in a moment.';

/** The advice for a failure that was not a request to learn.jamf.com or a provider. */
const UNEXPECTED_FAILURE_ADVICE =
  'Trying again may help. If it keeps failing, the server log says what went wrong.';

/** What a SearchProvider can return: a result as the interface types it. */
const PROVIDED: SearchResult = {
  title: 'Computer PreStage Enrollments',
  url: 'https://learn.jamf.com/r/en-US/jamf-pro-documentation-current/Computer_PreStage_Enrollments',
  snippet: 'Configure and deploy the Setup Assistant settings for computers.',
  product: 'Jamf Pro',
};

/** The checks every "the search could not be completed" reply must pass. */
function expectFailed(reply: SearchReply, query: string): string {
  const { text } = reply;
  expect(reply.isError).toBe(true);
  expect(text).toMatch(new RegExp(`^Search for "${query}" failed: `));
  expect(text).toContain(NOT_A_NO_RESULTS);
  expect(text).not.toContain('No results found');
  expect(text).not.toContain('Search Suggestions');
  // The generic error advice. Wrong for an outage: no other query would help.
  expect(text).not.toContain('use different search terms');
  // Like every error this server returns: nothing on the structured channel,
  // which the client does not check against the outputSchema for an error.
  expect(reply.structuredContent).toBeUndefined();
  return text;
}

describe('a search that could not be completed is an error, not "No results found"', () => {
  const failures: [string, Error, string][] = [
    ['answers HTTP 503', httpStatus(503, 'Service Unavailable'), 'HTTP 503 Service Unavailable'],
    ['cannot be reached', connectionRefused(), 'a network error: ECONNREFUSED'],
    ['times out', timedOut(), 'the request timed out'],
    ['answers with a body that is not JSON', notJson(), 'a response that was not valid JSON'],
  ];

  it.each(failures)('when the clustered search %s, in every format', async (_label, failure, reason) => {
    const { ctx, requests } = searchUpstream({ clusteredSearch: () => failure });

    for (const format of [{}, { responseFormat: 'json' }, { outputMode: 'compact' }]) {
      const text = expectFailed(await callSearch(ctx, { query: 'setup manager', ...format }), 'setup manager');
      expect(text).toBe(
        'Search for "setup manager" failed: the search results could not be fetched from ' +
        `learn.jamf.com (${reason}).\n\n${NOT_A_NO_RESULTS}\n\n${MAY_BE_TEMPORARY}`,
      );
    }
    expect(searchRequests(requests)).toHaveLength(3);
  });

  it.each([
    [400, 'Bad Request'],
    [403, 'Forbidden'],
    [404, 'Not Found'],
  ])('does not say it may be temporary when learn.jamf.com refused the request itself: HTTP %i', async (status, statusText) => {
    const { ctx } = searchUpstream({ clusteredSearch: () => httpStatus(status, statusText) });

    const text = expectFailed(await callSearch(ctx, { query: 'setup manager' }), 'setup manager');

    expect(text).toContain(`could not be fetched from learn.jamf.com (HTTP ${String(status)} ${statusText}).`);
    expect(text).not.toContain('temporary');
    expect(text).not.toContain('Trying again');
  });

  it.each([
    [408, 'Request Timeout'],
    [429, 'Too Many Requests'],
  ])('says it may be temporary for an HTTP %i, as the glossary does', async (status, statusText) => {
    const { ctx } = searchUpstream({ clusteredSearch: () => httpStatus(status, statusText) });

    const text = expectFailed(await callSearch(ctx, { query: 'setup manager' }), 'setup manager');

    expect(text).toContain(`(HTTP ${String(status)} ${statusText}).\n\n${NOT_A_NO_RESULTS}\n\n${MAY_BE_TEMPORARY}`);
  });

  it('names learn.jamf.com when it answered the search with a body that is not a search response', async () => {
    // A 200 with `{}` for a body used to reach the caller as "(clusters is not
    // iterable)", a JavaScript error, and with no source named.
    const { ctx } = searchUpstream({ clusteredSearch: () => malformed({}) });

    const text = expectFailed(await callSearch(ctx, { query: 'setup manager' }), 'setup manager');

    expect(text).toBe(
      'Search for "setup manager" failed: learn.jamf.com answered the search with results in a ' +
      `form this server could not read.\n\n${NOT_A_NO_RESULTS}\n\n${MAY_BE_TEMPORARY}`,
    );
  });

  it('says in plain words when something other than a request failed, and leaves the error out', async () => {
    // A cache that cannot be read. The other-source search reads it too, and
    // is left out of the reply when it fails, as it always was.
    const { ctx } = searchUpstream({ clusteredSearch: () => [PRESTAGE] });
    vi.mocked(ctx.cache.get).mockRejectedValue(
      new Error("ENOSPC: no space left on device, open '/var/cache/jamf-docs/ft-search.json'"),
    );

    const text = expectFailed(await callSearch(ctx, { query: 'setup manager' }), 'setup manager');

    expect(text).toBe(
      'Search for "setup manager" failed: this server hit an unexpected error while searching.' +
      `\n\n${NOT_A_NO_RESULTS}\n\n${UNEXPECTED_FAILURE_ADVICE}`,
    );
  });

  it('when the maps list a product filter is built from cannot be fetched', async () => {
    const { ctx, requests } = searchUpstream({
      clusteredSearch: () => [PRESTAGE],
      maps: httpStatus(503, 'Service Unavailable', MAPS_LIST),
    });

    const text = expectFailed(
      await callSearch(ctx, { query: 'setup manager', product: 'jamf-pro' }),
      'setup manager',
    );

    expect(text).toContain(
      'failed: the list of documentation maps, which the product filter "jamf-pro" is built ' +
      'from, could not be fetched from learn.jamf.com (HTTP 503 Service Unavailable).',
    );
    expect(text).toContain(MAY_BE_TEMPORARY);
    // The search itself was never sent.
    expect(searchRequests(requests)).toEqual([]);
  });

  it('when a MapsProvider the maps list comes from fails: its message, and not learn.jamf.com', async () => {
    const { ctx, requests } = searchUpstream({
      mapsProvider: new Error('KV namespace unavailable'),
      clusteredSearch: () => [PRESTAGE],
    });

    const text = expectFailed(
      await callSearch(ctx, { query: 'setup manager', product: 'jamf-pro' }),
      'setup manager',
    );

    expect(text).toBe(
      'Search for "setup manager" failed: the list of documentation maps, which the product ' +
      'filter "jamf-pro" is built from, could not be read from the configured maps provider ' +
      `(KV namespace unavailable).\n\n${NOT_A_NO_RESULTS}`,
    );
    expect(requests.filter(r => new URL(r.slice(r.indexOf(' ') + 1)).hostname === 'learn.jamf.com')).toEqual([]);
  });

  it('says so when the MapsProvider gave no reason', async () => {
    const { ctx } = searchUpstream({ mapsProvider: new Error('') });

    const text = expectFailed(
      await callSearch(ctx, { query: 'setup manager', product: 'jamf-pro' }),
      'setup manager',
    );

    expect(text).toContain('could not be read from the configured maps provider, which gave no reason.');
  });

  it('when the maps list from learn.jamf.com is not a list: plain words, not "a network error"', async () => {
    // The registry's `maps.map is not a function` is a TypeError, which
    // describeFetchFailure would call a network error.
    const { ctx } = searchUpstream({ maps: malformed({}) });

    const text = expectFailed(
      await callSearch(ctx, { query: 'setup manager', product: 'jamf-pro' }),
      'setup manager',
    );

    expect(text).toBe(
      'Search for "setup manager" failed: the list of documentation maps, which the product ' +
      `filter "jamf-pro" is built from, could not be read.\n\n${NOT_A_NO_RESULTS}\n\n${UNEXPECTED_FAILURE_ADVICE}`,
    );
  });

  it('when the re-query without docType fails after the filtered one found nothing', async () => {
    // A product + docType pair Jamf publishes nothing under comes back empty
    // upstream, and the service asks again without docType so the reply can
    // say docType was the cause. That second request failing leaves it unable
    // to say so, and a retry can: an error, not "No results found".
    const { ctx, requests } = searchUpstream({
      clusteredSearch: (_request, call) => (call === 0 ? [] : httpStatus(503, 'Service Unavailable')),
    });

    const text = expectFailed(
      await callSearch(ctx, { query: 'enrollment', docType: 'solution-guide' }),
      'enrollment',
    );

    expect(text).toContain('(HTTP 503 Service Unavailable).');
    expect(searchRequests(requests)).toHaveLength(2);
  });

  it('when a SearchProvider throws: its message, and no Fluid Topics fallback', async () => {
    const { ctx, requests, providerCalls } = searchUpstream({
      provider: new Error('provider index unavailable'),
      clusteredSearch: () => [PRESTAGE],
    });

    for (const format of [{}, { responseFormat: 'json' }]) {
      const text = expectFailed(await callSearch(ctx, { query: 'setup manager', ...format }), 'setup manager');
      expect(text).toBe(
        'Search for "setup manager" failed: the configured search backend reported an error ' +
        `(provider index unavailable).\n\n${NOT_A_NO_RESULTS}`,
      );
    }
    expect(providerCalls()).toBe(2);
    // Returning null is how a provider hands a search to Fluid Topics. One
    // that throws has failed, and answering from another backend would hide it.
    expect(searchRequests(requests)).toEqual([]);
  });

  it.each([
    ['a string', rejectsWith('provider index unavailable'), '(provider index unavailable)'],
    ['undefined', rejectsWith(undefined), 'without saying what went wrong'],
    ['an Error with no message', new Error(''), 'without saying what went wrong'],
    ['an object', rejectsWith({ code: 503 }), 'without saying what went wrong'],
  ])('keeps what a SearchProvider said when it rejects with %s', async (_label, provider, said) => {
    const { ctx, requests } = searchUpstream({ provider, clusteredSearch: () => [PRESTAGE] });

    const text = expectFailed(await callSearch(ctx, { query: 'setup manager' }), 'setup manager');

    expect(text).toBe(
      `Search for "setup manager" failed: the configured search backend reported an error ${said}.` +
      `\n\n${NOT_A_NO_RESULTS}`,
    );
    expect(searchRequests(requests)).toEqual([]);
  });

  it('names Fluid Topics when a SearchProvider declined and the search it handed on failed', async () => {
    const { ctx, providerCalls } = searchUpstream({
      provider: null,
      clusteredSearch: () => httpStatus(502, 'Bad Gateway'),
    });

    const text = expectFailed(await callSearch(ctx, { query: 'setup manager' }), 'setup manager');

    expect(providerCalls()).toBe(1);
    expect(text).toContain(
      'failed: the search results could not be fetched from learn.jamf.com (HTTP 502 Bad Gateway).',
    );
    expect(text).toContain(MAY_BE_TEMPORARY);
  });

  it('answers normally once the backend recovers: no failure was cached', async () => {
    let failing = true;
    const { ctx } = searchUpstream({
      clusteredSearch: () => (failing ? httpStatus(503, 'Service Unavailable') : [PRESTAGE]),
    });

    expectFailed(await callSearch(ctx, { query: 'setup manager' }), 'setup manager');

    failing = false;
    const recovered = await callSearch(ctx, { query: 'setup manager' });
    expect(recovered.isError).not.toBe(true);
    expect(recovered.structuredContent?.totalResults).toBe(1);
  });
});

describe('a SearchProvider that answers without a promise', () => {
  // `search` is typed async, but a provider on untyped code can return, or
  // throw, without a promise. Tagging its failure with a `.catch` on what it
  // returns fails every such search ("Cannot read properties of null (reading
  // 'catch')", "….catch is not a function"), and does not name a throw as the
  // provider's, so the call is awaited inside a try.

  it('hands the search to Fluid Topics when it returns null', async () => {
    const { ctx, requests, providerCalls } = searchUpstream({
      provider: null,
      providerSync: true,
      clusteredSearch: () => [PRESTAGE],
    });

    const reply = await callSearch(ctx, { query: 'setup manager' });

    expect(reply.isError).not.toBe(true);
    expect(reply.structuredContent?.totalResults).toBe(1);
    expect(providerCalls()).toBe(1);
    expect(searchRequests(requests)).toHaveLength(1);
  });

  it('is answered with the results it returns', async () => {
    const { ctx, requests } = searchUpstream({ provider: [PROVIDED], providerSync: true });

    const reply = await callSearch(ctx, { query: 'setup manager' });

    expect(reply.isError).not.toBe(true);
    expect(reply.structuredContent?.results).toMatchObject([{ title: PROVIDED.title, url: PROVIDED.url }]);
    expect(searchRequests(requests)).toEqual([]);
  });

  it('is named as the backend that failed when it throws', async () => {
    const { ctx, requests } = searchUpstream({
      provider: new Error('provider index unavailable'),
      providerSync: true,
      clusteredSearch: () => [PRESTAGE],
    });

    const text = expectFailed(await callSearch(ctx, { query: 'setup manager' }), 'setup manager');

    expect(text).toBe(
      'Search for "setup manager" failed: the configured search backend reported an error ' +
      `(provider index unavailable).\n\n${NOT_A_NO_RESULTS}`,
    );
    expect(searchRequests(requests)).toEqual([]);
  });
});

describe('what the other sources matched is kept, apart from the error', () => {
  it('as a second text block, so the first is the error alone', async () => {
    const { ctx } = searchUpstream({ clusteredSearch: () => httpStatus(503, 'Service Unavailable') });

    for (const format of [{}, { responseFormat: 'json' }, { outputMode: 'compact' }]) {
      const reply = await callSearch(ctx, { query: 'setup manager', ...format });
      expectFailed(reply, 'setup manager');

      expect(reply.texts).toHaveLength(2);
      expect(reply.text).not.toContain('concepts.jamf.com');
      const [, elsewhere] = reply.texts;
      const match = CONCEPTS_MATCH['setup manager'];
      expect(elsewhere).toBe(
        '## Also found outside the product documentation\n\n**Jamf Concepts**\n\n' +
        `- [${match.title}](${match.url})\n\n` +
        '*Matched on title. These sources were searched on their own; the product ' +
        'documentation could not be searched (see above).*\n',
      );
    }
  });

  it('and nothing is added when they matched nothing', async () => {
    const { ctx } = searchUpstream({ clusteredSearch: () => httpStatus(503, 'Service Unavailable') });

    const reply = await callSearch(ctx, { query: 'xqzvbnmplk' });

    expectFailed(reply, 'xqzvbnmplk');
    expect(reply.texts).toHaveLength(1);
  });
});

describe('a search that ran keeps its replies', () => {
  it('a query nothing matches is still "No results found", not an error', async () => {
    const { ctx } = searchUpstream();

    const reply = await callSearch(ctx, { query: 'xqzvbnmplk' });

    expect(reply.isError).not.toBe(true);
    expect(reply.text).toMatch(/^No results found for "xqzvbnmplk"/);
    expect(reply.structuredContent?.totalResults).toBe(0);
  });

  it('a query with results is answered with them', async () => {
    const { ctx } = searchUpstream({ clusteredSearch: () => [PRESTAGE] });

    const reply = await callSearch(ctx, { query: 'setup manager' });

    expect(reply.isError).not.toBe(true);
    expect(reply.texts).toHaveLength(1);
    expect(reply.structuredContent?.totalResults).toBe(1);
  });
});

describe('searchDocumentation says what failed, for the caller', () => {
  it('beside the raw searchError, which is unchanged', async () => {
    const { ctx } = searchUpstream({ clusteredSearch: () => httpStatus(503, 'Service Unavailable') });

    const result = await searchDocumentation(ctx, { query: 'setup manager' });

    expect(result.searchError).toBe(
      'HttpError: HTTP 503 Service Unavailable: https://learn.jamf.com/api/khub/clustered-search',
    );
    expect(result.searchErrorMessage).toBe(
      'Search for "setup manager" failed: the search results could not be fetched from ' +
      `learn.jamf.com (HTTP 503 Service Unavailable).\n\n${NOT_A_NO_RESULTS}\n\n${MAY_BE_TEMPORARY}`,
    );
    expect(result.results).toEqual([]);
  });

  it('and sets neither when the search ran', async () => {
    const { ctx } = searchUpstream();

    const result = await searchDocumentation(ctx, { query: 'xqzvbnmplk' });

    expect(result).not.toHaveProperty('searchError');
    expect(result).not.toHaveProperty('searchErrorMessage');
  });
});

describe('the description says which reply is which', () => {
  it('lists a failed search under Errors, and "No results found" as not an error', async () => {
    const { ctx } = searchUpstream();
    const { description } = await callSearch(ctx, { query: 'xqzvbnmplk' });

    const errors = description.slice(description.indexOf('Errors:'), description.indexOf('Note: "No results found"'));
    expect(errors).toContain('"Search for "<query>" failed: ..." (isError)');
    expect(errors).toContain('This is not a "no results"');
    expect(errors).not.toMatch(/- "No results found"/);
    expect(description).toContain('Note: "No results found" is not an error.');
  });
});
