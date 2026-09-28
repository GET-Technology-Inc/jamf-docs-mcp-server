/**
 * What the markdown of `jamf_docs_get_toc` says about the page it is under,
 * for every kind of source a TOC comes from: the registered tool over MCP,
 * with the real TOC, sitemap and Intercom readers, and only the http client
 * stubbed.
 *
 * Until 2026-09-28 the full footer ended every TOC with "Each entry's
 * `contentId` — the other half of the `mapId` + `contentId` pair — is in the
 * structured output". A concepts.jamf.com or support.jamf.com TOC has
 * neither half: their entries are `title`, `url` and `children`, and they
 * name no map. Live on 2026-09-28 on a build of main, `jamf-concepts-guides`
 * (56 entries, 0 with a `contentId`), `jamf-concepts-tools` and
 * `jamf-support-jamf-pro` (en-US and ja-JP) all said it, with no `mapId` in
 * the reply, while Jamf Pro, Jamf Routines and `jamf-pro-release-notes`, each
 * with a map and a `contentId` on every entry, were the TOCs it was true of.
 * A `TocProvider` can send either half without the other, or `contentId` on
 * some entries only.
 *
 * The line under a page a `TocProvider` cut without saying what it cut
 * advised "Increase `maxTokens`", which at the largest `maxTokens` the schema
 * accepts is advice no request can follow.
 *
 * The tool description made claims of the same kind: that `mapId` is missing
 * only when the map could not be resolved, that every entry carries a
 * `contentId`, and that markdown shows the `mapId`, which compact markdown
 * never did.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { registerGetTocTool } from '../../../src/core/tools/get-toc.js';
import { STATIC_DOC_SOURCES } from '../../../src/core/constants/sources.js';
import { TOKEN_CONFIG } from '../../../src/core/constants.js';
import { HttpError, type HttpClient } from '../../../src/core/http-client.js';
import { createMockContext, createStubMapsRegistry } from '../../helpers/mock-context.js';
import { createSupportUpstream } from '../../helpers/support-upstream.js';
import { PRO_MAP } from '../../helpers/article-upstream.js';
import type { ServerContext } from '../../../src/core/types/context.js';
import type { FetchTocResult, FtTocNode, TocEntry } from '../../../src/core/types.js';

interface TextContent { type: 'text'; text: string }

interface CallResult {
  isError?: boolean;
  content: unknown[];
  structuredContent?: Record<string, unknown>;
}

interface FlatEntry { title: string; url: string; contentId?: string; depth: number }

// ── Upstream ────────────────────────────────────────────────────────────────

const CONCEPTS = STATIC_DOC_SOURCES['jamf-concepts'];
const SUPPORT_HOST = new URL(STATIC_DOC_SOURCES['jamf-support'].baseUrl).hostname;
const CONCEPTS_HOST = new URL(CONCEPTS.baseUrl).hostname;

/** A few of the paths each locale lists live, in both sections. */
const CONCEPTS_PATHS = [
  'guides', 'guides/ai-governance', 'guides/ai-governance/ai-governance-enforcement-with-jamf-extender',
  'concepts', 'concepts/apiutil', 'concepts/jamf-sync',
];

const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset>${
  ['en', 'ja'].flatMap(code => CONCEPTS_PATHS.map(path => `${CONCEPTS.baseUrl}/${code}/${path}`))
    .map(loc => `<url><loc>${loc}</loc><lastmod>2026-09-28</lastmod></url>`)
    .join('')
}</urlset>`;

/** Jamf Pro's current map, as `GET …/maps/{mapId}/toc` sends it: a contentId on every node. */
const PRO_TREE: FtTocNode[] = [
  {
    tocId: 'toc-1', contentId: 'content-1', title: 'Jamf Pro Documentation',
    prettyUrl: '/r/en-US/jamf-pro-documentation-current/Jamf_Pro_Documentation',
    children: [{
      tocId: 'toc-2', contentId: 'content-2', title: 'Applications and Utilities',
      prettyUrl: '/r/en-US/jamf-pro-documentation-current/Applications_and_Utilities',
    }],
  },
  {
    tocId: 'toc-3', contentId: 'content-3', title: 'Smart Groups',
    prettyUrl: '/r/en-US/jamf-pro-documentation-current/Smart_Groups',
  },
];

/** Every `contentId` in `PRO_TREE`, in document order. */
const PRO_CONTENT_IDS = ['content-1', 'content-2', 'content-3'];

const support = createSupportUpstream();

const http: HttpClient = {
  getText: async (url) => {
    const { hostname } = new URL(url);
    if (hostname === SUPPORT_HOST) { return await support.http.getText(url); }
    if (hostname === CONCEPTS_HOST && url === `${CONCEPTS.baseUrl}/sitemap.xml`) { return SITEMAP; }
    throw new HttpError(404, 'Not Found', url);
  },
  getJson: async <T>(url: string): Promise<T> => {
    if (decodeURIComponent(new URL(url).pathname) === `/api/khub/maps/${PRO_MAP}/toc`) {
      return await Promise.resolve(PRO_TREE as T);
    }
    throw new HttpError(404, 'Not Found', url);
  },
  postJson: async (url) => await Promise.reject(new HttpError(404, 'Not Found', url)),
};

// ── Harness ─────────────────────────────────────────────────────────────────

let ctx: ServerContext;
let server: McpServer;
let client: Client;

beforeAll(async () => {
  const mapsRegistry = createStubMapsRegistry([]);
  mapsRegistry.resolveMap = vi.fn(async () => await Promise.resolve({
    mapId: PRO_MAP, title: 'Jamf Pro Documentation', resolvedLocale: 'en-US',
  }));
  ctx = createMockContext({ http, mapsRegistry });
  server = new McpServer({ name: 'test', version: '0.0.1' });
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
  delete ctx.tocProvider;
  support.reset();
  await ctx.cache.clear();
});

async function getToc(args: Record<string, unknown>): Promise<CallResult> {
  return await client.callTool({ name: 'jamf_docs_get_toc', arguments: args }) as CallResult;
}

function textOf(result: CallResult): string {
  return (result.content[0] as TextContent).text;
}

function entriesOf(result: CallResult): FlatEntry[] {
  return result.structuredContent?.entries as FlatEntry[];
}

/** The full footer's line for a TOC whose every entry has a `contentId`. */
const EVERY_ENTRY =
  '*Each entry\'s `contentId` — the other half of the `mapId` + `contentId` pair — is in the ' +
  'structured output; request `responseFormat="json"` to see it inline.*';

/** The same line for a TOC where only some entries have one. */
const SOME_ENTRIES =
  '*Each entry\'s `contentId`, where it has one, is the other half of the `mapId` + `contentId` ' +
  'pair, and is in the structured output; request `responseFormat="json"` to see it inline.*';

// ── Fluid Topics ────────────────────────────────────────────────────────────

describe('a Fluid Topics table of contents', () => {
  it('says where each entry\'s contentId is, beside the map it pairs with', async () => {
    const markdown = await getToc({ product: 'jamf-pro' });
    const json = await getToc({ product: 'jamf-pro', responseFormat: 'json' });

    expect(markdown.isError, textOf(markdown)).not.toBe(true);
    expect(textOf(markdown)).toContain(`**Map ID**: ${PRO_MAP}`);
    expect(textOf(markdown)).toContain(EVERY_ENTRY);
    // The mapId only, as the description says: the contentIds are not inline.
    for (const contentId of PRO_CONTENT_IDS) {
      expect(textOf(markdown)).not.toContain(contentId);
    }
    // What the line says is so: the map, and a contentId on every entry.
    expect(json.structuredContent?.mapId).toBe(PRO_MAP);
    expect(entriesOf(json).map(entry => entry.contentId)).toEqual(PRO_CONTENT_IDS);
  });

  it('ends the footer with that line, after the one that says to read an entry by its URL', async () => {
    const text = textOf(await getToc({ product: 'jamf-pro' }));

    expect(text.slice(text.lastIndexOf('\n\n*Use `jamf_docs_get_article`'))).toBe(
      `\n\n*Use \`jamf_docs_get_article\` with any URL above to read the full content.*\n${EVERY_ENTRY}\n`,
    );
  });

  it('says nothing of it in compact mode, which shows neither half', async () => {
    const compact = await getToc({ product: 'jamf-pro', outputMode: 'compact' });

    expect(compact.isError, textOf(compact)).not.toBe(true);
    expect(textOf(compact)).toContain('Jamf Pro Documentation');
    expect(textOf(compact)).not.toContain('contentId');
    expect(textOf(compact)).not.toContain('Map ID');
    expect(textOf(compact)).not.toContain(PRO_MAP);
    for (const contentId of PRO_CONTENT_IDS) {
      expect(textOf(compact)).not.toContain(contentId);
    }
  });
});

// ── Sources with no map ─────────────────────────────────────────────────────

const MAPLESS: [string, Record<string, unknown>][] = [
  ['the concepts.jamf.com guides', { publication: 'jamf-concepts-guides' }],
  ['the concepts.jamf.com tools', { publication: 'jamf-concepts-tools' }],
  ['the concepts.jamf.com guides in ja-JP', { publication: 'jamf-concepts-guides', language: 'ja-JP' }],
  ['a support.jamf.com collection', { publication: 'jamf-support-jamf-pro' }],
  ['a support.jamf.com collection in ja-JP', { publication: 'jamf-support-jamf-pro', language: 'ja-JP' }],
];

describe('a table of contents from a source with no map', () => {
  it.each(MAPLESS)('%s has neither half of the pair', async (_label, args) => {
    const json = await getToc({ ...args, responseFormat: 'json' });

    expect(json.isError, textOf(json)).not.toBe(true);
    expect(entriesOf(json).length).toBeGreaterThan(0);
    expect(json.structuredContent).not.toHaveProperty('mapId');
    expect(entriesOf(json).filter(entry => 'contentId' in entry)).toEqual([]);
    // What the description says such an entry carries, at every depth.
    const body = JSON.parse(textOf(json)) as { mapId?: unknown; toc: TocEntry[] };
    expect(body).not.toHaveProperty('mapId');
    const fields = new Set<string>();
    const visit = (entries: TocEntry[]): void => {
      for (const entry of entries) {
        Object.keys(entry).forEach(key => fields.add(key));
        visit(entry.children ?? []);
      }
    };
    visit(body.toc);
    expect([...fields]).toEqual(expect.arrayContaining(['title', 'url']));
    expect([...fields].filter(key => !['title', 'url', 'children'].includes(key))).toEqual([]);
  });

  it.each(MAPLESS)('%s does not say its entries have a contentId, in full or compact markdown', async (_label, args) => {
    for (const outputMode of ['full', 'compact'] as const) {
      const markdown = await getToc({ ...args, outputMode });

      expect(markdown.isError, textOf(markdown)).not.toBe(true);
      expect(textOf(markdown)).not.toContain('contentId');
      expect(textOf(markdown)).not.toContain('mapId');
      expect(textOf(markdown)).not.toContain('Map ID');
    }
  });
});

// ── A TocProvider ───────────────────────────────────────────────────────────

describe('a TocProvider\'s table of contents', () => {
  /** A section with an article under it, and an article at the top level, each with the contentId given. */
  function tree(ids: { section?: string; under?: string; top?: string }): TocEntry[] {
    const id = (contentId: string | undefined): { contentId?: string } =>
      contentId !== undefined ? { contentId } : {};
    return [
      {
        title: 'Computer Management',
        url: 'https://docs.example.com/computer-management',
        ...id(ids.section),
        children: [{ title: 'Smart Groups', url: 'https://docs.example.com/smart-groups', ...id(ids.under) }],
      },
      { title: 'Inventory', url: 'https://docs.example.com/inventory', ...id(ids.top) },
    ];
  }

  const EVERY = { section: 'content-s', under: 'content-a', top: 'content-b' };

  function provide(toc: TocEntry[], mapId?: string, tokenInfo?: Partial<FetchTocResult['tokenInfo']>): void {
    const count = (entries: TocEntry[]): number =>
      entries.reduce((sum, entry) => sum + 1 + count(entry.children ?? []), 0);
    const result: FetchTocResult = {
      toc,
      pagination: { page: 1, pageSize: 10, totalPages: 1, totalItems: count(toc), hasNext: false, hasPrev: false },
      tokenInfo: { tokenCount: 30, truncated: false, maxTokens: TOKEN_CONFIG.DEFAULT_MAX_TOKENS, ...tokenInfo },
      ...(mapId !== undefined ? { mapId } : {}),
    };
    ctx.tocProvider = { getTableOfContents: vi.fn(async () => await Promise.resolve(result)) };
  }

  it('says each entry has one when every entry, at every depth, does', async () => {
    provide(tree(EVERY), PRO_MAP);
    const markdown = await getToc({ product: 'jamf-pro' });

    expect(textOf(markdown)).toContain(EVERY_ENTRY);
    expect(textOf(markdown)).not.toContain(SOME_ENTRIES);
  });

  it.each([
    ['only the articles have one, as a provider\'s sections may not', { under: 'content-a', top: 'content-b' },
      [undefined, 'content-a', 'content-b']],
    ['an entry under a top-level one has none', { section: 'content-s', top: 'content-b' },
      ['content-s', undefined, 'content-b']],
    ['one has an empty one', { ...EVERY, top: '' }, ['content-s', 'content-a', '']],
  ])('says "where it has one" when %s', async (_label, ids, contentIds) => {
    provide(tree(ids), PRO_MAP);
    const markdown = await getToc({ product: 'jamf-pro' });
    const json = await getToc({ product: 'jamf-pro', responseFormat: 'json' });

    expect(textOf(markdown)).toContain(SOME_ENTRIES);
    expect(textOf(markdown)).not.toContain(EVERY_ENTRY);
    expect(entriesOf(json).map(entry => entry.contentId)).toEqual(contentIds);
  });

  it.each([
    ['names no map', undefined],
    ['names an empty map', ''],
  ])('says nothing of the pair when it %s, since there is no map to pair a contentId with', async (_label, mapId) => {
    provide(tree(EVERY), mapId);
    const markdown = await getToc({ product: 'jamf-pro' });

    expect(markdown.isError, textOf(markdown)).not.toBe(true);
    expect(textOf(markdown)).toContain('- [Computer Management](');
    expect(textOf(markdown)).not.toContain('contentId');
    expect(textOf(markdown)).not.toContain('Map ID');
  });

  it.each([
    ['no entry has one', tree({})],
    ['every contentId is empty', tree({ section: '', under: '', top: '' })],
    ['the page has no entries', []],
  ])('says nothing of the pair when %s, though it names a map', async (_label, toc) => {
    provide(toc, PRO_MAP);
    const markdown = await getToc({ product: 'jamf-pro' });

    expect(markdown.isError, textOf(markdown)).not.toBe(true);
    expect(textOf(markdown)).toContain(`**Map ID**: ${PRO_MAP}`);
    expect(textOf(markdown)).not.toContain('contentId');
  });

  describe('a page it cut without saying what it cut', () => {
    const ADVICE = 'Increase `maxTokens` to see them.';

    it.each([1000, TOKEN_CONFIG.MAX_TOKENS_LIMIT - 1])('is told to increase maxTokens below the largest one (%i)', async maxTokens => {
      provide(tree(EVERY), PRO_MAP, { truncated: true, maxTokens });
      const markdown = await getToc({ product: 'jamf-pro', maxTokens });

      expect(textOf(markdown)).toContain(
        '*TOC truncated due to token limit: entries on this page were left out. Increase `maxTokens` to see them.*',
      );
    });

    it('is not told to increase maxTokens at the largest one, which no request can', async () => {
      provide(tree(EVERY), PRO_MAP, { truncated: true, maxTokens: TOKEN_CONFIG.MAX_TOKENS_LIMIT });
      const markdown = await getToc({ product: 'jamf-pro', maxTokens: TOKEN_CONFIG.MAX_TOKENS_LIMIT });

      expect(textOf(markdown)).not.toContain(ADVICE);
      expect(textOf(markdown)).toContain(
        '*TOC truncated due to token limit: entries on this page were left out, and `maxTokens` is ' +
        `already the largest it can be (${String(TOKEN_CONFIG.MAX_TOKENS_LIMIT)}).*`,
      );
    });
  });
});

// ── The description ─────────────────────────────────────────────────────────

describe('the tool description', () => {
  async function description(): Promise<string> {
    const { tools } = await client.listTools();
    // Whitespace collapsed: a sentence may wrap anywhere in the template.
    return (tools.find(tool => tool.name === 'jamf_docs_get_toc')?.description ?? '').replace(/\s+/g, ' ');
  }

  it('says which tables of contents carry mapId and contentId, not that mapId is missing only when unresolved', async () => {
    const prose = await description();

    expect(prose).not.toContain('could not be resolved');
    expect(prose).toContain(
      '"mapId": string, // absent for a concepts.jamf.com or support.jamf.com TOC, // and when a TOC provider names no map',
    );
    expect(prose).toContain('"toc": [...], // each entry: title, url, and contentId when from a map');
  });

  it('says which markdown shows the mapId, and what an entry of a TOC with no map carries', async () => {
    const prose = await description();

    // Compact markdown shows neither half, as the Fluid Topics tests above check.
    expect(prose).not.toContain('Markdown output shows the mapId only');
    expect(prose).toContain('Full markdown shows the mapId only, and compact markdown shows neither;');
    // Not "read its entries by url": a support.jamf.com subcollection's url
    // is a collection page, which jamf_docs_get_article cannot read.
    expect(prose).toContain(
      'A concepts.jamf.com or support.jamf.com TOC has neither: it names no map, and its entries carry only ' +
      'title, url and children.',
    );
  });
});
