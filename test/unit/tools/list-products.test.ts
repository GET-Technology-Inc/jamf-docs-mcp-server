/**
 * Unit tests for jamf_docs_list_products tool handler.
 *
 * This tool is synchronous and uses no external services — it formats
 * static JAMF_PRODUCTS and JAMF_TOPICS data. All formatting logic is
 * tested via an in-process McpServer + Client pair.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

const mockGetProductAvailability = vi.fn().mockResolvedValue({});

vi.mock('../../../src/core/services/metadata.js', () => ({
  getProductAvailability: (...args: unknown[]) => mockGetProductAvailability(...args),
}));

import { registerListProductsTool } from '../../../src/core/tools/list-products.js';

// ---------------------------------------------------------------------------

type TextContent = { type: 'text'; text: string };

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
    registerListProductsTool(server);

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

    it('should have exactly 4 products in JSON output', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_list_products',
        arguments: { responseFormat: 'json' },
      });

      const json = JSON.parse(getTextContent(result));
      expect(json.products).toHaveLength(12);
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

    it('should have 4 products in structuredContent regardless of format', async () => {
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

      expect((mdSc.products as unknown[]).length).toBe(12);
      expect((jsonSc.products as unknown[]).length).toBe(12);
      expect((compactSc.products as unknown[]).length).toBe(12);
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
      expect(json.products).toHaveLength(12);
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
      expect(json.products).toHaveLength(12);
    });
  });
});
