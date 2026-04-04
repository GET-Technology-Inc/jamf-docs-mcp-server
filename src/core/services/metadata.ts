/**
 * Metadata service for Jamf documentation
 *
 * Dynamically fetches product versions and topic categories from the
 * Fluid Topics MapsRegistry with fallback to static constants.
 */

import {
  JAMF_PRODUCTS,
  JAMF_TOPICS,
  type ProductId
} from '../constants.js';
import type { RegistryProductInfo } from './maps-registry.js';
import type { ServerContext } from '../types/context.js';

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
// Internal helpers
// ============================================================================

/**
 * Map a JAMF_PRODUCTS key (ProductId) to its expected bundleStem
 * (the value used in MapsRegistry).
 * For most products this is the bundleId from constants, e.g.
 * 'jamf-pro' -> 'jamf-pro-documentation'.
 */
function productIdToBundleStem(productId: ProductId): string {
  return JAMF_PRODUCTS[productId].bundleId;
}

/**
 * Build a ProductMetadata from MapsRegistry RegistryProductInfo + static constants.
 * Returns null if the productId is not in JAMF_PRODUCTS.
 */
function buildProductMetadata(
  productId: ProductId,
  info: RegistryProductInfo
): ProductMetadata {
  const staticProduct = JAMF_PRODUCTS[productId];
  const latestVersion = info.versions[0] ?? 'current';
  const bundleId = latestVersion !== 'current'
    ? `${staticProduct.bundleId}-${latestVersion}`
    : staticProduct.bundleId;

  return {
    id: productId,
    name: staticProduct.name,
    description: staticProduct.description,
    bundleId,
    latestVersion,
    availableVersions: info.versions.length > 0 ? info.versions : [latestVersion],
    labelKey: staticProduct.searchLabel,
  };
}

/**
 * Build a static fallback ProductMetadata when MapsRegistry has no data
 * for a given product.
 */
function buildFallbackMetadata(productId: ProductId): ProductMetadata {
  const product = JAMF_PRODUCTS[productId];
  return {
    id: productId,
    name: product.name,
    description: product.description,
    bundleId: product.bundleId,
    latestVersion: product.latestVersion,
    availableVersions: [product.latestVersion],
    labelKey: product.searchLabel,
  };
}

// ============================================================================
// Product Metadata
// ============================================================================

/**
 * Get all products with their latest metadata.
 * Uses MapsRegistry to discover products and versions dynamically,
 * with fallback to static JAMF_PRODUCTS constants.
 */
export async function getProductsMetadata(ctx: ServerContext): Promise<ProductMetadata[]> {
  const log = ctx.logger.createLogger('metadata');
  const cacheKey = 'metadata:products';

  // Check cache
  const cached = await ctx.cache.get<ProductMetadata[]>(cacheKey);
  if (cached !== null) {
    return cached;
  }

  const products: ProductMetadata[] = [];
  const productIds = Object.keys(JAMF_PRODUCTS) as ProductId[];

  try {
    const registryProducts = await ctx.mapsRegistry.getProducts();

    // Build a lookup by bundleStem for quick matching
    const registryMap = new Map<string, RegistryProductInfo>();
    for (const rp of registryProducts) {
      registryMap.set(rp.bundleStem, rp);
    }

    for (const productId of productIds) {
      const bundleStem = productIdToBundleStem(productId);
      const info = registryMap.get(bundleStem);

      if (info !== undefined) {
        products.push(buildProductMetadata(productId, info));
      } else {
        log.debug(`No registry entry for ${productId} (stem=${bundleStem}), using fallback`);
        products.push(buildFallbackMetadata(productId));
      }
    }
  } catch (error) {
    log.error(`MapsRegistry failed, using static fallback: ${String(error)}`);
    for (const productId of productIds) {
      products.push(buildFallbackMetadata(productId));
    }
  }

  // Cache for 24 hours
  await ctx.cache.set(cacheKey, products, ctx.config.cacheTtl.article);

  return products;
}

/**
 * Get the bundle ID for a specific product and version.
 * Returns the latest bundle ID if version is undefined or 'current'.
 *
 * The returned value is a legacy-compatible bundleId string
 * (e.g. 'jamf-pro-documentation-11.24.0') used for URL construction.
 */
export async function getBundleIdForVersion(
  ctx: ServerContext,
  productId: ProductId,
  version?: string
): Promise<string | null> {
  const log = ctx.logger.createLogger('metadata');
  const products = await getProductsMetadata(ctx);
  const product = products.find(p => p.id === productId);

  if (product === undefined) {
    return null;
  }

  // If no version specified or 'current'/'latest', return latest bundleId
  if (version === undefined || version === 'current' || version === 'latest') {
    return product.bundleId;
  }

  // Check if requested version is available
  if (!product.availableVersions.includes(version)) {
    log.warning(
      `Version ${version} not available for ${productId}. ` +
      `Available: ${product.availableVersions.join(', ')}`
    );
    return null;
  }

  // Construct versioned bundle ID
  const baseBundle = JAMF_PRODUCTS[productId].bundleId;
  return `${baseBundle}-${version}`;
}

/**
 * Get available versions for a product.
 *
 * Uses MapsRegistry.getVersions() to fetch versions for a single product
 * instead of loading the full product catalogue via getProductsMetadata().
 * Falls back to the static JAMF_PRODUCTS constant on failure.
 */
export async function getAvailableVersions(
  ctx: ServerContext,
  productId: ProductId
): Promise<string[]> {
  const log = ctx.logger.createLogger('metadata');
  const bundleStem = productIdToBundleStem(productId);

  try {
    const versions = await ctx.mapsRegistry.getVersions(bundleStem);
    if (versions.length > 0) {
      return versions;
    }
  } catch (error) {
    log.error(
      `MapsRegistry.getVersions failed for ${productId}: ${String(error)}`
    );
  }

  // Fallback: return the static latestVersion from constants
  return [JAMF_PRODUCTS[productId].latestVersion];
}

// ============================================================================
// Topic Categories
// ============================================================================

/**
 * Get all topics. Returns manual topics from JAMF_TOPICS constants.
 * The manual topics serve as the authoritative topic category list.
 */
export async function getTopicsMetadata(ctx: ServerContext): Promise<TopicMetadata[]> {
  const cacheKey = 'metadata:topics';

  // Check cache
  const cached = await ctx.cache.get<TopicMetadata[]>(cacheKey);
  if (cached !== null) {
    return cached;
  }

  const topics: TopicMetadata[] = [];

  for (const [id, topic] of Object.entries(JAMF_TOPICS)) {
    topics.push({
      id,
      name: topic.name,
      source: 'manual',
    });
  }

  // Cache for 24 hours
  await ctx.cache.set(cacheKey, topics, ctx.config.cacheTtl.article);

  return topics;
}

// ============================================================================
// Product Availability
// ============================================================================

/**
 * Check which products have documentation available via MapsRegistry.
 */
export async function getProductAvailability(
  ctx: ServerContext
): Promise<Record<string, boolean>> {
  const log = ctx.logger.createLogger('metadata');
  const cacheKey = 'metadata:product-availability';

  const cached = await ctx.cache.get<Record<string, boolean>>(cacheKey);
  if (cached !== null) {
    return cached;
  }

  const availability: Record<string, boolean> = {};
  const productIds = Object.keys(JAMF_PRODUCTS) as ProductId[];

  try {
    const registryProducts = await ctx.mapsRegistry.getProducts();

    // Build a set of known bundleStems
    const knownStems = new Set(registryProducts.map(rp => rp.bundleStem));

    for (const productId of productIds) {
      const bundleStem = productIdToBundleStem(productId);
      availability[productId] = knownStems.has(bundleStem);
    }
  } catch (error) {
    log.error(`MapsRegistry failed for availability check: ${String(error)}`);
    // On failure, assume all products are available (optimistic)
    for (const productId of productIds) {
      availability[productId] = true;
    }
  }

  // Cache for 1 hour
  await ctx.cache.set(cacheKey, availability, 60 * 60 * 1000);

  return availability;
}

// ============================================================================
// Convenience functions for Resources
// ============================================================================

/**
 * Get products data formatted for resource response
 */
export async function getProductsResourceData(ctx: ServerContext): Promise<{
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
  const products = await getProductsMetadata(ctx);

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
export async function getTopicsResourceData(ctx: ServerContext): Promise<{
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
  const topics = await getTopicsMetadata(ctx);

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
