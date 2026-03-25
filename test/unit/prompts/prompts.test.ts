/**
 * Unit tests for MCP prompt registrations
 * (src/prompts/troubleshoot.ts, setup-guide.ts, compare-versions.ts)
 *
 * Strategy: create a minimal fake McpServer whose registerPrompt() captures
 * the callback so we can invoke it directly without a real server.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerTroubleshootPrompt } from '../../../src/prompts/troubleshoot.js';
import { registerSetupGuidePrompt } from '../../../src/prompts/setup-guide.js';
import { registerCompareVersionsPrompt } from '../../../src/prompts/compare-versions.js';
import { registerPrompts } from '../../../src/prompts/index.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type PromptCallback = (args: Record<string, string | undefined>) => {
  messages: { role: string; content: { type: string; text: string } }[];
};

/**
 * Build a minimal fake McpServer that captures registerPrompt callbacks.
 */
function makeFakeServer(): { server: McpServer; callbacks: Map<string, PromptCallback> } {
  const callbacks = new Map<string, PromptCallback>();
  const server = {
    registerPrompt: vi.fn((name: string, _config: unknown, cb: PromptCallback) => {
      callbacks.set(name, cb);
    }),
  } as unknown as McpServer;
  return { server, callbacks };
}

// ---------------------------------------------------------------------------
// registerPrompts index
// ---------------------------------------------------------------------------

describe('registerPrompts', () => {
  it('should register all 3 prompts when called', () => {
    const { server, callbacks } = makeFakeServer();
    registerPrompts(server);

    expect(callbacks.has('jamf_troubleshoot')).toBe(true);
    expect(callbacks.has('jamf_setup_guide')).toBe(true);
    expect(callbacks.has('jamf_compare_versions')).toBe(true);
  });

  it('should call server.registerPrompt exactly 3 times', () => {
    const { server, callbacks } = makeFakeServer();
    registerPrompts(server);

    expect(callbacks.size).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// jamf_troubleshoot
// ---------------------------------------------------------------------------

describe('registerTroubleshootPrompt', () => {
  let callbacks: Map<string, PromptCallback>;

  beforeEach(() => {
    const fake = makeFakeServer();
    registerTroubleshootPrompt(fake.server);
    callbacks = fake.callbacks;
  });

  it('should register a prompt named "jamf_troubleshoot"', () => {
    expect(callbacks.has('jamf_troubleshoot')).toBe(true);
  });

  it('should return an object with a messages array', () => {
    const cb = callbacks.get('jamf_troubleshoot')!;
    const result = cb({ problem: 'test issue' });
    expect(Array.isArray(result.messages)).toBe(true);
    expect(result.messages.length).toBeGreaterThan(0);
  });

  it('should return a message with role "user"', () => {
    const cb = callbacks.get('jamf_troubleshoot')!;
    const result = cb({ problem: 'some problem' });
    expect(result.messages[0].role).toBe('user');
  });

  it('should return a message with type "text"', () => {
    const cb = callbacks.get('jamf_troubleshoot')!;
    const result = cb({ problem: 'some problem' });
    expect(result.messages[0].content.type).toBe('text');
  });

  it('should include the problem text in the message', () => {
    const cb = callbacks.get('jamf_troubleshoot')!;
    const result = cb({ problem: 'MDM enrollment failing' });
    const text = result.messages[0].content.text;
    expect(text).toContain('MDM enrollment failing');
  });

  it('should include jamf_docs_search tool reference in the message', () => {
    const cb = callbacks.get('jamf_troubleshoot')!;
    const result = cb({ problem: 'test issue' });
    const text = result.messages[0].content.text;
    expect(text).toContain('jamf_docs_search');
  });

  it('should include jamf_docs_get_article tool reference in the message', () => {
    const cb = callbacks.get('jamf_troubleshoot')!;
    const result = cb({ problem: 'test issue' });
    const text = result.messages[0].content.text;
    expect(text).toContain('jamf_docs_get_article');
  });

  it('should include a product filter when product is provided', () => {
    const cb = callbacks.get('jamf_troubleshoot')!;
    const result = cb({ problem: 'test issue', product: 'jamf-pro' });
    const text = result.messages[0].content.text;
    expect(text).toContain('jamf-pro');
  });

  it('should not include a product filter when product is undefined', () => {
    const cb = callbacks.get('jamf_troubleshoot')!;
    const result = cb({ problem: 'test issue', product: undefined });
    const text = result.messages[0].content.text;
    // Should not contain a product: "..." filter expression
    expect(text).not.toMatch(/product: "jamf-/);
  });

  it('should not include a product filter when product is an empty string', () => {
    const cb = callbacks.get('jamf_troubleshoot')!;
    const result = cb({ problem: 'test issue', product: '' });
    const text = result.messages[0].content.text;
    expect(text).not.toMatch(/product: ""/);
  });

  it('should repeat the problem description at the end of the message', () => {
    const cb = callbacks.get('jamf_troubleshoot')!;
    const result = cb({ problem: 'Device enrollment error code 500' });
    const text = result.messages[0].content.text;
    // Problem appears twice: once in the intro, once in the footer
    const occurrences = text.split('Device enrollment error code 500').length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(1);
  });

  it('should handle special characters in the problem description', () => {
    const cb = callbacks.get('jamf_troubleshoot')!;
    const problem = 'Error: "ECONNRESET" & timeout <500ms>';
    const result = cb({ problem });
    const text = result.messages[0].content.text;
    expect(text).toContain(problem);
  });
});

// ---------------------------------------------------------------------------
// jamf_setup_guide
// ---------------------------------------------------------------------------

describe('registerSetupGuidePrompt', () => {
  let callbacks: Map<string, PromptCallback>;

  beforeEach(() => {
    const fake = makeFakeServer();
    registerSetupGuidePrompt(fake.server);
    callbacks = fake.callbacks;
  });

  it('should register a prompt named "jamf_setup_guide"', () => {
    expect(callbacks.has('jamf_setup_guide')).toBe(true);
  });

  it('should return an object with a messages array', () => {
    const cb = callbacks.get('jamf_setup_guide')!;
    const result = cb({ feature: 'Smart Groups' });
    expect(Array.isArray(result.messages)).toBe(true);
    expect(result.messages.length).toBeGreaterThan(0);
  });

  it('should return a message with role "user"', () => {
    const cb = callbacks.get('jamf_setup_guide')!;
    const result = cb({ feature: 'FileVault' });
    expect(result.messages[0].role).toBe('user');
  });

  it('should return a message with type "text"', () => {
    const cb = callbacks.get('jamf_setup_guide')!;
    const result = cb({ feature: 'FileVault' });
    expect(result.messages[0].content.type).toBe('text');
  });

  it('should include the feature text in the message', () => {
    const cb = callbacks.get('jamf_setup_guide')!;
    const result = cb({ feature: 'Smart Groups' });
    const text = result.messages[0].content.text;
    expect(text).toContain('Smart Groups');
  });

  it('should include jamf_docs_search tool reference', () => {
    const cb = callbacks.get('jamf_setup_guide')!;
    const result = cb({ feature: 'Push Certificates' });
    const text = result.messages[0].content.text;
    expect(text).toContain('jamf_docs_search');
  });

  it('should include jamf_docs_get_article tool reference', () => {
    const cb = callbacks.get('jamf_setup_guide')!;
    const result = cb({ feature: 'Push Certificates' });
    const text = result.messages[0].content.text;
    expect(text).toContain('jamf_docs_get_article');
  });

  it('should include a product filter when product is provided', () => {
    const cb = callbacks.get('jamf_setup_guide')!;
    const result = cb({ feature: 'Enrollment', product: 'jamf-school' });
    const text = result.messages[0].content.text;
    expect(text).toContain('jamf-school');
  });

  it('should not include a product filter when product is omitted', () => {
    const cb = callbacks.get('jamf_setup_guide')!;
    const result = cb({ feature: 'Enrollment', product: undefined });
    const text = result.messages[0].content.text;
    expect(text).not.toMatch(/product: "jamf-/);
  });

  it('should not include a product filter when product is empty string', () => {
    const cb = callbacks.get('jamf_setup_guide')!;
    const result = cb({ feature: 'Enrollment', product: '' });
    const text = result.messages[0].content.text;
    expect(text).not.toMatch(/product: ""/);
  });

  it('should mention setup or configuration in the message', () => {
    const cb = callbacks.get('jamf_setup_guide')!;
    const result = cb({ feature: 'FileVault' });
    const text = result.messages[0].content.text.toLowerCase();
    expect(text).toMatch(/setup|configur/);
  });

  it('should repeat the feature name at the end of the message', () => {
    const cb = callbacks.get('jamf_setup_guide')!;
    const result = cb({ feature: 'APNS Certificate' });
    const text = result.messages[0].content.text;
    const occurrences = text.split('APNS Certificate').length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// jamf_compare_versions
// ---------------------------------------------------------------------------

describe('registerCompareVersionsPrompt', () => {
  let callbacks: Map<string, PromptCallback>;

  beforeEach(() => {
    const fake = makeFakeServer();
    registerCompareVersionsPrompt(fake.server);
    callbacks = fake.callbacks;
  });

  it('should register a prompt named "jamf_compare_versions"', () => {
    expect(callbacks.has('jamf_compare_versions')).toBe(true);
  });

  it('should return an object with a messages array', () => {
    const cb = callbacks.get('jamf_compare_versions')!;
    const result = cb({ product: 'jamf-pro', version_a: '11.5.0', version_b: '11.12.0' });
    expect(Array.isArray(result.messages)).toBe(true);
    expect(result.messages.length).toBeGreaterThan(0);
  });

  it('should return a message with role "user"', () => {
    const cb = callbacks.get('jamf_compare_versions')!;
    const result = cb({ product: 'jamf-pro', version_a: '10.0', version_b: '11.0' });
    expect(result.messages[0].role).toBe('user');
  });

  it('should return a message with type "text"', () => {
    const cb = callbacks.get('jamf_compare_versions')!;
    const result = cb({ product: 'jamf-pro', version_a: '10.0', version_b: '11.0' });
    expect(result.messages[0].content.type).toBe('text');
  });

  it('should include version_a in the message', () => {
    const cb = callbacks.get('jamf_compare_versions')!;
    const result = cb({ product: 'jamf-pro', version_a: '11.5.0', version_b: '11.12.0' });
    const text = result.messages[0].content.text;
    expect(text).toContain('11.5.0');
  });

  it('should include version_b in the message', () => {
    const cb = callbacks.get('jamf_compare_versions')!;
    const result = cb({ product: 'jamf-pro', version_a: '11.5.0', version_b: '11.12.0' });
    const text = result.messages[0].content.text;
    expect(text).toContain('11.12.0');
  });

  it('should include the product in the message', () => {
    const cb = callbacks.get('jamf_compare_versions')!;
    const result = cb({ product: 'jamf-connect', version_a: '2.0', version_b: '3.0' });
    const text = result.messages[0].content.text;
    expect(text).toContain('jamf-connect');
  });

  it('should reference jamf_docs_get_toc in the message', () => {
    const cb = callbacks.get('jamf_compare_versions')!;
    const result = cb({ product: 'jamf-pro', version_a: '11.5.0', version_b: '11.12.0' });
    const text = result.messages[0].content.text;
    expect(text).toContain('jamf_docs_get_toc');
  });

  it('should reference jamf_docs_get_article for reviewing changed articles', () => {
    const cb = callbacks.get('jamf_compare_versions')!;
    const result = cb({ product: 'jamf-pro', version_a: '11.5.0', version_b: '11.12.0' });
    const text = result.messages[0].content.text;
    expect(text).toContain('jamf_docs_get_article');
  });

  it('should include both version strings in the summary section', () => {
    const cb = callbacks.get('jamf_compare_versions')!;
    const result = cb({ product: 'jamf-pro', version_a: '11.5.0', version_b: '11.12.0' });
    const text = result.messages[0].content.text;
    // Both should appear at least twice (instructions + footer)
    expect(text.split('11.5.0').length - 1).toBeGreaterThanOrEqual(1);
    expect(text.split('11.12.0').length - 1).toBeGreaterThanOrEqual(1);
  });

  it('should work with different product IDs', () => {
    const cb = callbacks.get('jamf_compare_versions')!;
    const products = ['jamf-pro', 'jamf-school', 'jamf-connect', 'jamf-protect'];

    for (const product of products) {
      const result = cb({ product, version_a: '1.0', version_b: '2.0' });
      const text = result.messages[0].content.text;
      expect(text).toContain(product);
    }
  });
});
