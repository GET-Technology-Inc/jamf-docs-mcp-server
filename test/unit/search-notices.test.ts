/**
 * Unit tests for the search tool's relevanceNote.
 *
 * The versionNote cases that used to live here drove a fully-mocked
 * searchDocumentation, so they asserted the mock's own branch — and asserted
 * the opposite of the real FT path, where the version filter goes upstream and
 * no note is emitted. The rule is covered against the real service in
 * services/search-service.test.ts and its rendering in
 * tools/notice-rendering.test.ts.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/client';

import type { SearchParams } from '../../src/core/types.js';
import type { ServerContext } from '../../src/core/types/context.js';
import { createMockContext } from '../helpers/mock-context.js';

const ctx = createMockContext();

const mockSearchDocumentation = vi.fn().mockImplementation(async (_ctx: ServerContext, params: SearchParams) => {
  return await Promise.resolve({
    results: [{ title: 'Test', url: 'https://learn.jamf.com/test.html', snippet: 'Test snippet content for the relevance note', product: 'Jamf Pro', version: params.version ?? 'current', docType: 'documentation' }],
    pagination: { page: 1, pageSize: 10, totalPages: 1, totalItems: 1, hasNext: false, hasPrev: false },
    tokenInfo: { tokenCount: 50, truncated: false, maxTokens: 5000 },
  });
});

vi.mock('../../src/core/services/search-service.js', () => ({
  searchDocumentation: (...args: unknown[]) => mockSearchDocumentation(...args),
}));

import { registerSearchTool } from '../../src/core/tools/search.js';

interface TextContent { type: 'text'; text: string }

describe('Search notices', () => {
  let client: Client;
  let server: McpServer;

  beforeAll(async () => {
    server = new McpServer({ name: 'test-server', version: '0.0.1' });
    registerSearchTool(server, ctx);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test-client', version: '0.0.1' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await client.close();
  });

  it('should include relevanceNote in JSON format', async () => {
    const result = await client.callTool({
      name: 'jamf_docs_search',
      arguments: { query: 'enrollment', responseFormat: 'json' },
    });

    const json = JSON.parse((result.content[0] as TextContent).text);
    expect(json.relevanceNote).toBeDefined();
    expect(json.relevanceNote).toContain('Fluid Topics search API');
    // The note must not promise a score. Fluid Topics returns none — a
    // clustered-search entry has no score, rank or weight field — and no
    // result this server emits carries a numeric relevance.
    expect(json.relevanceNote).toMatch(/no numeric relevance score/i);
    expect(json.relevanceNote).not.toMatch(/higher values/i);
  });

  it('should NOT include relevanceNote in markdown format', async () => {
    const result = await client.callTool({
      name: 'jamf_docs_search',
      arguments: { query: 'enrollment' },
    });

    const {text} = (result.content[0] as TextContent);
    expect(text).not.toContain('relevanceNote');
  });
});
