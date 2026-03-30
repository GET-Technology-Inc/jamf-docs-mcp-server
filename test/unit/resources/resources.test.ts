/**
 * Unit tests for MCP resources registration (src/resources/index.ts)
 *
 * Strategy: build a minimal fake McpServer that captures calls to
 * registerResource, then invoke the resource handlers directly to verify
 * the JSON returned for products, topics and to verify error paths.
 *
 * The metadata service (getProductsResourceData / getTopicsResourceData)
 * is mocked so tests are deterministic and do not hit the network.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// ---------------------------------------------------------------------------
// Mock the metadata service BEFORE importing the module under test
// ---------------------------------------------------------------------------

vi.mock('../../../src/core/services/metadata.js', () => ({
  getProductsResourceData: vi.fn(),
  getTopicsResourceData: vi.fn(),
  getAvailableVersions: vi.fn(),
  getBundleIdForVersion: vi.fn(),
  getProductsMetadata: vi.fn(),
  getTopicsMetadata: vi.fn(),
}));

vi.mock('../../../src/core/services/scraper.js', () => ({
  fetchTableOfContents: vi.fn(),
  ALLOWED_HOSTNAMES: new Set(['learn.jamf.com', 'learn-be.jamf.com', 'docs.jamf.com']),
  isAllowedHostname: (url: string) => {
    try { return new Set(['learn.jamf.com', 'learn-be.jamf.com', 'docs.jamf.com']).has(new URL(url).hostname); }
    catch { return false; }
  },
}));

import { registerResources } from '../../../src/core/resources/index.js';
import { createMockContext } from '../../helpers/mock-context.js';

const ctx = createMockContext();
import {
  getProductsResourceData,
  getTopicsResourceData,
  getAvailableVersions,
} from '../../../src/core/services/metadata.js';
import { fetchTableOfContents } from '../../../src/core/services/scraper.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FAKE_PRODUCTS_DATA = {
  description: 'Available Jamf products for documentation search',
  products: [
    {
      id: 'jamf-pro',
      name: 'Jamf Pro',
      description: 'Apple device management for enterprise',
      latestVersion: 'current',
      availableVersions: ['current'],
      bundleId: 'jamf-pro-documentation',
    },
    {
      id: 'jamf-school',
      name: 'Jamf School',
      description: 'Apple device management for education',
      latestVersion: 'current',
      availableVersions: ['current'],
      bundleId: 'jamf-school-documentation',
    },
    {
      id: 'jamf-connect',
      name: 'Jamf Connect',
      description: 'Identity and access management',
      latestVersion: 'current',
      availableVersions: ['current'],
      bundleId: 'jamf-connect-documentation',
    },
    {
      id: 'jamf-protect',
      name: 'Jamf Protect',
      description: 'Endpoint security for Apple',
      latestVersion: 'current',
      availableVersions: ['current'],
      bundleId: 'jamf-protect-documentation',
    },
    { id: 'jamf-now', name: 'Jamf Now', description: 'Simple MDM', latestVersion: 'current', availableVersions: ['current'], bundleId: 'jamf-now-documentation' },
    { id: 'jamf-safe-internet', name: 'Jamf Safe Internet', description: 'Content filtering', latestVersion: 'current', availableVersions: ['current'], bundleId: 'jamf-safe-internet-documentation' },
    { id: 'jamf-insights', name: 'Jamf Insights', description: 'Analytics', latestVersion: 'current', availableVersions: ['current'], bundleId: 'jamf-insights-documentation' },
    { id: 'jamf-rapididentity', name: 'RapidIdentity', description: 'Identity platform', latestVersion: 'current', availableVersions: ['current'], bundleId: 'jamf-rapididentity-documentation' },
    { id: 'jamf-trust', name: 'Jamf Trust', description: 'Zero-trust access', latestVersion: 'current', availableVersions: ['current'], bundleId: 'jamf-trust-documentation' },
    { id: 'jamf-routines', name: 'Jamf Routines', description: 'Workflow automation', latestVersion: 'current', availableVersions: ['current'], bundleId: 'jamf-routines-documentation' },
    { id: 'self-service-plus', name: 'Self Service+', description: 'Self-service portal', latestVersion: 'current', availableVersions: ['current'], bundleId: 'self-service-plus-documentation' },
    { id: 'jamf-app-catalog', name: 'Jamf App Catalog', description: 'App catalog', latestVersion: 'current', availableVersions: ['current'], bundleId: 'jamf-app-catalog' },
  ],
  lastUpdated: new Date().toISOString(),
  usage: 'Use product ID with jamf_docs_search or jamf_docs_get_toc tools.',
};

const FAKE_TOPICS_DATA = {
  description: 'Topic categories for filtering Jamf documentation searches',
  totalTopics: 3,
  topics: [
    { id: 'enrollment', name: 'Enrollment & Onboarding', source: 'manual' },
    { id: 'security', name: 'Security Settings', source: 'manual' },
    { id: 'policies', name: 'Policies', source: 'manual' },
  ],
  lastUpdated: new Date().toISOString(),
  usage: 'Use topic ID with jamf_docs_search tool to filter results',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ResourceHandler = (uri: URL, params?: Record<string, unknown>) => Promise<{
  contents: { uri: string; mimeType: string; text: string }[];
}>;

type RegisterResourceCall = [
  name: string,
  uriOrTemplate: string | unknown,
  metadata: unknown,
  handler: ResourceHandler,
];

/**
 * Build a minimal fake McpServer that captures registerResource calls.
 */
function makeFakeServer(): {
  server: McpServer;
  registerResourceSpy: ReturnType<typeof vi.fn>;
  getHandler: (name: string) => ResourceHandler;
} {
  const calls: RegisterResourceCall[] = [];
  const registerResourceSpy = vi.fn(
    (name: string, uri: unknown, metadata: unknown, handler: ResourceHandler) => {
      calls.push([name, uri, metadata, handler]);
    }
  );

  const server = { registerResource: registerResourceSpy } as unknown as McpServer;

  function getHandler(name: string): ResourceHandler {
    const found = calls.find(c => c[0] === name);
    if (found === undefined) {
      throw new Error(`No handler registered for resource "${name}"`);
    }
    return found[3];
  }

  return { server, registerResourceSpy, getHandler };
}

// ---------------------------------------------------------------------------
// registerResources — registration surface
// ---------------------------------------------------------------------------

describe('registerResources', () => {
  it('should be a function', () => {
    expect(typeof registerResources).toBe('function');
  });

  it('should not throw when called with a compatible server', () => {
    const { server } = makeFakeServer();
    expect(() => registerResources(server, ctx)).not.toThrow();
  });

  it('should call server.registerResource at least once', () => {
    const { server, registerResourceSpy } = makeFakeServer();
    registerResources(server, ctx);
    expect(registerResourceSpy).toHaveBeenCalled();
  });

  it('should register the "products" static resource', () => {
    const { server, registerResourceSpy } = makeFakeServer();
    registerResources(server, ctx);
    const names = registerResourceSpy.mock.calls.map((call: unknown[]) => call[0]);
    expect(names).toContain('products');
  });

  it('should register the "topics" static resource', () => {
    const { server, registerResourceSpy } = makeFakeServer();
    registerResources(server, ctx);
    const names = registerResourceSpy.mock.calls.map((call: unknown[]) => call[0]);
    expect(names).toContain('topics');
  });

  it('should pass a handler function for the "products" resource', () => {
    const { server, registerResourceSpy } = makeFakeServer();
    registerResources(server, ctx);
    const productsCall: unknown[] = registerResourceSpy.mock.calls.find(
      (call: unknown[]) => call[0] === 'products'
    )!;
    expect(typeof productsCall[3]).toBe('function');
  });

  it('should pass a handler function for the "topics" resource', () => {
    const { server, registerResourceSpy } = makeFakeServer();
    registerResources(server, ctx);
    const topicsCall: unknown[] = registerResourceSpy.mock.calls.find(
      (call: unknown[]) => call[0] === 'topics'
    )!;
    expect(typeof topicsCall[3]).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Products resource handler
// ---------------------------------------------------------------------------

describe('products resource handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getProductsResourceData).mockResolvedValue(FAKE_PRODUCTS_DATA);
    vi.mocked(getTopicsResourceData).mockResolvedValue(FAKE_TOPICS_DATA);
  });

  it('should return contents with application/json mimeType', async () => {
    const { server, getHandler } = makeFakeServer();
    registerResources(server, ctx);

    const handler = getHandler('products');
    const result = await handler(new URL('jamf://products'));

    expect(result.contents).toHaveLength(1);
    expect(result.contents[0].mimeType).toBe('application/json');
  });

  it('should return valid JSON in the text field', async () => {
    const { server, getHandler } = makeFakeServer();
    registerResources(server, ctx);

    const handler = getHandler('products');
    const result = await handler(new URL('jamf://products'));

    expect(() => JSON.parse(result.contents[0].text)).not.toThrow();
  });

  it('should include all 4 products in the response', async () => {
    const { server, getHandler } = makeFakeServer();
    registerResources(server, ctx);

    const handler = getHandler('products');
    const result = await handler(new URL('jamf://products'));
    const data = JSON.parse(result.contents[0].text);

    expect(data.products).toHaveLength(12);
  });

  it('should include core product IDs: jamf-pro, jamf-school, jamf-connect, jamf-protect', async () => {
    const { server, getHandler } = makeFakeServer();
    registerResources(server, ctx);

    const handler = getHandler('products');
    const result = await handler(new URL('jamf://products'));
    const data = JSON.parse(result.contents[0].text);

    const ids = data.products.map((p: { id: string }) => p.id);
    expect(ids).toContain('jamf-pro');
    expect(ids).toContain('jamf-school');
    expect(ids).toContain('jamf-connect');
    expect(ids).toContain('jamf-protect');
  });

  it('should include id, name, description, and bundleId fields on each product', async () => {
    const { server, getHandler } = makeFakeServer();
    registerResources(server, ctx);

    const handler = getHandler('products');
    const result = await handler(new URL('jamf://products'));
    const data = JSON.parse(result.contents[0].text);

    for (const product of data.products) {
      expect(typeof product.id).toBe('string');
      expect(product.id.length).toBeGreaterThan(0);
      expect(typeof product.name).toBe('string');
      expect(product.name.length).toBeGreaterThan(0);
      expect(typeof product.description).toBe('string');
      expect(product.description.length).toBeGreaterThan(0);
      expect(typeof product.bundleId).toBe('string');
      expect(product.bundleId.length).toBeGreaterThan(0);
    }
  });

  it('should set uri to "jamf://products" in contents', async () => {
    const { server, getHandler } = makeFakeServer();
    registerResources(server, ctx);

    const handler = getHandler('products');
    const result = await handler(new URL('jamf://products'));

    expect(result.contents[0].uri).toBe('jamf://products');
  });

  it('should call getProductsResourceData exactly once', async () => {
    const { server, getHandler } = makeFakeServer();
    registerResources(server, ctx);

    const handler = getHandler('products');
    await handler(new URL('jamf://products'));

    expect(getProductsResourceData).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Topics resource handler
// ---------------------------------------------------------------------------

describe('topics resource handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getProductsResourceData).mockResolvedValue(FAKE_PRODUCTS_DATA);
    vi.mocked(getTopicsResourceData).mockResolvedValue(FAKE_TOPICS_DATA);
  });

  it('should return contents with application/json mimeType', async () => {
    const { server, getHandler } = makeFakeServer();
    registerResources(server, ctx);

    const handler = getHandler('topics');
    const result = await handler(new URL('jamf://topics'));

    expect(result.contents).toHaveLength(1);
    expect(result.contents[0].mimeType).toBe('application/json');
  });

  it('should return valid JSON in the text field', async () => {
    const { server, getHandler } = makeFakeServer();
    registerResources(server, ctx);

    const handler = getHandler('topics');
    const result = await handler(new URL('jamf://topics'));

    expect(() => JSON.parse(result.contents[0].text)).not.toThrow();
  });

  it('should include topics array in the response', async () => {
    const { server, getHandler } = makeFakeServer();
    registerResources(server, ctx);

    const handler = getHandler('topics');
    const result = await handler(new URL('jamf://topics'));
    const data = JSON.parse(result.contents[0].text);

    expect(Array.isArray(data.topics)).toBe(true);
    expect(data.topics.length).toBeGreaterThan(0);
  });

  it('should include id and name fields on each topic', async () => {
    const { server, getHandler } = makeFakeServer();
    registerResources(server, ctx);

    const handler = getHandler('topics');
    const result = await handler(new URL('jamf://topics'));
    const data = JSON.parse(result.contents[0].text);

    for (const topic of data.topics) {
      expect(typeof topic.id).toBe('string');
      expect(topic.id.length).toBeGreaterThan(0);
      expect(typeof topic.name).toBe('string');
      expect(topic.name.length).toBeGreaterThan(0);
    }
  });

  it('should set uri to "jamf://topics" in contents', async () => {
    const { server, getHandler } = makeFakeServer();
    registerResources(server, ctx);

    const handler = getHandler('topics');
    const result = await handler(new URL('jamf://topics'));

    expect(result.contents[0].uri).toBe('jamf://topics');
  });

  it('should call getTopicsResourceData exactly once', async () => {
    const { server, getHandler } = makeFakeServer();
    registerResources(server, ctx);

    const handler = getHandler('topics');
    await handler(new URL('jamf://topics'));

    expect(getTopicsResourceData).toHaveBeenCalledTimes(1);
  });

  it('should register the "product-toc" template resource', () => {
    const { server, registerResourceSpy } = makeFakeServer();
    registerResources(server, ctx);
    const names = registerResourceSpy.mock.calls.map((call: unknown[]) => call[0]);
    expect(names).toContain('product-toc');
  });

  it('should register the "product-versions" template resource', () => {
    const { server, registerResourceSpy } = makeFakeServer();
    registerResources(server, ctx);
    const names = registerResourceSpy.mock.calls.map((call: unknown[]) => call[0]);
    expect(names).toContain('product-versions');
  });

  it('should include well-known topic IDs like enrollment and security', async () => {
    vi.mocked(getTopicsResourceData).mockResolvedValue({
      ...FAKE_TOPICS_DATA,
      topics: [
        { id: 'enrollment', name: 'Enrollment & Onboarding', source: 'manual' },
        { id: 'security', name: 'Security Settings', source: 'manual' },
        { id: 'policies', name: 'Policies', source: 'manual' },
        { id: 'filevault', name: 'FileVault & Encryption', source: 'manual' },
      ],
      totalTopics: 4,
    });

    const { server, getHandler } = makeFakeServer();
    registerResources(server, ctx);

    const handler = getHandler('topics');
    const result = await handler(new URL('jamf://topics'));
    const data = JSON.parse(result.contents[0].text);

    const topicIds = data.topics.map((t: { id: string }) => t.id);
    expect(topicIds).toContain('enrollment');
    expect(topicIds).toContain('security');
  });
});

// ---------------------------------------------------------------------------
// product-toc resource handler (ResourceTemplate)
// ---------------------------------------------------------------------------

describe('product-toc resource handler', () => {
  const FAKE_TOC_RESULT = {
    toc: [
      { title: 'Overview', url: 'https://learn.jamf.com/overview.html', level: 1, children: [] },
      { title: 'Getting Started', url: 'https://learn.jamf.com/start.html', level: 1, children: [] },
    ],
    pagination: {
      page: 1,
      pageSize: 20,
      totalItems: 2,
      totalPages: 1,
      hasNext: false,
      hasPrev: false,
      startIndex: 0,
      endIndex: 2,
    },
    tokenInfo: { tokenCount: 100, truncated: false, maxTokens: 20000 },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchTableOfContents).mockResolvedValue(FAKE_TOC_RESULT as any);
    vi.mocked(getProductsResourceData).mockResolvedValue(FAKE_PRODUCTS_DATA);
    vi.mocked(getTopicsResourceData).mockResolvedValue(FAKE_TOPICS_DATA);
  });

  it('should return TOC data in JSON format for a valid product', async () => {
    const { server, getHandler } = makeFakeServer();
    registerResources(server, ctx);

    const handler = getHandler('product-toc');
    const uri = new URL('jamf://products/jamf-pro/toc');
    const result = await handler(uri, { productId: 'jamf-pro' });

    expect(result.contents).toHaveLength(1);
    expect(result.contents[0].mimeType).toBe('application/json');
    const data = JSON.parse(result.contents[0].text);
    expect(data.product).toBe('Jamf Pro');
    expect(data.toc).toBeDefined();
    expect(data.totalEntries).toBe(2);
  });

  it('should call fetchTableOfContents with the validated product ID', async () => {
    const { server, getHandler } = makeFakeServer();
    registerResources(server, ctx);

    const handler = getHandler('product-toc');
    await handler(new URL('jamf://products/jamf-pro/toc'), { productId: 'jamf-pro' });

    expect(fetchTableOfContents).toHaveBeenCalledWith(expect.anything(), 'jamf-pro', 'current', { maxTokens: 20000 });
  });

  it('should return error response for invalid product ID', async () => {
    const { server, getHandler } = makeFakeServer();
    registerResources(server, ctx);

    const handler = getHandler('product-toc');
    const uri = new URL('jamf://products/jamf-invalid/toc');
    const result = await handler(uri, { productId: 'jamf-invalid' });

    expect(result.contents[0].text).toContain('Invalid product ID');
    expect(result.contents[0].text).toContain('jamf-invalid');
  });

  it('should include valid product IDs in the error message', async () => {
    const { server, getHandler } = makeFakeServer();
    registerResources(server, ctx);

    const handler = getHandler('product-toc');
    const uri = new URL('jamf://products/bad/toc');
    const result = await handler(uri, { productId: 'bad' });

    expect(result.contents[0].text).toContain('jamf-pro');
  });

  it('should set uri.href in returned contents', async () => {
    const { server, getHandler } = makeFakeServer();
    registerResources(server, ctx);

    const handler = getHandler('product-toc');
    const uri = new URL('jamf://products/jamf-pro/toc');
    const result = await handler(uri, { productId: 'jamf-pro' });

    expect(result.contents[0].uri).toBe(uri.href);
  });
});

// ---------------------------------------------------------------------------
// product-versions resource handler (ResourceTemplate)
// ---------------------------------------------------------------------------

describe('product-versions resource handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAvailableVersions).mockResolvedValue(['11.24.0', '11.23.0', '11.22.0']);
    vi.mocked(getProductsResourceData).mockResolvedValue(FAKE_PRODUCTS_DATA);
    vi.mocked(getTopicsResourceData).mockResolvedValue(FAKE_TOPICS_DATA);
  });

  it('should return versions for a valid product', async () => {
    const { server, getHandler } = makeFakeServer();
    registerResources(server, ctx);

    const handler = getHandler('product-versions');
    const uri = new URL('jamf://products/jamf-pro/versions');
    const result = await handler(uri, { productId: 'jamf-pro' });

    expect(result.contents[0].mimeType).toBe('application/json');
    const data = JSON.parse(result.contents[0].text);
    expect(data.product).toBe('Jamf Pro');
    expect(data.productId).toBe('jamf-pro');
    expect(data.versions).toContain('11.24.0');
    expect(data.versions).toContain('11.23.0');
  });

  it('should include latestVersion in response', async () => {
    const { server, getHandler } = makeFakeServer();
    registerResources(server, ctx);

    const handler = getHandler('product-versions');
    const uri = new URL('jamf://products/jamf-pro/versions');
    const result = await handler(uri, { productId: 'jamf-pro' });

    const data = JSON.parse(result.contents[0].text);
    expect(data.latestVersion).toBe('current');
  });

  it('should call getAvailableVersions with validated product ID', async () => {
    const { server, getHandler } = makeFakeServer();
    registerResources(server, ctx);

    const handler = getHandler('product-versions');
    await handler(new URL('jamf://products/jamf-pro/versions'), { productId: 'jamf-pro' });

    expect(getAvailableVersions).toHaveBeenCalledWith(expect.anything(), 'jamf-pro');
  });

  it('should return error response for invalid product ID', async () => {
    const { server, getHandler } = makeFakeServer();
    registerResources(server, ctx);

    const handler = getHandler('product-versions');
    const uri = new URL('jamf://products/not-a-product/versions');
    const result = await handler(uri, { productId: 'not-a-product' });

    expect(result.contents[0].text).toContain('Invalid product ID');
    expect(result.contents[0].text).toContain('not-a-product');
  });

  it('should set uri.href in returned contents', async () => {
    const { server, getHandler } = makeFakeServer();
    registerResources(server, ctx);

    const handler = getHandler('product-versions');
    const uri = new URL('jamf://products/jamf-pro/versions');
    const result = await handler(uri, { productId: 'jamf-pro' });

    expect(result.contents[0].uri).toBe(uri.href);
  });
});
