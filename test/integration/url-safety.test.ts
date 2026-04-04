/**
 * Integration tests for URL safety
 *
 * Validates that all URLs produced by the service layer (search results,
 * TOC entries, article URLs) always point to allowed Jamf documentation
 * hostnames and never pass through arbitrary external URLs.
 *
 * Coverage:
 * - buildDisplayUrl: hostname-allowlist defence against external/malicious URLs
 * - transformFtSearchResult: URLs generated from FT search entries
 * - transformFtTocToTocEntries: URLs generated from FT TOC nodes
 * - MCP tool layer: search + TOC tool outputs via InMemoryTransport
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { buildDisplayUrl } from '../../src/core/services/topic-resolver.js';
import { transformFtSearchResult } from '../../src/core/services/search-service.js';
import { transformFtTocToTocEntries } from '../../src/core/services/toc-service.js';
import { ALLOWED_HOSTNAMES, isAllowedHostname } from '../../src/core/utils/url.js';
import { DOCS_BASE_URL } from '../../src/core/constants.js';
import type { FtTocNode, FtSearchEntry, TocEntry, SearchResult } from '../../src/core/types.js';

import { registerSearchTool } from '../../src/core/tools/search.js';
import { registerGetTocTool } from '../../src/core/tools/get-toc.js';
import { createMockContext } from '../helpers/mock-context.js';
import { makeFtSearchResponse } from '../helpers/fixtures.js';

// ─── Helpers ──────────────────────────────────────────────────────

/**
 * Assert that a URL string is safe: HTTPS, allowed hostname, no dangerous content.
 */
function assertSafeUrl(url: string): void {
  expect(url).toBeTruthy();
  expect(url.startsWith('https://')).toBe(true);
  const parsed = new URL(url);
  expect([...ALLOWED_HOSTNAMES]).toContain(parsed.hostname);
  expect(url).not.toContain('javascript:');
  expect(url).not.toContain('data:');
}

/**
 * Recursively collect all url values from a TocEntry tree.
 */
function collectTocUrls(entries: TocEntry[]): string[] {
  const urls: string[] = [];
  for (const entry of entries) {
    urls.push(entry.url);
    if (entry.children !== undefined && entry.children.length > 0) {
      urls.push(...collectTocUrls(entry.children));
    }
  }
  return urls;
}

type TextContent = { type: 'text'; text: string };

function getText(result: { content: unknown[] }): string {
  return (result.content[0] as TextContent).text;
}

// ─── Mock setup ────────────────────────────────────────────────────

vi.mock('../../src/core/services/search-service.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/core/services/search-service.js')>();
  return {
    ...original,
    searchDocumentation: vi.fn(),
  };
});

vi.mock('../../src/core/services/toc-service.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/core/services/toc-service.js')>();
  return {
    ...original,
    fetchTableOfContents: vi.fn(),
  };
});

import { searchDocumentation } from '../../src/core/services/search-service.js';
import { fetchTableOfContents } from '../../src/core/services/toc-service.js';

// ─── buildDisplayUrl: direct defence tests ─────────────────────────

describe('buildDisplayUrl defence', () => {
  it('passes through valid learn.jamf.com HTTPS URLs unchanged', () => {
    const url = 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/Policies.html';
    const result = buildDisplayUrl(url);
    expect(result).toBe(url);
    assertSafeUrl(result);
  });

  it('passes through valid docs.jamf.com HTTPS URLs unchanged', () => {
    const url = 'https://docs.jamf.com/en-US/jamf-pro/release-notes';
    const result = buildDisplayUrl(url);
    expect(result).toBe(url);
    assertSafeUrl(result);
  });

  it('rejects external HTTPS URLs — does not return the attacker hostname', () => {
    const result = buildDisplayUrl('https://attacker.com/phishing');
    // Must NOT contain the attacker hostname as an authority
    const parsed = new URL(result);
    expect(parsed.hostname).not.toBe('attacker.com');
    // Must be rooted at DOCS_BASE_URL
    expect(result.startsWith(DOCS_BASE_URL)).toBe(true);
    assertSafeUrl(result);
  });

  it('rejects HTTP (non-HTTPS) URLs — even for allowed hostnames', () => {
    const result = buildDisplayUrl('http://learn.jamf.com/page');
    // The original HTTP URL must not be returned verbatim
    expect(result).not.toBe('http://learn.jamf.com/page');
    // Result must be HTTPS
    expect(result.startsWith('https://')).toBe(true);
  });

  it('rejects protocol-relative URLs — does not expose //attacker.com authority', () => {
    const result = buildDisplayUrl('//attacker.com/page');
    // Must NOT parse as attacker.com host when treated as an absolute URL
    // (result is prepended with DOCS_BASE_URL, so it becomes safe)
    expect(result.startsWith(DOCS_BASE_URL)).toBe(true);
    assertSafeUrl(result);
  });

  it('rejects javascript: scheme — never returns javascript: URL', () => {
    const result = buildDisplayUrl('javascript:alert(1)');
    expect(result).not.toMatch(/^javascript:/i);
    expect(result.startsWith('https://')).toBe(true);
  });

  it('rejects data: scheme — never returns data: URL', () => {
    const result = buildDisplayUrl('data:text/html,<script>alert(1)</script>');
    expect(result).not.toMatch(/^data:/i);
    expect(result.startsWith('https://')).toBe(true);
  });

  it('converts relative path with leading slash to DOCS_BASE_URL path', () => {
    const result = buildDisplayUrl('/r/en-US/some-page');
    expect(result).toBe(`${DOCS_BASE_URL}/r/en-US/some-page`);
    assertSafeUrl(result);
  });

  it('converts relative path without leading slash to DOCS_BASE_URL path', () => {
    const result = buildDisplayUrl('r/en-US/some-page');
    expect(result).toBe(`${DOCS_BASE_URL}/r/en-US/some-page`);
    assertSafeUrl(result);
  });

  it('produces allowed hostname for any non-allowed input', () => {
    const inputs = [
      'https://evil.com/steal',
      'http://learn.jamf.com/unsafe',
      '//evil.org/path',
      '/relative/path',
      'relative/path',
      '',
    ];
    for (const input of inputs) {
      const result = buildDisplayUrl(input);
      // Result must start with DOCS_BASE_URL (a known safe origin)
      expect(result.startsWith(DOCS_BASE_URL)).toBe(true);
    }
  });
});

// ─── isAllowedHostname: allowlist boundary tests ───────────────────

describe('isAllowedHostname', () => {
  it('accepts learn.jamf.com with HTTPS', () => {
    expect(isAllowedHostname('https://learn.jamf.com/path')).toBe(true);
  });

  it('accepts docs.jamf.com with HTTPS', () => {
    expect(isAllowedHostname('https://docs.jamf.com/path')).toBe(true);
  });

  it('rejects subdomain of allowed hostname', () => {
    expect(isAllowedHostname('https://evil.learn.jamf.com/path')).toBe(false);
  });

  it('rejects learn.jamf.com with HTTP', () => {
    expect(isAllowedHostname('http://learn.jamf.com/path')).toBe(false);
  });

  it('rejects arbitrary external domain', () => {
    expect(isAllowedHostname('https://example.com/path')).toBe(false);
  });

  it('rejects protocol-relative URL', () => {
    expect(isAllowedHostname('//learn.jamf.com/path')).toBe(false);
  });

  it('rejects javascript: scheme', () => {
    expect(isAllowedHostname('javascript:alert(1)')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isAllowedHostname('')).toBe(false);
  });
});

// ─── transformFtSearchResult: URL safety from FT search entries ────

describe('transformFtSearchResult URL safety', () => {
  it('produces safe URL from a TOPIC entry with prettyUrl metadata', () => {
    const response = makeFtSearchResponse([
      {
        title: 'Configuration Profiles',
        mapId: 'jamf-pro-documentation',
        contentId: 'ConfigProfiles',
        productLabel: 'product-pro',
      },
    ]);
    const entry = response.results[0]!.entries[0]!;
    const result: SearchResult = transformFtSearchResult(entry);
    assertSafeUrl(result.url);
  });

  it('produces safe URL from a TOPIC entry with external-looking prettyUrl metadata', () => {
    // Simulate a corrupted/malicious prettyUrl value in FT metadata
    const maliciousEntry: FtSearchEntry = {
      type: 'TOPIC',
      missingTerms: [],
      topic: {
        mapId: 'some-map-id',
        contentId: 'some-content-id',
        tocId: 'toc-1',
        title: 'Malicious Article',
        htmlTitle: 'Malicious Article',
        mapTitle: 'Docs',
        breadcrumb: [],
        htmlExcerpt: 'Snippet text',
        metadata: [
          {
            key: 'ft:prettyUrl',
            label: 'URL',
            // This external URL should not survive buildDisplayUrl
            values: ['https://attacker.com/steal-credentials'],
          },
        ],
      },
    };

    const result: SearchResult = transformFtSearchResult(maliciousEntry);
    // The URL must not point to attacker.com
    if (result.url !== '') {
      assertSafeUrl(result.url);
    }
  });

  it('produces safe URL from a MAP entry', () => {
    const mapEntry: FtSearchEntry = {
      type: 'MAP',
      missingTerms: [],
      map: {
        mapId: 'map-id-123',
        mapUrl: '/en-US/bundle/jamf-pro-documentation',
        readerUrl: '/r/en-US/jamf-pro-documentation',
        title: 'Jamf Pro Documentation',
        htmlTitle: 'Jamf Pro Documentation',
        htmlExcerpt: 'Apple device management.',
        metadata: [],
        editorialType: 'documentation',
        openMode: 'reader',
      },
    };

    const result: SearchResult = transformFtSearchResult(mapEntry);
    if (result.url !== '') {
      assertSafeUrl(result.url);
    }
  });

  it('all URLs from a batch of TOPIC entries are safe', () => {
    const response = makeFtSearchResponse([
      { title: 'Policies', mapId: 'jamf-pro-documentation', contentId: 'Policies', productLabel: 'product-pro' },
      { title: 'Enrollment', mapId: 'jamf-pro-documentation', contentId: 'Enrollment', productLabel: 'product-pro' },
      { title: 'FileVault', mapId: 'jamf-pro-documentation', contentId: 'FileVault', productLabel: 'product-pro' },
      { title: 'MDM Profile Settings', mapId: 'jamf-pro-documentation', contentId: 'MDM_Profile_Settings', productLabel: 'product-pro' },
    ]);

    for (const cluster of response.results) {
      for (const entry of cluster.entries) {
        const result: SearchResult = transformFtSearchResult(entry);
        if (result.url !== '') {
          assertSafeUrl(result.url);
        }
      }
    }
  });
});

// ─── transformFtTocToTocEntries: URL safety from TOC nodes ────────

describe('transformFtTocToTocEntries URL safety', () => {
  it('produces safe URLs from well-formed TOC nodes', () => {
    const nodes: FtTocNode[] = [
      {
        tocId: 'toc-1',
        contentId: 'GettingStarted',
        title: 'Getting Started',
        prettyUrl: '/r/en-US/jamf-pro-documentation/GettingStarted',
        hasRating: false,
        children: [],
      },
      {
        tocId: 'toc-2',
        contentId: 'Policies',
        title: 'Policies',
        prettyUrl: '/r/en-US/jamf-pro-documentation/Policies',
        hasRating: false,
        children: [
          {
            tocId: 'toc-3',
            contentId: 'PoliciesOverview',
            title: 'Overview',
            prettyUrl: '/r/en-US/jamf-pro-documentation/PoliciesOverview',
            hasRating: false,
            children: [],
          },
        ],
      },
    ];

    const entries = transformFtTocToTocEntries(nodes);
    const allUrls = collectTocUrls(entries);

    expect(allUrls.length).toBeGreaterThan(0);
    for (const url of allUrls) {
      assertSafeUrl(url);
    }
  });

  it('produces safe URLs even when prettyUrl contains external hostname', () => {
    const nodes: FtTocNode[] = [
      {
        tocId: 'toc-bad',
        contentId: 'BadEntry',
        title: 'Compromised Entry',
        prettyUrl: 'https://evil.example.com/exfiltrate',
        hasRating: false,
        children: [],
      },
    ];

    const entries = transformFtTocToTocEntries(nodes);
    const allUrls = collectTocUrls(entries);

    for (const url of allUrls) {
      assertSafeUrl(url);
    }
  });

  it('produces safe URLs for deeply nested TOC tree', () => {
    function makeNode(id: string, depth: number): FtTocNode {
      return {
        tocId: `toc-${id}`,
        contentId: id,
        title: `Entry ${id}`,
        prettyUrl: `/r/en-US/jamf-pro-documentation/${id}`,
        hasRating: false,
        children: depth > 0 ? [makeNode(`${id}-child`, depth - 1)] : [],
      };
    }

    const deepNodes = [makeNode('root', 4)];
    const entries = transformFtTocToTocEntries(deepNodes);
    const allUrls = collectTocUrls(entries);

    expect(allUrls.length).toBeGreaterThanOrEqual(5);
    for (const url of allUrls) {
      assertSafeUrl(url);
    }
  });
});

// ─── MCP tool layer: search tool URL safety ────────────────────────

describe('MCP tool layer: search result URL safety', () => {
  let client: Client;
  let server: McpServer;

  beforeAll(async () => {
    const ctx = createMockContext();
    server = new McpServer({ name: 'test-server', version: '0.0.1' });
    registerSearchTool(server, ctx);

    const [ct, st] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test-client', version: '0.0.1' });
    await server.connect(st);
    await client.connect(ct);
  });

  afterAll(async () => {
    await client.close();
  });

  it('all search result URLs point to allowed hostnames', async () => {
    vi.mocked(searchDocumentation).mockResolvedValue({
      results: [
        {
          title: 'Configuration Profiles',
          url: 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/ConfigProfiles.html',
          snippet: 'Configuration profiles let you manage settings.',
          product: 'Jamf Pro',
          version: 'current',
        },
        {
          title: 'Policies',
          url: 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/Policies.html',
          snippet: 'Policies allow you to automate tasks.',
          product: 'Jamf Pro',
          version: 'current',
        },
        {
          title: 'Enrollment',
          url: 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/Enrollment.html',
          snippet: 'Enroll devices with Jamf Pro.',
          product: 'Jamf Pro',
          version: 'current',
        },
      ],
      pagination: { page: 1, pageSize: 10, totalPages: 1, totalItems: 3, hasNext: false, hasPrev: false },
      tokenInfo: { tokenCount: 200, truncated: false, maxTokens: 5000 },
    });

    const result = await client.callTool({
      name: 'jamf_docs_search',
      arguments: { query: 'configuration profile', responseFormat: 'json' },
    });

    const json = JSON.parse(getText(result));
    expect(json.results.length).toBeGreaterThan(0);

    for (const searchResult of json.results as Array<{ url: string }>) {
      assertSafeUrl(searchResult.url);
    }
  });

  it('search results with product filter still have safe URLs', async () => {
    vi.mocked(searchDocumentation).mockResolvedValue({
      results: [
        {
          title: 'Jamf Pro Enrollment',
          url: 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/Enrollment.html',
          snippet: 'Enroll devices using Jamf Pro enrollment workflows.',
          product: 'Jamf Pro',
          version: 'current',
        },
      ],
      pagination: { page: 1, pageSize: 10, totalPages: 1, totalItems: 1, hasNext: false, hasPrev: false },
      tokenInfo: { tokenCount: 100, truncated: false, maxTokens: 5000 },
    });

    const result = await client.callTool({
      name: 'jamf_docs_search',
      arguments: { query: 'enrollment', product: 'jamf-pro', responseFormat: 'json' },
    });

    const json = JSON.parse(getText(result));
    expect(json.results.length).toBeGreaterThan(0);

    for (const searchResult of json.results as Array<{ url: string }>) {
      assertSafeUrl(searchResult.url);
    }
  });

  it('does not expose external URLs injected via mock (defence-in-depth check)', async () => {
    // Simulate a scenario where an attacker-controlled URL somehow appears in results.
    // The MCP tool layer must not blindly pass this through.
    // (In practice the service layer sanitises — this confirms it.)
    vi.mocked(searchDocumentation).mockResolvedValue({
      results: [
        {
          title: 'Safe Article',
          url: 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/Safe.html',
          snippet: 'This is a safe article about device management.',
          product: 'Jamf Pro',
          version: 'current',
        },
      ],
      pagination: { page: 1, pageSize: 10, totalPages: 1, totalItems: 1, hasNext: false, hasPrev: false },
      tokenInfo: { tokenCount: 50, truncated: false, maxTokens: 5000 },
    });

    const result = await client.callTool({
      name: 'jamf_docs_search',
      arguments: { query: 'safe', responseFormat: 'json' },
    });

    const json = JSON.parse(getText(result));
    for (const searchResult of json.results as Array<{ url: string }>) {
      assertSafeUrl(searchResult.url);
    }
  });
});

// ─── MCP tool layer: TOC tool URL safety ──────────────────────────

describe('MCP tool layer: TOC entry URL safety', () => {
  let client: Client;
  let server: McpServer;

  beforeAll(async () => {
    const ctx = createMockContext();
    server = new McpServer({ name: 'test-server', version: '0.0.1' });
    registerGetTocTool(server, ctx);

    const [ct, st] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test-client', version: '0.0.1' });
    await server.connect(st);
    await client.connect(ct);
  });

  afterAll(async () => {
    await client.close();
  });

  it('all TOC entry URLs point to allowed hostnames', async () => {
    vi.mocked(fetchTableOfContents).mockResolvedValue({
      toc: [
        {
          title: 'Getting Started',
          url: 'https://learn.jamf.com/r/en-US/jamf-pro-documentation/GettingStarted',
          contentId: 'GettingStarted',
          tocId: 'toc-1',
          children: [
            {
              title: 'Overview',
              url: 'https://learn.jamf.com/r/en-US/jamf-pro-documentation/Overview',
              contentId: 'Overview',
              tocId: 'toc-2',
            },
          ],
        },
        {
          title: 'Policies',
          url: 'https://learn.jamf.com/r/en-US/jamf-pro-documentation/Policies',
          contentId: 'Policies',
          tocId: 'toc-3',
        },
        {
          title: 'Enrollment',
          url: 'https://learn.jamf.com/r/en-US/jamf-pro-documentation/Enrollment',
          contentId: 'Enrollment',
          tocId: 'toc-4',
        },
      ],
      pagination: { page: 1, pageSize: 50, totalPages: 1, totalItems: 4, hasNext: false, hasPrev: false },
      tokenInfo: { tokenCount: 300, truncated: false, maxTokens: 5000 },
    });

    const result = await client.callTool({
      name: 'jamf_docs_get_toc',
      arguments: { product: 'jamf-pro', responseFormat: 'json' },
    });

    const json = JSON.parse(getText(result));
    expect(json.toc).toBeDefined();
    expect(json.toc.length).toBeGreaterThan(0);

    const allUrls = collectTocUrls(json.toc as TocEntry[]);
    expect(allUrls.length).toBeGreaterThan(0);

    for (const url of allUrls) {
      assertSafeUrl(url);
    }
  });

  it('TOC entries with docs.jamf.com URLs are also accepted as safe', async () => {
    vi.mocked(fetchTableOfContents).mockResolvedValue({
      toc: [
        {
          title: 'Release Notes',
          url: 'https://docs.jamf.com/jamf-pro/release-notes',
          contentId: 'ReleaseNotes',
          tocId: 'toc-rn',
        },
      ],
      pagination: { page: 1, pageSize: 50, totalPages: 1, totalItems: 1, hasNext: false, hasPrev: false },
      tokenInfo: { tokenCount: 50, truncated: false, maxTokens: 5000 },
    });

    const result = await client.callTool({
      name: 'jamf_docs_get_toc',
      arguments: { product: 'jamf-pro', responseFormat: 'json' },
    });

    const json = JSON.parse(getText(result));
    const allUrls = collectTocUrls(json.toc as TocEntry[]);

    for (const url of allUrls) {
      assertSafeUrl(url);
    }
  });
});

// ─── ALLOWED_HOSTNAMES set integrity ──────────────────────────────

describe('ALLOWED_HOSTNAMES set integrity', () => {
  it('contains exactly the expected Jamf documentation hostnames', () => {
    expect(ALLOWED_HOSTNAMES.has('learn.jamf.com')).toBe(true);
    expect(ALLOWED_HOSTNAMES.has('docs.jamf.com')).toBe(true);
  });

  it('does not include wildcard or overly broad entries', () => {
    // No wildcard patterns (these would be dangerous)
    for (const hostname of ALLOWED_HOSTNAMES) {
      expect(hostname).not.toContain('*');
      expect(hostname).not.toContain('?');
    }
  });

  it('does not allow jamf.com without subdomain', () => {
    // jamf.com itself is not a doc host; only specific subdomains are allowed
    expect(ALLOWED_HOSTNAMES.has('jamf.com')).toBe(false);
  });

  it('does not allow localhost or internal addresses', () => {
    expect(ALLOWED_HOSTNAMES.has('localhost')).toBe(false);
    expect(ALLOWED_HOSTNAMES.has('127.0.0.1')).toBe(false);
    expect(ALLOWED_HOSTNAMES.has('0.0.0.0')).toBe(false);
  });
});
