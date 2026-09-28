/**
 * A term `jamf_docs_glossary_lookup` is asked for in full-width Latin letters
 * or digits, as a Chinese, Japanese or Korean input method in full-width mode
 * types them: the registered tool over MCP, with the real glossary service and
 * formatter, and only the maps registry's glossary map and the two Fluid
 * Topics calls mocked.
 *
 * Jamf titles its glossary entries in ASCII. Until 2026-09-28 the term was
 * matched as typed, so `ＭＤＭ` matched none of them: live that day, the
 * lookup had no entry for ＭＤＭ and 2 for MDM, mobile device management (MDM)
 * and User Approved MDM.
 */

import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

vi.mock('../../../src/core/services/ft-client.js', async (importOriginal) => ({
  ...await importOriginal<typeof FtClientModule>(),
  fetchMapToc: vi.fn(),
  fetchTopicContent: vi.fn(),
}));

import { McpServer } from '@modelcontextprotocol/server';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import type * as FtClientModule from '../../../src/core/services/ft-client.js';
import { fetchMapToc, fetchTopicContent } from '../../../src/core/services/ft-client.js';
import { registerGlossaryLookupTool } from '../../../src/core/tools/glossary-lookup.js';
import { createMockContext } from '../../helpers/mock-context.js';
import { GLOSSARY_MAP_ID, LIVE_GLOSSARY_TOC, serveGlossaryContent } from '../../helpers/glossary-upstream.js';
import type { GlossaryProvider } from '../../../src/core/services/interfaces/index.js';
import type { ServerContext } from '../../../src/core/types/context.js';

interface CallResult {
  isError?: boolean;
  content: unknown[];
  structuredContent?: Record<string, unknown>;
}

function textOf(result: CallResult): string {
  return (result.content[0] as { text: string }).text;
}

let ctx: ServerContext;
let server: McpServer;
let client: Client;

beforeAll(async () => {
  server = new McpServer({ name: 'test', version: '0.0.1' });
  ctx = createMockContext();
  ctx.mapsRegistry.resolveGlossaryMapId = vi.fn(async () => await Promise.resolve(GLOSSARY_MAP_ID));
  registerGlossaryLookupTool(server, ctx);

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
  vi.clearAllMocks();
  await ctx.cache.clear();
  vi.mocked(fetchMapToc).mockImplementation(async () => await Promise.resolve(LIVE_GLOSSARY_TOC));
  vi.mocked(fetchTopicContent).mockImplementation(serveGlossaryContent(() => new Set()));
});

async function lookup(term: string): Promise<CallResult> {
  return await client.callTool({ name: 'jamf_docs_glossary_lookup', arguments: { term } }) as CallResult;
}

async function terms(term: string): Promise<string[]> {
  const result = await lookup(term);
  expect(result.isError, textOf(result)).not.toBe(true);
  return (result.structuredContent?.entries as { term: string }[]).map(e => e.term);
}

describe('a term in full-width letters or digits', () => {
  it.each([
    ['ＭＤＭ', 'MDM'],
    ['ＡＰＦＳ', 'APFS'],
    ['ｚｔｎａ', 'ztna'],
    ['Ａｕｔｏｍａｔｅｄ Ｄｅｖｉｃｅ Ｅｎｒｏｌｌｍｅｎｔ', 'Automated Device Enrollment'],
  ])('%s finds the entries %s finds', async (fullWidth, ascii) => {
    const expected = await terms(ascii);

    expect(expected.length).toBeGreaterThan(0);
    expect(await terms(fullWidth)).toEqual(expected);
  });

  it('is echoed as typed', async () => {
    const result = await lookup('ＭＤＭ');

    expect(result.structuredContent?.term).toBe('ＭＤＭ');
    expect(textOf(result)).toContain('ＭＤＭ');
  });

  it('is handed to a GlossaryProvider as typed', async () => {
    const provided = vi.fn<GlossaryProvider['lookup']>(async () => await Promise.resolve(null));
    const withProvider = createMockContext({ glossaryProvider: { lookup: provided } });
    withProvider.mapsRegistry.resolveGlossaryMapId = vi.fn(async () => await Promise.resolve(GLOSSARY_MAP_ID));
    const own = new McpServer({ name: 'test', version: '0.0.1' });
    registerGlossaryLookupTool(own, withProvider);
    const ownClient = new Client({ name: 'test-client', version: '0.0.1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([own.connect(serverTransport), ownClient.connect(clientTransport)]);
    try {
      await ownClient.callTool({ name: 'jamf_docs_glossary_lookup', arguments: { term: 'ＭＤＭ' } });
    } finally {
      await ownClient.close();
      await own.close();
    }

    expect(provided).toHaveBeenCalledTimes(1);
    expect(provided.mock.calls[0]?.[0]).toMatchObject({ term: 'ＭＤＭ' });
  });
});
