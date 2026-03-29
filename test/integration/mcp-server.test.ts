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

  describe('server instructions', () => {
    it('should include non-empty instructions in initialize response', () => {
      const instructions = client.getInstructions();
      expect(instructions).toBeDefined();
      expect(instructions!.length).toBeGreaterThan(0);
    });

    it('should have instructions under 2000 characters', () => {
      const instructions = client.getInstructions();
      expect(instructions!.length).toBeLessThan(2000);
    });

    it('should mention all four guidance topics', () => {
      const instructions = client.getInstructions()!;
      expect(instructions).toContain('jamf_docs_search');
      expect(instructions).toContain('jamf_docs_get_article');
      expect(instructions).toMatch(/compact/i);
      expect(instructions).toMatch(/full/i);
      expect(instructions).toContain('maxTokens');
      expect(instructions).toContain('jamf-pro');
    });
  });

  describe('server icon', () => {
    it('should include icon in server metadata', () => {
      const serverVersion = client.getServerVersion();
      expect(serverVersion).toBeDefined();
      expect((serverVersion as Record<string, unknown>).icons).toBeDefined();
    });

    it('should have icon with data:image/png;base64 format', () => {
      const serverVersion = client.getServerVersion() as Record<string, unknown>;
      const icons = serverVersion.icons as Array<{ src: string }>;
      expect(icons.length).toBeGreaterThan(0);
      expect(icons[0].src).toMatch(/^data:image\/png;base64,/);
    });

    it('should have icon data URI under 10240 characters', () => {
      const serverVersion = client.getServerVersion() as Record<string, unknown>;
      const icons = serverVersion.icons as Array<{ src: string }>;
      expect(icons[0].src.length).toBeLessThan(10240);
    });
  });

  describe('structured output', () => {
    it('should declare outputSchema on all tools', async () => {
      const result = await client.listTools();
      for (const tool of result.tools) {
        expect(tool.outputSchema).toBeDefined();
        expect(tool.outputSchema!.type).toBe('object');
      }
    });

    it('should return structuredContent from list_products', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_list_products',
        arguments: {}
      });
      expect(result.content).toBeDefined();
      expect(result.structuredContent).toBeDefined();
      const sc = result.structuredContent as Record<string, unknown>;
      expect(sc.products).toBeDefined();
      expect(sc.topics).toBeDefined();
    });

    it('should return structuredContent from search', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_search',
        arguments: { query: 'configuration profile' }
      });
      expect(result.content).toBeDefined();
      expect(result.structuredContent).toBeDefined();
      const sc = result.structuredContent as Record<string, unknown>;
      expect(sc.query).toBe('configuration profile');
      expect(sc.results).toBeDefined();
      expect(sc.totalResults).toBeDefined();
    });

    it('should not return structuredContent on error', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_get_article',
        arguments: { url: 'https://learn.jamf.com/nonexistent-page-404' }
      });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toBeUndefined();
    });
  });

  describe('progress notifications', () => {
    it('should not crash when calling get_article without progressToken', async () => {
      const searchResult = await client.callTool({
        name: 'jamf_docs_search',
        arguments: { query: 'system requirements', limit: 1, responseFormat: 'json' }
      });
      const searchJson = JSON.parse(
        (searchResult.content[0] as { type: 'text'; text: string }).text
      );
      const url = searchJson.results[0]?.url
        || 'https://learn.jamf.com/bundle/jamf-pro-documentation-current/page/Policies.html';

      const result = await client.callTool({
        name: 'jamf_docs_get_article',
        arguments: { url }
      });
      expect(result.isError).toBeUndefined();
      expect(result.content).toBeDefined();
    });

    it('should not crash when calling get_toc without progressToken', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_get_toc',
        arguments: { product: 'jamf-pro' }
      });
      expect(result.isError).toBeUndefined();
      expect(result.content).toBeDefined();
    });
  });

  describe('prompts', () => {
    it('should list all 3 prompts', async () => {
      const result = await client.listPrompts();
      expect(result.prompts).toHaveLength(3);
      const names = result.prompts.map(p => p.name);
      expect(names).toContain('jamf_troubleshoot');
      expect(names).toContain('jamf_setup_guide');
      expect(names).toContain('jamf_compare_versions');
    });

    it('should return messages from jamf_troubleshoot', async () => {
      const result = await client.getPrompt({
        name: 'jamf_troubleshoot',
        arguments: { problem: 'MDM enrollment failing' }
      });
      expect(result.messages).toBeDefined();
      expect(result.messages.length).toBeGreaterThan(0);
      expect(result.messages[0].role).toBe('user');
      const text = (result.messages[0].content as { type: 'text'; text: string }).text;
      expect(text).toContain('MDM enrollment failing');
      expect(text).toContain('jamf_docs_search');
    });

    it('should return messages from jamf_setup_guide', async () => {
      const result = await client.getPrompt({
        name: 'jamf_setup_guide',
        arguments: { feature: 'FileVault', product: 'jamf-pro' }
      });
      expect(result.messages.length).toBeGreaterThan(0);
      const text = (result.messages[0].content as { type: 'text'; text: string }).text;
      expect(text).toContain('FileVault');
      expect(text).toContain('jamf-pro');
    });

    it('should return messages from jamf_compare_versions', async () => {
      const result = await client.getPrompt({
        name: 'jamf_compare_versions',
        arguments: { product: 'jamf-pro', version_a: '11.5.0', version_b: '11.12.0' }
      });
      expect(result.messages.length).toBeGreaterThan(0);
      const text = (result.messages[0].content as { type: 'text'; text: string }).text;
      expect(text).toContain('11.5.0');
      expect(text).toContain('11.12.0');
    });
  });

  describe('resource templates', () => {
    it('should list resource templates', async () => {
      const result = await client.listResourceTemplates();
      expect(result.resourceTemplates.length).toBeGreaterThanOrEqual(2);
      const names = result.resourceTemplates.map(t => t.name);
      expect(names).toContain('product-toc');
      expect(names).toContain('product-versions');
    });

    it('should read product versions via template', async () => {
      const result = await client.readResource({
        uri: 'jamf://products/jamf-pro/versions'
      });
      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].mimeType).toBe('application/json');
      const data = JSON.parse(result.contents[0].text!);
      expect(data.product).toBe('Jamf Pro');
      expect(data.versions).toBeDefined();
      expect(Array.isArray(data.versions)).toBe(true);
    });

    it('should return error for invalid productId', async () => {
      const result = await client.readResource({
        uri: 'jamf://products/invalid-product/versions'
      });
      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].text).toContain('Invalid product ID');
      expect(result.contents[0].text).toContain('jamf-pro');
    });

    it('should preserve existing static resources', async () => {
      const products = await client.readResource({ uri: 'jamf://products' });
      expect(products.contents).toHaveLength(1);
      expect(products.contents[0].mimeType).toBe('application/json');

      const topics = await client.readResource({ uri: 'jamf://topics' });
      expect(topics.contents).toHaveLength(1);
      expect(topics.contents[0].mimeType).toBe('application/json');
    });
  });

  describe('completions', () => {
    it('should complete product argument with prefix match', async () => {
      const result = await client.complete({
        ref: { type: 'ref/resource', uri: 'jamf://products/{productId}/versions' },
        argument: { name: 'productId', value: 'jamf-p' }
      });
      expect(result.completion.values).toContain('jamf-pro');
      expect(result.completion.values).toContain('jamf-protect');
      expect(result.completion.values).not.toContain('jamf-school');
    });

    it('should return all products for empty input', async () => {
      const result = await client.complete({
        ref: { type: 'ref/resource', uri: 'jamf://products/{productId}/toc' },
        argument: { name: 'productId', value: '' }
      });
      expect(result.completion.values).toHaveLength(12);
    });
  });

  describe('http transport', () => {
    let httpProcess: ChildProcess;
    const httpPort = 13579; // Use a non-standard port to avoid conflicts

    beforeAll(async () => {
      const serverPath = path.resolve(process.cwd(), 'dist/index.js');
      httpProcess = spawn('node', [serverPath, '--transport', 'http', '--port', String(httpPort)], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Wait for the server to start
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => { reject(new Error('HTTP server start timeout')); }, 10000);
        httpProcess.stderr!.on('data', (data: Buffer) => {
          if (data.toString().includes('running on http://')) {
            clearTimeout(timeout);
            resolve();
          }
        });
        httpProcess.on('error', reject);
      });
    });

    afterAll(() => {
      httpProcess?.kill('SIGTERM');
    });

    it('should respond to health check', async () => {
      const res = await fetch(`http://127.0.0.1:${httpPort}/health`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe('ok');
      expect(data.version).toBeDefined();
    });

    it('should return 404 for unknown paths', async () => {
      const res = await fetch(`http://127.0.0.1:${httpPort}/unknown`);
      expect(res.status).toBe(404);
    });

    it('should handle MCP initialize request', async () => {
      const res = await fetch(`http://127.0.0.1:${httpPort}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'test', version: '1.0.0' },
          },
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.result).toBeDefined();
      expect(data.result.serverInfo.name).toBe('jamf-docs-mcp-server');
    });
  });

  describe('tools/list', () => {
    it('should list all registered tools', async () => {
      const result = await client.listTools();

      expect(result.tools).toHaveLength(6);

      const toolNames = result.tools.map(t => t.name);
      expect(toolNames).toContain('jamf_docs_list_products');
      expect(toolNames).toContain('jamf_docs_search');
      expect(toolNames).toContain('jamf_docs_get_article');
      expect(toolNames).toContain('jamf_docs_get_toc');
      expect(toolNames).toContain('jamf_docs_glossary_lookup');
      expect(toolNames).toContain('jamf_docs_batch_get_articles');
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
      // Products with no TOC content are filtered out; count may vary
      expect(json.products.length).toBeGreaterThanOrEqual(8);
      expect(json.products.length).toBeLessThanOrEqual(12);
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

    it('should return compact output when outputMode is compact', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_list_products',
        arguments: { outputMode: 'compact' }
      });

      const text = (result.content[0] as { type: 'text'; text: string }).text;

      // Compact mode should be shorter and simpler
      expect(text).toContain('## Products');
      expect(text).toContain('## Topics');
      // Should contain at least one product in backtick format (availability may filter some)
      expect(text).toMatch(/`jamf-\w+`/);
      // Should NOT have detailed descriptions
      expect(text).not.toContain('Apple device management for enterprise');
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

    it('should return compact output when outputMode is compact', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_search',
        arguments: {
          query: 'policy',
          outputMode: 'compact'
        }
      });

      const text = (result.content[0] as { type: 'text'; text: string }).text;

      // Compact mode uses numbered list format
      expect(text).toMatch(/^\d+\. \[/m);
      // Should NOT have the full "### [Title]" format
      expect(text).not.toContain('### [');
    });

    it('should provide search suggestions when no results found', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_search',
        arguments: {
          query: 'xyznonexistent123456'
        }
      });

      const text = (result.content[0] as { type: 'text'; text: string }).text;

      expect(text).toContain('No results found');
      expect(text).toContain('Search Suggestions');
      expect(text).toContain('Tips');
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

    it('should return summary only when summaryOnly is true', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_get_article',
        arguments: {
          url: validArticleUrl,
          summaryOnly: true
        }
      });

      const text = (result.content[0] as { type: 'text'; text: string }).text;

      // Summary mode should contain summary section and outline
      expect(text).toContain('## Summary');
      expect(text).toContain('Article Outline');
      expect(text).toContain('tokens)');
      expect(text).toContain('Estimated read time');
    });

    it('should return compact output when outputMode is compact', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_get_article',
        arguments: {
          url: validArticleUrl,
          outputMode: 'compact'
        }
      });

      const text = (result.content[0] as { type: 'text'; text: string }).text;

      // Compact mode should have content but shorter footer
      expect(text).toContain('# ');
      expect(text).toContain('[Source]');
      // Should NOT have the verbose "Source: [url](url)" format
      expect(text).not.toContain('*Source: [');
    });
  });

  describe('resources/list', () => {
    it('should list all resources', async () => {
      const result = await client.listResources();

      expect(result.resources).toHaveLength(2);

      const resourceUris = result.resources.map(r => r.uri);
      expect(resourceUris).toContain('jamf://products');
      expect(resourceUris).toContain('jamf://topics');
    });

    it('should have proper resource metadata', async () => {
      const result = await client.listResources();

      for (const resource of result.resources) {
        expect(resource.name).toBeDefined();
        expect(resource.uri).toBeDefined();
        expect(resource.mimeType).toBe('application/json');
      }
    });
  });

  describe('resources/read', () => {
    it('should read products resource', async () => {
      const result = await client.readResource({ uri: 'jamf://products' });

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].mimeType).toBe('application/json');

      const json = JSON.parse(result.contents[0].text as string);
      expect(json.products).toBeDefined();
      // Resource uses metadata service which may cache results; at minimum all core products present
      expect(json.products.length).toBeGreaterThanOrEqual(4);

      const productIds = json.products.map((p: { id: string }) => p.id);
      expect(productIds).toContain('jamf-pro');
      expect(productIds).toContain('jamf-school');
      expect(productIds).toContain('jamf-connect');
      expect(productIds).toContain('jamf-protect');
    });

    it('should read topics resource', async () => {
      const result = await client.readResource({ uri: 'jamf://topics' });

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].mimeType).toBe('application/json');

      const json = JSON.parse(result.contents[0].text as string);
      expect(json.topics).toBeDefined();
      expect(json.totalTopics).toBeGreaterThan(30);

      const topicIds = json.topics.map((t: { id: string }) => t.id);
      expect(topicIds).toContain('enrollment');
      expect(topicIds).toContain('security');
      expect(topicIds).toContain('policies');
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

    it('should return compact output when outputMode is compact', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_get_toc',
        arguments: {
          product: 'jamf-pro',
          outputMode: 'compact'
        }
      });

      const text = (result.content[0] as { type: 'text'; text: string }).text;

      // Compact mode should have simpler header
      expect(text).toContain('## Jamf Pro TOC');
      expect(text).toContain('entries)');
      // Should NOT have the full "# Jamf Pro Documentation" header
      expect(text).not.toContain('# Jamf Pro Documentation');
    });
  });
});
