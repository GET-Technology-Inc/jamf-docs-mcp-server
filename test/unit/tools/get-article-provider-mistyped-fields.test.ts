/**
 * An ArticleProvider article whose field is `null`, or of another type than
 * `FetchArticleResult` declares, no longer fails the reply.
 *
 * A provider's article is taken as given, like a SearchProvider's results
 * (search-provider-mistyped-fields.test.ts has the rule). Offline over MCP,
 * until 2026-09-28 one such field made every format of `jamf_docs_get_article`
 * an error:
 *
 *  - `product`, `version`, `lastUpdated`, `contentLocale`, `versionStatus` or
 *    `navigation` `null`, or a `mapId` or `contentId` of another type:
 *    "Output validation error" (`isError`).
 *  - `breadcrumb` or `relatedArticles` `null`: "Error fetching article:
 *    Cannot read properties of null (reading 'length')" in markdown, and an
 *    output validation error in JSON for `breadcrumb`.
 *  - `title`, `content` or `url` `null`: an error in every format, and so for
 *    `tokenInfo` or `sections` (reading 'tokenCount', reading 'map').
 *  - `getArticleByIds` answering `undefined`: "Cannot read properties of
 *    undefined (reading 'mapId')", where the interface says `null` falls
 *    through to Fluid Topics.
 *
 * `jamf_docs_batch_get_articles` failed the same article with an output
 * validation error for `title` or `content`, a thrown error for `url` or
 * `tokenInfo`, and printed "**Product**: null" and "**Version**: 42".
 *
 * Now an optional field that is not of its declared type is read as absent,
 * on every channel. An article without a usable `title`, `content`, `url`,
 * `tokenInfo` or `sections` is read as the provider answering `null`: core
 * asks `getArticle`, and then Fluid Topics, as it does for a `null`.
 *
 * Every case drives the registered tools over MCP with the real article
 * service. Fluid Topics answers from the fixtures in
 * test/helpers/article-upstream.ts.
 */

import { describe, it, expect, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { registerGetArticleTool } from '../../../src/core/tools/get-article.js';
import { registerBatchGetArticlesTool } from '../../../src/core/tools/batch-get-articles.js';
import { createMockContext, createMockLogger } from '../../helpers/mock-context.js';
import { CCP, CCP_OWN, CCP_URL, PRO_MAP, articleUpstream, resolveFixtureUrl } from '../../helpers/article-upstream.js';
import type { HttpClient } from '../../../src/core/http-client.js';
import type { ArticleProvider, LoggerFactory } from '../../../src/core/services/interfaces/index.js';
import type { FetchArticleResult } from '../../../src/core/types.js';
import type { ServerContext } from '../../../src/core/types/context.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

const CONTENT = '# Computer Configuration Profiles\n\nConfiguration profiles are XML files.\n\n'
  + '## Distribution\n\nInstall it automatically or make it available in Self Service.';

/** A well-typed article that sets every field, as a provider would serve it. */
const WHOLE: Required<FetchArticleResult> = {
  title: 'Computer Configuration Profiles (stored)',
  content: CONTENT,
  url: CCP_OWN,
  product: 'Jamf Pro',
  version: '11.32.0',
  lastUpdated: '2026-09-01',
  breadcrumb: ['Managing Computers', 'Computer Configuration Profiles'],
  relatedArticles: [{ title: 'Policies', url: 'https://learn.jamf.com/r/en-US/jamf-pro-documentation-current/Policies' }],
  mapId: PRO_MAP,
  contentId: CCP,
  versionStatus: 'latest',
  contentLocale: 'en-US',
  navigation: {
    self: { title: 'Computer Configuration Profiles', url: CCP_OWN },
    siblings: [],
    children: [],
    siblingCount: 0,
    childCount: 0,
  },
  tokenInfo: { tokenCount: 30, truncated: false, maxTokens: 5000 },
  sections: [
    { id: 'computer-configuration-profiles', title: 'Computer Configuration Profiles', level: 1, tokenCount: 12 },
    { id: 'distribution', title: 'Distribution', level: 2, tokenCount: 14 },
  ],
  sectionNotFound: false,
};

const REQUIRED = ['title', 'content', 'url', 'tokenInfo', 'sections'] as const;
const OPTIONAL = Object.keys(WHOLE).filter(k => !(REQUIRED as readonly string[]).includes(k));

/** `WHOLE` with the given fields replaced, as untyped provider data. */
function article(patch: Record<string, unknown>): FetchArticleResult {
  return { ...WHOLE, ...patch };
}

// ── Harness ─────────────────────────────────────────────────────────────────

interface Harness {
  ctx: ServerContext;
  /** Every Fluid Topics topic fetch. */
  ftFetches: string[];
  /** Every warning the article service logged. */
  warnings: string[];
  /** Every debug line the article service logged that names the provider. */
  debugs: string[];
}

function backends(provider: ArticleProvider): Harness {
  const upstream = articleUpstream();
  const harness: Harness = { ctx: undefined as unknown as ServerContext, ftFetches: [], warnings: [], debugs: [] };
  const http: HttpClient = {
    getJson: async <T>(url: string) => {
      if (url.includes('/topics/')) { harness.ftFetches.push(url); }
      return await upstream.getJson(url) as T;
    },
    getText: upstream.getText,
    postJson: async url => await Promise.reject(new Error(`offline: no fixture for ${url}`)),
  };
  const logger: LoggerFactory = {
    createLogger: (name: string) => ({
      ...createMockLogger(),
      warning: (message: unknown) => {
        if (name === 'article-service') { harness.warnings.push(String(message)); }
      },
      debug: (message: unknown) => {
        if (name === 'article-service' && String(message).startsWith('ArticleProvider')) {
          harness.debugs.push(String(message));
        }
      },
    }),
  };
  harness.ctx = createMockContext({ http, logger, articleProvider: provider });
  harness.ctx.topicResolver.resolve = vi.fn(resolveFixtureUrl);
  return harness;
}

function byIds(answer: unknown): ArticleProvider {
  return {
    getArticleByIds: vi.fn<ArticleProvider['getArticleByIds']>(async () =>
      await Promise.resolve(answer as FetchArticleResult | null)),
  };
}

interface TextContent { type: 'text'; text: string }
type Row = Record<string, unknown>;
interface Reply { text: string; sc: Row }

async function callTool(ctx: ServerContext, name: string, args: Row): Promise<Reply> {
  const server = new McpServer({ name: 'test-server', version: '0.0.1' });
  registerGetArticleTool(server, ctx);
  registerBatchGetArticlesTool(server, ctx);
  const client = new Client({ name: 'test-client', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    // Listed first, so the client checks structuredContent against the
    // published outputSchema and rejects a reply that does not match it.
    await client.listTools();
    const result = await client.callTool({ name, arguments: args });
    const { text } = result.content[0] as TextContent;
    expect(result.isError, text).not.toBe(true);
    return { text, sc: (result.structuredContent ?? {}) as Row };
  } finally {
    await client.close();
    await server.close();
  }
}

const PAIR = { mapId: PRO_MAP, contentId: CCP };

const FORMATS = [
  { responseFormat: 'json' },
  { responseFormat: 'markdown' },
  { responseFormat: 'markdown', outputMode: 'compact' },
] as const;

// ── Cases ───────────────────────────────────────────────────────────────────

describe('an ArticleProvider optional field that is not of its declared type is read as absent', () => {
  it.each([
    ['null', Object.fromEntries(OPTIONAL.map(k => [k, null]))],
    ['of another type', {
      product: 42, version: 11.32, lastUpdated: 20260901, breadcrumb: 'Managing Computers',
      relatedArticles: 'Policies', mapId: 42, contentId: { id: CCP }, versionStatus: 'old',
      contentLocale: ['en-US'], navigation: 'Computer Configuration Profiles', sectionNotFound: 'no',
    }],
  ])('every one of them %s: the provider\'s article is served, and no channel carries them', async (label, patch) => {
    const harness = backends(byIds(article(patch)));
    // Core fills in the pair it asked for when the article carries none.
    const absent = Object.keys(patch).filter(k => k !== 'mapId' && k !== 'contentId' && k !== 'sectionNotFound');

    for (const format of FORMATS) {
      const reply = await callTool(harness.ctx, 'jamf_docs_get_article', { ...PAIR, includeRelated: true, ...format });
      expect(reply.sc.title).toBe(WHOLE.title);
      expect(reply.sc).toMatchObject(PAIR);
      for (const field of absent) {
        expect(reply.sc, `${field} in ${JSON.stringify(format)}`).not.toHaveProperty(field);
      }
      if (format.responseFormat === 'json') {
        const json = JSON.parse(reply.text) as Row;
        for (const field of absent) {
          expect(json, field).not.toHaveProperty(field);
        }
      } else {
        expect(reply.text).not.toMatch(/null|undefined|\[object Object\]|\b42\b/);
      }
    }
    expect(harness.ftFetches).toEqual([]);
    // A null is how a database row says "absent", so it is logged at debug.
    const [logged, quiet] = label === 'null' ? [harness.debugs, harness.warnings] : [harness.warnings, harness.debugs];
    expect(logged.join('\n')).toContain('product');
    expect(quiet).toEqual([]);
  });

  it('whichever field it is: every key the outputSchema declares is checked', async () => {
    for (const field of Object.keys(WHOLE)) {
      const harness = backends(byIds(article({ [field]: null })));
      const reply = await callTool(harness.ctx, 'jamf_docs_get_article', { ...PAIR, responseFormat: 'json' });
      expect(Object.values(reply.sc), field).not.toContain(null);
      // An optional field read as absent is logged at debug; a required one
      // makes the article unusable, which is a warning.
      const logged = (REQUIRED as readonly string[]).includes(field) ? harness.warnings : harness.debugs;
      expect(logged.join('\n'), field).toContain(field);
    }
  });

  it('from the url fallback too', async () => {
    const provider: ArticleProvider = {
      ...byIds(null),
      getArticle: vi.fn<NonNullable<ArticleProvider['getArticle']>>(async () =>
        await Promise.resolve(article({ product: null, breadcrumb: null }))),
    };
    const harness = backends(provider);

    const reply = await callTool(harness.ctx, 'jamf_docs_get_article', { url: CCP_OWN, ...PAIR, responseFormat: 'json' });

    expect(reply.sc.title).toBe(WHOLE.title);
    expect(reply.sc).not.toHaveProperty('product');
    expect(reply.sc).not.toHaveProperty('breadcrumb');
    expect(harness.ftFetches).toEqual([]);
  });

  it('in jamf_docs_batch_get_articles too', async () => {
    const harness = backends(byIds(article({ product: null, version: 42, breadcrumb: null, navigation: null })));

    const reply = await callTool(harness.ctx, 'jamf_docs_batch_get_articles', { urls: [CCP_URL] });

    expect(reply.sc).toMatchObject({ summary: { total: 1, succeeded: 1, failed: 0 } });
    expect(reply.text).not.toMatch(/null|\b42\b/);
  });
});

describe('an ArticleProvider article without a usable required field is read as null', () => {
  it.each(REQUIRED.flatMap(field => [
    [field, null],
    [field, field === 'sections' || field === 'tokenInfo' ? 'none' : 42],
  ] as const))('%s %s: Fluid Topics answers, as for a null, and a warning says why', async (field, value) => {
    const harness = backends(byIds(article({ [field]: value })));

    for (const format of FORMATS) {
      const reply = await callTool(harness.ctx, 'jamf_docs_get_article', { ...PAIR, ...format });
      // The fixture's title, not the provider's "(stored)" one.
      expect(reply.sc.title).toBe('Computer Configuration Profiles');
    }
    expect(harness.ftFetches.length).toBeGreaterThan(0);
    expect(harness.warnings.join('\n')).toContain(field);
  });

  it('and so is an answer that is not an article: undefined, or a string', async () => {
    for (const answer of [undefined, 'Computer Configuration Profiles']) {
      const harness = backends(byIds(answer));
      const reply = await callTool(harness.ctx, 'jamf_docs_get_article', { ...PAIR, responseFormat: 'json' });
      expect(reply.sc.title).toBe('Computer Configuration Profiles');
      expect(harness.warnings).toHaveLength(1);
    }
  });

  it('a plain null is the documented fall-through, and nothing is logged', async () => {
    const harness = backends(byIds(null));

    const reply = await callTool(harness.ctx, 'jamf_docs_get_article', { ...PAIR, responseFormat: 'json' });

    expect(reply.sc.title).toBe('Computer Configuration Profiles');
    expect(harness.ftFetches.length).toBeGreaterThan(0);
    expect([...harness.warnings, ...harness.debugs]).toEqual([]);
  });

  it('then the url fallback is asked, as for a null', async () => {
    const provider: ArticleProvider = {
      ...byIds(article({ content: null })),
      getArticle: vi.fn<NonNullable<ArticleProvider['getArticle']>>(async () => await Promise.resolve(WHOLE)),
    };
    const harness = backends(provider);

    const reply = await callTool(harness.ctx, 'jamf_docs_get_article', { url: CCP_OWN, ...PAIR, responseFormat: 'json' });

    expect(provider.getArticle).toHaveBeenCalledOnce();
    expect(reply.sc.title).toBe(WHOLE.title);
    expect(harness.ftFetches).toEqual([]);
  });

  it('in jamf_docs_batch_get_articles too', async () => {
    const harness = backends(byIds(article({ title: null, url: 42 })));

    const reply = await callTool(harness.ctx, 'jamf_docs_batch_get_articles', { urls: [CCP_URL] });

    expect(reply.sc).toMatchObject({
      results: [{ status: 'success', title: 'Computer Configuration Profiles' }],
      summary: { succeeded: 1, failed: 0 },
    });
  });
});

describe('a well-typed ArticleProvider article', () => {
  it('reaches every channel as it was returned, with nothing logged', async () => {
    const harness = backends(byIds(WHOLE));

    const reply = await callTool(harness.ctx, 'jamf_docs_get_article', { ...PAIR, responseFormat: 'json' });

    expect(reply.sc).toMatchObject({
      title: WHOLE.title, url: WHOLE.url, product: 'Jamf Pro', version: '11.32.0', lastUpdated: '2026-09-01',
      breadcrumb: WHOLE.breadcrumb, mapId: PRO_MAP, contentId: CCP, versionStatus: 'latest',
      contentLocale: 'en-US', navigation: WHOLE.navigation,
    });
    expect(harness.ftFetches).toEqual([]);
    expect([...harness.warnings, ...harness.debugs]).toEqual([]);
  });
});
