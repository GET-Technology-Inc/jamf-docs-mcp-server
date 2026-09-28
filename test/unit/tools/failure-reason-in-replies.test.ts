/**
 * What `jamf_docs_get_toc`, `jamf_docs_get_article`,
 * `jamf_docs_batch_get_articles`, `jamf://products/{productId}/toc` and the
 * glossary's last-resort catch say when a provider or a request fails, and
 * the tool has no words of its own for it: over MCP, against a whole server
 * with a real MapsRegistry and only the http client stubbed.
 *
 * Until 2026-09-28 each quoted the error's message as it was. Measured
 * offline that day, before this change, with a provider that threw a
 * 40,000-character message of six lines, a markdown heading, a list item, a
 * file path and two stack lines among them:
 *
 *  - `get_toc` answered "Error fetching table of contents: KV failed\n\n#
 *    Injected heading\n- item\n…", 40,091 characters over six lines, and
 *    `get_article` 40,081. `batch_get_articles` quoted it for each url, 80,649
 *    characters of JSON for two. The glossary's catch, for a GlossaryProvider,
 *    40,129. Each had the file path removed and the stack lines kept out.
 *  - The TOC resource, whose handler had no catch, answered with the message
 *    as thrown: 40,173 characters, with the file path and both stack lines.
 *  - A provider that threw `new Error('')` got "Error fetching table of
 *    contents: ", with nothing after the colon, and the resource an empty
 *    error. A MapsProvider that rejected with `undefined` got "undefined", and
 *    with an object that is not an Error, "[object Object]"; any other
 *    provider, "Unknown error occurred".
 *  - A TocProvider that rejected with `undefined` or `null` got no answer from
 *    the TOC resource: the read waited until the client gave up. One that
 *    rejected with a string got "Internal error", and one that rejected with
 *    an object carrying a numeric `code` got that as the JSON-RPC error code.
 *  - A request that failed was quoted as the runtime worded it: "fetch
 *    failed" for a refused connection, "The operation was aborted due to
 *    timeout", "Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON",
 *    and "HTTP 404 : <url>", with a space before the colon, for a response
 *    with no status text, as learn.jamf.com's 404s have (live, 2026-09-28).
 *
 * Now a provider's reason is on one line, with file paths and stack lines
 * removed, and cut to 200 characters, as the search, the glossary and
 * list_products have quoted a provider's since #362, whatever the provider
 * threw: its own HttpError, SyntaxError or TimeoutError is its reason, not a
 * request of this server's (ProviderError). A failure that gives none says so;
 * a MapsProvider that threw is named, in the words those three use; and a
 * request of this server's is described as they describe one, with the
 * address an HttpError was sent to, which says which source failed. This
 * server's own messages go out whole, on one line: a support.jamf.com url in
 * one is up to 437 characters. And get_article's advice to wait follows a
 * 429, read from its status. Until 2026-09-28 it followed only a message that
 * said "rate limit", and a 429 of this server's reads "HTTP 429 Too Many
 * Requests: <url>".
 */

import { vi, describe, it, expect } from 'vitest';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createMcpServer } from '../../../src/core/create-server.js';
import { MapsRegistry } from '../../../src/core/services/maps-registry.js';
import { TopicResolver } from '../../../src/core/services/topic-resolver.js';
import { HttpError, type HttpClient } from '../../../src/core/http-client.js';
import { createMockCache, createMockContext } from '../../helpers/mock-context.js';
import { SUPPORT_NON_ASCII_ARTICLES } from '../../fixtures/support-non-ascii-articles.js';
import type { FtMapInfo } from '../../../src/core/types.js';
import type { ServerContext } from '../../../src/core/types/context.js';
import type {
  ArticleProvider,
  GlossaryProvider,
  TocProvider,
} from '../../../src/core/services/interfaces/index.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

const MAPS_LIST = 'https://learn.jamf.com/api/khub/maps';
const LEGACY_URL = 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation-current/page/Computer_PreStage_Enrollments.html';
const PRETTY_URL = 'https://learn.jamf.com/r/en-US/jamf-pro-documentation-current/Computer_PreStage_Enrollments';

const meta = (key: string, ...values: string[]): { key: string; label: string; values: string[] } =>
  ({ key, label: key, values });

const PRO_MAP: FtMapInfo = {
  id: 'A4LI4vM0BILraYeOD89WGg',
  title: 'Jamf Pro Documentation 11.32.0',
  mapApiEndpoint: '/api/khub/maps/A4LI4vM0BILraYeOD89WGg',
  metadata: [
    meta('version_bundle_stem', 'jamf-pro-documentation'),
    meta('bundle', 'jamf-pro-documentation-current'),
    meta('latestVersion', 'yes'),
    meta('ft:locale', 'en-US'),
    meta('jamf:portal', 'Jamf Pro'),
  ],
};

/**
 * A message a provider on another platform can throw: several lines, markdown
 * that would render in a reply, a file path, 8,000 more characters, and the
 * stack lines a runtime appends.
 */
function longFailure(): Error {
  return new Error(
    'KV failed\n\n# Injected heading\n- item\nENOENT: no such file or directory, open /srv/worker/secrets/toc.json\n' +
    `${'x'.repeat(8_000)}\n    at readToc (/srv/worker/index.js:12:3)\n    at async getToc (/srv/worker/index.js:40:9)`,
  );
}

/** What a reply quotes of {@link longFailure}: one line, no path, 199 characters and the ellipsis. */
const LONG_REASON =
  `${'KV failed # Injected heading - item ENOENT: no such file or directory, open <path> '.padEnd(199, 'x')}…`;

const NO_REASON = 'no reason was given';
const FROM_THE_PROVIDER = 'the list of documentation maps could not be read from the configured maps provider';

/**
 * A provider's own request failing, in the shapes this server's requests fail
 * with, and the reason a reply quotes: the provider's message, cut to 200
 * characters like any of its reasons, and never inside a `%XX` escape.
 */
const R2_TOC = 'https://r2.example.test/toc/jamf-pro.json';
const R2_ENCODED = `https://r2.example.test/toc/${'%E9%96%A2'.repeat(30)}`;
const PROVIDER_OWN_FAILURES: [string, () => unknown, string][] = [
  [
    'a SyntaxError',
    () => new SyntaxError('Unexpected token u in JSON at position 0 (KV value for toc:jamf-pro is corrupt)'),
    'Unexpected token u in JSON at position 0 (KV value for toc:jamf-pro is corrupt)',
  ],
  ['a TimeoutError', () => new DOMException('D1 query exceeded 30s', 'TimeoutError'), 'D1 query exceeded 30s'],
  [
    'fetch\'s TypeError',
    () => new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) }),
    'fetch failed',
  ],
  ['an HttpError', () => new HttpError(502, 'Bad Gateway', R2_TOC), `HTTP 502 Bad Gateway: ${R2_TOC}`],
  // 38 characters, then 17 whole escapes of 9: the 18th would end past 199.
  [
    'an HttpError with a long url',
    () => new HttpError(503, '', R2_ENCODED),
    `HTTP 503: https://r2.example.test/toc/${'%E9%96%A2'.repeat(17)}…`,
  ],
];

/** What a provider on untyped code can reject with, besides an Error with a message. */
const NO_REASON_FAILURES: [string, unknown][] = [
  ['an Error with no message', new Error('')],
  ['an Error whose message is blank', new Error(' \n\t ')],
  ['undefined', undefined],
  ['null', null],
  ['a blank string', '  '],
  ['an object that is not an Error', { code: 7 }],
];

// ── Harness ─────────────────────────────────────────────────────────────────

interface Upstream {
  /** What the MapsProvider's `getMaps` does. Unset, no MapsProvider is configured. */
  getMaps?: () => Promise<unknown>;
  /** What learn.jamf.com's maps list throws. Unset, it answers with the Jamf Pro map. */
  mapsError?: Error;
  tocProvider?: TocProvider;
  articleProvider?: ArticleProvider;
  glossaryProvider?: GlossaryProvider;
  /** What a support.jamf.com page answers with. Unset, it is offline too. */
  supportPage?: string;
}

function upstream(given: Upstream): ServerContext {
  const offline = (url: string): Error => new Error(`offline: no fixture for ${url}`);
  const http: HttpClient = {
    getJson: async <T>(url: string) => {
      if (url !== MAPS_LIST) { throw offline(url); }
      if (given.mapsError !== undefined) { throw given.mapsError; }
      return await Promise.resolve([PRO_MAP] as T);
    },
    getText: async (url) => {
      if (given.supportPage !== undefined && new URL(url).hostname === 'support.jamf.com') {
        return await Promise.resolve(given.supportPage);
      }
      throw offline(url);
    },
    postJson: async (url) => await Promise.reject(offline(url)),
  };
  const cache = createMockCache();
  const mapsRegistry = new MapsRegistry(
    cache, undefined, given.getMaps === undefined ? undefined : { getMaps: given.getMaps as () => Promise<FtMapInfo[]> },
    undefined, http,
  );
  const topicResolver = new TopicResolver(mapsRegistry, cache, undefined, undefined, http);
  return createMockContext({
    cache, http, mapsRegistry, topicResolver,
    ...(given.tocProvider !== undefined ? { tocProvider: given.tocProvider } : {}),
    ...(given.articleProvider !== undefined ? { articleProvider: given.articleProvider } : {}),
    ...(given.glossaryProvider !== undefined ? { glossaryProvider: given.glossaryProvider } : {}),
  });
}

const mapsProviderRejects = (failure: unknown): ServerContext =>
  upstream({ getMaps: vi.fn<() => Promise<unknown>>().mockRejectedValue(failure) });

const tocProviderRejects = (failure: unknown): ServerContext =>
  upstream({ tocProvider: { getTableOfContents: vi.fn<TocProvider['getTableOfContents']>().mockRejectedValue(failure) } });

const articleProviderRejects = (failure: unknown): ServerContext =>
  upstream({ articleProvider: { getArticleByIds: vi.fn<ArticleProvider['getArticleByIds']>().mockRejectedValue(failure) } });

const glossaryProviderRejects = (failure: unknown): ServerContext =>
  upstream({ glossaryProvider: { lookup: vi.fn<GlossaryProvider['lookup']>().mockRejectedValue(failure) } });

async function connect(ctx: ServerContext): Promise<{ client: Client; close: () => Promise<void> }> {
  const server = createMcpServer(ctx);
  const client = new Client({ name: 'test-client', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

interface Reply { isError?: boolean; text: string }

/** Call a tool over MCP, after listing the tools, as a host does. */
async function call(ctx: ServerContext, name: string, args: Record<string, unknown>): Promise<Reply> {
  const { client, close } = await connect(ctx);
  try {
    await client.listTools();
    const result = await client.callTool({ name, arguments: args });
    const text = (result.content as { type: string; text?: string }[])
      .map(c => c.text ?? '')
      .join('\n\n');
    return { ...(result.isError !== undefined ? { isError: result.isError } : {}), text };
  } finally {
    await close();
  }
}

/**
 * The error a resource read answered with, or undefined when it answered.
 * Five seconds, not the client's default minute, for an answer: a read the
 * server never answers fails as a timeout.
 */
async function readFailure(
  ctx: ServerContext,
  uri: string,
): Promise<{ message: string; code: unknown; data?: unknown } | undefined> {
  const { client, close } = await connect(ctx);
  try {
    await client.readResource({ uri }, { timeout: 5_000 });
    return undefined;
  } catch (error) {
    const { code, data } = error as { code?: unknown; data?: unknown };
    return {
      message: error instanceof Error ? error.message : String(error),
      code,
      ...(data !== undefined ? { data } : {}),
    };
  } finally {
    await close();
  }
}

/** The message of the error a resource read answered with, or undefined when it answered. */
async function readError(ctx: ServerContext, uri: string): Promise<string | undefined> {
  return (await readFailure(ctx, uri))?.message;
}

/** The error of each url in a JSON batch reply. */
function batchErrors(reply: Reply): (string | undefined)[] {
  const { results } = JSON.parse(reply.text) as { results: { error?: string }[] };
  return results.map(r => r.error);
}

/** The `**Error**:` lines of a markdown batch reply. */
function batchErrorLines(reply: Reply): string[] {
  return reply.text.split('\n').filter(line => line.startsWith('**Error**: '));
}

const TOC = 'Error fetching table of contents: ';
const ARTICLE = 'Error fetching article: ';

// ── A provider's reason ─────────────────────────────────────────────────────

describe('a provider\'s reason is on one line, without file paths, and cut to 200 characters', () => {
  it('jamf_docs_get_toc and the TOC resource, from a TocProvider', async () => {
    const reply = await call(tocProviderRejects(longFailure()), 'jamf_docs_get_toc', { product: 'jamf-pro' });
    const error = await readError(tocProviderRejects(longFailure()), 'jamf://products/jamf-pro/toc');

    expect(reply.isError).toBe(true);
    expect(reply.text).toBe(`${TOC}${LONG_REASON}`);
    // The resource removed nothing: the path and both stack lines went out.
    expect(error).toBe(`${TOC}${LONG_REASON}`);
  });

  it('jamf_docs_get_article, from an ArticleProvider', async () => {
    const reply = await call(articleProviderRejects(longFailure()), 'jamf_docs_get_article', {
      mapId: PRO_MAP.id, contentId: 'some-topic',
    });

    expect(reply.isError).toBe(true);
    expect(reply.text).toBe(`${ARTICLE}${LONG_REASON}`);
  });

  it('every reader of the maps list, from a MapsProvider, which it names', async () => {
    const expected = `${FROM_THE_PROVIDER} (${LONG_REASON})`;

    const toc = await call(mapsProviderRejects(longFailure()), 'jamf_docs_get_toc', { product: 'jamf-pro' });
    const article = await call(mapsProviderRejects(longFailure()), 'jamf_docs_get_article', { url: PRETTY_URL });
    const json = await call(mapsProviderRejects(longFailure()), 'jamf_docs_batch_get_articles', {
      urls: [LEGACY_URL, PRETTY_URL], responseFormat: 'json',
    });
    const markdown = await call(mapsProviderRejects(longFailure()), 'jamf_docs_batch_get_articles', {
      urls: [LEGACY_URL, PRETTY_URL],
    });
    const resource = await readError(mapsProviderRejects(longFailure()), 'jamf://products/jamf-pro/toc');

    expect(toc.text).toBe(`${TOC}${expected}`);
    expect(article.text).toBe(`${ARTICLE}${expected}`);
    expect(batchErrors(json)).toEqual([expected, expected]);
    // Each url's error is one line of the markdown, so nothing it quotes renders as markdown.
    expect(batchErrorLines(markdown)).toEqual([`**Error**: ${expected}`, `**Error**: ${expected}`]);
    expect(markdown.text).not.toContain('\n# Injected heading');
    expect(resource).toBe(`${TOC}${expected}`);
  });

  it('the glossary\'s last-resort catch, from a GlossaryProvider', async () => {
    const reply = await call(glossaryProviderRejects(longFailure()), 'jamf_docs_glossary_lookup', { term: 'MDM' });

    expect(reply.isError).toBe(true);
    expect(reply.text).toBe(
      `Glossary lookup error: ${LONG_REASON}\n\nPlease try again or use different search terms.`,
    );
  });

  it('a short reason on one line is quoted as it is', async () => {
    const reply = await call(tocProviderRejects(new Error('KV namespace unavailable')), 'jamf_docs_get_toc', {
      product: 'jamf-pro',
    });

    expect(reply.text).toBe(`${TOC}KV namespace unavailable`);
  });
});

// ── No reason ───────────────────────────────────────────────────────────────

describe('a failure that gives no reason says so, instead of nothing after the colon', () => {
  it.each(NO_REASON_FAILURES)('a TocProvider that rejects with %s', async (_label, failure) => {
    const reply = await call(tocProviderRejects(failure), 'jamf_docs_get_toc', { product: 'jamf-pro' });
    const error = await readError(tocProviderRejects(failure), 'jamf://products/jamf-pro/toc');

    expect(reply.text).toBe(`${TOC}${NO_REASON}`);
    expect(error).toBe(`${TOC}${NO_REASON}`);
  });

  it.each(NO_REASON_FAILURES)('an ArticleProvider that rejects with %s', async (_label, failure) => {
    const reply = await call(articleProviderRejects(failure), 'jamf_docs_get_article', {
      mapId: PRO_MAP.id, contentId: 'some-topic',
    });

    expect(reply.text).toBe(`${ARTICLE}${NO_REASON}`);
  });

  it.each(NO_REASON_FAILURES)('a GlossaryProvider that rejects with %s', async (_label, failure) => {
    const reply = await call(glossaryProviderRejects(failure), 'jamf_docs_glossary_lookup', { term: 'MDM' });

    expect(reply.text).toBe(`Glossary lookup error: ${NO_REASON}\n\nPlease try again or use different search terms.`);
  });

  it.each(NO_REASON_FAILURES)('a MapsProvider that rejects with %s', async (_label, failure) => {
    const expected = `${FROM_THE_PROVIDER}, which gave no reason`;

    const toc = await call(mapsProviderRejects(failure), 'jamf_docs_get_toc', { product: 'jamf-pro' });
    const article = await call(mapsProviderRejects(failure), 'jamf_docs_get_article', { url: LEGACY_URL });
    const batch = await call(mapsProviderRejects(failure), 'jamf_docs_batch_get_articles', {
      urls: [LEGACY_URL], responseFormat: 'json',
    });
    const resource = await readError(mapsProviderRejects(failure), 'jamf://products/jamf-pro/toc');

    expect(toc.text).toBe(`${TOC}${expected}`);
    expect(article.text).toBe(`${ARTICLE}${expected}`);
    expect(batchErrors(batch)).toEqual([expected]);
    expect(resource).toBe(`${TOC}${expected}`);
  });
});

// ── The TOC resource ────────────────────────────────────────────────────────

describe('the TOC resource answers a provider\'s failure with an internal error of its own', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
  ])('a TocProvider that rejects with %s gets an answer, not a timeout', async (_label, failure) => {
    const answered = await readFailure(tocProviderRejects(failure), 'jamf://products/jamf-pro/toc');

    expect(answered).toEqual({ message: `${TOC}${NO_REASON}`, code: -32603 });
  });

  it('a provider\'s error with a numeric `code` and a `data` sets neither on the JSON-RPC error', async () => {
    const failure = Object.assign(new Error('quota exceeded'), { code: 10_013, data: { account: 'acct-7' } });

    const answered = await readFailure(tocProviderRejects(failure), 'jamf://products/jamf-pro/toc');

    // toStrictEqual: a `data` key, even undefined, fails it.
    expect(answered).toStrictEqual({ message: `${TOC}quota exceeded`, code: -32603 });
  });
});

// ── A request that failed ───────────────────────────────────────────────────

describe('a request that failed is described as the search and the glossary describe one', () => {
  const refused = (): TypeError => new TypeError('fetch failed', {
    cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
  });
  const timedOut = (): DOMException => new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  const notJson = (): SyntaxError => new SyntaxError('Unexpected token \'<\', "<!DOCTYPE "... is not valid JSON');

  it.each([
    ['a refused connection', refused, 'a network error: ECONNREFUSED'],
    ['a timeout', timedOut, 'the request timed out'],
    ['a body that is not JSON', notJson, 'a response that was not valid JSON'],
    // An HttpError keeps the address it was sent to, which says which source
    // failed, as it did: its message ended in it.
    ['an HTTP 503', () => new HttpError(503, 'Service Unavailable', MAPS_LIST), `HTTP 503 Service Unavailable: ${MAPS_LIST}`],
    ['an HTTP 503 with no status text', () => new HttpError(503, '', MAPS_LIST), `HTTP 503: ${MAPS_LIST}`],
  ])('the maps list failing with %s', async (_label, mapsError, expected) => {
    const toc = await call(upstream({ mapsError: mapsError() }), 'jamf_docs_get_toc', { product: 'jamf-pro' });
    const article = await call(upstream({ mapsError: mapsError() }), 'jamf_docs_get_article', { url: PRETTY_URL });
    const batch = await call(upstream({ mapsError: mapsError() }), 'jamf_docs_batch_get_articles', {
      urls: [LEGACY_URL], responseFormat: 'json',
    });
    const resource = await readError(upstream({ mapsError: mapsError() }), 'jamf://products/jamf-pro/toc');

    expect(toc.text).toBe(`${TOC}${expected}`);
    expect(article.text).toBe(`${ARTICLE}${expected}`);
    expect(batchErrors(batch)).toEqual([expected]);
    expect(resource).toBe(`${TOC}${expected}`);
  });

  it('a 404 still gets get_article\'s advice', async () => {
    const reply = await call(upstream({ mapsError: new HttpError(404, 'Not Found', MAPS_LIST) }),
      'jamf_docs_get_article', { url: PRETTY_URL });

    expect(reply.text).toBe(
      `${ARTICLE}HTTP 404 Not Found: ${MAPS_LIST}\n\n` +
      'The article may have been moved or deleted. Try searching with `jamf_docs_search` to find the current URL.',
    );
  });
});

// ── A provider's own request ────────────────────────────────────────────────

describe('a provider\'s own request failure is its reason, not a request of this server\'s', () => {
  it.each(PROVIDER_OWN_FAILURES)('a TocProvider that throws %s: get_toc and the TOC resource', async (_label, failure, reason) => {
    const reply = await call(tocProviderRejects(failure()), 'jamf_docs_get_toc', { product: 'jamf-pro' });
    const error = await readError(tocProviderRejects(failure()), 'jamf://products/jamf-pro/toc');

    expect(reply.text).toBe(`${TOC}${reason}`);
    expect(error).toBe(`${TOC}${reason}`);
  });

  it.each(PROVIDER_OWN_FAILURES)('an ArticleProvider whose getArticleByIds throws %s', async (_label, failure, reason) => {
    const reply = await call(articleProviderRejects(failure()), 'jamf_docs_get_article', {
      mapId: PRO_MAP.id, contentId: 'some-topic',
    });

    expect(reply.text).toBe(`${ARTICLE}${reason}`);
  });

  it.each(PROVIDER_OWN_FAILURES)('an ArticleProvider whose getArticle throws %s', async (_label, failure, reason) => {
    const getArticle = vi.fn<NonNullable<ArticleProvider['getArticle']>>().mockRejectedValue(failure());
    const ctx = upstream({
      articleProvider: { getArticleByIds: vi.fn<ArticleProvider['getArticleByIds']>().mockResolvedValue(null), getArticle },
    });

    const reply = await call(ctx, 'jamf_docs_get_article', { mapId: PRO_MAP.id, contentId: 'some-topic', url: PRETTY_URL });

    expect(getArticle).toHaveBeenCalledOnce();
    expect(reply.text).toBe(`${ARTICLE}${reason}`);
  });

  it.each(PROVIDER_OWN_FAILURES)('a GlossaryProvider that throws %s', async (_label, failure, reason) => {
    const reply = await call(glossaryProviderRejects(failure()), 'jamf_docs_glossary_lookup', { term: 'MDM' });

    expect(reply.text).toBe(`Glossary lookup error: ${reason}\n\nPlease try again or use different search terms.`);
  });
});

// ── This server's own message ───────────────────────────────────────────────

describe('this server\'s own message is quoted whole, on one line', () => {
  /** The longest of the captured ja and zh-TW support.jamf.com articles, as a request spells its url. */
  const LONGEST = SUPPORT_NON_ASCII_ARTICLES
    .map(article => new URL(`https://support.jamf.com${article.listed}`).href)
    .reduce((longest, url) => (url.length > longest.length ? url : longest));
  const OWN = `Could not read a Jamf Support Knowledge Base article at ${LONGEST}`;
  /** A page with no `__NEXT_DATA__`, as a maintenance page has none. */
  const MAINTENANCE = '<html><body><h1>We will be back soon</h1></body></html>';

  it('a support.jamf.com article whose page cannot be read, at a url of 381 characters', async () => {
    const article = await call(upstream({ supportPage: MAINTENANCE }), 'jamf_docs_get_article', { url: LONGEST });
    const batch = await call(upstream({ supportPage: MAINTENANCE }), 'jamf_docs_batch_get_articles', {
      urls: [LONGEST], responseFormat: 'json',
    });

    expect(LONGEST).toHaveLength(381);
    expect(OWN).toHaveLength(437);
    expect(article.text).toBe(`${ARTICLE}${OWN}`);
    expect(batchErrors(batch)).toEqual([OWN]);
  });
});

// ── get_article's advice for a 429 ──────────────────────────────────────────

describe('get_article\'s advice to wait follows a 429, read from its status', () => {
  const WAIT = '\n\nPlease wait a moment and try again.';

  it.each([
    ['with status text', 'Too Many Requests', `HTTP 429 Too Many Requests: ${MAPS_LIST}`],
    ['without', '', `HTTP 429: ${MAPS_LIST}`],
  ])('the maps list answering 429, %s', async (_label, statusText, reason) => {
    const reply = await call(upstream({ mapsError: new HttpError(429, statusText, MAPS_LIST) }),
      'jamf_docs_get_article', { url: PRETTY_URL });

    expect(reply.text).toBe(`${ARTICLE}${reason}${WAIT}`);
  });

  it('an ArticleProvider\'s own 429', async () => {
    const reply = await call(articleProviderRejects(new HttpError(429, '', R2_TOC)),
      'jamf_docs_get_article', { mapId: PRO_MAP.id, contentId: 'some-topic' });

    expect(reply.text).toBe(`${ARTICLE}HTTP 429: ${R2_TOC}${WAIT}`);
  });

  it('not another status, whatever its url says', async () => {
    const reply = await call(articleProviderRejects(new HttpError(503, '', `${R2_TOC}?retry=429`)),
      'jamf_docs_get_article', { mapId: PRO_MAP.id, contentId: 'some-topic' });

    expect(reply.text).toBe(`${ARTICLE}HTTP 503: ${R2_TOC}?retry=429`);
  });
});
