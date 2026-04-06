/**
 * Unit tests for jamf_docs_glossary_lookup tool handler.
 *
 * Tests formatting, input validation, and error handling via
 * McpServer + InMemoryTransport with mocked service dependencies.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createTokenInfo } from '../../helpers/fixtures.js';

// --- Mock service modules before importing the tool --------------------------

vi.mock('../../../src/core/services/glossary.js', () => ({
  lookupGlossaryTerm: vi.fn(),
  parseGlossaryEntries: vi.fn(),
  searchGlossaryEntries: vi.fn(),
}));

vi.mock('../../../src/core/services/cache.js', () => ({
  cache: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn(),
  },
}));

// Import AFTER mocks are set up
import { lookupGlossaryTerm } from '../../../src/core/services/glossary.js';
import { registerGlossaryLookupTool } from '../../../src/core/tools/glossary-lookup.js';

// ---------------------------------------------------------------------------

type TextContent = { type: 'text'; text: string };

function getTextContent(result: { content: unknown[] }): string {
  const first = result.content[0] as TextContent;
  return first.text;
}

// ---------------------------------------------------------------------------
// Server & client lifecycle
// ---------------------------------------------------------------------------

let server: McpServer;
let client: Client;

beforeAll(async () => {
  server = new McpServer({ name: 'test', version: '0.0.1' });
  registerGlossaryLookupTool(server);

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

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------

describe('jamf_docs_glossary_lookup', () => {
  describe('input validation', () => {
    it('should reject term shorter than 2 characters', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_glossary_lookup',
        arguments: { term: 'a' },
      });

      const text = getTextContent(result);
      // MCP SDK validates schema before handler — error comes from SDK
      expect(text).toContain('too_small');
    });

    it('should reject invalid product ID', async () => {
      const result = await client.callTool({
        name: 'jamf_docs_glossary_lookup',
        arguments: { term: 'MDM', product: 'invalid-product' },
      });

      const text = getTextContent(result);
      // MCP SDK validates enum before handler — error lists valid options
      expect(text).toContain('invalid_value');
    });
  });

  describe('markdown format', () => {
    it('should format single entry as markdown', async () => {
      vi.mocked(lookupGlossaryTerm).mockResolvedValue({
        entries: [{
          term: 'MDM',
          definition: 'Mobile Device Management is a protocol for managing Apple devices.',
          url: 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/Glossary.html',
          product: 'jamf-pro',
        }],
        totalMatches: 1,
        tokenInfo: createTokenInfo({ tokenCount: 50, truncated: false }),
      });

      const result = await client.callTool({
        name: 'jamf_docs_glossary_lookup',
        arguments: { term: 'MDM' },
      });

      const text = getTextContent(result);
      expect(text).toContain('# Glossary Lookup: "MDM"');
      expect(text).toContain('### MDM');
      expect(text).toContain('Mobile Device Management');
      expect(text).toContain('**Product**: jamf-pro');
    });

    it('should format compact mode correctly', async () => {
      vi.mocked(lookupGlossaryTerm).mockResolvedValue({
        entries: [{
          term: 'MDM',
          definition: 'Mobile Device Management protocol.',
          url: 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/Glossary.html',
        }],
        totalMatches: 1,
        tokenInfo: createTokenInfo({ tokenCount: 30, truncated: false }),
      });

      const result = await client.callTool({
        name: 'jamf_docs_glossary_lookup',
        arguments: { term: 'MDM', outputMode: 'compact' },
      });

      const text = getTextContent(result);
      expect(text).toContain('## Glossary: "MDM"');
      expect(text).toContain('1. **MDM**');
    });
  });

  describe('json format', () => {
    it('should return valid JSON', async () => {
      vi.mocked(lookupGlossaryTerm).mockResolvedValue({
        entries: [{
          term: 'DEP',
          definition: 'Device Enrollment Program.',
          url: 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/Glossary.html',
        }],
        totalMatches: 1,
        tokenInfo: createTokenInfo({ tokenCount: 25, truncated: false }),
      });

      const result = await client.callTool({
        name: 'jamf_docs_glossary_lookup',
        arguments: { term: 'DEP', responseFormat: 'json' },
      });

      const text = getTextContent(result);
      const json = JSON.parse(text);
      expect(json.term).toBe('DEP');
      expect(json.totalMatches).toBe(1);
      expect(json.entries).toHaveLength(1);
      expect(json.entries[0].term).toBe('DEP');
      expect(json.tokenInfo).toBeDefined();
    });
  });

  describe('no results', () => {
    it('should return helpful message when no entries found', async () => {
      vi.mocked(lookupGlossaryTerm).mockResolvedValue({
        entries: [],
        totalMatches: 0,
        tokenInfo: createTokenInfo({ tokenCount: 0, truncated: false }),
      });

      const result = await client.callTool({
        name: 'jamf_docs_glossary_lookup',
        arguments: { term: 'nonexistent_term_xyz' },
      });

      const text = getTextContent(result);
      expect(text).toContain('No glossary entries found');
      expect(text).toContain('jamf_docs_search');
    });
  });

  describe('token truncation', () => {
    it('should indicate when results are truncated', async () => {
      vi.mocked(lookupGlossaryTerm).mockResolvedValue({
        entries: [{
          term: 'MDM',
          definition: 'Short def.',
          url: 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/Glossary.html',
        }],
        totalMatches: 5,
        tokenInfo: createTokenInfo({ tokenCount: 100, truncated: true }),
      });

      const result = await client.callTool({
        name: 'jamf_docs_glossary_lookup',
        arguments: { term: 'MDM' },
      });

      const text = getTextContent(result);
      expect(text).toContain('1 of 5 match');
      expect(text).toContain('truncated');
    });
  });

  describe('language warning', () => {
    it('should show English-only warning for non-English language', async () => {
      vi.mocked(lookupGlossaryTerm).mockResolvedValue({
        entries: [{
          term: 'MDM',
          definition: 'Mobile Device Management protocol.',
          url: 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/Glossary.html',
        }],
        totalMatches: 1,
        tokenInfo: createTokenInfo({ tokenCount: 50, truncated: false }),
      });

      const result = await client.callTool({
        name: 'jamf_docs_glossary_lookup',
        arguments: { term: 'MDM', language: 'zh-TW' },
      });

      const text = getTextContent(result);
      expect(text).toMatch(/English|en-US/i);
    });

    it('should show English-only warning in JSON format for non-English language', async () => {
      vi.mocked(lookupGlossaryTerm).mockResolvedValue({
        entries: [{
          term: 'MDM',
          definition: 'Mobile Device Management protocol.',
          url: 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/Glossary.html',
        }],
        totalMatches: 1,
        tokenInfo: createTokenInfo({ tokenCount: 50, truncated: false }),
      });

      const result = await client.callTool({
        name: 'jamf_docs_glossary_lookup',
        arguments: { term: 'MDM', language: 'ja-JP', responseFormat: 'json' },
      });

      const json = JSON.parse(getTextContent(result));
      expect(json.warning).toBeDefined();
      expect(json.warning).toMatch(/English|en-US/i);
    });

    it('should not show warning for English locale', async () => {
      vi.mocked(lookupGlossaryTerm).mockResolvedValue({
        entries: [{
          term: 'MDM',
          definition: 'Mobile Device Management protocol.',
          url: 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/Glossary.html',
        }],
        totalMatches: 1,
        tokenInfo: createTokenInfo({ tokenCount: 50, truncated: false }),
      });

      const result = await client.callTool({
        name: 'jamf_docs_glossary_lookup',
        arguments: { term: 'MDM', language: 'en-US' },
      });

      const text = getTextContent(result);
      // Should not contain the English-only warning
      expect(text).not.toContain('currently only available in English');
    });
  });

  describe('error handling', () => {
    it('should return error message on service failure', async () => {
      vi.mocked(lookupGlossaryTerm).mockRejectedValue(new Error('Network timeout'));

      const result = await client.callTool({
        name: 'jamf_docs_glossary_lookup',
        arguments: { term: 'MDM' },
      });

      const text = getTextContent(result);
      expect(text).toContain('Glossary lookup error');
    });
  });
});
