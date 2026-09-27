/**
 * What a client paging through `jamf_docs_search` reaches, and what each page
 * tells it: the registered tool over MCP, with the real search service, and
 * only the backends stubbed. The client checks every structuredContent
 * against the published outputSchema.
 *
 * Until 2026-09-28 a page was `limit` results cut to `maxTokens` afterwards,
 * and page N+1 began at result `limit`·N, so what the cut dropped was on no
 * page. Live on 2026-09-28, paging `query: "enrollment"` (50 results) reached
 * 45 of them at the default budget with `limit: 50`, 42 at `maxTokens: 1000`
 * and none at 100, where every page was empty and said only "Results
 * truncated due to token limit. Use a smaller `limit` or increase
 * `maxTokens`." The results the cut dropped were listed in
 * `truncatedContent` as "omitted due to token limit".
 *
 * Pages are now cut to `maxTokens` as they are walked, so a next page follows
 * the one before it only when it is asked for with the same `limit` and
 * `maxTokens`. The footers used to name only the next `page`, and the MCP
 * App's "Show more" resent the filters, `limit` and the page: a model
 * following the footer at `maxTokens: 1000`, or the app paging a search the
 * model had run at that budget, got a page of another cut.
 */

import { describe, it, expect } from 'vitest';
import { TOKEN_CONFIG } from '../../../src/core/constants.js';
import { nextSearchPageArgs, type SearchPaging } from '../../../app-ui/search.js';
import { callSearch, searchUpstream, type SearchReply } from '../../helpers/search-upstream.js';
import {
  ENROLLMENT_COSTS,
  fieldsCosting,
  ftEntriesCosting,
  providerResultsCosting,
  resultCost,
} from '../../helpers/search-costs.js';
import type { SearchResult } from '../../../src/core/types.js';
import type { ServerContext } from '../../../src/core/types/context.js';

type Backend = 'fluid-topics' | 'provider';

function ctxCosting(backend: Backend, costs: readonly number[]): ServerContext {
  return backend === 'provider'
    ? searchUpstream({ provider: providerResultsCosting(costs) }).ctx
    : searchUpstream({ clusteredSearch: () => ftEntriesCosting(costs) }).ctx;
}

const ENROLLMENT_URLS = ENROLLMENT_COSTS.map((c, i) => fieldsCosting(i, c).url);

/** Page 1, then whatever `next` asks for, until it asks for nothing. */
async function walkBy(
  ctx: ServerContext,
  first: Record<string, unknown>,
  next: (reply: SearchReply, args: Record<string, unknown>) => Record<string, unknown> | null,
): Promise<SearchReply[]> {
  const replies: SearchReply[] = [];
  let args: Record<string, unknown> | null = first;
  while (args !== null) {
    const reply = await callSearch(ctx, args);
    expect(reply.isError, reply.text).not.toBe(true);
    replies.push(reply);
    args = next(reply, args);
    expect(replies.length).toBeLessThanOrEqual(100);
  }
  return replies;
}

/** The same arguments with the next page, while `hasMore` says there is one. */
function samePlusPage(reply: SearchReply, args: Record<string, unknown>): Record<string, unknown> | null {
  const sc = reply.structuredContent ?? {};
  return sc.hasMore === true ? { ...args, page: (sc.page as number) + 1 } : null;
}

function structuredUrls(replies: SearchReply[]): string[] {
  return replies.flatMap(r => (r.structuredContent?.results as { url: string }[]).map(x => x.url));
}

/** The result URLs a full-markdown page lists, in order. */
function fullMarkdownUrls(text: string): string[] {
  return [...text.matchAll(/^### \[[^\]]*\]\(([^)]*)\)$/gm)].map(m => m[1]);
}

/** The rank numbers and URLs a compact-markdown page lists, in order. */
function compactLines(text: string): { rank: number; url: string }[] {
  return [...text.matchAll(/^(\d+)\. \[[^\]]*\]\(([^)]*)\) - /gm)].map(m => ({ rank: Number(m[1]), url: m[2] }));
}

/** The arguments the full footer says to send for the next page, or null. */
function followFullFooter(reply: SearchReply, args: Record<string, unknown>): Record<string, unknown> | null {
  // The second group always takes part, empty when the footer names nothing.
  const footer = /Use `page=(\d+)`((?: with (?:`\w+: \d+`(?:, )?)+)?) for more results/.exec(reply.text);
  if (footer === null) { return null; }
  const named = Object.fromEntries([...footer[2].matchAll(/`(\w+): (\d+)`/g)].map(m => [m[1], Number(m[2])]));
  return { query: args.query, page: Number(footer[1]), ...named };
}

/** The arguments the compact footer says to send for the next page, or null. */
function followCompactFooter(reply: SearchReply, args: Record<string, unknown>): Record<string, unknown> | null {
  const footer = /\| page=(\d+)((?:, \w+=\d+)*) for more\*/.exec(reply.text);
  if (footer === null) { return null; }
  const named = Object.fromEntries([...footer[2].matchAll(/(\w+)=(\d+)/g)].map(m => [m[1], Number(m[2])]));
  return { query: args.query, outputMode: 'compact', page: Number(footer[1]), ...named };
}

describe('paging through a search reaches every result once, in rank order', () => {
  describe.each(['fluid-topics', 'provider'] as const)('on the %s path', (backend) => {
    it.each([
      [100, 10], [500, 10], [1000, 10], [5000, 10],
      [100, 50], [1000, 50], [5000, 50],
    ])('at maxTokens %i, limit %i, in JSON', async (maxTokens, limit) => {
      const ctx = ctxCosting(backend, ENROLLMENT_COSTS);
      const replies = await walkBy(ctx, { query: 'enrollment', maxTokens, limit, responseFormat: 'json', page: 1 }, samePlusPage);

      const bodies = replies.map(r => JSON.parse(r.text) as {
        results: { url: string }[];
        pagination: { page: number; totalPages: number; totalItems: number; hasNext: boolean };
        tokenInfo: { maxTokens: number };
        truncatedContent?: unknown;
      });
      expect(bodies.flatMap(b => b.results.map(x => x.url))).toEqual(ENROLLMENT_URLS);
      expect(structuredUrls(replies)).toEqual(ENROLLMENT_URLS);
      replies.forEach((r, i) => {
        expect(r.structuredContent).toMatchObject({
          page: i + 1, totalPages: replies.length, totalResults: 50, limit, maxTokens, hasMore: i + 1 < replies.length,
        });
        expect(r.structuredContent).not.toHaveProperty('truncatedContent');
        expect(bodies[i].pagination).toMatchObject({ page: i + 1, totalPages: replies.length, totalItems: 50 });
        expect(bodies[i].tokenInfo.maxTokens).toBe(maxTokens);
        expect(bodies[i]).not.toHaveProperty('truncatedContent');
      });
    });
  });

  it.each([100, 1000, 5000])('following only the full footer at maxTokens %i', async (maxTokens) => {
    const ctx = ctxCosting('fluid-topics', ENROLLMENT_COSTS);
    const replies = await walkBy(ctx, { query: 'enrollment', maxTokens }, followFullFooter);
    expect(replies.flatMap(r => fullMarkdownUrls(r.text))).toEqual(ENROLLMENT_URLS);
  });

  it.each([100, 1000, 5000])('following only the compact footer at maxTokens %i, numbered 1 to 50', async (maxTokens) => {
    const ctx = ctxCosting('fluid-topics', ENROLLMENT_COSTS);
    const replies = await walkBy(ctx, { query: 'enrollment', maxTokens, outputMode: 'compact' }, followCompactFooter);
    const lines = replies.flatMap(r => compactLines(r.text));
    expect(lines.map(l => l.url)).toEqual(ENROLLMENT_URLS);
    expect(lines.map(l => l.rank)).toEqual(ENROLLMENT_URLS.map((_, i) => i + 1));
  });

  it('following the footers at a limit that is not the default', async () => {
    const ctx = ctxCosting('fluid-topics', ENROLLMENT_COSTS);
    for (const [first, follow] of [
      [{ query: 'enrollment', limit: 20 }, followFullFooter],
      [{ query: 'enrollment', limit: 20, maxTokens: 1000, outputMode: 'compact' }, followCompactFooter],
    ] as const) {
      const replies = await walkBy(ctx, first, follow);
      const urls = replies.flatMap(r => [...fullMarkdownUrls(r.text), ...compactLines(r.text).map(l => l.url)]);
      expect(urls).toEqual(ENROLLMENT_URLS);
    }
  });

  it('with the MCP App\'s "Show more", built from structuredContent alone', async () => {
    const ctx = ctxCosting('fluid-topics', ENROLLMENT_COSTS);
    for (const maxTokens of [100, 1000, 5000]) {
      const replies = await walkBy(
        ctx,
        { query: 'enrollment', product: 'jamf-pro', limit: 20, maxTokens },
        (reply) => nextSearchPageArgs(reply.structuredContent as unknown as SearchPaging)?.args ?? null,
      );
      expect(structuredUrls(replies)).toEqual(ENROLLMENT_URLS);
      expect(replies.at(-1)?.structuredContent?.hasMore).toBe(false);
    }
  });
});

describe('the footers', () => {
  it('read as before at the default limit and budget', async () => {
    const ctx = ctxCosting('fluid-topics', ENROLLMENT_COSTS);

    const full = await callSearch(ctx, { query: 'enrollment' });
    const compact = await callSearch(ctx, { query: 'enrollment', outputMode: 'compact' });

    expect(full.text).toMatch(/\*\*Page 1 of 5\*\* \(1,114 tokens\) \| Use `page=2` for more results\n\n\*Use `jamf_docs_get_article`/);
    expect(compact.text).toContain('*Page 1/5 | page=2 for more*');
  });

  it('name limit and maxTokens beside the next page when they are not the default', async () => {
    const ctx = ctxCosting('fluid-topics', ENROLLMENT_COSTS);

    const full = await callSearch(ctx, { query: 'enrollment', limit: 20, maxTokens: 1000 });
    const compact = await callSearch(ctx, { query: 'enrollment', maxTokens: 1000, outputMode: 'compact' });

    expect(full.text).toContain('**Page 1 of 6** (896 tokens) | Use `page=2` with `limit: 20`, `maxTokens: 1000` for more results');
    expect(compact.text).toContain('*Page 1/6 | page=2, maxTokens=1000 for more*');
  });
});

describe('a result larger than maxTokens on its own', () => {
  it('is alone on its page, its snippet cut, and every channel says so', async () => {
    const ctx = ctxCosting('fluid-topics', ENROLLMENT_COSTS);
    // Result 1 costs 115.
    const line = '*"Result 1" is larger than `maxTokens: 100` on its own, so its snippet is cut to fit. ' +
      'Repeat with `maxTokens: 115` or more to see it whole; pages are cut to `maxTokens`, ' +
      'so it may then be on a different page.*';

    const full = await callSearch(ctx, { query: 'enrollment', maxTokens: 100 });
    const json = await callSearch(ctx, { query: 'enrollment', maxTokens: 100, responseFormat: 'json' });
    const compact = await callSearch(ctx, { query: 'enrollment', maxTokens: 100, outputMode: 'compact' });

    expect(full.text).toContain(`| Use \`page=2\` with \`maxTokens: 100\` for more results\n${line}\n`);
    expect(full.text).not.toContain('omitted due to token limit');
    expect(fullMarkdownUrls(full.text)).toEqual([ENROLLMENT_URLS[0]]);

    const body = JSON.parse(json.text) as { results: SearchResult[]; tokenInfo: unknown; truncatedResult: unknown };
    expect(body.truncatedResult).toEqual({ title: 'Result 1', estimatedTokens: 115 });
    expect(body.tokenInfo).toEqual({ tokenCount: resultCost(body.results[0]), truncated: true, maxTokens: 100 });
    expect(body.results[0].snippet.endsWith('…')).toBe(true);
    expect(resultCost(body.results[0])).toBeLessThanOrEqual(100);
    expect(json.structuredContent?.truncatedResult).toEqual({ title: 'Result 1', estimatedTokens: 115 });
    expect(full.structuredContent?.truncatedResult).toEqual({ title: 'Result 1', estimatedTokens: 115 });

    // Compact shows 80 characters of a snippet at most, and says nothing of the cut.
    expect(compactLines(compact.text)).toEqual([{ rank: 1, url: ENROLLMENT_URLS[0] }]);
    expect(compact.text).not.toContain('is larger than');
  });

  it('is named with its markdown escaped', async () => {
    const result: SearchResult = { ...providerResultsCosting([300])[0], title: 'Set *up* [SSO] for_you' };
    const { ctx } = searchUpstream({ provider: [result] });

    const reply = await callSearch(ctx, { query: 'sso', maxTokens: 100 });

    expect(reply.text).toContain('*"Set \\*up\\* \\[SSO\\] for\\_you" is larger than `maxTokens: 100` on its own');
  });

  it.each([
    [TOKEN_CONFIG.MAX_TOKENS_LIMIT, 'Repeat with `maxTokens: 50000` or more to see it whole'],
    [TOKEN_CONFIG.MAX_TOKENS_LIMIT + 1, 'It needs 50001 tokens, more than `maxTokens` allows (50000).'],
  ])('costing %i names what shows it whole only when maxTokens can', async (cost, advice) => {
    const { ctx } = searchUpstream({ provider: providerResultsCosting([cost]) });

    const reply = await callSearch(ctx, { query: 'big', maxTokens: 1000 });

    expect(reply.text).toContain(advice);
    expect(reply.structuredContent?.truncatedResult).toEqual({ title: 'Result 1', estimatedTokens: cost });
  });
});

describe('more pages than `page` accepts', () => {
  // 150 results of 60 tokens: at 100, one to a page.
  const COSTS = Array.from({ length: 150 }, () => 60);
  const NOTE = 'At `maxTokens: 100` and `limit: 10` these 150 results need 150 pages, but `page` stops at 100, ' +
    'so the results after page 100 cannot be reached this way. Repeat with `maxTokens: 120` or more to page through all of them.';

  it('page 99 names page 100, and page 100 names no next page in any channel', async () => {
    const ctx = ctxCosting('provider', COSTS);

    const before = await callSearch(ctx, { query: 'policy', maxTokens: 100, page: 99 });
    const last = await callSearch(ctx, { query: 'policy', maxTokens: 100, page: 100 });
    const lastCompact = await callSearch(ctx, { query: 'policy', maxTokens: 100, page: 100, outputMode: 'compact' });

    expect(before.text).toContain('Use `page=100` with `maxTokens: 100` for more results');
    expect(last.text).not.toContain('Use `page=');
    expect(lastCompact.text).toContain('*Page 100/150*');
    expect(lastCompact.text).not.toContain('for more');
    expect(last.structuredContent).toMatchObject({ page: 100, totalPages: 150, hasMore: false, paginationNote: NOTE });
    expect(last.text).toContain(`> **Pagination Note:** ${NOTE}`);
    expect(nextSearchPageArgs(last.structuredContent as unknown as SearchPaging)).toBeNull();
  });

  it('the budget the note names reaches all of them', async () => {
    const ctx = ctxCosting('provider', COSTS);
    const replies = await walkBy(ctx, { query: 'policy', maxTokens: 120, responseFormat: 'json', page: 1 }, samePlusPage);
    expect(replies).toHaveLength(75);
    expect(structuredUrls(replies)).toEqual(COSTS.map((c, i) => fieldsCosting(i, c).url));
  });
});

describe('the description', () => {
  it('says how pages are cut, and what truncatedResult is', async () => {
    const { ctx } = searchUpstream();
    const { description } = await callSearch(ctx, { query: 'enrollment' });
    expect(description).toContain('A page holds up to limit results, as many as fit maxTokens');
    expect(description).toContain('"truncatedResult"?: { "title": string, "estimatedTokens": number }');
    expect(description).not.toContain('Use a smaller `limit`');
  });

  it('lists in the JSON shape the notes a JSON reply can carry, paginationNote among them', async () => {
    // The Note on paging says paginationNote says what reaches the rest; the
    // JSON shape listed none of the notes until 2026-09-28.
    const { ctx } = searchUpstream();
    const { description } = await callSearch(ctx, { query: 'enrollment' });
    const shape = description.slice(description.indexOf('For JSON format:'), description.indexOf('For Markdown format:'));
    for (const note of ['filterRelaxation', 'versionNote', 'paginationNote', 'relevanceNote', 'localeNote']) {
      expect(shape).toMatch(new RegExp(`^ {4}"${note}"\\?: `, 'm'));
    }
  });
});
