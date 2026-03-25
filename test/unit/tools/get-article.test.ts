/**
 * Unit tests for jamf_docs_get_article tool handler formatting functions.
 *
 * The private formatting functions (formatBreadcrumb, formatMetadata,
 * formatSectionsList, formatFooter, formatArticleAsCompact,
 * formatArticleAsMarkdown) are tested indirectly by calling the registered
 * tool through an in-process McpServer + Client pair with mocked services.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  createFetchArticleResult,
  createTokenInfo,
  createArticleSection,
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
import { registerGetArticleTool } from '../../../src/tools/get-article.js';

// ---------------------------------------------------------------------------

type TextContent = { type: 'text'; text: string };

function getTextContent(result: { content: unknown[] }): string {
  const first = result.content[0] as TextContent;
  return first.text;
}

const VALID_URL = 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/Configuration_Profiles.html';

// ---------------------------------------------------------------------------

describe('jamf_docs_get_article tool', () => {
  let client: Client;
  let server: McpServer;

  beforeAll(async () => {
    server = new McpServer({ name: 'test-server', version: '0.0.1' });
    registerGetArticleTool(server);

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

  // --- Full markdown format -------------------------------------------------

  describe('full markdown output (default)', () => {
    it('should include breadcrumb as italic text', async () => {
      vi.mocked(fetchArticle).mockResolvedValueOnce(
        createFetchArticleResult({ breadcrumb: ['Jamf Pro', 'Device Management', 'Config Profiles'] })
      );

      const result = await client.callTool({ name: 'jamf_docs_get_article', arguments: { url: VALID_URL } });

      const text = getTextContent(result);
      expect(text).toContain('*Jamf Pro > Device Management > Config Profiles*');
    });

    it('should include article title as H1', async () => {
      vi.mocked(fetchArticle).mockResolvedValueOnce(
        createFetchArticleResult({ title: 'Configuration Profiles' })
      );

      const result = await client.callTool({ name: 'jamf_docs_get_article', arguments: { url: VALID_URL } });

      const text = getTextContent(result);
      expect(text).toContain('# Configuration Profiles');
    });

    it('should include product in metadata line', async () => {
      vi.mocked(fetchArticle).mockResolvedValueOnce(
        createFetchArticleResult({ product: 'Jamf Pro', version: '11.5.0', lastUpdated: '2025-01-15' })
      );

      const result = await client.callTool({ name: 'jamf_docs_get_article', arguments: { url: VALID_URL } });

      const text = getTextContent(result);
      expect(text).toContain('**Product**: Jamf Pro');
      expect(text).toContain('**Version**: 11.5.0');
      expect(text).toContain('**Last Updated**: 2025-01-15');
    });

    it('should include token count in metadata line', async () => {
      vi.mocked(fetchArticle).mockResolvedValueOnce(
        createFetchArticleResult({ tokenInfo: createTokenInfo({ tokenCount: 1234, maxTokens: 5000 }) })
      );

      const result = await client.callTool({ name: 'jamf_docs_get_article', arguments: { url: VALID_URL } });

      const text = getTextContent(result);
      expect(text).toContain('**Tokens**: 1,234/5,000');
    });

    it('should omit product/version when they are empty strings', async () => {
      vi.mocked(fetchArticle).mockResolvedValueOnce(
        createFetchArticleResult({ product: '', version: '' })
      );

      const result = await client.callTool({ name: 'jamf_docs_get_article', arguments: { url: VALID_URL } });

      const text = getTextContent(result);
      expect(text).not.toContain('**Product**:');
      expect(text).not.toContain('**Version**:');
    });

    it('should show available sections list when truncated', async () => {
      vi.mocked(fetchArticle).mockResolvedValueOnce(
        createFetchArticleResult({
          tokenInfo: createTokenInfo({ truncated: true }),
          sections: [
            createArticleSection({ id: 's1', title: 'Overview', level: 2, tokenCount: 100 }),
            createArticleSection({ id: 's2', title: 'Prerequisites', level: 2, tokenCount: 200 }),
          ],
        })
      );

      const result = await client.callTool({ name: 'jamf_docs_get_article', arguments: { url: VALID_URL } });

      const text = getTextContent(result);
      expect(text).toContain('## Available Sections');
      expect(text).toContain('**Overview**');
      expect(text).toContain('**Prerequisites**');
    });

    it('should NOT show sections list when not truncated', async () => {
      vi.mocked(fetchArticle).mockResolvedValueOnce(
        createFetchArticleResult({
          tokenInfo: createTokenInfo({ truncated: false }),
          sections: [
            createArticleSection({ id: 's1', title: 'Overview', level: 2, tokenCount: 100 }),
          ],
        })
      );

      const result = await client.callTool({ name: 'jamf_docs_get_article', arguments: { url: VALID_URL } });

      const text = getTextContent(result);
      expect(text).not.toContain('## Available Sections');
    });

    it('should include source footer with URL', async () => {
      vi.mocked(fetchArticle).mockResolvedValueOnce(
        createFetchArticleResult({ url: VALID_URL })
      );

      const result = await client.callTool({ name: 'jamf_docs_get_article', arguments: { url: VALID_URL } });

      const text = getTextContent(result);
      expect(text).toContain('*Source: [');
      expect(text).toContain(VALID_URL);
    });

    it('should include related articles when includeRelated is true', async () => {
      vi.mocked(fetchArticle).mockResolvedValueOnce(
        createFetchArticleResult({
          relatedArticles: [
            { title: 'Policies', url: 'https://learn.jamf.com/page/Policies.html' },
          ],
        })
      );

      const result = await client.callTool({
        name: 'jamf_docs_get_article',
        arguments: { url: VALID_URL, includeRelated: true },
      });

      const text = getTextContent(result);
      expect(text).toContain('## Related Articles');
      expect(text).toContain('[Policies]');
    });

    it('should NOT include related articles when includeRelated is false', async () => {
      vi.mocked(fetchArticle).mockResolvedValueOnce(
        createFetchArticleResult({
          relatedArticles: [
            { title: 'Policies', url: 'https://learn.jamf.com/page/Policies.html' },
          ],
        })
      );

      const result = await client.callTool({
        name: 'jamf_docs_get_article',
        arguments: { url: VALID_URL, includeRelated: false },
      });

      const text = getTextContent(result);
      expect(text).not.toContain('## Related Articles');
    });

    it('should show section label when section parameter is provided', async () => {
      vi.mocked(fetchArticle).mockResolvedValueOnce(
        createFetchArticleResult()
      );

      const result = await client.callTool({
        name: 'jamf_docs_get_article',
        arguments: { url: VALID_URL, section: 'Prerequisites' },
      });

      const text = getTextContent(result);
      expect(text).toContain('*Showing section: "Prerequisites"*');
    });

    it('should show truncated flag in metadata when content is truncated', async () => {
      vi.mocked(fetchArticle).mockResolvedValueOnce(
        createFetchArticleResult({
          tokenInfo: createTokenInfo({ truncated: true, tokenCount: 5000, maxTokens: 5000 }),
        })
      );

      const result = await client.callTool({ name: 'jamf_docs_get_article', arguments: { url: VALID_URL } });

      const text = getTextContent(result);
      expect(text).toContain('*(truncated)*');
    });
  });

  // --- Compact mode ---------------------------------------------------------

  describe('compact markdown output', () => {
    it('should include article title as H1 but no breadcrumb', async () => {
      vi.mocked(fetchArticle).mockResolvedValueOnce(
        createFetchArticleResult({ title: 'Config Profiles', breadcrumb: ['Jamf Pro', 'Device Management'] })
      );

      const result = await client.callTool({
        name: 'jamf_docs_get_article',
        arguments: { url: VALID_URL, outputMode: 'compact' },
      });

      const text = getTextContent(result);
      expect(text).toContain('# Config Profiles');
      // Breadcrumb is NOT rendered in compact mode
      expect(text).not.toContain('Jamf Pro > Device Management');
    });

    it('should use compact footer with [Source] link format', async () => {
      vi.mocked(fetchArticle).mockResolvedValueOnce(
        createFetchArticleResult({ url: VALID_URL })
      );

      const result = await client.callTool({
        name: 'jamf_docs_get_article',
        arguments: { url: VALID_URL, outputMode: 'compact' },
      });

      const text = getTextContent(result);
      expect(text).toContain('[Source]');
      // Full verbose format should NOT be present
      expect(text).not.toContain('*Source: [');
    });

    it('should include product and version in compact metadata when present', async () => {
      vi.mocked(fetchArticle).mockResolvedValueOnce(
        createFetchArticleResult({ product: 'Jamf Pro', version: '11.5.0' })
      );

      const result = await client.callTool({
        name: 'jamf_docs_get_article',
        arguments: { url: VALID_URL, outputMode: 'compact' },
      });

      const text = getTextContent(result);
      expect(text).toContain('Jamf Pro');
      expect(text).toContain('v11.5.0');
    });

    it('should omit metadata line in compact mode when no product or version', async () => {
      vi.mocked(fetchArticle).mockResolvedValueOnce(
        createFetchArticleResult({ product: '', version: '' })
      );

      const result = await client.callTool({
        name: 'jamf_docs_get_article',
        arguments: { url: VALID_URL, outputMode: 'compact' },
      });

      const text = getTextContent(result);
      // The compact metadata italic line should not appear if no product/version
      expect(text).not.toMatch(/\*Jamf/);
    });
  });

  // --- JSON format ----------------------------------------------------------

  describe('JSON format output', () => {
    it('should return valid JSON with title, content, url', async () => {
      vi.mocked(fetchArticle).mockResolvedValueOnce(
        createFetchArticleResult()
      );

      const result = await client.callTool({
        name: 'jamf_docs_get_article',
        arguments: { url: VALID_URL, responseFormat: 'json' },
      });

      const text = getTextContent(result);
      const json = JSON.parse(text);
      expect(json.title).toBe('Configuration Profiles');
      expect(json.content).toBe('# Configuration Profiles\n\nThis article covers configuration profiles.');
      expect(json.url).toBe(VALID_URL);
    });

    it('should include sections array in JSON output', async () => {
      vi.mocked(fetchArticle).mockResolvedValueOnce(
        createFetchArticleResult({
          sections: [
            createArticleSection({ id: 'prereq', title: 'Prerequisites', level: 2, tokenCount: 150 }),
          ],
        })
      );

      const result = await client.callTool({
        name: 'jamf_docs_get_article',
        arguments: { url: VALID_URL, responseFormat: 'json' },
      });

      const json = JSON.parse(getTextContent(result));
      expect(Array.isArray(json.sections)).toBe(true);
      expect(json.sections[0].title).toBe('Prerequisites');
      expect(json.sections[0].id).toBe('prereq');
      expect(json.sections[0].level).toBe(2);
    });

    it('should include tokenInfo in JSON output', async () => {
      vi.mocked(fetchArticle).mockResolvedValueOnce(
        createFetchArticleResult({ tokenInfo: createTokenInfo({ tokenCount: 999, maxTokens: 5000 }) })
      );

      const result = await client.callTool({
        name: 'jamf_docs_get_article',
        arguments: { url: VALID_URL, responseFormat: 'json' },
      });

      const json = JSON.parse(getTextContent(result));
      expect(json.tokenInfo.tokenCount).toBe(999);
      expect(json.tokenInfo.maxTokens).toBe(5000);
    });
  });

  // --- structuredContent ---------------------------------------------------

  describe('structuredContent', () => {
    it('should have title, url, content, sections, and truncated fields', async () => {
      vi.mocked(fetchArticle).mockResolvedValueOnce(
        createFetchArticleResult()
      );

      const result = await client.callTool({ name: 'jamf_docs_get_article', arguments: { url: VALID_URL } });

      const sc = result.structuredContent as Record<string, unknown>;
      expect(sc).not.toBeNull();
      expect(sc.title).toBe('Configuration Profiles');
      expect(sc.url).toBe(VALID_URL);
      expect(sc.content).toBe('# Configuration Profiles\n\nThis article covers configuration profiles.');
      expect(Array.isArray(sc.sections)).toBe(true);
      expect(sc.truncated).toBe(false);
    });

    it('should include optional product field when present', async () => {
      vi.mocked(fetchArticle).mockResolvedValueOnce(
        createFetchArticleResult({ product: 'Jamf Pro' })
      );

      const result = await client.callTool({ name: 'jamf_docs_get_article', arguments: { url: VALID_URL } });

      const sc = result.structuredContent as Record<string, unknown>;
      expect(sc.product).toBe('Jamf Pro');
    });

    it('should omit product field from structuredContent when product is undefined', async () => {
      vi.mocked(fetchArticle).mockResolvedValueOnce(
        createFetchArticleResult({ product: undefined })
      );

      const result = await client.callTool({ name: 'jamf_docs_get_article', arguments: { url: VALID_URL } });

      const sc = result.structuredContent as Record<string, unknown>;
      expect(Object.prototype.hasOwnProperty.call(sc, 'product')).toBe(false);
    });

    it('should include breadcrumb in structuredContent when present', async () => {
      vi.mocked(fetchArticle).mockResolvedValueOnce(
        createFetchArticleResult({ breadcrumb: ['Jamf Pro', 'Device Management'] })
      );

      const result = await client.callTool({ name: 'jamf_docs_get_article', arguments: { url: VALID_URL } });

      const sc = result.structuredContent as Record<string, unknown>;
      expect(sc.breadcrumb).toEqual(['Jamf Pro', 'Device Management']);
    });

    it('should set truncated to true when tokenInfo.truncated is true', async () => {
      vi.mocked(fetchArticle).mockResolvedValueOnce(
        createFetchArticleResult({ tokenInfo: createTokenInfo({ truncated: true }) })
      );

      const result = await client.callTool({ name: 'jamf_docs_get_article', arguments: { url: VALID_URL } });

      const sc = result.structuredContent as Record<string, unknown>;
      expect(sc.truncated).toBe(true);
    });
  });

  // --- Section extraction ---------------------------------------------------

  describe('section extraction', () => {
    it('should show section label and content when a valid section is matched', async () => {
      vi.mocked(fetchArticle).mockResolvedValueOnce(
        createFetchArticleResult({
          content: '## Prerequisites\n\nYou need admin access.',
          sections: [
            createArticleSection({ id: 'prerequisites', title: 'Prerequisites', level: 2, tokenCount: 50 }),
          ],
          tokenInfo: createTokenInfo({ truncated: false }),
        })
      );

      const result = await client.callTool({
        name: 'jamf_docs_get_article',
        arguments: { url: VALID_URL, section: 'Prerequisites' },
      });

      const text = getTextContent(result);
      expect(text).toContain('*Showing section: "Prerequisites"*');
      // The section content returned by the (mocked) scraper should appear
      expect(text).toContain('Prerequisites');
      expect(result.isError).toBeFalsy();
    });

    it('should return not-found message with available sections when section does not exist', async () => {
      // When the scraper cannot find the requested section it returns a "not found" message
      // with an available sections list as the content field.
      vi.mocked(fetchArticle).mockResolvedValueOnce(
        createFetchArticleResult({
          content: '*Section "NonExistentSection" not found.*\n\n**Available sections:**\n- Prerequisites\n- Configuration',
          sections: [
            createArticleSection({ id: 'prerequisites', title: 'Prerequisites', level: 2, tokenCount: 50 }),
            createArticleSection({ id: 'configuration', title: 'Configuration', level: 2, tokenCount: 200 }),
          ],
          tokenInfo: createTokenInfo({ truncated: false }),
        })
      );

      const result = await client.callTool({
        name: 'jamf_docs_get_article',
        arguments: { url: VALID_URL, section: 'NonExistentSection' },
      });

      // Verify the tool wraps the content in an MCP response with proper structure
      expect(result.isError).toBeFalsy();
      expect(result.content).toHaveLength(1);
      const text = getTextContent(result);
      // Verify the tool adds the article title as H1 header (formatting logic)
      expect(text).toContain('# Configuration Profiles');
      // Verify the tool adds the source URL footer
      expect(text).toContain(VALID_URL);
      // Verify structuredContent includes section metadata from the tool's mapping logic
      const sc = result.structuredContent as Record<string, unknown>;
      const sections = sc.sections as Array<{ id: string; title: string }>;
      expect(sections).toHaveLength(2);
      expect(sections[0].id).toBe('prerequisites');
      expect(sections[1].id).toBe('configuration');
    });
  });

  // --- Summary-only mode ----------------------------------------------------

  describe('summaryOnly mode', () => {
    it('should return content with Summary and Article Outline when summaryOnly is true', async () => {
      // The scraper returns content pre-formatted with ## Summary and ## Article Outline
      // when summaryOnly=true. We mock this return value here.
      vi.mocked(fetchArticle).mockResolvedValueOnce(
        createFetchArticleResult({
          content: '## Summary\n\nThis article covers configuration profiles.\n\n## Article Outline (2 sections)\n\n- Prerequisites (~200 tokens)\n- Configuration (~500 tokens)\n\n*Estimated read time: 3 min | Total: 5,000 tokens*\n',
          tokenInfo: createTokenInfo({ tokenCount: 200, truncated: false }),
        })
      );

      const result = await client.callTool({
        name: 'jamf_docs_get_article',
        arguments: { url: VALID_URL, summaryOnly: true },
      });

      // Verify the tool wraps the response in proper MCP format
      expect(result.isError).toBeFalsy();
      expect(result.content).toHaveLength(1);
      const text = getTextContent(result);
      // Verify the tool adds the article title as H1 header (its formatting logic)
      expect(text).toContain('# Configuration Profiles');
      // Verify the tool adds the source URL footer
      expect(text).toContain(VALID_URL);
      // Verify structuredContent is built with correct truncated flag from tokenInfo
      const sc = result.structuredContent as Record<string, unknown>;
      expect(sc.truncated).toBe(false);
      expect(sc.title).toBe('Configuration Profiles');
    });

    it('should set truncated=false in structuredContent for summaryOnly response', async () => {
      vi.mocked(fetchArticle).mockResolvedValueOnce(
        createFetchArticleResult({
          content: '## Summary\n\nBrief overview.\n\n## Article Outline (1 sections)\n\n- Overview (~100 tokens)\n',
          tokenInfo: createTokenInfo({ tokenCount: 80, truncated: false }),
        })
      );

      const result = await client.callTool({
        name: 'jamf_docs_get_article',
        arguments: { url: VALID_URL, summaryOnly: true },
      });

      const sc = result.structuredContent as Record<string, unknown>;
      expect(sc.truncated).toBe(false);
    });
  });

  // --- Error handling -------------------------------------------------------

  describe('error handling', () => {
    it('should return isError with 404 message and search suggestion', async () => {
      vi.mocked(fetchArticle).mockRejectedValueOnce(new Error('Article not found: 404 Not Found'));

      const result = await client.callTool({ name: 'jamf_docs_get_article', arguments: { url: VALID_URL } });

      expect(result.isError).toBe(true);
      const text = getTextContent(result);
      expect(text).toContain('Error fetching article');
      // The tool appends a help text about searching when 404 occurs
      expect(text).toContain('jamf_docs_search');
    });

    it('should return isError with rate limit help text', async () => {
      vi.mocked(fetchArticle).mockRejectedValueOnce(new Error('Too many requests: rate limit exceeded'));

      const result = await client.callTool({ name: 'jamf_docs_get_article', arguments: { url: VALID_URL } });

      expect(result.isError).toBe(true);
      const text = getTextContent(result);
      expect(text).toContain('wait');
    });

    it('should return isError for general network errors', async () => {
      vi.mocked(fetchArticle).mockRejectedValueOnce(new Error('Network connection failed'));

      const result = await client.callTool({ name: 'jamf_docs_get_article', arguments: { url: VALID_URL } });

      expect(result.isError).toBe(true);
      const text = getTextContent(result);
      expect(text).toContain('Error fetching article');
    });

    it('should return isError for invalid URL (schema validation)', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_get_article',
        arguments: { url: 'https://example.com/invalid' },
      });

      // Zod schema rejects non-jamf.com URLs
      expect(result.isError).toBe(true);
    });
  });
});
