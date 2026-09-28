/**
 * What `jamf_docs_glossary_lookup` advises below `maxTokens: 50000`, the
 * largest the schema accepts, when some entries fit and even 50000 would not
 * bring in the next one: the registered tool over MCP, with the real glossary
 * service and formatter, and only the two Fluid Topics calls mocked, or a
 * `GlossaryProvider` answering instead.
 *
 * The cut stops at the first entry that does not fit, so an answer at 50000
 * shows the same entries as this one whenever the next entry and those shown
 * cost more than 50000 together. Until 2026-09-28 such an answer still said
 * "Increase `maxTokens` or narrow your search.": #372 fixed the line at 50000
 * and left this case, in which increasing `maxTokens` returns nothing more.
 * The live glossary cannot get there: a lookup reads 10 entries at most, and
 * no entry costs more than 134 tokens (#346), so these suites give the four
 * `Apple` entries definitions tens of thousands of tokens long, as a
 * `GlossaryProvider` or a glossary Jamf rewrites could.
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
import { TOKEN_CONFIG } from '../../../src/core/constants.js';
import { createMockContext } from '../../helpers/mock-context.js';
import {
  GLOSSARY_MAP_ID,
  LIVE_GLOSSARY_TOC,
  serveGlossaryContent,
} from '../../helpers/glossary-upstream.js';
import type { GlossaryLookupResult } from '../../../src/core/types.js';
import type { ServerContext } from '../../../src/core/types/context.js';

interface TextContent { type: 'text'; text: string }

interface CallResult {
  isError?: boolean;
  content: unknown[];
  structuredContent?: Record<string, unknown>;
}

function textOf(result: CallResult): string {
  return (result.content[0] as TextContent).text;
}

function termsOf(result: CallResult): string[] {
  return (result.structuredContent?.entries as { term: string }[]).map(e => e.term);
}

const LIMIT = TOKEN_CONFIG.MAX_TOKENS_LIMIT;
const INCREASE = '*Results truncated due to token limit. Increase `maxTokens` or narrow your search.*';

let ctx: ServerContext;
let server: McpServer;
let client: Client;

beforeAll(async () => {
  server = new McpServer({ name: 'test', version: '0.0.1' });
  ctx = createMockContext();
  ctx.mapsRegistry.resolveGlossaryMapId = vi.fn().mockResolvedValue(GLOSSARY_MAP_ID);
  registerGlossaryLookupTool(server, ctx);

  client = new Client({ name: 'test-client', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  // The client checks structuredContent against the published outputSchema
  // only for tools it has listed.
  await client.listTools();
});

afterAll(async () => {
  await client.close();
  await server.close();
});

beforeEach(async () => {
  vi.clearAllMocks();
  await ctx.cache.clear();
  delete ctx.glossaryProvider;
  vi.mocked(fetchMapToc).mockResolvedValue(LIVE_GLOSSARY_TOC);
});

async function lookup(args: Record<string, unknown>): Promise<CallResult> {
  return await client.callTool({ name: 'jamf_docs_glossary_lookup', arguments: args }) as CallResult;
}

/**
 * A `/content` body whose entry, `title: definition`, is 4 × `tokens`
 * characters long, so that it costs exactly `tokens` estimated tokens.
 */
function bodyCosting(title: string, tokens: number): string {
  const length = tokens * 4 - title.length - 2;
  const text = 'word '.repeat(Math.ceil(length / 5) + 1).slice(0, length).replace(/ $/, 'x');
  return '<div class="content-locale-en-US content-locale-en"><div id="glossentry-1">' +
    `<div class="abstract glossdef"><p class="p">${text}</p></div></div></div>`;
}

/**
 * Serve the four `Apple` entries at exactly these costs, in the order `Apple`
 * ranks them: Apple Account, Apple Business, Apple School Manager, Apple File
 * System (APFS).
 */
function serveApple(account: number, business: number, schoolManager: number, apfs: number): void {
  const costs: Record<string, number> = {
    'Apple Account': account,
    'Apple Business': business,
    'Apple School Manager': schoolManager,
    'Apple File System (APFS)': apfs,
  };
  vi.mocked(fetchTopicContent).mockImplementation(serveGlossaryContent(
    () => new Set(),
    Object.fromEntries(Object.entries(costs).map(([title, tokens]) => [title, bodyCosting(title, tokens)])),
  ));
}

describe('a partial answer below the largest maxTokens', () => {
  it('does not advise a larger maxTokens when the next entry and those shown cost more than 50000', async () => {
    serveApple(20000, 20000, 20000, 5000);

    for (const outputMode of ['full', 'compact']) {
      const result = await lookup({ term: 'Apple', maxTokens: LIMIT - 1, outputMode });
      const text = textOf(result);

      expect(termsOf(result)).toEqual(['Apple Account', 'Apple Business']);
      expect(text).toContain('*2 of 4 match(es) | 40,000 tokens*');
      expect(text).toContain(
        '*Results truncated due to token limit, and no `maxTokens` gets the next entry, Apple School Manager: ' +
        'it needs 20000 tokens, and with the 40000 shown that is more than `maxTokens` allows (50000). ' +
        'Look up an entry that was left out by its own name to get it: ' +
        'Apple School Manager, Apple File System \\(APFS\\).*',
      );
      expect(text).not.toContain('Increase `maxTokens`');
    }
  });

  it('is right that a larger maxTokens gets nothing more, and the lookups it names work', async () => {
    serveApple(20000, 20000, 20000, 5000);

    expect(termsOf(await lookup({ term: 'Apple', maxTokens: LIMIT }))).toEqual(['Apple Account', 'Apple Business']);
    for (const title of ['Apple School Manager', 'Apple File System (APFS)']) {
      expect(termsOf(await lookup({ term: title, maxTokens: LIMIT - 1 }))[0]).toBe(title);
    }
  });

  it('gives the budget the named entries need when it is more than the lookup had', async () => {
    serveApple(20000, 40000, 100, 100);

    const text = textOf(await lookup({ term: 'Apple', maxTokens: 30000 }));
    expect(text).toContain(
      '*Results truncated due to token limit, and no `maxTokens` gets the next entry, Apple Business: ' +
      'it needs 40000 tokens, and with the 20000 shown that is more than `maxTokens` allows (50000). ' +
      'Look up an entry that was left out by its own name, with `maxTokens: 40000` or more, to get it: ' +
      'Apple Business, Apple School Manager, Apple File System \\(APFS\\).*',
    );

    expect(termsOf(await lookup({ term: 'Apple Business', maxTokens: 40000 }))[0]).toBe('Apple Business');
  });

  it('says "with those shown", not "on its own", when the next entry costs 50000 exactly', async () => {
    // A lookup by its own name at 50000 gets it, so it is not larger than
    // 50000 on its own, and the budget named is the largest, not one "or more".
    serveApple(20000, LIMIT, 100, 100);

    const text = textOf(await lookup({ term: 'Apple', maxTokens: 30000 }));
    expect(text).toContain(
      '*Results truncated due to token limit, and no `maxTokens` gets the next entry, Apple Business: ' +
      'it needs 50000 tokens, and with the 20000 shown that is more than `maxTokens` allows (50000). ' +
      'Look up an entry that was left out by its own name, with `maxTokens: 50000` (the largest it can be), ' +
      'to get it: Apple Business, Apple School Manager, Apple File System \\(APFS\\).*',
    );
    expect(text).not.toContain('on its own');
    expect(text).not.toContain('or more');

    expect(termsOf(await lookup({ term: 'Apple Business', maxTokens: LIMIT }))[0]).toBe('Apple Business');
  });

  it('says when the next entry is larger than 50000 on its own, and names the others a lookup gets', async () => {
    serveApple(20000, 60000, 100, 100);

    const text = textOf(await lookup({ term: 'Apple', maxTokens: 30000 }));
    expect(text).toContain(
      '*Results truncated due to token limit, and no `maxTokens` gets the next entry, Apple Business: ' +
      'it needs 60000 tokens on its own, more than `maxTokens` allows (50000). ' +
      'Look up an entry that was left out by its own name to get it: ' +
      'Apple School Manager, Apple File System \\(APFS\\).*',
    );
  });

  it('names no lookup when every entry left out is larger than 50000 on its own', async () => {
    serveApple(20000, 60000, 60000, 60000);

    const text = textOf(await lookup({ term: 'Apple', maxTokens: 30000 }));
    expect(text).toContain(
      '*Results truncated due to token limit, and no `maxTokens` gets the next entry, Apple Business: ' +
      'it needs 60000 tokens on its own, more than `maxTokens` allows (50000).*',
    );
    expect(text).not.toContain('Look up');
  });

  it('keeps advising a larger maxTokens when 50000 gets the next entry exactly', async () => {
    serveApple(20000, 30000, 100, 100);

    const text = textOf(await lookup({ term: 'Apple', maxTokens: LIMIT - 1 }));
    expect(text).toContain('*1 of 4 match(es) | 20,000 tokens*');
    expect(text).toContain(INCREASE);
    expect(text).not.toContain('no `maxTokens` gets');

    expect(termsOf(await lookup({ term: 'Apple', maxTokens: LIMIT }))).toEqual(['Apple Account', 'Apple Business']);
  });

  it('stops advising it one token past that', async () => {
    serveApple(20000, 30001, 100, 100);

    const text = textOf(await lookup({ term: 'Apple', maxTokens: LIMIT - 1 }));
    expect(text).toContain('no `maxTokens` gets the next entry, Apple Business: it needs 30001 tokens');
    expect(text).not.toContain(INCREASE);

    expect(termsOf(await lookup({ term: 'Apple', maxTokens: LIMIT }))).toEqual(['Apple Account']);
  });
});

/** A `GlossaryProvider` that answers this. */
function provide(answer: GlossaryLookupResult): void {
  ctx.glossaryProvider = { lookup: vi.fn().mockResolvedValue(answer) };
}

describe('a GlossaryProvider partial answer below the largest maxTokens', () => {
  const entry = { term: 'First', definition: 'The first.', url: 'https://learn.jamf.com/r/en-US/jamf-technical-glossary/First' };

  it('takes the costs it gives: the next entry beside those shown past 50000 gets no advice to increase', async () => {
    provide({
      entries: [entry],
      totalMatches: 2,
      tokenInfo: { tokenCount: 40000, truncated: true, maxTokens: 45000 },
      truncatedContent: { omittedCount: 1, omittedItems: [{ title: 'policy (Jamf Pro)', estimatedTokens: 20000 }] },
    });

    // Its title is escaped as the entries' are.
    const text = textOf(await lookup({ term: 'MDM', maxTokens: 45000 }));
    expect(text).toContain(
      '*Results truncated due to token limit, and no `maxTokens` gets the next entry, policy \\(Jamf Pro\\): ' +
      'it needs 20000 tokens, and with the 40000 shown that is more than `maxTokens` allows (50000). ' +
      'Look up an entry that was left out by its own name to get it: policy \\(Jamf Pro\\).*',
    );
  });

  it('keeps the usual line when it gives no costs', async () => {
    provide({
      entries: [entry],
      totalMatches: 2,
      tokenInfo: { tokenCount: 40000, truncated: true, maxTokens: 45000 },
    });

    expect(textOf(await lookup({ term: 'MDM', maxTokens: 45000 }))).toContain(INCREASE);
  });
});
