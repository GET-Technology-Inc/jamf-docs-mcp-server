/**
 * What `jamf_docs_search` says when a filter matched nothing the search found
 * and was removed: the registered tool over MCP, with the real search service
 * and Fluid Topics stubbed.
 *
 * A filter is removed only when the search found results and none of them
 * matched every filter (`applyFiltersWithFallback` in search-service.ts), so
 * the terms found something, and the results shown are that search without
 * the filter. Until 2026-09-28 the note ended "Try broader search terms or
 * fewer filters.", which the MCP App shows as a warning above those results:
 * the terms had found them, and the filter had already been removed. Live
 * that day, `enrollment` with `product: "jamf-protect"` and `docType:
 * "solution-guide"` had 36 results, none of them a solution guide, under
 * that note.
 */

import { describe, it, expect } from 'vitest';
import { callSearch, PRESTAGE, searchUpstream } from '../../helpers/search-upstream.js';
import type { FtSearchRequest } from '../../../src/core/types.js';

/** Fluid Topics as it answers a search it has no page of `docType` for: nothing, until asked without it. */
function withoutSolutionGuides(request: FtSearchRequest): typeof PRESTAGE[] {
  return (request.filters ?? []).some(filter => filter.values.includes('content-solutionguide')) ? [] : [PRESTAGE];
}

async function relaxation(args: Record<string, unknown>): Promise<{
  message: string;
  markdown: string;
  removed: unknown;
}> {
  const { ctx } = searchUpstream({ clusteredSearch: withoutSolutionGuides });
  const markdown = await callSearch(ctx, args);
  const json = await callSearch(ctx, { ...args, responseFormat: 'json' });
  for (const reply of [markdown, json]) {
    expect(reply.isError, reply.text).not.toBe(true);
    expect(reply.structuredContent?.totalResults).toBe(1);
  }
  const relaxed = markdown.structuredContent?.filterRelaxation as { message: string; removed: unknown } | undefined;
  expect(relaxed).toBeDefined();
  expect((JSON.parse(json.text) as { filterRelaxation?: unknown }).filterRelaxation).toEqual(relaxed);
  return { message: relaxed?.message ?? '', markdown: markdown.text, removed: relaxed?.removed };
}

describe('a filter that matched none of the results found, and was removed', () => {
  it('is named with its value, and the results are said to be shown without it', async () => {
    const { message, markdown, removed } = await relaxation({ query: 'enrollment', docType: 'solution-guide' });

    expect(removed).toEqual(['docType']);
    expect(message).toBe(
      'No results with all filters applied. Removed filter(s): docType. '
      + 'These results are not filtered by docType "solution-guide".',
    );
    expect(markdown).toContain(`> **Note:** ${message}`);
  });

  it('is not followed by advice to search broader terms, which found these results, or fewer filters', async () => {
    const { message } = await relaxation({ query: 'enrollment', docType: 'solution-guide' });

    expect(message).not.toMatch(/broader|fewer/i);
  });

  it('names each filter removed, in the order they were removed', async () => {
    // The topic matches nothing of Computer PreStage Enrollments either, so
    // both go.
    const { message, removed } = await relaxation({ query: 'enrollment', docType: 'solution-guide', topic: 'sso' });

    expect(removed).toEqual(['docType', 'topic']);
    expect(message).toBe(
      'No results with all filters applied. Removed filter(s): docType, topic. '
      + 'These results are not filtered by docType "solution-guide" or topic "sso".',
    );
  });
});
