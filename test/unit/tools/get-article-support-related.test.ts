/**
 * `includeRelated` on a support.jamf.com article in `jamf_docs_get_article`:
 * the registered tool over MCP, with the real Intercom reader and cache, and
 * only the http client stubbed (helpers/static-editions-upstream.ts).
 *
 * Each article page lists its related articles in its page data, as
 * `articleContent.relatedArticles`, each with a title and a url: 5 on
 * article 11730439, and on every one of 40 articles sampled across the en,
 * ja and zh-TW collections on 2026-09-28 (37 listed 5, two 3, one 2). The url
 * is spelled raw where its slug is not ASCII. Until 2026-09-28 the Intercom
 * reader set no related articles, so `includeRelated` returned none for any
 * support.jamf.com article, where a learn.jamf.com one returns its links.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { registerGetArticleTool } from '../../../src/core/tools/get-article.js';
import { STATIC_DOC_SOURCES, canonicalStaticUrl } from '../../../src/core/constants/sources.js';
import { sanitizeMarkdownText, sanitizeMarkdownUrl } from '../../../src/core/utils/sanitize.js';
import { createMockContext, createStubMapsRegistry } from '../../helpers/mock-context.js';
import type { ServerContext } from '../../../src/core/types/context.js';
import { createStaticEditionsUpstream, editionUrl } from '../../helpers/static-editions-upstream.js';
import { nextDataPage } from '../../helpers/support-upstream.js';
import { JC_LOGIN_BLACK_SCREEN, RENEW_PUSH_CERTIFICATE } from '../../fixtures/support-editions.js';

interface TextContent { type: 'text'; text: string }

interface CallResult {
  isError?: boolean;
  content: unknown[];
  structuredContent?: Record<string, unknown>;
}

interface Related { title: string; url: string }

const SUPPORT = STATIC_DOC_SOURCES['jamf-support'];

const JCL_URL = canonicalStaticUrl(SUPPORT, editionUrl(JC_LOGIN_BLACK_SCREEN, 'en'));
const JCL_RELATED = JC_LOGIN_BLACK_SCREEN.editions.en.relatedArticles ?? [];
const RENEW_EN_URL = canonicalStaticUrl(SUPPORT, editionUrl(RENEW_PUSH_CERTIFICATE, 'en'));
const RENEW_JA_RELATED = RENEW_PUSH_CERTIFICATE.editions.ja.relatedArticles ?? [];

const upstream = createStaticEditionsUpstream();
const { requests } = upstream;

let ctx: ServerContext;
let server: McpServer;
let client: Client;

beforeAll(async () => {
  ctx = createMockContext({ http: upstream.http, mapsRegistry: createStubMapsRegistry([]) });
  server = new McpServer({ name: 'test', version: '0.0.1' });
  registerGetArticleTool(server, ctx);

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
  upstream.reset();
});

async function getArticle(args: Record<string, unknown>): Promise<CallResult> {
  return await client.callTool({ name: 'jamf_docs_get_article', arguments: args }) as CallResult;
}

function textOf(result: CallResult): string {
  return (result.content[0] as TextContent).text;
}

/** The related articles as the markdown lists them, and as the JSON text gives them. */
async function relatedOf(args: Record<string, unknown>): Promise<{ markdown: string; json: Related[] | undefined }> {
  const markdown = await getArticle({ ...args, responseFormat: 'markdown' });
  const json = await getArticle({ ...args, responseFormat: 'json' });
  for (const result of [markdown, json]) {
    expect(result.isError, textOf(result)).not.toBe(true);
    // Markdown-only, as on every source: not published in structuredContent.
    expect(result.structuredContent).not.toHaveProperty('relatedArticles');
  }
  // The list, up to the blank line before the reply's footer.
  const parts = textOf(markdown).split('## Related Articles');
  return {
    markdown: parts.length > 1 ? parts[1].trim().split('\n\n')[0] : '',
    json: (JSON.parse(textOf(json)) as { relatedArticles?: Related[] }).relatedArticles,
  };
}

/** A related article as the markdown links it, to the url `get_article` reports. */
function link(related: Related): string {
  return `- [${sanitizeMarkdownText(related.title)}](${sanitizeMarkdownUrl(canonicalStaticUrl(SUPPORT, related.url))})`;
}

describe('jamf_docs_get_article: includeRelated on a support.jamf.com article', () => {
  it('lists the related articles the page lists, in its order, on every channel', async () => {
    const { markdown, json } = await relatedOf({ url: JCL_URL, includeRelated: true });

    expect(JCL_RELATED).toHaveLength(5);
    expect(markdown.split('\n')).toEqual(JCL_RELATED.map(link));
    expect(json).toEqual(JCL_RELATED.map(related => ({ title: related.title, url: related.url })));
  });

  it('gives each url in the spelling get_article reports, a non-ASCII slug percent-encoded', async () => {
    const { json } = await relatedOf({ url: RENEW_EN_URL, language: 'ja-JP', includeRelated: true });

    expect(json).toEqual(RENEW_JA_RELATED.map(related => ({
      title: related.title,
      url: canonicalStaticUrl(SUPPORT, related.url),
    })));
    for (const related of json ?? []) {
      expect(new URL(related.url).hostname).toBe(SUPPORT.hostname);
      expect(related.url).toMatch(/^[\x21-\x7e]+$/);
    }
  });

  it('lists none without includeRelated, and all of them to a later call that asks, from the one request', async () => {
    const without = await relatedOf({ url: JCL_URL });
    expect(without.markdown).toBe('');
    expect(without.json).toBeUndefined();

    const withRelated = await relatedOf({ url: JCL_URL, includeRelated: true });
    expect(withRelated.json).toHaveLength(5);
    expect(requests).toEqual([JCL_URL]);
  });

  it('reads the list whatever its entries are, leaving out one without a title or a url', async () => {
    upstream.pages.set(JCL_URL, nextDataPage({
      articleContent: {
        title: 'Mistyped',
        blocks: [{ type: 'paragraph', text: 'Body.' }],
        relatedArticles: [
          null,
          5,
          'https://support.jamf.com/en/articles/1-a-string',
          { title: 7, url: 'https://support.jamf.com/en/articles/2-numeric-title' },
          { title: 'No url', url: null },
          { title: '   ', url: 'https://support.jamf.com/en/articles/3-blank-title' },
          { title: 'Two  spaces\u00a0and a trailing one ', url: '/en/articles/4-relative/' },
          { title: 'On concepts.jamf.com', url: 'https://concepts.jamf.com/en/guides/ai-governance' },
          { title: 'On learn.jamf.com', url: 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/Policies.html' },
        ],
      },
    }));

    const { json } = await relatedOf({ url: JCL_URL, includeRelated: true });
    expect(json).toEqual([
      // A number is read as its digits, as every Intercom field is (`asString`).
      { title: '7', url: 'https://support.jamf.com/en/articles/2-numeric-title' },
      { title: 'Two spaces and a trailing one', url: 'https://support.jamf.com/en/articles/4-relative' },
      { title: 'On concepts.jamf.com', url: 'https://concepts.jamf.com/en/guides/ai-governance/' },
      { title: 'On learn.jamf.com', url: 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/Policies.html' },
    ]);
  });

  it.each([
    ['null', null],
    ['an object', { title: 'A', url: 'https://support.jamf.com/en/articles/1-a' }],
    ['a string', 'related'],
  ])('reads a relatedArticles that is %s as none', async (_, relatedArticles) => {
    upstream.pages.set(JCL_URL, nextDataPage({
      articleContent: { title: 'Mistyped', blocks: [{ type: 'paragraph', text: 'Body.' }], relatedArticles },
    }));

    const { markdown, json } = await relatedOf({ url: JCL_URL, includeRelated: true });
    expect(markdown).toBe('');
    expect(json).toBeUndefined();
  });
});
