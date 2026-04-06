/**
 * Unit tests for jamf_docs_search tool handler formatting functions.
 *
 * Formatting functions in search.ts are private. We test them indirectly by
 * creating an McpServer + InMemoryTransport pair, registering the tool with
 * mocked service dependencies, and invoking the tool via an in-process client.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  createSearchResult,
  createPaginationInfo,
  createTokenInfo,
} from '../../helpers/fixtures.js';

// --- Mock service modules before importing the tool --------------------------

vi.mock('../../../src/core/services/search-service.js', () => ({
  searchDocumentation: vi.fn(),
}));

vi.mock('../../../src/core/services/cache.js', () => ({
  cache: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn(),
  },
}));

vi.mock('../../../src/core/services/search-suggestions.js', () => ({
  generateSearchSuggestions: vi.fn().mockReturnValue({
    simplifiedQuery: null,
    alternativeKeywords: ['alternate-keyword'],
    suggestedTopics: [],
    tips: ['Browse with jamf_docs_get_toc'],
  }),
  formatSearchSuggestions: vi.fn().mockReturnValue(
    'No results found for "xyznonexistent"\n\n## Search Suggestions\n\n**Tips**:\n- Browse the table of contents with `jamf_docs_get_toc`\n'
  ),
}));

// Import AFTER mocks are set up
import { searchDocumentation } from '../../../src/core/services/search-service.js';
import { registerSearchTool } from '../../../src/core/tools/search.js';

// ---------------------------------------------------------------------------

type TextContent = { type: 'text'; text: string };

function getTextContent(result: { content: unknown[] }): string {
  const first = result.content[0] as TextContent;
  return first.text;
}

function buildSearchResponse(overrides?: {
  results?: ReturnType<typeof createSearchResult>[];
  pagination?: ReturnType<typeof createPaginationInfo>;
  tokenInfo?: ReturnType<typeof createTokenInfo>;
}) {
  const results = overrides?.results ?? [createSearchResult()];
  const pagination = overrides?.pagination ?? createPaginationInfo({ totalItems: results.length, totalPages: 1, hasNext: false });
  const tokenInfo = overrides?.tokenInfo ?? createTokenInfo();
  return { results, pagination, tokenInfo };
}

// ---------------------------------------------------------------------------

describe('jamf_docs_search tool', () => {
  let client: Client;
  let server: McpServer;

  beforeAll(async () => {
    server = new McpServer({ name: 'test-server', version: '0.0.1' });
    registerSearchTool(server);

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
  });

  // --- Markdown full mode ---------------------------------------------------

  describe('full markdown output (default)', () => {
    it('should include article title in H3 link format', async () => {
      vi.mocked(searchDocumentation).mockResolvedValueOnce(
        buildSearchResponse({
          results: [createSearchResult({ title: 'Configuration Profiles', url: 'https://learn.jamf.com/page/Config.html' })],
        })
      );

      const result = await client.callTool({ name: 'jamf_docs_search', arguments: { query: 'configuration' } });

      const text = getTextContent(result);
      expect(text).toContain('### [Configuration Profiles]');
      expect(text).toContain('(https://learn.jamf.com/page/Config.html)');
    });

    it('should include snippet in blockquote', async () => {
      vi.mocked(searchDocumentation).mockResolvedValueOnce(
        buildSearchResponse({
          results: [createSearchResult({ snippet: 'Profiles let you manage device settings.' })],
        })
      );

      const result = await client.callTool({ name: 'jamf_docs_search', arguments: { query: 'profiles' } });

      const text = getTextContent(result);
      expect(text).toContain('> Profiles let you manage device settings.');
    });

    it('should include product and version metadata when both are present', async () => {
      vi.mocked(searchDocumentation).mockResolvedValueOnce(
        buildSearchResponse({
          results: [createSearchResult({ product: 'jamf-pro', version: '11.5.0' })],
        })
      );

      const result = await client.callTool({ name: 'jamf_docs_search', arguments: { query: 'pro' } });

      const text = getTextContent(result);
      expect(text).toContain('**Product**: jamf-pro');
      expect(text).toContain('**Version**: 11.5.0');
    });

    it('should omit product/version block when product is null', async () => {
      vi.mocked(searchDocumentation).mockResolvedValueOnce(
        buildSearchResponse({
          results: [createSearchResult({ product: null, version: undefined })],
        })
      );

      const result = await client.callTool({ name: 'jamf_docs_search', arguments: { query: 'test' } });

      const text = getTextContent(result);
      expect(text).not.toContain('**Product**:');
      expect(text).not.toContain('**Version**:');
    });

    it('should include filters line when product filter is applied', async () => {
      vi.mocked(searchDocumentation).mockResolvedValueOnce(
        buildSearchResponse()
      );

      const result = await client.callTool({
        name: 'jamf_docs_search',
        arguments: { query: 'enrollment', product: 'jamf-pro' },
      });

      const text = getTextContent(result);
      expect(text).toContain('*Filtered by: product: jamf-pro*');
    });

    it('should include filters line when topic filter is applied', async () => {
      vi.mocked(searchDocumentation).mockResolvedValueOnce(
        buildSearchResponse()
      );

      const result = await client.callTool({
        name: 'jamf_docs_search',
        arguments: { query: 'security', topic: 'enrollment' },
      });

      const text = getTextContent(result);
      expect(text).toContain('*Filtered by: topic: enrollment*');
    });

    it('should include page=N+1 pagination hint when hasNext is true', async () => {
      vi.mocked(searchDocumentation).mockResolvedValueOnce(
        buildSearchResponse({
          pagination: createPaginationInfo({ page: 1, totalPages: 3, hasNext: true, totalItems: 25 }),
        })
      );

      const result = await client.callTool({ name: 'jamf_docs_search', arguments: { query: 'policy' } });

      const text = getTextContent(result);
      expect(text).toContain('page=2');
    });

    it('should NOT include page pagination hint when hasNext is false', async () => {
      vi.mocked(searchDocumentation).mockResolvedValueOnce(
        buildSearchResponse({
          pagination: createPaginationInfo({ page: 1, totalPages: 1, hasNext: false, totalItems: 5 }),
        })
      );

      const result = await client.callTool({ name: 'jamf_docs_search', arguments: { query: 'policy' } });

      const text = getTextContent(result);
      expect(text).not.toContain('page=2');
    });

    it('should sanitize special markdown characters in title', async () => {
      vi.mocked(searchDocumentation).mockResolvedValueOnce(
        buildSearchResponse({
          results: [createSearchResult({ title: '](https://evil.com)[Click me' })],
        })
      );

      const result = await client.callTool({ name: 'jamf_docs_search', arguments: { query: 'evil' } });

      const text = getTextContent(result);
      // The escaped title should not create a functional link to evil.com
      expect(text).not.toContain('](https://evil.com)');
    });

    it('should include horizontal rule separator between results', async () => {
      vi.mocked(searchDocumentation).mockResolvedValueOnce(
        buildSearchResponse({
          results: [
            createSearchResult({ title: 'Article 1' }),
            createSearchResult({ title: 'Article 2' }),
          ],
          pagination: createPaginationInfo({ totalItems: 2, hasNext: false }),
        })
      );

      const result = await client.callTool({ name: 'jamf_docs_search', arguments: { query: 'articles' } });

      const text = getTextContent(result);
      expect(text).toContain('---');
    });
  });

  // --- Compact mode --------------------------------------------------------

  describe('compact markdown output', () => {
    it('should use numbered list format instead of H3 headers', async () => {
      vi.mocked(searchDocumentation).mockResolvedValueOnce(
        buildSearchResponse({
          results: [createSearchResult({ title: 'Compact Article' })],
        })
      );

      const result = await client.callTool({
        name: 'jamf_docs_search',
        arguments: { query: 'test', outputMode: 'compact' },
      });

      const text = getTextContent(result);
      expect(text).toMatch(/^\d+\. \[Compact Article\]/m);
      expect(text).not.toContain('### [');
    });

    it('should truncate snippet to 80 characters in compact mode', async () => {
      const longSnippet = 'a'.repeat(100);
      vi.mocked(searchDocumentation).mockResolvedValueOnce(
        buildSearchResponse({
          results: [createSearchResult({ snippet: longSnippet })],
        })
      );

      const result = await client.callTool({
        name: 'jamf_docs_search',
        arguments: { query: 'test', outputMode: 'compact' },
      });

      const text = getTextContent(result);
      // The 77 chars + '...' = 80 chars total in snippet
      expect(text).toContain('...');
    });

    it('should include compact pagination footer with page/totalPages', async () => {
      vi.mocked(searchDocumentation).mockResolvedValueOnce(
        buildSearchResponse({
          pagination: createPaginationInfo({ page: 2, totalPages: 5, hasNext: true }),
        })
      );

      const result = await client.callTool({
        name: 'jamf_docs_search',
        arguments: { query: 'test', outputMode: 'compact' },
      });

      const text = getTextContent(result);
      expect(text).toContain('*Page 2/5');
    });
  });

  // --- JSON format ---------------------------------------------------------

  describe('JSON format output', () => {
    it('should return valid JSON with results array', async () => {
      vi.mocked(searchDocumentation).mockResolvedValueOnce(
        buildSearchResponse({
          results: [createSearchResult()],
        })
      );

      const result = await client.callTool({
        name: 'jamf_docs_search',
        arguments: { query: 'config', responseFormat: 'json' },
      });

      const text = getTextContent(result);
      const json = JSON.parse(text);
      expect(json.results).toBeDefined();
      expect(Array.isArray(json.results)).toBe(true);
      expect(json.results.length).toBeGreaterThan(0);
    });

    it('should include tokenInfo and pagination in JSON output', async () => {
      vi.mocked(searchDocumentation).mockResolvedValueOnce(
        buildSearchResponse()
      );

      const result = await client.callTool({
        name: 'jamf_docs_search',
        arguments: { query: 'config', responseFormat: 'json' },
      });

      const json = JSON.parse(getTextContent(result));
      expect(json.tokenInfo).toBeDefined();
      expect(json.tokenInfo.tokenCount).toBeGreaterThanOrEqual(0);
      expect(json.pagination).toBeDefined();
      expect(json.pagination.page).toBeDefined();
    });

    it('should include filters field in JSON output when product is set', async () => {
      vi.mocked(searchDocumentation).mockResolvedValueOnce(
        buildSearchResponse()
      );

      const result = await client.callTool({
        name: 'jamf_docs_search',
        arguments: { query: 'config', product: 'jamf-pro', responseFormat: 'json' },
      });

      const json = JSON.parse(getTextContent(result));
      expect(json.filters).toBeDefined();
      expect(json.filters.product).toBe('jamf-pro');
    });
  });

  // --- structuredContent ---------------------------------------------------

  describe('structuredContent', () => {
    it('should have query and results fields', async () => {
      vi.mocked(searchDocumentation).mockResolvedValueOnce(
        buildSearchResponse({
          results: [createSearchResult()],
        })
      );

      const result = await client.callTool({ name: 'jamf_docs_search', arguments: { query: 'config' } });

      const sc = result.structuredContent as Record<string, unknown>;
      expect(sc).toBeDefined();
      expect(sc.query).toBe('config');
      expect(Array.isArray(sc.results)).toBe(true);
    });

    it('should set product to empty string when result product is null', async () => {
      vi.mocked(searchDocumentation).mockResolvedValueOnce(
        buildSearchResponse({
          results: [createSearchResult({ product: null })],
        })
      );

      const result = await client.callTool({ name: 'jamf_docs_search', arguments: { query: 'test' } });

      const sc = result.structuredContent as Record<string, unknown>;
      const results = sc.results as Array<Record<string, unknown>>;
      expect(results[0].product).toBe('');
    });

    it('should include version in structuredContent result when version is set', async () => {
      vi.mocked(searchDocumentation).mockResolvedValueOnce(
        buildSearchResponse({
          results: [createSearchResult({ version: '11.5.0' })],
        })
      );

      const result = await client.callTool({ name: 'jamf_docs_search', arguments: { query: 'test' } });

      const sc = result.structuredContent as Record<string, unknown>;
      const results = sc.results as Array<Record<string, unknown>>;
      expect(results[0].version).toBe('11.5.0');
    });

    it('should omit version from structuredContent result when version is undefined', async () => {
      vi.mocked(searchDocumentation).mockResolvedValueOnce(
        buildSearchResponse({
          results: [createSearchResult({ version: undefined })],
        })
      );

      const result = await client.callTool({ name: 'jamf_docs_search', arguments: { query: 'test' } });

      const sc = result.structuredContent as Record<string, unknown>;
      const results = sc.results as Array<Record<string, unknown>>;
      expect(Object.prototype.hasOwnProperty.call(results[0], 'version')).toBe(false);
    });
  });

  // --- No results / suggestions path ---------------------------------------

  describe('no results path', () => {
    it('should return MCP response with text content and no error on empty results', async () => {
      vi.mocked(searchDocumentation).mockResolvedValueOnce(
        buildSearchResponse({
          results: [],
          pagination: createPaginationInfo({ totalItems: 0, totalPages: 0, hasNext: false }),
        })
      );

      const result = await client.callTool({
        name: 'jamf_docs_search',
        arguments: { query: 'xyznonexistent' },
      });

      // Verify the tool produces a valid MCP text content response (not an error)
      expect(result.isError).toBeFalsy();
      expect(result.content).toHaveLength(1);
      const first = result.content[0] as { type: string; text: string };
      expect(first.type).toBe('text');
      expect(typeof first.text).toBe('string');
      expect(first.text.length).toBeGreaterThan(0);
    });

    it('should include structuredContent with suggestions array on no-result path', async () => {
      vi.mocked(searchDocumentation).mockResolvedValueOnce(
        buildSearchResponse({
          results: [],
          pagination: createPaginationInfo({ totalItems: 0, totalPages: 0, hasNext: false }),
        })
      );

      const result = await client.callTool({
        name: 'jamf_docs_search',
        arguments: { query: 'xyznonexistent' },
      });

      const sc = result.structuredContent as Record<string, unknown>;
      expect(sc).not.toBeNull();
      expect(sc.query).toBe('xyznonexistent');
      expect(sc.results).toEqual([]);
      expect(sc.totalResults).toBe(0);
      expect(sc.page).toBe(1);
      expect(sc.totalPages).toBe(0);
      expect(sc.hasMore).toBe(false);
      // Verify tool builds suggestions from generateSearchSuggestions output
      expect(Array.isArray(sc.suggestions)).toBe(true);
      expect((sc.suggestions as string[]).length).toBeGreaterThan(0);
    });
  });

  // --- Pagination flags ----------------------------------------------------

  describe('pagination flags', () => {
    it('should have hasPrev=false and hasNext=true on first page', async () => {
      vi.mocked(searchDocumentation).mockResolvedValueOnce(
        buildSearchResponse({
          results: [createSearchResult()],
          pagination: createPaginationInfo({ page: 1, totalPages: 3, hasNext: true, hasPrev: false, totalItems: 25 }),
        })
      );

      const result = await client.callTool({ name: 'jamf_docs_search', arguments: { query: 'policy' } });

      const sc = result.structuredContent as Record<string, unknown>;
      // page 1 should not have a previous page hint and should show next
      const text = getTextContent(result);
      expect(text).toContain('page=2');
      expect(sc.page).toBe(1);
      expect(sc.hasMore).toBe(true);
    });

    it('should have hasNext=false and hasPrev=true on last page', async () => {
      vi.mocked(searchDocumentation).mockResolvedValueOnce(
        buildSearchResponse({
          results: [createSearchResult()],
          pagination: createPaginationInfo({ page: 3, totalPages: 3, hasNext: false, hasPrev: true, totalItems: 25 }),
        })
      );

      const result = await client.callTool({ name: 'jamf_docs_search', arguments: { query: 'policy', page: 3 } });

      const sc = result.structuredContent as Record<string, unknown>;
      const text = getTextContent(result);
      // Last page should not suggest a next page
      expect(text).not.toContain('page=4');
      expect(sc.page).toBe(3);
      expect(sc.hasMore).toBe(false);
    });
  });

  // --- Token truncation ----------------------------------------------------

  describe('token truncation', () => {
    it('should include truncation notice when tokenInfo.truncated is true', async () => {
      vi.mocked(searchDocumentation).mockResolvedValueOnce(
        buildSearchResponse({
          results: [createSearchResult()],
          tokenInfo: createTokenInfo({ truncated: true, tokenCount: 5000, maxTokens: 5000 }),
        })
      );

      const result = await client.callTool({ name: 'jamf_docs_search', arguments: { query: 'test' } });

      const text = getTextContent(result);
      expect(text).toContain('truncated');
    });

    it('should NOT include truncation notice when tokenInfo.truncated is false', async () => {
      vi.mocked(searchDocumentation).mockResolvedValueOnce(
        buildSearchResponse({
          results: [createSearchResult()],
          tokenInfo: createTokenInfo({ truncated: false, tokenCount: 100, maxTokens: 5000 }),
        })
      );

      const result = await client.callTool({ name: 'jamf_docs_search', arguments: { query: 'test' } });

      const text = getTextContent(result);
      expect(text).not.toContain('Results truncated');
    });
  });

  // --- No results suggestions in structuredContent -------------------------

  describe('no results - structuredContent suggestions', () => {
    it('should include suggestions array in structuredContent when no results found', async () => {
      vi.mocked(searchDocumentation).mockResolvedValueOnce(
        buildSearchResponse({
          results: [],
          pagination: createPaginationInfo({ totalItems: 0, totalPages: 0, hasNext: false }),
        })
      );

      const result = await client.callTool({
        name: 'jamf_docs_search',
        arguments: { query: 'xyznonexistent' },
      });

      const sc = result.structuredContent as Record<string, unknown>;
      expect(sc).toBeDefined();
      expect(Array.isArray(sc.suggestions)).toBe(true);
      // The mock generateSearchSuggestions returns alternativeKeywords and tips
      expect((sc.suggestions as unknown[]).length).toBeGreaterThan(0);
    });

    it('should set totalResults=0 and hasMore=false in structuredContent on no-result path', async () => {
      vi.mocked(searchDocumentation).mockResolvedValueOnce(
        buildSearchResponse({
          results: [],
          pagination: createPaginationInfo({ totalItems: 0, totalPages: 0, hasNext: false }),
        })
      );

      const result = await client.callTool({
        name: 'jamf_docs_search',
        arguments: { query: 'xyznonexistent' },
      });

      const sc = result.structuredContent as Record<string, unknown>;
      expect(sc.totalResults).toBe(0);
      expect(sc.hasMore).toBe(false);
      expect(sc.page).toBe(1);
    });
  });

  // --- maxTokens behaviour (regression test for #12) ------------------------

  describe('maxTokens behaviour', () => {
    it('should respect maxTokens limit by reflecting truncation in output', async () => {
      // Simulate many results that would collectively exceed a small token budget.
      // searchDocumentation is mocked, so we return a response where the service
      // has already applied truncation (truncated: true) for a small maxTokens.
      const manyResults = Array.from({ length: 10 }, (_, i) =>
        createSearchResult({
          title: `Article ${i + 1}: A Long Title About Apple Device Management`,
          snippet: 'This is a detailed snippet about configuring devices and policies '
            + 'for enterprise management including enrollment, profiles, and more.',
          url: `https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/Article_${i + 1}.html`,
        })
      );

      vi.mocked(searchDocumentation).mockResolvedValueOnce(
        buildSearchResponse({
          results: manyResults,
          pagination: createPaginationInfo({
            totalItems: 10,
            totalPages: 1,
            hasNext: false,
            pageSize: 10,
          }),
          tokenInfo: createTokenInfo({
            truncated: true,
            tokenCount: 100,
            maxTokens: 100,
          }),
        })
      );

      const result = await client.callTool({
        name: 'jamf_docs_search',
        arguments: { query: 'device management', maxTokens: 100 },
      });

      const text = getTextContent(result);
      // The tool should render the truncation notice from tokenInfo.truncated
      expect(text.toLowerCase()).toContain('truncated');
    });

    it('should forward maxTokens to searchDocumentation', async () => {
      vi.mocked(searchDocumentation).mockResolvedValueOnce(
        buildSearchResponse({
          results: [createSearchResult()],
          tokenInfo: createTokenInfo({ tokenCount: 50, maxTokens: 200 }),
        })
      );

      await client.callTool({
        name: 'jamf_docs_search',
        arguments: { query: 'test', maxTokens: 200 },
      });

      // Verify searchDocumentation was called with the correct maxTokens
      expect(searchDocumentation).toHaveBeenCalledTimes(1);
      const callArgs = vi.mocked(searchDocumentation).mock.calls[0];
      // Second argument is the params object containing maxTokens
      expect(callArgs[1]).toMatchObject({ maxTokens: 200 });
    });

    it('should not show truncation notice when maxTokens is sufficient', async () => {
      vi.mocked(searchDocumentation).mockResolvedValueOnce(
        buildSearchResponse({
          results: [createSearchResult()],
          tokenInfo: createTokenInfo({ truncated: false, tokenCount: 200, maxTokens: 5000 }),
        })
      );

      const result = await client.callTool({
        name: 'jamf_docs_search',
        arguments: { query: 'test', maxTokens: 5000 },
      });

      const text = getTextContent(result);
      expect(text).not.toContain('Results truncated');
    });
  });

  // --- Error paths ---------------------------------------------------------

  describe('error handling', () => {
    it('should return isError on invalid product ID (Zod schema validation)', async () => {
      // The MCP SDK validates input against the Zod schema before calling the handler.
      // An invalid product enum value produces an isError result with a validation message.
      const result = await client.callTool({
        name: 'jamf_docs_search',
        arguments: { query: 'test', product: 'invalid-product' },
      });

      expect(result.isError).toBe(true);
      const text = getTextContent(result);
      expect(text).toMatch(/invalid/i);
      expect(text).toContain('jamf-pro');
    });

    it('should return isError on invalid topic ID (Zod schema validation)', async () => {
      // Same as above — invalid enum values are caught by Zod at the protocol level.
      const result = await client.callTool({
        name: 'jamf_docs_search',
        arguments: { query: 'test', topic: 'invalid-topic' },
      });

      expect(result.isError).toBe(true);
      const text = getTextContent(result);
      expect(text).toMatch(/invalid/i);
      expect(text).toContain('enrollment');
    });

    it('should return isError when scraper throws an error', async () => {
      vi.mocked(searchDocumentation).mockRejectedValueOnce(new Error('Network timeout'));

      const result = await client.callTool({
        name: 'jamf_docs_search',
        arguments: { query: 'test' },
      });

      expect(result.isError).toBe(true);
      const text = getTextContent(result);
      expect(text).toContain('Search error');
    });

    it('should return isError with sanitized message when network error contains a file path', async () => {
      // sanitizeErrorMessage strips absolute Unix file paths from error text
      vi.mocked(searchDocumentation).mockRejectedValueOnce(
        new Error('ENOENT: no such file or directory, open \'/home/app/config/secrets.json\'')
      );

      const result = await client.callTool({
        name: 'jamf_docs_search',
        arguments: { query: 'enrollment' },
      });

      expect(result.isError).toBe(true);
      const text = getTextContent(result);
      expect(text).toContain('Search error');
      // The sanitizer replaces Unix file paths with <path>
      expect(text).not.toContain('/home/app/config/secrets.json');
    });

    it('should return isError when rate limit error is thrown', async () => {
      vi.mocked(searchDocumentation).mockRejectedValueOnce(
        new Error('Request failed with status 429: Too Many Requests')
      );

      const result = await client.callTool({
        name: 'jamf_docs_search',
        arguments: { query: 'policy' },
      });

      expect(result.isError).toBe(true);
      const text = getTextContent(result);
      expect(text).toContain('Search error');
    });
  });
});
