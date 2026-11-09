/**
 * concepts.jamf.com as it is published since early November 2026: English
 * only. On 2026-11-09 its sitemap lists 85 paths, all under /en/, and /ja/,
 * /de/, /zh-TW/ and every other code it used to publish under answer 404,
 * their section indexes included. Until then it published ten editions, and
 * `jamf_docs_get_toc` read /ja/guides/ for ja-JP: from that day a 404 that
 * failed the contract check, and an empty table of contents for every
 * language but English.
 *
 * The registered tools over MCP, with only the http client stubbed, by a
 * site shaped like the live one.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { registerGetTocTool } from '../../../src/core/tools/get-toc.js';
import { registerGetArticleTool } from '../../../src/core/tools/get-article.js';
import { STATIC_DOC_SOURCES } from '../../../src/core/constants/sources.js';
import { SUPPORTED_LOCALE_IDS } from '../../../src/core/constants/locales.js';
import { HttpError, type HttpClient } from '../../../src/core/http-client.js';
import { createMockContext, createStubMapsRegistry } from '../../helpers/mock-context.js';
import type { ServerContext } from '../../../src/core/types/context.js';

interface TextContent { type: 'text'; text: string }

interface CallResult {
  isError?: boolean;
  content: unknown[];
  structuredContent?: Record<string, unknown>;
}

const CONCEPTS = STATIC_DOC_SOURCES['jamf-concepts'];
const ORIGIN = CONCEPTS.baseUrl;

/** A few of the live paths, all under /en/ (2026-11-09). */
const PATHS = [
  '', 'about', 'browse', 'ecosystem',
  'guides', 'guides/ai-governance', 'guides/ai-governance/ai-governance-enforcement-with-jamf-extender',
  'concepts', 'concepts/apiutil', 'concepts/jamf-sync',
];

const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset>${
  PATHS.map(path => `<url><loc>${ORIGIN}/en${path === '' ? '' : `/${path}`}</loc><lastmod>2026-11-09</lastmod></url>`)
    .join('')
}</urlset>`;

const GUIDE_URL = `${ORIGIN}/en/guides/ai-governance/`;
const GUIDE_HTML = '<html lang="en"><body><main><article class="prose">'
  + '<h1>AI Governance</h1><p>How to govern AI tools on managed Macs.</p>'
  + '</article></main></body></html>';

/** Every url requested, in order. */
const requests: string[] = [];

const http: HttpClient = {
  getText: async (url) => {
    requests.push(url);
    if (url === `${ORIGIN}/sitemap.xml`) { return await Promise.resolve(SITEMAP); }
    if (url === GUIDE_URL) { return await Promise.resolve(GUIDE_HTML); }
    throw new HttpError(404, 'Not Found', url);
  },
  getJson: async (url) => await Promise.reject(new HttpError(404, 'Not Found', url)),
  postJson: async (url) => await Promise.reject(new HttpError(404, 'Not Found', url)),
};

let ctx: ServerContext;
let server: McpServer;
let client: Client;

beforeAll(async () => {
  ctx = createMockContext({ http, mapsRegistry: createStubMapsRegistry([]) });
  server = new McpServer({ name: 'test', version: '0.0.1' });
  registerGetTocTool(server, ctx);
  registerGetArticleTool(server, ctx);
  client = new Client({ name: 'test-client', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  await client.listTools();
});

afterAll(async () => {
  await client.close();
  await server.close();
});

beforeEach(async () => {
  await ctx.cache.clear();
  requests.length = 0;
});

async function call(name: string, args: Record<string, unknown>): Promise<CallResult> {
  return await client.callTool({ name, arguments: args }) as CallResult;
}

function textOf(result: CallResult): string {
  return (result.content[0] as TextContent).text;
}

const OTHER_LANGUAGES = SUPPORTED_LOCALE_IDS.filter(id => id !== 'en-US');

describe('concepts.jamf.com, English only', () => {
  it('is declared in en-US alone', () => {
    expect(CONCEPTS.locales).toEqual({ 'en-US': 'en' });
  });

  it.each(CONCEPTS.sections.flatMap(section =>
    OTHER_LANGUAGES.map(language => [section.id, section.path, language] as const)))(
    'jamf_docs_get_toc serves %s in %s as the en edition, says so, and asks for no other edition',
    async (publication, path, language) => {
      const json = await call('jamf_docs_get_toc', { publication, language, responseFormat: 'json' });

      expect(json.isError, textOf(json)).not.toBe(true);
      const entries = json.structuredContent?.entries as { url: string }[];
      expect(entries.length).toBeGreaterThan(0);
      expect(entries.every(entry => new URL(entry.url).pathname.startsWith(`/en/${path}/`))).toBe(true);
      expect(json.structuredContent?.localeNote)
        .toBe(`Jamf does not publish this document in ${language}. Showing the en-US edition instead.`);
      expect([...requests].sort()).toEqual([`${ORIGIN}/en/${path}/`, `${ORIGIN}/sitemap.xml`]);
    },
  );

  it.each(OTHER_LANGUAGES)('jamf_docs_get_article serves an en page asked for in %s, and says so', async (language) => {
    const result = await call('jamf_docs_get_article', { url: GUIDE_URL, language, responseFormat: 'json' });

    expect(result.isError, textOf(result)).not.toBe(true);
    expect(result.structuredContent?.url).toBe(GUIDE_URL);
    expect(textOf(result)).toContain('How to govern AI tools on managed Macs.');
    expect(result.structuredContent?.contentLocale).toBe('en-US');
    expect(textOf(result)).toContain(
      `Jamf does not publish this article in ${language}. Showing the en-US edition instead.`);
    // No edition is asked for, so no 404 is paid before the page.
    expect(requests).toEqual([GUIDE_URL]);
  });
});
