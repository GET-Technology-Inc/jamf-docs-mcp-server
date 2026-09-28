/**
 * Fluid Topics API client
 *
 * Pure HTTP client for the Fluid Topics platform on learn.jamf.com.
 * Stateless — no caching, no business logic, no provider fallback.
 * All functions map 1:1 to FT REST API endpoints.
 */

import type { HttpClient } from '../http-client.js';
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
  if (segments.length === 0) {
    return base;
  }
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
  http: HttpClient,
  request: FtSearchRequest
): Promise<FtClusteredSearchResponse> {
  const url = `${FT_API_BASE}/api/khub/clustered-search`;
  return await http.postJson<FtClusteredSearchResponse>(url, request);
}

// ─── Maps (Publications) ────────────────────────────────────────

/**
 * GET /api/khub/maps
 *
 * Returns every publication across all locales and versions, which collapse
 * to bundle families once the version suffix is stripped.
 *
 * Measured 2026-09-18: 678 maps, 98 families, 2,977,345 bytes. The figures are
 * dated because they move constantly — this comment has read "~577", then 676
 * / 97 — and none of them is a contract. The scheduled upstream-contract job
 * is what pins the shape the code actually depends on.
 *
 * Each map includes metadata with version_bundle_stem, version,
 * latestVersion, ft:locale, etc.
 */
export async function fetchMaps(http: HttpClient): Promise<FtMapInfo[]> {
  const url = `${FT_API_BASE}/api/khub/maps`;
  return await http.getJson<FtMapInfo[]>(url);
}

// ─── TOC ────────────────────────────────────────────────────────

/**
 * GET /api/khub/maps/{mapId}/toc
 *
 * Returns the full table of contents as a JSON tree.
 * The response is either a single root node or an array of root nodes.
 */
export async function fetchMapToc(
  http: HttpClient,
  mapId: string
): Promise<FtTocNode[]> {
  const url = mapsUrl(mapId, 'toc');
  const raw = await http.getJson<FtTocNode | FtTocNode[]>(url);
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
  http: HttpClient,
  mapId: string
): Promise<FtTopicInfo[]> {
  const url = mapsUrl(mapId, 'topics');
  return await http.getJson<FtTopicInfo[]>(url);
}

/**
 * GET /api/khub/maps/{mapId}/topics/{contentId}/content
 *
 * Returns the HTML content of a single topic.
 * Always returns text/html regardless of Accept header.
 */
export async function fetchTopicContent(
  http: HttpClient,
  mapId: string,
  contentId: string
): Promise<string> {
  const url = mapsUrl(mapId, 'topics', contentId, 'content');
  return await http.getText(url);
}

/**
 * GET /api/khub/maps/{mapId}/topics/{contentId}
 *
 * Returns topic metadata including title, contentApiEndpoint,
 * and all metadata key-value pairs.
 */
export async function fetchTopicMetadata(
  http: HttpClient,
  mapId: string,
  contentId: string
): Promise<FtTopicInfo> {
  const url = mapsUrl(mapId, 'topics', contentId);
  return await http.getJson<FtTopicInfo>(url);
}

/**
 * The path of a {@link fetchMapTopics}, {@link fetchTopicMetadata} or
 * {@link fetchTopicContent} request.
 */
const TOPIC_REQUEST_PATH = /^\/api\/khub\/maps\/[^/]+\/topics(?:\/[^/]+(?:\/content)?)?$/;

/**
 * Whether `url` is one of the requests an article on learn.jamf.com is read
 * by: its map's topic index ({@link fetchMapTopics}), which a url is resolved
 * through, or its own metadata or body ({@link fetchTopicMetadata},
 * {@link fetchTopicContent}). Each path segment is encoded, so none holds a
 * `/`.
 *
 * Each answers 404 only when what it names is gone: the topic, or, for the
 * index, the whole map. Live on 2026-09-28, `/api/khub/maps/NoSuchMapXyz123/topics`
 * and `…/topics/NoSuchTopicXyz123` both answered 404. So a url into a map
 * Jamf has retired, resolved through a maps list cached before it was, is
 * answered 404 by the index, and a `mapId` + `contentId` pair into the same
 * map by the topic: the same article, gone either way.
 */
export function isTopicRequestUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.origin === new URL(FT_API_BASE).origin && TOPIC_REQUEST_PATH.test(parsed.pathname);
}
