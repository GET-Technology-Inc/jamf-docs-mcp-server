/**
 * What `jamf_docs_search` advises about the topic filter when a search found
 * nothing: the registered tool over MCP, with the real search service and
 * suggestions, and Fluid Topics or a SearchProvider answering with no results.
 *
 * A topic is not sent to Fluid Topics. It filters what the search found, and
 * when it would leave nothing of that, it is set aside and the results are
 * shown without it (`applyFiltersWithFallback` in search-service.ts). So a
 * search that found nothing found nothing without its topic too, and a topic
 * can neither be what left nothing nor, added, find anything. Until
 * 2026-09-28 such a search was still told to filter by one and, when a topic
 * was its only filter, to remove its filters. Live that day, `ssoxyzzyq` had
 * no results and was told to try `topic="sso"`. With `topic: "sso"` it still
 * had none, and was told to filter by `topic="sso"` again and to remove
 * filters, which gave back the first search.
 *
 * A document type is sent to Fluid Topics, but a search that finds nothing
 * with one is sent again without it (`resolveSearchResults`), so it is not
 * what left nothing there either. A SearchProvider is handed both, and may
 * filter by them itself, so a search it answered is told to remove them.
 * Until 2026-09-28 no search was told so for a document type alone.
 */

import { describe, it, expect } from 'vitest';
import { callSearch, searchUpstream } from '../../helpers/search-upstream.js';
import { generateSearchSuggestions } from '../../../src/core/services/search-suggestions.js';
import type { SearchResult } from '../../../src/core/types.js';

const ANY_WORD = '- Check the spelling, or try other terms: the search finds pages with any one word of a query, ' +
  'so none of these words is in the documentation searched';
const REMOVE_FILTERS = '- Try removing filters to broaden your search';
const REMOVE_QUOTES = '- Try removing quotes for a broader search';
const TOC = '- Browse the table of contents with `jamf_docs_get_toc`';

/** The markdown reply to `args`, which Fluid Topics, or `provider` when given, finds nothing for. */
async function noResults(args: Record<string, unknown>, provider?: SearchResult[]): Promise<{
  markdown: string;
  tips: string[];
}> {
  const { ctx } = searchUpstream(provider !== undefined ? { provider } : {});
  const reply = await callSearch(ctx, args);
  expect(reply.isError, reply.text).not.toBe(true);
  expect(reply.structuredContent?.totalResults).toBe(0);
  const heading = '**Tips**:\n';
  const afterTips = reply.text.slice(reply.text.indexOf(heading) + heading.length);
  const tips = (afterTips.split('\n\n')[0] ?? '').split('\n').filter(line => line !== '');
  return { markdown: reply.text, tips };
}

describe('a search that found nothing', () => {
  it('is not told to filter by a topic, which narrows what was found', async () => {
    const { markdown, tips } = await noResults({ query: 'ssoxyzzyq' });

    expect(markdown).not.toContain('Try filtering by topic');
    expect(markdown).not.toContain('topic=');
    expect(tips).toEqual([ANY_WORD, TOC]);
  });

  it('with a topic its only filter, is not told to filter by that topic again, nor to remove it', async () => {
    const { markdown, tips } = await noResults({ query: 'ssoxyzzyq', topic: 'sso' });

    expect(markdown).not.toContain('Try filtering by topic');
    expect(tips).toEqual([ANY_WORD, TOC]);
  });

  it('with a phrase a page must have, is told only what can find something', async () => {
    // Not a query Fluid Topics matches on any one word, so the tips are the
    // ones such a query gets; `enrollment` is a word of two topics.
    const { markdown, tips } = await noResults({ query: '"enrollment xyzzyq"', topic: 'enrollment' });

    expect(markdown).not.toContain('Try filtering by topic');
    expect(tips).toEqual([REMOVE_QUOTES, TOC]);
    // Its words without the quotes are another query, which the tip agrees with.
    expect(markdown).toContain('**Try simpler query**: `enrollment xyzzyq`');
  });

  it('with a phrase in 「」 searched again as loose words, and a topic, is told only to check the spelling', async () => {
    // Fluid Topics found nothing for the phrase, nor for its words searched
    // without the quotes (`searchedLoosely`), and the topic was not sent: no
    // tip says to remove either, and no fewer of its words are suggested.
    const { markdown, tips } = await noResults({ query: '「enrollment xyzzyq」', topic: 'enrollment' });

    expect(markdown).toContain('the query searched without those quotes found nothing either');
    expect(markdown).not.toContain('Try simpler query');
    expect(tips).toEqual([ANY_WORD, TOC]);
  });

  it('with a product filter as well as a topic, is still told to remove its filters: the product is searched upstream', async () => {
    const { tips } = await noResults({ query: 'ssoxyzzyq', topic: 'sso', product: 'jamf-pro' });

    expect(tips).toEqual([REMOVE_FILTERS, ANY_WORD, TOC]);
  });

  it('that a SearchProvider answered, with a topic its only filter, is told to remove it: the provider is handed the topic', async () => {
    const { markdown, tips } = await noResults({ query: 'ssoxyzzyq', topic: 'sso' }, []);

    expect(markdown).not.toContain('Try filtering by topic');
    expect(tips).toContain(REMOVE_FILTERS);
  });

  it('with a docType its only filter, is not told to remove it: Fluid Topics was searched without it too', async () => {
    const { tips } = await noResults({ query: 'ssoxyzzyq', docType: 'solution-guide' });

    expect(tips).toEqual([ANY_WORD, TOC]);
  });

  it('that a SearchProvider answered, with a docType its only filter, is told to remove it: the provider is handed the docType', async () => {
    const { tips } = await noResults({ query: 'ssoxyzzyq', docType: 'solution-guide' }, []);

    expect(tips).toEqual([REMOVE_FILTERS, TOC]);
  });

  it('gets no suggested topics from generateSearchSuggestions, which still returns the field', () => {
    for (const searchedBy of ['fluid-topics', 'provider', undefined] as const) {
      const suggestions = generateSearchSuggestions('sso configuration', false, false, 'en-US', { searchedBy });
      expect(suggestions.suggestedTopics).toEqual([]);
    }
  });
});
