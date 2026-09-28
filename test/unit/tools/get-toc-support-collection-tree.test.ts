/**
 * The tree `jamf_docs_get_toc` reads from a support.jamf.com collection page,
 * against the list of articles `jamf_docs_get_article` reads from the same
 * page: the registered tools over MCP, with the real Intercom readers and
 * cache, and only the http client stubbed.
 *
 * Until 2026-09-28 the two read the page's `collection` differently. The
 * list, added by #378, reads each field as absent unless it has the type it
 * should, and a subcollection's own subcollections at any depth. The tree
 * read the fields as given, one level of subcollections deep: a `null` among
 * a page's subcollections failed `get_toc` with "Cannot read properties of
 * null (reading 'articleSummaries')" where `get_article` listed the page,
 * and a nested subcollection's articles were in no entry. None of the 97
 * subcollections on support.jamf.com's 22 collection pages was nested, and
 * none of their fields was mistyped, that day.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { registerGetArticleTool } from '../../../src/core/tools/get-article.js';
import { registerGetTocTool } from '../../../src/core/tools/get-toc.js';
import { STATIC_DOC_SOURCES } from '../../../src/core/constants/sources.js';
import { createMockContext, createStubMapsRegistry } from '../../helpers/mock-context.js';
import type { ServerContext } from '../../../src/core/types/context.js';
import { createStaticEditionsUpstream } from '../../helpers/static-editions-upstream.js';
import { nextDataPage } from '../../helpers/support-upstream.js';

interface TextContent { type: 'text'; text: string }

interface CallResult {
  isError?: boolean;
  content: unknown[];
  structuredContent?: Record<string, unknown>;
}

interface Entry { title: string; url: string; depth: number }

const SUPPORT = STATIC_DOC_SOURCES['jamf-support'];
const ORIGIN = SUPPORT.baseUrl;

const JAMF_PRO_URL = `${ORIGIN}/en/collections/12369024-jamf-pro`;
const article = (id: string, title: string): { title: string; url: string } =>
  ({ title, url: `${ORIGIN}/en/articles/${id}` });
const collection = (id: string): string => `${ORIGIN}/en/collections/${id}`;

const upstream = createStaticEditionsUpstream();

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
});

/** The en home page listing Jamf Pro, and Jamf Pro's page carrying `jamfPro` as its collection. */
function serveJamfPro(jamfPro: Record<string, unknown>, pageProps: Record<string, unknown> = {}): void {
  upstream.pages.set(`${ORIGIN}/en/`, nextDataPage({
    home: {
      collections: [{
        id: '12369024', slug: 'jamf-pro', name: 'Jamf Pro', description: '', url: JAMF_PRO_URL, articleCount: 3,
      }],
    },
  }));
  upstream.pages.set(JAMF_PRO_URL, nextDataPage({
    collection: { id: '12369024', name: 'Jamf Pro', description: '', url: JAMF_PRO_URL, ...jamfPro },
    breadcrumbs: [],
    localeLinks: [{ id: 'en', absoluteUrl: JAMF_PRO_URL, available: true, selected: true }],
    ...pageProps,
  }));
}

async function call(name: string, args: Record<string, unknown>): Promise<CallResult> {
  return await client.callTool({ name, arguments: args }) as CallResult;
}

function textOf(result: CallResult): string {
  return (result.content[0] as TextContent).text;
}

/** Every entry of Jamf Pro's TOC, from its structuredContent, with its depth. */
async function tocEntries(): Promise<Entry[]> {
  const result = await call('jamf_docs_get_toc', { publication: 'jamf-support-jamf-pro', maxTokens: 50000 });
  expect(result.isError, textOf(result)).not.toBe(true);
  return (result.structuredContent as { entries: Entry[] }).entries
    .map(({ title, url, depth }) => ({ title, url, depth }));
}

/** Every url Jamf Pro's list of articles links to, in its order. */
async function listedUrls(): Promise<string[]> {
  const result = await call('jamf_docs_get_article', { url: JAMF_PRO_URL, maxTokens: 50000, responseFormat: 'json' });
  expect(result.isError, textOf(result)).not.toBe(true);
  const { content } = result.structuredContent as { content: string };
  return [...content.matchAll(/\]\((https:\/\/[^)]+)\)/g)].map(match => match[1]);
}

describe('jamf_docs_get_toc: a support.jamf.com collection\'s subcollections', () => {
  it('files a nested subcollection, and its articles, under the one it is in', async () => {
    serveJamfPro({
      articleSummaries: [article('1-own', 'Own article')],
      subcollections: [{
        name: 'Push Certificates',
        url: collection('2-push-certificates'),
        articleSummaries: [article('3-renew', 'Renew')],
        subcollections: [{
          name: 'Legacy',
          url: collection('4-legacy'),
          articleSummaries: [article('5-old', 'Old')],
          subcollections: [],
        }],
      }],
    });

    expect(await tocEntries()).toEqual([
      { title: 'Own article', url: `${ORIGIN}/en/articles/1-own`, depth: 0 },
      { title: 'Push Certificates', url: collection('2-push-certificates'), depth: 0 },
      { title: 'Renew', url: `${ORIGIN}/en/articles/3-renew`, depth: 1 },
      { title: 'Legacy', url: collection('4-legacy'), depth: 1 },
      { title: 'Old', url: `${ORIGIN}/en/articles/5-old`, depth: 2 },
    ]);
    // The same page read as a list of articles links every one of them.
    expect(await listedUrls()).toEqual([
      `${ORIGIN}/en/articles/1-own`, `${ORIGIN}/en/articles/3-renew`, `${ORIGIN}/en/articles/5-old`,
    ]);
  });

  it('reads a page whose lists and entries are mistyped, as the list of articles reads it', async () => {
    serveJamfPro({
      articleSummaries: [null, 7, article('1-own', 'Own article'), { title: 5, url: `${ORIGIN}/en/articles/2-numbered` }],
      subcollections: [
        null,
        'Push Certificates',
        { name: null, url: null, articleSummaries: null, subcollections: {} },
        { name: 'Self Service+', url: collection('3-self-service'), articleSummaries: { title: 'not a list' }, subcollections: [null] },
      ],
    });

    expect(await tocEntries()).toEqual([
      { title: 'Own article', url: `${ORIGIN}/en/articles/1-own`, depth: 0 },
      { title: '5', url: `${ORIGIN}/en/articles/2-numbered`, depth: 0 },
      // No name and no url: read as the list reads them, and kept, as an
      // entry with no title has always been.
      { title: 'Untitled', url: '', depth: 0 },
      { title: 'Self Service+', url: collection('3-self-service'), depth: 0 },
    ]);
    expect(await listedUrls()).toEqual([`${ORIGIN}/en/articles/1-own`, `${ORIGIN}/en/articles/2-numbered`]);
  });

  it.each([
    ['null', null],
    ['an object', { name: 'Push Certificates' }],
    ['a string', 'Push Certificates'],
  ])('reads a subcollections list that is %s as none', async (_, subcollections) => {
    serveJamfPro({ articleSummaries: [article('1-own', 'Own article')], subcollections });

    expect(await tocEntries()).toEqual([{ title: 'Own article', url: `${ORIGIN}/en/articles/1-own`, depth: 0 }]);
  });

  // Until 2026-09-28 `get_article` failed on a `null` ("Cannot read
  // properties of null (reading 'blocks')"), and served a page with `{}` or
  // no blocks as "Untitled", with nothing in it. `get_toc` read the tree of
  // each, as it must go on doing. None of the 9 en collection pages carried
  // an articleContent on 2026-09-28.
  it.each([
    ['null', null],
    ['{}', {}],
    ['an article with no blocks', { title: 'Stray', blocks: [] }],
  ])('reads a collection page whose articleContent is %s as a collection, in both tools', async (_, articleContent) => {
    serveJamfPro({ articleSummaries: [article('1-own', 'Own article')], subcollections: [] }, { articleContent });

    expect(await tocEntries()).toEqual([{ title: 'Own article', url: `${ORIGIN}/en/articles/1-own`, depth: 0 }]);
    expect(await listedUrls()).toEqual([`${ORIGIN}/en/articles/1-own`]);
    const listing = await call('jamf_docs_get_article', { url: JAMF_PRO_URL, responseFormat: 'json' });
    expect(listing.structuredContent).toMatchObject({ title: 'Jamf Pro' });
  });

  it('reads the tree of a page that carries a collection beside an article with a body, which get_article serves', async () => {
    serveJamfPro(
      { articleSummaries: [article('1-own', 'Own article')], subcollections: [] },
      { articleContent: { title: 'An article', blocks: [{ type: 'paragraph', text: 'Its body.' }] } },
    );

    const served = await call('jamf_docs_get_article', { url: JAMF_PRO_URL, responseFormat: 'json' });
    expect(served.structuredContent).toMatchObject({ title: 'An article' });
    expect((served.structuredContent as { content: string }).content).toContain('Its body.');
    expect(await tocEntries()).toEqual([{ title: 'Own article', url: `${ORIGIN}/en/articles/1-own`, depth: 0 }]);
    // get_article kept the tree it read, as it does a collection page's.
    expect(upstream.requests.filter(url => url === JAMF_PRO_URL)).toHaveLength(1);
  });
});
