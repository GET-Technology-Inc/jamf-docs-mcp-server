/**
 * Live: an entry of `jamf://products/{productId}/toc` fetched by the pair its
 * body gives it, the body's `mapId` and the entry's `contentId`, through the
 * built server.
 *
 * Until 2026-09-28 the body had no `mapId`, so its contentIds (794 of Jamf
 * Pro's 794 entries) could not be used on their own. What this asserts is
 * what the resource now promises, and what it rests on upstream: that a
 * table-of-contents node's `contentId` is the topic id its map serves at
 * `…/maps/{mapId}/topics/{contentId}`.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { resourceText } from '../helpers/fixtures.js';
import { requireFreshBuild } from '../helpers/require-fresh-build.js';
import { serverCacheDir, type ServerCacheDir } from '../helpers/server-cache-dir.js';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import path from 'path';

interface TocNode { title: string; url: string; contentId?: string; children?: TocNode[] }

function flatten(nodes: TocNode[]): TocNode[] {
  return nodes.flatMap(node => [node, ...flatten(node.children ?? [])]);
}

describe('an entry of the table-of-contents resource, fetched by its pair', () => {
  let client: Client;
  let cache: ServerCacheDir | undefined;

  beforeAll(async () => {
    requireFreshBuild();
    // Not the working directory's .cache; see server-cache-dir.ts.
    cache = serverCacheDir();
    client = new Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(new StdioClientTransport({
      command: 'node',
      args: [path.resolve(process.cwd(), 'dist/index.js')],
      env: cache.env,
    }));
  });

  afterAll(async () => {
    // See mcp-server.test.ts: `beforeAll` can throw before `client` is set.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    await client?.close();
    cache?.remove();
  });

  it('keeps its cache in the directory it was given, not the working directory', async () => {
    await vi.waitFor(() => { expect(cache?.swept()).toBe(true); }, { timeout: 5_000 });
  });

  it('fetches the last entry of Jamf Pro\'s table of contents, by the body\'s mapId and its contentId', async () => {
    const body = JSON.parse(resourceText((await client.readResource({
      uri: 'jamf://products/jamf-pro/toc',
    })).contents)) as { mapId?: string; toc: TocNode[] };
    // The last entry is on the last page the resource read, not on the first.
    const entry = flatten(body.toc).at(-1);

    expect(body.mapId).toMatch(/\S/);
    expect(entry?.contentId).toMatch(/\S/);

    const result = await client.callTool({
      name: 'jamf_docs_get_article',
      arguments: { mapId: body.mapId, contentId: entry?.contentId, maxTokens: 500 },
    });
    const article = result.structuredContent as { url?: string; mapId?: string; contentId?: string };

    expect(result.isError).toBeFalsy();
    expect(article).toMatchObject({ url: entry?.url, mapId: body.mapId, contentId: entry?.contentId });
  });

  it('names the map jamf_docs_get_toc names for the same product', async () => {
    const body = JSON.parse(resourceText((await client.readResource({
      uri: 'jamf://products/jamf-pro/toc',
    })).contents)) as { mapId?: string };
    const toc = await client.callTool({ name: 'jamf_docs_get_toc', arguments: { product: 'jamf-pro' } });

    expect((toc.structuredContent as { mapId?: string }).mapId).toBe(body.mapId);
  });
});
