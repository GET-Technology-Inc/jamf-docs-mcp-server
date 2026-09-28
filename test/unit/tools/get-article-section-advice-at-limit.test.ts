/**
 * The advice under a truncated article's "Available Sections" never asks for
 * a `maxTokens` the schema rejects.
 *
 * `formatSectionAdvice` said "Raise `maxTokens`" whenever no section fitted,
 * and "raise `maxTokens` to get the whole article" under a lone section, even
 * at `maxTokens: 50000`, the largest the schema accepts. Offline on
 * 2026-09-28, through the registered tool, an article of two ~59,639-token
 * sections answered at 5,000, 49,999 and 50,000 alike:
 *
 *     *No section fits within `maxTokens` (50,000); the smallest is ~59,639
 *     tokens. Raise `maxTokens`, or use `summaryOnly` for an outline.*
 *
 * No `maxTokens` fits a section that large, whatever the budget asked for.
 * #364 fixed the same shape in `jamf_docs_get_toc` and #372 in the glossary.
 * A section's cost is known, so it is compared with the largest budget; the
 * whole article's is not, so the lone-section line reads the budget asked
 * for, as #364's fallback does.
 *
 * Over MCP, against a whole server with only the http client stubbed. The
 * markdown carries the advice; the JSON reply and compact markdown have none,
 * and are checked to be as they were.
 */

import { describe, it, expect } from 'vitest';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createMcpServer } from '../../../src/core/create-server.js';
import { MapsRegistry } from '../../../src/core/services/maps-registry.js';
import { TopicResolver } from '../../../src/core/services/topic-resolver.js';
import type { HttpClient } from '../../../src/core/http-client.js';
import { TOKEN_CONFIG } from '../../../src/core/constants.js';
import { formatArticleFull } from '../../../src/core/utils/format-article.js';
import { createMockCache, createMockContext } from '../../helpers/mock-context.js';
import { createArticleSection, createFetchArticleResult, createTokenInfo } from '../../helpers/fixtures.js';
import type { FtMapInfo, FtTopicInfo } from '../../../src/core/types.js';
import type { ServerContext } from '../../../src/core/types/context.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

const MAP = 'A4LI4vM0BILraYeOD89WGg';
const MAP_PATH = `/api/khub/maps/${MAP}`;
const LIMIT = TOKEN_CONFIG.MAX_TOKENS_LIMIT;

const meta = (key: string, ...values: string[]): { key: string; label: string; values: string[] } =>
  ({ key, label: key, values });

const PRO: FtMapInfo = {
  id: MAP,
  title: 'Jamf Pro Documentation 11.32.0',
  mapApiEndpoint: `/api/khub/maps/${MAP}`,
  metadata: [
    meta('version_bundle_stem', 'jamf-pro-documentation'),
    meta('version', '11.32.0'),
    meta('bundle', 'jamf-pro-documentation-current'),
    meta('latestVersion', 'yes'),
    meta('ft:locale', 'en-US'),
  ],
};

/** `count` paragraphs of about 140 tokens each. */
function paragraphs(count: number): string {
  return Array.from({ length: count }, (_, i) => `<p>Paragraph ${String(i)} ${'lorem ipsum dolor sit amet '.repeat(20)}</p>`).join('');
}

/** The topics, by content ID: a short intro, then its `<h2>` sections of `size` paragraphs each. */
const TOPICS: Partial<Record<string, { title: string; html: string }>> = {
  // Two sections of ~59,639 tokens: neither fits in any `maxTokens`.
  TwoHugeSections: {
    title: 'Two Huge Sections',
    html: `<p>Intro.</p><h2>First Part</h2>${paragraphs(430)}<h2>Second Part</h2>${paragraphs(430)}`,
  },
  // Two sections of ~29,700 tokens: each fits at 50,000, not at 5,000.
  TwoLargeSections: {
    title: 'Two Large Sections',
    html: `<p>Intro.</p><h2>First Part</h2>${paragraphs(214)}<h2>Second Part</h2>${paragraphs(214)}`,
  },
  // A ~59,600-token intro and one small section: the article fits in no `maxTokens`.
  OneSmallSection: {
    title: 'One Small Section',
    html: `<p>Intro.</p>${paragraphs(430)}<h2>Only Part</h2>${paragraphs(20)}`,
  },
  // Several sections, one small.
  SeveralSections: {
    title: 'Several Sections',
    html: `<p>Intro.</p><h2>First Part</h2>${paragraphs(100)}<h2>Second Part</h2>${paragraphs(5)}<h2>Third Part</h2>${paragraphs(100)}`,
  },
};

const topicInfo = (id: string): FtTopicInfo => ({
  title: TOPICS[id]?.title ?? id,
  id,
  contentApiEndpoint: `/api/khub/maps/${MAP}/topics/${id}/content`,
  metadata: [meta('version', '11.32.0'), meta('ft:locale', 'en-US')],
});

function upstream(): ServerContext {
  const answer = async (url: string): Promise<unknown> => {
    await Promise.resolve();
    const path = new URL(url).pathname;
    if (path === '/api/khub/maps') { return [PRO]; }
    if (path === `${MAP_PATH}/toc`) { return []; }
    const topic = new RegExp(`^${MAP_PATH}/topics/([^/]+)(/content)?$`).exec(path);
    const id = topic?.[1];
    if (id !== undefined && Object.hasOwn(TOPICS, id)) {
      return topic?.[2] === undefined ? topicInfo(id) : `<div class="body conbody">${TOPICS[id]?.html ?? ''}</div>`;
    }
    throw new Error(`offline: no fixture for ${url}`);
  };
  const http: HttpClient = {
    getJson: async <T>(url: string) => await answer(url) as T,
    getText: async (url: string) => await answer(url) as string,
    postJson: async (url: string) => await Promise.reject(new Error(`offline: no fixture for ${url}`)),
  };
  const cache = createMockCache();
  const mapsRegistry = new MapsRegistry(cache, undefined, undefined, undefined, http);
  const topicResolver = new TopicResolver(mapsRegistry, cache, undefined, undefined, http);
  return createMockContext({ cache, http, mapsRegistry, topicResolver });
}

async function article(args: Record<string, unknown>): Promise<string> {
  const server = createMcpServer(upstream());
  const client = new Client({ name: 'test-client', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = await client.callTool({ name: 'jamf_docs_get_article', arguments: { mapId: MAP, ...args } });
    expect(result.isError).toBeUndefined();
    return (result.content as { type: string; text?: string }[]).map(c => c.text ?? '').join('\n\n');
  } finally {
    await client.close();
    await server.close();
  }
}

/** The advice line: the last italic line of the "Available Sections" block. */
function advice(markdown: string): string {
  const block = markdown.slice(markdown.indexOf('## Available Sections'));
  const lines = block.split('\n').filter(line => line.startsWith('*') && !line.startsWith('*...'));
  return lines[0] ?? '';
}

// ── No section fits in any maxTokens ────────────────────────────────────────

describe('no section fits in the largest maxTokens: the advice is what then works', () => {
  it.each([5_000, 49_999, LIMIT])('maxTokens: %i', async (maxTokens) => {
    const markdown = await article({ contentId: 'TwoHugeSections', maxTokens });

    expect(markdown).toContain('- **First Part** (~59639 tokens)');
    expect(advice(markdown)).toBe(
      `*No section fits within \`maxTokens\` (${maxTokens.toLocaleString()}); the smallest is ~59,639 tokens, `
      + 'more than `maxTokens` allows (50,000). Use `summaryOnly` for an outline, or `section` to read the start of one.*',
    );
    expect(markdown).not.toMatch(/raise `maxTokens`/i);
  }, 30_000);

  it('and each thing it advises answers: an outline, and the start of a section', async () => {
    const outline = await article({ contentId: 'TwoHugeSections', maxTokens: LIMIT, summaryOnly: true });
    const section = await article({ contentId: 'TwoHugeSections', maxTokens: LIMIT, section: 'Second Part' });

    expect(outline).toContain('## Article Outline (2 sections)');
    expect(section).toContain('*Showing section: "Second Part"*');
    expect(section).toContain('## Second Part');
    expect(section).not.toContain('## First Part');
    expect(section).toContain('*(truncated)*');
  }, 30_000);
});

// ── Unchanged where a larger maxTokens works ────────────────────────────────

describe('below the limit, where a larger maxTokens does fit a section, the advice is as it was', () => {
  it('two sections of ~29,700 tokens at maxTokens: 5000', async () => {
    const markdown = await article({ contentId: 'TwoLargeSections', maxTokens: 5_000 });

    expect(advice(markdown)).toMatch(
      /^\*No section fits within `maxTokens` \(5,000\); the smallest is ~29,\d{3} tokens\. Raise `maxTokens`, or use `summaryOnly` for an outline\.\*$/,
    );
  }, 30_000);

  it('several sections, one of which fits', async () => {
    const markdown = await article({ contentId: 'SeveralSections', maxTokens: 5_000 });

    expect(advice(markdown)).toBe('*Use `section` parameter to retrieve a specific section.*');
  }, 30_000);
});

// ── One section ─────────────────────────────────────────────────────────────

describe('one listed section: at the largest maxTokens the whole article is not offered', () => {
  it('maxTokens: 50000', async () => {
    const markdown = await article({ contentId: 'OneSmallSection', maxTokens: LIMIT });

    expect(advice(markdown)).toBe(
      '*Use `section` to retrieve the one listed section. The whole article is larger than `maxTokens` allows (50,000).*',
    );
  }, 30_000);

  it.each([5_000, 49_999])('maxTokens: %i, as it was', async (maxTokens) => {
    const markdown = await article({ contentId: 'OneSmallSection', maxTokens });

    expect(advice(markdown)).toBe(
      '*Use `section` to retrieve the one listed section, or raise `maxTokens` to get the whole article.*',
    );
  }, 30_000);
});

// ── The other formats carry no advice ───────────────────────────────────────

describe('the JSON reply and compact markdown carry no such advice, and are as they were', () => {
  it('JSON: the sections and their token counts, and no advice', async () => {
    const json = JSON.parse(await article({ contentId: 'TwoHugeSections', maxTokens: LIMIT, responseFormat: 'json' })) as {
      sections: { title: string; tokenCount: number }[];
      tokenInfo: { truncated: boolean; maxTokens: number };
      content: string;
    };

    expect(json.sections.map(s => [s.title, s.tokenCount])).toEqual([['First Part', 59639], ['Second Part', 59639]]);
    expect(json.tokenInfo).toMatchObject({ truncated: true, maxTokens: LIMIT });
    expect(json.content).not.toMatch(/maxTokens`? \(|summaryOnly/);
  }, 30_000);

  it('compact: the preview line and the section names', async () => {
    const markdown = await article({ contentId: 'TwoHugeSections', maxTokens: LIMIT, outputMode: 'compact' });

    expect(markdown).toContain('*[Showing preview. ');
    expect(markdown).toContain('## Available Sections (2)\n\n  - First Part\n  - Second Part\n');
    expect(markdown).not.toContain('No section fits');
    expect(markdown).not.toContain('`maxTokens`');
  }, 30_000);
});

// ── The boundaries, on the formatter ────────────────────────────────────────

describe('the boundaries: a section of exactly 50,000 fits, and the largest budget is exactly 50,000', () => {
  /** The advice under `sections`, for an article cut to `maxTokens`. */
  const adviceFor = (maxTokens: number, ...tokenCounts: number[]): string => advice(formatArticleFull(
    createFetchArticleResult({ tokenInfo: createTokenInfo({ truncated: true, tokenCount: maxTokens, maxTokens }) }),
    { sections: tokenCounts.map((tokenCount, i) => createArticleSection({ id: `s${String(i)}`, title: `S${String(i)}`, tokenCount })) },
  ));

  it('smallest 50,000 at 49,999: a larger maxTokens fits it', () => {
    expect(adviceFor(49_999, 50_000, 80_000)).toBe(
      '*No section fits within `maxTokens` (49,999); the smallest is ~50,000 tokens. Raise `maxTokens`, or use `summaryOnly` for an outline.*',
    );
  });

  it('smallest 50,001 at 49,999: none does', () => {
    expect(adviceFor(49_999, 50_001, 80_000)).toBe(
      '*No section fits within `maxTokens` (49,999); the smallest is ~50,001 tokens, more than `maxTokens` allows (50,000). '
      + 'Use `summaryOnly` for an outline, or `section` to read the start of one.*',
    );
  });

  it('one section, at 49,999 and at 50,000', () => {
    expect(adviceFor(49_999, 300)).toBe(
      '*Use `section` to retrieve the one listed section, or raise `maxTokens` to get the whole article.*',
    );
    expect(adviceFor(LIMIT, 300)).toBe(
      '*Use `section` to retrieve the one listed section. The whole article is larger than `maxTokens` allows (50,000).*',
    );
  });

  it('a section that fits, at 50,000: the advice is as it was', () => {
    expect(adviceFor(LIMIT, 300, 60_000)).toBe('*Use `section` parameter to retrieve a specific section.*');
  });
});
