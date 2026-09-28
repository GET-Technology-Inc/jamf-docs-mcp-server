/**
 * A SearchProvider result whose `url` no link can be made of, blank or not an
 * absolute https URL, is left out, as a Fluid Topics result without a url is:
 * the registered tool over MCP, with the real search service.
 *
 * Markdown writes such a url as `#` (`sanitizeMarkdownUrl`), and nothing can
 * fetch it. The Fluid Topics path drops an entry whose url comes out ''
 * (`resolveSearchResults`), and a provider result with no url string at all
 * was left out already (provider-results.ts). Until 2026-09-28 one with any
 * url string was kept, offline over MCP: with `url: ''` the markdown listed it
 * as `### [Kept](#)`, a link to nowhere, and structuredContent and the JSON
 * text carried it with `url: ""`; with `url: ' '`, as `### [Blank](#)`. It is
 * now logged at debug, as a `null` field is.
 */

import { describe, it, expect } from 'vitest';
import { callSearch, searchRequests, searchUpstream, PRESTAGE } from '../../helpers/search-upstream.js';
import { createMockLogger } from '../../helpers/mock-context.js';
import type { LoggerFactory } from '../../../src/core/services/interfaces/index.js';
import type { SearchResult } from '../../../src/core/types.js';
import type { ServerContext } from '../../../src/core/types/context.js';

const NO_URL: SearchResult = {
  title: 'Kept',
  url: '',
  snippet: 'A result the provider matched, with nowhere to read it.',
  product: 'Jamf Pro',
};

const POLICIES: SearchResult = {
  title: 'Policies',
  url: 'https://learn.jamf.com/r/en-US/jamf-pro-documentation-current/Policies',
  snippet: 'Policies allow you to remotely automate common management tasks on managed computers.',
  product: 'Jamf Pro',
};

/** Urls a reply cannot link to: markdown writes each as `#`. */
const UNLINKABLE: [string, string][] = [
  ['empty', ''],
  ['blank', ' '],
  ['http', 'http://learn.jamf.com/r/en-US/jamf-pro-documentation-current/Policies'],
  ['relative', '/r/en-US/jamf-pro-documentation-current/Policies'],
];

const FORMATS = [
  { responseFormat: 'json' },
  { responseFormat: 'markdown' },
  { responseFormat: 'markdown', outputMode: 'compact' },
] as const;

/** `ctx`, with what the search service logs about the provider gathered. */
function logged(ctx: ServerContext): { ctx: ServerContext; debugs: string[]; warnings: string[] } {
  const debugs: string[] = [];
  const warnings: string[] = [];
  const logger: LoggerFactory = {
    createLogger: (name: string) => ({
      ...createMockLogger(),
      debug: (message: unknown) => {
        if (name === 'search-service' && String(message).startsWith('SearchProvider')) { debugs.push(String(message)); }
      },
      warning: (message: unknown) => {
        if (name === 'search-service') { warnings.push(String(message)); }
      },
    }),
  };
  return { ctx: { ...ctx, logger }, debugs, warnings };
}

describe('a SearchProvider result whose url no link can be made of', () => {
  it.each(UNLINKABLE)('%s: is left out of every channel, the rest are returned, and a debug line says so', async (_label, url) => {
    const { ctx, debugs, warnings } = logged(searchUpstream({ provider: [{ ...NO_URL, url }, POLICIES] }).ctx);

    for (const format of FORMATS) {
      const reply = await callSearch(ctx, { query: 'policies', ...format });
      expect(reply.isError, reply.text).not.toBe(true);
      const results = reply.structuredContent?.results as SearchResult[];
      expect(results.map(r => r.title)).toEqual(['Policies']);
      expect(reply.structuredContent?.totalResults).toBe(1);
      expect(reply.text).not.toContain('Kept');
      expect(reply.text).not.toContain('](#)');
      if (format.responseFormat === 'json') {
        expect((JSON.parse(reply.text) as { total: number }).total).toBe(1);
      }
    }
    expect(debugs).toEqual(Array<string>(FORMATS.length)
      .fill('SearchProvider: left out 1 of 2 results (a url that is not an absolute https URL)'));
    expect(warnings).toEqual([]);
  });

  it('when every result has one, is read as no answer: Fluid Topics answers, as for a url of another type', async () => {
    const provider = UNLINKABLE.map(([label, url]) => ({ ...NO_URL, title: label, url }));
    const { ctx, requests } = searchUpstream({ provider, clusteredSearch: () => [PRESTAGE] });

    const reply = await callSearch(ctx, { query: 'policies', responseFormat: 'json' });

    expect(searchRequests(requests)).toHaveLength(1);
    expect((reply.structuredContent?.results as SearchResult[]).map(r => r.title)).toEqual(['Computer PreStage Enrollments']);
  });
});
