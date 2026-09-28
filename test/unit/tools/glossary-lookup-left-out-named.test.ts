/**
 * Which entries a partial `jamf_docs_glossary_lookup` answer left out, as a
 * markdown reader sees it: the registered tool over MCP, with the real
 * glossary service and formatter, and only the two Fluid Topics calls mocked,
 * or a `GlossaryProvider` answering instead.
 *
 * Until 2026-09-28 a markdown answer that some entries fit and others did not
 * said "Results truncated due to token limit. Increase `maxTokens` or narrow
 * your search." and named none of those left out. Only `truncatedContent`, in
 * JSON and on the structured channel, listed them, so "narrow your search"
 * gave a markdown reader nothing to narrow it to. Live that day, `device` at
 * `maxTokens: 100` showed device activation and was silent on the six others,
 * device enrollment and Automated Device Enrollment among them.
 *
 * The line is charged to the whole reply as sent, so it never takes a reply
 * over `maxTokens`. A full reply is often over it already, since the cut counts
 * only each entry's `term: definition`, and then gets no line.
 *
 * The entries here are the four `Apple` entries as learn.jamf.com served them
 * on 2026-09-26 (`glossary-apple-content.ts`): Apple Account 129 tokens, Apple
 * Business 110, Apple School Manager 134 and Apple File System (APFS) 82, in
 * the order `Apple` ranks them. With Apple Account alone shown, the full reply
 * is 199 tokens before the line; with Apple Business beside it, 337.
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
import { estimateTokens } from '../../../src/core/services/tokenizer.js';
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

/** The footer line that names the entries left out, if the reply has one. */
function leftOutLine(text: string): string | undefined {
  return text.split('\n').find(line => line.startsWith('*Left out: '));
}

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

const INCREASE = '*Results truncated due to token limit. Increase `maxTokens` or narrow your search.*';

describe('a partial answer in markdown', () => {
  it('names the entries left out, with what each costs, under the lines it follows, in full and compact', async () => {
    // Apple Account and Apple Business (239) are shown. The full reply is 337
    // tokens before the line and 358 with it; compact, 100 and 122.
    for (const outputMode of ['full', 'compact']) {
      const text = textOf(await lookup({ term: 'Apple', maxTokens: 360, outputMode }));

      expect(text.endsWith(
        '\n*2 of 4 match(es) | 239 tokens*\n' +
        `${INCREASE}\n` +
        '*Left out: Apple School Manager (134 tokens), Apple File System \\(APFS\\) (82 tokens).*\n',
      )).toBe(true);
      expect(estimateTokens(text)).toBeLessThanOrEqual(360);
    }
  });

  it('names them in the order the answer ranks them, the next one first', async () => {
    const text = textOf(await lookup({ term: 'Apple', maxTokens: 200, outputMode: 'compact' }));

    expect(text).toContain('*1 of 4 match(es) | 129 tokens*');
    expect(leftOutLine(text)).toBe(
      '*Left out: Apple Business (110 tokens), Apple School Manager (134 tokens), ' +
      'Apple File System \\(APFS\\) (82 tokens).*',
    );
  });

  it('names only as many as the reply has room for, and counts the rest', async () => {
    // Apple Account alone, in full: 199 tokens before the line.
    const one = textOf(await lookup({ term: 'Apple', maxTokens: 212 }));
    expect(one).toContain('*1 of 4 match(es) | 129 tokens*');
    expect(leftOutLine(one)).toBe('*Left out: Apple Business (110 tokens), and 2 more.*');

    const two = textOf(await lookup({ term: 'Apple', maxTokens: 221 }));
    expect(leftOutLine(two)).toBe(
      '*Left out: Apple Business (110 tokens), Apple School Manager (134 tokens), and 1 more.*',
    );

    const three = textOf(await lookup({ term: 'Apple', maxTokens: 228 }));
    expect(leftOutLine(three)).toBe(
      '*Left out: Apple Business (110 tokens), Apple School Manager (134 tokens), ' +
      'Apple File System \\(APFS\\) (82 tokens).*',
    );
  });

  it('is charged to the whole reply: it is there when the reply with it costs maxTokens, and not a token below', async () => {
    const fits = textOf(await lookup({ term: 'Apple', maxTokens: 212 }));
    expect(estimateTokens(fits)).toBe(212);
    expect(leftOutLine(fits)).toBe('*Left out: Apple Business (110 tokens), and 2 more.*');

    const tight = textOf(await lookup({ term: 'Apple', maxTokens: 211 }));
    expect(tight).toContain('*1 of 4 match(es) | 129 tokens*');
    expect(leftOutLine(tight)).toBeUndefined();
    expect(tight.endsWith(`${INCREASE}\n`)).toBe(true);
  });

  it('adds nothing to a reply already over maxTokens, as a full one often is', async () => {
    // Charged to what the cut leaves, maxTokens minus the entries' 129
    // tokens, the line would take this reply from 199 tokens to 228 (live:
    // 197 to 226).
    const text = textOf(await lookup({ term: 'Apple', maxTokens: 200 }));
    expect(estimateTokens(text)).toBe(199);
    expect(leftOutLine(text)).toBeUndefined();

    // At 300 the full reply is 337 tokens before any line, and gets none.
    const over = textOf(await lookup({ term: 'Apple', maxTokens: 300 }));
    expect(estimateTokens(over)).toBe(337);
    expect(leftOutLine(over)).toBeUndefined();
  });

  it('never takes a reply over maxTokens, at any budget, in full or compact', async () => {
    let named = 0;
    for (let maxTokens = 100; maxTokens <= 460; maxTokens++) {
      for (const outputMode of ['full', 'compact']) {
        const text = textOf(await lookup({ term: 'Apple', maxTokens, outputMode }));
        const line = leftOutLine(text);
        if (line !== undefined) {
          named++;
          expect(estimateTokens(text), `${outputMode} at ${String(maxTokens)}`).toBeLessThanOrEqual(maxTokens);
        }
      }
    }
    // So that this does not pass by naming none.
    expect(named).toBeGreaterThan(300);
  });

  it('gives names that work: each one looked up comes back first', async () => {
    for (const title of ['Apple School Manager', 'Apple File System (APFS)']) {
      const named = await lookup({ term: title, maxTokens: 300 });
      expect((named.structuredContent?.entries as { term: string }[])[0]?.term).toBe(title);
    }
  });

  it('leaves the JSON text and the structured channel as they were', async () => {
    const json = await lookup({ term: 'Apple', maxTokens: 300, responseFormat: 'json' });
    const markdown = await lookup({ term: 'Apple', maxTokens: 300 });

    expect(textOf(json)).not.toContain('Left out');
    expect(JSON.parse(textOf(json))).toMatchObject({
      totalMatches: 4,
      tokenInfo: { tokenCount: 239, truncated: true, maxTokens: 300 },
      truncatedContent: {
        omittedCount: 2,
        omittedItems: [
          { title: 'Apple School Manager', estimatedTokens: 134 },
          { title: 'Apple File System (APFS)', estimatedTokens: 82 },
        ],
      },
    });
    expect(markdown.structuredContent).toEqual(json.structuredContent);
  });

  it('adds no line to an answer nothing was left out of', async () => {
    const text = textOf(await lookup({ term: 'Apple', maxTokens: 455 }));

    expect(text).toContain('*4 of 4 match(es) | 455 tokens*');
    expect(leftOutLine(text)).toBeUndefined();
  });

  it('adds no line to an answer with no entry that fits, which names the first already', async () => {
    const text = textOf(await lookup({ term: 'Apple', maxTokens: 100 }));

    expect(text).toContain('not even the first, Apple Account, fits in `maxTokens: 100`');
    expect(leftOutLine(text)).toBeUndefined();
  });
});

/** A `GlossaryProvider` that answers this. */
function provide(answer: GlossaryLookupResult): void {
  ctx.glossaryProvider = { lookup: vi.fn().mockResolvedValue(answer) };
}

const shown = { term: 'Shown', definition: 'The one shown.', url: 'https://learn.jamf.com/r/en-US/jamf-technical-glossary/Shown' };

describe('a GlossaryProvider partial answer', () => {
  it('names five at most, and counts the rest', async () => {
    const omittedItems = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map(title => ({ title, estimatedTokens: 10 }));
    provide({
      entries: [shown],
      totalMatches: 9,
      tokenInfo: { tokenCount: 10, truncated: true, maxTokens: 5000 },
      truncatedContent: { omittedCount: 8, omittedItems },
    });

    for (const outputMode of ['full', 'compact']) {
      const text = textOf(await lookup({ term: 'MDM', maxTokens: 5000, outputMode }));
      expect(leftOutLine(text)).toBe(
        '*Left out: A (10 tokens), B (10 tokens), C (10 tokens), D (10 tokens), E (10 tokens), and 3 more.*',
      );
    }
  });

  it('counts the rest from the matches it says there are, as the line above it does', async () => {
    // Three left out, only one of them listed.
    provide({
      entries: [shown],
      totalMatches: 4,
      tokenInfo: { tokenCount: 10, truncated: true, maxTokens: 5000 },
      truncatedContent: { omittedCount: 3, omittedItems: [{ title: 'A', estimatedTokens: 10 }] },
    });

    const text = textOf(await lookup({ term: 'MDM', maxTokens: 5000 }));
    expect(text).toContain('*1 of 4 match(es)');
    expect(leftOutLine(text)).toBe('*Left out: A (10 tokens), and 2 more.*');
  });

  it('escapes a title as the entries are escaped', async () => {
    provide({
      entries: [shown],
      totalMatches: 2,
      tokenInfo: { tokenCount: 10, truncated: true, maxTokens: 5000 },
      truncatedContent: { omittedCount: 1, omittedItems: [{ title: 'policy *[Jamf](x)*', estimatedTokens: 10 }] },
    });

    expect(leftOutLine(textOf(await lookup({ term: 'MDM', maxTokens: 5000 })))).toBe(
      '*Left out: policy \\*\\[Jamf\\]\\(x\\)\\* (10 tokens).*',
    );
  });

  it('adds no line when it says nothing was cut, whatever it lists', async () => {
    provide({
      entries: [shown],
      totalMatches: 2,
      tokenInfo: { tokenCount: 10, truncated: false, maxTokens: 5000 },
      truncatedContent: { omittedCount: 1, omittedItems: [{ title: 'A', estimatedTokens: 10 }] },
    });

    expect(leftOutLine(textOf(await lookup({ term: 'MDM', maxTokens: 5000 })))).toBeUndefined();
  });

  it('adds no line when it does not say which entries it left out', async () => {
    provide({
      entries: [shown],
      totalMatches: 3,
      tokenInfo: { tokenCount: 10, truncated: true, maxTokens: 5000 },
    });

    const text = textOf(await lookup({ term: 'MDM', maxTokens: 5000 }));
    expect(text).toContain('*Results truncated due to token limit. Increase `maxTokens` or narrow your search.*');
    expect(leftOutLine(text)).toBeUndefined();
  });

  it('names no more entries than the count above it says were left out', async () => {
    // One left out, three listed: its list and its count disagree.
    provide({
      entries: [shown],
      totalMatches: 2,
      tokenInfo: { tokenCount: 10, truncated: true, maxTokens: 5000 },
      truncatedContent: {
        omittedCount: 3,
        omittedItems: ['A', 'B', 'C'].map(title => ({ title, estimatedTokens: 3 })),
      },
    });

    const text = textOf(await lookup({ term: 'MDM', maxTokens: 5000 }));
    expect(text).toContain('*1 of 2 match(es)');
    expect(leftOutLine(text)).toBe('*Left out: A (3 tokens).*');

    // None left out by its count, two listed: none named.
    provide({
      entries: [shown, shown],
      totalMatches: 1,
      tokenInfo: { tokenCount: 10, truncated: true, maxTokens: 5000 },
      truncatedContent: {
        omittedCount: 2,
        omittedItems: ['A', 'B'].map(title => ({ title, estimatedTokens: 3 })),
      },
    });
    const none = textOf(await lookup({ term: 'MDM', maxTokens: 5000 }));
    expect(none).toContain('*2 of 1 match(es)');
    expect(leftOutLine(none)).toBeUndefined();
  });

  it('charges the line to the reply it sends, not to the tokenCount it gives', async () => {
    const omittedItems = ['A', 'B'].map(title => ({ title, estimatedTokens: 10 }));
    // A tokenCount over maxTokens beside a short reply: there is room.
    provide({
      entries: [shown],
      totalMatches: 3,
      tokenInfo: { tokenCount: 120, truncated: true, maxTokens: 100 },
      truncatedContent: { omittedCount: 2, omittedItems },
    });
    const room = textOf(await lookup({ term: 'MDM', maxTokens: 100 }));
    expect(leftOutLine(room)).toBe('*Left out: A (10 tokens), B (10 tokens).*');
    expect(estimateTokens(room)).toBeLessThanOrEqual(100);

    // A small tokenCount beside a reply already over maxTokens: none.
    provide({
      entries: [{ ...shown, definition: 'word '.repeat(80).trim() }],
      totalMatches: 3,
      tokenInfo: { tokenCount: 10, truncated: true, maxTokens: 100 },
      truncatedContent: { omittedCount: 2, omittedItems },
    });
    const over = textOf(await lookup({ term: 'MDM', maxTokens: 100 }));
    expect(estimateTokens(over)).toBeGreaterThan(100);
    expect(leftOutLine(over)).toBeUndefined();
  });

  it('charges it to the maxTokens the lookup was asked with, not one it gives back', async () => {
    // Asked for 100, it says it cut to 5000. At 5000 the full reply names five
    // and costs 107 tokens; at 100 it names three and costs 100.
    const omittedItems = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map(title => ({ title, estimatedTokens: 10 }));
    provide({
      entries: [{ ...shown, definition: 'The one shown, with a definition long enough to fill the reply.' }],
      totalMatches: 9,
      tokenInfo: { tokenCount: 10, truncated: true, maxTokens: 5000 },
      truncatedContent: { omittedCount: 8, omittedItems },
    });

    const asked = textOf(await lookup({ term: 'MDM', maxTokens: 100 }));
    expect(leftOutLine(asked)).toBe('*Left out: A (10 tokens), B (10 tokens), C (10 tokens), and 5 more.*');
    expect(estimateTokens(asked)).toBeLessThanOrEqual(100);

    const wide = textOf(await lookup({ term: 'MDM', maxTokens: 5000 }));
    expect(leftOutLine(wide)).toBe(
      '*Left out: A (10 tokens), B (10 tokens), C (10 tokens), D (10 tokens), E (10 tokens), and 3 more.*',
    );
  });
});
