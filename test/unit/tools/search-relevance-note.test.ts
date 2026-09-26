/**
 * Which backend `jamf_docs_search` says ranked its results.
 *
 * Until 2026-09-26 every JSON reply said the results were "ranked by the
 * Fluid Topics search API", including the ones a SearchProvider answered. On
 * that path the provider's array comes back before any Fluid Topics request
 * is built, and filtering, paging and token truncation all keep its order, so
 * the client was told Jamf's search had ranked a list it never saw.
 * Reproduced on 6.0.11 with a stub provider: one provider call, no request to
 * learn.jamf.com, the provider's order on both channels, and the Fluid Topics
 * note on both channels. The markdown trailer under the other-source hits gave
 * the same backend as its reason.
 *
 * search-notices.test.ts could not see it: it replaces searchDocumentation
 * with a mock, and a mocked result cannot say which backend answered. So every
 * case here runs the real search service under the registered tool, over MCP,
 * with only the backends stubbed: a SearchProvider with an order of its own,
 * and an HttpClient that records each request and answers the clustered
 * search and the Jamf Concepts sitemap from fixtures.
 *
 * The clustered-search entries are the top three live results for
 * "automated device enrollment" on 2026-09-26, one per cluster, trimmed to the
 * fields the code reads. None of the 1,181 entries measured across three
 * queries that day carried a score, rank or weight field anywhere, which is
 * what the Fluid Topics note says.
 */

import { describe, it, expect, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { registerSearchTool } from '../../../src/core/tools/search.js';
import { searchDocumentation } from '../../../src/core/services/search-service.js';
import { MapsRegistry } from '../../../src/core/services/maps-registry.js';
import { TopicResolver } from '../../../src/core/services/topic-resolver.js';
import { createMockContext, createMockCache } from '../../helpers/mock-context.js';
import type { HttpClient } from '../../../src/core/http-client.js';
import type { SearchProvider } from '../../../src/core/services/interfaces/index.js';
import type {
  FtClusteredSearchResponse,
  FtMetadataEntry,
  SearchRanker,
  SearchResult,
} from '../../../src/core/types.js';
import type { ServerContext } from '../../../src/core/types/context.js';

// ── The served texts ────────────────────────────────────────────────────────

/** Unchanged since #246, and true when Fluid Topics answered. */
const FLUID_TOPICS_NOTE =
  'Results are ordered by relevance, as ranked by the Fluid Topics search API. ' +
  'The API returns no numeric relevance score, so none is included.';

const PROVIDER_NOTE =
  'Results are in the order the configured search backend ranked them; ' +
  'no numeric relevance score is included.';

const TRAILER =
  '*Matched on title, ranked separately from the results above, ' +
  'which carry no score to rank them against.*';

// ── Fixtures ────────────────────────────────────────────────────────────────

const CLUSTERED_SEARCH = 'https://learn.jamf.com/api/khub/clustered-search';
const CONCEPTS_SITEMAP = 'https://concepts.jamf.com/sitemap.xml';

/** Three live concepts.jamf.com pages, one of which the trailer cases match. */
const CONCEPTS_SITEMAP_XML = '<urlset>'
  + '<url><loc>https://concepts.jamf.com/en/concepts/reenroller</loc></url>'
  + '<url><loc>https://concepts.jamf.com/en/concepts/setup-manager</loc></url>'
  + '<url><loc>https://concepts.jamf.com/en/concepts/jamf-sync</loc></url>'
  + '</urlset>';

/** A provider's own ranking, deliberately neither alphabetical nor Fluid Topics'. */
const PROVIDER_RESULTS: SearchResult[] = [
  ['Zeta', 'ranked first by the provider'],
  ['Alpha', 'ranked second by the provider'],
  ['Mu', 'ranked third by the provider'],
].map(([slug, snippet]) => ({
  title: `${slug}: ${snippet}`,
  url: `https://learn.jamf.com/r/en-US/jamf-pro-documentation-current/${slug}`,
  snippet: `Automated Device Enrollment, ${snippet}.`,
  product: 'Jamf Pro',
}));
const PROVIDER_ORDER = PROVIDER_RESULTS.map(r => r.title);

const PRO_MAP = 'A4LI4vM0BILraYeOD89WGg';

function meta(entries: Record<string, string[]>): FtMetadataEntry[] {
  return Object.entries(entries).map(([key, values]) => ({ key, label: key, values }));
}

const FT_ENTRIES = [
  ['zGNgfc54eSb4O0Kk864Pkg', 'Computer PreStage Enrollments',
    ['Enrollment', 'Enrollment for Computers', 'Automated Device Enrollment for Computers']],
  ['Hl8kl0VoKUt1_2TFW5Oj~w', 'Mobile Device PreStage Enrollments',
    ['Enrollment', 'Enrollment for Mobile Devices', 'Automated Device Enrollment for Mobile Devices']],
  ['baBJgkbwWsX2X9emI4I7cQ', 'Automated Device Enrollment Integration',
    ['Global Management Settings']],
] as const;
const FT_ORDER = FT_ENTRIES.map(([, title]) => title);

const FT_RESPONSE: FtClusteredSearchResponse = {
  facets: [],
  announcements: [],
  paging: { currentPage: 1, isLastPage: false, totalResultsCount: 2078, totalClustersCount: 443 },
  results: FT_ENTRIES.map(([contentId, title, trail]) => {
    const slug = title.replaceAll(' ', '_');
    return {
      metadataVariableAxis: 'version',
      entries: [{
        type: 'TOPIC' as const,
        missingTerms: [],
        topic: {
          mapId: PRO_MAP,
          contentId,
          tocId: `toc-${contentId}`,
          title,
          htmlTitle: title,
          mapTitle: 'Jamf Pro Documentation 11.32.0',
          breadcrumb: [...trail, title],
          htmlExcerpt: '<span class="kwicstring">Configure and deploy the </span>'
            + '<span class="kwicmatch">Automated Device Enrollment</span>'
            + '<span class="kwicstring"> settings for devices.</span>',
          metadata: meta({
            'version': ['11.32.0'],
            'zoominmetadata': ['content-techdocs', 'product-pro', 'product-pro-11.32.0'],
            'ft:clusterId': [`jamf-pro-documentation-current/${slug}`],
            'ft:locale': ['en-US'],
            'jamf:portal': ['Jamf Pro'],
            'ft:prettyUrl': [`en-US/jamf-pro-documentation-current/${slug}`],
          }),
        },
      }],
    };
  }),
};

// ── Harness ─────────────────────────────────────────────────────────────────

interface Backends {
  /** What the SearchProvider does; no provider is configured when omitted. */
  provider?: 'answers' | 'declines' | 'throws';
}

interface Harness {
  ctx: ServerContext;
  /** Every request the server made, as `METHOD url`. */
  requests: string[];
  providerCalls: () => number;
}

function backends({ provider }: Backends = {}): Harness {
  const requests: string[] = [];
  const unexpected = (method: string, url: string): Error =>
    new Error(`offline: no fixture for ${method} ${url}`);

  const http: HttpClient = {
    getText: async (url) => {
      requests.push(`GET ${url}`);
      if (url === CONCEPTS_SITEMAP) { return await Promise.resolve(CONCEPTS_SITEMAP_XML); }
      throw unexpected('GET', url);
    },
    getJson: async (url) => {
      requests.push(`GET ${url}`);
      return await Promise.reject(unexpected('GET', url));
    },
    postJson: async <T>(url: string) => {
      requests.push(`POST ${url}`);
      if (url === CLUSTERED_SEARCH) { return await Promise.resolve(FT_RESPONSE as T); }
      throw unexpected('POST', url);
    },
  };

  const search = vi.fn<SearchProvider['search']>(async () => {
    if (provider === 'throws') { throw new Error('provider index unavailable'); }
    return await Promise.resolve(provider === 'answers' ? PROVIDER_RESULTS : null);
  });

  // Everything on the one recording client, so a request the registry or the
  // resolver made would show up in `requests` rather than in the no-network
  // guard, whose failure the tool would swallow.
  const cache = createMockCache();
  const mapsRegistry = new MapsRegistry(cache, undefined, undefined, undefined, http);
  const topicResolver = new TopicResolver(mapsRegistry, cache, undefined, undefined, http);
  const ctx = createMockContext({
    cache, http, mapsRegistry, topicResolver,
    ...(provider !== undefined ? { searchProvider: { search } } : {}),
  });

  return { ctx, requests, providerCalls: () => search.mock.calls.length };
}

interface TextContent { type: 'text'; text: string }

interface Reply {
  text: string;
  sc: Record<string, unknown>;
}

async function callSearch(ctx: ServerContext, args: Record<string, unknown>): Promise<Reply> {
  const server = new McpServer({ name: 'test-server', version: '0.0.1' });
  registerSearchTool(server, ctx);
  const client = new Client({ name: 'test-client', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    // The client checks structuredContent against the published outputSchema
    // only for tools it has listed.
    await client.listTools();
    const result = await client.callTool({ name: 'jamf_docs_search', arguments: args });
    expect(result.isError).not.toBe(true);
    return {
      text: (result.content[0] as TextContent).text,
      sc: result.structuredContent as Record<string, unknown>,
    };
  } finally {
    await client.close();
    await server.close();
  }
}

function titles(results: unknown): string[] {
  return (results as { title: string }[]).map(r => r.title);
}

/** The recorded `METHOD url` requests whose url's host is learn.jamf.com. */
function toLearnJamf(requests: string[]): string[] {
  return requests.filter(r => new URL(r.slice(r.indexOf(' ') + 1)).hostname === 'learn.jamf.com');
}

const JSON_ARGS = { query: 'automated device enrollment', responseFormat: 'json' };

// ── Cases ───────────────────────────────────────────────────────────────────

describe('when a SearchProvider answered, the note does not credit Fluid Topics', () => {
  it('in the JSON text and in structuredContent, over the order the provider gave', async () => {
    const { ctx, requests, providerCalls } = backends({ provider: 'answers' });

    const { text, sc } = await callSearch(ctx, JSON_ARGS);
    const json = JSON.parse(text) as Record<string, unknown>;

    // The premise: the provider ranked these, and Fluid Topics never saw the query.
    expect(providerCalls()).toBe(1);
    expect(toLearnJamf(requests)).toEqual([]);
    expect(titles(json.results)).toEqual(PROVIDER_ORDER);
    expect(titles(sc.results)).toEqual(PROVIDER_ORDER);

    expect(json.relevanceNote).toBe(PROVIDER_NOTE);
    expect(sc.relevanceNote).toBe(PROVIDER_NOTE);
    expect(text).not.toContain('Fluid Topics');
    // Kept, in lower case, on both branches. Clients match this phrase, at
    // least one downstream test case-sensitively, so a sentence opening
    // "No numeric…" would break it.
    expect(sc.relevanceNote).toContain('no numeric relevance score');
  });

  it('keeps the provenance internal: no new field on either channel', async () => {
    const { ctx } = backends({ provider: 'answers' });

    const { text, sc } = await callSearch(ctx, JSON_ARGS);

    expect(JSON.parse(text)).not.toHaveProperty('rankedBy');
    expect(sc).not.toHaveProperty('rankedBy');
  });
});

describe('when Fluid Topics answered, the note still says so, word for word', () => {
  it('with no SearchProvider configured', async () => {
    const { ctx, requests } = backends();

    const { text, sc } = await callSearch(ctx, JSON_ARGS);
    const json = JSON.parse(text) as Record<string, unknown>;

    expect(toLearnJamf(requests)).toEqual([`POST ${CLUSTERED_SEARCH}`]);
    expect(titles(json.results)).toEqual(FT_ORDER);
    expect(titles(sc.results)).toEqual(FT_ORDER);
    expect(json.relevanceNote).toBe(FLUID_TOPICS_NOTE);
    expect(sc.relevanceNote).toBe(FLUID_TOPICS_NOTE);
    expect(sc.relevanceNote).toContain('no numeric relevance score');
  });

  it('with a SearchProvider that declined the query: who answered counts, not who is configured', async () => {
    const { ctx, requests, providerCalls } = backends({ provider: 'declines' });

    const { text, sc } = await callSearch(ctx, JSON_ARGS);
    const json = JSON.parse(text) as Record<string, unknown>;

    expect(providerCalls()).toBe(1);
    expect(toLearnJamf(requests)).toEqual([`POST ${CLUSTERED_SEARCH}`]);
    expect(titles(sc.results)).toEqual(FT_ORDER);
    expect(json.relevanceNote).toBe(FLUID_TOPICS_NOTE);
    expect(sc.relevanceNote).toBe(FLUID_TOPICS_NOTE);
  });
});

describe('the other-source trailer gives a reason that holds whichever backend ranked', () => {
  const cases: [string, Backends][] = [
    ['a SearchProvider', { provider: 'answers' }],
    ['Fluid Topics', {}],
  ];

  it.each(cases)('when %s ranked the results above it', async (_label, which) => {
    const { ctx, requests } = backends(which);

    const { text, sc } = await callSearch(ctx, { query: 'setup manager' });

    expect(requests).toContain(`GET ${CONCEPTS_SITEMAP}`);
    expect(sc.otherSources).toEqual([{
      title: 'Setup Manager',
      // The sitemap lists it without the slash; core hands out the slashed
      // form, the one concepts.jamf.com serves without a redirect (#338).
      url: 'https://concepts.jamf.com/en/concepts/setup-manager/',
      source: 'Jamf Concepts',
    }]);
    expect(text).toContain('## Also found outside the product documentation');
    expect(text.split('\n')).toContain(TRAILER);
    expect(text).not.toContain('Fluid Topics');
  });
});

describe('searchDocumentation says which backend ranked its results', () => {
  const cases: [string, SearchRanker, Backends][] = [
    ['answered', 'provider', { provider: 'answers' }],
    ['declined', 'fluid-topics', { provider: 'declines' }],
    ['was not configured', 'fluid-topics', {}],
  ];

  it.each(cases)('when the SearchProvider %s: %s', async (_outcome, rankedBy, which) => {
    const { ctx } = backends(which);

    const result = await searchDocumentation(ctx, { query: 'automated device enrollment' });

    expect(result.rankedBy).toBe(rankedBy);
    expect(result.results).toHaveLength(3);
  });

  it('and names none when the search failed, since nothing ranked anything', async () => {
    const { ctx } = backends({ provider: 'throws' });

    const result = await searchDocumentation(ctx, { query: 'automated device enrollment' });

    expect(result.searchError).toContain('provider index unavailable');
    expect(result.results).toEqual([]);
    expect(result).not.toHaveProperty('rankedBy');
  });
});
