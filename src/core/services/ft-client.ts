/**
 * Fluid Topics API client
 *
 * Pure HTTP client for the Fluid Topics platform on learn.jamf.com.
 * Stateless — no caching, no business logic, no provider fallback.
 * All functions map 1:1 to FT REST API endpoints.
 */

import { httpGetJson, httpGetText, httpPostJson } from '../http-client.js';
import { FT_API_BASE } from '../constants.js';
import type {
  FtClusteredSearchResponse,
  FtSearchRequest,
  FtMapInfo,
  FtTocNode,
  FtTopicInfo,
} from '../types.js';

// ─── URL helpers ───────────────────────────────────────────────

/**
 * Build a /api/khub/maps/{mapId}/... URL with proper encoding.
 * All path segments are encoded via encodeURIComponent.
 */
function mapsUrl(mapId: string, ...segments: string[]): string {
  const base = `${FT_API_BASE}/api/khub/maps/${encodeURIComponent(mapId)}`;
  if (segments.length === 0) return base;
  return `${base}/${segments.map(encodeURIComponent).join('/')}`;
}

// ─── Search ─────────────────────────────────────────────────────

/**
 * POST /api/khub/clustered-search
 *
 * Primary search endpoint. Returns clusters of results grouped by topic,
 * each cluster may contain multiple version entries.
 */
export async function search(
  request: FtSearchRequest
): Promise<FtClusteredSearchResponse> {
  const url = `${FT_API_BASE}/api/khub/clustered-search`;
  return await httpPostJson<FtClusteredSearchResponse>(url, request);
}

// ─── Maps (Publications) ────────────────────────────────────────

/**
 * GET /api/khub/maps
 *
 * Returns all publications (~577 maps across all locales and versions).
 * Each map includes metadata with version_bundle_stem, version,
 * latestVersion, ft:locale, etc.
 */
export async function fetchMaps(): Promise<FtMapInfo[]> {
  const url = `${FT_API_BASE}/api/khub/maps`;
  return await httpGetJson<FtMapInfo[]>(url);
}

// ─── TOC ────────────────────────────────────────────────────────

/**
 * GET /api/khub/maps/{mapId}/toc
 *
 * Returns the full table of contents as a JSON tree.
 * The response is either a single root node or an array of root nodes.
 */
export async function fetchMapToc(
  mapId: string
): Promise<FtTocNode[]> {
  const url = mapsUrl(mapId, 'toc');
  const raw = await httpGetJson<FtTocNode | FtTocNode[]>(url);
  return Array.isArray(raw) ? raw : [raw];
}

// ─── Topics ─────────────────────────────────────────────────────

/**
 * GET /api/khub/maps/{mapId}/topics
 *
 * Returns a flat list of all topics in a map.
 * Richer than TOC: includes readerUrl, breadcrumb, and full metadata.
 */
export async function fetchMapTopics(
  mapId: string
): Promise<FtTopicInfo[]> {
  const url = mapsUrl(mapId, 'topics');
  return await httpGetJson<FtTopicInfo[]>(url);
}

/**
 * GET /api/khub/maps/{mapId}/topics/{contentId}/content
 *
 * Returns the HTML content of a single topic.
 * Always returns text/html regardless of Accept header.
 */
export async function fetchTopicContent(
  mapId: string,
  contentId: string
): Promise<string> {
  const url = mapsUrl(mapId, 'topics', contentId, 'content');
  return await httpGetText(url);
}

/**
 * GET /api/khub/maps/{mapId}/topics/{contentId}
 *
 * Returns topic metadata including title, contentApiEndpoint,
 * and all metadata key-value pairs.
 */
export async function fetchTopicMetadata(
  mapId: string,
  contentId: string
): Promise<FtTopicInfo> {
  const url = mapsUrl(mapId, 'topics', contentId);
  return await httpGetJson<FtTopicInfo>(url);
}
