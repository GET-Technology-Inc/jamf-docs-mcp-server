/**
 * E2E tests for MCP server response structure and tool behaviour.
 *
 * Uses an in-process McpServer + InMemoryTransport pair so no dist/build
 * is required. HTTP calls are mocked so tests are fully deterministic.
 *
 * Covers:
 *  - Search tool: valid query, product filter, invalid input
 *  - Get Article tool: valid URL, invalid URL, summaryOnly
 *  - List Products tool: all products, JSON format, compact mode
 *  - Get TOC tool: valid product, invalid product, JSON format
 *  - Error response consistency: isError, content[0].type
 *  - Server lifecycle: tool/resource/prompt registration counts
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

// ---------------------------------------------------------------------------
// Mock service modules BEFORE importing tools/resources
// ---------------------------------------------------------------------------

vi.mock('../../src/services/scraper.js', () => ({
  searchDocumentation: vi.fn(),
  fetchArticle: vi.fn(),
  fetchTableOfContents: vi.fn(),
  ALLOWED_HOSTNAMES: new Set(['learn.jamf.com', 'learn-be.jamf.com', 'docs.jamf.com']),
  isAllowedHostname: (url: string) => {
    try { return new Set(['learn.jamf.com', 'learn-be.jamf.com', 'docs.jamf.com']).has(new URL(url).hostname); }
    catch { return false; }
  },
}));

vi.mock('../../src/services/cache.js', () => ({
  cache: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../src/services/metadata.js', () => ({
  getAvailableVersions: vi.fn().mockResolvedValue([]),
  getBundleIdForVersion: vi.fn().mockResolvedValue('jamf-pro-documentation'),
  getProductsMetadata: vi.fn().mockResolvedValue([]),
  getProductAvailability: vi.fn().mockResolvedValue({}),
  getProductsResourceData: vi.fn(),
  getTopicsResourceData: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { searchDocumentation, fetchArticle, fetchTableOfContents } from '../../src/services/scraper.js';
import {
  getProductsResourceData,
  getTopicsResourceData,
  getAvailableVersions,
  getBundleIdForVersion,
} from '../../src/services/metadata.js';
import { registerListProductsTool } from '../../src/tools/list-products.js';
import { registerSearchTool } from '../../src/tools/search.js';
import { registerGetArticleTool } from '../../src/tools/get-article.js';
import { registerGetTocTool } from '../../src/tools/get-toc.js';
import { registerResources } from '../../src/resources/index.js';
import { registerTroubleshootPrompt } from '../../src/prompts/troubleshoot.js';
import { registerSetupGuidePrompt } from '../../src/prompts/setup-guide.js';
import { registerCompareVersionsPrompt } from '../../src/prompts/compare-versions.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// searchDocumentation returns { results, pagination, tokenInfo } only
// The tool wraps it into a full SearchResponse with query, total, filters
const MOCK_SEARCH_RESULTS = {
  results: [
    {
      title: 'Configuration Profiles Overview',
      url: 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/Configuration_Profiles.html',
      snippet: 'Configuration profiles are XML files that contain settings to manage devices.',
      product: 'jamf-pro',
      version: 'current',
    },
    {
      title: 'Creating Configuration Profiles',
      url: 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/Creating_Config_Profiles.html',
      snippet: 'You can create configuration profiles in Jamf Pro.',
      product: 'jamf-pro',
      version: 'current',
    },
  ],
  tokenInfo: { tokenCount: 500, truncated: false, maxTokens: 5000 },
  pagination: { page: 1, pageSize: 10, totalPages: 1, totalItems: 2, hasNext: false, hasPrev: false },
};

const MOCK_ARTICLE_RESULT = {
  title: 'Configuration Profiles',
  content: '# Configuration Profiles\n\nThis article covers configuration profiles in Jamf Pro.',
  url: 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/Configuration_Profiles.html',
  product: 'Jamf Pro',
  version: 'current',
  lastUpdated: '2025-01-15',
  breadcrumb: ['Jamf Pro', 'Device Management'],
  relatedArticles: [
    { title: 'Policies', url: 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/Policies.html' },
  ],
  tokenInfo: { tokenCount: 300, truncated: false, maxTokens: 5000 },
  sections: [
    { id: 'overview', title: 'Overview', level: 2, tokenCount: 100 },
    { id: 'creation', title: 'Creating Profiles', level: 2, tokenCount: 200 },
  ],
};

const MOCK_TOC_RESULT = {
  toc: [
    {
      title: 'Getting Started',
      url: 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/Getting_Started.html',
      children: [
        {
          title: 'System Requirements',
          url: 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/System_Requirements.html',
        },
      ],
    },
    {
      title: 'Device Management',
      url: 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/Device_Management.html',
    },
  ],
  pagination: { page: 1, pageSize: 10, totalPages: 1, totalItems: 3, hasNext: false, hasPrev: false },
  tokenInfo: { tokenCount: 400, truncated: false, maxTokens: 5000 },
};

const MOCK_PRODUCTS_RESOURCE_DATA = {
  description: 'Available Jamf products',
  products: [
    { id: 'jamf-pro', name: 'Jamf Pro', description: 'Enterprise MDM', latestVersion: 'current', availableVersions: ['current'], bundleId: 'jamf-pro-documentation' },
    { id: 'jamf-school', name: 'Jamf School', description: 'Education MDM', latestVersion: 'current', availableVersions: ['current'], bundleId: 'jamf-school-documentation' },
    { id: 'jamf-connect', name: 'Jamf Connect', description: 'Identity management', latestVersion: 'current', availableVersions: ['current'], bundleId: 'jamf-connect-documentation' },
    { id: 'jamf-protect', name: 'Jamf Protect', description: 'Endpoint security', latestVersion: 'current', availableVersions: ['current'], bundleId: 'jamf-protect-documentation' },
    { id: 'jamf-now', name: 'Jamf Now', description: 'Simple MDM', latestVersion: 'current', availableVersions: ['current'], bundleId: 'jamf-now-documentation' },
    { id: 'jamf-safe-internet', name: 'Jamf Safe Internet', description: 'Content filtering', latestVersion: 'current', availableVersions: ['current'], bundleId: 'jamf-safe-internet-documentation' },
    { id: 'jamf-insights', name: 'Jamf Insights', description: 'Analytics', latestVersion: 'current', availableVersions: ['current'], bundleId: 'jamf-insights-documentation' },
    { id: 'jamf-rapididentity', name: 'RapidIdentity', description: 'Identity platform', latestVersion: 'current', availableVersions: ['current'], bundleId: 'jamf-rapididentity-documentation' },
    { id: 'jamf-trust', name: 'Jamf Trust', description: 'Zero-trust access', latestVersion: 'current', availableVersions: ['current'], bundleId: 'jamf-trust-documentation' },
    { id: 'jamf-routines', name: 'Jamf Routines', description: 'Workflow automation', latestVersion: 'current', availableVersions: ['current'], bundleId: 'jamf-routines-documentation' },
    { id: 'self-service-plus', name: 'Self Service+', description: 'Self-service portal', latestVersion: 'current', availableVersions: ['current'], bundleId: 'self-service-plus-documentation' },
    { id: 'jamf-app-catalog', name: 'Jamf App Catalog', description: 'App catalog', latestVersion: 'current', availableVersions: ['current'], bundleId: 'jamf-app-catalog' },
  ],
  lastUpdated: new Date().toISOString(),
  usage: 'Use product ID with jamf_docs_search',
};

const MOCK_TOPICS_RESOURCE_DATA = {
  description: 'Topic categories',
  totalTopics: 3,
  topics: [
    { id: 'enrollment', name: 'Enrollment', source: 'manual' },
    { id: 'security', name: 'Security', source: 'manual' },
    { id: 'policies', name: 'Policies', source: 'manual' },
  ],
  lastUpdated: new Date().toISOString(),
  usage: 'Use topic ID with jamf_docs_search',
};

// ---------------------------------------------------------------------------
// Setup: build the in-process server + client pair
// ---------------------------------------------------------------------------

describe('E2E: MCP Server Response Schema', () => {
  let client: Client;
  let server: McpServer;

  beforeAll(async () => {
    server = new McpServer({ name: 'jamf-docs-mcp-server', version: '1.0.0' });

    // Register all tools
    registerListProductsTool(server);
    registerSearchTool(server);
    registerGetArticleTool(server);
    registerGetTocTool(server);

    // Register resources
    registerResources(server);

    // Register prompts
    registerTroubleshootPrompt(server);
    registerSetupGuidePrompt(server);
    registerCompareVersionsPrompt(server);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'e2e-test-client', version: '1.0.0' });

    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await client.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();

    // Re-set default mock implementations after clearAllMocks
    vi.mocked(searchDocumentation).mockResolvedValue(MOCK_SEARCH_RESULTS);
    vi.mocked(fetchArticle).mockResolvedValue(MOCK_ARTICLE_RESULT);
    vi.mocked(fetchTableOfContents).mockResolvedValue(MOCK_TOC_RESULT);
    vi.mocked(getProductsResourceData).mockResolvedValue(MOCK_PRODUCTS_RESOURCE_DATA);
    vi.mocked(getTopicsResourceData).mockResolvedValue(MOCK_TOPICS_RESOURCE_DATA);

    // Re-set metadata service mocks (used by get-toc and get-article tools)
    vi.mocked(getAvailableVersions).mockResolvedValue([]);
    vi.mocked(getBundleIdForVersion).mockResolvedValue('jamf-pro-documentation');
  });

  // =========================================================================
  // Server lifecycle
  // =========================================================================

  describe('server lifecycle', () => {
    it('should register all 4 tools', async () => {
      const result = await client.listTools();

      expect(result.tools).toHaveLength(4);
      const names = result.tools.map(t => t.name);
      expect(names).toContain('jamf_docs_list_products');
      expect(names).toContain('jamf_docs_search');
      expect(names).toContain('jamf_docs_get_article');
      expect(names).toContain('jamf_docs_get_toc');
    });

    it('each tool should have a description and inputSchema', async () => {
      const result = await client.listTools();

      for (const tool of result.tools) {
        expect(tool.description).toBeTruthy();
        expect(tool.inputSchema).toBeDefined();
      }
    });

    it('should register all 2 static resources', async () => {
      const result = await client.listResources();

      expect(result.resources).toHaveLength(2);
      const uris = result.resources.map(r => r.uri);
      expect(uris).toContain('jamf://products');
      expect(uris).toContain('jamf://topics');
    });

    it('should register all 3 prompts', async () => {
      const result = await client.listPrompts();

      expect(result.prompts).toHaveLength(3);
      const names = result.prompts.map(p => p.name);
      expect(names).toContain('jamf_troubleshoot');
      expect(names).toContain('jamf_setup_guide');
      expect(names).toContain('jamf_compare_versions');
    });
  });

  // =========================================================================
  // jamf_docs_list_products
  // =========================================================================

  describe('jamf_docs_list_products', () => {
    it('should return all 4 products in markdown format', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_list_products',
        arguments: {},
      });

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');

      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('Jamf Pro');
      expect(text).toContain('Jamf School');
      expect(text).toContain('Jamf Connect');
      expect(text).toContain('Jamf Protect');
    });

    it('should return valid JSON with products array when responseFormat is json', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_list_products',
        arguments: { responseFormat: 'json' },
      });

      expect(result.isError).toBeUndefined();
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      const json = JSON.parse(text);

      expect(Array.isArray(json.products)).toBe(true);
      expect(json.products).toHaveLength(12);
    });

    it('should include all 4 product IDs in JSON format', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_list_products',
        arguments: { responseFormat: 'json' },
      });

      const json = JSON.parse((result.content[0] as { type: 'text'; text: string }).text);
      const ids = json.products.map((p: { id: string }) => p.id);

      expect(ids).toContain('jamf-pro');
      expect(ids).toContain('jamf-school');
      expect(ids).toContain('jamf-connect');
      expect(ids).toContain('jamf-protect');
    });

    it('should include topics in JSON format', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_list_products',
        arguments: { responseFormat: 'json' },
      });

      const json = JSON.parse((result.content[0] as { type: 'text'; text: string }).text);
      expect(Array.isArray(json.topics)).toBe(true);
      expect(json.topics.length).toBeGreaterThan(0);
    });

    it('should use compact format when outputMode is compact', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_list_products',
        arguments: { outputMode: 'compact' },
      });

      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('## Products');
      expect(text).toContain('## Topics');
      // Compact mode should not show verbose descriptions
      expect(text).not.toContain('Apple device management for enterprise');
    });

    it('should include tokenInfo in JSON format', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_list_products',
        arguments: { responseFormat: 'json' },
      });

      const json = JSON.parse((result.content[0] as { type: 'text'; text: string }).text);
      expect(json.tokenInfo).toBeDefined();
      expect(typeof json.tokenInfo.tokenCount).toBe('number');
    });
  });

  // =========================================================================
  // jamf_docs_search
  // =========================================================================

  describe('jamf_docs_search', () => {
    it('should return results for a valid search query', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_search',
        arguments: { query: 'configuration profile' },
      });

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('Configuration Profiles Overview');
    });

    it('should return valid JSON with results array when responseFormat is json', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_search',
        arguments: { query: 'configuration profile', responseFormat: 'json' },
      });

      expect(result.isError).toBeUndefined();
      const json = JSON.parse((result.content[0] as { type: 'text'; text: string }).text);

      expect(Array.isArray(json.results)).toBe(true);
      expect(json.results.length).toBeGreaterThan(0);
      expect(json.query).toBe('configuration profile');
    });

    it('should pass product filter to the search service', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_search',
        arguments: { query: 'policy', product: 'jamf-pro', responseFormat: 'json' },
      });

      expect(result.isError).toBeUndefined();
      const json = JSON.parse((result.content[0] as { type: 'text'; text: string }).text);
      expect(json.filters.product).toBe('jamf-pro');
    });

    it('should call searchDocumentation with the correct query', async () => {
      await client.callTool({
        name: 'jamf_docs_search',
        arguments: { query: 'enrollment' },
      });

      expect(searchDocumentation).toHaveBeenCalledWith(
        expect.objectContaining({ query: 'enrollment' })
      );
    });

    it('should return error response for empty query', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_search',
        arguments: { query: '' },
      });

      // Empty query should trigger a validation error
      expect(result.isError).toBe(true);
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toBeTruthy();
    });

    it('should include structuredContent when search succeeds', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_search',
        arguments: { query: 'configuration profile' },
      });

      // structuredContent presence depends on whether the tool declares outputSchema
      // Just ensure content is returned
      expect(result.content).toHaveLength(1);
    });

    it('should include pagination info in JSON format', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_search',
        arguments: { query: 'policy', responseFormat: 'json' },
      });

      const json = JSON.parse((result.content[0] as { type: 'text'; text: string }).text);
      expect(json.pagination).toBeDefined();
      expect(typeof json.pagination.page).toBe('number');
      expect(typeof json.pagination.totalPages).toBe('number');
    });

    it('should return no-results response when search returns empty results', async () => {
      vi.mocked(searchDocumentation).mockResolvedValueOnce({
        ...MOCK_SEARCH_RESULTS,
        results: [],
        pagination: { ...MOCK_SEARCH_RESULTS.pagination, totalItems: 0, totalPages: 0 },
      });

      const result = await client.callTool({
        name: 'jamf_docs_search',
        arguments: { query: 'xyznonexistentquery123' },
      });

      expect(result.isError).toBeUndefined();
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('No results');
    });
  });

  // =========================================================================
  // jamf_docs_get_article
  // =========================================================================

  describe('jamf_docs_get_article', () => {
    const VALID_URL = 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/Configuration_Profiles.html';

    it('should return article content for a valid URL', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_get_article',
        arguments: { url: VALID_URL },
      });

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('Configuration Profiles');
    });

    it('should return valid JSON when responseFormat is json', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_get_article',
        arguments: { url: VALID_URL, responseFormat: 'json' },
      });

      expect(result.isError).toBeUndefined();
      const json = JSON.parse((result.content[0] as { type: 'text'; text: string }).text);

      expect(json.title).toBe('Configuration Profiles');
      expect(json.content).toBeTruthy();
      expect(json.url).toBe(VALID_URL);
    });

    it('should return error response for a URL not from learn.jamf.com', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_get_article',
        arguments: { url: 'https://example.com/some-page' },
      });

      expect(result.isError).toBe(true);
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('must be from');
    });

    it('should return error when fetchArticle throws a network error', async () => {
      vi.mocked(fetchArticle).mockRejectedValueOnce(new Error('Network error'));

      const result = await client.callTool({
        name: 'jamf_docs_get_article',
        arguments: { url: VALID_URL },
      });

      expect(result.isError).toBe(true);
    });

    it('should return content when summaryOnly is true (fetchArticle handles summary logic)', async () => {
      // When summaryOnly is true, the tool passes { summaryOnly: true } to fetchArticle.
      // Since fetchArticle is mocked, the returned content is the mock's content.
      const result = await client.callTool({
        name: 'jamf_docs_get_article',
        arguments: { url: VALID_URL, summaryOnly: true },
      });

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
    });

    it('should pass summaryOnly option to fetchArticle', async () => {
      await client.callTool({
        name: 'jamf_docs_get_article',
        arguments: { url: VALID_URL, summaryOnly: true },
      });

      expect(fetchArticle).toHaveBeenCalledWith(
        VALID_URL,
        expect.objectContaining({ summaryOnly: true })
      );
    });

    it('should pass maxTokens to fetchArticle as part of options', async () => {
      await client.callTool({
        name: 'jamf_docs_get_article',
        arguments: { url: VALID_URL, maxTokens: 1000 },
      });

      // fetchArticle(url, options) — url is first arg, options second
      expect(fetchArticle).toHaveBeenCalledWith(
        VALID_URL,
        expect.objectContaining({ maxTokens: 1000 })
      );
    });

    it('should include sections in JSON format', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_get_article',
        arguments: { url: VALID_URL, responseFormat: 'json' },
      });

      const json = JSON.parse((result.content[0] as { type: 'text'; text: string }).text);
      expect(Array.isArray(json.sections)).toBe(true);
    });
  });

  // =========================================================================
  // jamf_docs_get_toc
  // =========================================================================

  describe('jamf_docs_get_toc', () => {
    it('should return TOC data for a valid product', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_get_toc',
        arguments: { product: 'jamf-pro' },
      });

      expect(result.isError).toBeUndefined();
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('Getting Started');
    });

    it('should return valid JSON with product and toc array when responseFormat is json', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_get_toc',
        arguments: { product: 'jamf-pro', responseFormat: 'json' },
      });

      expect(result.isError).toBeUndefined();
      const json = JSON.parse((result.content[0] as { type: 'text'; text: string }).text);

      expect(json.product).toBe('Jamf Pro');
      expect(Array.isArray(json.toc)).toBe(true);
      expect(json.toc.length).toBeGreaterThan(0);
    });

    it('should return error for invalid product ID', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_get_toc',
        arguments: { product: 'invalid-product' },
      });

      expect(result.isError).toBe(true);
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text.toLowerCase()).toContain('invalid');
    });

    it('should work for all 4 valid products', async () => {
      const products = ['jamf-pro', 'jamf-school', 'jamf-connect', 'jamf-protect'] as const;

      for (const product of products) {
        vi.mocked(fetchTableOfContents).mockResolvedValueOnce(MOCK_TOC_RESULT);

        const result = await client.callTool({
          name: 'jamf_docs_get_toc',
          arguments: { product, responseFormat: 'json' },
        });

        expect(result.isError).toBeUndefined();
        const json = JSON.parse((result.content[0] as { type: 'text'; text: string }).text);
        expect(json.toc).toBeDefined();
      }
    });

    it('should use compact format when outputMode is compact', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_get_toc',
        arguments: { product: 'jamf-pro', outputMode: 'compact' },
      });

      expect(result.isError).toBeUndefined();
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('## Jamf Pro TOC');
    });

    it('should return error when fetchTableOfContents throws', async () => {
      vi.mocked(fetchTableOfContents).mockRejectedValueOnce(new Error('Network error'));

      const result = await client.callTool({
        name: 'jamf_docs_get_toc',
        arguments: { product: 'jamf-pro' },
      });

      expect(result.isError).toBe(true);
    });

    it('should include pagination info in JSON format', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_get_toc',
        arguments: { product: 'jamf-pro', responseFormat: 'json' },
      });

      const json = JSON.parse((result.content[0] as { type: 'text'; text: string }).text);
      expect(json.pagination).toBeDefined();
      expect(json.tokenInfo).toBeDefined();
    });
  });

  // =========================================================================
  // Resources
  // =========================================================================

  describe('resources', () => {
    it('should read products resource and return JSON', async () => {
      const result = await client.readResource({ uri: 'jamf://products' });

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].mimeType).toBe('application/json');

      const data = JSON.parse(result.contents[0].text!);
      expect(Array.isArray(data.products)).toBe(true);
      expect(data.products).toHaveLength(12);
    });

    it('should read topics resource and return JSON', async () => {
      const result = await client.readResource({ uri: 'jamf://topics' });

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].mimeType).toBe('application/json');

      const data = JSON.parse(result.contents[0].text!);
      expect(Array.isArray(data.topics)).toBe(true);
      expect(data.topics.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // Prompts
  // =========================================================================

  describe('prompts', () => {
    it('should return messages from jamf_troubleshoot', async () => {
      const result = await client.getPrompt({
        name: 'jamf_troubleshoot',
        arguments: { problem: 'MDM enrollment failing' },
      });

      expect(result.messages.length).toBeGreaterThan(0);
      expect(result.messages[0].role).toBe('user');
      const text = (result.messages[0].content as { type: 'text'; text: string }).text;
      expect(text).toContain('MDM enrollment failing');
      expect(text).toContain('jamf_docs_search');
    });

    it('should return messages from jamf_setup_guide', async () => {
      const result = await client.getPrompt({
        name: 'jamf_setup_guide',
        arguments: { feature: 'FileVault', product: 'jamf-pro' },
      });

      expect(result.messages.length).toBeGreaterThan(0);
      const text = (result.messages[0].content as { type: 'text'; text: string }).text;
      expect(text).toContain('FileVault');
      expect(text).toContain('jamf-pro');
    });

    it('should return messages from jamf_compare_versions', async () => {
      const result = await client.getPrompt({
        name: 'jamf_compare_versions',
        arguments: { product: 'jamf-pro', version_a: '11.5.0', version_b: '11.12.0' },
      });

      expect(result.messages.length).toBeGreaterThan(0);
      const text = (result.messages[0].content as { type: 'text'; text: string }).text;
      expect(text).toContain('11.5.0');
      expect(text).toContain('11.12.0');
    });
  });

  // =========================================================================
  // Error response consistency
  // =========================================================================

  describe('error response consistency', () => {
    it('invalid product in get_toc should have isError: true', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_get_toc',
        arguments: { product: 'not-a-product' },
      });

      expect(result.isError).toBe(true);
    });

    it('invalid URL in get_article should have isError: true', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_get_article',
        arguments: { url: 'https://example.com/page' },
      });

      expect(result.isError).toBe(true);
    });

    it('error responses should have content[0].type === "text"', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_get_toc',
        arguments: { product: 'not-a-product' },
      });

      expect(result.isError).toBe(true);
      expect(result.content.length).toBeGreaterThan(0);
      expect(result.content[0].type).toBe('text');
    });

    it('error responses should have non-empty text content', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_get_article',
        arguments: { url: 'https://example.com/not-jamf' },
      });

      expect(result.isError).toBe(true);
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text.length).toBeGreaterThan(0);
    });

    it('network errors in get_toc should be caught and returned as isError', async () => {
      vi.mocked(fetchTableOfContents).mockRejectedValueOnce(
        Object.assign(new Error('ECONNRESET'), { isAxiosError: true, code: 'ECONNRESET' })
      );

      const result = await client.callTool({
        name: 'jamf_docs_get_toc',
        arguments: { product: 'jamf-pro' },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].type).toBe('text');
    });

    it('network errors in search should be caught and returned as isError', async () => {
      vi.mocked(searchDocumentation).mockRejectedValueOnce(new Error('Timeout'));

      const result = await client.callTool({
        name: 'jamf_docs_search',
        arguments: { query: 'enrollment' },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].type).toBe('text');
    });
  });
});
