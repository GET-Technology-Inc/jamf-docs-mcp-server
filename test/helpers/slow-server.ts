/**
 * A minimal MCP server whose only tool sleeps for a caller-chosen duration.
 *
 * Shutdown behaviour is about timing, so the tests need a call that is
 * reliably still in flight when the signal lands. A sleep gives that
 * deterministically and without touching the network.
 */

import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

export function createSlowServer(): McpServer {
  const server = new McpServer({ name: 'slow-fixture', version: '1.0.0' });

  server.registerTool(
    'slow',
    {
      description: 'Sleeps for the requested number of milliseconds.',
      inputSchema: { ms: z.number().int().min(0).max(60_000) },
    },
    async ({ ms }) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return { content: [{ type: 'text' as const, text: `slept ${String(ms)}ms` }] };
    },
  );

  return server;
}
