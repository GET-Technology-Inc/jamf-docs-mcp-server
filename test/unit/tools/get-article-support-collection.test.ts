/**
 * `jamf_docs_get_article` on a support.jamf.com collection page, and the
 * promise `jamf_docs_get_toc` makes about the URLs a support.jamf.com table
 * of contents lists: the registered tools over MCP, with the real Intercom
 * readers and cache, and only the http client stubbed.
 *
 * A support.jamf.com TOC lists each subcollection by its collection page's
 * URL, 24 of them in `jamf-support-jamf-pro` and 62 across the 9 collections
 * (live, 2026-09-28). Its footer says "Use `jamf_docs_get_article` with any
 * URL above to read the full content.", and in `outputMode: "compact"` a
 * subcollection is a bare link, with its articles out of sight. Yet until
 * 2026-09-28 `get_article` read only an article page, and all 24 answered
 * "Could not read a Jamf Support Knowledge Base article at …".
 *
 * A collection page's `__NEXT_DATA__` carries the collection itself: its
 * name, description and articles, and each subcollection with its own. So
 * the reply is that listing, read from the one page, as the site shows it.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { registerGetArticleTool } from '../../../src/core/tools/get-article.js';
import { registerGetTocTool } from '../../../src/core/tools/get-toc.js';
import { STATIC_DOC_SOURCES, canonicalStaticUrl } from '../../../src/core/constants/sources.js';
import { sanitizeMarkdownText, sanitizeMarkdownUrl } from '../../../src/core/utils/sanitize.js';
import { createMockContext, createStubMapsRegistry } from '../../helpers/mock-context.js';
import type { ServerContext } from '../../../src/core/types/context.js';
import { createStaticEditionsUpstream, editionUrl } from '../../helpers/static-editions-upstream.js';
import { nextDataPage } from '../../helpers/support-upstream.js';
import { RENEW_PUSH_CERTIFICATE, SELF_SERVICE_PLUS } from '../../fixtures/support-editions.js';

interface TextContent { type: 'text'; text: string }

interface CallResult {
  isError?: boolean;
  content: unknown[];
  structuredContent?: Record<string, unknown>;
}

const SUPPORT = STATIC_DOC_SOURCES['jamf-support'];

const SELF_SERVICE = SELF_SERVICE_PLUS.editions.en;
const SELF_SERVICE_JA = SELF_SERVICE_PLUS.editions.ja;
const SELF_SERVICE_URL = canonicalStaticUrl(SUPPORT, editionUrl(SELF_SERVICE_PLUS, 'en'));

/** Jamf Pro, the top-level collection Self Service+ is filed under. */
const JAMF_PRO_URL = `${SUPPORT.baseUrl}/en/collections/12369024-jamf-pro`;
const JAMF_PRO_DESCRIPTION = 'Articles for managing devices using Jamf Pro.';
const RENEW = RENEW_PUSH_CERTIFICATE.editions.en;
const RENEW_URL = editionUrl(RENEW_PUSH_CERTIFICATE, 'en');

const upstream = createStaticEditionsUpstream();
const { requests } = upstream;

/**
 * Jamf Pro with one article of its own and Self Service+, as its page carries
 * them, and the en home page that lists it. Every article either lists is an
 * article page, so each URL the TOC gives can be read.
 */
function serveJamfPro(): void {
  upstream.pages.set(`${SUPPORT.baseUrl}/en/`, nextDataPage({
    home: {
      collections: [{
        id: '12369024', slug: 'jamf-pro', name: 'Jamf Pro', description: JAMF_PRO_DESCRIPTION,
        url: JAMF_PRO_URL, articleCount: 1 + SELF_SERVICE.articleSummaries.length,
      }],
    },
  }));
  upstream.pages.set(JAMF_PRO_URL, nextDataPage({
    collection: {
      id: '12369024',
      name: 'Jamf Pro',
      description: JAMF_PRO_DESCRIPTION,
      url: JAMF_PRO_URL,
      articleSummaries: [{ title: RENEW.title, url: RENEW_URL }],
      subcollections: [{
        id: '12380114',
        name: SELF_SERVICE.name,
        description: SELF_SERVICE.description,
        url: editionUrl(SELF_SERVICE_PLUS, 'en'),
        articleSummaries: SELF_SERVICE.articleSummaries,
        subcollections: [],
      }],
    },
    breadcrumbs: [],
    localeLinks: [{ id: 'en', absoluteUrl: JAMF_PRO_URL, available: true, selected: true }],
  }));
  for (const summary of SELF_SERVICE.articleSummaries) {
    upstream.pages.set(canonicalStaticUrl(SUPPORT, summary.url), nextDataPage({
      articleContent: { title: summary.title, blocks: [{ type: 'paragraph', text: `About ${summary.title}.` }] },
      breadcrumbs: [{ name: 'Jamf Pro', url: JAMF_PRO_URL }, { name: SELF_SERVICE.name, url: SELF_SERVICE_URL }],
      localeLinks: [{ id: 'en', absoluteUrl: summary.url, available: true, selected: true }],
    }));
  }
}

let ctx: ServerContext;
let server: McpServer;
let client: Client;

beforeAll(async () => {
  ctx = createMockContext({ http: upstream.http, mapsRegistry: createStubMapsRegistry([]) });
  server = new McpServer({ name: 'test', version: '0.0.1' });
  registerGetArticleTool(server, ctx);
  registerGetTocTool(server, ctx);

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
  serveJamfPro();
});

async function call(name: string, args: Record<string, unknown>): Promise<CallResult> {
  return await client.callTool({ name, arguments: args }) as CallResult;
}

function textOf(result: CallResult): string {
  return (result.content[0] as TextContent).text;
}

/**
 * An article as a listing links it: its title, to the address the TOC gives
 * it, escaped as the TOC's markdown escapes both.
 */
function link(summary: { title: string; url: string }): string {
  return `[${sanitizeMarkdownText(summary.title)}](${sanitizeMarkdownUrl(canonicalStaticUrl(SUPPORT, summary.url))})`;
}

describe('jamf_docs_get_article on a support.jamf.com collection page', () => {
  it('lists the collection\'s articles, on every channel, from its one page', async () => {
    const markdown = await call('jamf_docs_get_article', { url: SELF_SERVICE_URL, maxTokens: 50000 });
    const json = await call('jamf_docs_get_article', { url: SELF_SERVICE_URL, maxTokens: 50000, responseFormat: 'json' });

    for (const result of [markdown, json]) {
      expect(result.isError, textOf(result)).not.toBe(true);
      const structured = result.structuredContent as { title: string; url: string; product: string; breadcrumb: string[]; content: string };
      expect(structured.title).toBe('Self Service+');
      expect(structured.url).toBe(SELF_SERVICE_URL);
      expect(structured.product).toBe(SUPPORT.name);
      expect(structured.breadcrumb).toEqual(['Jamf Pro']);
      // The markdown, or the JSON text's `content`.
      const reply = result === json ? (JSON.parse(textOf(result)) as { content: string }).content : textOf(result);
      for (const text of [structured.content, reply]) {
        expect(text).toContain(SELF_SERVICE.description);
        for (const summary of SELF_SERVICE.articleSummaries) {
          expect(text).toContain(link(summary));
        }
      }
    }
    expect(new Set(requests)).toEqual(new Set([SELF_SERVICE_URL]));
  });

  it('lists the edition in the language asked for, where the site publishes one', async () => {
    const result = await call('jamf_docs_get_article', { url: SELF_SERVICE_URL, language: 'ja-JP', responseFormat: 'json' });

    expect(result.isError, textOf(result)).not.toBe(true);
    const structured = result.structuredContent as { title: string; url: string; content: string };
    expect(structured.title).toBe(SELF_SERVICE_JA.name);
    expect(structured.url).toBe(canonicalStaticUrl(SUPPORT, editionUrl(SELF_SERVICE_PLUS, 'ja')));
    expect(structured.content).toContain(link(SELF_SERVICE_JA.articleSummaries[0]));
    expect(structured.content).not.toContain(link(SELF_SERVICE.articleSummaries[0]));
  });

  it('calls it a collection in the note on a language the site does not publish in', async () => {
    const result = await call('jamf_docs_get_article', { url: SELF_SERVICE_URL, language: 'th-TH', responseFormat: 'json' });

    expect(result.isError, textOf(result)).not.toBe(true);
    const structured = result.structuredContent as { url: string; content: string; contentLocale?: string };
    expect(structured.url).toBe(SELF_SERVICE_URL);
    expect(structured.contentLocale).toBe('en-US');
    expect(structured.content).toContain(
      'Jamf does not publish this collection in th-TH. Showing the en-US edition instead.',
    );
  });

  it('files a subcollection\'s articles under a section of its name', async () => {
    const whole = await call('jamf_docs_get_article', { url: JAMF_PRO_URL, maxTokens: 50000, responseFormat: 'json' });
    expect(whole.isError, textOf(whole)).not.toBe(true);
    const sections = (whole.structuredContent as { sections: { title: string }[] }).sections.map(s => s.title);
    expect(sections).toContain(SELF_SERVICE.name);

    const section = await call('jamf_docs_get_article', {
      url: JAMF_PRO_URL, section: SELF_SERVICE.name, maxTokens: 50000, responseFormat: 'json',
    });
    const { content } = section.structuredContent as { content: string };
    expect(content).toContain(link(SELF_SERVICE.articleSummaries[0]));
    // Jamf Pro's own article is not in Self Service+.
    expect(content).not.toContain(link({ title: RENEW.title, url: RENEW_URL }));
  });

  it('still fails on a page that carries neither an article nor a collection', async () => {
    upstream.pages.set(SELF_SERVICE_URL, nextDataPage({}));
    const result = await call('jamf_docs_get_article', { url: SELF_SERVICE_URL });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain(`Could not read a ${SUPPORT.name} article at ${SELF_SERVICE_URL}`);
  });
});

describe('jamf_docs_get_toc on a support.jamf.com collection: "any URL above"', () => {
  it.each(['full', 'compact'] as const)('every URL the %s markdown lists is one jamf_docs_get_article reads', async (outputMode) => {
    const toc = await call('jamf_docs_get_toc', { publication: 'jamf-support-jamf-pro', outputMode, maxTokens: 50000 });
    expect(toc.isError, textOf(toc)).not.toBe(true);

    const urls = [...textOf(toc).matchAll(/\]\((https:\/\/[^)]+)\)/g)].map(match => match[1]);
    expect(urls).toContain(SELF_SERVICE_URL);
    if (outputMode === 'full') {
      expect(textOf(toc)).toContain('*Use `jamf_docs_get_article` with any URL above to read the full content.*');
    }
    for (const url of urls) {
      const article = await call('jamf_docs_get_article', { url, maxTokens: 500 });
      expect(article.isError, `${url}: ${textOf(article)}`).not.toBe(true);
    }
  });
});

describe('what the two tools say about it', () => {
  async function description(name: string): Promise<string> {
    const { tools } = await client.listTools();
    // Whitespace collapsed: a sentence may wrap anywhere in the template.
    return (tools.find(tool => tool.name === name)?.description ?? '').replace(/\s+/g, ' ');
  }

  it('jamf_docs_get_toc says an entry of a TOC with no map is read by its url, a collection\'s too', async () => {
    expect(await description('jamf_docs_get_toc')).toContain(
      'Read any of its entries by url with jamf_docs_get_article; a support.jamf.com subcollection\'s url ' +
      'is its collection page, which reads as the list of its articles.',
    );
  });

  it('jamf_docs_get_article says what a collection url returns', async () => {
    expect(await description('jamf_docs_get_article')).toContain(
      'A support.jamf.com collection url, which a TOC lists each subcollection by, returns the ' +
      'collection\'s list of articles.',
    );
  });
});
