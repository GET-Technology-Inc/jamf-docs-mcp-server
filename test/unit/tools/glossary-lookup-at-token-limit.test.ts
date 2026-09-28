/**
 * What `jamf_docs_glossary_lookup` advises when matches are left out of an
 * answer at `maxTokens: 50000`, the largest the schema accepts: the registered
 * tool over MCP, with the real glossary service and formatter, and only the
 * two Fluid Topics calls mocked, or a `GlossaryProvider` answering instead.
 *
 * Until 2026-09-28 a partial answer ended "Increase `maxTokens` or narrow your
 * search." and one with no entry that fits "Repeat the lookup with a larger
 * `maxTokens`", whatever `maxTokens` was, the shape #364 fixed for
 * `jamf_docs_get_toc`. At 50000 no larger one can be asked for. The live
 * glossary cannot get there: a lookup reads 10 entries at most, and no entry
 * costs more than 134 tokens (#346), so these suites give the four `Apple`
 * entries definitions tens of thousands of tokens long, as a
 * `GlossaryProvider` or a glossary Jamf rewrites could.
 *
 * An entry that costs more than 50000 is past any `maxTokens`, so the reply
 * for a first entry that large names the other matches a lookup by name
 * gets, at whatever `maxTokens` the lookup had, and the budget that gets them
 * when that one is too small. Those suites run below the limit too.
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

const LIMIT = TOKEN_CONFIG.MAX_TOKENS_LIMIT;

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

/** A `/content` body whose entry costs about `tokens` estimated tokens. */
function definitionOf(tokens: number): string {
  return '<div class="content-locale-en-US content-locale-en"><div id="glossentry-1">' +
    `<div class="abstract glossdef"><p class="p">${'word '.repeat(tokens * 4 / 5).trim()}</p></div></div></div>`;
}

/**
 * Serve the four `Apple` entries at these sizes, in the order `Apple` ranks
 * them: Apple Account, Apple Business, Apple School Manager, Apple File System
 * (APFS).
 */
function serveApple(account: number, business: number, schoolManager: number, apfs: number): void {
  vi.mocked(fetchTopicContent).mockImplementation(serveGlossaryContent(() => new Set(), {
    'Apple Account': definitionOf(account),
    'Apple Business': definitionOf(business),
    'Apple School Manager': definitionOf(schoolManager),
    'Apple File System (APFS)': definitionOf(apfs),
  }));
}

const AT_LIMIT = `Results truncated due to token limit, and \`maxTokens\` is already the largest it can be (${String(LIMIT)}).`;

describe('a partial answer at the largest maxTokens', () => {
  it('does not advise a larger maxTokens, and names the entries a lookup by name returns', async () => {
    // Apple Account and Apple Business fit in 50000 together; Apple School
    // Manager does not fit beside them, and Apple File System (APFS) does not
    // fit on its own, so a lookup by its name cannot return it either.
    serveApple(20000, 20000, 20000, 60000);

    for (const outputMode of ['full', 'compact']) {
      const result = await lookup({ term: 'Apple', maxTokens: LIMIT, outputMode });
      const text = textOf(result);

      expect(result.structuredContent?.entries).toHaveLength(2);
      expect(text).toContain('*2 of 4 match(es)');
      expect(text).toContain(
        `*${AT_LIMIT} Look up an entry that was left out by its own name to get it: Apple School Manager.*`,
      );
      expect(text).not.toContain('Increase `maxTokens`');
      // Titles are escaped (see the suite below), so this is how it would read.
      expect(text).not.toContain('Apple File System \\(APFS\\)');
    }
  });

  it('gives advice that works: the entry looked up by its own name comes first', async () => {
    serveApple(20000, 20000, 20000, 60000);

    const result = await lookup({ term: 'Apple School Manager', maxTokens: LIMIT });

    expect((result.structuredContent?.entries as { term: string }[]).map(e => e.term))
      .toEqual(['Apple School Manager']);
    expect(result.structuredContent?.truncated).toBe(false);
  });

  it('keeps the usual note one token below it, where a larger maxTokens is possible', async () => {
    serveApple(20000, 20000, 20000, 60000);

    const text = textOf(await lookup({ term: 'Apple', maxTokens: LIMIT - 1 }));

    expect(text).toContain('*Results truncated due to token limit. Increase `maxTokens` or narrow your search.*');
    expect(text).not.toContain('largest it can be');
  });
});

describe('an answer with no entry that fits', () => {
  it('names the other entries a lookup by name returns when the first is larger than the limit', async () => {
    serveApple(60000, 20000, 20000, 20000);

    const result = await lookup({ term: 'Apple', maxTokens: LIMIT });
    const first = (result.structuredContent?.truncatedContent as { omittedItems: { estimatedTokens: number }[] })
      .omittedItems[0]?.estimatedTokens;

    expect(first).toBeGreaterThan(LIMIT);
    // Titles are escaped as the entries are.
    expect(textOf(result)).toContain(
      '*4 entries match, but not even the first, Apple Account, fits in `maxTokens: 50000`. ' +
      `It needs ${String(first)} tokens, more than \`maxTokens\` allows (50000). ` +
      'Look up another entry by its own name to get it: ' +
      'Apple Business, Apple School Manager, Apple File System \\(APFS\\).*',
    );
  });

  it('below the limit, gives the budget that gets the others, and that budget gets each one', async () => {
    // Each of the other three costs about 20000, more than the lookup had, so
    // a lookup by name at the same maxTokens would not return it.
    serveApple(60000, 20000, 20000, 20000);

    for (const maxTokens of [100, 5000]) {
      const result = await lookup({ term: 'Apple', maxTokens });
      const [first, ...others] = (result.structuredContent?.truncatedContent as {
        omittedItems: { title: string; estimatedTokens: number }[];
      }).omittedItems;
      const needs = Math.max(...others.map(e => e.estimatedTokens));

      expect(needs).toBeGreaterThan(maxTokens);
      expect(needs).toBeLessThanOrEqual(LIMIT);
      expect(textOf(result)).toContain(
        `*4 entries match, but not even the first, Apple Account, fits in \`maxTokens: ${String(maxTokens)}\`. ` +
        `It needs ${String(first.estimatedTokens)} tokens, more than \`maxTokens\` allows (50000). ` +
        `Look up another entry by its own name, with \`maxTokens: ${String(needs)}\` or more, to get it: ` +
        'Apple Business, Apple School Manager, Apple File System \\(APFS\\).*',
      );

      for (const { title } of others) {
        const named = await lookup({ term: title, maxTokens: needs });
        expect((named.structuredContent?.entries as { term: string }[])[0]?.term).toBe(title);
      }
    }
  });

  it('below the limit, gives no budget when the one the lookup had gets the others', async () => {
    serveApple(60000, 20000, 20000, 20000);

    const text = textOf(await lookup({ term: 'Apple', maxTokens: 30000 }));
    expect(text).toContain(
      'more than `maxTokens` allows (50000). Look up another entry by its own name to get it: ' +
      'Apple Business, Apple School Manager, Apple File System \\(APFS\\).*',
    );
    expect(text).not.toContain('or more, to get it');
  });

  it('adds nothing when one entry matches and it is larger than the limit', async () => {
    serveApple(20000, 20000, 60000, 20000);

    const text = textOf(await lookup({ term: 'Apple School Manager', maxTokens: 100 }));

    expect(text).toMatch(/It needs \d+ tokens, more than `maxTokens` allows \(50000\)\.\*/);
    expect(text).not.toContain('Look up');
  });
});

/** A `GlossaryProvider` that answers this, at `maxTokens: 50000` unless it says otherwise. */
function provide(answer: Partial<GlossaryLookupResult> & { totalMatches: number }): void {
  ctx.glossaryProvider = {
    lookup: vi.fn().mockResolvedValue({
      entries: [],
      tokenInfo: { tokenCount: 0, truncated: true, maxTokens: LIMIT },
      ...answer,
    } satisfies GlossaryLookupResult),
  };
}

describe('a GlossaryProvider answer at the largest maxTokens', () => {
  const entry = { term: 'First', definition: 'The first.', url: 'https://learn.jamf.com/r/en-US/jamf-technical-glossary/First' };

  it('says to narrow the search when some fit and it does not say what was left out', async () => {
    provide({ entries: [entry], totalMatches: 3, tokenInfo: { tokenCount: 40000, truncated: true, maxTokens: LIMIT } });

    for (const outputMode of ['full', 'compact']) {
      const text = textOf(await lookup({ term: 'MDM', maxTokens: LIMIT, outputMode }));
      expect(text).toContain(`*${AT_LIMIT} Narrow your search.*`);
      expect(text).not.toContain('Increase `maxTokens`');
    }
  });

  it('names no entry when every one it left out is larger than the limit', async () => {
    provide({
      entries: [entry],
      totalMatches: 2,
      tokenInfo: { tokenCount: 40000, truncated: true, maxTokens: LIMIT },
      truncatedContent: { omittedCount: 1, omittedItems: [{ title: 'Second', estimatedTokens: 60000 }] },
    });

    const text = textOf(await lookup({ term: 'MDM', maxTokens: LIMIT }));
    expect(text).toContain(`*${AT_LIMIT}*`);
    expect(text).not.toContain('Look up');
  });

  it('names an entry it left out that costs the limit exactly', async () => {
    provide({
      entries: [entry],
      totalMatches: 3,
      tokenInfo: { tokenCount: 40000, truncated: true, maxTokens: LIMIT },
      truncatedContent: {
        omittedCount: 2,
        omittedItems: [{ title: 'Second', estimatedTokens: LIMIT + 1 }, { title: 'Third', estimatedTokens: LIMIT }],
      },
    });

    expect(textOf(await lookup({ term: 'MDM', maxTokens: LIMIT }))).toContain(
      `*${AT_LIMIT} Look up an entry that was left out by its own name to get it: Third.*`,
    );
  });

  it('does not advise a larger maxTokens when its one match does not fit', async () => {
    provide({ totalMatches: 1 });

    for (const outputMode of ['full', 'compact']) {
      const text = textOf(await lookup({ term: 'MDM', maxTokens: LIMIT, outputMode }));
      expect(text).toContain(
        '*The one matching entry does not fit in `maxTokens: 50000`, which is the largest `maxTokens` can be.*',
      );
      expect(text).not.toContain('larger `maxTokens`');
    }
  });

  it('says to narrow the search when several match and not even the first fits', async () => {
    provide({ totalMatches: 3 });

    const text = textOf(await lookup({ term: 'MDM', maxTokens: LIMIT }));
    expect(text).toContain(
      '*3 entries match, but not even the first fits in `maxTokens: 50000`, which is the largest ' +
      '`maxTokens` can be. Narrow your search.*',
    );
    expect(text).not.toContain('larger `maxTokens`');
  });

  it('does not advise a maxTokens it already had, when its figure is no larger', async () => {
    // Its cut and its costs disagree: the first entry is said to cost less
    // than the budget it did not fit in.
    provide({
      totalMatches: 1,
      truncatedContent: { omittedCount: 1, omittedItems: [{ title: 'First', estimatedTokens: 40000 }] },
    });

    const text = textOf(await lookup({ term: 'MDM', maxTokens: LIMIT }));
    expect(text).toContain(
      '*The one matching entry, First, does not fit in `maxTokens: 50000`, which is the largest `maxTokens` can be.*',
    );
    expect(text).not.toContain('`maxTokens: 40000`');
  });
});

describe('a GlossaryProvider answer below the limit whose first entry is larger than it', () => {
  const firstOver = (maxTokens: number, others: { title: string; estimatedTokens: number }[]): void => {
    provide({
      totalMatches: others.length + 1,
      tokenInfo: { tokenCount: 0, truncated: true, maxTokens },
      truncatedContent: {
        omittedCount: others.length + 1,
        omittedItems: [{ title: 'Lead', estimatedTokens: 60000 }, ...others],
      },
    });
  };
  const over = 'It needs 60000 tokens, more than `maxTokens` allows (50000).';

  it('gives the largest cost among the entries it names, not among those over the limit', async () => {
    firstOver(5000, [
      { title: 'A', estimatedTokens: 100 },
      { title: 'B', estimatedTokens: LIMIT + 1 },
      { title: 'C', estimatedTokens: 30000 },
    ]);

    expect(textOf(await lookup({ term: 'MDM', maxTokens: 5000 }))).toContain(
      `fits in \`maxTokens: 5000\`. ${over} ` +
      'Look up another entry by its own name, with `maxTokens: 30000` or more, to get it: A, C.*',
    );
  });

  it('gives no budget when the one it had is exactly what the costliest named entry needs', async () => {
    firstOver(5000, [{ title: 'A', estimatedTokens: 100 }, { title: 'B', estimatedTokens: 5000 }]);

    expect(textOf(await lookup({ term: 'MDM', maxTokens: 5000 }))).toContain(
      `fits in \`maxTokens: 5000\`. ${over} Look up another entry by its own name to get it: A, B.*`,
    );
  });
});
