/**
 * A url argument is at most 2,048 characters, and the published input schemas
 * say so.
 *
 * Until 2026-09-28 neither `jamf_docs_get_article`'s `url` nor an item of
 * `jamf_docs_batch_get_articles`' `urls` had a bound, and this server's own
 * messages quote a url whole. Measured offline that day through the
 * registered tools, with a url of 100,023 characters: get_article answered
 * "Error fetching article: Unrecognized URL format: <the url>", 100,072
 * characters, and the batch 200,173 characters of markdown, which quotes it
 * twice. A concepts.jamf.com url that long was also requested as it was.
 *
 * The longest article url measured live is far shorter: 273 characters over
 * the 1,932 reader urls of three learn.jamf.com maps (Jamf Pro 11.32.0 and
 * Technical Articles in en-US, Jamf Connect in ja-JP) on 2026-09-28, and 381
 * for the 29 ja and zh-TW support.jamf.com articles captured on 2026-09-26.
 */

import { describe, it, expect } from 'vitest';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createMcpServer } from '../../../src/core/create-server.js';
import { MapsRegistry } from '../../../src/core/services/maps-registry.js';
import { TopicResolver } from '../../../src/core/services/topic-resolver.js';
import type { HttpClient } from '../../../src/core/http-client.js';
import { CONTENT_LIMITS } from '../../../src/core/constants.js';
import { createMockCache, createMockContext } from '../../helpers/mock-context.js';
import { SUPPORT_NON_ASCII_ARTICLES } from '../../fixtures/support-non-ascii-articles.js';
import type { ServerContext } from '../../../src/core/types/context.js';

const LIMIT = 2048;

/** A url on an allowed host, exactly `length` characters long. */
function urlOf(length: number, base = 'https://concepts.jamf.com/'): string {
  return `${base}${'a'.repeat(length - base.length)}`;
}

function offline(): { ctx: ServerContext; requested: string[] } {
  const requested: string[] = [];
  const refuse = async (url: string): Promise<never> => {
    requested.push(url);
    return await Promise.reject(new Error(`offline: no fixture for ${url}`));
  };
  const http: HttpClient = { getJson: refuse, getText: refuse, postJson: refuse };
  const cache = createMockCache();
  const mapsRegistry = new MapsRegistry(cache, undefined, undefined, undefined, http);
  const topicResolver = new TopicResolver(mapsRegistry, cache, undefined, undefined, http);
  return { ctx: createMockContext({ cache, http, mapsRegistry, topicResolver }), requested };
}

async function connect(ctx: ServerContext): Promise<{ client: Client; close: () => Promise<void> }> {
  const server = createMcpServer(ctx);
  const client = new Client({ name: 'test-client', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

async function call(ctx: ServerContext, name: string, args: Record<string, unknown>): Promise<{ isError?: boolean; text: string }> {
  const { client, close } = await connect(ctx);
  try {
    const result = await client.callTool({ name, arguments: args });
    const text = (result.content as { type: string; text?: string }[]).map(c => c.text ?? '').join('\n\n');
    return { ...(result.isError !== undefined ? { isError: result.isError } : {}), text };
  } finally {
    await close();
  }
}

describe('the published input schemas bound every url', () => {
  it('jamf_docs_get_article\'s url and each of jamf_docs_batch_get_articles\' urls', async () => {
    const { client, close } = await connect(offline().ctx);
    try {
      const { tools } = await client.listTools();
      const schema = (name: string): Partial<Record<string, { maxLength?: number; items?: { maxLength?: number } }>> =>
        tools.find(tool => tool.name === name)?.inputSchema.properties as never;

      expect(CONTENT_LIMITS.MAX_URL_LENGTH).toBe(LIMIT);
      expect(schema('jamf_docs_get_article').url?.maxLength).toBe(LIMIT);
      expect(schema('jamf_docs_batch_get_articles').urls?.items?.maxLength).toBe(LIMIT);
    } finally {
      await close();
    }
  });
});

describe('a longer url is refused before anything is fetched, and not quoted back', () => {
  it('jamf_docs_get_article', async () => {
    const { ctx, requested } = offline();
    const url = urlOf(LIMIT + 1);

    const reply = await call(ctx, 'jamf_docs_get_article', { url });

    expect(reply.isError).toBe(true);
    expect(reply.text).toContain(`URL must not exceed ${String(LIMIT)} characters`);
    expect(reply.text).not.toContain('a'.repeat(100));
    expect(reply.text.length).toBeLessThan(1_000);
    expect(requested).toEqual([]);
  });

  it('jamf_docs_batch_get_articles', async () => {
    const { ctx, requested } = offline();

    const reply = await call(ctx, 'jamf_docs_batch_get_articles', {
      urls: ['https://concepts.jamf.com/api-utility/', urlOf(100_000)],
    });

    expect(reply.isError).toBe(true);
    expect(reply.text).toContain(`Each URL must not exceed ${String(LIMIT)} characters`);
    expect(reply.text).not.toContain('a'.repeat(100));
    expect(reply.text.length).toBeLessThan(1_000);
    expect(requested).toEqual([]);
  });
});

describe('a url of up to 2,048 characters is taken', () => {
  it('exactly 2,048: fetched', async () => {
    const { ctx, requested } = offline();
    const url = urlOf(LIMIT);

    const article = await call(ctx, 'jamf_docs_get_article', { url });
    const batch = await call(ctx, 'jamf_docs_batch_get_articles', { urls: [url], responseFormat: 'json' });

    // Offline, so each fails as its fetch, past the schema.
    expect(article.text).toMatch(/^Error fetching article: /);
    expect(JSON.parse(batch.text)).toMatchObject({ summary: { total: 1, failed: 1 } });
    expect(requested.length).toBeGreaterThan(0);
  });

  it('the longest support.jamf.com article url captured', async () => {
    const longest = SUPPORT_NON_ASCII_ARTICLES
      .map(article => new URL(`https://support.jamf.com${article.listed}`).href)
      .reduce((a, b) => (b.length > a.length ? b : a));

    const reply = await call(offline().ctx, 'jamf_docs_get_article', { url: longest });

    expect(longest.length).toBeLessThan(LIMIT);
    expect(reply.text).not.toContain('must not exceed');
  });
});
