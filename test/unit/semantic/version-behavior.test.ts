/**
 * Semantic tests for version parameter behavior with realistic data.
 *
 * Key insight: The Jamf API ignores the version parameter entirely.
 * searchDocumentation() doesn't pass version to the API, and results
 * always come from whatever version the API currently serves (e.g., 11.25.0).
 *
 * These tests verify that:
 * 1. Requesting version=11.0.0 does NOT filter out results with 11.25.0 URLs
 * 2. The versionNote is generated at the tool layer (not scraper layer)
 * 3. Realistic fixture data with mixed bundle versions passes through unfiltered
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRealisticSearchResponse } from '../../helpers/fixtures.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

// Mock axios to return realistic fixture data
vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  return {
    ...actual,
    default: {
      ...actual.default,
      get: vi.fn(),
      isAxiosError: actual.default.isAxiosError,
    },
  };
});

vi.mock('../../../src/services/cache.js', () => ({
  cache: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
  },
}));

import axios from 'axios';
import { searchDocumentation } from '../../../src/services/scraper.js';
import { registerSearchTool } from '../../../src/tools/search.js';

const mockedAxiosGet = vi.mocked(axios.get);

type TextContent = { type: 'text'; text: string };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('version parameter — scraper layer', () => {
  it('should NOT filter results by requested version (API ignores version)', async () => {
    const fixtureData = createRealisticSearchResponse();
    mockedAxiosGet.mockResolvedValueOnce({ data: fixtureData, status: 200 } as never);

    // Request version=11.0.0, but fixture has 11.25.0, 11.13.0, current URLs
    const result = await searchDocumentation({ query: 'jamf pro', version: '11.0.0' });

    // Results should include URLs from the API's actual version (11.25.0), not filtered to 11.0.0
    const urlVersions = result.results
      .map(r => {
        const match = /documentation-(\d+\.\d+\.\d+)/.exec(r.url);
        return match?.[1];
      })
      .filter(Boolean);

    // Should have at least some versioned URLs that are NOT 11.0.0
    if (urlVersions.length > 0) {
      expect(urlVersions.some(v => v !== '11.0.0')).toBe(true);
    }
  });

  it('should return same result count regardless of version parameter', async () => {
    const fixtureData = createRealisticSearchResponse();

    // Call 1: with version=11.0.0
    mockedAxiosGet.mockResolvedValueOnce({ data: fixtureData, status: 200 } as never);
    const withVersion = await searchDocumentation({ query: 'jamf pro', version: '11.0.0' });

    // Call 2: without version
    mockedAxiosGet.mockResolvedValueOnce({ data: fixtureData, status: 200 } as never);
    const withoutVersion = await searchDocumentation({ query: 'jamf pro' });

    // Same fixture → same result count (version param has no effect at scraper level)
    expect(withVersion.results.length).toBe(withoutVersion.results.length);
  });
});

describe('version parameter — tool layer (versionNote)', () => {
  let client: Client;
  let server: McpServer;

  beforeEach(async () => {
    const fixtureData = createRealisticSearchResponse();
    mockedAxiosGet.mockResolvedValue({ data: fixtureData, status: 200 } as never);

    server = new McpServer({ name: 'test-server', version: '0.0.1' });
    registerSearchTool(server);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test-client', version: '0.0.1' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  it('should include versionNote in JSON when non-current version requested', async () => {
    const result = await client.callTool({
      name: 'jamf_docs_search',
      arguments: { query: 'jamf pro', version: '11.0.0', responseFormat: 'json' },
    });

    const json = JSON.parse((result.content[0] as TextContent).text);
    expect(json.versionNote).toBeDefined();
    expect(json.versionNote).toContain('current version content');

    // Despite versionNote, results should still be present
    expect(json.results.length).toBeGreaterThan(0);
    // All result versions should be 'current' (the API's actual behavior)
    for (const r of json.results) {
      expect(r.version).toBe('current');
    }
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

  it('should include versionNote in markdown output', async () => {
    const result = await client.callTool({
      name: 'jamf_docs_search',
      arguments: { query: 'jamf pro', version: '10.0.0' },
    });

    const text = (result.content[0] as TextContent).text;
    expect(text).toContain('Version Note');
  });
});
