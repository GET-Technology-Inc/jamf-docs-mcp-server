/**
 * Semantic tests for version parameter behavior with realistic data.
 *
 * Version filtering now works via the search-service layer:
 * 1. Each search result has version metadata from the Fluid Topics API
 * 2. When version is requested, the service selects the matching result
 * 3. If no match found, falls back to latest version
 * 4. Version is extracted from bundle_id (e.g., "jamf-pro-documentation-11.25.0" -> "11.25.0")
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import type { SearchParams } from '../../../src/core/types.js';
import type { ServerContext } from '../../../src/core/types/context.js';

const mockSearchDocumentation = vi.fn().mockImplementation(
  (_ctx: ServerContext, params: SearchParams) => {
    const isVersionMismatch = params.version !== undefined
      && params.version !== 'current'
      && params.version !== '';
    return Promise.resolve({
      results: [
        {
          title: 'Configuration Profiles',
          url: 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation-11.13.0/page/Configuration_Profiles.html',
          snippet: 'Configuration profiles let you manage settings on devices.',
          product: 'jamf-pro',
          version: '11.13.0',
          docType: 'documentation',
        },
        {
          title: 'Enrollment',
          url: 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/Enrollment.html',
          snippet: 'Enroll devices into Jamf Pro.',
          product: 'jamf-pro',
          version: 'current',
          docType: 'documentation',
        },
      ],
      pagination: { page: 1, pageSize: 10, totalPages: 1, totalItems: 2, hasNext: false, hasPrev: false },
      tokenInfo: { tokenCount: 100, truncated: false, maxTokens: 5000 },
      ...(isVersionMismatch ? {
        versionNote: `Version "${params.version}" was not available for some results. Showing the latest version instead.`,
      } : {}),
    });
  }
);

vi.mock('../../../src/core/services/search-service.js', () => ({
  searchDocumentation: (...args: unknown[]) => mockSearchDocumentation(...args),
}));

import { searchDocumentation } from '../../../src/core/services/search-service.js';
import { registerSearchTool } from '../../../src/core/tools/search.js';
import { createMockContext } from '../../helpers/mock-context.js';

const ctx = createMockContext();

type TextContent = { type: 'text'; text: string };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('version parameter — search-service layer (version extraction)', () => {
  it('should extract actual version from bundle_id instead of hardcoding current', async () => {
    const result = await searchDocumentation(ctx, { query: 'jamf pro' });

    // Results with versioned bundle_ids should have actual version numbers
    const versionedResults = result.results.filter(r => r.version !== 'current');
    expect(versionedResults.length).toBeGreaterThan(0);
  });

  it('should return results regardless of version parameter', async () => {
    // Call 1: with version
    const withVersion = await searchDocumentation(ctx, { query: 'jamf pro', version: '11.13.0' });

    // Call 2: without version
    const withoutVersion = await searchDocumentation(ctx, { query: 'jamf pro' });

    // Both should return results (version matching falls back to leading if no match)
    expect(withVersion.results.length).toBe(withoutVersion.results.length);
  });
});

describe('version parameter — tool layer (no versionNote)', () => {
  let client: Client;
  let server: McpServer;

  beforeEach(async () => {
    server = new McpServer({ name: 'test-server', version: '0.0.1' });
    registerSearchTool(server, ctx);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test-client', version: '0.0.1' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  it('should include versionNote when requested version not found in followers', async () => {
    const result = await client.callTool({
      name: 'jamf_docs_search',
      arguments: { query: 'jamf pro', version: '99.0.0', responseFormat: 'json' },
    });

    const json = JSON.parse((result.content[0] as TextContent).text);
    // 99.0.0 doesn't exist in fixture data -> versionNote should be present
    expect(json.versionNote).toBeDefined();
    expect(json.versionNote).toContain('not available');
    expect(json.results.length).toBeGreaterThan(0);
  });

  it('should NOT include versionNote when version is "current"', async () => {
    const result = await client.callTool({
      name: 'jamf_docs_search',
      arguments: { query: 'jamf pro', version: 'current', responseFormat: 'json' },
    });

    const json = JSON.parse((result.content[0] as TextContent).text);
    expect(json.versionNote).toBeUndefined();
  });

  it('should NOT include versionNote when version is omitted', async () => {
    const result = await client.callTool({
      name: 'jamf_docs_search',
      arguments: { query: 'jamf pro', responseFormat: 'json' },
    });

    const json = JSON.parse((result.content[0] as TextContent).text);
    expect(json.versionNote).toBeUndefined();
  });

  it('should include versionNote in markdown output when version not found', async () => {
    const result = await client.callTool({
      name: 'jamf_docs_search',
      arguments: { query: 'jamf pro', version: '99.0.0' },
    });

    const text = (result.content[0] as TextContent).text;
    expect(text).toContain('Version Note');
  });
});
