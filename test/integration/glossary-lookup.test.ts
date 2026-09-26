/**
 * Integration tests for glossary lookup tool
 *
 * Tests the full flow: search API → fetch page → parse → fuzzy match → response
 * These tests hit the real Jamf documentation API.
 */

import { describe, it, expect } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/client';
import { registerGlossaryLookupTool } from '../../src/core/tools/glossary-lookup.js';
import { createMockContext } from '../helpers/mock-context.js';

interface TextContent { type: 'text'; text: string }

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
    // MDM is in the glossary, so this always has entries. It used to allow
    // "No glossary entries found" here "depending on API availability", which
    // is how an outage reading as a missing term went unnoticed: learn.jamf.com
    // failing is now `isError`, and fails this test as it should.
    expect(result.isError, text).not.toBe(true);

    const json = JSON.parse(text);
    expect(json.term).toBe('MDM');
    expect(json.entries.length).toBeGreaterThan(0);
    expect(json.tokenInfo).toBeDefined();
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

  it('does not call a term the glossary has missing because its entry is over maxTokens', async () => {
    // Live on 2026-09-26 this entry cost 134 tokens and the reply at the
    // minimum budget was "No glossary entries found". Whether it still costs
    // more than 100 is Jamf's to change; what is asserted is the part that is
    // ours: a lookup that matched says so, whether or not the entry fit.
    const result = await client.callTool({
      name: 'jamf_docs_glossary_lookup',
      arguments: { term: 'Apple School Manager', maxTokens: 100 },
    });

    const text = getTextContent(result);
    expect(result.isError, text).not.toBe(true);
    expect((result.structuredContent as { totalMatches: number }).totalMatches).toBeGreaterThan(0);
    expect(text).not.toContain('No glossary entries found');
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
