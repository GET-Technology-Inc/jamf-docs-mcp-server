/**
 * Semantic tests for version parameter behavior with realistic data.
 *
 * Version filtering now works via follower_result:
 * 1. Each search result has a follower_result array with all historical versions
 * 2. When version is requested, the scraper selects the matching follower's URL
 * 3. If no follower matches, falls back to leading_result
 * 4. Version is extracted from bundle_id (e.g., "jamf-pro-documentation-11.25.0" -> "11.25.0")
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRealisticSearchResponse } from '../../helpers/fixtures.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

// Mock http-client to return realistic fixture data
vi.mock('../../../src/core/http-client.js', async () => {
  return {
    httpGetText: vi.fn(),
    httpGetJson: vi.fn(),
    HttpError: (await import('../../../src/core/http-client.js')).HttpError,
  };
});

import { httpGetJson } from '../../../src/core/http-client.js';
import { searchDocumentation } from '../../../src/core/services/scraper.js';
import { registerSearchTool } from '../../../src/core/tools/search.js';
import { createMockContext } from '../../helpers/mock-context.js';

const ctx = createMockContext();

const mockedHttpGetJson = vi.mocked(httpGetJson);

type TextContent = { type: 'text'; text: string };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('version parameter — scraper layer (follower_result matching)', () => {
  it('should extract actual version from bundle_id instead of hardcoding current', async () => {
    const fixtureData = createRealisticSearchResponse();
    mockedHttpGetJson.mockResolvedValueOnce(fixtureData);

    const result = await searchDocumentation(ctx, { query: 'jamf pro' });

    // Results with versioned bundle_ids should have actual version numbers
    const versionedResults = result.results.filter(r => r.version !== 'current');
    expect(versionedResults.length).toBeGreaterThan(0);
  });

  it('should return results regardless of version parameter', async () => {
    const fixtureData = createRealisticSearchResponse();

    // Call 1: with version
    mockedHttpGetJson.mockResolvedValueOnce(fixtureData);
    const withVersion = await searchDocumentation(ctx, { query: 'jamf pro', version: '11.13.0' });

    // Call 2: without version
    mockedHttpGetJson.mockResolvedValueOnce(fixtureData);
    const withoutVersion = await searchDocumentation(ctx, { query: 'jamf pro' });

    // Both should return results (version matching falls back to leading if no match)
    expect(withVersion.results.length).toBe(withoutVersion.results.length);
  });
});

describe('version parameter — tool layer (no versionNote)', () => {
  let client: Client;
  let server: McpServer;

  beforeEach(async () => {
    const fixtureData = createRealisticSearchResponse();
    mockedHttpGetJson.mockResolvedValue(fixtureData);

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
