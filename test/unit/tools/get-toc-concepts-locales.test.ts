/**
 * What `jamf_docs_get_toc` says about the language of a concepts.jamf.com
 * table of contents, in every language the tool accepts: the registered tool
 * over MCP, with the real sitemap reader, and only the http client stubbed
 * with a sitemap shaped like the live one.
 *
 * concepts.jamf.com's sitemap lists ten locale codes, each with the same 99
 * paths (2026-09-28): `de`, `en`, `es`, `fr`, `ja`, `ko`, `nl`, `pl`, `zh-CN`
 * and `zh-TW`. Eight of them are editions of a locale this server names, by
 * the source's locale table; `ko` and `pl` are not, since no `language`
 * value names them. The other three `language` values, th-TH, it-IT and
 * pt-BR, have no edition: `/th/`, `/th-TH/`, `/it/`, `/it-IT/`, `/pt/` and
 * `/pt-BR/` all answer 404.
 *
 * The sitemap path reported the site's own code (`ja`) as the locale that
 * answered, and `get_toc` compared that with the `language` it was asked in
 * (`ja-JP`). So a request for the locale's own edition, which it was served,
 * said the opposite. Live on 2026-09-28 that was both sections in en-US,
 * ja-JP, de-DE, es-ES, fr-FR and nl-NL: twelve section and language pairs,
 * 24 replies in JSON and markdown. Each reply carried "Jamf does not publish
 * this document in ja-JP. Showing the ja edition instead." (with its own
 * locale and code) in `structuredContent`, and in its text, the JSON or the
 * markdown. zh-TW and zh-CN did not, because the site spells them as this
 * server does.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { registerGetTocTool } from '../../../src/core/tools/get-toc.js';
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

/** The locale codes the live sitemap lists, 2026-09-28. */
const LIVE_CODES = ['de', 'en', 'es', 'fr', 'ja', 'ko', 'nl', 'pl', 'zh-CN', 'zh-TW'];

/**
 * Paths each code lists, a few of the live 99: the pages that are not in
 * either section, both section indexes, and pages one and two levels down.
 */
const PATHS = [
  '', 'about', 'browse', 'ecosystem',
  'guides', 'guides/ai-governance', 'guides/ai-governance/ai-governance-enforcement-with-jamf-extender',
  'concepts', 'concepts/apiutil', 'concepts/jamf-sync',
];

const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset>${
  LIVE_CODES.flatMap(code => PATHS.map(path => `${ORIGIN}/${code}${path === '' ? '' : `/${path}`}`))
    .map(loc => `<url><loc>${loc}</loc><lastmod>2026-09-28</lastmod></url>`)
    .join('')
}</urlset>`;

/** Every url requested, in order. */
const requests: string[] = [];

const http: HttpClient = {
  getText: async (url) => {
    requests.push(url);
    if (url === `${ORIGIN}/sitemap.xml`) { return await Promise.resolve(SITEMAP); }
    throw new HttpError(404, 'Not Found', url);
  },
  getJson: async (url) => await Promise.reject(new HttpError(404, 'Not Found', url)),
  postJson: async (url) => await Promise.reject(new HttpError(404, 'Not Found', url)),
};

/** This server's locale ids that the source publishes, each with its own code. */
const PUBLISHED = Object.entries(CONCEPTS.locales);

/** The locale ids `language` accepts that the source has no edition for. */
const UNPUBLISHED = SUPPORTED_LOCALE_IDS.filter(id => !(id in CONCEPTS.locales));

const SECTIONS = CONCEPTS.sections.map(section => [section.id, section.path] as const);

let ctx: ServerContext;
let server: McpServer;
let client: Client;

beforeAll(async () => {
  ctx = createMockContext({ http, mapsRegistry: createStubMapsRegistry([]) });
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
  await ctx.cache.clear();
  requests.length = 0;
});

async function getToc(
  publication: string,
  language: string | undefined,
  responseFormat: 'json' | 'markdown',
): Promise<CallResult> {
  return await client.callTool({
    name: 'jamf_docs_get_toc',
    arguments: { publication, responseFormat, ...(language !== undefined ? { language } : {}) },
  }) as CallResult;
}

function textOf(result: CallResult): string {
  return (result.content[0] as TextContent).text;
}

/** The locale segment of every entry's URL. */
function editionsOf(result: CallResult): string[] {
  const entries = result.structuredContent?.entries as { url: string }[];
  return [...new Set(entries.map(entry => new URL(entry.url).pathname.split('/')[1]))];
}

/** Every way a reply can carry a language note, on all three channels. */
function notesIn(json: CallResult, markdown: CallResult): unknown[] {
  return [
    json.structuredContent?.localeNote,
    (JSON.parse(textOf(json)) as Record<string, unknown>).localeNote,
    markdown.structuredContent?.localeNote,
    /Language Note/.exec(textOf(markdown))?.[0],
  ].filter(note => note !== undefined);
}

describe('jamf_docs_get_toc: a concepts.jamf.com section in a language the site publishes', () => {
  it('covers every locale the source declares, each one in the dated sitemap snapshot', () => {
    expect(PUBLISHED.map(([id]) => id).sort())
      .toEqual(['de-DE', 'en-US', 'es-ES', 'fr-FR', 'ja-JP', 'nl-NL', 'zh-CN', 'zh-TW']);
    for (const [, code] of PUBLISHED) { expect(LIVE_CODES).toContain(code); }
  });

  const cases = SECTIONS.flatMap(([publication, path]) =>
    PUBLISHED.map(([language, code]) => [publication, language, code, path] as const));

  it.each(cases)('serves %s in %s from its own edition, and says nothing about the language', async (
    publication, language, code, path,
  ) => {
    const json = await getToc(publication, language, 'json');
    const markdown = await getToc(publication, language, 'markdown');

    expect(json.isError, textOf(json)).not.toBe(true);
    expect(markdown.isError, textOf(markdown)).not.toBe(true);
    expect(editionsOf(json)).toEqual([code]);
    expect((json.structuredContent?.entries as { url: string }[]).every(entry =>
      new URL(entry.url).pathname.startsWith(`/${code}/${path}/`))).toBe(true);
    expect(json.structuredContent?.totalEntries).toBeGreaterThan(0);
    // The language to send back with the next page is the one asked in.
    expect(json.structuredContent?.language).toBe(language);
    expect(notesIn(json, markdown)).toEqual([]);
  });

  it.each(SECTIONS)('serves %s with no language as the en edition, with no note', async (publication) => {
    const json = await getToc(publication, undefined, 'json');
    const markdown = await getToc(publication, undefined, 'markdown');

    expect(editionsOf(json)).toEqual(['en']);
    expect(json.structuredContent?.language).toBeUndefined();
    expect(notesIn(json, markdown)).toEqual([]);
  });

  it('serves each language its own edition when they are asked for in turn, from one sitemap request', async () => {
    const [publication] = SECTIONS[0];
    for (const [language, code] of PUBLISHED) {
      const json = await getToc(publication, language, 'json');
      expect(editionsOf(json)).toEqual([code]);
      expect(json.structuredContent?.localeNote).toBeUndefined();
    }
    expect(requests).toEqual([`${ORIGIN}/sitemap.xml`]);
  });
});

describe('jamf_docs_get_toc: a concepts.jamf.com section in a language the site does not publish', () => {
  it('is asked of the three language values the source has no edition for', () => {
    expect([...UNPUBLISHED].sort()).toEqual(['it-IT', 'pt-BR', 'th-TH']);
  });

  const cases = SECTIONS.flatMap(([publication]) =>
    UNPUBLISHED.map(language => [publication, language] as const));

  it.each(cases)('answers %s in %s with an error naming the languages it is in', async (publication, language) => {
    for (const responseFormat of ['json', 'markdown'] as const) {
      const result = await getToc(publication, language, responseFormat);

      expect(result.isError).toBe(true);
      // This server's ids, the ones `language` accepts, and never the site's
      // own codes, which no request can send.
      expect(textOf(result)).toBe(
        `${CONCEPTS.name} does not publish in ${language}. ` +
        `Available: ${PUBLISHED.map(([id]) => id).join(', ')}.`,
      );
    }
    // Refused before the sitemap is read.
    expect(requests).toEqual([]);
  });
});
