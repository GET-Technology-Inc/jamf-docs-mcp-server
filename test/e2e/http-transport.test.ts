/**
 * E2E tests for HTTP transport
 *
 * Starts a real HTTP server process and sends JSON-RPC requests
 * to exercise the full HTTP → MCP → Tool → External API chain.
 *
 * These tests hit real external APIs (learn.jamf.com).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readJsonRpc } from '../helpers/streamable-http.js';
import { asJsonObject } from '../helpers/fixtures.js';
import { spawn, type ChildProcess } from 'child_process';
import path from 'path';
import { requireFreshBuild } from '../helpers/require-fresh-build.js';
import { getFreePort, waitForServerStart } from '../helpers/server-process.js';
import { PRODUCT_IDS } from '../../src/core/constants/products.js';

// ============================================================================
// HTTP Server lifecycle helpers
// ============================================================================

// Set once the server is up. The port is a free one, not a fixed one (13580
// before), so two runs on one machine do not fail each other; see
// server-process.ts.
let baseUrl = '';
let httpProcess: ChildProcess | undefined;

// Track session state for JSON-RPC
let requestId = 0;
let sessionId: string | undefined;

function nextId(): number {
  return ++requestId;
}

/**
 * Send a JSON-RPC request over HTTP and return the parsed response.
 */
async function jsonRpc(
  method: string,
  params?: Record<string, unknown>,
  options?: { isNotification?: boolean }
): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = {
    jsonrpc: '2.0',
    method,
  };

  if (options?.isNotification !== true) {
    body.id = nextId();
  }

  if (params !== undefined) {
    body.params = params;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
  };

  if (sessionId !== undefined) {
    headers['mcp-session-id'] = sessionId;
  }

  const res = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  // Capture session ID from response header
  const sid = res.headers.get('mcp-session-id');
  if (sid !== null) {
    sessionId = sid;
  }

  if (options?.isNotification === true) {
    return { status: res.status };
  }

  return await readJsonRpc(res);
}

/**
 * Initialize and establish a session.
 */
async function initializeSession(): Promise<void> {
  const initResult = await jsonRpc('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'e2e-http-test', version: '1.0.0' },
  });

  expect(initResult.result).toBeDefined();

  // Send initialized notification
  await jsonRpc('notifications/initialized', undefined, { isNotification: true });
}

/**
 * Call a tool via JSON-RPC and return the result.
 */
async function callTool(
  name: string,
  args: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  const response = await jsonRpc('tools/call', { name, arguments: args });
  return (response.result ?? response.error ?? response) as Record<string, unknown>;
}

// ============================================================================
// Test suite
// ============================================================================

describe('HTTP Transport E2E', { timeout: 60000 }, () => {
  beforeAll(async () => {
    // Spawns dist/index.js; see require-fresh-build.
    requireFreshBuild();

    const port = await getFreePort();
    const serverPath = path.resolve(process.cwd(), 'dist/index.js');
    const proc = spawn(
      'node',
      [serverPath, '--transport', 'http', '--port', String(port)],
      { stdio: ['pipe', 'pipe', 'pipe'] }
    );
    httpProcess = proc;

    // A server that exits instead (a taken port, say) fails this hook at
    // once, quoting its stderr. The hook outlasts the start budget so that a
    // server that hangs is reported the same way, not as a bare timeout.
    await waitForServerStart(proc, 10_000);
    baseUrl = `http://127.0.0.1:${String(port)}`;

    // Establish MCP session
    await initializeSession();
  }, 20_000);

  afterAll(() => {
    httpProcess?.kill('SIGTERM');
  });

  // --------------------------------------------------------------------------
  // Health check coexistence
  // --------------------------------------------------------------------------

  describe('health check coexistence', () => {
    it('should respond to /health alongside MCP session', async () => {
      const res = await fetch(`${baseUrl}/health`);
      expect(res.status).toBe(200);
      const data = asJsonObject(await res.json());
      expect(data.status).toBe('ok');
      expect(data.version).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // Tool calls via HTTP transport
  // --------------------------------------------------------------------------

  describe('list_products via HTTP', () => {
    it('should return available products', async () => {
      const result = await callTool('jamf_docs_list_products', { responseFormat: 'json' });

      expect(result.isError).toBeUndefined();
      const content = result.content as { type: string; text: string }[];
      expect(content).toHaveLength(1);

      const json = JSON.parse(content[0].text);
      // Product count depends on live API availability; assert a reasonable range
      expect(json.products.length).toBeGreaterThanOrEqual(4);
      expect(json.products.length).toBeLessThanOrEqual(PRODUCT_IDS.length);

      // Each product should have expected shape
      for (const p of json.products) {
        expect(p.id).toBeDefined();
        expect(p.name).toBeDefined();
      }
    });
  });

  describe('search via HTTP', () => {
    it('should search and return real results', async () => {
      const result = await callTool('jamf_docs_search', {
        query: 'configuration profile',
        responseFormat: 'json',
      });

      expect(result.isError).toBeUndefined();
      const content = result.content as { type: string; text: string }[];
      const json = JSON.parse(content[0].text);

      expect(json.results).toBeDefined();
      expect(json.results.length).toBeGreaterThan(0);
      expect(json.query).toBe('configuration profile');
      expect(json.pagination).toBeDefined();
      expect(json.tokenInfo).toBeDefined();
    });
  });

  describe('get_article via HTTP', () => {
    let articleUrl: string;

    beforeAll(async () => {
      // Get a valid article URL from search
      const result = await callTool('jamf_docs_search', {
        query: 'policies',
        limit: 1,
        responseFormat: 'json',
      });
      const content = result.content as { type: string; text: string }[];
      const json = JSON.parse(content[0].text);
      articleUrl = json.results[0]?.url
        ?? 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/Policies.html';
    });

    it('should fetch article content via HTTP', async () => {
      const result = await callTool('jamf_docs_get_article', {
        url: articleUrl,
        responseFormat: 'json',
      });

      expect(result.isError).toBeUndefined();
      const content = result.content as { type: string; text: string }[];
      const json = JSON.parse(content[0].text);

      expect(json.title).toBeDefined();
      expect(json.content.length).toBeGreaterThan(100);
      expect(json.tokenInfo).toBeDefined();
    });
  });

  describe('get_toc via HTTP', () => {
    it('should fetch TOC for jamf-pro', async () => {
      const result = await callTool('jamf_docs_get_toc', {
        product: 'jamf-pro',
        responseFormat: 'json',
      });

      expect(result.isError).toBeUndefined();
      const content = result.content as { type: string; text: string }[];
      const json = JSON.parse(content[0].text);

      expect(json.product).toContain('Jamf Pro');
      expect(json.toc.length).toBeGreaterThan(0);
      expect(json.pagination).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // Error handling via HTTP transport
  // --------------------------------------------------------------------------

  describe('error handling via HTTP', () => {
    it('should return isError for invalid URL in get_article', async () => {
      const result = await callTool('jamf_docs_get_article', {
        url: 'https://example.com/not-jamf',
      });

      expect(result.isError).toBe(true);
      const content = result.content as { type: string; text: string }[];
      expect(content[0].text).toContain('must be from');
    });

    it('should return isError for invalid product in get_toc', async () => {
      const result = await callTool('jamf_docs_get_toc', {
        product: 'invalid-product',
      });

      expect(result.isError).toBe(true);
    });

    it('should return error for nonexistent tool', async () => {
      const response = await jsonRpc('tools/call', {
        name: 'nonexistent_tool',
        arguments: {},
      });

      // MCP SDK may return JSON-RPC error or tool-level error
      const hasError = response.error !== undefined
        || (response.result as Record<string, unknown>).isError === true;
      expect(hasError).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Session lifecycle
  // --------------------------------------------------------------------------

  describe('session lifecycle', () => {
    it('should maintain session across multiple tool calls', async () => {
      // First call
      const result1 = await callTool('jamf_docs_list_products');
      expect(result1.isError).toBeUndefined();

      // Second call - should work within same session
      const result2 = await callTool('jamf_docs_search', {
        query: 'enrollment',
        responseFormat: 'json',
      });
      expect(result2.isError).toBeUndefined();
      const content = result2.content as { type: string; text: string }[];
      const json = JSON.parse(content[0].text);
      expect(json.results.length).toBeGreaterThan(0);
    });
  });
});
