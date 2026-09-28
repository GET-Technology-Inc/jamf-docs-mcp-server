/**
 * Only a version number is shown as a version, on the article path and on
 * the versions a map list gives the TOC and the resources, as on the search
 * path since #363.
 *
 * Some topics carry Jamf's template text, "Enter the latest product version
 * for which the topic was revised.", in their `version` metadata. Live on
 * 2026-09-28, 9 of the 441 topics of the en-US Jamf Connect map and 9 of the
 * 441 of the ja-JP one did, 4 of the 382 of Jamf Protect and 79 of the 697 of
 * Technical Articles; every other topic of those maps has no `version` at
 * all. Until 2026-09-28 `jamf_docs_get_article` showed that
 * text as the article's version: through the registered tool,
 * `mapId=JEc~s7Yc6BZM_8sDZDLNrg, contentId=EN07tYt99KYjHfrWJ8QdfA` ("ステップ
 * 2: Azure AD を構成する") and `mapId=ZlB_0jgM2084m7JxZgV1KQ,
 * contentId=OWmtH6K8XqVMpGfF1bsjmA` ("Additional Information") both answered
 * `version: "Enter the latest product version for which the topic was
 * revised."` and `**Version**: Enter the latest …`, where a topic of the
 * same map with no `version` answers `current`.
 *
 * The maps list carries no such text today (685 maps, 46 version values, all
 * version numbers, on 2026-09-28), so the second half is the same rule, read
 * the same way, for the one other place a `version` is read from Jamf.
 *
 * Both are read when served, of what the cache holds as well: an entry an
 * earlier build wrote holds the value as it came. And an article is still
 * cached as those builds cache it, so that one sharing the cache reads it.
 *
 * Over MCP, against a whole server with a real MapsRegistry and TopicResolver
 * and only the http client stubbed.
 */

import { describe, it, expect } from 'vitest';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createMcpServer } from '../../../src/core/create-server.js';
import { MapsRegistry, type MapEntry } from '../../../src/core/services/maps-registry.js';
import { TopicResolver } from '../../../src/core/services/topic-resolver.js';
import type { HttpClient } from '../../../src/core/http-client.js';
import { cacheKey, type CacheKey } from '../../../src/core/services/cache-key.js';
import { createMockCache, createMockContext } from '../../helpers/mock-context.js';
import type { FtMapInfo, FtTopicInfo } from '../../../src/core/types.js';
import type { ServerContext } from '../../../src/core/types/context.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

/** Jamf's template text, as the live `version` of both topics above holds it. */
const TEMPLATE = 'Enter the latest product version for which the topic was revised.';

const MAPS_LIST = 'https://learn.jamf.com/api/khub/maps';
const TECH_MAP = 'ZlB_0jgM2084m7JxZgV1KQ';
const TEMPLATE_TOPIC = 'OWmtH6K8XqVMpGfF1bsjmA';
const PRO_MAP = 'A4LI4vM0BILraYeOD89WGg';
const PRO_PREVIOUS_MAP = 'wqin5wmqOhRZNP0CChQ8MQ';

const meta = (key: string, ...values: string[]): { key: string; label: string; values: string[] } =>
  ({ key, label: key, values });

function proMap(id: string, version: string, latest: boolean): FtMapInfo {
  return {
    id,
    title: `Jamf Pro Documentation ${version}`,
    mapApiEndpoint: `/api/khub/maps/${id}`,
    metadata: [
      meta('version_bundle_stem', 'jamf-pro-documentation'),
      meta('version', version),
      meta('bundle', latest ? 'jamf-pro-documentation-current' : `jamf-pro-documentation-${version}`),
      ...(latest ? [meta('latestVersion', 'yes')] : []),
      meta('ft:locale', 'en-US'),
      meta('jamf:portal', 'Jamf Pro'),
    ],
  };
}

const TECH_MAP_INFO: FtMapInfo = {
  id: TECH_MAP,
  title: 'Technical Articles',
  mapApiEndpoint: `/api/khub/maps/${TECH_MAP}`,
  metadata: [meta('bundle', 'technical-articles'), meta('ft:locale', 'en-US')],
};

/** A topic's metadata as the live single-topic endpoint sends it, trimmed. */
function topicInfo(mapId: string, id: string, title: string, version: string | undefined): FtTopicInfo {
  return {
    title,
    id,
    contentApiEndpoint: `/api/khub/maps/${mapId}/topics/${id}/content`,
    metadata: [
      ...(version !== undefined ? [meta('version', version)] : []),
      meta('ft:lastEdition', '2026-09-23'),
      meta('ft:locale', 'en-US'),
      meta('ft:prettyUrl', `en-US/technical-articles/${title.replace(/ /g, '_')}`),
    ],
  };
}

// ── Harness ─────────────────────────────────────────────────────────────────

interface Upstream {
  /** The maps learn.jamf.com lists. */
  maps: FtMapInfo[];
  /** The one topic's `version` metadata; undefined for none. */
  topicVersion?: string | undefined;
}

/** How many times each context's topic metadata, and its maps list, were requested. */
const requestCounts = new WeakMap<ServerContext, { count: number; mapsLists: number }>();

const topicRequests = (ctx: ServerContext): number => requestCounts.get(ctx)?.count ?? 0;
const mapsListRequests = (ctx: ServerContext): number => requestCounts.get(ctx)?.mapsLists ?? 0;

function upstream(given: Upstream): ServerContext {
  const counter = { count: 0, mapsLists: 0 };
  const http: HttpClient = {
    getJson: async <T>(url: string) => {
      await Promise.resolve();
      if (url === MAPS_LIST) {
        counter.mapsLists += 1;
        return given.maps as T;
      }
      const path = decodeURIComponent(new URL(url).pathname);
      if (path.endsWith('/toc')) { return [] as T; }
      const topic = topicInfo(TECH_MAP, TEMPLATE_TOPIC, 'Additional Information', given.topicVersion);
      // The map's topic index, which a url is resolved with, and the topic.
      if (path === `/api/khub/maps/${TECH_MAP}/topics`) { return [topic] as T; }
      if (path === `/api/khub/maps/${TECH_MAP}/topics/${TEMPLATE_TOPIC}`) {
        counter.count += 1;
        return topic as T;
      }
      throw new Error(`offline: no fixture for ${url}`);
    },
    getText: async (url) => {
      await Promise.resolve();
      if (url.endsWith('/content')) { return '<div class="body conbody"><p class="p">Body.</p></div>'; }
      throw new Error(`offline: no fixture for ${url}`);
    },
    postJson: async (url) => await Promise.reject(new Error(`offline: no fixture for ${url}`)),
  };
  const cache = createMockCache();
  const mapsRegistry = new MapsRegistry(cache, undefined, undefined, undefined, http);
  const topicResolver = new TopicResolver(mapsRegistry, cache, undefined, undefined, http);
  const ctx = createMockContext({ cache, http, mapsRegistry, topicResolver });
  requestCounts.set(ctx, counter);
  return ctx;
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

interface Reply { isError?: boolean; text: string; structured?: Record<string, unknown> }

async function call(ctx: ServerContext, name: string, args: Record<string, unknown>): Promise<Reply> {
  const { client, close } = await connect(ctx);
  try {
    await client.listTools();
    const result = await client.callTool({ name, arguments: args });
    const text = (result.content as { type: string; text?: string }[]).map(c => c.text ?? '').join('\n\n');
    return {
      ...(result.isError !== undefined ? { isError: result.isError } : {}),
      text,
      ...(result.structuredContent !== undefined
        ? { structured: result.structuredContent as Record<string, unknown> }
        : {}),
    };
  } finally {
    await close();
  }
}

async function readText(ctx: ServerContext, uri: string): Promise<string> {
  const { client, close } = await connect(ctx);
  try {
    const result = await client.readResource({ uri });
    return result.contents.map(content => ('text' in content ? content.text : '')).join('');
  } finally {
    await close();
  }
}

const ARTICLE = { mapId: TECH_MAP, contentId: TEMPLATE_TOPIC };
const MAPS = [proMap(PRO_MAP, '11.32.0', true), TECH_MAP_INFO];

// ── The article ─────────────────────────────────────────────────────────────

describe('jamf_docs_get_article shows only a version number as a version', () => {
  it('a topic whose version is Jamf\'s template text reads as one with none: current, on every channel', async () => {
    const markdown = await call(upstream({ maps: MAPS, topicVersion: TEMPLATE }), 'jamf_docs_get_article', ARTICLE);
    const json = await call(upstream({ maps: MAPS, topicVersion: TEMPLATE }), 'jamf_docs_get_article', {
      ...ARTICLE, responseFormat: 'json',
    });
    const compact = await call(upstream({ maps: MAPS, topicVersion: TEMPLATE }), 'jamf_docs_get_article', {
      ...ARTICLE, outputMode: 'compact',
    });
    const none = await call(upstream({ maps: MAPS }), 'jamf_docs_get_article', ARTICLE);

    for (const reply of [markdown, json, compact]) {
      expect(reply.isError).toBeUndefined();
      expect(reply.text).not.toContain(TEMPLATE);
      expect(reply.structured?.version).toBe('current');
    }
    expect(markdown.text).toContain('**Version**: current |');
    expect((JSON.parse(json.text) as { version: string }).version).toBe('current');
    // As a topic of the same publication with no `version` at all reads.
    expect(none.structured?.version).toBe('current');
    expect(markdown.text).toBe(none.text);
  });

  it('an article cached with the text by an earlier build reads the same, from the cache', async () => {
    // As a build before 2026-09-28 wrote it: the metadata's `version` as it came.
    const ctx = upstream({ maps: MAPS, topicVersion: TEMPLATE });
    await ctx.cache.set(cacheKey('ft-article-v3', { ...ARTICLE, articleUrl: '' }), {
      title: 'Additional Information',
      parsed: { title: 'Additional Information', content: 'Body.', breadcrumb: [], relatedArticles: [] },
      displayUrl: '',
      product: undefined,
      version: TEMPLATE,
      lastUpdated: '2026-09-23',
    });

    const reply = await call(ctx, 'jamf_docs_get_article', ARTICLE);

    expect(topicRequests(ctx)).toBe(0);
    expect(reply.structured?.version).toBe('current');
    expect(reply.text).not.toContain(TEMPLATE);
  });

  it.each([
    ['the text', TEMPLATE, TEMPLATE],
    ['no version', undefined, 'current'],
    ['a version number', '11.32.0', '11.32.0'],
  ])('what is cached for %s is what an earlier build caches, which reads it as its own', async (_label, topicVersion, cached) => {
    // An earlier build shows the cached value as it is: '' would be a blank
    // **Version**, where it shows `current` for none.
    const ctx = upstream({ maps: MAPS, topicVersion });

    await call(ctx, 'jamf_docs_get_article', ARTICLE);
    const entry = await ctx.cache.get<{ version: unknown }>(cacheKey('ft-article-v3', { ...ARTICLE, articleUrl: '' }));

    expect(entry?.version).toBe(cached);
  });

  it.each([
    ['a version number', '11.32.0', '11.32.0'],
    ['a two-part version number', '2.45', '2.45'],
    ['a bare number', '11', 'current'],
    ['a version with a suffix', '11.32.0-beta', 'current'],
    ['the `current` alias', 'current', 'current'],
    ['an empty value', '', 'current'],
  ])('%s: %j reads as %j', async (_label, topicVersion, shown) => {
    const reply = await call(upstream({ maps: MAPS, topicVersion }), 'jamf_docs_get_article', ARTICLE);

    expect(reply.structured?.version).toBe(shown);
    expect(reply.text).toContain(`**Version**: ${shown} |`);
  });

  it('jamf_docs_batch_get_articles does not show the text either', async () => {
    const url = 'https://learn.jamf.com/r/en-US/technical-articles/Additional_Information';

    const reply = await call(upstream({ maps: MAPS, topicVersion: TEMPLATE }), 'jamf_docs_batch_get_articles', {
      urls: [url],
    });

    expect(reply.isError).toBe(false);
    expect(reply.text).toContain('**Version**: current');
    expect(reply.text).not.toContain(TEMPLATE);
  });
});

// ── The maps list ───────────────────────────────────────────────────────────

describe('a map whose version is not a version number is an unversioned map', () => {
  const maps = [proMap(PRO_MAP, '11.32.0', true), proMap(PRO_PREVIOUS_MAP, TEMPLATE, false), TECH_MAP_INFO];

  it('jamf_docs_get_toc does not list it among the versions', async () => {
    const reply = await call(upstream({ maps }), 'jamf_docs_get_toc', { product: 'jamf-pro', version: '11.99.0' });

    expect(reply.isError).toBe(true);
    expect(reply.text).toBe('Version "11.99.0" not found for Jamf Pro.\n\nAvailable versions: 11.32.0');
  });

  it('jamf://products/{productId}/versions does not list it', async () => {
    const text = await readText(upstream({ maps }), 'jamf://products/jamf-pro/versions');

    expect((JSON.parse(text) as { versions: string[] }).versions).toEqual(['11.32.0']);
  });

  it('jamf_docs_list_products does not list it', async () => {
    const reply = await call(upstream({ maps }), 'jamf_docs_list_products', { responseFormat: 'json' });

    expect(reply.text).not.toContain(TEMPLATE);
  });

  it('a list an earlier build cached with the value as it came is not read, and the list read again reads the same', async () => {
    // As a build before 2026-09-28 wrote it (maps-registry-v4): the version as
    // it came. The namespace has moved to v5 since, so this is not read.
    const entry = (id: string, version: string, isLatest: boolean): Omit<MapEntry, 'labelKeys' | 'contentType'> => ({
      mapId: id,
      title: `Jamf Pro Documentation ${version}`,
      bundleStem: 'jamf-pro-documentation',
      version,
      locale: 'en-US',
      isLatest,
      bundleValues: [isLatest ? 'jamf-pro-documentation-current' : `jamf-pro-documentation-${version}`],
      portal: ['Jamf Pro'],
      app: [],
      utility: [],
    });
    const ctx = upstream({ maps });
    // The key a namespace of no parts is (cache-key.ts), which this build no
    // longer names.
    await ctx.cache.set('maps-registry-v4' as CacheKey, {
      fetchedAt: Date.now(),
      entries: [entry(PRO_MAP, '11.32.0', true), entry(PRO_PREVIOUS_MAP, TEMPLATE, false)],
    });

    const text = await readText(ctx, 'jamf://products/jamf-pro/versions');

    expect(mapsListRequests(ctx)).toBe(1);
    expect((JSON.parse(text) as { versions: string[] }).versions).toEqual(['11.32.0']);
  });

  it('the latest map is still the one `current` resolves to', async () => {
    const reply = await call(upstream({ maps }), 'jamf_docs_get_toc', { product: 'jamf-pro', responseFormat: 'json' });

    expect(reply.isError).toBeUndefined();
    expect(reply.structured?.mapId).toBe(PRO_MAP);
  });
});
