/**
 * `jamf_docs_get_article` and `jamf_docs_batch_get_articles` with an
 * `ArticleProvider` injected: the same call gets the same answer as without
 * one. A provider changes where the bytes come from, not which of the caller's
 * arguments decide or what the caller is told about them.
 *
 * Until #332 and #333 it changed both, silently, in step 2 of
 * `resolveAndFetchArticle`, the provider short-circuit:
 *
 *   1. #332. With a url and a `mapId` + `contentId` pair, a provider with
 *      nothing under the pair was asked for the url, and the pair's ids were
 *      stamped on whatever it returned. The LAPS search triple, whose url two
 *      topics share, came back as "Using LAPS in the Jamf Pro API" under the
 *      ids of "Use LAPS". Without a provider the pair decides. The same went
 *      for an older version's pair with a `-current` url, and for a url whose
 *      lookup `language` moved: the page for the url was the answer.
 *   2. #333. The three notes that say an argument went unused were built only
 *      in step 3, so no reply a provider answered carried one. Nor could a
 *      provider add them: `getArticleByIds` got identical arguments for calls
 *      whose correct notes differ (A and A0, C and C0 below).
 *
 * So every case here calls the registered tools on two servers, identical but
 * for the provider, and compares what a client reads: the markdown or JSON text
 * and `structuredContent`. The fixtures, in test/helpers/article-upstream.ts,
 * are get-article-addressing.test.ts's, whose no-provider cases pin what the
 * right answer is.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';

vi.mock('../../../src/core/http-client.js', async () => {
  const actual = await import('../../../src/core/http-client.js');
  return {
    ...actual,
    httpGetJson: vi.fn(),
    httpGetText: vi.fn(),
    httpPostJson: vi.fn(),
  };
});

import { McpServer } from '@modelcontextprotocol/server';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { httpGetJson, httpGetText } from '../../../src/core/http-client.js';
import { registerGetArticleTool } from '../../../src/core/tools/get-article.js';
import { registerBatchGetArticlesTool } from '../../../src/core/tools/batch-get-articles.js';
import { fetchArticleFromFt } from '../../../src/core/services/article-service.js';
import { estimateTokens } from '../../../src/core/services/tokenizer.js';
import { createMockCache, createMockContext, createTestHttpClient } from '../../helpers/mock-context.js';
import { omitKey } from '../../helpers/fixtures.js';
import {
  CCP, CCP_HTML, CCP_URL, LAPS_API, LAPS_MAP, POLICIES, POLICIES_URL, PRO_MAP, PRO_MAP_PREVIOUS, USE_LAPS,
  USING_LAPS_URL, articleUpstream, resolveFixtureUrl,
} from '../../helpers/article-upstream.js';
import type { ServerContext } from '../../../src/core/types/context.js';
import type { ArticleProvider } from '../../../src/core/services/interfaces/providers.js';
import type { FetchArticleResult, TokenInfo } from '../../../src/core/types.js';

const mockedGetJson = vi.mocked(httpGetJson);
const mockedGetText = vi.mocked(httpGetText);

/** Serve the fixtures, with `bodies` over the default topic bodies. */
function route(bodies: Record<string, string> = {}): void {
  const upstream = articleUpstream(bodies);
  mockedGetJson.mockImplementation(upstream.getJson);
  mockedGetText.mockImplementation(upstream.getText);
}

// ── Harness ─────────────────────────────────────────────────────────────────

interface TextContent { type: 'text'; text: string }
type Args = Record<string, unknown>;
interface Reply { text: string; sc: Record<string, unknown> }

/** Without a provider: the reference answer. */
let plain: Client;
let plainCtx: ServerContext;
/** The same server, with whichever provider the case sets on its ctx. */
let provided: Client;
let providedCtx: ServerContext;

async function serve(ctx: ServerContext): Promise<Client> {
  const server = new McpServer({ name: 'test-server', version: '0.0.1' });
  registerGetArticleTool(server, ctx);
  registerBatchGetArticlesTool(server, ctx);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.1' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

beforeAll(async () => {
  plainCtx = createMockContext();
  providedCtx = createMockContext();
  for (const ctx of [plainCtx, providedCtx]) {
    ctx.topicResolver.resolve = vi.fn(resolveFixtureUrl);
  }
  plain = await serve(plainCtx);
  provided = await serve(providedCtx);
});

afterAll(async () => {
  await plain.close();
  await provided.close();
});

beforeEach(async () => {
  vi.clearAllMocks();
  delete providedCtx.articleProvider;
  // Each case starts cold, so no answer is a cached one from an earlier case.
  await plainCtx.cache.clear();
  await providedCtx.cache.clear();
  route();
});

async function call(client: Client, args: Args, tool = 'jamf_docs_get_article'): Promise<Reply> {
  const result = await client.callTool({ name: tool, arguments: args });
  return {
    text: (result.content[0] as TextContent).text,
    sc: (result.structuredContent ?? {}) as Record<string, unknown>,
  };
}

/** The same call on both servers. */
async function both(args: Args, tool?: string): Promise<{ without: Reply; with: Reply }> {
  return { without: await call(plain, args, tool), with: await call(provided, args, tool) };
}

function occurrences(text: string, part: string): number {
  return text.split(part).length - 1;
}

// ── Providers ───────────────────────────────────────────────────────────────

/**
 * Holds exactly what core's own fetch builds for a pair, and passes on the
 * options it is given — `noteFor` among them. It is not told the caller's url,
 * so it passes `''`, as any `getArticleByIds` would have to.
 */
function faithfulProvider(): ArticleProvider {
  return {
    getArticleByIds: vi.fn<ArticleProvider['getArticleByIds']>(async (mapId, contentId, options) =>
      await fetchArticleFromFt(createMockCache(), mapId, contentId, '', {
        ...options, http: createTestHttpClient(),
      })),
  };
}

/** The same, written before `noteFor` existed: it passes on only the options it knows. */
function unawareProvider(): ArticleProvider {
  return {
    getArticleByIds: vi.fn<ArticleProvider['getArticleByIds']>(async (mapId, contentId, options = {}) =>
      await fetchArticleFromFt(createMockCache(), mapId, contentId, '', {
        ...omitKey(options, 'noteFor'), http: createTestHttpClient(),
      })),
  };
}

/** A page as a cache keyed by url holds it: under its own ids, when it has them. */
function storedPage(
  url: string,
  title: string,
  ids?: { mapId: string; contentId: string },
  content = `BODY OF "${title}".`,
): FetchArticleResult {
  return {
    title, url, ...ids, content, sections: [],
    tokenInfo: { tokenCount: estimateTokens(content), truncated: false, maxTokens: 5000 },
  };
}

/** Nothing under any pair; `pages` by their url. */
function urlKeyedProvider(pages: FetchArticleResult[]): ArticleProvider {
  const byUrl = new Map(pages.map(page => [page.url, page]));
  return {
    getArticleByIds: vi.fn<ArticleProvider['getArticleByIds']>().mockResolvedValue(null),
    getArticle: vi.fn<NonNullable<ArticleProvider['getArticle']>>(async (url) => {
      await Promise.resolve();
      return byUrl.get(url) ?? null;
    }),
  };
}

// ── Cases ───────────────────────────────────────────────────────────────────

/** #333's repro, and two more: each call, and what its note says (`undefined` for none). */
const CASES: [string, Args, string | undefined][] = [
  ['A: a url and a pair it does not match', { url: POLICIES_URL, mapId: PRO_MAP, contentId: CCP },
    'The url passed with them does not match its address and was not used'],
  ['A0: the same pair alone', { mapId: PRO_MAP, contentId: CCP }, undefined],
  ['B: a pair and `language`', { mapId: PRO_MAP, contentId: CCP, language: 'ja-JP' },
    '`language` has no effect on a mapId + contentId pair: this article comes from the pair\'s map, which is "en-US".'],
  ['C: a url and a `language` with no map of its own', { url: POLICIES_URL, language: 'th-TH' },
    'Language "th-TH" was requested but this article was resolved from a "en-US" URL.'],
  ['C0: a pair and that `language`', { mapId: PRO_MAP, contentId: POLICIES, language: 'th-TH' },
    '`language` has no effect on a mapId + contentId pair: this article comes from the pair\'s map, which is "en-US".'],
  // Both pair notes at once: the longest note there is, and the tightest fit at maxTokens 100.
  ['A and B together', { url: POLICIES_URL, mapId: PRO_MAP, contentId: CCP, language: 'ja-JP' },
    'fetch follows the pair. Language "ja-JP" was requested, but `language` has no effect'],
  ['the LAPS search triple, whose url is its own', { url: USING_LAPS_URL, mapId: LAPS_MAP, contentId: USE_LAPS }, undefined],
];

const NOTED = CASES.filter((c): c is [string, Args, string] => c[2] !== undefined);

const SHAPES: [string, Args][] = [
  ['markdown', {}],
  ['json', { responseFormat: 'json' }],
  ['compact', { outputMode: 'compact' }],
  ['summaryOnly', { summaryOnly: true }],
  ['a missed section', { section: 'Nonexistent Zzz' }],
  ['maxTokens 100', { maxTokens: 100 }],
  // Where the note has to be known before the reply is laid out: an outline or
  // a list of sub-topics cut to fit keeps its closing count only if it was.
  ['summaryOnly at maxTokens 100', { summaryOnly: true, maxTokens: 100 }],
  ['a missed section at maxTokens 100', { section: 'Nonexistent Zzz', maxTokens: 100 }],
];

// ── #333: notes ─────────────────────────────────────────────────────────────

describe('get_article with a provider that renders through core', () => {
  describe.each(CASES)('%s', (_name, args, note) => {
    it.each(SHAPES)('gets the reply it gets without a provider, note included: %s', async (_shape, shape) => {
      const provider = faithfulProvider();
      providedCtx.articleProvider = provider;

      const { without, with: withProvider } = await both({ ...args, ...shape });

      // The provider answered: otherwise the two replies agree trivially.
      expect(provider.getArticleByIds).toHaveBeenCalledTimes(1);
      expect(withProvider.text).toBe(without.text);
      expect(withProvider.sc).toEqual(without.sc);
      if (note === undefined) {
        expect(without.sc.content).not.toContain('Note:');
      } else if (shape.outputMode === undefined) {
        // A compact preview may stop before the note; the other shapes carry it.
        expect(without.sc.content).toContain(note);
      }
    });
  });

  it.each(NOTED)('%s: keeps the reply within maxTokens, note and all', async (_name, args, note) => {
    providedCtx.articleProvider = faithfulProvider();

    const { sc } = await call(provided, { ...args, maxTokens: 100 });

    expect(sc.content).toContain(note);
    expect(sc.tokenCount).toBe(estimateTokens(sc.content as string));
    expect(sc.tokenCount).toBeLessThanOrEqual(100);
  });
});

describe('get_article with a provider that does not pass `noteFor` on', () => {
  it.each(CASES)('%s: gets the reply it gets without a provider, core\'s note added once', async (_name, args, note) => {
    providedCtx.articleProvider = unawareProvider();

    const { without, with: withProvider } = await both(args);

    expect(withProvider.text).toBe(without.text);
    expect(withProvider.sc).toEqual(without.sc);
    if (note !== undefined) {
      expect(occurrences(withProvider.text, note)).toBe(1);
    }
  });

  it.each(NOTED)('%s: at maxTokens 100, cuts the provider\'s reply to make room for the note', async (_name, args, note) => {
    // Every body too long for 100 tokens, so the provider fills the budget.
    route({ [POLICIES]: CCP_HTML });
    providedCtx.articleProvider = unawareProvider();

    const { text, sc } = await call(provided, { ...args, maxTokens: 100 });

    expect(occurrences(text, note)).toBe(1);
    expect(sc.content).toMatch(/\n\n---\n\*Note: .*\*\n$/);
    expect(sc.tokenCount).toBe(estimateTokens(sc.content as string));
    expect(sc.tokenCount).toBeLessThanOrEqual(100);
    expect(sc.truncated).toBe(true);
    expect(text).toMatch(/\*\*Tokens\*\*: \d+\/100 \| \*\(truncated\)\*/);
  });

  it('marks the reply truncated when it is the note that made it too long', async () => {
    // Fits maxTokens on its own, so the provider did not cut it and says so.
    const content = 'A line of a page a provider rendered itself.\n'.repeat(8);
    providedCtx.articleProvider = {
      getArticleByIds: vi.fn<ArticleProvider['getArticleByIds']>().mockResolvedValue(
        storedPage(POLICIES_URL, 'Policies', { mapId: PRO_MAP, contentId: POLICIES }, content),
      ),
    };
    expect(estimateTokens(content)).toBeLessThanOrEqual(100);

    const { text, sc } = await call(provided, { url: POLICIES_URL, language: 'th-TH', maxTokens: 100 });

    expect(occurrences(text, 'resolved from a "en-US" URL')).toBe(1);
    expect(sc.tokenCount).toBe(estimateTokens(sc.content as string));
    expect(sc.tokenCount).toBeLessThanOrEqual(100);
    expect(sc.truncated).toBe(true);
  });

  it('does not add a note the provider already ended its reply with', async () => {
    // The one known consumer keeps a verbatim copy of the url + `language`
    // sentence and prints it itself.
    const sentence = 'Language "th-TH" was requested but this article was resolved from a "en-US" URL.'
      + ' Content may be in the original language if a localized version is unavailable.';
    const inner = unawareProvider();
    providedCtx.articleProvider = {
      getArticleByIds: async (mapId, contentId, options) => {
        const article = await inner.getArticleByIds(mapId, contentId, options);
        return article === null ? null : { ...article, content: `${article.content}\n\n---\n*Note: ${sentence}*\n` };
      },
    };

    const { without, with: withProvider } = await both({ url: POLICIES_URL, language: 'th-TH' });

    expect(occurrences(withProvider.text, sentence)).toBe(1);
    expect(withProvider.sc.content).toBe(without.sc.content);
  });
});

// ── batch_get_articles ──────────────────────────────────────────────────────

describe('batch_get_articles with a provider', () => {
  const URL_AND_LANGUAGE = { urls: [POLICIES_URL], language: 'th-TH' };

  it('carries the url + `language` note on a provider\'s article, as it does without one', async () => {
    const provider = faithfulProvider();
    providedCtx.articleProvider = provider;

    const { without, with: withProvider } = await both(URL_AND_LANGUAGE, 'jamf_docs_batch_get_articles');

    expect(provider.getArticleByIds).toHaveBeenCalledTimes(1);
    expect(without.text).toContain('resolved from a "en-US" URL');
    expect(withProvider.text).toBe(without.text);
    expect(withProvider.sc).toEqual(without.sc);
  });

  it('and from a provider that does not pass `noteFor` on, within the article\'s share', async () => {
    route({ [POLICIES]: CCP_HTML });
    providedCtx.articleProvider = unawareProvider();

    const { text } = await call(
      provided, { ...URL_AND_LANGUAGE, maxTokens: 100, responseFormat: 'json' }, 'jamf_docs_batch_get_articles',
    );
    const [article] = (JSON.parse(text) as { results: { content: string; tokenInfo: TokenInfo }[] }).results;

    expect(occurrences(article.content, 'resolved from a "en-US" URL')).toBe(1);
    expect(article.tokenInfo.tokenCount).toBe(estimateTokens(article.content));
    expect(article.tokenInfo.tokenCount).toBeLessThanOrEqual(100);
  });
});

// ── #332: the pair decides ──────────────────────────────────────────────────

describe('get_article with a url, a pair, and a provider keyed by url', () => {
  it('answers the LAPS search triple with "Use LAPS", not the child its url also names', async () => {
    // Live on 2026-09-26: `…/Using_LAPS` alone resolves to the child, so that
    // is the page a cache keyed by url holds there.
    providedCtx.articleProvider = urlKeyedProvider([
      storedPage(USING_LAPS_URL, 'Using LAPS in the Jamf Pro API', { mapId: LAPS_MAP, contentId: LAPS_API }),
    ]);

    const { without, with: withProvider } = await both({ url: USING_LAPS_URL, mapId: LAPS_MAP, contentId: USE_LAPS });

    expect(withProvider.sc.title).toBe('Use LAPS');
    expect(withProvider.sc.contentId).toBe(USE_LAPS);
    expect(withProvider.text).not.toContain('BODY OF');
    expect(withProvider.text).toBe(without.text);
    expect(withProvider.sc).toEqual(without.sc);
  });

  it('answers a url and a pair it does not match with the pair\'s article, and says so', async () => {
    providedCtx.articleProvider = urlKeyedProvider([
      storedPage(POLICIES_URL, 'Policies', { mapId: PRO_MAP, contentId: POLICIES }),
    ]);

    const { without, with: withProvider } = await both({ url: POLICIES_URL, mapId: PRO_MAP, contentId: CCP });

    expect(withProvider.sc.title).toBe('Computer Configuration Profiles');
    expect(withProvider.text).toContain('was not used');
    expect(withProvider.text).toBe(without.text);
    expect(withProvider.sc).toEqual(without.sc);
  });

  it('answers an older version\'s pair with that version, not the page its `-current` url names', async () => {
    // Policies keeps its contentId from 11.31 to 11.32, so the url's page
    // carries the pair's contentId; only the mapId says it is the wrong one.
    providedCtx.articleProvider = urlKeyedProvider([
      storedPage(POLICIES_URL, 'Policies', { mapId: PRO_MAP, contentId: POLICIES }),
    ]);

    const { without, with: withProvider } = await both({ url: POLICIES_URL, mapId: PRO_MAP_PREVIOUS, contentId: POLICIES });

    expect(withProvider.sc.mapId).toBe(PRO_MAP_PREVIOUS);
    expect(withProvider.sc.version).toBe('11.31.0');
    expect(withProvider.text).not.toContain('BODY OF');
    expect(withProvider.text).toBe(without.text);
    expect(withProvider.sc).toEqual(without.sc);
  });

  it('still answers from the url when the page there is the pair\'s own', async () => {
    // In 46 of 48 sampled search results (#322) the url and the pair name the
    // same topic, and a url-keyed provider should go on serving those.
    providedCtx.articleProvider = urlKeyedProvider([
      storedPage(CCP_URL, 'Computer Configuration Profiles', { mapId: PRO_MAP, contentId: CCP }),
    ]);

    const { text, sc } = await call(provided, { url: CCP_URL, mapId: PRO_MAP, contentId: CCP });

    expect(text).toContain('BODY OF "Computer Configuration Profiles".');
    expect(sc.contentId).toBe(CCP);
    expect(text).not.toContain('Note:');
    expect(mockedGetText).not.toHaveBeenCalled();
  });

  it('does not use a page that carries no ids, since it cannot be checked against the pair', async () => {
    providedCtx.articleProvider = urlKeyedProvider([storedPage(POLICIES_URL, 'Policies')]);

    const { without, with: withProvider } = await both({ url: POLICIES_URL, mapId: PRO_MAP, contentId: POLICIES });

    expect(withProvider.text).not.toContain('BODY OF');
    expect(withProvider.text).toBe(without.text);
    expect(withProvider.sc).toEqual(without.sc);
  });
});

describe('get_article with a url alone and a provider keyed by url', () => {
  it.each([
    ['carrying its ids', { mapId: PRO_MAP, contentId: CCP }],
    ['carrying none', undefined],
  ])('answers from the url\'s page, %s, when the url alone chose the topic', async (_name, ids) => {
    providedCtx.articleProvider = urlKeyedProvider([storedPage(CCP_URL, 'Computer Configuration Profiles', ids)]);

    const { text, sc } = await call(provided, { url: CCP_URL });

    expect(text).toContain('BODY OF "Computer Configuration Profiles".');
    expect(sc.mapId).toBe(PRO_MAP);
    expect(sc.contentId).toBe(CCP);
    expect(mockedGetText).not.toHaveBeenCalled();
  });

  it('answers the LAPS url with the topic it resolves to, not another the provider holds there', async () => {
    // A url-keyed provider that stored the parent under the shared slug.
    providedCtx.articleProvider = urlKeyedProvider([
      storedPage(USING_LAPS_URL, 'Use LAPS', { mapId: LAPS_MAP, contentId: USE_LAPS }),
    ]);

    const { without, with: withProvider } = await both({ url: USING_LAPS_URL });

    expect(withProvider.sc.title).toBe('Using LAPS in the Jamf Pro API');
    expect(withProvider.sc.contentId).toBe(LAPS_API);
    expect(withProvider.text).toBe(without.text);
    expect(withProvider.sc).toEqual(without.sc);
  });

  it.each([
    ['carrying its ids', { mapId: PRO_MAP, contentId: POLICIES }],
    ['carrying none', undefined],
  ])('answers a url and a `language` that moved it with that language\'s article, not the url\'s page %s', async (_name, ids) => {
    // `language: "ja-JP"` on the en-US Policies.html resolves to ポリシー. The
    // provider has nothing under that pair, and its page for the url is the
    // en-US one: another article, which it used to answer with.
    providedCtx.articleProvider = urlKeyedProvider([storedPage(POLICIES_URL, 'Policies', ids)]);

    const { without, with: withProvider } = await both({ url: POLICIES_URL, language: 'ja-JP' });

    expect(withProvider.sc.title).toBe('ポリシー');
    expect(withProvider.text).not.toContain('BODY OF');
    expect(withProvider.text).toBe(without.text);
    expect(withProvider.sc).toEqual(without.sc);
  });
});
