/**
 * Integration tests for FT API data contracts
 *
 * These tests hit the REAL Fluid Topics API to validate that response shapes
 * match the formats the application code actually expects.
 *
 * Background: A real bug was missed because unit tests used readable mapIds like
 * `jamf-pro-documentation` while the real API returns opaque hashes like
 * `uRhiWJWbjHyL1vegaHmj8g`. Product filtering was completely broken but all tests
 * passed. These tests exist to catch that class of contract mismatch.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  search,
  fetchMaps,
  fetchMapToc,
  fetchTopicContent,
} from '../../src/core/services/ft-client.js';
import type { FtSearchCluster, FtMapInfo, FtTocNode } from '../../src/core/types.js';

// ─── Regex patterns for opaque ID format ────────────────────────────────────

/**
 * Opaque hash IDs returned by the FT API.
 * Format: base64url-like, characters [a-zA-Z0-9_~-], length typically 20-30 chars.
 * Must NOT look like a human-readable bundle stem (e.g. "jamf-pro-documentation").
 */
const OPAQUE_ID_RE = /^[a-zA-Z0-9_~-]+$/;

/**
 * Readable bundle stem pattern — what we must NOT see as a mapId.
 * Real bundle stems look like: "jamf-pro-documentation", "jamf-connect-documentation-11.5.0"
 */
const READABLE_BUNDLE_STEM_RE = /^jamf-\w+/;

// ─── Shared data fetched once for all tests ──────────────────────────────────

let searchClusters: FtSearchCluster[];
let maps: FtMapInfo[];
let proMapId: string;
let proTocNodes: FtTocNode[];

beforeAll(async () => {
  // Fetch search results once — reused by all search contract tests
  const searchResponse = await search({
    query: 'enrollment',
    contentLocale: 'en-US',
    paging: { perPage: 5, page: 1 },
  });
  searchClusters = searchResponse.results;

  // Fetch the maps registry once — reused by all maps contract tests
  maps = await fetchMaps();

  // Find the Jamf Pro latest English map to use for TOC and content tests
  const proMap = maps.find(m =>
    m.metadata.some(
      meta => meta.key === 'version_bundle_stem' && meta.values[0] === 'jamf-pro-documentation'
    ) &&
    m.metadata.some(
      meta => meta.key === 'latestVersion' && meta.values[0] === 'yes'
    ) &&
    m.metadata.some(
      meta => meta.key === 'ft:locale' && meta.values[0] === 'en-US'
    )
  );

  expect(proMap).toBeDefined();
  proMapId = proMap!.id;

  // Fetch the TOC once — reused by TOC contract tests
  proTocNodes = await fetchMapToc(proMapId);
}, 30000);

// ─── Search response contracts ───────────────────────────────────────────────

describe('FT API data contracts', () => {
  describe('search response', () => {
    it('search results contain mapId as opaque hash, not readable bundle stem', () => {
      expect(searchClusters.length).toBeGreaterThan(0);

      for (const cluster of searchClusters) {
        for (const entry of cluster.entries) {
          if (entry.type === 'TOPIC' && entry.topic) {
            const { mapId } = entry.topic;

            // Must be non-empty
            expect(mapId, `mapId should be non-empty for topic "${entry.topic.title}"`).toBeTruthy();

            // Must contain only URL-safe characters
            expect(
              OPAQUE_ID_RE.test(mapId),
              `mapId "${mapId}" must match [a-zA-Z0-9_~-] (opaque hash format)`
            ).toBe(true);

            // Must NOT look like a readable bundle stem
            expect(
              READABLE_BUNDLE_STEM_RE.test(mapId),
              `mapId "${mapId}" must NOT be a readable bundle stem (e.g. "jamf-pro-documentation"). ` +
              'The real API returns opaque hashes. Using bundle stems as mapIds breaks product filtering.'
            ).toBe(false);
          }
        }
      }
    });

    it('search results contain zoominmetadata with at least one string value', () => {
      let foundZoomin = false;

      for (const cluster of searchClusters) {
        for (const entry of cluster.entries) {
          const metadata = entry.type === 'TOPIC' ? entry.topic?.metadata : entry.map?.metadata;
          if (!metadata) continue;

          const zoomin = metadata.find(m => m.key === 'zoominmetadata');
          if (zoomin) {
            foundZoomin = true;
            expect(zoomin.values.length).toBeGreaterThan(0);
            // zoominmetadata values are plain strings (e.g. "content-techdocs", "jamf-pro")
            for (const val of zoomin.values) {
              expect(typeof val).toBe('string');
              expect(val.length).toBeGreaterThan(0);
            }
          }
        }
      }

      // At least some results should carry zoominmetadata
      expect(foundZoomin, 'Expected at least one search result to contain zoominmetadata').toBe(true);
    });

    it('search results contain ft:prettyUrl metadata', () => {
      let foundPrettyUrl = false;

      for (const cluster of searchClusters) {
        for (const entry of cluster.entries) {
          const metadata = entry.type === 'TOPIC' ? entry.topic?.metadata : entry.map?.metadata;
          if (!metadata) continue;

          const prettyUrlEntry = metadata.find(m => m.key === 'ft:prettyUrl');
          if (prettyUrlEntry && prettyUrlEntry.values.length > 0) {
            foundPrettyUrl = true;
            const prettyUrl = prettyUrlEntry.values[0];
            // prettyUrl can be:
            //   - absolute:   "https://learn.jamf.com/..."
            //   - root-relative: "/r/..." or "/en-US/..."
            //   - path-relative: "en-US/..." (no leading slash)
            // All must be non-empty strings that look like URL paths or URLs
            expect(prettyUrl.length, `ft:prettyUrl must be a non-empty string`).toBeGreaterThan(0);
            const isAbsolute = prettyUrl.startsWith('https://');
            const isRootRelative = prettyUrl.startsWith('/');
            const isPathRelative = /^[a-zA-Z]/.test(prettyUrl);
            expect(
              isAbsolute || isRootRelative || isPathRelative,
              `ft:prettyUrl "${prettyUrl}" must look like a URL path or absolute URL`
            ).toBe(true);
          }
        }
      }

      expect(foundPrettyUrl, 'Expected at least one search result to contain ft:prettyUrl').toBe(true);
    });

    it('search topic entries have contentId in opaque hash format', () => {
      let checkedCount = 0;

      for (const cluster of searchClusters) {
        for (const entry of cluster.entries) {
          if (entry.type === 'TOPIC' && entry.topic) {
            const { contentId } = entry.topic;

            expect(contentId, `contentId should be non-empty for topic "${entry.topic.title}"`).toBeTruthy();

            expect(
              OPAQUE_ID_RE.test(contentId),
              `contentId "${contentId}" must match [a-zA-Z0-9_~-] (opaque hash format)`
            ).toBe(true);

            // contentId should also not be a readable path segment
            expect(
              READABLE_BUNDLE_STEM_RE.test(contentId),
              `contentId "${contentId}" must NOT be a readable bundle stem`
            ).toBe(false);

            checkedCount++;
          }
        }
      }

      expect(checkedCount, 'Expected to find at least one TOPIC entry to validate contentId').toBeGreaterThan(0);
    });

    it('search clusters each have a metadataVariableAxis string', () => {
      expect(searchClusters.length).toBeGreaterThan(0);
      for (const cluster of searchClusters) {
        expect(typeof cluster.metadataVariableAxis).toBe('string');
      }
    });
  });

  // ─── Maps response contracts ──────────────────────────────────────────────

  describe('maps response', () => {
    it('fetchMaps returns maps with opaque hash id (not readable bundle stem)', () => {
      expect(maps.length).toBeGreaterThan(0);

      // Sample the first 20 maps to keep test fast
      const sample = maps.slice(0, 20);
      for (const map of sample) {
        expect(map.id, 'map.id should be non-empty').toBeTruthy();

        expect(
          OPAQUE_ID_RE.test(map.id),
          `map.id "${map.id}" must match [a-zA-Z0-9_~-] (opaque hash format)`
        ).toBe(true);

        expect(
          READABLE_BUNDLE_STEM_RE.test(map.id),
          `map.id "${map.id}" must NOT be a readable bundle stem. ` +
          'If this fails, the API changed its ID scheme and all product filtering logic must be updated.'
        ).toBe(false);
      }
    });

    it('maps contain expected metadata keys for product identification', () => {
      // Find the Jamf Pro current map and verify its metadata structure
      const proMaps = maps.filter(m =>
        m.metadata.some(
          meta => meta.key === 'version_bundle_stem' && meta.values[0] === 'jamf-pro-documentation'
        )
      );
      expect(proMaps.length, 'Expected at least one Jamf Pro map').toBeGreaterThan(0);

      const proMapSample = proMaps[0];
      const metaKeys = proMapSample.metadata.map(m => m.key);

      // These keys are essential for MapsRegistry to correctly identify and route maps
      expect(metaKeys).toContain('version_bundle_stem');
      expect(metaKeys).toContain('ft:locale');
      expect(metaKeys).toContain('bundle');
    });

    it('maps contain latestVersion metadata to distinguish current from historical', () => {
      const latestProMaps = maps.filter(m =>
        m.metadata.some(
          meta => meta.key === 'version_bundle_stem' && meta.values[0] === 'jamf-pro-documentation'
        ) &&
        m.metadata.some(
          meta => meta.key === 'latestVersion' && meta.values[0] === 'yes'
        )
      );

      expect(
        latestProMaps.length,
        'Expected at least one Jamf Pro map marked with latestVersion=yes'
      ).toBeGreaterThan(0);

      // There should be exactly one English latest map for Jamf Pro
      const latestEnMaps = latestProMaps.filter(m =>
        m.metadata.some(meta => meta.key === 'ft:locale' && meta.values[0] === 'en-US')
      );
      expect(
        latestEnMaps.length,
        'Expected exactly one en-US Jamf Pro map marked as latest'
      ).toBe(1);
    });

    it('maps have a non-empty title string', () => {
      const sample = maps.slice(0, 20);
      for (const map of sample) {
        expect(typeof map.title).toBe('string');
        expect(map.title.length, `map "${map.id}" should have a non-empty title`).toBeGreaterThan(0);
      }
    });

    it('proMapId resolved from maps is in opaque hash format', () => {
      expect(proMapId).toBeTruthy();
      expect(OPAQUE_ID_RE.test(proMapId)).toBe(true);
      expect(READABLE_BUNDLE_STEM_RE.test(proMapId)).toBe(false);
    });
  });

  // ─── TOC response contracts ───────────────────────────────────────────────

  describe('TOC response', () => {
    it('TOC returns a non-empty array of root nodes', () => {
      expect(Array.isArray(proTocNodes)).toBe(true);
      expect(proTocNodes.length).toBeGreaterThan(0);
    });

    it('TOC nodes have non-empty title and contentId', () => {
      function validateNode(node: FtTocNode, depth: number): void {
        expect(node.title, `TOC node at depth ${depth} should have a title`).toBeTruthy();
        expect(node.contentId, `TOC node "${node.title}" should have a contentId`).toBeTruthy();

        // contentId must be in opaque hash format
        expect(
          OPAQUE_ID_RE.test(node.contentId),
          `TOC node contentId "${node.contentId}" must match [a-zA-Z0-9_~-]`
        ).toBe(true);

        // Recurse into children but cap depth to avoid very deep traversal in tests
        if (depth < 2 && node.children.length > 0) {
          for (const child of node.children.slice(0, 3)) {
            validateNode(child, depth + 1);
          }
        }
      }

      for (const root of proTocNodes.slice(0, 5)) {
        validateNode(root, 0);
      }
    });

    it('TOC nodes have prettyUrl for navigation', () => {
      function findNodesWithPrettyUrl(nodes: FtTocNode[]): FtTocNode[] {
        const found: FtTocNode[] = [];
        for (const node of nodes) {
          if (node.prettyUrl && node.prettyUrl !== '') {
            found.push(node);
          }
          if (found.length >= 3) break;
          if (node.children.length > 0) {
            found.push(...findNodesWithPrettyUrl(node.children));
            if (found.length >= 3) break;
          }
        }
        return found;
      }

      const nodesWithUrls = findNodesWithPrettyUrl(proTocNodes);
      expect(
        nodesWithUrls.length,
        'Expected at least one TOC node with a prettyUrl'
      ).toBeGreaterThan(0);

      for (const node of nodesWithUrls) {
        const url = node.prettyUrl;
        // prettyUrl can be absolute, root-relative, or path-relative (no leading slash)
        expect(url.length, `TOC node prettyUrl must be non-empty`).toBeGreaterThan(0);
        const isAbsolute = url.startsWith('https://');
        const isRootRelative = url.startsWith('/');
        const isPathRelative = /^[a-zA-Z]/.test(url);
        expect(
          isAbsolute || isRootRelative || isPathRelative,
          `TOC node prettyUrl "${url}" must look like a URL path or absolute URL`
        ).toBe(true);
      }
    });

    it('TOC nodes have tocId field', () => {
      for (const root of proTocNodes.slice(0, 5)) {
        expect(root.tocId, `Root TOC node "${root.title}" should have a tocId`).toBeTruthy();
      }
    });
  });

  // ─── Topic content response contracts ────────────────────────────────────

  describe('topic content response', () => {
    it('topic content returns HTML with content-locale wrapper', async () => {
      // Find the first leaf node with a contentId from the TOC
      function findLeaf(nodes: FtTocNode[]): FtTocNode | null {
        for (const node of nodes) {
          if (node.children.length === 0 && node.contentId) return node;
          const found = findLeaf(node.children);
          if (found) return found;
        }
        return null;
      }

      const leaf = findLeaf(proTocNodes);
      expect(leaf, 'Expected to find at least one leaf TOC node').not.toBeNull();

      const html = await fetchTopicContent(proMapId, leaf!.contentId);

      expect(html, 'Topic content should not be empty').toBeTruthy();
      expect(html).toContain('<');

      // FT wraps content in a div with class containing "content-locale"
      // This wrapper is what the HTML parser depends on to extract article body
      expect(
        html.includes('content-locale') || html.includes('<article') || html.includes('<section'),
        'Topic HTML must contain "content-locale", <article>, or <section> wrapper element'
      ).toBe(true);
    }, 30000);

    it('topic content is valid HTML (not JSON or plain text)', async () => {
      function findLeaf(nodes: FtTocNode[]): FtTocNode | null {
        for (const node of nodes) {
          if (node.children.length === 0 && node.contentId) return node;
          const found = findLeaf(node.children);
          if (found) return found;
        }
        return null;
      }

      const leaf = findLeaf(proTocNodes);
      expect(leaf).not.toBeNull();

      const html = await fetchTopicContent(proMapId, leaf!.contentId);

      // Must be HTML, not a JSON object
      expect(html.trimStart()).not.toMatch(/^\{/);
      // Must contain at least one HTML tag
      expect(html).toMatch(/<[a-zA-Z]/);
    }, 30000);
  });
});
