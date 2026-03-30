/**
 * Integration tests for glossary lookup tool
 *
 * Tests the full flow: search API → fetch page → parse → fuzzy match → response
 * These tests hit the real Jamf documentation API.
 */

import { describe, it, expect } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerGlossaryLookupTool } from '../../src/core/tools/glossary-lookup.js';
import { createMockContext } from '../helpers/mock-context.js';

type TextContent = { type: 'text'; text: string };

function getTextContent(result: { content: unknown[] }): string {
  const first = result.content[0] as TextContent;
  return first.text;
}

describe('jamf_docs_glossary_lookup integration', () => {
  let server: McpServer;
  let client: Client;

  beforeAll(async () => {
    const ctx = createMockContext();
    server = new McpServer({ name: 'test', version: '0.0.1' });
    registerGlossaryLookupTool(server, ctx);

    client = new Client({ name: 'test-client', version: '0.0.1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
  });

  afterAll(async () => {
    await client.close();
    await server.close();
  });

  it('should look up a common Jamf term', async () => {
    const result = await client.callTool({
      name: 'jamf_docs_glossary_lookup',
      arguments: { term: 'MDM', responseFormat: 'json' },
    });

    const text = getTextContent(result);
    // May return results or not depending on API availability
    // At minimum, should not throw an error
    expect(result.isError).not.toBe(true);

    // If results were found, validate structure
    if (!text.includes('No glossary entries found')) {
      const json = JSON.parse(text);
      expect(json.term).toBe('MDM');
      expect(json.entries).toBeDefined();
      expect(json.tokenInfo).toBeDefined();
    }
  }, 30000);

  it('should handle product-filtered lookup', async () => {
    const result = await client.callTool({
      name: 'jamf_docs_glossary_lookup',
      arguments: { term: 'enrollment', product: 'jamf-pro' },
    });

    expect(result.isError).not.toBe(true);
    const text = getTextContent(result);
    expect(text.length).toBeGreaterThan(0);
  }, 30000);

  it('should return structured content for no results', async () => {
    const result = await client.callTool({
      name: 'jamf_docs_glossary_lookup',
      arguments: { term: 'xyznonexistenttermxyz123' },
    });

    expect(result.isError).not.toBe(true);
    const text = getTextContent(result);
    expect(text).toContain('No glossary entries found');
  }, 30000);
});
