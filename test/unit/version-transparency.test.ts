/**
 * Unit tests for version filter transparency
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

vi.mock('../../src/services/scraper.js', () => ({
  searchDocumentation: vi.fn().mockResolvedValue({
    results: [{ title: 'Test', url: 'https://learn.jamf.com/test.html', snippet: 'Test snippet content for version transparency', product: 'Jamf Pro', version: 'current', docType: 'documentation' }],
    pagination: { page: 1, pageSize: 10, totalPages: 1, totalItems: 1, hasNext: false, hasPrev: false },
    tokenInfo: { tokenCount: 50, truncated: false, maxTokens: 5000 },
  }),
  ALLOWED_HOSTNAMES: new Set(['learn.jamf.com', 'learn-be.jamf.com', 'docs.jamf.com']),
  isAllowedHostname: (url: string) => {
    try { return new Set(['learn.jamf.com', 'learn-be.jamf.com', 'docs.jamf.com']).has(new URL(url).hostname); }
    catch { return false; }
  },
}));

import { registerSearchTool } from '../../src/tools/search.js';

type TextContent = { type: 'text'; text: string };

describe('Version filter transparency', () => {
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

  it('should include versionNote when non-current version specified', async () => {
    const result = await client.callTool({
      name: 'jamf_docs_search',
      arguments: { query: 'enrollment', version: '11.0.0' },
    });

    const text = (result.content[0] as TextContent).text;
    expect(text).toContain('Version Note');
    expect(text).toContain('current version content');
  });

  it('should NOT include versionNote when version is current', async () => {
    const result = await client.callTool({
      name: 'jamf_docs_search',
      arguments: { query: 'enrollment', version: 'current' },
    });

    const text = (result.content[0] as TextContent).text;
    expect(text).not.toContain('Version Note');
  });

  it('should NOT include versionNote when no version specified', async () => {
    const result = await client.callTool({
      name: 'jamf_docs_search',
      arguments: { query: 'enrollment' },
    });

    const text = (result.content[0] as TextContent).text;
    expect(text).not.toContain('Version Note');
  });

  it('should include relevanceNote in JSON format', async () => {
    const result = await client.callTool({
      name: 'jamf_docs_search',
      arguments: { query: 'enrollment', responseFormat: 'json' },
    });

    const json = JSON.parse((result.content[0] as TextContent).text);
    expect(json.relevanceNote).toBeDefined();
    expect(json.relevanceNote).toContain('Zoomin Search API');
  });

  it('should NOT include relevanceNote in markdown format', async () => {
    const result = await client.callTool({
      name: 'jamf_docs_search',
      arguments: { query: 'enrollment' },
    });

    const text = (result.content[0] as TextContent).text;
    expect(text).not.toContain('relevanceNote');
  });
});
