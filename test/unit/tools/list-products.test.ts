/**
 * Unit tests for jamf_docs_list_products tool handler.
 *
 * Products, topics and docTypes come from compiled-in constants; the
 * publication axis comes from the live maps registry, so the registry is
 * stubbed here — without it these tests reach learn.jamf.com for real, and
 * the tool swallows that failure by design, so the leak would show up as a
 * slow network-dependent test rather than a red one.
 *
 * All formatting logic is tested via an in-process McpServer + Client pair.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/client';
import { createMockContext, createStubMapsRegistry } from '../../helpers/mock-context.js';

const mockGetProductAvailability = vi.fn().mockResolvedValue({});

/**
 * Shaped like the live data: one family per classification slot Jamf uses,
 * one carrying no classification at all, one versioned and one single-locale.
 */
const PUBLICATIONS = [
  { id: 'technical-paper-laps', title: 'Technical Paper: LAPS for Jamf Pro',
    portal: 'Jamf Pro', app: '', utility: '', locales: ['en-US', 'ja-JP'], versions: [] },
  { id: 'jamf-pro-release-notes', title: 'Jamf Pro Release Notes 11.31.0',
    portal: 'Jamf Pro', app: '', utility: '', locales: ['en-US'], versions: ['11.31.0', '11.30.0'] },
  { id: 'composer-user-guide', title: 'Composer User Guide',
    portal: '', app: 'Composer', utility: '', locales: ['en-US'], versions: [] },
  { id: 'title-editor', title: 'Title Editor Documentation',
    portal: '', app: '', utility: 'Title Editor', locales: ['en-US'], versions: [] },
  { id: 'welcome-to-jamf', title: 'Welcome to Jamf',
    portal: '', app: '', utility: '', locales: ['en-US'], versions: [] },
];

vi.mock('../../../src/core/services/metadata.js', () => ({
  getProductAvailability: (...args: unknown[]) => mockGetProductAvailability(...args),
}));

import { registerListProductsTool } from '../../../src/core/tools/list-products.js';
import { PRODUCT_IDS } from '../../../src/core/constants/products.js';

// ---------------------------------------------------------------------------

interface TextContent { type: 'text'; text: string }

function getTextContent(result: { content: unknown[] }): string {
  const first = result.content[0] as TextContent;
  return first.text;
}

// ---------------------------------------------------------------------------

describe('jamf_docs_list_products tool', () => {
  let client: Client;
  let server: McpServer;

  beforeAll(async () => {
    server = new McpServer({ name: 'test-server', version: '0.0.1' });
    registerListProductsTool(server, createMockContext({
      mapsRegistry: createStubMapsRegistry(PUBLICATIONS),
    }));

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    client = new Client({ name: 'test-client', version: '0.0.1' });

    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await client.close();
  });

  // --- Full markdown format (default) --------------------------------------

  describe('full markdown output (default)', () => {
    it('should list all 4 Jamf products with H2 headers', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_list_products',
        arguments: {},
      });

      const text = getTextContent(result);
      expect(text).toContain('## Jamf Pro');
      expect(text).toContain('## Jamf School');
      expect(text).toContain('## Jamf Connect');
      expect(text).toContain('## Jamf Protect');
    });

    it('should include product ID, description, and current version for each product', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_list_products',
        arguments: {},
      });

      const text = getTextContent(result);
      expect(text).toContain('**ID**: `jamf-pro`');
      expect(text).toContain('**Description**:');
      expect(text).toContain('**Current Version**:');
    });

    it('should include available versions list for each product', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_list_products',
        arguments: {},
      });

      const text = getTextContent(result);
      expect(text).toContain('**Available Versions**:');
    });

    it('should include Available Topics for Filtering section', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_list_products',
        arguments: {},
      });

      const text = getTextContent(result);
      expect(text).toContain('# Available Topics for Filtering');
    });

    it('should list known topics like enrollment, security, api', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_list_products',
        arguments: {},
      });

      const text = getTextContent(result);
      expect(text).toContain('`enrollment`');
      expect(text).toContain('`security`');
      expect(text).toContain('`api`');
    });

    it('should include token count at the end', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_list_products',
        arguments: {},
      });

      const text = getTextContent(result);
      expect(text).toMatch(/\d+ tokens/);
    });

    it('should include usage hint for jamf_docs_search', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_list_products',
        arguments: {},
      });

      const text = getTextContent(result);
      expect(text).toContain('jamf_docs_search');
    });
  });

  // --- Compact mode --------------------------------------------------------

  describe('compact markdown output', () => {
    it('should use ## Products and ## Topics headers', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_list_products',
        arguments: { outputMode: 'compact' },
      });

      const text = getTextContent(result);
      expect(text).toContain('## Products');
      expect(text).toContain('## Topics');
    });

    it('should list products as inline code IDs with names', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_list_products',
        arguments: { outputMode: 'compact' },
      });

      const text = getTextContent(result);
      expect(text).toContain('`jamf-pro`: Jamf Pro');
      expect(text).toContain('`jamf-school`: Jamf School');
      expect(text).toContain('`jamf-connect`: Jamf Connect');
      expect(text).toContain('`jamf-protect`: Jamf Protect');
    });

    it('should NOT include detailed product descriptions in compact mode', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_list_products',
        arguments: { outputMode: 'compact' },
      });

      const text = getTextContent(result);
      // Product descriptions like this should not appear in compact mode
      expect(text).not.toContain('Apple device management for enterprise');
      // Available Versions detail should not appear
      expect(text).not.toContain('Available Versions');
    });

    it('should list topics as inline code IDs in compact mode', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_list_products',
        arguments: { outputMode: 'compact' },
      });

      const text = getTextContent(result);
      expect(text).toContain('`enrollment`');
      expect(text).toContain('`profiles`');
    });
  });

  // --- JSON format ----------------------------------------------------------

  describe('JSON format output', () => {
    it('should return valid JSON with products and topics arrays', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_list_products',
        arguments: { responseFormat: 'json' },
      });

      const text = getTextContent(result);
      const json = JSON.parse(text);
      expect(Array.isArray(json.products)).toBe(true);
      expect(Array.isArray(json.topics)).toBe(true);
    });

    it('should list every registered product in JSON output', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_list_products',
        arguments: { responseFormat: 'json' },
      });

      const json = JSON.parse(getTextContent(result));
      expect(json.products).toHaveLength(PRODUCT_IDS.length);
    });

    it('should include all product IDs in JSON products array', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_list_products',
        arguments: { responseFormat: 'json' },
      });

      const json = JSON.parse(getTextContent(result));
      const ids = json.products.map((p: { id: string }) => p.id);
      expect(ids).toContain('jamf-pro');
      expect(ids).toContain('jamf-school');
      expect(ids).toContain('jamf-connect');
      expect(ids).toContain('jamf-protect');
    });

    it('should include tokenInfo with tokenCount and truncated in JSON output', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_list_products',
        arguments: { responseFormat: 'json' },
      });

      const json = JSON.parse(getTextContent(result));
      expect(json.tokenInfo).toBeDefined();
      expect(typeof json.tokenInfo.tokenCount).toBe('number');
      expect(json.tokenInfo.tokenCount).toBeGreaterThan(0);
      expect(typeof json.tokenInfo.truncated).toBe('boolean');
    });

    it('should NOT double-serialize JSON (text content must be valid JSON not escaped string)', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_list_products',
        arguments: { responseFormat: 'json' },
      });

      const text = getTextContent(result);
      // Must parse successfully — double-serialized JSON would fail
      expect(() => JSON.parse(text)).not.toThrow();
      // A double-serialized string starts with a quote character
      expect(text).not.toMatch(/^"/);
    });

    it('should have non-empty topics array in JSON output', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_list_products',
        arguments: { responseFormat: 'json' },
      });

      const json = JSON.parse(getTextContent(result));
      expect(json.topics.length).toBeGreaterThan(0);
    });

    it('should include product name, description, currentVersion in each product entry', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_list_products',
        arguments: { responseFormat: 'json' },
      });

      const json = JSON.parse(getTextContent(result));
      const pro = json.products.find((p: { id: string }) => p.id === 'jamf-pro');
      expect(pro).toBeDefined();
      expect(pro.name).toBe('Jamf Pro');
      expect(pro.description).toBeDefined();
      expect(pro.currentVersion).toBeDefined();
      expect(Array.isArray(pro.availableVersions)).toBe(true);
    });

    it('should include topic id, name, and keywords in each topic entry', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_list_products',
        arguments: { responseFormat: 'json' },
      });

      const json = JSON.parse(getTextContent(result));
      const enrollment = json.topics.find((t: { id: string }) => t.id === 'enrollment');
      expect(enrollment).toBeDefined();
      expect(enrollment.name).toBeDefined();
      expect(Array.isArray(enrollment.keywords)).toBe(true);
    });
  });

  // --- Completeness checks --------------------------------------------------

  describe('product and topic completeness', () => {
    it('should include all 4 Jamf product IDs in full markdown output', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_list_products',
        arguments: {},
      });

      const text = getTextContent(result);
      expect(text).toContain('jamf-pro');
      expect(text).toContain('jamf-school');
      expect(text).toContain('jamf-connect');
      expect(text).toContain('jamf-protect');
    });

    it('should include enrollment, security, and api topics in full markdown output', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_list_products',
        arguments: {},
      });

      const text = getTextContent(result);
      expect(text).toContain('enrollment');
      expect(text).toContain('security');
      expect(text).toContain('api');
    });

    it('should include at least one topic keyword in full markdown output', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_list_products',
        arguments: {},
      });

      const text = getTextContent(result);
      // Keywords section appears in the full output
      expect(text).toContain('Keywords');
    });
  });

  // --- Token info in all formats -------------------------------------------

  describe('tokenInfo across formats', () => {
    it('should include token count in full markdown output', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_list_products',
        arguments: {},
      });

      const text = getTextContent(result);
      // Token count is rendered as "<number> tokens"
      expect(text).toMatch(/\d[\d,]* tokens/);
    });

    it('should include tokenInfo with positive tokenCount in JSON output', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_list_products',
        arguments: { responseFormat: 'json' },
      });

      const json = JSON.parse(getTextContent(result));
      expect(json.tokenInfo).toBeDefined();
      expect(json.tokenInfo.tokenCount).toBeGreaterThan(0);
    });

    it('should include tokenInfo.truncated as boolean in JSON output', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_list_products',
        arguments: { responseFormat: 'json' },
      });

      const json = JSON.parse(getTextContent(result));
      expect(typeof json.tokenInfo.truncated).toBe('boolean');
    });

    it('should include tokenInfo.maxTokens in JSON output', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_list_products',
        arguments: { responseFormat: 'json' },
      });

      const json = JSON.parse(getTextContent(result));
      expect(typeof json.tokenInfo.maxTokens).toBe('number');
      expect(json.tokenInfo.maxTokens).toBeGreaterThan(0);
    });
  });

  // --- structuredContent ---------------------------------------------------

  describe('structuredContent', () => {
    it('should always include products and topics arrays', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_list_products',
        arguments: {},
      });

      const sc = result.structuredContent as Record<string, unknown>;
      expect(sc).toBeDefined();
      expect(Array.isArray(sc.products)).toBe(true);
      expect(Array.isArray(sc.topics)).toBe(true);
    });

    it('should list every registered product in structuredContent regardless of format', async () => {
      const mdResult = await client.callTool({
        name: 'jamf_docs_list_products',
        arguments: {},
      });
      const jsonResult = await client.callTool({
        name: 'jamf_docs_list_products',
        arguments: { responseFormat: 'json' },
      });
      const compactResult = await client.callTool({
        name: 'jamf_docs_list_products',
        arguments: { outputMode: 'compact' },
      });

      const mdSc = mdResult.structuredContent as Record<string, unknown>;
      const jsonSc = jsonResult.structuredContent as Record<string, unknown>;
      const compactSc = compactResult.structuredContent as Record<string, unknown>;

      expect((mdSc.products as unknown[]).length).toBe(PRODUCT_IDS.length);
      expect((jsonSc.products as unknown[]).length).toBe(PRODUCT_IDS.length);
      expect((compactSc.products as unknown[]).length).toBe(PRODUCT_IDS.length);
    });

    it('should have non-empty topics in structuredContent', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_list_products',
        arguments: {},
      });

      const sc = result.structuredContent as Record<string, unknown>;
      expect((sc.topics as unknown[]).length).toBeGreaterThan(0);
    });
  });

  // --- maxTokens behaviour (regression test for #9) -------------------------

  describe('maxTokens behaviour', () => {
    it('should truncate markdown output when maxTokens is small', async () => {
      // First, get the full output to know its size
      const fullResult = await client.callTool({
        name: 'jamf_docs_list_products',
        arguments: { maxTokens: 20000 },
      });
      const fullText = getTextContent(fullResult);

      // Now request with the minimum allowed token limit
      const result = await client.callTool({
        name: 'jamf_docs_list_products',
        arguments: { maxTokens: 100 },
      });

      const text = getTextContent(result);
      // Output must contain truncation indicator
      expect(text).toContain('Content truncated');
      // Truncated output must be shorter than the full output
      expect(text.length).toBeLessThan(fullText.length);
    });

    it('should reflect maxTokens in JSON tokenInfo when maxTokens is small', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_list_products',
        arguments: { responseFormat: 'json', maxTokens: 100 },
      });

      const json = JSON.parse(getTextContent(result));
      expect(json.tokenInfo).toBeDefined();
      // maxTokens should be forwarded into tokenInfo so callers know the budget
      expect(json.tokenInfo.maxTokens).toBe(100);
      // The full product list exceeds 100 tokens
      expect(json.tokenInfo.tokenCount).toBeGreaterThan(100);
    });

    it('should set truncated to false in JSON when maxTokens is large enough', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_list_products',
        arguments: { responseFormat: 'json', maxTokens: 20000 },
      });

      const json = JSON.parse(getTextContent(result));
      expect(json.tokenInfo.maxTokens).toBe(20000);
      expect(json.tokenInfo.truncated).toBe(false);
    });

    it('should return full markdown output when maxTokens is large enough', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_list_products',
        arguments: { maxTokens: 20000 },
      });

      const text = getTextContent(result);
      // With generous maxTokens the output should contain all products
      expect(text).toContain('## Jamf Pro');
      expect(text).toContain('## Jamf Protect');
      expect(text).toContain('# Available Topics for Filtering');
    });
  });

  // --- Product availability filtering ---------------------------------------

  describe('product availability filtering', () => {
    it('should include products with empty TOC but mark hasContent: false', async () => {
      mockGetProductAvailability.mockResolvedValueOnce({
        'jamf-pro': true,
        'jamf-school': true,
        'jamf-connect': true,
        'jamf-protect': true,
        'jamf-routines': false,
        'jamf-now': true,
        'jamf-safe-internet': true,
        'jamf-insights': true,
        'jamf-rapididentity': true,
        'jamf-trust': true,
        'self-service-plus': true,
        'jamf-app-catalog': true,
      });

      const result = await client.callTool({
        name: 'jamf_docs_list_products',
        arguments: { responseFormat: 'json' },
      });

      const json = JSON.parse(getTextContent(result));
      expect(json.products).toHaveLength(PRODUCT_IDS.length);
      const routines = json.products.find((p: { id: string }) => p.id === 'jamf-routines');
      expect(routines).toBeDefined();
      expect(routines.hasContent).toBe(false);
      const pro = json.products.find((p: { id: string }) => p.id === 'jamf-pro');
      expect(pro.hasContent).toBe(true);
    });

    it('should show all products when all have content', async () => {
      mockGetProductAvailability.mockResolvedValueOnce({
        'jamf-pro': true,
        'jamf-school': true,
        'jamf-connect': true,
        'jamf-protect': true,
        'jamf-routines': true,
        'jamf-now': true,
        'jamf-safe-internet': true,
        'jamf-insights': true,
        'jamf-rapididentity': true,
        'jamf-trust': true,
        'self-service-plus': true,
        'jamf-app-catalog': true,
      });

      const result = await client.callTool({
        name: 'jamf_docs_list_products',
        arguments: { responseFormat: 'json' },
      });

      const json = JSON.parse(getTextContent(result));
      expect(json.products).toHaveLength(PRODUCT_IDS.length);
    });
  });

// --- Publication axis -------------------------------------------------------

describe('publications section', () => {
  it('should list every publication the registry reports', async () => {
    const result = await client.callTool({
      name: 'jamf_docs_list_products',
      arguments: { responseFormat: 'json' },
    });
    const sc = result.structuredContent as { publications?: unknown[] };
    expect(sc.publications).toHaveLength(PUBLICATIONS.length);
  });

  it('should keep publications out of products so the search filter stays meaningful', async () => {
    // #239's acceptance condition: `product` in jamf_docs_search takes the
    // twelve product IDs and none of these, so merging the lists would make
    // list_products describe a filter that does not exist.
    const result = await client.callTool({
      name: 'jamf_docs_list_products',
      arguments: { responseFormat: 'json' },
    });
    const sc = result.structuredContent as { products: { id: string }[] };
    expect(sc.products).toHaveLength(PRODUCT_IDS.length);
    expect(sc.products.map(p => p.id)).not.toContain('technical-paper-laps');
  });

  it('should group publications the way Jamf classifies them', async () => {
    const text = getTextContent(await client.callTool({ name: 'jamf_docs_list_products' }));

    // portal, app and utility are three slots of one taxonomy, so they render
    // as sibling groups rather than three separate lists.
    expect(text).toContain('## Jamf Pro');
    expect(text).toContain('## Composer');
    expect(text).toContain('## Title Editor');
    // A family Jamf files under none of the three still has to be reachable.
    expect(text).toContain('## Other');
    expect(text).toContain('welcome-to-jamf');
  });

  it('should mark a versioned family and a single-locale family', async () => {
    const text = getTextContent(await client.callTool({ name: 'jamf_docs_list_products' }));

    expect(text).toContain('2 versions, latest 11.31.0');
    expect(text).toContain('en-US only');
  });

  it('should still answer when the maps registry cannot', async () => {
    // Products and topics are compiled in; losing the newest section must not
    // cost a caller the list they actually asked for.
    const brokenServer = new McpServer({ name: 'test-server', version: '0.0.1' });
    registerListProductsTool(brokenServer, createMockContext({
      mapsRegistry: {
        listPublications: () => { throw new Error('maps endpoint down'); },
      } as never,
    }));
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const brokenClient = new Client({ name: 'test-client', version: '0.0.1' });
    await brokenServer.connect(st);
    await brokenClient.connect(ct);

    const result = await brokenClient.callTool({
      name: 'jamf_docs_list_products',
      arguments: { responseFormat: 'json' },
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { products: unknown[]; publications?: unknown[] };
    expect(sc.products).toHaveLength(PRODUCT_IDS.length);
    expect(sc.publications).toBeUndefined();
    await brokenClient.close();
  });
});
});
