/**
 * The cap on how large a `tools/call` `arguments` payload may be, counted in
 * array elements and object members (`maxToolInputElements`, SDK 2.3.0).
 *
 * Each tool's schema already bounds what it accepts — at most 10 urls a batch
 * — but the schema only runs after zod has walked the whole payload. The cap
 * runs first, so a call of a million urls is refused without that walk.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createMcpServer } from '../../../src/core/create-server.js';
import { CONTENT_LIMITS } from '../../../src/core/constants.js';
import { createMockContext } from '../../helpers/mock-context.js';

let client: Client | undefined;

afterEach(async () => {
  await client?.close();
  client = undefined;
});

async function call(args: Record<string, unknown>): Promise<{ isError: boolean | undefined; text: string }> {
  const server = createMcpServer(createMockContext());
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'tool-input-limit-test', version: '0.0.1' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const result = await client.callTool({ name: 'jamf_docs_batch_get_articles', arguments: args });
  const content = Array.isArray(result.content) ? result.content : [];
  const text = content.map(block => ('text' in block ? block.text : '')).join('\n');
  return { isError: result.isError, text };
}

const CAP_MESSAGE = `more than the maximum of ${String(CONTENT_LIMITS.MAX_TOOL_INPUT_ELEMENTS)} elements`;

describe('tools/call input element cap', () => {
  it('refuses a payload over the cap before its schema runs', async () => {
    const urls = Array.from({ length: CONTENT_LIMITS.MAX_TOOL_INPUT_ELEMENTS + 1 }, (_, i) => `u${String(i)}`);
    const { isError, text } = await call({ urls });
    expect(isError).toBe(true);
    expect(text).toContain(CAP_MESSAGE);
  });

  it('leaves the largest payload a tool accepts to its own schema', async () => {
    // The batch tool's ceiling is 10 urls; invalid ones keep the call off the
    // network while still reaching schema validation, past the cap.
    const urls = Array.from({ length: 10 }, (_, i) => `u${String(i)}`);
    const { isError, text } = await call({ urls, maxTokens: 5000, outputMode: 'compact' });
    expect(isError).toBe(true);
    expect(text).not.toContain(CAP_MESSAGE);
  });
});
