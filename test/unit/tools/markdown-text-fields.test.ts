/**
 * Text a reply's markdown quotes from Fluid Topics or a provider is escaped,
 * and written on one line.
 *
 * `sanitizeMarkdownText` escapes such text wherever markdown quotes it: a
 * title, a snippet, a breadcrumb. Until 2026-09-28 two gaps were left:
 *
 * - `jamf_docs_search` wrote a result's **Product** and **Version**, and the
 *   versions under **Also in**, as they came. A SearchProvider's value was
 *   then markdown: a product `<img src=x onerror=…>` was an image tag, and a
 *   version `[x](https://…)` a link. A Fluid Topics result's product is one
 *   of Jamf's product names and its version a version number (#363), and no
 *   name or number holds a character that is escaped, so these are unchanged
 *   for it.
 * - The text was escaped, but not kept on one line. A title holding a
 *   newline ended the heading, list item or quote it was written into, and
 *   the next line could start a block of its own: in `get_toc`, the title
 *   "Policies\n- [Injected](https://evil.example)" was two list items, the
 *   second a link GFM made of the escaped URL. The other controls and the
 *   bidi overrides, which make "exe.gnp" read as "png.exe", were kept too.
 *   Now a line break or tab, with the spaces around it, is one space, and
 *   the other controls and bidi marks are dropped. None of 20,431 Fluid
 *   Topics search entries (titles, excerpts, map titles, 69,492 breadcrumb
 *   steps) nor any title in the tables of contents and listings read on
 *   2026-09-28 holds one, so the text of those is unchanged.
 *
 * structuredContent and the JSON text keep every value as it came.
 *
 * Every case drives the registered tool over MCP, with only the http client
 * and, where named, a provider stubbed.
 */

import { describe, it, expect } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { registerGetTocTool } from '../../../src/core/tools/get-toc.js';
import { MapsRegistry } from '../../../src/core/services/maps-registry.js';
import { PRESTAGE, callSearch, searchUpstream } from '../../helpers/search-upstream.js';
import { PRO_MAP, articleUpstream } from '../../helpers/article-upstream.js';
import { createMockCache, createMockContext } from '../../helpers/mock-context.js';
import type { HttpClient } from '../../../src/core/http-client.js';
import type { FetchTocResult, FtMapInfo, FtSearchEntry, SearchResult } from '../../../src/core/types.js';
import type { ServerContext } from '../../../src/core/types/context.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

/** A line break of each kind, a tab, other controls and a bidi override. */
const BROKEN = 'Computer\nPreStage\r\n\tEnrollments\u2028#\u0000 Injected\u0085\u009b\u202egnp.exe';
/** What markdown writes of {@link BROKEN}. */
const BROKEN_WRITTEN = 'Computer PreStage Enrollments \\# Injected gnp.exe';

/**
 * An excerpt with a paragraph break and a bidi override. Not {@link BROKEN}:
 * the excerpt is read as HTML, which turns CR LF into LF and drops NUL.
 */
const EXCERPT = 'Configure and deploy the Setup Assistant settings.\n\n# Injected\u202egnp.exe';

/** A Fluid Topics entry with {@link BROKEN} in its title and breadcrumb, and {@link EXCERPT}. */
const BROKEN_ENTRY: FtSearchEntry = {
  ...PRESTAGE,
  topic: {
    ...PRESTAGE.topic!,
    title: BROKEN,
    breadcrumb: ['Enrollment\n## Steps', BROKEN],
    htmlExcerpt: `<span class="kwicstring">${EXCERPT}</span>`,
  },
};

/** A provider's result, with markup where markdown writes its product and versions. */
const PROVIDED: SearchResult = {
  title: 'Shared iPad User Management',
  url: 'https://learn.jamf.com/r/en-US/jamf-pro-documentation-current/Shared_iPad_User_Management',
  snippet: 'Before you begin, see Prepare Shared iPad in Apple documentation.',
  product: 'Jamf Pro <img src=x onerror=alert(1)> **bold** [x](https://evil.example)',
  version: '11.32.0 <b>*new*</b>',
  otherVersions: ['11.31.0 [older](https://evil.example)', '11.30.0\n# Injected', '_11.29.0_', '11.28.0'],
};

// ── Harness ─────────────────────────────────────────────────────────────────

interface Result { title: string; snippet: string; product: string; version?: string; breadcrumb?: string[]; otherVersions?: string[] }

async function search(ctx: ServerContext, args: Record<string, unknown> = {}): Promise<{ text: string; results: Result[] }> {
  const reply = await callSearch(ctx, { query: 'prestage', ...args });
  expect(reply.isError, reply.text).not.toBe(true);
  return { text: reply.text, results: (reply.structuredContent?.results ?? []) as Result[] };
}

/** The lines of `markdown` from the first result's heading to its `---`. */
function firstResult(markdown: string): string[] {
  const lines = markdown.split('\n');
  const start = lines.findIndex(line => line.startsWith('### '));
  expect(start).toBeGreaterThan(-1);
  const end = lines.indexOf('---', start);
  return lines.slice(start, end);
}

const PRO_DOCS: FtMapInfo = {
  id: PRO_MAP,
  title: 'Jamf Pro Documentation 11.32.0',
  mapApiEndpoint: `/api/khub/maps/${PRO_MAP}`,
  metadata: [
    { key: 'version_bundle_stem', label: 'version_bundle_stem', values: ['jamf-pro-documentation'] },
    { key: 'bundle', label: 'bundle', values: ['jamf-pro-documentation-current'] },
    { key: 'version', label: 'version', values: ['11.32.0'] },
    { key: 'latestVersion', label: 'latestVersion', values: ['yes'] },
    { key: 'ft:locale', label: 'ft:locale', values: ['en-US'] },
  ],
};

/** `jamf_docs_get_toc` for Jamf Pro, answered by a TocProvider with `toc`. */
async function tocOf(toc: FetchTocResult, args: Record<string, unknown> = {}): Promise<{ text: string; entries: { title: string }[] }> {
  const upstream = articleUpstream();
  const http: HttpClient = {
    getJson: upstream.getJson as HttpClient['getJson'],
    getText: upstream.getText,
    postJson: async u => await Promise.reject(new Error(`offline: no fixture for ${u}`)),
  };
  const cache = createMockCache();
  const ctx = createMockContext({
    cache, http,
    mapsRegistry: new MapsRegistry(cache, undefined, { getMaps: async () => await Promise.resolve([PRO_DOCS]) }, undefined, http),
    tocProvider: { getTableOfContents: async () => await Promise.resolve(toc) },
  });
  const server = new McpServer({ name: 'test-server', version: '0.0.1' });
  registerGetTocTool(server, ctx);
  const client = new Client({ name: 'test-client', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    await client.listTools();
    const result = await client.callTool({ name: 'jamf_docs_get_toc', arguments: { product: 'jamf-pro', ...args } });
    const { text } = (result.content as { text: string }[])[0] ?? { text: '' };
    expect(result.isError, text).not.toBe(true);
    return { text, entries: (result.structuredContent as { entries: { title: string }[] }).entries };
  } finally {
    await client.close();
    await server.close();
  }
}

// ── Product and version ─────────────────────────────────────────────────────

describe('jamf_docs_search escapes the product and versions a SearchProvider gives', () => {
  it('writes **Product**, **Version** and **Also in** as text', async () => {
    const { ctx } = searchUpstream({ provider: [PROVIDED] });
    const { text } = await search(ctx);

    const meta = firstResult(text).find(line => line.startsWith('**Product**'));
    expect(meta).toBe(
      '**Product**: Jamf Pro \\<img src=x onerror=alert\\(1\\)\\> \\*\\*bold\\*\\* \\[x\\]\\(https://evil.example\\) | '
      + '**Version**: 11.32.0 \\<b\\>\\*new\\*\\</b\\> | '
      + '**Also in**: 11.31.0 \\[older\\]\\(https://evil.example\\), 11.30.0 \\# Injected, \\_11.29.0\\_ +1 more '
      + '(pass `version` to fetch one)',
    );
  });

  it('keeps the values as the provider gave them in structuredContent and the JSON text', async () => {
    const { ctx } = searchUpstream({ provider: [PROVIDED] });
    const structured = (await search(ctx)).results;
    const json = (JSON.parse((await search(ctx, { responseFormat: 'json' })).text) as { results: Result[] }).results;

    for (const results of [structured, json]) {
      expect(results).toHaveLength(1);
      const [result] = results;
      expect(result.product).toBe(PROVIDED.product);
      expect(result.version).toBe(PROVIDED.version);
      expect(result.otherVersions).toEqual(PROVIDED.otherVersions);
    }
  });

  it('leaves a Fluid Topics result\'s product and version as they read', async () => {
    const { ctx } = searchUpstream({ clusteredSearch: () => [PRESTAGE] });
    const { text } = await search(ctx);

    expect(firstResult(text)).toContain('**Product**: Jamf Pro | **Version**: 11.32.0 | '
      + '**IDs**: mapId=A4LI4vM0BILraYeOD89WGg, contentId=zGNgfc54eSb4O0Kk864Pkg');
  });
});

// ── One line ────────────────────────────────────────────────────────────────

describe('jamf_docs_search writes each text it quotes on one line', () => {
  it('writes a title, breadcrumb and snippet that hold line breaks and controls each on its own line', async () => {
    const { ctx } = searchUpstream({ clusteredSearch: () => [BROKEN_ENTRY] });
    const { text } = await search(ctx);

    expect(firstResult(text).filter(line => line !== '')).toEqual([
      `### [${BROKEN_WRITTEN}](https://learn.jamf.com/r/en-US/jamf-pro-documentation-current/Computer_PreStage_Enrollments)`,
      `*Enrollment \\#\\# Steps > ${BROKEN_WRITTEN}*`,
      '> Configure and deploy the Setup Assistant settings. \\# Injectedgnp.exe',
      '**Product**: Jamf Pro | **Version**: 11.32.0 | '
        + '**IDs**: mapId=A4LI4vM0BILraYeOD89WGg, contentId=zGNgfc54eSb4O0Kk864Pkg',
    ]);
    const headings = text.split('\n').filter(line => /^#{1,6} /.test(line));
    expect(headings).toHaveLength(2);
    expect(headings[0]).toBe('# Search Results for "prestage"');
  });

  it('writes a compact line as one line', async () => {
    const { ctx } = searchUpstream({ clusteredSearch: () => [BROKEN_ENTRY] });
    const { text } = await search(ctx, { outputMode: 'compact' });

    const numbered = text.split('\n').filter(line => /^\d+\. /.test(line));
    expect(numbered).toEqual([
      `1. [${BROKEN_WRITTEN}](https://learn.jamf.com/r/en-US/jamf-pro-documentation-current/Computer_PreStage_Enrollments)`
        + ' - Configure and deploy the Setup Assistant settings. \\# Injectedgnp.exe',
    ]);
  });

  it('keeps the text as it came in structuredContent and the JSON text', async () => {
    const { ctx } = searchUpstream({ clusteredSearch: () => [BROKEN_ENTRY] });
    const structured = (await search(ctx)).results;
    const json = (JSON.parse((await search(ctx, { responseFormat: 'json' })).text) as { results: Result[] }).results;

    for (const results of [structured, json]) {
      expect(results).toHaveLength(1);
      const [result] = results;
      expect(result.title).toBe(BROKEN);
      expect(result.breadcrumb).toEqual(['Enrollment\n## Steps', BROKEN]);
      expect(result.snippet).toBe(EXCERPT);
    }
  });

  it('writes a TocProvider\'s titles each on its own line in jamf_docs_get_toc', async () => {
    const toc: FetchTocResult = {
      toc: [{
        title: 'Policies\n- [Injected](https://evil.example)',
        url: 'https://learn.jamf.com/r/en-US/jamf-pro-documentation-current/Policies',
        children: [{ title: 'Policy\u202eeganaM', url: 'https://learn.jamf.com/r/en-US/jamf-pro-documentation-current/Policy_Management' }],
      }],
      pagination: { page: 1, pageSize: 50, totalPages: 1, totalItems: 2, hasNext: false, hasPrev: false },
      tokenInfo: { tokenCount: 40, truncated: false, maxTokens: 5000 },
    };
    const { text, entries } = await tocOf(toc);

    expect(text.split('\n').filter(line => /^\s*- /.test(line))).toEqual([
      '- [Policies - \\[Injected\\]\\(https://evil.example\\)](https://learn.jamf.com/r/en-US/jamf-pro-documentation-current/Policies)',
      '  - [PolicyeganaM](https://learn.jamf.com/r/en-US/jamf-pro-documentation-current/Policy_Management)',
    ]);
    expect(entries[0]?.title).toBe('Policies\n- [Injected](https://evil.example)');
  });
});
