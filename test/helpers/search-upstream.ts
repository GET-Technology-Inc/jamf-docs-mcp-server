/**
 * The backends `jamf_docs_search` reads, offline, with a switch to make each
 * one fail the way it fails in production.
 *
 * For suites that drive the registered tool over MCP with the real search
 * service, a real MapsRegistry and the real other-source search behind it,
 * and stub only the HttpClient and, where asked, a SearchProvider. Every
 * request the server makes is recorded, so a suite can tell which backend was
 * asked.
 *
 * The failures are the errors `http-client` throws: an `HttpError` for a
 * status, a `TypeError('fetch failed')` whose `cause` carries the system code
 * for a network error, a `DOMException` named `TimeoutError` for
 * `AbortSignal.timeout`, and a `SyntaxError` from `response.json()`.
 */

import { vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { registerSearchTool } from '../../src/core/tools/search.js';
import { MapsRegistry } from '../../src/core/services/maps-registry.js';
import { TopicResolver } from '../../src/core/services/topic-resolver.js';
import { HttpError, type HttpClient } from '../../src/core/http-client.js';
import type { MapsProvider, SearchProvider } from '../../src/core/services/interfaces/index.js';
import type {
  FtClusteredSearchResponse,
  FtMapInfo,
  FtMetadataEntry,
  FtSearchEntry,
  FtSearchRequest,
  SearchResult,
} from '../../src/core/types.js';
import type { ServerContext } from '../../src/core/types/context.js';
import { createMockContext, createMockCache } from './mock-context.js';

export const CLUSTERED_SEARCH = 'https://learn.jamf.com/api/khub/clustered-search';
export const MAPS_LIST = 'https://learn.jamf.com/api/khub/maps';
export const CONCEPTS_SITEMAP = 'https://concepts.jamf.com/sitemap.xml';

/**
 * Three live concepts.jamf.com pages (sitemap, 2026-09-27). Live, Fluid
 * Topics returned no result at all for "jamformer", while this page is titled
 * with it, so it is the case where the product documentation has nothing and
 * another source has the answer.
 */
const CONCEPTS_SITEMAP_XML = '<urlset>'
  + '<url><loc>https://concepts.jamf.com/en/concepts/jamformer</loc></url>'
  + '<url><loc>https://concepts.jamf.com/en/concepts/reenroller</loc></url>'
  + '<url><loc>https://concepts.jamf.com/en/concepts/setup-manager</loc></url>'
  + '</urlset>';

/** The other-source match each of those queries gets, as structuredContent carries it. */
export const CONCEPTS_MATCH = {
  jamformer: {
    // Lower case, as the site titles it (2026-09-28).
    title: 'jamformer',
    url: 'https://concepts.jamf.com/en/concepts/jamformer/',
    source: 'Jamf Concepts',
  },
  'setup manager': {
    title: 'Setup Manager',
    url: 'https://concepts.jamf.com/en/concepts/setup-manager/',
    source: 'Jamf Concepts',
  },
} as const;

function meta(entries: Record<string, string[]>): FtMetadataEntry[] {
  return Object.entries(entries).map(([key, values]) => ({ key, label: key, values }));
}

const PRO_MAP = 'A4LI4vM0BILraYeOD89WGg';

/** One live Jamf Pro topic (2026-09-26), trimmed to the fields the code reads. */
export const PRESTAGE: FtSearchEntry = {
  type: 'TOPIC',
  missingTerms: [],
  topic: {
    mapId: PRO_MAP,
    contentId: 'zGNgfc54eSb4O0Kk864Pkg',
    tocId: 'toc-zGNgfc54eSb4O0Kk864Pkg',
    title: 'Computer PreStage Enrollments',
    htmlTitle: 'Computer PreStage Enrollments',
    mapTitle: 'Jamf Pro Documentation 11.32.0',
    breadcrumb: ['Enrollment', 'Enrollment for Computers', 'Computer PreStage Enrollments'],
    htmlExcerpt: '<span class="kwicstring">Configure and deploy the </span>'
      + '<span class="kwicmatch">Setup Assistant</span>'
      + '<span class="kwicstring"> settings for computers.</span>',
    metadata: meta({
      'version': ['11.32.0'],
      'zoominmetadata': ['content-techdocs', 'product-pro', 'product-pro-11.32.0'],
      'ft:clusterId': ['jamf-pro-documentation-current/Computer_PreStage_Enrollments'],
      'ft:locale': ['en-US'],
      'jamf:portal': ['Jamf Pro'],
      'ft:prettyUrl': ['en-US/jamf-pro-documentation-current/Computer_PreStage_Enrollments'],
    }),
  },
};

/** The Jamf Pro documentation map, carrying the classification its topics carry. */
export const PRO_DOCUMENTATION_MAP: FtMapInfo = {
  id: PRO_MAP,
  title: 'Jamf Pro Documentation',
  mapApiEndpoint: `/api/khub/maps/${PRO_MAP}`,
  metadata: meta({
    'ft:locale': ['en-US'],
    'version_bundle_stem': ['jamf-pro-documentation'],
    'bundle': ['jamf-pro-documentation-current'],
    'jamf:portal': ['Jamf Pro'],
  }),
};

// ── The failures ────────────────────────────────────────────────────────────

/** What `http-client` throws for a response with this status from `url`. */
export function httpStatus(status: number, statusText: string, url = CLUSTERED_SEARCH): HttpError {
  return new HttpError(status, statusText, url);
}

/** What fetch throws when the connection is refused. */
export function connectionRefused(): TypeError {
  return new TypeError('fetch failed', {
    cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:443'), { code: 'ECONNREFUSED' }),
  });
}

/** What `AbortSignal.timeout` makes fetch throw. */
export function timedOut(): DOMException {
  return new DOMException('The operation was aborted due to timeout', 'TimeoutError');
}

/** What `response.json()` throws for a body that is not JSON. */
export function notJson(): SyntaxError {
  return new SyntaxError('Unexpected token \'<\', "<!DOCTYPE "... is not valid JSON');
}

/** A 200 whose body is `body`, whatever its shape: see {@link malformed}. */
export interface Malformed { malformed: unknown }

/** An answer with `body` for its whole body, such as `{}` where a list belongs. */
export function malformed(body: unknown): Malformed {
  return { malformed: body };
}

function isMalformed(value: unknown): value is Malformed {
  return typeof value === 'object' && value !== null && 'malformed' in value;
}

/** A provider failure that is not an Error: see {@link rejectsWith}. */
export interface Rejection { rejectsWith: unknown }

/** A provider that rejects with `value`, which an untyped one can: a string, `undefined`. */
export function rejectsWith(value: unknown): Rejection {
  return { rejectsWith: value };
}

function isRejection(value: unknown): value is Rejection {
  return typeof value === 'object' && value !== null && 'rejectsWith' in value;
}

// ── The harness ─────────────────────────────────────────────────────────────

export interface SearchUpstream {
  /**
   * What the clustered search answers each request with: its entries, the
   * error the request throws, or a malformed body. `call` counts from 0.
   * Unset, it finds nothing.
   */
  clusteredSearch?: (request: FtSearchRequest, call: number) => FtSearchEntry[] | Error | Malformed;
  /**
   * The maps list, the error fetching it throws, or a malformed body. Unset,
   * the Jamf Pro map alone.
   */
  maps?: FtMapInfo[] | Error | Malformed;
  /**
   * A MapsProvider the registry reads the maps list from instead of
   * learn.jamf.com: the maps it answers with, or the error it throws. Unset,
   * none is configured.
   */
  mapsProvider?: FtMapInfo[] | Error;
  /**
   * A SearchProvider that answers with these results, declines with `null`,
   * throws this error, or rejects with something that is not one. Unset,
   * none is configured.
   */
  provider?: SearchResult[] | null | Error | Rejection;
  /**
   * The SearchProvider answers, or throws, without a promise, as one on
   * untyped code can. The interface types `search` as async.
   */
  providerSync?: boolean;
}

export interface SearchHarness {
  ctx: ServerContext;
  /** Every request the server made, as `METHOD url`, in order. */
  requests: string[];
  providerCalls: () => number;
}

export function searchUpstream(upstream: SearchUpstream = {}): SearchHarness {
  const requests: string[] = [];
  const offline = (method: string, url: string): Error => new Error(`offline: no fixture for ${method} ${url}`);
  let searches = 0;

  const http: HttpClient = {
    getText: async (url) => {
      requests.push(`GET ${url}`);
      if (url === CONCEPTS_SITEMAP) { return await Promise.resolve(CONCEPTS_SITEMAP_XML); }
      throw offline('GET', url);
    },
    getJson: async <T>(url: string) => {
      requests.push(`GET ${url}`);
      if (url !== MAPS_LIST) { throw offline('GET', url); }
      const maps = upstream.maps ?? [PRO_DOCUMENTATION_MAP];
      if (maps instanceof Error) { throw maps; }
      return await Promise.resolve((isMalformed(maps) ? maps.malformed : maps) as T);
    },
    postJson: async <T>(url: string, body?: unknown) => {
      requests.push(`POST ${url}`);
      if (url !== CLUSTERED_SEARCH) { throw offline('POST', url); }
      const answer = upstream.clusteredSearch?.(body as FtSearchRequest, searches++) ?? [];
      if (answer instanceof Error) { throw answer; }
      if (isMalformed(answer)) { return await Promise.resolve(answer.malformed as T); }
      const response: FtClusteredSearchResponse = {
        facets: [],
        announcements: [],
        paging: { currentPage: 1, isLastPage: true, totalResultsCount: answer.length, totalClustersCount: answer.length },
        results: answer.map(entry => ({ metadataVariableAxis: 'version', entries: [entry] })),
      };
      return await Promise.resolve(response as T);
    },
  };

  const answer = (): SearchResult[] | null => {
    const { provider } = upstream;
    if (provider instanceof Error) { throw provider; }
    return isRejection(provider) ? null : provider ?? null;
  };
  const search = vi.fn<SearchProvider['search']>(upstream.providerSync === true
    ? answer as unknown as SearchProvider['search']
    : async () => await Promise.resolve().then(answer));
  if (isRejection(upstream.provider)) {
    search.mockRejectedValue(upstream.provider.rejectsWith);
  }

  const mapsProvider: MapsProvider | undefined = upstream.mapsProvider === undefined
    ? undefined
    : {
      getMaps: async () => {
        const maps = upstream.mapsProvider;
        if (maps instanceof Error) { throw maps; }
        return await Promise.resolve(maps ?? []);
      },
    };

  // Everything on the one recording client, so a request the registry or the
  // resolver made shows up in `requests` rather than in the no-network guard,
  // whose failure the tool would swallow.
  const cache = createMockCache();
  const mapsRegistry = new MapsRegistry(cache, undefined, mapsProvider, undefined, http);
  const topicResolver = new TopicResolver(mapsRegistry, cache, undefined, undefined, http);
  const ctx = createMockContext({
    cache, http, mapsRegistry, topicResolver,
    ...('provider' in upstream ? { searchProvider: { search } } : {}),
  });

  return { ctx, requests, providerCalls: () => search.mock.calls.length };
}

interface TextContent { type: 'text'; text: string }

export interface SearchReply {
  isError?: boolean;
  /** Every text content item, in order. */
  texts: string[];
  /** The first one, which is the whole reply unless a failed search found matches elsewhere. */
  text: string;
  structuredContent?: Record<string, unknown>;
  /** The tool's description, as `tools/list` serves it. */
  description: string;
}

/**
 * Call `jamf_docs_search` over MCP, as a client does.
 *
 * The client lists the tools first, so it checks every structuredContent
 * against the published outputSchema and throws on one that does not match.
 */
export async function callSearch(ctx: ServerContext, args: Record<string, unknown>): Promise<SearchReply> {
  const server = new McpServer({ name: 'test-server', version: '0.0.1' });
  registerSearchTool(server, ctx);
  const client = new Client({ name: 'test-client', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const { tools } = await client.listTools();
    const result = await client.callTool({ name: 'jamf_docs_search', arguments: args });
    const texts = (result.content as { type: string; text?: string }[])
      .filter((c): c is TextContent => c.type === 'text')
      .map(c => c.text);
    return {
      ...(result.isError !== undefined ? { isError: result.isError } : {}),
      texts,
      text: texts[0] ?? '',
      ...(result.structuredContent !== undefined
        ? { structuredContent: result.structuredContent as Record<string, unknown> }
        : {}),
      description: tools.find(t => t.name === 'jamf_docs_search')?.description ?? '',
    };
  } finally {
    await client.close();
    await server.close();
  }
}

/** The recorded requests to learn.jamf.com's clustered search. */
export function searchRequests(requests: string[]): string[] {
  return requests.filter(r => r === `POST ${CLUSTERED_SEARCH}`);
}
