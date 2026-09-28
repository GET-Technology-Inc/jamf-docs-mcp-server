/**
 * Every string a tool takes is bounded, and the published input schemas say
 * so: an enum, or a `maxLength`.
 *
 * Until 2026-09-28 three were not: `jamf_docs_get_article`'s `section`, and
 * the `version` of `jamf_docs_search` and `jamf_docs_get_toc`. Measured
 * offline that day through the registered tools:
 *
 *  - a `section` of 100,000 characters got a 485-character reply with an
 *    empty body and "*(truncated)*", and nothing saying the section was not
 *    found: its own "Section … not found" line was larger than `maxTokens`.
 *    Live on Computer Configuration Profiles it was the same, 534 characters;
 *  - a `version` of 100,000 digits, which the pattern accepts, went to
 *    Fluid Topics as a clustered search of 100,143 bytes;
 *  - and `jamf_docs_get_toc` answered it with 100,063 characters, quoting it.
 *
 * The bounds: 200 characters for `section`, as for `mapId`, `contentId` and
 * `publication`. The longest topic title measured live on 2026-09-28 is 149
 * characters, over 3,549 topics of six maps, and at 200 the not-found line
 * still fits the smallest `maxTokens`. 50 for a `version`, as for
 * `jamf_compare_versions`' `version_a` and `version_b`; the longest of the 46
 * versions in the maps list that day was 7 (`11.32.1`).
 *
 * The prompts and the resource templates take a product ID as free text,
 * where the tools take one of the IDs. Until the same day `jamf_troubleshoot`
 * and `jamf_setup_guide` took a `product` of any length and wrote it into the
 * prompt twice, and `jamf://products/{productId}/toc` and `/versions` quoted
 * a `productId` of any length back, in the uri and in the text: offline, one
 * of 100,000 characters got prompts of 200,773 and 200,902 characters, and
 * reads of 200,616 and 200,621. Each is now bounded at 100 characters, as
 * `jamf_compare_versions`' `product` was, and a longer one is refused without
 * being quoted.
 */

import { describe, it, expect } from 'vitest';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createMcpServer } from '../../../src/core/create-server.js';
import { MapsRegistry } from '../../../src/core/services/maps-registry.js';
import { TopicResolver } from '../../../src/core/services/topic-resolver.js';
import type { HttpClient } from '../../../src/core/http-client.js';
import { CONTENT_LIMITS, JAMF_PRODUCTS, TOKEN_CONFIG } from '../../../src/core/constants.js';
import { createMockCache, createMockContext } from '../../helpers/mock-context.js';
import { articleUpstream, CCP, PRO_MAP } from '../../helpers/article-upstream.js';
import type { ServerContext } from '../../../src/core/types/context.js';

const SECTION_LIMIT = 200;
const VERSION_LIMIT = 50;
const PRODUCT_LIMIT = 100;

/** Every request is recorded; the article fixtures answer, and nothing else does. */
function offline(): { ctx: ServerContext; requested: string[] } {
  const requested: string[] = [];
  const articles = articleUpstream();
  const refuse = async (url: string): Promise<never> => await Promise.reject(new Error(`offline: no fixture for ${url}`));
  const http: HttpClient = {
    getJson: async <T>(url: string) => {
      requested.push(url);
      return await articles.getJson(url) as T;
    },
    getText: async (url: string) => {
      requested.push(url);
      return await articles.getText(url);
    },
    postJson: async (url: string) => {
      requested.push(url);
      return await refuse(url);
    },
  };
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

/** The parts of a JSON Schema that can hold a string, or bound one. */
interface JsonSchema {
  type?: string | string[];
  enum?: unknown[];
  const?: unknown;
  maxLength?: number;
  description?: string;
  properties?: Record<string, JsonSchema>;
  additionalProperties?: JsonSchema | boolean;
  items?: JsonSchema | JsonSchema[];
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
}

/**
 * Each string a schema takes, by path, at any depth: a property's, a nested
 * object's (`a.b`), an array's items (`a[]`), an object's other properties
 * (`a{}`), and each branch of a union, a type that lists `string` among
 * others included.
 */
function stringInputs(schema: JsonSchema, path = ''): [string, JsonSchema][] {
  const types = Array.isArray(schema.type) ? schema.type : schema.type === undefined ? [] : [schema.type];
  const found: [string, JsonSchema][] = types.includes('string') ? [[path, schema]] : [];
  for (const [name, property] of Object.entries(schema.properties ?? {})) {
    found.push(...stringInputs(property, path === '' ? name : `${path}.${name}`));
  }
  if (typeof schema.additionalProperties === 'object') {
    found.push(...stringInputs(schema.additionalProperties, `${path}{}`));
  }
  const items = schema.items === undefined ? [] : Array.isArray(schema.items) ? schema.items : [schema.items];
  for (const item of items) {
    found.push(...stringInputs(item, `${path}[]`));
  }
  for (const branch of [...(schema.anyOf ?? []), ...(schema.oneOf ?? []), ...(schema.allOf ?? [])]) {
    found.push(...stringInputs(branch, path));
  }
  return found;
}

const unboundedIn = (schema: JsonSchema): string[] => stringInputs(schema)
  .filter(([, string]) => string.enum === undefined && string.const === undefined && string.maxLength === undefined)
  .map(([path]) => path);

describe('the walk finds a string wherever a schema can hold one', () => {
  it('nested, in arrays, in unions and among other types', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: {
        flat: { type: 'string' },
        bounded: { type: 'string', maxLength: 10 },
        choice: { type: 'string', enum: ['a', 'b'] },
        nested: { type: 'object', properties: { deeper: { type: 'object', properties: { leaf: { type: 'string' } } } } },
        list: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' } } } },
        either: { anyOf: [{ type: 'number' }, { type: 'string' }] },
        nullable: { type: ['string', 'null'] },
        map: { type: 'object', additionalProperties: { type: 'string' } },
      },
    };

    expect(unboundedIn(schema)).toEqual(['flat', 'nested.deeper.leaf', 'list[].name', 'either', 'nullable', 'map{}']);
  });
});

describe('the published input schemas bound every string', () => {
  it('each string of each tool, at any depth, has an enum or a maxLength', async () => {
    const { client, close } = await connect(offline().ctx);
    try {
      const { tools } = await client.listTools();
      const unbounded = tools.flatMap(tool =>
        unboundedIn(tool.inputSchema as JsonSchema).map(path => `${tool.name}.${path}`));
      const counted = tools.flatMap(tool => stringInputs(tool.inputSchema as JsonSchema));

      expect(unbounded).toEqual([]);
      // The walk sees what it is meant to: all six tools' strings, arrays included.
      expect(tools).toHaveLength(6);
      expect(counted.map(([name]) => name)).toContain('urls[]');
      expect(counted.length).toBeGreaterThanOrEqual(30);
    } finally {
      await close();
    }
  });

  it('section: 200; version: 50, on both tools that take one, and the descriptions say so', async () => {
    const { client, close } = await connect(offline().ctx);
    try {
      const { tools } = await client.listTools();
      const tool = (name: string): (typeof tools)[number] | undefined => tools.find(t => t.name === name);
      const property = (name: string, key: string): JsonSchema | undefined =>
        (tool(name)?.inputSchema.properties as Record<string, JsonSchema> | undefined)?.[key];

      expect(CONTENT_LIMITS.MAX_SECTION_LENGTH).toBe(SECTION_LIMIT);
      expect(CONTENT_LIMITS.MAX_VERSION_LENGTH).toBe(VERSION_LIMIT);
      expect(property('jamf_docs_get_article', 'section')?.maxLength).toBe(SECTION_LIMIT);
      expect(property('jamf_docs_get_article', 'section')?.description).toContain(`at most ${String(SECTION_LIMIT)} characters`);
      expect(tool('jamf_docs_get_article')?.description).toContain(
        `Use the \`section\` parameter, at most ${String(SECTION_LIMIT)} characters, to retrieve\nspecific sections`
      );
      for (const name of ['jamf_docs_search', 'jamf_docs_get_toc']) {
        expect(property(name, 'version')?.maxLength).toBe(VERSION_LIMIT);
        expect(property(name, 'version')?.description).toContain(`at most ${String(VERSION_LIMIT)} characters`);
        expect(tool(name)?.description).toMatch(
          new RegExp(`\\n {2}- version \\(string, optional\\): [^\\n]*, at most ${String(VERSION_LIMIT)} characters\\n`)
        );
      }
    } finally {
      await close();
    }
  });
});

describe('a longer section is refused before anything is fetched, and not quoted back', () => {
  it.each([SECTION_LIMIT + 1, 100_000])('%i characters', async (length) => {
    const { ctx, requested } = offline();

    const reply = await call(ctx, 'jamf_docs_get_article', { mapId: PRO_MAP, contentId: CCP, section: 'x'.repeat(length) });

    expect(reply.isError).toBe(true);
    expect(reply.text).toContain(`section: Section must not exceed ${String(SECTION_LIMIT)} characters`);
    expect(reply.text).not.toContain('x'.repeat(100));
    expect(reply.text.length).toBeLessThan(1_000);
    expect(requested).toEqual([]);
  });
});

describe('a section of 200 characters is looked for, and its miss is said even at the smallest maxTokens', () => {
  it(`maxTokens: ${String(TOKEN_CONFIG.MIN_TOKENS)}`, async () => {
    const { ctx, requested } = offline();
    const section = 'y'.repeat(SECTION_LIMIT);

    const reply = await call(ctx, 'jamf_docs_get_article', {
      mapId: PRO_MAP, contentId: CCP, section, maxTokens: TOKEN_CONFIG.MIN_TOKENS,
    });

    expect(reply.isError).toBeUndefined();
    expect(reply.text).toContain(`*Section "${section}" not found.*`);
    expect(requested.length).toBeGreaterThan(0);
  });
});

describe('a longer version is refused before anything is fetched, and not quoted back', () => {
  it.each([
    ['jamf_docs_search', { query: 'FileVault' }],
    ['jamf_docs_get_toc', { product: 'jamf-pro' }],
  ])('%s', async (tool, args) => {
    for (const length of [VERSION_LIMIT + 1, 100_000]) {
      const { ctx, requested } = offline();

      const reply = await call(ctx, tool, { ...args, version: '1'.repeat(length) });

      expect(reply.isError).toBe(true);
      expect(reply.text).toContain(`version: Version must not exceed ${String(VERSION_LIMIT)} characters`);
      expect(reply.text).not.toContain('1'.repeat(VERSION_LIMIT + 1));
      expect(reply.text.length).toBeLessThan(1_000);
      expect(requested).toEqual([]);
    }
  });
});

describe('a version of 50 characters passes the schema', () => {
  it.each([
    ['jamf_docs_search', { query: 'FileVault' }],
    ['jamf_docs_get_toc', { product: 'jamf-pro' }],
  ])('%s', async (tool, args) => {
    const { ctx, requested } = offline();

    const reply = await call(ctx, tool, { ...args, version: '1'.repeat(VERSION_LIMIT) });

    // Offline, so each fails, or finds nothing, past the schema.
    expect(reply.text).not.toContain('must not exceed');
    expect(requested.length).toBeGreaterThan(0);
  });
});

// ── Prompts and resource templates ──────────────────────────────────────────

/** The message of what `run` rejects with, or '' when it does not reject. */
async function rejection(run: () => Promise<unknown>): Promise<{ code?: unknown; message: string }> {
  try {
    await run();
    return { message: '' };
  } catch (error) {
    return { code: (error as { code?: unknown }).code, message: (error as Error).message };
  }
}

describe('a prompt\'s product or version longer than the tools allow is refused, and not quoted back', () => {
  it.each([
    ['jamf_troubleshoot', { problem: 'FileVault key escrow fails' }, 'product', 'Product', PRODUCT_LIMIT],
    ['jamf_setup_guide', { feature: 'FileVault' }, 'product', 'Product', PRODUCT_LIMIT],
    ['jamf_compare_versions', { product: 'jamf-pro', version_a: '11.13.0', version_b: '11.32.0' }, 'product', 'Product', PRODUCT_LIMIT],
    ['jamf_compare_versions', { product: 'jamf-pro', version_a: '11.13.0', version_b: '11.32.0' }, 'version_a', 'Version', VERSION_LIMIT],
    ['jamf_compare_versions', { product: 'jamf-pro', version_a: '11.13.0', version_b: '11.32.0' }, 'version_b', 'Version', VERSION_LIMIT],
  ])('%s: %s', async (name, args, key, what, limit) => {
    const { ctx, requested } = offline();
    const { client, close } = await connect(ctx);
    try {
      for (const length of [limit + 1, 100_000]) {
        const failure = await rejection(async () => await client.getPrompt({ name, arguments: { ...args, [key]: 'p'.repeat(length) } }));

        expect(failure.message).toContain(`${what} must not exceed ${String(limit)} characters`);
        expect(failure.message).not.toContain('p'.repeat(limit + 1));
        expect(failure.message.length).toBeLessThan(1_000);
      }

      const atLimit = await client.getPrompt({ name, arguments: { ...args, [key]: 'p'.repeat(limit) } });
      expect(JSON.stringify(atLimit.messages)).toContain('p'.repeat(limit));
      expect(requested).toEqual([]);
    } finally {
      await close();
    }
  });
});

describe('a resource template\'s productId longer than 100 characters is refused, and not quoted back', () => {
  it.each(['toc', 'versions'])('jamf://products/{productId}/%s', async (tail) => {
    const { ctx, requested } = offline();
    const { client, close } = await connect(ctx);
    try {
      for (const length of [PRODUCT_LIMIT + 1, 100_000]) {
        const failure = await rejection(async () => await client.readResource({ uri: `jamf://products/${'p'.repeat(length)}/${tail}` }));

        expect(failure.code).toBe(-32602);
        expect(failure.message).toContain(`Product ID must not exceed ${String(PRODUCT_LIMIT)} characters. Valid products: jamf-pro,`);
        expect(failure.message).not.toContain('p'.repeat(PRODUCT_LIMIT + 1));
        expect(failure.message.length).toBeLessThan(2_000);
      }

      // Up to the bound, a product ID that names no product still gets the body saying so.
      const uri = `jamf://products/${'p'.repeat(PRODUCT_LIMIT)}/${tail}`;
      const atLimit = await client.readResource({ uri });
      expect(atLimit.contents).toEqual([{
        uri,
        mimeType: 'text/plain',
        text: `Invalid product ID: "${'p'.repeat(PRODUCT_LIMIT)}". Valid products: ${Object.keys(JAMF_PRODUCTS).join(', ')}`,
      }]);
      expect(requested).toEqual([]);
    } finally {
      await close();
    }
  });

  it('the bound is the constant, and holds every product ID', () => {
    expect(CONTENT_LIMITS.MAX_PRODUCT_LENGTH).toBe(PRODUCT_LIMIT);
    expect(Math.max(...Object.keys(JAMF_PRODUCTS).map(id => id.length))).toBeLessThanOrEqual(PRODUCT_LIMIT);
  });
});
