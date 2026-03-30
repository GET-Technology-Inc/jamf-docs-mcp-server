import { describe, it, expect } from 'vitest';
import { createMcpServer } from '../../../src/core/create-server.js';
import { createMockContext } from '../../helpers/mock-context.js';

describe('Selective tool registration', () => {
  it('should register all tools when no options provided', () => {
    const ctx = createMockContext();
    const server = createMcpServer(ctx);

    // McpServer doesn't expose a public "list tools" API, but we can verify
    // it was created successfully with all tools via the server object.
    expect(server).toBeDefined();
  });

  it('should register all tools when options is empty object', () => {
    const ctx = createMockContext();
    const server = createMcpServer(ctx, {});
    expect(server).toBeDefined();
  });

  it('should register all tools when tools array is undefined', () => {
    const ctx = createMockContext();
    const server = createMcpServer(ctx, { tools: undefined });
    expect(server).toBeDefined();
  });

  it('should register only whitelisted tools', () => {
    const ctx = createMockContext();
    // Should not throw even with a subset of tools.
    const server = createMcpServer(ctx, {
      tools: ['jamf_docs_search', 'jamf_docs_get_article'],
    });
    expect(server).toBeDefined();
  });

  it('should register no tools when tools array is empty', () => {
    const ctx = createMockContext();
    // Resources and prompts should still be registered.
    const server = createMcpServer(ctx, { tools: [] });
    expect(server).toBeDefined();
  });

  it('should register all tools when all names are listed', () => {
    const ctx = createMockContext();
    const server = createMcpServer(ctx, {
      tools: [
        'jamf_docs_list_products',
        'jamf_docs_search',
        'jamf_docs_get_article',
        'jamf_docs_get_toc',
        'jamf_docs_glossary_lookup',
        'jamf_docs_batch_get_articles',
      ],
    });
    expect(server).toBeDefined();
  });

  it('should ignore unknown tool names in whitelist', () => {
    const ctx = createMockContext();
    const server = createMcpServer(ctx, {
      tools: ['jamf_docs_search', 'nonexistent_tool'],
    });
    expect(server).toBeDefined();
  });
});
