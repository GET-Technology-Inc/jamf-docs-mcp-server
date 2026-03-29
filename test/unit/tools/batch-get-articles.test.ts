/**
 * Unit tests for jamf_docs_batch_get_articles tool.
 *
 * Tests cover: input validation, token budget distribution, concurrency limiter,
 * partial failure handling, markdown/JSON formatting, and progress reporting.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  createFetchArticleResult,
  createTokenInfo,
} from '../../helpers/fixtures.js';

// --- Mock service modules before importing the tool --------------------------

vi.mock('../../../src/services/scraper.js', () => ({
  searchDocumentation: vi.fn(),
  fetchArticle: vi.fn(),
  fetchTableOfContents: vi.fn(),
  ALLOWED_HOSTNAMES: new Set(['learn.jamf.com', 'learn-be.jamf.com', 'docs.jamf.com']),
  isAllowedHostname: (url: string) => {
    try { return new Set(['learn.jamf.com', 'learn-be.jamf.com', 'docs.jamf.com']).has(new URL(url).hostname); }
    catch { return false; }
  },
}));

vi.mock('../../../src/services/cache.js', () => ({
  cache: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn(),
  },
}));

// Import AFTER mocks are set up
import { fetchArticle } from '../../../src/services/scraper.js';
import { registerBatchGetArticlesTool } from '../../../src/tools/batch-get-articles.js';
import { limitConcurrency, distributeTokenBudget } from '../../../src/tools/batch-get-articles.js';

// ---------------------------------------------------------------------------

type TextContent = { type: 'text'; text: string };

function getTextContent(result: { content: unknown[] }): string {
  const first = result.content[0] as TextContent;
  return first.text;
}

const URL_1 = 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/Configuration_Profiles.html';
const URL_2 = 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/Policies.html';
const URL_3 = 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/NotFound.html';

// ---------------------------------------------------------------------------

describe('distributeTokenBudget', () => {
  it('should split tokens evenly', () => {
    expect(distributeTokenBudget(6000, 3)).toBe(2000);
  });

  it('should floor fractional splits', () => {
    expect(distributeTokenBudget(1000, 3)).toBe(333);
  });

  it('should enforce minimum tokens', () => {
    // 100 / 10 = 10, but MIN_TOKENS is 100
    expect(distributeTokenBudget(100, 10)).toBe(100);
  });

  it('should handle single URL', () => {
    expect(distributeTokenBudget(5000, 1)).toBe(5000);
  });
});

// ---------------------------------------------------------------------------

describe('limitConcurrency', () => {
  it('should execute all tasks and preserve order', async () => {
    const results = await limitConcurrency(
      [
        () => Promise.resolve('a'),
        () => Promise.resolve('b'),
        () => Promise.resolve('c'),
      ],
      2
    );
    expect(results).toEqual(['a', 'b', 'c']);
  });

  it('should handle empty task list', async () => {
    const results = await limitConcurrency([], 3);
    expect(results).toEqual([]);
  });

  it('should respect concurrency limit', async () => {
    let maxConcurrent = 0;
    let currentConcurrent = 0;

    const makeTask = (value: string) => async (): Promise<string> => {
      currentConcurrent++;
      if (currentConcurrent > maxConcurrent) {
        maxConcurrent = currentConcurrent;
      }
      // Simulate async work
      await new Promise((r) => setTimeout(r, 10));
      currentConcurrent--;
      return value;
    };

    await limitConcurrency(
      [makeTask('a'), makeTask('b'), makeTask('c'), makeTask('d'), makeTask('e')],
      2
    );

    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------

describe('jamf_docs_batch_get_articles tool', () => {
  let client: Client;
  let server: McpServer;

  beforeAll(async () => {
    server = new McpServer({ name: 'test-server', version: '0.0.1' });
    registerBatchGetArticlesTool(server);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    client = new Client({ name: 'test-client', version: '0.0.1' });

    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await client.close();
  });

  beforeEach(() => {
    vi.mocked(fetchArticle).mockReset();
  });

  // --- Input validation ---

  describe('input validation', () => {
    it('should reject empty urls array', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_batch_get_articles',
        arguments: { urls: [] },
      });
      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toMatch(/Invalid input|validation error/i);
    });

    it('should reject more than 10 urls', async () => {
      const urls = Array.from({ length: 11 }, (_, i) =>
        `https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/Page${i}.html`
      );
      const result = await client.callTool({
        name: 'jamf_docs_batch_get_articles',
        arguments: { urls },
      });
      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toMatch(/Invalid input|validation error/i);
    });

    it('should reject invalid URL domains', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_batch_get_articles',
        arguments: { urls: ['https://evil.com/malicious'] },
      });
      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toMatch(/Invalid input|validation error/i);
    });
  });

  // --- Successful batch ---

  describe('successful batch', () => {
    it('should return all articles in markdown format', async () => {
      vi.mocked(fetchArticle).mockResolvedValue(
        createFetchArticleResult({
          title: 'Config Profiles',
          content: 'Article content here',
          tokenInfo: createTokenInfo({ tokenCount: 500, maxTokens: 2500 }),
        })
      );

      const result = await client.callTool({
        name: 'jamf_docs_batch_get_articles',
        arguments: { urls: [URL_1, URL_2] },
      });

      expect(result.isError).toBeFalsy();
      const text = getTextContent(result);
      expect(text).toContain('Config Profiles');
      expect(text).toContain('Batch Summary');
      expect(text).toContain('2/2 articles retrieved');
    });

    it('should return JSON format when requested', async () => {
      vi.mocked(fetchArticle).mockResolvedValue(
        createFetchArticleResult({
          title: 'Test Article',
          content: 'Content',
          tokenInfo: createTokenInfo({ tokenCount: 300, maxTokens: 5000 }),
        })
      );

      const result = await client.callTool({
        name: 'jamf_docs_batch_get_articles',
        arguments: {
          urls: [URL_1],
          responseFormat: 'json',
        },
      });

      expect(result.isError).toBeFalsy();
      const json = JSON.parse(getTextContent(result));
      expect(json.results).toHaveLength(1);
      expect(json.results[0].status).toBe('success');
      expect(json.summary.total).toBe(1);
      expect(json.summary.succeeded).toBe(1);
      expect(json.summary.failed).toBe(0);
    });

    it('should use compact output mode', async () => {
      vi.mocked(fetchArticle).mockResolvedValue(
        createFetchArticleResult({
          title: 'Compact Article',
          content: 'Short content',
          product: 'Jamf Pro',
          version: 'current',
          tokenInfo: createTokenInfo({ tokenCount: 200, maxTokens: 5000 }),
        })
      );

      const result = await client.callTool({
        name: 'jamf_docs_batch_get_articles',
        arguments: {
          urls: [URL_1],
          outputMode: 'compact',
        },
      });

      const text = getTextContent(result);
      // Compact mode uses shorter source format
      expect(text).toContain('Source');
      expect(text).toContain('200 tokens');
    });
  });

  // --- Partial failure ---

  describe('partial failure handling', () => {
    it('should succeed overall when some articles fail', async () => {
      vi.mocked(fetchArticle)
        .mockResolvedValueOnce(
          createFetchArticleResult({
            title: 'Good Article',
            content: 'Works fine',
            tokenInfo: createTokenInfo({ tokenCount: 300 }),
          })
        )
        .mockRejectedValueOnce(new Error('Article not found (404)'));

      const result = await client.callTool({
        name: 'jamf_docs_batch_get_articles',
        arguments: { urls: [URL_1, URL_3] },
      });

      // Not isError because at least one succeeded
      expect(result.isError).toBeFalsy();
      const text = getTextContent(result);
      expect(text).toContain('Good Article');
      expect(text).toContain('Error');
      expect(text).toContain('1/2 articles retrieved');
      expect(text).toContain('1 failed');
    });

    it('should set isError when all articles fail', async () => {
      vi.mocked(fetchArticle).mockRejectedValue(new Error('Network timeout'));

      const result = await client.callTool({
        name: 'jamf_docs_batch_get_articles',
        arguments: { urls: [URL_1, URL_2] },
      });

      expect(result.isError).toBe(true);
      const text = getTextContent(result);
      expect(text).toContain('0/2 articles retrieved');
    });

    it('should report partial failure in JSON format', async () => {
      vi.mocked(fetchArticle)
        .mockResolvedValueOnce(
          createFetchArticleResult({
            title: 'OK',
            content: 'ok',
            tokenInfo: createTokenInfo({ tokenCount: 100 }),
          })
        )
        .mockRejectedValueOnce(new Error('Not found (404)'));

      const result = await client.callTool({
        name: 'jamf_docs_batch_get_articles',
        arguments: {
          urls: [URL_1, URL_3],
          responseFormat: 'json',
        },
      });

      const json = JSON.parse(getTextContent(result));
      expect(json.summary.succeeded).toBe(1);
      expect(json.summary.failed).toBe(1);
      expect(json.results[0].status).toBe('success');
      expect(json.results[1].status).toBe('error');
      expect(json.results[1].error).toBeDefined();
    });
  });

  // --- Token budget ---

  describe('token budget distribution', () => {
    it('should distribute maxTokens evenly to fetchArticle calls', async () => {
      vi.mocked(fetchArticle).mockResolvedValue(
        createFetchArticleResult({
          tokenInfo: createTokenInfo({ tokenCount: 100, maxTokens: 1000 }),
        })
      );

      await client.callTool({
        name: 'jamf_docs_batch_get_articles',
        arguments: {
          urls: [URL_1, URL_2],
          maxTokens: 4000,
        },
      });

      // Each article should get 4000 / 2 = 2000 tokens
      expect(fetchArticle).toHaveBeenCalledTimes(2);
      const firstCallOptions = vi.mocked(fetchArticle).mock.calls[0][1];
      expect(firstCallOptions?.maxTokens).toBe(2000);
    });
  });
});
