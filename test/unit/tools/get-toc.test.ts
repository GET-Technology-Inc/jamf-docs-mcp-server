/**
 * Unit tests for jamf_docs_get_toc tool handler formatting functions.
 *
 * The private formatting functions (renderTocEntry, formatTocCompact,
 * formatTocFull, flattenTocEntries) are tested indirectly by calling
 * the registered tool through an in-process McpServer + Client pair
 * with mocked services.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/client';
import {
  createTocEntry,
  createPaginationInfo,
  createTokenInfo,
} from '../../helpers/fixtures.js';
import type { TocEntry } from '../../../src/core/types.js';
import { createMockContext } from '../../helpers/mock-context.js';

// --- Mock service modules before importing the tool --------------------------

vi.mock('../../../src/core/services/toc-service.js', () => ({
  fetchTableOfContents: vi.fn(),
}));

vi.mock('../../../src/core/services/cache.js', () => ({
  cache: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn(),
  },
}));

vi.mock('../../../src/core/services/metadata.js', () => ({
  getAvailableVersions: vi.fn().mockResolvedValue([]),
  getBundleIdForVersion: vi.fn().mockResolvedValue('jamf-pro-documentation'),
}));

// Import AFTER mocks are set up
import { fetchTableOfContents } from '../../../src/core/services/toc-service.js';
import { registerGetTocTool } from '../../../src/core/tools/get-toc.js';
import type { FetchTocResult } from '../../../src/core/types.js';

// ---------------------------------------------------------------------------

interface TextContent { type: 'text'; text: string }

function getTextContent(result: { content: unknown[] }): string {
  const first = result.content[0] as TextContent;
  return first.text;
}

/** One entry of `structuredContent.entries`, as a client receives it. */
interface FlatEntry {
  title: string;
  url: string;
  contentId?: string;
  depth: number;
}

/**
 * Rebuild the nested TOC from the flat entry list using only `depth` and the
 * order of the entries — i.e. only what a client reading `structuredContent`
 * actually holds. Round-tripping to the tree the tool was handed is what
 * "the hierarchy survives flattening" means; asserting depth values alone
 * would still pass if they were, say, off by one at every level.
 */
function rebuildTree(entries: FlatEntry[]): TocEntry[] {
  const roots: TocEntry[] = [];
  const ancestors: TocEntry[] = [];

  for (const entry of entries) {
    const node: TocEntry = { title: entry.title, url: entry.url };
    // Drop back to this entry's level; whatever is left below it is its
    // ancestry, and the last of those is its parent.
    ancestors.length = entry.depth;
    const parent = ancestors[entry.depth - 1] as TocEntry | undefined;
    if (parent === undefined) {
      roots.push(node);
    } else {
      parent.children = [...(parent.children ?? []), node];
    }
    ancestors.push(node);
  }

  return roots;
}

function buildTocResponse(overrides?: {
  toc?: TocEntry[];
  pagination?: ReturnType<typeof createPaginationInfo>;
  tokenInfo?: ReturnType<typeof createTokenInfo>;
  mapId?: string;
  paginationNote?: string;
}): FetchTocResult {
  const toc = overrides?.toc ?? [createTocEntry()];
  const pagination = overrides?.pagination ?? createPaginationInfo({ totalItems: toc.length, totalPages: 1, hasNext: false });
  const tokenInfo = overrides?.tokenInfo ?? createTokenInfo();
  return {
    toc,
    pagination,
    tokenInfo,
    ...(overrides?.mapId !== undefined ? { mapId: overrides.mapId } : {}),
    ...(overrides?.paginationNote !== undefined ? { paginationNote: overrides.paginationNote } : {}),
  };
}

// ---------------------------------------------------------------------------

describe('jamf_docs_get_toc tool', () => {
  let client: Client;
  let server: McpServer;

  beforeAll(async () => {
    server = new McpServer({ name: 'test-server', version: '0.0.1' });
    registerGetTocTool(server, createMockContext());

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    client = new Client({ name: 'test-client', version: '0.0.1' });

    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await client.close();
  });

  beforeEach(() => {
    vi.mocked(fetchTableOfContents).mockReset();
  });

  // --- Full markdown format -------------------------------------------------

  describe('full markdown output (default)', () => {
    it('should include product name as H1 header', async () => {
      vi.mocked(fetchTableOfContents).mockResolvedValueOnce(buildTocResponse());

      const result = await client.callTool({
        name: 'jamf_docs_get_toc',
        arguments: { product: 'jamf-pro' },
      });

      const text = getTextContent(result);
      expect(text).toContain('# Jamf Pro Documentation');
    });

    it('should include version and pagination info in summary line', async () => {
      vi.mocked(fetchTableOfContents).mockResolvedValueOnce(
        buildTocResponse({
          pagination: createPaginationInfo({ page: 1, totalPages: 3, totalItems: 100 }),
          tokenInfo: createTokenInfo({ tokenCount: 2500 }),
        })
      );

      const result = await client.callTool({
        name: 'jamf_docs_get_toc',
        arguments: { product: 'jamf-pro' },
      });

      const text = getTextContent(result);
      expect(text).toContain('**Version**: current');
      expect(text).toContain('**Page 1 of 3**');
      expect(text).toContain('2,500 tokens');
    });

    // Markdown is the default responseFormat, so the id half that costs one
    // line for the whole page is printed here. The per-entry contentIds are
    // not — they would be a line's worth of tokens each against a truncation
    // budget computed from titles alone — and the footer says where to get
    // them rather than leaving the workflow silently unreachable.
    it('should show the map id in the summary line and point at where the contentIds live', async () => {
      vi.mocked(fetchTableOfContents).mockResolvedValueOnce(
        buildTocResponse({ mapId: 'JAMF~PRO~MAP' })
      );

      const result = await client.callTool({
        name: 'jamf_docs_get_toc',
        arguments: { product: 'jamf-pro' },
      });

      const text = getTextContent(result);
      expect(text).toContain('**Map ID**: JAMF\\~PRO\\~MAP');
      expect(text).toContain('`contentId`');
      expect(text).toContain('responseFormat="json"');
    });

    it('should omit the Map ID field when no map id was resolved', async () => {
      vi.mocked(fetchTableOfContents).mockResolvedValueOnce(buildTocResponse());

      const result = await client.callTool({
        name: 'jamf_docs_get_toc',
        arguments: { product: 'jamf-pro' },
      });

      const text = getTextContent(result);
      expect(text).not.toContain('**Map ID**');
    });

    it('should include Table of Contents section header', async () => {
      vi.mocked(fetchTableOfContents).mockResolvedValueOnce(buildTocResponse());

      const result = await client.callTool({
        name: 'jamf_docs_get_toc',
        arguments: { product: 'jamf-pro' },
      });

      const text = getTextContent(result);
      expect(text).toContain('## Table of Contents');
    });

    it('should render TOC entries as markdown list items', async () => {
      vi.mocked(fetchTableOfContents).mockResolvedValueOnce(
        buildTocResponse({
          toc: [createTocEntry({ title: 'Getting Started', url: 'https://learn.jamf.com/page/Getting_Started.html' })],
        })
      );

      const result = await client.callTool({
        name: 'jamf_docs_get_toc',
        arguments: { product: 'jamf-pro' },
      });

      const text = getTextContent(result);
      expect(text).toContain('- [Getting Started](https://learn.jamf.com/page/Getting_Started.html)');
    });

    it('should render nested children with indentation', async () => {
      vi.mocked(fetchTableOfContents).mockResolvedValueOnce(
        buildTocResponse({
          toc: [
            createTocEntry({
              title: 'Parent Section',
              url: 'https://learn.jamf.com/page/Parent.html',
              children: [
                createTocEntry({ title: 'Child Section', url: 'https://learn.jamf.com/page/Child.html' }),
              ],
            }),
          ],
        })
      );

      const result = await client.callTool({
        name: 'jamf_docs_get_toc',
        arguments: { product: 'jamf-pro' },
      });

      const text = getTextContent(result);
      expect(text).toContain('- [Parent Section]');
      // Child is indented with 2 spaces
      expect(text).toContain('  - [Child Section]');
    });

    it('should include page=N+1 hint when hasNext is true', async () => {
      vi.mocked(fetchTableOfContents).mockResolvedValueOnce(
        buildTocResponse({
          pagination: createPaginationInfo({ page: 2, totalPages: 4, hasNext: true }),
        })
      );

      const result = await client.callTool({
        name: 'jamf_docs_get_toc',
        arguments: { product: 'jamf-pro' },
      });

      const text = getTextContent(result);
      expect(text).toContain('page=3');
    });

    it('should NOT include page hint when hasNext is false', async () => {
      vi.mocked(fetchTableOfContents).mockResolvedValueOnce(
        buildTocResponse({
          pagination: createPaginationInfo({ page: 1, totalPages: 1, hasNext: false }),
        })
      );

      const result = await client.callTool({
        name: 'jamf_docs_get_toc',
        arguments: { product: 'jamf-pro' },
      });

      const text = getTextContent(result);
      // When on last page, no "page=2" hint should appear
      expect(text).not.toMatch(/Use `page=\d+`/);
    });

    it('should include truncation notice when tokenInfo.truncated is true', async () => {
      vi.mocked(fetchTableOfContents).mockResolvedValueOnce(
        buildTocResponse({
          tokenInfo: createTokenInfo({ truncated: true }),
        })
      );

      const result = await client.callTool({
        name: 'jamf_docs_get_toc',
        arguments: { product: 'jamf-pro' },
      });

      const text = getTextContent(result);
      expect(text).toContain('truncated due to token limit');
    });

    it('should sanitize special markdown characters in TOC entry title', async () => {
      vi.mocked(fetchTableOfContents).mockResolvedValueOnce(
        buildTocResponse({
          toc: [createTocEntry({ title: '][evil](https://evil.com' })],
        })
      );

      const result = await client.callTool({
        name: 'jamf_docs_get_toc',
        arguments: { product: 'jamf-pro' },
      });

      const text = getTextContent(result);
      expect(text).not.toContain('](https://evil.com)');
    });
  });

  // --- Compact mode ---------------------------------------------------------

  describe('compact markdown output', () => {
    it('should use compact H2 header format', async () => {
      vi.mocked(fetchTableOfContents).mockResolvedValueOnce(
        buildTocResponse({
          pagination: createPaginationInfo({ totalItems: 50 }),
        })
      );

      const result = await client.callTool({
        name: 'jamf_docs_get_toc',
        arguments: { product: 'jamf-pro', outputMode: 'compact' },
      });

      const text = getTextContent(result);
      expect(text).toContain('## Jamf Pro TOC (50 entries)');
      // Full format H1 should NOT be present
      expect(text).not.toContain('# Jamf Pro Documentation');
    });

    it('should render entries as flat list without nested children', async () => {
      vi.mocked(fetchTableOfContents).mockResolvedValueOnce(
        buildTocResponse({
          toc: [
            createTocEntry({
              title: 'Parent',
              url: 'https://learn.jamf.com/page/Parent.html',
              children: [
                createTocEntry({ title: 'Child', url: 'https://learn.jamf.com/page/Child.html' }),
              ],
            }),
          ],
        })
      );

      const result = await client.callTool({
        name: 'jamf_docs_get_toc',
        arguments: { product: 'jamf-pro', outputMode: 'compact' },
      });

      const text = getTextContent(result);
      expect(text).toContain('- [Parent]');
      // In compact mode, children should NOT be rendered
      expect(text).not.toContain('  - [Child]');
    });

    it('should include compact pagination footer', async () => {
      vi.mocked(fetchTableOfContents).mockResolvedValueOnce(
        buildTocResponse({
          pagination: createPaginationInfo({ page: 1, totalPages: 5, hasNext: true }),
        })
      );

      const result = await client.callTool({
        name: 'jamf_docs_get_toc',
        arguments: { product: 'jamf-pro', outputMode: 'compact' },
      });

      const text = getTextContent(result);
      expect(text).toContain('*Page 1/5');
      expect(text).toContain('page=2 for more');
    });
  });

  // --- JSON format ----------------------------------------------------------

  describe('JSON format output', () => {
    it('should return valid JSON with product, version, toc, pagination', async () => {
      vi.mocked(fetchTableOfContents).mockResolvedValueOnce(buildTocResponse());

      const result = await client.callTool({
        name: 'jamf_docs_get_toc',
        arguments: { product: 'jamf-pro', responseFormat: 'json' },
      });

      const json = JSON.parse(getTextContent(result));
      expect(json.product).toBe('Jamf Pro');
      expect(json.version).toBe('current');
      expect(Array.isArray(json.toc)).toBe(true);
      expect(json.pagination).toEqual(expect.objectContaining({ page: 1, totalPages: 1 }));
      expect(json.tokenInfo).toEqual(expect.objectContaining({ tokenCount: 1500, truncated: false }));
    });

    it('should include nested children in JSON toc array', async () => {
      vi.mocked(fetchTableOfContents).mockResolvedValueOnce(
        buildTocResponse({
          toc: [
            createTocEntry({
              title: 'Parent',
              url: 'https://learn.jamf.com/page/Parent.html',
              children: [
                createTocEntry({ title: 'Child', url: 'https://learn.jamf.com/page/Child.html' }),
              ],
            }),
          ],
        })
      );

      const result = await client.callTool({
        name: 'jamf_docs_get_toc',
        arguments: { product: 'jamf-pro', responseFormat: 'json' },
      });

      const json = JSON.parse(getTextContent(result));
      expect(json.toc[0].children).toBeDefined();
      expect(json.toc[0].children[0].title).toBe('Child');
    });

    it('should include the mapId alongside the per-entry contentIds', async () => {
      vi.mocked(fetchTableOfContents).mockResolvedValueOnce(
        buildTocResponse({
          mapId: 'JAMF~PRO~MAP',
          toc: [createTocEntry({ title: 'Overview', contentId: 'content-1' })],
        })
      );

      const result = await client.callTool({
        name: 'jamf_docs_get_toc',
        arguments: { product: 'jamf-pro', responseFormat: 'json' },
      });

      const json = JSON.parse(getTextContent(result));
      // Both halves in one body: this is the response `jamf_docs_get_article`
      // sends callers to for its `mapId` + `contentId` arguments.
      expect(json.mapId).toBe('JAMF~PRO~MAP');
      expect(json.toc[0].contentId).toBe('content-1');
    });
  });

  // --- structuredContent ---------------------------------------------------

  describe('structuredContent', () => {
    it('should include product, version, totalEntries, page, totalPages, hasMore, entries fields', async () => {
      vi.mocked(fetchTableOfContents).mockResolvedValueOnce(
        buildTocResponse({
          pagination: createPaginationInfo({ page: 1, totalPages: 2, totalItems: 30, hasNext: true }),
        })
      );

      const result = await client.callTool({
        name: 'jamf_docs_get_toc',
        arguments: { product: 'jamf-pro' },
      });

      const sc = result.structuredContent as Record<string, unknown>;
      expect(sc).not.toBeNull();
      expect(sc.product).toBe('Jamf Pro');
      expect(sc.version).toBe('current');
      expect(sc.totalEntries).toBe(30);
      expect(sc.page).toBe(1);
      expect(sc.totalPages).toBe(2);
      expect(sc.hasMore).toBe(true);
      // The ID as well as the display name: paging needs something the
      // `product` parameter will accept, and it only accepts IDs.
      expect(sc.productId).toBe('jamf-pro');
      expect(Array.isArray(sc.entries)).toBe(true);
    });

    it('should have flat entries array (flattenTocEntries expands nested TOC)', async () => {
      vi.mocked(fetchTableOfContents).mockResolvedValueOnce(
        buildTocResponse({
          toc: [
            createTocEntry({
              title: 'Parent',
              url: 'https://learn.jamf.com/page/Parent.html',
              children: [
                createTocEntry({ title: 'Child A', url: 'https://learn.jamf.com/page/ChildA.html' }),
                createTocEntry({ title: 'Child B', url: 'https://learn.jamf.com/page/ChildB.html' }),
              ],
            }),
          ],
        })
      );

      const result = await client.callTool({
        name: 'jamf_docs_get_toc',
        arguments: { product: 'jamf-pro' },
      });

      const sc = result.structuredContent as Record<string, unknown>;
      const entries = sc.entries as FlatEntry[];
      // flattenTocEntries should produce 3 entries: parent + 2 children,
      // in document order and each tagged with the level it came from — the
      // list is flat, the tree it came from is not lost.
      expect(entries).toHaveLength(3);
      expect(entries[0].title).toBe('Parent');
      expect(entries[1].title).toBe('Child A');
      expect(entries[2].title).toBe('Child B');
      expect(entries.map(e => e.depth)).toEqual([0, 1, 1]);
    });

    // `jamf_docs_get_article` documents `mapId` + `contentId` as obtainable
    // "from search results or TOC". The map id is one per response and the
    // content id one per entry, so the pair only exists if both are emitted;
    // flattening used to keep title and url and drop the contentId, and the
    // mapId was never attached at all.
    it('should keep every entry contentId when flattening, nested ones included', async () => {
      vi.mocked(fetchTableOfContents).mockResolvedValueOnce(
        buildTocResponse({
          toc: [
            createTocEntry({
              title: 'Parent',
              url: 'https://learn.jamf.com/page/Parent.html',
              contentId: 'content-parent',
              children: [
                createTocEntry({
                  title: 'Child A',
                  url: 'https://learn.jamf.com/page/ChildA.html',
                  contentId: 'content-child-a',
                }),
              ],
            }),
          ],
        })
      );

      const result = await client.callTool({
        name: 'jamf_docs_get_toc',
        arguments: { product: 'jamf-pro' },
      });

      const sc = result.structuredContent as Record<string, unknown>;
      const entries = sc.entries as { title: string; contentId?: string }[];
      // Nested entries too: the child is where a caller usually lands.
      expect(entries.map(e => e.contentId)).toEqual(['content-parent', 'content-child-a']);
    });

    it('should carry the mapId that pairs with those contentIds', async () => {
      vi.mocked(fetchTableOfContents).mockResolvedValueOnce(
        buildTocResponse({ mapId: 'JAMF~PRO~MAP' })
      );

      const result = await client.callTool({
        name: 'jamf_docs_get_toc',
        arguments: { product: 'jamf-pro' },
      });

      const sc = result.structuredContent as Record<string, unknown>;
      expect(sc.mapId).toBe('JAMF~PRO~MAP');
    });

    it('should omit mapId when the TOC came from a source that does not know it', async () => {
      vi.mocked(fetchTableOfContents).mockResolvedValueOnce(buildTocResponse());

      const result = await client.callTool({
        name: 'jamf_docs_get_toc',
        arguments: { product: 'jamf-pro' },
      });

      const sc = result.structuredContent as Record<string, unknown>;
      expect(Object.prototype.hasOwnProperty.call(sc, 'mapId')).toBe(false);
    });
  });

  // --- Entry depth ----------------------------------------------------------

  // The tool exists to expose a navigation structure, and `structuredContent`
  // used to describe it as an unordered list of titles: flattening kept title,
  // url and contentId and dropped the nesting. Nothing else carries it — a
  // host that renders the structured output never sees `renderTocEntry`'s
  // indentation, in either `outputMode`.
  describe('entry depth', () => {
    /** Two roots, one three levels deep with a sibling after the deep branch. */
    function nestedToc(): TocEntry[] {
      return [
        createTocEntry({
          title: 'Computers',
          url: 'https://learn.jamf.com/page/Computers.html',
          children: [
            createTocEntry({
              title: 'Inventory',
              url: 'https://learn.jamf.com/page/Inventory.html',
              children: [
                createTocEntry({
                  title: 'Inventory Display',
                  url: 'https://learn.jamf.com/page/InventoryDisplay.html',
                }),
              ],
            }),
            createTocEntry({
              title: 'Smart Groups',
              url: 'https://learn.jamf.com/page/SmartGroups.html',
            }),
          ],
        }),
        createTocEntry({
          title: 'Mobile Devices',
          url: 'https://learn.jamf.com/page/MobileDevices.html',
          children: [
            createTocEntry({
              title: 'Enrollment',
              url: 'https://learn.jamf.com/page/Enrollment.html',
            }),
          ],
        }),
      ];
    }

    async function callToc(args: Record<string, unknown>): Promise<FlatEntry[]> {
      const result = await client.callTool({ name: 'jamf_docs_get_toc', arguments: args });
      const sc = result.structuredContent as Record<string, unknown>;
      return sc.entries as FlatEntry[];
    }

    it('should tag each flattened entry with its level, counting from 0 at the root', async () => {
      vi.mocked(fetchTableOfContents).mockResolvedValueOnce(buildTocResponse({ toc: nestedToc() }));

      const entries = await callToc({ product: 'jamf-pro' });

      expect(entries.map(e => e.title)).toEqual([
        'Computers', 'Inventory', 'Inventory Display', 'Smart Groups',
        'Mobile Devices', 'Enrollment',
      ]);
      expect(entries.map(e => e.depth)).toEqual([0, 1, 2, 1, 0, 1]);
    });

    it('should let a client rebuild the exact tree from depth and order alone', async () => {
      const toc = nestedToc();
      vi.mocked(fetchTableOfContents).mockResolvedValueOnce(buildTocResponse({ toc }));

      const entries = await callToc({ product: 'jamf-pro' });

      // Lossless, not merely present: a constant depth, an off-by-one, or a
      // depth that counted array position would all still be "a number".
      expect(rebuildTree(entries)).toEqual(toc);
    });

    // Control. Every assertion above is satisfied by a `depth` that just
    // counts up, and that would report a flat TOC as a staircase. Jamf ships
    // flat sections (a bundle whose top level is all leaves), so this is a
    // real page shape, not a hypothetical one.
    it('should report every entry of a flat TOC at depth 0', async () => {
      const toc = [
        createTocEntry({ title: 'Release Notes', url: 'https://learn.jamf.com/page/Release.html' }),
        createTocEntry({ title: 'Known Issues', url: 'https://learn.jamf.com/page/Known.html' }),
        createTocEntry({ title: 'Deprecations', url: 'https://learn.jamf.com/page/Deprecations.html' }),
      ];
      vi.mocked(fetchTableOfContents).mockResolvedValueOnce(buildTocResponse({ toc }));

      const entries = await callToc({ product: 'jamf-pro' });

      expect(entries.map(e => e.depth)).toEqual([0, 0, 0]);
      expect(rebuildTree(entries)).toEqual(toc);
    });

    // The reason this bug survived review once: the markdown does render the
    // nesting, so the structured channel looked like a duplicate. It is not —
    // the client that filed this received the flat object and the markdown
    // block was discarded, on the default `responseFormat` with the recursing
    // `outputMode`. Both modes flatten through the same call, so both must
    // carry the depths.
    it.each([['full'], ['compact']])(
      'should carry depths in structuredContent for markdown outputMode=%s',
      async (outputMode) => {
        vi.mocked(fetchTableOfContents).mockResolvedValueOnce(buildTocResponse({ toc: nestedToc() }));

        const entries = await callToc({
          product: 'jamf-pro',
          responseFormat: 'markdown',
          outputMode,
        });

        expect(entries.map(e => e.depth)).toEqual([0, 1, 2, 1, 0, 1]);
      },
    );

    it('should carry depths when responseFormat is json', async () => {
      vi.mocked(fetchTableOfContents).mockResolvedValueOnce(buildTocResponse({ toc: nestedToc() }));

      const entries = await callToc({ product: 'jamf-pro', responseFormat: 'json' });

      expect(entries.map(e => e.depth)).toEqual([0, 1, 2, 1, 0, 1]);
    });

    // The description is the only thing that tells a client what the two
    // channels hold, and it attributed the nesting to "the markdown"
    // unqualified. That is true of outputMode="full" only: formatTocCompact
    // calls renderTocEntry(entry, 0, true), which does not recurse, so compact
    // markdown shows the two roots of the six-entry tree above while
    // structuredContent still carries all six with their depths — the
    // divergence the it.each right above asserts, and the flat list
    // 'should render entries as flat list without nested children' pins. So
    // the sentence contradicted two tests beside it, and a client reading it
    // would expect compact markdown to be an indented view of the same tree.
    it('should say which outputMode the markdown actually shows the nesting in', async () => {
      const { tools } = await client.listTools();
      const description = tools.find(t => t.name === 'jamf_docs_get_toc')?.description ?? '';

      const start = description.indexOf('structuredContent.entries');
      // Not vacuous: a description that dropped the depth claim altogether
      // would otherwise pass by having nothing left to contradict.
      expect(start, 'the description should still explain entry depth').toBeGreaterThanOrEqual(0);

      const claim = description.slice(start);
      expect(claim).toContain('outputMode="full"');
      expect(claim).toContain('outputMode="compact"');
    });
  });

  // --- Default version behaviour -------------------------------------------

  describe('default version', () => {
    it('should use version "current" when no version parameter is provided', async () => {
      vi.mocked(fetchTableOfContents).mockResolvedValueOnce(buildTocResponse());

      const result = await client.callTool({
        name: 'jamf_docs_get_toc',
        arguments: { product: 'jamf-pro' },
      });

      const text = getTextContent(result);
      // The full markdown format renders "Version: current"
      expect(text).toContain('**Version**: current');
    });

    it('should include version=current in structuredContent when no version supplied', async () => {
      vi.mocked(fetchTableOfContents).mockResolvedValueOnce(buildTocResponse());

      const result = await client.callTool({
        name: 'jamf_docs_get_toc',
        arguments: { product: 'jamf-pro' },
      });

      const sc = result.structuredContent as Record<string, unknown>;
      expect(sc.version).toBe('current');
    });
  });

  // --- Version note ---------------------------------------------------------

  describe('version note', () => {
    it('should NOT claim current-only content for a version Jamf publishes its own map for', async () => {
      // jamf-pro 11.15.0 has a distinct mapId upstream and serves its own
      // content; `fetchTableOfContents` resolves that map (or throws). The old
      // note fired on the requested string alone and told the caller the
      // versioned TOC they were holding was really current content.
      const { getAvailableVersions } = await import('../../../src/core/services/metadata.js');
      vi.mocked(getAvailableVersions).mockResolvedValueOnce(['11.26.0', '11.15.0']);
      vi.mocked(fetchTableOfContents).mockResolvedValueOnce(buildTocResponse());

      const result = await client.callTool({
        name: 'jamf_docs_get_toc',
        arguments: { product: 'jamf-pro', version: '11.15.0' },
      });

      expect(result.isError).toBeFalsy();
      expect(getTextContent(result)).not.toContain('Version Note');
      const sc = result.structuredContent as Record<string, unknown>;
      expect(sc.versionNote).toBeUndefined();
    });

    it('should still disclose a version that is not among the published maps', async () => {
      // Default mock: getAvailableVersions resolves to [], so the requested
      // version passes validation but cannot be confirmed against upstream.
      vi.mocked(fetchTableOfContents).mockResolvedValueOnce(buildTocResponse());

      const result = await client.callTool({
        name: 'jamf_docs_get_toc',
        arguments: { product: 'jamf-pro', version: '11.15.0' },
      });

      const text = getTextContent(result);
      expect(text).toContain('Version Note');
      expect(text).toContain('11.15.0');
      expect(text).not.toContain('only provides current version content');
    });

    it('should render a paginationNote the service produced', async () => {
      // The other half of renderTocNotices, and the one that had no assertion:
      // dropping renderTocNotices entirely still left the version-note cases
      // failing, so this branch was carried by nothing. calculatePagination
      // computes this note whenever `page` is clamped, and before #195 nothing
      // rendered it — the caller was silently served a different page than the
      // one requested.
      vi.mocked(fetchTableOfContents).mockResolvedValueOnce(
        buildTocResponse({
          paginationNote: 'Requested page 99 exceeds total pages (3). Showing last page.',
        }),
      );

      const result = await client.callTool({
        name: 'jamf_docs_get_toc',
        arguments: { product: 'jamf-pro', page: 99 },
      });

      expect(result.isError).toBeFalsy();
      expect(getTextContent(result)).toContain('exceeds total pages');
      const sc = result.structuredContent as Record<string, unknown>;
      expect(sc.paginationNote).toBe(
        'Requested page 99 exceeds total pages (3). Showing last page.',
      );
    });

    it('should carry both notices at once when both apply', async () => {
      // versionNote and paginationNote are independent; rendering one must not
      // consume the other.
      vi.mocked(fetchTableOfContents).mockResolvedValueOnce(
        buildTocResponse({ paginationNote: 'Showing last page.' }),
      );

      const result = await client.callTool({
        name: 'jamf_docs_get_toc',
        arguments: { product: 'jamf-pro', version: '11.15.0', page: 99 },
      });

      const text = getTextContent(result);
      expect(text).toContain('Version Note');
      expect(text).toContain('Showing last page.');
    });

    it('should not emit a version note for current or unspecified versions', async () => {
      vi.mocked(fetchTableOfContents).mockResolvedValue(buildTocResponse());

      const withCurrent = await client.callTool({
        name: 'jamf_docs_get_toc',
        arguments: { product: 'jamf-pro', version: 'current' },
      });
      expect(getTextContent(withCurrent)).not.toContain('Version Note');

      const withNone = await client.callTool({
        name: 'jamf_docs_get_toc',
        arguments: { product: 'jamf-pro' },
      });
      expect(getTextContent(withNone)).not.toContain('Version Note');
    });
  });

  // --- Pagination in structuredContent -------------------------------------

  describe('pagination in structuredContent', () => {
    it('should reflect page and totalPages from pagination', async () => {
      vi.mocked(fetchTableOfContents).mockResolvedValueOnce(
        buildTocResponse({
          toc: [createTocEntry()],
          pagination: createPaginationInfo({ page: 2, totalPages: 4, totalItems: 80, hasNext: true }),
        })
      );

      const result = await client.callTool({
        name: 'jamf_docs_get_toc',
        arguments: { product: 'jamf-pro', page: 2 },
      });

      const sc = result.structuredContent as Record<string, unknown>;
      expect(sc.page).toBe(2);
      expect(sc.totalPages).toBe(4);
      expect(sc.totalEntries).toBe(80);
      expect(sc.hasMore).toBe(true);
    });

    it('should set hasMore=false on last page', async () => {
      vi.mocked(fetchTableOfContents).mockResolvedValueOnce(
        buildTocResponse({
          pagination: createPaginationInfo({ page: 3, totalPages: 3, hasNext: false }),
        })
      );

      const result = await client.callTool({
        name: 'jamf_docs_get_toc',
        arguments: { product: 'jamf-pro', page: 3 },
      });

      const sc = result.structuredContent as Record<string, unknown>;
      expect(sc.hasMore).toBe(false);
    });
  });

  // --- Token truncation in structuredContent --------------------------------

  describe('token truncation in structuredContent', () => {
    it('should NOT expose tokenInfo directly in structuredContent (entries/page shape only)', async () => {
      vi.mocked(fetchTableOfContents).mockResolvedValueOnce(
        buildTocResponse({
          tokenInfo: createTokenInfo({ truncated: true, tokenCount: 5000, maxTokens: 5000 }),
        })
      );

      const result = await client.callTool({
        name: 'jamf_docs_get_toc',
        arguments: { product: 'jamf-pro' },
      });

      // structuredContent should have entries/page shape, not tokenInfo
      const sc = result.structuredContent as Record<string, unknown>;
      expect(Array.isArray(sc.entries)).toBe(true);
      expect(sc.page).toBeDefined();
    });

    it('should include truncation notice in full markdown when tokenInfo.truncated is true', async () => {
      vi.mocked(fetchTableOfContents).mockResolvedValueOnce(
        buildTocResponse({
          tokenInfo: createTokenInfo({ truncated: true }),
        })
      );

      const result = await client.callTool({
        name: 'jamf_docs_get_toc',
        arguments: { product: 'jamf-pro' },
      });

      const text = getTextContent(result);
      expect(text).toContain('truncated due to token limit');
    });

    it('should include truncation notice in JSON output tokenInfo field', async () => {
      vi.mocked(fetchTableOfContents).mockResolvedValueOnce(
        buildTocResponse({
          tokenInfo: createTokenInfo({ truncated: true, tokenCount: 4999, maxTokens: 5000 }),
        })
      );

      const result = await client.callTool({
        name: 'jamf_docs_get_toc',
        arguments: { product: 'jamf-pro', responseFormat: 'json' },
      });

      const json = JSON.parse(getTextContent(result));
      expect(json.tokenInfo.truncated).toBe(true);
    });
  });

  // --- Error handling -------------------------------------------------------

  describe('error handling', () => {
    it('should return isError for invalid product ID', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_get_toc',
        arguments: { product: 'invalid-product' },
      });

      expect(result.isError).toBe(true);
      const text = getTextContent(result);
      expect(text.toLowerCase()).toContain('invalid');
    });

    it('should return isError when fetchTableOfContents throws', async () => {
      vi.mocked(fetchTableOfContents).mockRejectedValueOnce(new Error('Network error'));

      const result = await client.callTool({
        name: 'jamf_docs_get_toc',
        arguments: { product: 'jamf-pro' },
      });

      expect(result.isError).toBe(true);
      const text = getTextContent(result);
      expect(text).toContain('Error fetching table of contents');
    });

    it('should return isError for invalid version (when versions list is non-empty)', async () => {
      const { getAvailableVersions } = await import('../../../src/core/services/metadata.js');
      vi.mocked(getAvailableVersions).mockResolvedValueOnce(['11.5.0', '11.4.0']);

      vi.mocked(fetchTableOfContents).mockResolvedValueOnce(buildTocResponse());

      const result = await client.callTool({
        name: 'jamf_docs_get_toc',
        arguments: { product: 'jamf-pro', version: '99.0.0' },
      });

      expect(result.isError).toBe(true);
      const text = getTextContent(result);
      expect(text).toContain('not found');
    });
  });

  // --- paging round-trip -----------------------------------------------------

  describe('paging round-trip', () => {
    it('should emit a productId the product parameter actually accepts', async () => {
      // The MCP App's "Load more" button feeds structuredContent straight back
      // into `jamf_docs_get_toc`. It used to send `product` — the display name
      // — into a parameter that is an enum of IDs, so page 2 of any table of
      // contents failed input validation before the handler ever ran. This
      // asserts the round-trip, not just the field's presence.
      vi.mocked(fetchTableOfContents).mockResolvedValue(
        buildTocResponse({
          pagination: createPaginationInfo({ page: 1, totalPages: 2, totalItems: 30, hasNext: true }),
        })
      );

      const first = await client.callTool({
        name: 'jamf_docs_get_toc',
        arguments: { product: 'jamf-connect' },
      });
      const sc = first.structuredContent as Record<string, unknown>;

      // Feeding the display name back is what used to happen, and it fails.
      const withName = await client.callTool({
        name: 'jamf_docs_get_toc',
        arguments: { product: sc.product, page: 2 },
      });
      expect(withName.isError).toBe(true);
      expect(getTextContent(withName)).toContain('Invalid');

      // Feeding productId back is what the app does now, and it works.
      const withId = await client.callTool({
        name: 'jamf_docs_get_toc',
        arguments: { product: sc.productId, page: 2 },
      });
      expect(withId.isError).toBeFalsy();
    });
  });
});
