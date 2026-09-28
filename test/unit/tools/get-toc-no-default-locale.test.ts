/**
 * What `jamf_docs_get_toc` answers for a static source that publishes neither
 * the requested language nor a default-locale (en-US) edition to serve in its
 * place: the registered tool over MCP, with two synthetic sources published
 * in ja-JP only, one whose sections are declared and one whose sections are
 * discovered, as an Intercom Help Center's are.
 *
 * No real source is like that. On 2026-09-28 Jamf Concepts and the Jamf
 * Support Knowledge Base both have an en-US edition, so a language either
 * site does not publish is served that edition with a `localeNote`. Until
 * that day such a language was an error, "Jamf Concepts does not publish in
 * th-TH. Available: en-US, ja-JP, …", and a source with no en-US edition is
 * the one case that still gets it. Without these sources nothing reaches it.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';

const SYNTHETIC = vi.hoisted(() => ({
  declared: { name: 'Declared Sections Site', sectionId: 'ja-only-guides' },
  discovered: { name: 'Discovered Sections Site', idPrefix: 'ja-only-help' },
}));

vi.mock('../../../src/core/constants/sources.js', async (importOriginal) => {
  const actual = await importOriginal<typeof SourcesModule>();
  const section = { id: SYNTHETIC.declared.sectionId, path: 'guides', title: 'Guides' };
  const declared: StaticDocSource = {
    ...actual.STATIC_DOC_SOURCES['jamf-concepts'],
    id: 'ja-only-declared',
    name: SYNTHETIC.declared.name,
    locales: { 'ja-JP': 'ja' },
    sections: [section],
  };
  const discovered: StaticDocSource = {
    ...actual.STATIC_DOC_SOURCES['jamf-support'],
    id: 'ja-only-discovered',
    name: SYNTHETIC.discovered.name,
    locales: { 'ja-JP': 'ja' },
    dynamicSections: { kind: 'intercom-collections', idPrefix: SYNTHETIC.discovered.idPrefix },
  };
  return {
    ...actual,
    staticSectionById: (id: string) =>
      id === section.id ? { source: declared, section } : actual.staticSectionById(id),
    DYNAMIC_SECTION_SOURCES: [...actual.DYNAMIC_SECTION_SOURCES, discovered],
  };
});

import { McpServer } from '@modelcontextprotocol/server';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { registerGetTocTool } from '../../../src/core/tools/get-toc.js';
import type * as SourcesModule from '../../../src/core/constants/sources.js';
import type { StaticDocSource } from '../../../src/core/constants/sources.js';
import { HttpError, type HttpClient } from '../../../src/core/http-client.js';
import { createMockContext, createStubMapsRegistry } from '../../helpers/mock-context.js';
import type { ServerContext } from '../../../src/core/types/context.js';

interface TextContent { type: 'text'; text: string }

interface CallResult {
  isError?: boolean;
  content: unknown[];
  structuredContent?: Record<string, unknown>;
}

/** Every url requested, in order. */
const requests: string[] = [];

const http: HttpClient = {
  getText: async (url) => {
    requests.push(url);
    return await Promise.reject(new HttpError(404, 'Not Found', url));
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

async function getToc(publication: string, language: string): Promise<CallResult> {
  return await client.callTool({
    name: 'jamf_docs_get_toc',
    arguments: { publication, language },
  }) as CallResult;
}

function textOf(result: CallResult): string {
  return (result.content[0] as TextContent).text;
}

describe('jamf_docs_get_toc: a static source with no edition in the language and none in en-US', () => {
  const cases = [
    ['a declared section', SYNTHETIC.declared.sectionId, SYNTHETIC.declared.name],
    ['a discovered section', `${SYNTHETIC.discovered.idPrefix}-guides`, SYNTHETIC.discovered.name],
  ] as const;

  for (const [kind, publication, name] of cases) {
    it.each(['th-TH', 'en-US'])(`answers ${kind} in %s with the languages the source publishes, and asks nothing`, async (language) => {
      const result = await getToc(publication, language);

      expect(result.isError).toBe(true);
      expect(textOf(result)).toBe(`${name} does not publish in ${language}. Available: ja-JP.`);
      // Neither the language's home page nor en's: the source has neither.
      expect(requests).toEqual([]);
    });
  }
});
