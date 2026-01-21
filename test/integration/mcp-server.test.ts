/**
 * Integration tests for Jamf Docs MCP Server
 * Uses the official MCP Client SDK to test the server end-to-end
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawn, type ChildProcess } from 'child_process';
import path from 'path';

describe('Jamf Docs MCP Server', () => {
  let client: Client;
  let transport: StdioClientTransport;

  beforeAll(async () => {
    const serverPath = path.resolve(process.cwd(), 'dist/index.js');

    transport = new StdioClientTransport({
      command: 'node',
      args: [serverPath]
    });

    client = new Client({
      name: 'test-client',
      version: '1.0.0'
    });

    await client.connect(transport);
  });

  afterAll(async () => {
    await client.close();
  });

  describe('tools/list', () => {
    it('should list all 4 tools', async () => {
      const result = await client.listTools();

      expect(result.tools).toHaveLength(4);

      const toolNames = result.tools.map(t => t.name);
      expect(toolNames).toContain('jamf_docs_list_products');
      expect(toolNames).toContain('jamf_docs_search');
      expect(toolNames).toContain('jamf_docs_get_article');
      expect(toolNames).toContain('jamf_docs_get_toc');
    });

    it('should have proper tool descriptions', async () => {
      const result = await client.listTools();

      for (const tool of result.tools) {
        expect(tool.description).toBeDefined();
        expect(tool.description!.length).toBeGreaterThan(50);
        expect(tool.inputSchema).toBeDefined();
      }
    });
  });

  describe('jamf_docs_list_products', () => {
    it('should return products in markdown format', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_list_products',
        arguments: {}
      });

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');

      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('Jamf Pro');
      expect(text).toContain('Jamf School');
      expect(text).toContain('Jamf Connect');
      expect(text).toContain('Jamf Protect');
    });

    it('should return products in JSON format', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_list_products',
        arguments: { responseFormat: 'json' }
      });

      const text = (result.content[0] as { type: 'text'; text: string }).text;
      const json = JSON.parse(text);

      expect(json.products).toBeDefined();
      expect(json.products.length).toBe(4);
      expect(json.topics).toBeDefined();
      expect(json.topics.length).toBeGreaterThan(30);
      expect(json.tokenInfo).toBeDefined();
      expect(json.tokenInfo.tokenCount).toBeGreaterThan(0);
    });

    it('should include topics for filtering', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_list_products',
        arguments: { responseFormat: 'json' }
      });

      const json = JSON.parse((result.content[0] as { type: 'text'; text: string }).text);

      const topicIds = json.topics.map((t: { id: string }) => t.id);
      expect(topicIds).toContain('enrollment');
      expect(topicIds).toContain('policies');
      expect(topicIds).toContain('security');
      expect(topicIds).toContain('filevault');
    });
  });

  describe('jamf_docs_search', () => {
    it('should search and return results', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_search',
        arguments: {
          query: 'configuration profile',
          responseFormat: 'json'
        }
      });

      const json = JSON.parse((result.content[0] as { type: 'text'; text: string }).text);

      expect(json.results).toBeDefined();
      expect(json.results.length).toBeGreaterThan(0);
      expect(json.tokenInfo).toBeDefined();
      expect(json.pagination).toBeDefined();
    });

    it('should filter by product', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_search',
        arguments: {
          query: 'enrollment',
          product: 'jamf-pro',
          responseFormat: 'json'
        }
      });

      const json = JSON.parse((result.content[0] as { type: 'text'; text: string }).text);

      expect(json.filters.product).toBe('jamf-pro');
      expect(json.results.length).toBeGreaterThan(0);
    });

    it('should filter by topic', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_search',
        arguments: {
          query: 'disk encryption',
          topic: 'filevault',
          responseFormat: 'json'
        }
      });

      const json = JSON.parse((result.content[0] as { type: 'text'; text: string }).text);

      expect(json.filters.topic).toBe('filevault');
    });

    it('should support pagination', async () => {
      const page1 = await client.callTool({
        name: 'jamf_docs_search',
        arguments: {
          query: 'policy',
          page: 1,
          limit: 5,
          responseFormat: 'json'
        }
      });

      const page2 = await client.callTool({
        name: 'jamf_docs_search',
        arguments: {
          query: 'policy',
          page: 2,
          limit: 5,
          responseFormat: 'json'
        }
      });

      const json1 = JSON.parse((page1.content[0] as { type: 'text'; text: string }).text);
      const json2 = JSON.parse((page2.content[0] as { type: 'text'; text: string }).text);

      expect(json1.pagination.page).toBe(1);
      expect(json2.pagination.page).toBe(2);

      // Results should be different
      if (json1.results.length > 0 && json2.results.length > 0) {
        expect(json1.results[0].url).not.toBe(json2.results[0].url);
      }
    });

    it('should respect maxTokens limit', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_search',
        arguments: {
          query: 'api',
          maxTokens: 1000,
          responseFormat: 'json'
        }
      });

      const json = JSON.parse((result.content[0] as { type: 'text'; text: string }).text);

      expect(json.tokenInfo.maxTokens).toBe(1000);
    });

    it('should return markdown format by default', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_search',
        arguments: { query: 'script' }
      });

      const text = (result.content[0] as { type: 'text'; text: string }).text;

      expect(text).toContain('Search Results');
      expect(text).not.toMatch(/^\{/); // Not JSON
    });
  });

  describe('jamf_docs_get_article', () => {
    // Get a valid URL from search first
    let validArticleUrl: string;

    beforeAll(async () => {
      const searchResult = await client.callTool({
        name: 'jamf_docs_search',
        arguments: {
          query: 'policies',
          limit: 1,
          responseFormat: 'json'
        }
      });
      const searchJson = JSON.parse((searchResult.content[0] as { type: 'text'; text: string }).text);
      validArticleUrl = searchJson.results[0]?.url || 'https://learn.jamf.com/bundle/jamf-pro-documentation-current/page/Policies.html';
    });

    it('should fetch article content', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_get_article',
        arguments: {
          url: validArticleUrl,
          responseFormat: 'json'
        }
      });

      const json = JSON.parse((result.content[0] as { type: 'text'; text: string }).text);

      expect(json.title).toBeDefined();
      expect(json.content).toBeDefined();
      expect(json.content.length).toBeGreaterThan(100);
      expect(json.tokenInfo).toBeDefined();
    });

    it('should extract sections from article', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_get_article',
        arguments: {
          url: validArticleUrl,
          responseFormat: 'json'
        }
      });

      const json = JSON.parse((result.content[0] as { type: 'text'; text: string }).text);

      expect(json.sections).toBeDefined();
      expect(Array.isArray(json.sections)).toBe(true);
    });

    it('should respect maxTokens limit', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_get_article',
        arguments: {
          url: validArticleUrl,
          maxTokens: 500,
          responseFormat: 'json'
        }
      });

      const json = JSON.parse((result.content[0] as { type: 'text'; text: string }).text);

      expect(json.tokenInfo.maxTokens).toBe(500);
    });

    it('should reject invalid URLs', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_get_article',
        arguments: {
          url: 'https://example.com/invalid'
        }
      });

      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('must be from');
    });

    it('should return markdown format by default', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_get_article',
        arguments: {
          url: validArticleUrl
        }
      });

      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).not.toMatch(/^\{/); // Not JSON
    });
  });

  describe('jamf_docs_get_toc', () => {
    it('should fetch table of contents for jamf-pro', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_get_toc',
        arguments: {
          product: 'jamf-pro',
          responseFormat: 'json'
        }
      });

      const json = JSON.parse((result.content[0] as { type: 'text'; text: string }).text);

      expect(json.product).toContain('Jamf Pro');
      expect(json.toc).toBeDefined();
      expect(json.toc.length).toBeGreaterThan(0);
      expect(json.tokenInfo).toBeDefined();
      expect(json.pagination).toBeDefined();
    });

    it('should fetch table of contents for jamf-connect', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_get_toc',
        arguments: {
          product: 'jamf-connect',
          responseFormat: 'json'
        }
      });

      const json = JSON.parse((result.content[0] as { type: 'text'; text: string }).text);

      expect(json.product).toContain('Jamf Connect');
    });

    it('should fetch table of contents for jamf-protect', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_get_toc',
        arguments: {
          product: 'jamf-protect',
          responseFormat: 'json'
        }
      });

      const json = JSON.parse((result.content[0] as { type: 'text'; text: string }).text);

      expect(json.product).toContain('Jamf Protect');
    });

    it('should support pagination', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_get_toc',
        arguments: {
          product: 'jamf-pro',
          page: 2,
          responseFormat: 'json'
        }
      });

      const json = JSON.parse((result.content[0] as { type: 'text'; text: string }).text);

      expect(json.pagination.page).toBe(2);
    });

    it('should respect maxTokens limit', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_get_toc',
        arguments: {
          product: 'jamf-pro',
          maxTokens: 1000,
          responseFormat: 'json'
        }
      });

      const json = JSON.parse((result.content[0] as { type: 'text'; text: string }).text);

      expect(json.tokenInfo.maxTokens).toBe(1000);
    });

    it('should reject invalid product', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_get_toc',
        arguments: {
          product: 'invalid-product'
        }
      });

      expect(result.isError).toBe(true);
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text.toLowerCase()).toContain('invalid');
    });

    it('should return markdown format by default', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_get_toc',
        arguments: {
          product: 'jamf-pro'
        }
      });

      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('Table of Contents');
      expect(text).not.toMatch(/^\{/); // Not JSON
    });
  });
});
