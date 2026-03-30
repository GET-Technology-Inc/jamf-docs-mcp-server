/**
 * Integration tests for search-filter-improvements change
 *
 * Tests the full flow through McpServer + Client for:
 * - Search filter fallback
 * - Section ID matching
 * - List products with hasContent
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { SearchResult, PaginationInfo, TokenInfo, FilterRelaxation, TruncatedContentInfo, ArticleSection } from '../../src/core/types.js';

// Mock services
vi.mock('../../src/core/services/scraper.js', () => ({
  searchDocumentation: vi.fn(),
  fetchArticle: vi.fn(),
  fetchTableOfContents: vi.fn(),
  ALLOWED_HOSTNAMES: new Set(['learn.jamf.com', 'learn-be.jamf.com', 'docs.jamf.com']),
  isAllowedHostname: (url: string) => {
    try { return new Set(['learn.jamf.com', 'learn-be.jamf.com', 'docs.jamf.com']).has(new URL(url).hostname); }
    catch { return false; }
  },
}));

vi.mock('../../src/core/services/cache.js', () => ({
  cache: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../src/core/services/metadata.js', () => ({
  getAvailableVersions: vi.fn().mockResolvedValue([]),
  getBundleIdForVersion: vi.fn().mockResolvedValue('jamf-pro-documentation'),
  getProductsMetadata: vi.fn().mockResolvedValue([]),
  getProductAvailability: vi.fn().mockResolvedValue({
    'jamf-pro': true,
    'jamf-school': true,
    'jamf-connect': true,
    'jamf-protect': true,
    'jamf-routines': false,
  }),
  getProductsResourceData: vi.fn(),
  getTopicsResourceData: vi.fn(),
}));

import { searchDocumentation, fetchArticle } from '../../src/core/services/scraper.js';
import { registerSearchTool } from '../../src/core/tools/search.js';
import { registerGetArticleTool } from '../../src/core/tools/get-article.js';
import { registerListProductsTool } from '../../src/core/tools/list-products.js';
import { createMockContext } from '../helpers/mock-context.js';

const ctx = createMockContext();

type TextContent = { type: 'text'; text: string };

function getText(result: { content: unknown[] }): string {
  return (result.content[0] as TextContent).text;
}

// =========================================================================
// 8.1 Search + filter fallback full flow
// =========================================================================

describe('Integration: Search filter fallback flow', () => {
  let client: Client;
  let server: McpServer;

  beforeAll(async () => {
    server = new McpServer({ name: 'test-server', version: '0.0.1' });
    registerSearchTool(server, ctx);
    const [ct, st] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test-client', version: '0.0.1' });
    await server.connect(st);
    await client.connect(ct);
  });

  afterAll(async () => {
    await client.close();
  });

  it('should return results with filterRelaxation in JSON when filters relaxed', async () => {
    const relaxation: FilterRelaxation = {
      removed: ['docType'],
      original: { docType: 'release-notes' },
      message: 'No results with all filters applied. Removed filter(s): docType. Try broader search terms or fewer filters.',
    };

    vi.mocked(searchDocumentation).mockResolvedValue({
      results: [
        { title: 'MDM Article', url: 'https://learn.jamf.com/mdm.html', snippet: 'MDM enrollment content for managed devices', product: 'Jamf Pro', version: 'current', docType: 'documentation' },
      ],
      pagination: { page: 1, pageSize: 10, totalPages: 1, totalItems: 1, hasNext: false, hasPrev: false },
      tokenInfo: { tokenCount: 50, truncated: false, maxTokens: 5000 },
      filterRelaxation: relaxation,
    });

    const result = await client.callTool({
      name: 'jamf_docs_search',
      arguments: { query: 'MDM', product: 'jamf-pro', docType: 'release-notes', responseFormat: 'json' },
    });

    const json = JSON.parse(getText(result));
    expect(json.filterRelaxation).toBeDefined();
    expect(json.filterRelaxation.removed).toContain('docType');
    expect(json.results).toHaveLength(1);
  });

  it('should append filterRelaxation note in markdown when filters relaxed', async () => {
    vi.mocked(searchDocumentation).mockResolvedValue({
      results: [
        { title: 'Article', url: 'https://learn.jamf.com/a.html', snippet: 'Content about device management and configuration', product: 'Jamf Pro', version: 'current' },
      ],
      pagination: { page: 1, pageSize: 10, totalPages: 1, totalItems: 1, hasNext: false, hasPrev: false },
      tokenInfo: { tokenCount: 30, truncated: false, maxTokens: 5000 },
      filterRelaxation: {
        removed: ['product'],
        original: { product: 'jamf-pro' },
        message: 'No results with all filters applied. Removed filter(s): product.',
      },
    });

    const result = await client.callTool({
      name: 'jamf_docs_search',
      arguments: { query: 'test', product: 'jamf-pro' },
    });

    const text = getText(result);
    expect(text).toContain('Removed filter');
  });

  it('should not include versionNote when requested version was found', async () => {
    vi.mocked(searchDocumentation).mockResolvedValue({
      results: [
        { title: 'Test', url: 'https://learn.jamf.com/t.html', snippet: 'Test content for version transparency testing', product: 'Jamf Pro', version: '11.0.0' },
      ],
      pagination: { page: 1, pageSize: 10, totalPages: 1, totalItems: 1, hasNext: false, hasPrev: false },
      tokenInfo: { tokenCount: 20, truncated: false, maxTokens: 5000 },
    });

    const result = await client.callTool({
      name: 'jamf_docs_search',
      arguments: { query: 'test', version: '11.0.0', responseFormat: 'json' },
    });

    const json = JSON.parse(getText(result));
    // versionNote is only set by scraper when version mismatch occurs; mock doesn't include it
    expect(json.versionNote).toBeUndefined();
  });

  it('should include versionNote when requested version was not available', async () => {
    vi.mocked(searchDocumentation).mockResolvedValue({
      results: [
        { title: 'Test', url: 'https://learn.jamf.com/t.html', snippet: 'Test content', product: 'Jamf Pro', version: 'current' },
      ],
      pagination: { page: 1, pageSize: 10, totalPages: 1, totalItems: 1, hasNext: false, hasPrev: false },
      tokenInfo: { tokenCount: 20, truncated: false, maxTokens: 5000 },
      versionNote: 'Version "99.0.0" was not available for some results. Showing the latest version instead.',
    });

    const result = await client.callTool({
      name: 'jamf_docs_search',
      arguments: { query: 'test', version: '99.0.0', responseFormat: 'json' },
    });

    const json = JSON.parse(getText(result));
    expect(json.versionNote).toBeDefined();
    expect(json.versionNote).toContain('not available');
  });

  it('should include truncatedContent in JSON when search results truncated', async () => {
    const truncatedInfo: TruncatedContentInfo = {
      omittedCount: 3,
      omittedItems: [
        { title: 'Omitted 1', estimatedTokens: 100 },
        { title: 'Omitted 2', estimatedTokens: 150 },
        { title: 'Omitted 3', estimatedTokens: 120 },
      ],
    };

    vi.mocked(searchDocumentation).mockResolvedValue({
      results: [
        { title: 'Included', url: 'https://learn.jamf.com/i.html', snippet: 'Included result content', product: 'Jamf Pro', version: 'current' },
      ],
      pagination: { page: 1, pageSize: 10, totalPages: 1, totalItems: 4, hasNext: true, hasPrev: false },
      tokenInfo: { tokenCount: 50, truncated: true, maxTokens: 100 },
      truncatedContent: truncatedInfo,
    });

    const result = await client.callTool({
      name: 'jamf_docs_search',
      arguments: { query: 'test', responseFormat: 'json' },
    });

    const json = JSON.parse(getText(result));
    expect(json.truncatedContent).toBeDefined();
    expect(json.truncatedContent.omittedCount).toBe(3);
  });
});

// =========================================================================
// 8.2 get_article + section ID flow
// =========================================================================

describe('Integration: get_article section ID matching', () => {
  let client: Client;
  let server: McpServer;

  beforeAll(async () => {
    server = new McpServer({ name: 'test-server', version: '0.0.1' });
    registerGetArticleTool(server, ctx);
    const [ct, st] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test-client', version: '0.0.1' });
    await server.connect(st);
    await client.connect(ct);
  });

  afterAll(async () => {
    await client.close();
  });

  it('should return article with slugified section IDs', async () => {
    const sections: ArticleSection[] = [
      { id: 'managing-configuration-profiles', title: 'Managing Configuration Profiles', level: 2, tokenCount: 200 },
      { id: 'prerequisites', title: 'Prerequisites', level: 2, tokenCount: 100 },
    ];

    vi.mocked(fetchArticle).mockResolvedValue({
      title: 'Configuration Profiles',
      content: '## Managing Configuration Profiles\nContent here\n\n## Prerequisites\nPrereq content',
      url: 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/ConfigProfiles.html',
      product: 'Jamf Pro',
      version: 'current',
      tokenInfo: { tokenCount: 300, truncated: false, maxTokens: 5000 },
      sections,
    });

    const result = await client.callTool({
      name: 'jamf_docs_get_article',
      arguments: {
        url: 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/ConfigProfiles.html',
        responseFormat: 'json',
      },
    });

    const json = JSON.parse(getText(result));
    expect(json.sections).toHaveLength(2);
    expect(json.sections[0].id).toBe('managing-configuration-profiles');
    expect(json.sections[1].id).toBe('prerequisites');
  });

  it('should return article with section parameter via slug ID', async () => {
    vi.mocked(fetchArticle).mockResolvedValue({
      title: 'Configuration Profiles',
      content: '## Prerequisites\nYou need admin access.',
      url: 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/ConfigProfiles.html',
      product: 'Jamf Pro',
      version: 'current',
      tokenInfo: { tokenCount: 20, truncated: false, maxTokens: 5000 },
      sections: [{ id: 'prerequisites', title: 'Prerequisites', level: 2, tokenCount: 20 }],
    });

    const result = await client.callTool({
      name: 'jamf_docs_get_article',
      arguments: {
        url: 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/ConfigProfiles.html',
        section: 'prerequisites',
      },
    });

    expect(result.isError).toBeUndefined();
    const text = getText(result);
    expect(text).toContain('Prerequisites');
  });
});

// =========================================================================
// 8.3 list_products with hasContent
// =========================================================================

describe('Integration: list_products with hasContent', () => {
  let client: Client;
  let server: McpServer;

  beforeAll(async () => {
    server = new McpServer({ name: 'test-server', version: '0.0.1' });
    registerListProductsTool(server, ctx);
    const [ct, st] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test-client', version: '0.0.1' });
    await server.connect(st);
    await client.connect(ct);
  });

  afterAll(async () => {
    await client.close();
  });

  it('should include hasContent field for each product in JSON', async () => {
    const result = await client.callTool({
      name: 'jamf_docs_list_products',
      arguments: { responseFormat: 'json' },
    });

    expect(result.isError).toBeUndefined();
    const json = JSON.parse(getText(result));
    expect(Array.isArray(json.products)).toBe(true);

    for (const product of json.products) {
      expect(typeof product.hasContent).toBe('boolean');
    }
  });

  it('should exclude jamf-routines (hasContent=false) from product list', async () => {
    const result = await client.callTool({
      name: 'jamf_docs_list_products',
      arguments: { responseFormat: 'json' },
    });

    const json = JSON.parse(getText(result));
    const routines = json.products.find((p: { id: string }) => p.id === 'jamf-routines');
    expect(routines).toBeUndefined();
  });

  it('should include jamf-pro (hasContent=true) in product list', async () => {
    const result = await client.callTool({
      name: 'jamf_docs_list_products',
      arguments: { responseFormat: 'json' },
    });

    const json = JSON.parse(getText(result));
    const pro = json.products.find((p: { id: string }) => p.id === 'jamf-pro');
    expect(pro).toBeDefined();
    expect(pro.hasContent).toBe(true);
  });

  it('should not show empty products in markdown output', async () => {
    const result = await client.callTool({
      name: 'jamf_docs_list_products',
      arguments: {},
    });

    const text = getText(result);
    expect(text).not.toContain('Jamf Routines');
  });

  it('should include solution-guide in docType list', async () => {
    const result = await client.callTool({
      name: 'jamf_docs_list_products',
      arguments: {},
    });

    const text = getText(result);
    expect(text).toContain('solution-guide');
  });
});
