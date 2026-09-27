/**
 * What `jamf_docs_search` answers when the search ran and the product
 * documentation had nothing: the registered tool over MCP, with the real
 * search service, suggestions and other-source search, and only the backends
 * stubbed.
 *
 * Until 2026-09-28 that reply had two faults of its own, besides being what a
 * failed search answered too (search-upstream-failure.test.ts):
 *
 * - With `responseFormat: "json"` its text was the markdown "No results
 *   found" page, so a caller's `JSON.parse` threw. Live on 6.0.12, "xqzvbnmplk"
 *   answered `Unexpected token 'N', "No results"... is not valid JSON`. #346
 *   fixed the same for the glossary.
 * - It dropped the other-source matches on every channel. They were fetched
 *   and then not used, although for a query the product documentation has
 *   nothing on they are the only thing that matched. Live on 6.0.12, Fluid
 *   Topics had no result for "jamformer", "saastenancy", "remediasoar" or
 *   "apiutil", each the title of a concepts.jamf.com page, and none of those
 *   pages reached any channel.
 *
 * A product filter Jamf could not apply was dropped the same way: the reply
 * did not say the search had gone out unfiltered.
 */

import { describe, it, expect } from 'vitest';
import {
  CONCEPTS_MATCH,
  PRESTAGE,
  callSearch,
  searchRequests,
  searchUpstream,
  type SearchUpstream,
} from '../../helpers/search-upstream.js';

const NO_RESULTS_CAVEAT =
  '*Matched on title. The product documentation had no results for this query.*';

/** The parts of the JSON body a no-results reply always has. */
function expectJsonBody(text: string, query: string): Record<string, unknown> {
  const json = JSON.parse(text) as Record<string, unknown>;
  expect(json).toMatchObject({
    total: 0,
    query,
    results: [],
    tokenInfo: { tokenCount: 0, truncated: false, maxTokens: 5000 },
    pagination: { page: 1, totalPages: 0, totalItems: 0, hasNext: false, hasPrev: false },
  });
  // It says how results are ordered, and there are none.
  expect(json).not.toHaveProperty('relevanceNote');
  return json;
}

describe('with responseFormat "json", a search with no results answers JSON', () => {
  it('the documented body, with the suggestions structuredContent carries', async () => {
    const { ctx } = searchUpstream();

    const reply = await callSearch(ctx, { query: 'automated device enrolment policy', responseFormat: 'json' });

    expect(reply.isError).not.toBe(true);
    const json = expectJsonBody(reply.text, 'automated device enrolment policy');
    expect(json.suggestions).toEqual(reply.structuredContent?.suggestions);
    expect((json.suggestions as string[]).length).toBeGreaterThan(0);
    expect(json).not.toHaveProperty('otherSources');
  });

  it('including for a query that yields no suggestions', async () => {
    const { ctx } = searchUpstream();

    const reply = await callSearch(ctx, { query: 'xqzvbnmplk', responseFormat: 'json' });

    const json = expectJsonBody(reply.text, 'xqzvbnmplk');
    expect(json.suggestions).toEqual([]);
    expect(json).not.toHaveProperty('localeNote');
    expect(reply.structuredContent?.suggestions).toEqual([]);
  });

  it('with the caveat for a language other than en-US, which the markdown ends with', async () => {
    // It is the one piece of the markdown's advice that names another search
    // to run, and the markdown sent as JSON carried it until 2026-09-28.
    const { ctx } = searchUpstream();
    const note = 'Not all documentation is available in "ja-JP". Try searching with language: "en-US".';

    const json = await callSearch(ctx, { query: 'xqzvbnmplk', language: 'ja-JP', responseFormat: 'json' });
    const markdown = await callSearch(ctx, { query: 'xqzvbnmplk', language: 'ja-JP' });

    expect(expectJsonBody(json.text, 'xqzvbnmplk').localeNote).toBe(note);
    expect(json.structuredContent).not.toHaveProperty('localeNote');
    expect(markdown.text).toContain(`\n\n${note}`);
  });
});

describe('what the other sources matched reaches every channel', () => {
  const backends: [string, SearchUpstream][] = [
    ['Fluid Topics', {}],
    ['a SearchProvider', { provider: [] }],
  ];

  it.each(backends)('when %s found nothing', async (_label, upstream) => {
    const { ctx } = searchUpstream(upstream);
    const expected = [CONCEPTS_MATCH.jamformer];

    const markdown = await callSearch(ctx, { query: 'jamformer' });
    const compact = await callSearch(ctx, { query: 'jamformer', outputMode: 'compact' });
    const json = await callSearch(ctx, { query: 'jamformer', responseFormat: 'json' });

    for (const reply of [markdown, compact, json]) {
      expect(reply.isError).not.toBe(true);
      expect(reply.texts).toHaveLength(1);
      expect(reply.structuredContent?.totalResults).toBe(0);
      expect(reply.structuredContent?.otherSources).toEqual(expected);
    }
    expect(expectJsonBody(json.text, 'jamformer').otherSources).toEqual(expected);

    for (const reply of [markdown, compact]) {
      expect(reply.text).toMatch(/^No results found for "jamformer"/);
      expect(reply.text).toContain(
        '\n---\n\n## Also found outside the product documentation\n\n**Jamf Concepts**\n\n' +
        `- [Jamformer](${CONCEPTS_MATCH.jamformer.url})\n\n${NO_RESULTS_CAVEAT}\n`,
      );
      // The caveat under results that were ranked. There are none here.
      expect(reply.text).not.toContain('ranked separately from the results above');
    }
  });

  it('and a SearchProvider that found nothing keeps Fluid Topics out of it', async () => {
    const { ctx, requests, providerCalls } = searchUpstream({ provider: [] });

    await callSearch(ctx, { query: 'jamformer' });

    expect(providerCalls()).toBe(1);
    expect(searchRequests(requests)).toEqual([]);
  });
});

describe('a no-results reply with nothing else to say is unchanged', () => {
  it('in markdown, word for word', async () => {
    const { ctx } = searchUpstream();

    const reply = await callSearch(ctx, { query: 'xqzvbnmplk' });

    // As 6.0.12 answered it live.
    expect(reply.text).toBe(
      'No results found for "xqzvbnmplk"\n\n## Search Suggestions\n\n**Tips**:\n' +
      '- Browse the table of contents with `jamf_docs_get_toc`\n',
    );
    expect(reply.texts).toHaveLength(1);
  });

  it('with no otherSources key on either JSON channel, rather than an empty list', async () => {
    const { ctx } = searchUpstream();

    const reply = await callSearch(ctx, { query: 'xqzvbnmplk', responseFormat: 'json' });

    expect(JSON.parse(reply.text)).not.toHaveProperty('otherSources');
    expect(reply.structuredContent).not.toHaveProperty('otherSources');
  });

  it('and structuredContent says which search it answers', async () => {
    const { ctx } = searchUpstream();

    const reply = await callSearch(ctx, { query: 'xqzvbnmplk', product: 'jamf-pro', limit: 5 });

    expect(reply.structuredContent).toEqual({
      query: 'xqzvbnmplk',
      filters: { product: 'jamf-pro' },
      totalResults: 0,
      page: 1,
      totalPages: 0,
      limit: 5,
      hasMore: false,
      results: [],
      suggestions: [],
    });
  });
});

describe('a product filter that could not be applied is still reported', () => {
  // jamf-routines is classified under nothing, and this maps list has no map
  // of its publication either, so the search goes out unfiltered and the
  // service says so. With nothing found, the reply used to drop that. Now it
  // carries it, worded for a search with no results: there are no "these
  // results" for it to speak of.
  const note = (limited: string): string =>
    'The product filter "jamf-routines" was not applied: Jamf classifies no documentation as ' +
    'Jamf Routines, and no map of its publication "jamf-routines-documentation" was found to filter by ' +
    `instead, so ${limited} not limited to it. Browse its documentation with ` +
    'jamf_docs_get_toc (product "jamf-routines").';
  const message = note('the search was');

  it('in markdown, the JSON text and structuredContent', async () => {
    const { ctx } = searchUpstream();

    const markdown = await callSearch(ctx, { query: 'xqzvbnmplk', product: 'jamf-routines' });
    const json = await callSearch(ctx, { query: 'xqzvbnmplk', product: 'jamf-routines', responseFormat: 'json' });

    const relaxation = { removed: ['product'], original: { product: 'jamf-routines' }, message };
    expect(markdown.text).toContain(`\n> **Note:** ${message}\n`);
    expect(markdown.structuredContent?.filterRelaxation).toEqual(relaxation);
    expect(JSON.parse(json.text)).toMatchObject({ filterRelaxation: relaxation });
    expect(json.structuredContent?.filterRelaxation).toEqual(relaxation);
  });

  it('and speaks of "these results" when there are some, as it always did', async () => {
    const { ctx } = searchUpstream({ clusteredSearch: () => [PRESTAGE] });

    const reply = await callSearch(ctx, { query: 'setup manager', product: 'jamf-routines' });

    expect(reply.structuredContent?.totalResults).toBe(1);
    expect(reply.structuredContent?.filterRelaxation).toMatchObject({ message: note('these results are') });
  });
});

describe('the description documents the JSON no-results body', () => {
  it('lists suggestions in the JSON shape', async () => {
    const { ctx } = searchUpstream();
    const { description } = await callSearch(ctx, { query: 'xqzvbnmplk' });

    const shape = description.slice(description.indexOf('For JSON format:'), description.indexOf('For Markdown format:'));
    expect(shape).toContain('"suggestions"?: [string]');
    expect(description).toContain('in JSON that is "total": 0');
  });
});
