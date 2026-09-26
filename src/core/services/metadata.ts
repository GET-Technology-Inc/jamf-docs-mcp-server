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
import { cacheKey } from './cache-key.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Out-parameter for reporting that a lookup answered from static constants
 * because the upstream registry was unavailable.
 *
 * Callers that care — chiefly MCP resource handlers, which must not let a
 * transient upstream failure be cached publicly for an hour — pass one in and
 * read `degraded` afterwards. Callers that do not care pass nothing, so this
 * stays additive at every existing call site.
 */
export interface DegradationStatus {
  degraded: boolean;
}

/**
 * How a lookup treats a fallback it finds in the cache.
 *
 * `revalidateFallback` is for a caller that has just had an answer from the
 * maps registry. A cached fallback is then known to be stale, and rebuilding
 * it costs no request, because the registry is built and in memory. Without
 * this, such a caller gets the fallback until its minute is up: `list_products`
 * reads the publication axis first for exactly this, so one reply cannot pair
 * the registry's publications with the fallback's products (#335). A caller
 * with no such news leaves it unset, so an outage does not send it back to an
 * endpoint that has just failed. A real cached answer is served either way.
 */
export interface MetadataReadOptions {
  revalidateFallback?: boolean;
}

/**
 * How long an answer the registry outage forced is cached, against the
 * lifetime of a real one.
 *
 * A minute. `MapsRegistry` does not cache a failure at all, so a fallback kept
 * any longer outlives the outage it stands in for: kept for the full article
 * TTL, one failed fetch made `list_products` and `jamf://products` report Jamf
 * Pro as unversioned for 24 hours, while the publication list beside it had
 * the registry's versions again on the next call (#335). Not zero, because a
 * burst of calls during an outage would each wait on an endpoint that has just
 * failed. A minute is also well inside the one-hour public hint that
 * `jamf://products` withholds from these answers, so core no longer keeps a
 * fallback longer than it would let a shared cache keep a real answer.
 */
const FALLBACK_TTL_MS = 60 * 1000;

/** Whether a cache hit is a fallback the caller has asked not to be served. */
function isStaleFallback(entry: { degraded: boolean }, options: MetadataReadOptions): boolean {
  return entry.degraded && options.revalidateFallback === true;
}

// Declared once, in the interfaces layer, and re-exported here because this
// module's own consumers name it. The dependency runs implementation ->
// interface, not the other way round; core/index.ts publishes the interfaces
// copy, which is the one that was always canonical.
import type { ProductMetadata, TopicMetadata } from './interfaces/metadata.js';

export type { ProductMetadata, TopicMetadata };

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
  };
}

// ============================================================================
// Product Metadata
// ============================================================================

/**
 * What the products cache entry holds.
 *
 * The list alone is not enough: a caller has to be able to tell an answer
 * built from the live registry apart from one the registry outage forced, and
 * a cache hit is no different from a miss in that. So the flag is stored
 * *with* the value — a cache hit reports its provenance as accurately as a
 * miss does, for the minute a forced answer is kept ({@link FALLBACK_TTL_MS}).
 *
 * The key carries a `:v2` suffix because entries written by earlier versions
 * are a bare `ProductMetadata[]`. Bumping it retires those without any
 * shape-sniffing on read; they simply expire unread.
 */
interface CachedProductsMetadata {
  products: ProductMetadata[];
  degraded: boolean;
}

const PRODUCTS_CACHE_KEY = cacheKey('metadata-products-v2');

/**
 * Whether a cache hit really holds what this module wrote.
 *
 * The cache is backed by JSON on disk on Node, so a truncated write or an
 * entry from a future/older build can come back as anything. Treating a
 * mismatch as a miss costs one upstream call; trusting it costs a
 * `TypeError` in a request handler.
 */
function isCachedProductsMetadata(value: unknown): value is CachedProductsMetadata {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as { products?: unknown; degraded?: unknown };
  return Array.isArray(candidate.products) && typeof candidate.degraded === 'boolean';
}

/**
 * Build (or fetch from cache) the product catalogue and its provenance.
 */
async function loadProductsMetadata(
  ctx: ServerContext,
  options: MetadataReadOptions,
): Promise<CachedProductsMetadata> {
  const log = ctx.logger.createLogger('metadata');

  const cached = await ctx.cache.get<unknown>(PRODUCTS_CACHE_KEY);
  if (isCachedProductsMetadata(cached) && !isStaleFallback(cached, options)) {
    return cached;
  }

  const productIds = Object.keys(JAMF_PRODUCTS) as ProductId[];
  let products: ProductMetadata[];
  let degraded = false;

  try {
    const registryProducts = await ctx.mapsRegistry.getProducts();

    // Build a lookup by bundleStem for quick matching
    const registryMap = new Map<string, RegistryProductInfo>();
    for (const rp of registryProducts) {
      registryMap.set(rp.bundleStem, rp);
    }

    products = productIds.map((productId) => {
      const bundleStem = productIdToBundleStem(productId);
      const info = registryMap.get(bundleStem);

      if (info !== undefined) {
        return buildProductMetadata(productId, info);
      }

      // Not a degradation: the registry answered, and it has nothing for this
      // product. That is a steady-state fact, identical on the next request,
      // so it is as cacheable as any other answer.
      log.debug(`No registry entry for ${productId} (stem=${bundleStem}), using fallback`);
      return buildFallbackMetadata(productId);
    });
  } catch (error) {
    // This one *is* a degradation: the registry could not be reached at all,
    // and the whole catalogue is compiled-in constants standing in for it.
    log.error(`MapsRegistry failed, using static fallback: ${String(error)}`);
    degraded = true;
    products = productIds.map((productId) => buildFallbackMetadata(productId));
  }

  const entry: CachedProductsMetadata = { products, degraded };

  // A real catalogue for the article TTL (24 hours by default); a forced one
  // for a minute (FALLBACK_TTL_MS).
  await ctx.cache.set(
    PRODUCTS_CACHE_KEY,
    entry,
    degraded ? FALLBACK_TTL_MS : ctx.config.cacheTtl.article,
  );

  return entry;
}

/**
 * Get all products with their latest metadata.
 * Uses MapsRegistry to discover products and versions dynamically,
 * with fallback to static JAMF_PRODUCTS constants.
 *
 * @param status - Optional sink; `degraded` is set when the returned catalogue
 *   is the static fallback because MapsRegistry was unreachable. Reported on
 *   cache hits too.
 * @param options - See {@link MetadataReadOptions}.
 */
export async function getProductsMetadata(
  ctx: ServerContext,
  status?: DegradationStatus,
  options: MetadataReadOptions = {},
): Promise<ProductMetadata[]> {
  const { products, degraded } = await loadProductsMetadata(ctx, options);

  if (degraded && status !== undefined) {
    status.degraded = true;
  }

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
  productId: ProductId,
  status?: DegradationStatus
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
  if (status !== undefined) {
    status.degraded = true;
  }
  return [JAMF_PRODUCTS[productId].latestVersion];
}

// ============================================================================
// Topic Categories
// ============================================================================

/**
 * Get all topics. Returns manual topics from JAMF_TOPICS constants.
 * The manual topics serve as the authoritative topic category list.
 *
 * There is no {@link DegradationStatus} parameter here and there should not
 * be: this reads compiled-in constants and makes no upstream call, so it has
 * no failure mode to fall back from. Its answer is always the real one.
 */
export async function getTopicsMetadata(ctx: ServerContext): Promise<TopicMetadata[]> {
  const key = cacheKey('metadata-topics');

  // Check cache
  const cached = await ctx.cache.get<TopicMetadata[]>(key);
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
  await ctx.cache.set(key, topics, ctx.config.cacheTtl.article);

  return topics;
}

// ============================================================================
// Product Availability
// ============================================================================

/**
 * What the availability cache entry holds: the map, and whether it is the
 * optimistic stand-in an outage forced. The same design as
 * {@link CachedProductsMetadata}, for the same reason.
 *
 * The key carries a `-v2` suffix because entries written by earlier versions
 * are the bare map, and an optimistic one of those would be served for up to
 * an hour as though the registry had built it. They fail
 * {@link isCachedProductAvailability} as well; the new key means they are
 * never read.
 */
interface CachedProductAvailability {
  availability: Record<string, boolean>;
  degraded: boolean;
}

const AVAILABILITY_CACHE_KEY = cacheKey('metadata-product-availability-v2');

/** How long a real availability map is kept. */
const AVAILABILITY_TTL_MS = 60 * 60 * 1000;

/** Whether a cache hit really holds what {@link getProductAvailability} wrote. */
function isCachedProductAvailability(value: unknown): value is CachedProductAvailability {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as { availability?: unknown; degraded?: unknown };
  return typeof candidate.availability === 'object' && candidate.availability !== null
    && typeof candidate.degraded === 'boolean';
}

/**
 * Build (or fetch from cache) the availability map and its provenance.
 */
async function loadProductAvailability(
  ctx: ServerContext,
  options: MetadataReadOptions,
): Promise<CachedProductAvailability> {
  const log = ctx.logger.createLogger('metadata');

  const cached = await ctx.cache.get<unknown>(AVAILABILITY_CACHE_KEY);
  if (isCachedProductAvailability(cached) && !isStaleFallback(cached, options)) {
    return cached;
  }

  const availability: Record<string, boolean> = {};
  const productIds = Object.keys(JAMF_PRODUCTS) as ProductId[];
  let degraded = false;

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
    // On failure, assume all products are available (optimistic). That is a
    // guess standing in for the registry's answer, so it is reported as one.
    degraded = true;
    for (const productId of productIds) {
      availability[productId] = true;
    }
  }

  const entry: CachedProductAvailability = { availability, degraded };

  // A real map for an hour; a forced one for a minute (FALLBACK_TTL_MS).
  await ctx.cache.set(
    AVAILABILITY_CACHE_KEY,
    entry,
    degraded ? FALLBACK_TTL_MS : AVAILABILITY_TTL_MS,
  );

  return entry;
}

/**
 * Check which products have documentation available via MapsRegistry.
 *
 * @param status - Optional sink, as for {@link getProductsMetadata}: set when
 *   the registry was unreachable and every product is assumed available.
 *   Reported on cache hits too.
 * @param options - See {@link MetadataReadOptions}.
 */
export async function getProductAvailability(
  ctx: ServerContext,
  status?: DegradationStatus,
  options: MetadataReadOptions = {},
): Promise<Record<string, boolean>> {
  const { availability, degraded } = await loadProductAvailability(ctx, options);

  if (degraded && status !== undefined) {
    status.degraded = true;
  }

  return availability;
}

// ============================================================================
// Convenience functions for Resources
// ============================================================================

/**
 * Get products data formatted for resource response
 *
 * @param status - Optional sink; see {@link getProductsMetadata}. The
 *   `jamf://products` resource passes one so it can withhold the standard
 *   one-hour public cache hint from an answer the registry outage forced.
 */
export async function getProductsResourceData(ctx: ServerContext, status?: DegradationStatus): Promise<{
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
  const products = await getProductsMetadata(ctx, status);

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
