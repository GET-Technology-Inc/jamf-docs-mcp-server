/**
 * Integration test for TopicResolver — verifies real FT API resolution
 */

import { describe, it, expect } from 'vitest';
import { TopicResolver } from '../../src/core/services/topic-resolver.js';
import { MapsRegistry } from '../../src/core/services/maps-registry.js';
import { fetchMaps, fetchMapToc } from '../../src/core/services/ft-client.js';
import { JamfDocsError, JamfDocsErrorCode } from '../../src/core/types.js';
import { createMockCache } from '../helpers/mock-context.js';

describe('TopicResolver integration', () => {
  const cache = createMockCache();
  const registry = new MapsRegistry(cache);
  const resolver = new TopicResolver(registry, cache);

  it('should resolve a legacy bundle URL to mapId + contentId', async () => {
    const result = await resolver.resolve({
      url: 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation-current/page/Policies.html',
    });

    expect(result.mapId).toBeTruthy();
    expect(typeof result.mapId).toBe('string');
    expect(result.contentId).toBeTruthy();
    expect(typeof result.contentId).toBe('string');
    expect(result.locale).toBe('en-US');
  }, 30000);

  it('should resolve a FT prettyUrl to mapId + contentId', async () => {
    // Discover a real prettyUrl from the FT API
    const maps = await fetchMaps();
    const proMap = maps.find(m =>
      m.metadata.some(
        meta => meta.key === 'version_bundle_stem'
          && meta.values[0] === 'jamf-pro-documentation'
      )
      && m.metadata.some(
        meta => meta.key === 'latestVersion' && meta.values[0] === 'yes'
      )
      && m.metadata.some(
        meta => meta.key === 'ft:locale' && meta.values[0] === 'en-US'
      )
    );
    expect(proMap).toBeDefined();

    const toc = await fetchMapToc(proMap!.id);
    // Find a topic with a non-empty prettyUrl (walk children if needed)
    function findPrettyUrl(nodes: typeof toc): string | null {
      for (const node of nodes) {
        if (node.prettyUrl && node.prettyUrl !== '') {
          return node.prettyUrl;
        }
        if (node.children.length > 0) {
          const found = findPrettyUrl(node.children);
          if (found) return found;
        }
      }
      return null;
    }

    const prettyUrl = findPrettyUrl(toc);
    expect(prettyUrl).toBeTruthy();

    // Build the full URL from the prettyUrl path
    const fullUrl = prettyUrl!.startsWith('http')
      ? prettyUrl!
      : `https://learn.jamf.com${prettyUrl}`;

    const result = await resolver.resolve({ url: fullUrl });

    expect(result.mapId).toBeTruthy();
    expect(typeof result.mapId).toBe('string');
    expect(result.contentId).toBeTruthy();
    expect(typeof result.contentId).toBe('string');
    expect(result.locale).toBe('en-US');
  }, 30000);

  it('should passthrough direct IDs unchanged', async () => {
    const result = await resolver.resolve({
      mapId: 'abc',
      contentId: 'def',
    });

    expect(result.mapId).toBe('abc');
    expect(result.contentId).toBe('def');
    expect(result.locale).toBe('en-US');
  }, 30000);

  it('should throw INVALID_URL for unrecognized URL format', async () => {
    await expect(
      resolver.resolve({ url: 'https://example.com/unknown/path' })
    ).rejects.toThrow(JamfDocsError);

    try {
      await resolver.resolve({ url: 'https://example.com/unknown/path' });
    } catch (err) {
      expect(err).toBeInstanceOf(JamfDocsError);
      expect((err as JamfDocsError).code).toBe(JamfDocsErrorCode.INVALID_URL);
    }
  }, 30000);
});
