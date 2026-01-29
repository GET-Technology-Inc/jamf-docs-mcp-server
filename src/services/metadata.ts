/**
 * Metadata service for Jamf documentation
 *
 * Dynamically fetches product versions and topic categories from the API
 * with fallback to static constants.
 */

import axios from 'axios';
import * as cheerio from 'cheerio';

import {
  DOCS_API_URL,
  JAMF_PRODUCTS,
  JAMF_TOPICS,
  REQUEST_CONFIG,
  CACHE_TTL,
  type ProductId
} from '../constants.js';
import { cache } from './cache.js';

// ============================================================================
// Types
// ============================================================================

export interface ProductMetadata {
  id: string;
  name: string;
  description: string;
  bundleId: string;
  latestVersion: string;
  availableVersions: string[];  // All discovered versions
  labelKey: string;  // e.g., 'product-pro'
}

export interface TopicMetadata {
  id: string;
  name: string;
  source: 'toc' | 'manual';  // Where this topic came from
  articleCount?: number;
}

export interface TocCategory {
  navId: string;
  title: string;
  articleCount: number;
  children: string[];  // Child article titles for keyword generation
}

// ============================================================================
// API Helpers
// ============================================================================

async function fetchJson<T>(url: string): Promise<T> {
  const response = await axios.get<T>(url, {
    timeout: REQUEST_CONFIG.TIMEOUT,
    headers: {
      'User-Agent': REQUEST_CONFIG.USER_AGENT,
      'Accept': 'application/json'
    }
  });
  return response.data;
}

// ============================================================================
// Product Metadata
// ============================================================================

interface ZoominSearchResult {
  Results: {
    leading_result?: {
      bundle_id?: string | null;
      labels?: {
        key: string;
        navtitle: string;
      }[];
    };
  }[];
}

/**
 * Discover all available versions for a product
 */
async function discoverProductVersions(productId: ProductId): Promise<string[]> {
  const product = JAMF_PRODUCTS[productId];
  const versions = new Set<string>();

  try {
    // Search with a broad query to find all bundle versions
    const apiUrl = `${DOCS_API_URL}/api/search?q=${encodeURIComponent(product.name)}&rpp=100`;
    const response = await fetchJson<ZoominSearchResult>(apiUrl);

    const versionRegex = /-(\d+\.\d+\.\d+)$/;
    const bundlePrefix = `${product.bundleId}-`;

    for (const wrapper of response.Results) {
      const bundleId = wrapper.leading_result?.bundle_id;

      // Skip if no bundle_id (null or undefined)
      if (bundleId === null || bundleId === undefined) {
        continue;
      }

      // Check if this is a versioned documentation bundle for our product
      if (bundleId.startsWith(bundlePrefix) || bundleId === product.bundleId) {
        const match = versionRegex.exec(bundleId);
        if (match?.[1] !== undefined) {
          versions.add(match[1]);
        }
      }
    }
  } catch (error) {
    console.error(`[METADATA] Error discovering versions for ${productId}:`, error);
  }

  // Sort versions in descending order (newest first)
  return Array.from(versions).sort((a, b) => {
    const partsA = a.split('.').map(Number);
    const partsB = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      const diff = (partsB[i] ?? 0) - (partsA[i] ?? 0);
      if (diff !== 0) {
        return diff;
      }
    }
    return 0;
  });
}

/**
 * Fetch latest version and metadata for a product from the API
 */
async function fetchProductMetadata(productId: ProductId): Promise<ProductMetadata | null> {
  const product = JAMF_PRODUCTS[productId];

  try {
    // Discover all available versions
    const availableVersions = await discoverProductVersions(productId);

    // Search for a doc from this product to get the bundle ID and labels
    const apiUrl = `${DOCS_API_URL}/api/search?q=${encodeURIComponent(product.name)}&rpp=5`;
    const response = await fetchJson<ZoominSearchResult>(apiUrl);

    for (const wrapper of response.Results) {
      const result = wrapper.leading_result;
      const bundleId = result?.bundle_id;

      // Skip if no bundle_id or doesn't match our product
      if (bundleId?.startsWith(product.bundleId) !== true) {
        continue;
      }

      // Extract version from bundle_id (e.g., "jamf-pro-documentation-11.24.0" → "11.24.0")
      const versionRegex = /-(\d+\.\d+\.\d+)$/;
      const versionMatch = versionRegex.exec(bundleId);
      const latestVersion = versionMatch?.[1] ?? 'current';

      // Find product label key
      const productLabel = result?.labels?.find(l => l.key.startsWith('product-') && !l.key.includes('-'));
      const labelKey = productLabel?.key ?? product.searchLabel;

      return {
        id: productId,
        name: product.name,
        description: product.description,
        bundleId,
        latestVersion,
        availableVersions: availableVersions.length > 0 ? availableVersions : [latestVersion],
        labelKey
      };
    }
  } catch (error) {
    console.error(`[METADATA] Error fetching metadata for ${productId}:`, error);
  }

  return null;
}

/**
 * Get all products with their latest metadata
 * Uses cache with fallback to static constants
 */
export async function getProductsMetadata(): Promise<ProductMetadata[]> {
  const cacheKey = 'metadata:products';

  // Check cache
  const cached = await cache.get<ProductMetadata[]>(cacheKey);
  if (cached !== null) {
    return cached;
  }

  const products: ProductMetadata[] = [];

  // Fetch metadata for each product
  for (const productId of Object.keys(JAMF_PRODUCTS) as ProductId[]) {
    const metadata = await fetchProductMetadata(productId);

    if (metadata !== null) {
      products.push(metadata);
    } else {
      // Fallback to static data
      const product = JAMF_PRODUCTS[productId];
      products.push({
        id: productId,
        name: product.name,
        description: product.description,
        bundleId: product.bundleId,
        latestVersion: product.latestVersion,
        availableVersions: [product.latestVersion],
        labelKey: product.searchLabel
      });
    }
  }

  // Cache for 24 hours
  await cache.set(cacheKey, products, CACHE_TTL.ARTICLE_CONTENT);

  return products;
}

/**
 * Get the bundle ID for a specific product and version
 * Returns the latest bundle ID if version is undefined or 'current'
 */
export async function getBundleIdForVersion(
  productId: ProductId,
  version?: string
): Promise<string | null> {
  const products = await getProductsMetadata();
  const product = products.find(p => p.id === productId);

  if (product === undefined) {
    return null;
  }

  // If no version specified or 'current', return latest
  if (version === undefined || version === 'current' || version === 'latest') {
    return product.bundleId;
  }

  // Check if requested version is available
  if (!product.availableVersions.includes(version)) {
    console.error(`[METADATA] Version ${version} not available for ${productId}. Available: ${product.availableVersions.join(', ')}`);
    return null;
  }

  // Construct versioned bundle ID
  const baseBundle = JAMF_PRODUCTS[productId].bundleId;
  return `${baseBundle}-${version}`;
}

/**
 * Get available versions for a product
 */
export async function getAvailableVersions(productId: ProductId): Promise<string[]> {
  const products = await getProductsMetadata();
  const product = products.find(p => p.id === productId);
  return product?.availableVersions ?? [];
}

// ============================================================================
// Topic Categories from TOC
// ============================================================================

/**
 * Parse TOC HTML to extract categories
 */
function parseTocCategories(tocData: Record<string, string>): TocCategory[] {
  const categories: TocCategory[] = [];

  // Sort by nav ID number
  const sortedEntries = Object.entries(tocData)
    .filter(([key]) => key.startsWith('nav-'))
    .sort((a, b) => {
      const numA = parseInt(a[0].replace('nav-', ''), 10);
      const numB = parseInt(b[0].replace('nav-', ''), 10);
      return numA - numB;
    });

  for (const [navId, html] of sortedEntries) {
    if (typeof html !== 'string' || !html.includes('<ul')) {
      continue;
    }

    const $ = cheerio.load(html);
    const children: string[] = [];

    // Get all article titles in this section
    $('a').each((_, el) => {
      const title = $(el).text().trim();
      if (title !== '') {
        children.push(title);
      }
    });

    if (children.length > 0) {
      // First child is usually the section title
      const title = children[0] ?? 'Untitled';

      categories.push({
        navId,
        title,
        articleCount: children.length,
        children: children.slice(1)  // Exclude the title itself
      });
    }
  }

  return categories;
}

/**
 * Convert TOC category to topic ID (slug)
 */
function categoryToTopicId(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30);  // Limit length
}

/**
 * Fetch topic categories from TOC for a product
 */
async function fetchTopicCategories(productId: ProductId): Promise<TocCategory[]> {
  try {
    // First get the latest bundle ID
    const products = await getProductsMetadata();
    const product = products.find(p => p.id === productId);

    if (product === undefined) {
      return [];
    }

    const tocUrl = `${DOCS_API_URL}/bundle/${product.bundleId}/toc`;
    const tocData = await fetchJson<Record<string, string>>(tocUrl);

    return parseTocCategories(tocData);
  } catch (error) {
    console.error(`[METADATA] Error fetching TOC categories for ${productId}:`, error);
    return [];
  }
}

/**
 * Add or update a topic in the map
 */
function upsertTopic(
  topicsMap: Map<string, TopicMetadata>,
  category: TocCategory
): void {
  const topicId = categoryToTopicId(category.title);

  if (!topicsMap.has(topicId)) {
    // Add new topic from TOC
    topicsMap.set(topicId, {
      id: topicId,
      name: category.title,
      source: 'toc',
      articleCount: category.articleCount
    });
  } else {
    // Update existing topic with article count (accumulate across products)
    const existing = topicsMap.get(topicId);
    if (existing !== undefined) {
      existing.articleCount = (existing.articleCount ?? 0) + category.articleCount;
    }
  }
}

/**
 * Get all topics, combining TOC-derived from all products and manual topics
 */
export async function getTopicsMetadata(): Promise<TopicMetadata[]> {
  const cacheKey = 'metadata:topics';

  // Check cache
  const cached = await cache.get<TopicMetadata[]>(cacheKey);
  if (cached !== null) {
    return cached;
  }

  const topicsMap = new Map<string, TopicMetadata>();

  // Start with manual topics as fallback
  for (const [id, topic] of Object.entries(JAMF_TOPICS)) {
    topicsMap.set(id, {
      id,
      name: topic.name,
      source: 'manual'
    });
  }

  // Fetch TOC categories from ALL products
  const productIds = Object.keys(JAMF_PRODUCTS) as ProductId[];

  for (const productId of productIds) {
    try {
      const categories = await fetchTopicCategories(productId);
      for (const category of categories) {
        upsertTopic(topicsMap, category);
      }
    } catch (error) {
      console.error(`[METADATA] Error fetching TOC for ${productId}:`, error);
      // Continue with other products
    }
  }

  const topics = Array.from(topicsMap.values());

  // Cache for 24 hours
  await cache.set(cacheKey, topics, CACHE_TTL.ARTICLE_CONTENT);

  return topics;
}

// ============================================================================
// Convenience functions for Resources
// ============================================================================

/**
 * Get products data formatted for resource response
 */
export async function getProductsResourceData(): Promise<{
  description: string;
  products: {
    id: string;
    name: string;
    description: string;
    latestVersion: string;
    availableVersions: string[];
    bundleId: string;
  }[];
  lastUpdated: string;
  usage: string;
}> {
  const products = await getProductsMetadata();

  return {
    description: 'Available Jamf products for documentation search',
    products: products.map(p => ({
      id: p.id,
      name: p.name,
      description: p.description,
      latestVersion: p.latestVersion,
      availableVersions: p.availableVersions,
      bundleId: p.bundleId
    })),
    lastUpdated: new Date().toISOString(),
    usage: 'Use product ID (e.g., "jamf-pro") with jamf_docs_search or jamf_docs_get_toc tools. Use version parameter to query specific versions.'
  };
}

/**
 * Get topics data formatted for resource response
 */
export async function getTopicsResourceData(): Promise<{
  description: string;
  totalTopics: number;
  topics: {
    id: string;
    name: string;
    source: string;
    articleCount?: number;
  }[];
  lastUpdated: string;
  usage: string;
}> {
  const topics = await getTopicsMetadata();

  return {
    description: 'Topic categories for filtering Jamf documentation searches',
    totalTopics: topics.length,
    topics: topics.map(t => ({
      id: t.id,
      name: t.name,
      source: t.source,
      ...(t.articleCount !== undefined ? { articleCount: t.articleCount } : {})
    })),
    lastUpdated: new Date().toISOString(),
    usage: 'Use topic ID (e.g., "enrollment") with jamf_docs_search tool to filter results'
  };
}
