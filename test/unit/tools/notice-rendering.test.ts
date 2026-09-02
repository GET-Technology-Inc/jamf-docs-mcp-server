/**
 * Notices must reach a caller.
 *
 * Every `*Note` on a tool result is a statement the server wants to make about
 * the payload it is returning — "your page number was adjusted", "the version
 * you filtered on could not be applied". Computing one and dropping it is worse
 * than never computing it: the result then looks exactly like the case the note
 * was there to distinguish.
 *
 * Two directions are checked here:
 *
 *  1. Per-notice rendering tests, so each note has an actual expected string in
 *     each channel (markdown, JSON body, structuredContent).
 *  2. A reachability sweep that derives the notice names from the output schemas
 *     *and* from the service result interfaces, then fails if any of them never
 *     appears in a rendered output. Type checking cannot see this class of
 *     defect — 4.0.2 (#189) added `paginationNote` to the result types and the
 *     compiler was perfectly happy that nothing read it.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/server';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/client';
import {
  createSearchResult,
  createTocEntry,
  createPaginationInfo,
  createTokenInfo,
} from '../../helpers/fixtures.js';
import { createMockContext } from '../../helpers/mock-context.js';

// --- Mock service modules before importing the tools -------------------------

vi.mock('../../../src/core/services/search-service.js', () => ({
  searchDocumentation: vi.fn(),
}));

vi.mock('../../../src/core/services/toc-service.js', () => ({
  fetchTableOfContents: vi.fn(),
}));

vi.mock('../../../src/core/services/metadata.js', () => ({
  getAvailableVersions: vi.fn().mockResolvedValue([]),
  getBundleIdForVersion: vi.fn().mockResolvedValue('jamf-pro-documentation'),
}));

// Import AFTER mocks are set up
import { searchDocumentation } from '../../../src/core/services/search-service.js';
import { fetchTableOfContents } from '../../../src/core/services/toc-service.js';
import { registerSearchTool } from '../../../src/core/tools/search.js';
import { registerGetTocTool } from '../../../src/core/tools/get-toc.js';
import { SearchOutputSchema, TocOutputSchema } from '../../../src/core/schemas/output.js';

// ---------------------------------------------------------------------------

interface TextContent { type: 'text'; text: string }

function getTextContent(result: { content: unknown[] }): string {
  return (result.content[0] as TextContent).text;
}

function structured(result: { structuredContent?: unknown }): Record<string, unknown> {
  return (result.structuredContent ?? {}) as Record<string, unknown>;
}

const CLAMPED_PAGE_NOTE = 'Note: Requested page 99 exceeds total pages (3). Showing last page.';
const SEARCH_VERSION_NOTE = 'Version "11.5.0" was not available for some results.';

/** A search service payload carrying every notice `SearchDocumentationResult` can hold. */
function searchPayloadWithAllNotices(): Record<string, unknown> {
  return {
    results: [createSearchResult()],
    pagination: createPaginationInfo({ page: 3, totalPages: 3, totalItems: 25, hasNext: false, hasPrev: true }),
    tokenInfo: createTokenInfo(),
    paginationNote: CLAMPED_PAGE_NOTE,
    versionNote: SEARCH_VERSION_NOTE,
  };
}

/** A TOC service payload carrying every notice `FetchTocResult` can hold. */
function tocPayloadWithAllNotices(): Record<string, unknown> {
  return {
    toc: [createTocEntry()],
    pagination: createPaginationInfo({ page: 3, totalPages: 3, totalItems: 25, hasNext: false, hasPrev: true }),
    tokenInfo: createTokenInfo(),
    paginationNote: CLAMPED_PAGE_NOTE,
    // The registry answered in a different language than was asked for. Jamf
    // publishes 42 of its 97 families in en-US only, so the tool must be able
    // to say so; the sweep below asserts the resulting note is reachable.
    resolvedLocale: 'en-US',
  };
}

// ---------------------------------------------------------------------------

describe('tool notices reach the caller', () => {
  let client: Client;
  let server: McpServer;

  beforeAll(async () => {
    server = new McpServer({ name: 'test-server', version: '0.0.1' });
    const ctx = createMockContext();
    registerSearchTool(server, ctx);
    registerGetTocTool(server, ctx);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test-client', version: '0.0.1' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await client.close();
  });

  beforeEach(() => {
    vi.mocked(searchDocumentation).mockReset();
    vi.mocked(fetchTableOfContents).mockReset();
  });

  // --- jamf_docs_search -----------------------------------------------------

  describe('jamf_docs_search paginationNote', () => {
    it('should render the clamped-page note in markdown', async () => {
      vi.mocked(searchDocumentation).mockResolvedValueOnce(
        searchPayloadWithAllNotices() as never
      );

      const result = await client.callTool({
        name: 'jamf_docs_search',
        arguments: { query: 'policy', page: 99 },
      });

      expect(getTextContent(result)).toContain(CLAMPED_PAGE_NOTE);
    });

    it('should carry the clamped-page note in structuredContent', async () => {
      vi.mocked(searchDocumentation).mockResolvedValueOnce(
        searchPayloadWithAllNotices() as never
      );

      const result = await client.callTool({
        name: 'jamf_docs_search',
        arguments: { query: 'policy', page: 99 },
      });

      expect(structured(result).paginationNote).toBe(CLAMPED_PAGE_NOTE);
    });

    it('should carry the clamped-page note in the JSON body', async () => {
      vi.mocked(searchDocumentation).mockResolvedValueOnce(
        searchPayloadWithAllNotices() as never
      );

      const result = await client.callTool({
        name: 'jamf_docs_search',
        arguments: { query: 'policy', page: 99, responseFormat: 'json' },
      });

      expect(JSON.parse(getTextContent(result)).paginationNote).toBe(CLAMPED_PAGE_NOTE);
    });

    it('should omit paginationNote when the service did not produce one', async () => {
      vi.mocked(searchDocumentation).mockResolvedValueOnce({
        results: [createSearchResult()],
        pagination: createPaginationInfo({ totalItems: 1, totalPages: 1, hasNext: false }),
        tokenInfo: createTokenInfo(),
      });

      const result = await client.callTool({
        name: 'jamf_docs_search',
        arguments: { query: 'policy' },
      });

      expect(structured(result).paginationNote).toBeUndefined();
      expect(getTextContent(result)).not.toContain('Pagination Note');
    });
  });

  describe('jamf_docs_search versionNote', () => {
    it('should carry the version note in structuredContent, not only in the markdown', async () => {
      // `versionNote` was declared on SearchOutputSchema and rendered into the
      // markdown and the JSON body, but never into structuredContent — the one
      // channel a typed client reads.
      vi.mocked(searchDocumentation).mockResolvedValueOnce(
        searchPayloadWithAllNotices() as never
      );

      const result = await client.callTool({
        name: 'jamf_docs_search',
        arguments: { query: 'policy', version: '11.5.0' },
      });

      expect(structured(result).versionNote).toBe(SEARCH_VERSION_NOTE);
      expect(getTextContent(result)).toContain(SEARCH_VERSION_NOTE);
    });
  });

  // --- jamf_docs_get_toc ----------------------------------------------------

  describe('jamf_docs_get_toc paginationNote', () => {
    it('should render the clamped-page note in markdown', async () => {
      vi.mocked(fetchTableOfContents).mockResolvedValueOnce(
        tocPayloadWithAllNotices() as never
      );

      const result = await client.callTool({
        name: 'jamf_docs_get_toc',
        arguments: { product: 'jamf-pro', page: 99 },
      });

      expect(getTextContent(result)).toContain(CLAMPED_PAGE_NOTE);
    });

    it('should carry the clamped-page note in structuredContent', async () => {
      vi.mocked(fetchTableOfContents).mockResolvedValueOnce(
        tocPayloadWithAllNotices() as never
      );

      const result = await client.callTool({
        name: 'jamf_docs_get_toc',
        arguments: { product: 'jamf-pro', page: 99 },
      });

      expect(structured(result).paginationNote).toBe(CLAMPED_PAGE_NOTE);
    });

    it('should carry the clamped-page note in the JSON body', async () => {
      vi.mocked(fetchTableOfContents).mockResolvedValueOnce(
        tocPayloadWithAllNotices() as never
      );

      const result = await client.callTool({
        name: 'jamf_docs_get_toc',
        arguments: { product: 'jamf-pro', page: 99, responseFormat: 'json' },
      });

      expect(JSON.parse(getTextContent(result)).paginationNote).toBe(CLAMPED_PAGE_NOTE);
    });

    it('should keep rendering the version note alongside it', async () => {
      vi.mocked(fetchTableOfContents).mockResolvedValueOnce(
        tocPayloadWithAllNotices() as never
      );

      const result = await client.callTool({
        name: 'jamf_docs_get_toc',
        arguments: { product: 'jamf-pro', version: '11.5.0', page: 99 },
      });

      const text = getTextContent(result);
      expect(text).toContain('Version Note');
      expect(text).toContain(CLAMPED_PAGE_NOTE);
      expect(structured(result).versionNote).toBeDefined();
    });

    it('should omit paginationNote when the service did not produce one', async () => {
      vi.mocked(fetchTableOfContents).mockResolvedValueOnce({
        toc: [createTocEntry()],
        pagination: createPaginationInfo({ totalItems: 1, totalPages: 1, hasNext: false }),
        tokenInfo: createTokenInfo(),
      });

      const result = await client.callTool({
        name: 'jamf_docs_get_toc',
        arguments: { product: 'jamf-pro' },
      });

      expect(structured(result).paginationNote).toBeUndefined();
      expect(getTextContent(result)).not.toContain('Pagination Note');
    });
  });

  // --- Reachability sweep ---------------------------------------------------

  describe('every declared notice is reachable', () => {
    /**
     * Drive both tools through the scenarios that should surface a notice and
     * collect every `*Note` key that made it into `structuredContent` — the
     * typed channel, and the one a note has to reach to count as delivered.
     */
    async function collectRenderedNoticeKeys(): Promise<Set<string>> {
      const seen = new Set<string>();

      const record = (result: { structuredContent?: unknown }): void => {
        for (const key of Object.keys(structured(result))) {
          if (key.endsWith('Note')) {
            seen.add(key);
          }
        }
      };

      for (const responseFormat of ['markdown', 'json']) {
        vi.mocked(searchDocumentation).mockResolvedValueOnce(
          searchPayloadWithAllNotices() as never
        );
        record(await client.callTool({
          name: 'jamf_docs_search',
          arguments: { query: 'policy', version: '11.5.0', page: 99, responseFormat },
        }));

        vi.mocked(fetchTableOfContents).mockResolvedValueOnce(
          tocPayloadWithAllNotices() as never
        );
        record(await client.callTool({
          name: 'jamf_docs_get_toc',
          arguments: {
            product: 'jamf-pro', version: '11.5.0', page: 99,
            // Requesting a language the payload above did not answer in is
            // what makes `localeNote` fire.
            language: 'zh-TW',
            responseFormat,
          },
        }));
      }

      return seen;
    }

    /** `*Note` keys declared on a Zod output schema. */
    function schemaNoticeKeys(shape: Record<string, unknown>): string[] {
      return Object.keys(shape).filter(key => key.endsWith('Note'));
    }

    /**
     * `*Note` fields declared on a service result interface in types.ts.
     *
     * Read from the source because the schemas are only half the story: a note
     * the service produces but no schema declares is just as invisible, and
     * that is exactly the shape `paginationNote` had.
     */
    function resultTypeNoticeKeys(interfaceName: string): string[] {
      const typesPath = fileURLToPath(new URL('../../../src/core/types.ts', import.meta.url));
      const source = readFileSync(typesPath, 'utf8');
      const block = new RegExp(`export interface ${interfaceName} \\{([\\s\\S]*?)\\n\\}`).exec(source);
      if (block === null) {
        throw new Error(`interface ${interfaceName} not found in types.ts`);
      }
      const [, body] = block;
      return [...body.matchAll(/^\s*(\w+Note)\??\s*:/gm)].map(m => m[1]);
    }

    it('should surface every notice declared by a schema or a service result type', async () => {
      const declared = new Set([
        ...schemaNoticeKeys(SearchOutputSchema.shape),
        ...schemaNoticeKeys(TocOutputSchema.shape),
        ...resultTypeNoticeKeys('SearchDocumentationResult'),
        ...resultTypeNoticeKeys('FetchTocResult'),
      ]);

      // Guard against the sweep quietly checking nothing after a rename.
      expect(declared.size).toBeGreaterThanOrEqual(3);
      expect(declared).toContain('paginationNote');
      expect(declared).toContain('versionNote');

      const rendered = await collectRenderedNoticeKeys();
      const unreachable = [...declared].filter(key => !rendered.has(key)).sort();

      expect(unreachable).toEqual([]);
    });
  });
});
