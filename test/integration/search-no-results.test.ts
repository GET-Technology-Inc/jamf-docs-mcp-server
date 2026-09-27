/**
 * `jamf_docs_search` with no results, against the live search.
 *
 * On 6.0.12 a `responseFormat: "json"` search that found nothing answered
 * with the markdown "No results found" page, so `JSON.parse` threw on it:
 * live, "xqzvbnmplk" gave `Unexpected token 'N', "No results"... is not valid
 * JSON`. What is asserted is only our side: whatever Fluid Topics matches, a
 * JSON request gets the JSON body, and one with no results says so in it.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { registerSearchTool } from '../../src/core/tools/search.js';
import { createMockContext } from '../helpers/mock-context.js';

interface TextContent { type: 'text'; text: string }

describe('jamf_docs_search with no results, live', () => {
  let server: McpServer;
  let client: Client;

  beforeAll(async () => {
    server = new McpServer({ name: 'test', version: '0.0.1' });
    registerSearchTool(server, createMockContext());
    client = new Client({ name: 'test-client', version: '0.0.1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    // So the client checks structuredContent against the published outputSchema.
    await client.listTools();
  });

  afterAll(async () => {
    await client.close();
    await server.close();
  });

  it('answers JSON when JSON was asked for', async () => {
    const result = await client.callTool({
      name: 'jamf_docs_search',
      arguments: { query: 'xqzvbnmplk', responseFormat: 'json' },
    });

    const { text } = result.content[0] as TextContent;
    expect(result.isError, text).not.toBe(true);
    const json = JSON.parse(text) as { total: number; results: unknown[]; suggestions?: unknown };
    const structured = result.structuredContent as { totalResults: number };
    expect(json.total).toBe(structured.totalResults);
    if (json.total === 0) {
      expect(json.results).toEqual([]);
      expect(Array.isArray(json.suggestions)).toBe(true);
    }
  }, 30000);
});
