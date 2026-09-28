/**
 * `jamf_docs_get_article` and `jamf_docs_batch_get_articles` on a
 * concepts.jamf.com url whose path starts with no locale code: the registered
 * tools over MCP, with the real article reader and cache, and only the http
 * client stubbed (helpers/static-editions-upstream.ts).
 *
 * Live on 2026-09-28, concepts.jamf.com answered each of the 98 paths its
 * sitemap lists under `en`, asked for without the code
 * (`/guides/ai-governance/`), with a 200 whose `<meta http-equiv="refresh">`
 * and `<link rel="canonical">` name the en page, and whose title is
 * "Redirecting..." and body "Redirecting to /en/guides/ai-governance...". A
 * browser follows the refresh. Until 2026-09-28 this server did not, and
 * served that stub as the article: title "Redirecting...", a one-line body,
 * labelled with the url asked for, and with `language`, a note that the
 * language was not applied because the path names no locale.
 *
 * Now the page the stub names is the one asked for, and `language` picks
 * its edition as it does for any url under a locale code.
 *
 * The site root, `/`, is not such a stub: it is a shell whose script picks
 * an edition in the browser, whose only text is "Loading...". Each locale
 * code's root is a page, and the root is read as the en edition's, or the
 * one `language` asks for.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { registerGetArticleTool } from '../../../src/core/tools/get-article.js';
import { registerBatchGetArticlesTool } from '../../../src/core/tools/batch-get-articles.js';
import { STATIC_DOC_SOURCES } from '../../../src/core/constants/sources.js';
import { staticArticleKey } from '../../../src/core/services/static-article-cache.js';
import { createDefaultConfig } from '../../../src/core/config.js';
import { createMockContext, createStubMapsRegistry } from '../../helpers/mock-context.js';
import type { ServerContext } from '../../../src/core/types/context.js';
import {
  aiGovernanceBody,
  conceptsPage,
  conceptsRedirectStub,
  conceptsRootBody,
  conceptsUrl,
  createStaticEditionsUpstream,
} from '../../helpers/static-editions-upstream.js';

interface TextContent { type: 'text'; text: string }

interface CallResult {
  isError?: boolean;
  content: unknown[];
  structuredContent?: Record<string, unknown>;
}

const CONCEPTS = STATIC_DOC_SOURCES['jamf-concepts'];

const AI_GOVERNANCE = 'guides/ai-governance';
const AI_GOVERNANCE_EN = conceptsUrl('en', AI_GOVERNANCE);
/** The url with no locale code, as the site's own links never spell it and a reader may. */
const STUB = `${CONCEPTS.baseUrl}/${AI_GOVERNANCE}/`;

/** A TTL for each kind of entry, none equal to another, so a test can tell which one an entry got. */
const CACHE_TTL = { search: 1_000, article: 2_000_000, products: 3_000_000, toc: 4_000_000 };

const upstream = createStaticEditionsUpstream();
const { requests } = upstream;

let ctx: ServerContext;
let server: McpServer;
let client: Client;

beforeAll(async () => {
  ctx = createMockContext({
    http: upstream.http,
    mapsRegistry: createStubMapsRegistry([]),
    config: { ...createDefaultConfig(), cacheTtl: CACHE_TTL },
  });
  server = new McpServer({ name: 'test', version: '0.0.1' });
  registerGetArticleTool(server, ctx);
  registerBatchGetArticlesTool(server, ctx);

  client = new Client({ name: 'test-client', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  // Listing the tools first is what makes the client check every
  // `structuredContent` against the published outputSchema.
  await client.listTools();
});

afterAll(async () => {
  await client.close();
  await server.close();
});

beforeEach(async () => {
  await ctx.cache.clear();
  vi.mocked(ctx.cache.set).mockClear();
  upstream.reset();
});

async function call(name: string, args: Record<string, unknown>): Promise<CallResult> {
  return await client.callTool({ name, arguments: args }) as CallResult;
}

function textOf(result: CallResult): string {
  return (result.content[0] as TextContent).text;
}

/** Each static-article entry written, by key, with what it holds and for how long. */
function staticEntries(): [string, unknown, number | undefined][] {
  return vi.mocked(ctx.cache.set).mock.calls
    .filter(([key]) => key.startsWith('static-article-v3:'))
    .map(([key, value, ttl]) => [key, value, ttl]);
}

interface Channel { url: string; title: string; text: string; contentLocale?: string | undefined }

/** The article as each channel carries it: markdown, the JSON text, and structuredContent. */
async function everyChannel(args: Record<string, unknown>): Promise<Channel[]> {
  const markdown = await call('jamf_docs_get_article', { ...args, responseFormat: 'markdown' });
  const json = await call('jamf_docs_get_article', { ...args, responseFormat: 'json' });
  for (const result of [markdown, json]) {
    expect(result.isError, textOf(result)).not.toBe(true);
  }
  const fromMarkdown = markdown.structuredContent as unknown as Channel & { content: string };
  const body = JSON.parse(textOf(json)) as Channel & { content: string };
  const structured = json.structuredContent as unknown as Channel & { content: string };
  return [
    { url: fromMarkdown.url, title: fromMarkdown.title, text: textOf(markdown), contentLocale: fromMarkdown.contentLocale },
    { url: body.url, title: body.title, text: body.content, contentLocale: body.contentLocale },
    { url: structured.url, title: structured.title, text: structured.content, contentLocale: structured.contentLocale },
  ];
}

describe('jamf_docs_get_article: a concepts.jamf.com url with no locale code', () => {
  it('serves the en page the site redirects it to, under that page\'s url', async () => {
    for (const channel of await everyChannel({ url: STUB })) {
      expect(channel.url).toBe(AI_GOVERNANCE_EN);
      expect(channel.title).toBe('AI Governance');
      expect(channel.text).toContain(aiGovernanceBody('en'));
      expect(channel.text).not.toContain('Redirecting');
      expect(channel.text).not.toContain('*Note:');
      expect(channel.contentLocale).toBe('en-US');
    }
    // The stub and the page, once each: the second call is the cache's.
    expect(requests).toEqual([STUB, AI_GOVERNANCE_EN]);
  });

  it('reads the slashless spelling as the same page', async () => {
    for (const channel of await everyChannel({ url: `${CONCEPTS.baseUrl}/${AI_GOVERNANCE}` })) {
      expect(channel.url).toBe(AI_GOVERNANCE_EN);
      expect(channel.text).toContain(aiGovernanceBody('en'));
    }
    expect(requests).toEqual([STUB, AI_GOVERNANCE_EN]);
  });

  it.each([
    ['ja-JP', 'ja'],
    ['zh-TW', 'zh-TW'],
    ['en-US', 'en'],
  ])('serves the %s edition, from its own url, and not the en page first', async (language, code) => {
    const edition = conceptsUrl(code, AI_GOVERNANCE);

    for (const channel of await everyChannel({ url: STUB, language })) {
      expect(channel.url).toBe(edition);
      expect(channel.text).toContain(aiGovernanceBody(code));
      expect(channel.text).not.toContain('*Note:');
      expect(channel.contentLocale).toBe(language);
    }
    expect(requests).toEqual([STUB, edition]);
  });

  it('serves the en page with the usual note in a language the site does not publish in', async () => {
    for (const channel of await everyChannel({ url: STUB, language: 'th-TH' })) {
      expect(channel.url).toBe(AI_GOVERNANCE_EN);
      expect(channel.text).toContain(aiGovernanceBody('en'));
      expect(channel.text).toContain('Jamf does not publish this article in th-TH. Showing the en-US edition instead.');
      expect(channel.text).not.toContain('was not applied');
      expect(channel.contentLocale).toBe('en-US');
    }
    expect(requests).toEqual([STUB, AI_GOVERNANCE_EN]);
  });

  it('keeps the url\'s fragment on the page it names', async () => {
    for (const channel of await everyChannel({ url: `${STUB}#prerequisites` })) {
      expect(channel.url).toBe(`${AI_GOVERNANCE_EN}#prerequisites`);
    }
  });

  // Until 2026-09-28 the fragment went into the request and the cache key, so
  // each fragment of one url was a request and an entry of its own.
  it('reads two fragments of one url as one page: one request, and one entry, each', async () => {
    for (const fragment of ['#prerequisites', '#overview']) {
      for (const channel of await everyChannel({ url: `${STUB}${fragment}` })) {
        expect(channel.url).toBe(`${AI_GOVERNANCE_EN}${fragment}`);
      }
    }

    expect(requests).toEqual([STUB, AI_GOVERNANCE_EN]);
    expect(staticEntries().map(([key]) => key))
      .toEqual([staticArticleKey(CONCEPTS, STUB), staticArticleKey(CONCEPTS, AI_GOVERNANCE_EN)]);
  });

  it('keeps where the page redirects to, and the page, each for the article TTL', async () => {
    await everyChannel({ url: STUB });

    expect(staticEntries()).toEqual([
      [staticArticleKey(CONCEPTS, STUB), { movedTo: AI_GOVERNANCE_EN }, CACHE_TTL.article],
      [staticArticleKey(CONCEPTS, AI_GOVERNANCE_EN), expect.objectContaining({ title: 'AI Governance' }), CACHE_TTL.article],
    ]);
  });

  it.each([
    ['attributes the other way round', '<meta content="0; URL=/en/guides/ai-governance" http-equiv="Refresh">'],
    ['a quoted url and a delay', '<meta http-equiv=\'refresh\' content="3;url=\'https://concepts.jamf.com/en/guides/ai-governance\'">'],
  ])('follows a refresh written with %s', async (_, tag) => {
    upstream.pages.set(STUB, `<html><head>${tag}<title>Redirecting...</title></head><body></body></html>`);

    for (const channel of await everyChannel({ url: STUB })) {
      expect(channel.url).toBe(AI_GOVERNANCE_EN);
      expect(channel.text).toContain(aiGovernanceBody('en'));
    }
  });

  it.each([
    ['another host', 'https://example.com/en/guides/ai-governance'],
    ['the page itself', `/${AI_GOVERNANCE}/`],
  ])('does not follow a refresh to %s, and serves the page as it is', async (_, target) => {
    upstream.pages.set(STUB, conceptsRedirectStub(target));

    for (const channel of await everyChannel({ url: STUB })) {
      expect(channel.url).toBe(STUB);
      expect(channel.title).toBe('Redirecting...');
    }
    expect(requests).toEqual([STUB]);
  });

  it('does not follow a refresh to the page itself when the url asked for has a fragment', async () => {
    upstream.pages.set(STUB, conceptsRedirectStub(`/${AI_GOVERNANCE}/`));

    for (const channel of await everyChannel({ url: `${STUB}#prerequisites` })) {
      expect(channel.url).toBe(`${STUB}#prerequisites`);
      expect(channel.title).toBe('Redirecting...');
    }
    expect(requests).toEqual([STUB]);
  });

  it('serves a page with no locale code that is not a redirect as it is, and says the language was not applied', async () => {
    upstream.pages.set(STUB, conceptsPage('AI Governance', 'The unprefixed page.'));

    for (const channel of await everyChannel({ url: STUB, language: 'ja-JP' })) {
      expect(channel.url).toBe(STUB);
      expect(channel.text).toContain('The unprefixed page.');
      expect(channel.text).toContain('Language "ja-JP" was not applied');
    }
    expect(requests).toEqual([STUB]);
  });

  // An embedder's cache need not hand back what was just written to it. The
  // page read to see whether it redirects is the page served, and is not read
  // a second time.
  it('asks for such a page once in a call, from a cache that keeps nothing', async () => {
    upstream.pages.set(STUB, conceptsPage('AI Governance', 'The unprefixed page.'));
    const get = vi.mocked(ctx.cache.get);
    const keeps = get.getMockImplementation();
    get.mockImplementation(async () => await Promise.resolve(null));
    try {
      const result = await call('jamf_docs_get_article', { url: STUB, language: 'ja-JP' });
      expect(textOf(result)).toContain('The unprefixed page.');
    } finally {
      if (keeps !== undefined) { get.mockImplementation(keeps); }
    }
    expect(requests).toEqual([STUB]);
  });
});

describe('jamf_docs_get_article: a concepts.jamf.com page whose redirect redirects again', () => {
  const OTHER = conceptsUrl('en', 'guides/other');

  // One redirect is followed, which is all a live page makes (2026-09-28).
  it('fails, naming both urls, after asking for each once', async () => {
    upstream.pages.set(AI_GOVERNANCE_EN, conceptsRedirectStub('/en/guides/other'));

    const result = await call('jamf_docs_get_article', { url: STUB });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain(
      `Could not read a Jamf Concepts page at ${STUB}: it redirects to ${AI_GOVERNANCE_EN}, which redirects again.`,
    );
    expect(requests).toEqual([STUB, AI_GOVERNANCE_EN]);
    expect(requests).not.toContain(OTHER);
  });

  it.each([
    ['the url with no locale code', STUB, AI_GOVERNANCE_EN],
    ['the en url', AI_GOVERNANCE_EN, STUB],
  ])('ends a loop the same way, asked for by %s', async (_, asked, next) => {
    upstream.pages.set(AI_GOVERNANCE_EN, conceptsRedirectStub(`/${AI_GOVERNANCE}`));

    const result = await call('jamf_docs_get_article', { url: asked });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain(
      `Could not read a Jamf Concepts page at ${asked}: it redirects to ${next}, which redirects again.`,
    );
    expect(requests).toEqual([asked, next]);
  });
});

describe('jamf_docs_get_article: a concepts.jamf.com edition whose url redirects', () => {
  const JA = conceptsUrl('ja', AI_GOVERNANCE);

  // None does live: 18 sampled /en/, /ja/ and /ko/ pages, 6 each, carried no
  // refresh (2026-09-28). Until that day such an edition was served as the ja one,
  // with no note.
  it.each([
    ['the en url', AI_GOVERNANCE_EN, [JA, AI_GOVERNANCE_EN]],
    ['the url with no locale code', STUB, [STUB, JA, AI_GOVERNANCE_EN]],
  ])('serves the page asked for by %s, with the usual note, where the edition redirects to another locale\'s page', async (_, url, expected) => {
    upstream.pages.set(JA, conceptsRedirectStub(`/en/${AI_GOVERNANCE}`));

    for (const channel of await everyChannel({ url, language: 'ja-JP' })) {
      expect(channel.url).toBe(AI_GOVERNANCE_EN);
      expect(channel.text).toContain(aiGovernanceBody('en'));
      expect(channel.text).toContain('Jamf does not publish this article in ja-JP. Showing the en-US edition instead.');
      expect(channel.contentLocale).toBe('en-US');
    }
    expect(requests).toEqual(expected);
  });

  it('serves the edition where it redirects to another page in its own locale', async () => {
    const moved = conceptsUrl('ja', 'guides/ai-governance-moved');
    upstream.pages.set(JA, conceptsRedirectStub('/ja/guides/ai-governance-moved'));
    upstream.pages.set(moved, conceptsPage('AI Governance', aiGovernanceBody('ja')));

    for (const channel of await everyChannel({ url: AI_GOVERNANCE_EN, language: 'ja-JP' })) {
      expect(channel.url).toBe(moved);
      expect(channel.text).toContain(aiGovernanceBody('ja'));
      expect(channel.text).not.toContain('*Note:');
      expect(channel.contentLocale).toBe('ja-JP');
    }
    expect(requests).toEqual([JA, moved]);
  });
});

describe('jamf_docs_get_article: the concepts.jamf.com site root', () => {
  const ROOT = `${CONCEPTS.baseUrl}/`;
  const EN_ROOT = `${CONCEPTS.baseUrl}/en/`;

  // Until 2026-09-28 the root was served as the shell: title "Jamf
  // Concepts", body "Loading...".
  it.each([
    ['with its slash', ROOT],
    ['without it', CONCEPTS.baseUrl],
  ])('serves the en edition\'s root for the root %s, without asking for the root', async (_, url) => {
    for (const channel of await everyChannel({ url })) {
      expect(channel.url).toBe(EN_ROOT);
      expect(channel.title).toBe('Jamf Concepts');
      expect(channel.text).toContain(conceptsRootBody('en'));
      expect(channel.text).not.toContain('Loading...');
      expect(channel.contentLocale).toBe('en-US');
    }
    expect(requests).toEqual([EN_ROOT]);
  });

  it.each([
    ['ja-JP', 'ja'],
    ['zh-TW', 'zh-TW'],
  ])('serves the %s edition\'s root', async (language, code) => {
    const root = `${CONCEPTS.baseUrl}/${code}/`;

    for (const channel of await everyChannel({ url: ROOT, language })) {
      expect(channel.url).toBe(root);
      expect(channel.text).toContain(conceptsRootBody(code));
      expect(channel.text).not.toContain('*Note:');
      expect(channel.contentLocale).toBe(language);
    }
    expect(requests).toEqual([root]);
  });

  it('serves the en edition\'s root with the usual note in a language the site does not publish in', async () => {
    for (const channel of await everyChannel({ url: ROOT, language: 'th-TH' })) {
      expect(channel.url).toBe(EN_ROOT);
      expect(channel.text).toContain(conceptsRootBody('en'));
      expect(channel.text).toContain('Jamf does not publish this article in th-TH. Showing the en-US edition instead.');
    }
    expect(requests).toEqual([EN_ROOT]);
  });

  it('keeps the root\'s fragment on the en edition\'s root', async () => {
    for (const channel of await everyChannel({ url: `${ROOT}#concepts` })) {
      expect(channel.url).toBe(`${EN_ROOT}#concepts`);
    }
  });
});

describe('jamf_docs_batch_get_articles: a concepts.jamf.com url with no locale code', () => {
  it('serves the page the site redirects it to, in the language asked for', async () => {
    const result = await call('jamf_docs_batch_get_articles', {
      urls: [STUB], language: 'ja-JP', responseFormat: 'json',
    });

    expect(result.isError, textOf(result)).not.toBe(true);
    const { results } = result.structuredContent as { results: { url: string; status: string; title?: string; content?: string }[] };
    expect(results[0]?.status).toBe('success');
    expect(results[0]?.url).toBe(conceptsUrl('ja', AI_GOVERNANCE));
    expect(results[0]?.title).toBe('AI Governance');
    expect(results[0]?.content).toContain(aiGovernanceBody('ja'));
    expect(requests).toEqual([STUB, conceptsUrl('ja', AI_GOVERNANCE)]);
  });
});
