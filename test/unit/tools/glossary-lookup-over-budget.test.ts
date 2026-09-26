/**
 * What a client reads from `jamf_docs_glossary_lookup` when the glossary has
 * the term but its entry does not fit `maxTokens`: the registered tool over
 * MCP, with the real glossary service and formatter, and only the two Fluid
 * Topics calls mocked.
 *
 * Until 2026-09-26 the tool took "no entries" to mean "no match", so a leading
 * entry costing more than `maxTokens` answered `No glossary entries found for
 * "Apple School Manager".`, the reply for a term the glossary does not have,
 * with `totalMatches: 1, truncated: true` beside it and advice to use
 * `jamf_docs_search` instead. Live on 2026-09-26, six of the 123 terms looked
 * up by their own title at `maxTokens: 100` came back that way. The check also
 * ran before the JSON branch, so `responseFormat: "json"` got that prose too,
 * for a real no-match as well.
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
import {
  GLOSSARY_MAP_ID,
  LIVE_GLOSSARY_TOC,
  serveGlossaryContent,
} from '../../helpers/glossary-upstream.js';
import { APPLE_ENTRY_CONTENT } from '../../fixtures/glossary-apple-content.js';
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

const NO_MATCH = 'No glossary entries found';

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
  vi.mocked(fetchTopicContent).mockImplementation(
    serveGlossaryContent(() => new Set(), APPLE_ENTRY_CONTENT),
  );
});

async function lookup(args: Record<string, unknown>): Promise<CallResult> {
  return await client.callTool({ name: 'jamf_docs_glossary_lookup', arguments: args }) as CallResult;
}

const ASM_OMITTED = {
  omittedCount: 1,
  omittedItems: [{ title: 'Apple School Manager', estimatedTokens: 134 }],
};

const ASM_ADVICE =
  'The one matching entry, Apple School Manager, does not fit in `maxTokens: 100`. ' +
  'Repeat the lookup with `maxTokens: 134` or more to get it.';

describe('the term is in the glossary but its entry does not fit maxTokens', () => {
  it('says so in markdown, with the maxTokens that returns it', async () => {
    const result = await lookup({ term: 'Apple School Manager', maxTokens: 100 });
    const text = textOf(result);

    expect(result.isError).not.toBe(true);
    expect(text).not.toContain(NO_MATCH);
    expect(text).not.toContain('jamf_docs_search');
    expect(text).toContain('# Glossary Lookup: "Apple School Manager"\n\nFound 1 match');
    expect(text).toContain('*0 of 1 match(es) | 0 tokens*');
    expect(text).toContain(ASM_ADVICE);
    // With one match there is nothing to narrow.
    expect(text).not.toContain('narrow your search');
    expect(result.structuredContent).toEqual({
      term: 'Apple School Manager',
      totalMatches: 1,
      entries: [],
      truncated: true,
      truncatedContent: ASM_OMITTED,
    });
  });

  it('says so in compact markdown', async () => {
    const text = textOf(await lookup({ term: 'Apple School Manager', maxTokens: 100, outputMode: 'compact' }));

    expect(text).not.toContain(NO_MATCH);
    expect(text).toContain('## Glossary: "Apple School Manager" (1 match)');
    expect(text).toContain(ASM_ADVICE);
  });

  it('answers JSON with the documented JSON body, not prose', async () => {
    const result = await lookup({ term: 'Apple School Manager', maxTokens: 100, responseFormat: 'json' });

    expect(JSON.parse(textOf(result))).toEqual({
      term: 'Apple School Manager',
      totalMatches: 1,
      entries: [],
      tokenInfo: { tokenCount: 0, truncated: true, maxTokens: 100 },
      truncatedContent: ASM_OMITTED,
    });
    expect(result.structuredContent?.truncatedContent).toEqual(ASM_OMITTED);
  });

  it('gives a figure that works: the lookup it advises returns the entry', async () => {
    const result = await lookup({ term: 'Apple School Manager', maxTokens: 134 });

    expect(result.structuredContent?.entries).toHaveLength(1);
    expect(result.structuredContent?.truncated).toBe(false);
    expect(textOf(result)).toContain('*1 of 1 match(es) | 134 tokens*');
  });

  it('names the first entry and the budget for all of them when several match', async () => {
    // Live on 2026-09-26: `Apple` at maxTokens 100 answered "No glossary
    // entries found" with totalMatches 4, and at 5000 returned all four.
    const text = textOf(await lookup({ term: 'Apple', maxTokens: 100 }));

    expect(text).not.toContain(NO_MATCH);
    expect(text).toContain('*0 of 4 match(es) | 0 tokens*');
    expect(text).toContain(
      '4 entries match, but not even the first, Apple Account, fits in `maxTokens: 100`. ' +
      'Repeat the lookup with `maxTokens: 129` or more to get it, or `maxTokens: 455` for all 4.',
    );

    const all = await lookup({ term: 'Apple', maxTokens: 455 });
    expect(all.structuredContent?.entries).toHaveLength(4);
    expect(all.structuredContent?.truncated).toBe(false);
  });

  it('keeps the usual note when some entries fit, and reports the rest on the structured channel', async () => {
    const result = await lookup({ term: 'Apple', maxTokens: 129 });

    expect(textOf(result)).toContain('*1 of 4 match(es) | 129 tokens*');
    expect(textOf(result)).toContain('*Results truncated due to token limit. Increase `maxTokens` or narrow your search.*');
    expect(result.structuredContent?.truncatedContent).toEqual({
      omittedCount: 3,
      omittedItems: [
        { title: 'Apple Business', estimatedTokens: 110 },
        { title: 'Apple School Manager', estimatedTokens: 134 },
        { title: 'Apple File System (APFS)', estimatedTokens: 82 },
      ],
    });
  });
});

describe('a term with no entry', () => {
  it('is still "No glossary entries found" in markdown', async () => {
    const result = await lookup({ term: 'Apple Classroom Pro', maxTokens: 100 });

    expect(textOf(result)).toBe(
      `${NO_MATCH} for "Apple Classroom Pro".\n\n` +
      '*Tip: Try using `jamf_docs_search` with `docType: "glossary"` for broader results.*',
    );
    expect(result.structuredContent).toEqual({
      term: 'Apple Classroom Pro', totalMatches: 0, entries: [], truncated: false,
    });
  });

  it('is the documented JSON body in JSON, with totalMatches 0', async () => {
    const result = await lookup({ term: 'Apple Classroom Pro', maxTokens: 100, responseFormat: 'json' });

    expect(result.isError).not.toBe(true);
    expect(JSON.parse(textOf(result))).toEqual({
      term: 'Apple Classroom Pro',
      totalMatches: 0,
      entries: [],
      tokenInfo: { tokenCount: 0, truncated: false, maxTokens: 100 },
    });
  });
});

describe('a GlossaryProvider result with no entries and matches', () => {
  // A provider that honours maxTokens the way core does returns this shape,
  // and need not say what the omitted entries cost.
  const overBudget = (totalMatches: number, extra: Partial<GlossaryLookupResult> = {}): void => {
    ctx.glossaryProvider = {
      lookup: vi.fn().mockResolvedValue({
        entries: [],
        totalMatches,
        tokenInfo: { tokenCount: 0, truncated: true, maxTokens: 100 },
        ...extra,
      } satisfies GlossaryLookupResult),
    };
  };

  it('is not a no-match in markdown, full or compact, or in JSON', async () => {
    overBudget(1);

    for (const outputMode of ['full', 'compact']) {
      const text = textOf(await lookup({ term: 'MDM', maxTokens: 100, outputMode }));
      expect(text).not.toContain(NO_MATCH);
      expect(text).toContain(
        'The one matching entry does not fit in `maxTokens: 100`. ' +
        'Repeat the lookup with a larger `maxTokens` to get it.',
      );
    }
    expect(JSON.parse(textOf(await lookup({ term: 'MDM', maxTokens: 100, responseFormat: 'json' })))).toEqual({
      term: 'MDM',
      totalMatches: 1,
      entries: [],
      tokenInfo: { tokenCount: 0, truncated: true, maxTokens: 100 },
    });
  });

  it('says "them" when several match and no cost is known', async () => {
    overBudget(3);

    expect(textOf(await lookup({ term: 'MDM', maxTokens: 100 }))).toContain(
      '3 entries match, but not even the first fits in `maxTokens: 100`. ' +
      'Repeat the lookup with a larger `maxTokens` to get them.',
    );
  });

  it('does not advise a maxTokens the schema rejects', async () => {
    overBudget(1, {
      truncatedContent: { omittedCount: 1, omittedItems: [{ title: 'Long Entry', estimatedTokens: 60000 }] },
    });

    const text = textOf(await lookup({ term: 'MDM', maxTokens: 100 }));
    expect(text).toContain(
      'The one matching entry, Long Entry, does not fit in `maxTokens: 100`. ' +
      'It needs 60000 tokens, more than `maxTokens` allows (50000).',
    );
    expect(text).not.toContain('`maxTokens: 60000`');
  });

  it('advises the schema limit itself when that is what the entry needs', async () => {
    overBudget(1, {
      truncatedContent: { omittedCount: 1, omittedItems: [{ title: 'Long Entry', estimatedTokens: 50000 }] },
    });

    const text = textOf(await lookup({ term: 'MDM', maxTokens: 100 }));
    expect(text).toContain('Repeat the lookup with `maxTokens: 50000`');
    expect(text).not.toContain('more than `maxTokens` allows');
  });

  it('leaves out the budget for all of them when it is over the schema limit', async () => {
    overBudget(2, {
      truncatedContent: {
        omittedCount: 2,
        omittedItems: [{ title: 'First', estimatedTokens: 30000 }, { title: 'Second', estimatedTokens: 30000 }],
      },
    });

    const text = textOf(await lookup({ term: 'MDM', maxTokens: 100 }));
    expect(text).toContain(
      '2 entries match, but not even the first, First, fits in `maxTokens: 100`. ' +
      'Repeat the lookup with `maxTokens: 30000` or more to get it.*',
    );
    expect(text).not.toContain('for all');
  });

  it('gives no budget for all of them unless every match is listed', async () => {
    // A provider may list fewer entries than it counts. Their sum is then not
    // what all of them cost.
    overBudget(3, {
      truncatedContent: { omittedCount: 1, omittedItems: [{ title: 'First', estimatedTokens: 150 }] },
    });

    const text = textOf(await lookup({ term: 'MDM', maxTokens: 100 }));
    expect(text).toContain(
      '3 entries match, but not even the first, First, fits in `maxTokens: 100`. ' +
      'Repeat the lookup with `maxTokens: 150` or more to get it.*',
    );
    expect(text).not.toContain('for all');
  });

  it('escapes the title it names, as it does the entries', async () => {
    overBudget(1, {
      truncatedContent: { omittedCount: 1, omittedItems: [{ title: '[Click](https://example.com)', estimatedTokens: 150 }] },
    });

    const text = textOf(await lookup({ term: 'MDM', maxTokens: 100 }));
    expect(text).toContain('The one matching entry, \\[Click\\]\\(https://example.com\\), does not fit');
    expect(text).not.toContain('[Click](');
  });
});

describe('the description says which reply is which', () => {
  it('documents truncatedContent and the over-budget reply beside the no-match note', async () => {
    const { tools } = await client.listTools();
    const description = tools.find(t => t.name === 'jamf_docs_glossary_lookup')?.description ?? '';
    const returns = description.slice(description.indexOf('Returns:'), description.indexOf('Examples:'));
    // As prose, whatever the line breaks.
    const note = description.slice(description.indexOf('Note: "No glossary')).replace(/\s+/g, ' ');

    expect(returns).toContain('"truncatedContent"?');
    expect(returns).toContain('"estimatedTokens": number');
    expect(note).toContain('"totalMatches": 0');
    expect(note).toContain('not even the first fits in maxTokens');
  });
});
