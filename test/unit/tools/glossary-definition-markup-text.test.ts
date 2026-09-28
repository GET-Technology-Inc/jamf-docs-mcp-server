/**
 * A glossary definition's text is text in its markdown: a `<` or a character
 * reference the definition shows is escaped, as an article's is.
 *
 * A definition is converted by the same Turndown instance as an article, so
 * until 2026-09-28 a definition that shows `<key>` or the text "&lt;" was
 * written as `<key>` and `&lt;`, which render as a tag and as "<" (see
 * get-article-markup-in-text.test.ts). No live definition read that day
 * holds either, so the definition here is built for this suite, on the live
 * title "property list (PLIST)".
 *
 * Over MCP, with the real glossary service and formatter and only the maps
 * registry's glossary map and the two Fluid Topics calls mocked.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

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

const PLIST = 'property list (PLIST)';

/** The definition, in the live shape of a glossary topic's `/content`. */
const PLIST_CONTENT = '<div class="content-locale-en-US content-locale-en"><div id="glossentry-1">'
  + '<div class="abstract glossdef"><p class="p">An XML file of keys and values, such as '
  + '&lt;key&gt;PayloadType&lt;/key&gt;; write &amp;lt; for a literal &lt;, as in '
  + '<code class="ph codeph">&lt;string&gt;a &amp;lt; b&lt;/string&gt;</code>.</p></div></div></div>';

/** What the markdown, and structuredContent's `definition`, say of it. */
const PLIST_DEFINITION = 'An XML file of keys and values, such as \\<key>PayloadType\\</key>; write \\&lt; '
  + 'for a literal \\<, as in `<string>a &lt; b</string>`.';

interface Reply { text: string; definition: string | undefined }

async function lookup(args: Record<string, unknown>): Promise<Reply> {
  const ctx = createMockContext();
  ctx.mapsRegistry.resolveGlossaryMapId = vi.fn(async () => await Promise.resolve(GLOSSARY_MAP_ID));
  const server = new McpServer({ name: 'test', version: '0.0.1' });
  registerGlossaryLookupTool(server, ctx);
  const client = new Client({ name: 'test-client', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    await client.listTools();
    const result = await client.callTool({ name: 'jamf_docs_glossary_lookup', arguments: args });
    const text = (result.content as { text?: string }[]).map(c => c.text ?? '').join('\n');
    expect(result.isError, text).not.toBe(true);
    const { entries } = result.structuredContent as { entries: { term: string; definition: string }[] };
    return { text, definition: entries.find(e => e.term === PLIST)?.definition };
  } finally {
    await client.close();
    await server.close();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchMapToc).mockImplementation(async () => await Promise.resolve(LIVE_GLOSSARY_TOC));
  vi.mocked(fetchTopicContent).mockImplementation(serveGlossaryContent(() => new Set(), { [PLIST]: PLIST_CONTENT }));
});

describe('jamf_docs_glossary_lookup: a definition\'s text is text in its markdown', () => {
  it('escapes the tag and the reference the definition shows, and leaves its code span as it is', async () => {
    const reply = await lookup({ term: 'PLIST' });

    expect(reply.definition).toBe(PLIST_DEFINITION);
    expect(reply.text.split('\n')).toContain(PLIST_DEFINITION);
  });

  it('writes the same text on the compact line', async () => {
    const reply = await lookup({ term: 'PLIST', outputMode: 'compact' });

    expect(reply.definition).toBe(PLIST_DEFINITION);
    // Cut at 97 characters, as every compact definition is.
    expect(reply.text).toContain(`**property list \\(PLIST\\)** - ${PLIST_DEFINITION.slice(0, 97)}...`);
  });
});
