/**
 * Guard tests for the surface `createMcpServer` registers.
 *
 * Every case here used to assert `expect(server).toBeDefined()` — a constructor
 * returning an object — under a comment claiming "McpServer doesn't expose a
 * public 'list tools' API, but we can verify it was created successfully". It
 * does expose one: connect the server to an InMemoryTransport pair and ask,
 * which is what description-accuracy.test.ts has always done. So a whitelist
 * bug could register the wrong tools, or none, and all seven cases stayed green.
 *
 * That mattered more than a dead assertion usually does, because the only place
 * the real tool surface was pinned was test/integration/protocol-2026-07-28,
 * and CI runs the integration job with `continue-on-error: true`. Nothing in
 * the merge gate knew how many tools this server ships.
 */

import { describe, it, expect } from 'vitest';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createMcpServer, TOOL_ORDER, type CreateServerOptions } from '../../../src/core/create-server.js';
import { createMockContext } from '../../helpers/mock-context.js';

/** Build a server, connect a client to it, and read back what it published. */
async function surfaceOf(options?: CreateServerOptions): Promise<{
  tools: string[];
  resources: string[];
  prompts: string[];
}> {
  const server = createMcpServer(createMockContext(), options);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'selective-registration-test', version: '0.0.1' });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    const [tools, resources, prompts] = await Promise.all([
      client.listTools(),
      client.listResources(),
      client.listPrompts(),
    ]);
    return {
      tools: tools.tools.map(t => t.name),
      resources: resources.resources.map(r => r.uri),
      prompts: prompts.prompts.map(p => p.name),
    };
  } finally {
    await client.close();
  }
}

describe('createMcpServer — tool whitelist', () => {
  // The three ways a caller can say "give me everything". The third is the one
  // that matters in practice: `createMcpServer(ctx, { tools: argv.tools })`
  // forwards an absent CLI flag as undefined, and must not mean "no tools".
  it.each([
    ['no options', undefined],
    ['an empty options object', {}],
    ['tools: undefined', { tools: undefined }],
  ])('registers every tool in TOOL_ORDER given %s', async (_label, options) => {
    const { tools } = await surfaceOf(options);
    expect(tools).toEqual([...TOOL_ORDER]);
  });

  it('registers only the whitelisted tools', async () => {
    const { tools } = await surfaceOf({
      tools: ['jamf_docs_search', 'jamf_docs_get_article'],
    });
    expect(tools).toEqual(['jamf_docs_search', 'jamf_docs_get_article']);
  });

  it('emits whitelisted tools in TOOL_ORDER, not the order the caller listed them', async () => {
    // Registration walks TOOL_ORDER and filters, rather than walking the
    // whitelist. That is what makes `tools/list` deterministic across callers —
    // the property protocol revision 2026-07-28 asks for so clients and prompt
    // caches can rely on the list — and reversing the input is the only way to
    // tell the two implementations apart.
    const { tools } = await surfaceOf({
      tools: ['jamf_docs_get_article', 'jamf_docs_search'],
    });
    expect(tools).toEqual(['jamf_docs_search', 'jamf_docs_get_article']);
  });

  it('registers every tool when the whitelist names all of them', async () => {
    const { tools } = await surfaceOf({ tools: [...TOOL_ORDER] });
    expect(tools).toEqual([...TOOL_ORDER]);
  });

  it('ignores unknown names in the whitelist', async () => {
    const { tools } = await surfaceOf({
      tools: ['jamf_docs_search', 'nonexistent_tool'],
    });
    expect(tools).toEqual(['jamf_docs_search']);
  });

  it('registers no tools when the whitelist is empty', async () => {
    const { tools } = await surfaceOf({ tools: [] });
    expect(tools).toEqual([]);
  });
});

describe('createMcpServer — resources and prompts', () => {
  // The whitelist is documented as a *tool* whitelist. An implementation that
  // short-circuited registration on an empty list would take these with it, so
  // the empty case is the one worth pinning.
  it.each([
    ['the default surface', undefined],
    ['an empty tool whitelist', { tools: [] }],
  ])('registers the static resources and every prompt with %s', async (_label, options) => {
    const { resources, prompts } = await surfaceOf(options);

    expect(resources).toContain('jamf://products');
    expect(resources).toContain('jamf://topics');
    expect(prompts).toEqual([
      'jamf_troubleshoot',
      'jamf_setup_guide',
      'jamf_compare_versions',
    ]);
  });

  it('registers the MCP Apps viewer resource', async () => {
    // The URI carries the app bundle hash (ui://jamf-docs/app-<hash>.html), so
    // match the scheme rather than the name — otherwise every app-ui change
    // fails this for the wrong reason.
    const { resources } = await surfaceOf();
    expect(resources.some(uri => uri.startsWith('ui://'))).toBe(true);
  });
});
