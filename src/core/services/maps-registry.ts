/**
 * Maps Registry — product/version/locale → mapId resolution
 *
 * Builds a lookup table from FT's GET /api/khub/maps response.
 * All mapIds are dynamically discovered, nothing hardcoded.
 *
 * Key concepts:
 * - `bundleStem`: product identifier without version (e.g., "jamf-pro-documentation")
 *   Derived from `version_bundle_stem` metadata, or parsed from `bundle` values.
 * - Each map is locale-specific (separate mapId per language)
 * - `latestVersion=yes` marks the current version
 */

import { fetchMaps } from './ft-client.js';
import { DEFAULT_LOCALE, type LocaleId } from '../constants.js';
import type { FtMapInfo, FtMetadataEntry } from '../types.js';
import type { CacheProvider, MapsProvider } from './interfaces/index.js';
import { getMetaValue, getMetaValues, FT_META } from '../utils/ft-metadata.js';
import {
  compareVersions,
  extractVersionFromBundleId,
  stripVersionSuffix,
  stripCurrentSuffix,
} from '../utils/bundle.js';

// ─── Types ──────────────────────────────────────────────────────

export interface MapEntry {
  mapId: string;
  title: string;
  bundleStem: string;
  version: string;      // '' for unversioned maps
  locale: string;
  isLatest: boolean;
  bundleValues: string[];
}

export interface RegistryProductInfo {
  bundleStem: string;
  title: string;
  versions: string[];   // sorted descending (newest first)
}

// ─── Metadata helpers ───────────────────────────────────────────

/**
 * Derive bundleStem from metadata.
 * Prefers `version_bundle_stem` (clean stem), otherwise parses `bundle` values.
 */
function deriveBundleStem(metadata: FtMetadataEntry[]): string {
  const stem = getMetaValue(metadata, FT_META.VERSION_BUNDLE_STEM);
  if (stem !== '') {return stem;}

  // Parse from bundle values: strip version suffixes and "-current"
  const bundles = getMetaValues(metadata, FT_META.BUNDLE);
  if (bundles.length === 0) {return '';}

  // Take the shortest bundle value as it's likely the stem
  // e.g., ['jamf-pro-documentation-11.26.0', 'jamf-pro-documentation-current']
  // → sorted by length → 'jamf-pro-documentation-current'
  // Then strip known suffixes
  const sorted = [...bundles].sort((a, b) => a.length - b.length);
  const candidate = sorted[0] ?? '';
  return stripVersionSuffix(stripCurrentSuffix(candidate));
}

// ─── Registry ───────────────────────────────────────────────────

const CACHE_KEY = 'maps-registry';
const DEFAULT_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const GLOSSARY_BUNDLE_STEM = 'jamf-technical-glossary';

export class MapsRegistry {
  private entries: MapEntry[] = [];
  private builtAt = 0;
  private buildPromise: Promise<void> | null = null;
  private readonly fetchMapsFn: typeof fetchMaps;
  private readonly mapsProvider: MapsProvider | undefined;
  private readonly cacheTtl: number;

  constructor(
    private readonly cache: CacheProvider,
    fetchMapsFn?: typeof fetchMaps,
    mapsProvider?: MapsProvider,
    cacheTtl?: number,
  ) {
    this.fetchMapsFn = fetchMapsFn ?? fetchMaps;
    this.mapsProvider = mapsProvider;
    this.cacheTtl = cacheTtl ?? DEFAULT_CACHE_TTL;
  }

  /**
   * Reset the registry so the next `ensureBuilt()` call re-fetches from
   * the API (or cache). Use this to force invalidation when stale data
   * is suspected.
   */
  reset(): void {
    this.builtAt = 0;
    this.entries = [];
  }

  /**
   * Build the registry from FT API (cached).
   * Uses in-flight deduplication to prevent thundering herd when
   * multiple concurrent callers invoke ensureBuilt() simultaneously.
   */
  async ensureBuilt(): Promise<void> {
    if (this.builtAt > 0 && (Date.now() - this.builtAt) < this.cacheTtl) {return;}
    if (this.buildPromise !== null) {
      await this.buildPromise;
      return;
    }
    this.buildPromise = this.doBuild();
    try {
      await this.buildPromise;
    } finally {
      this.buildPromise = null;
    }
  }

  /**
   * Internal build logic: fetch maps from cache or API and populate entries.
   */
  private async doBuild(): Promise<void> {
    const cached = await this.cache.get<MapEntry[]>(CACHE_KEY);
    if (cached !== null) {
      this.entries = cached;
      this.builtAt = Date.now();
      return;
    }

    const maps = this.mapsProvider !== undefined
      ? await this.mapsProvider.getMaps()
      : await this.fetchMapsFn();
    this.entries = maps.map(m => this.parseMap(m));
    this.builtAt = Date.now();

    await this.cache.set(CACHE_KEY, this.entries, this.cacheTtl);
  }

  private parseMap(map: FtMapInfo): MapEntry {
    const { metadata } = map;
    return {
      mapId: map.id,
      title: map.title,
      bundleStem: deriveBundleStem(metadata),
      version: getMetaValue(metadata, FT_META.VERSION),
      locale: getMetaValue(metadata, FT_META.LOCALE),
      isLatest: getMetaValue(metadata, FT_META.LATEST_VERSION) === 'yes',
      bundleValues: getMetaValues(metadata, FT_META.BUNDLE),
    };
  }

  /**
   * Resolve a product + optional version + locale to a mapId.
   * Returns null if not found.
   */
  async resolveMapId(
    bundleStem: string,
    version?: string,
    locale?: LocaleId
  ): Promise<string | null> {
    await this.ensureBuilt();
    const loc = locale ?? DEFAULT_LOCALE;

    // Normalize: strip -current suffix if present
    const normalizedStem = stripCurrentSuffix(bundleStem);

    // Try exact locale first, then fallback to en-US
    const match = this.findMap(normalizedStem, version, loc)
      ?? (loc !== DEFAULT_LOCALE
        ? this.findMap(normalizedStem, version, DEFAULT_LOCALE)
        : null);

    return match?.mapId ?? null;
  }

  private findMap(
    bundleStem: string,
    version: string | undefined,
    locale: string
  ): MapEntry | undefined {
    const candidates = this.entries.filter(
      e => e.bundleStem === bundleStem && e.locale === locale
    );

    if (version !== undefined && version !== '' && version !== 'current') {
      return candidates.find(e => e.version === version);
    }

    // Default: latest version
    return candidates.find(e => e.isLatest)
      ?? candidates[0]; // fallback to any match
  }

  /**
   * Resolve a legacy bundleId (e.g., "jamf-pro-documentation-11.12.0")
   * to a mapId.
   */
  async resolveFromBundleId(
    bundleId: string,
    locale?: LocaleId
  ): Promise<string | null> {
    await this.ensureBuilt();
    const loc = locale ?? DEFAULT_LOCALE;

    // Direct match against bundle metadata values
    const direct = this.entries.find(
      e => e.locale === loc && e.bundleValues.includes(bundleId)
    );
    if (direct) {return direct.mapId;}

    // Fallback: parse stem + version from bundleId
    const stripped = stripCurrentSuffix(bundleId);

    // Try to extract version: "jamf-pro-documentation-11.12.0" → version = "11.12.0"
    const version = extractVersionFromBundleId(stripped);
    if (version !== null) {
      const stem = stripVersionSuffix(stripped);
      return await this.resolveMapId(stem, version, locale);
    }

    // No version — treat as stem, resolve latest
    return await this.resolveMapId(stripped, undefined, locale);
  }

  /**
   * Find the glossary map for a given locale.
   * Searches for maps with bundleStem containing "glossary".
   */
  async resolveGlossaryMapId(locale?: LocaleId): Promise<string | null> {
    await this.ensureBuilt();
    const loc = locale ?? DEFAULT_LOCALE;

    const match = this.entries.find(
      e => e.bundleStem === GLOSSARY_BUNDLE_STEM && e.locale === loc
    ) ?? this.entries.find(
      e => e.bundleStem === GLOSSARY_BUNDLE_STEM && e.locale === DEFAULT_LOCALE
    );

    return match?.mapId ?? null;
  }

  /**
   * Get all unique products for a locale.
   */
  async getProducts(locale?: LocaleId): Promise<RegistryProductInfo[]> {
    await this.ensureBuilt();
    const loc = locale ?? DEFAULT_LOCALE;

    const productMap = new Map<string, RegistryProductInfo>();

    for (const entry of this.entries) {
      if (entry.locale !== loc) {continue;}
      if (entry.bundleStem === '') {continue;}

      const existing = productMap.get(entry.bundleStem);
      if (existing) {
        if (entry.version !== '' && !existing.versions.includes(entry.version)) {
          existing.versions.push(entry.version);
        }
        // Use latest version's title
        if (entry.isLatest) {
          existing.title = entry.title;
        }
      } else {
        productMap.set(entry.bundleStem, {
          bundleStem: entry.bundleStem,
          title: entry.title,
          versions: entry.version !== '' ? [entry.version] : [],
        });
      }
    }

    // Sort versions descending within each product
    for (const product of productMap.values()) {
      product.versions.sort((a, b) => compareVersions(b, a));
    }

    return [...productMap.values()];
  }

  /**
   * Get available versions for a product.
   * Filters entries directly instead of rebuilding the full product catalogue.
   */
  async getVersions(
    bundleStem: string,
    locale?: LocaleId
  ): Promise<string[]> {
    await this.ensureBuilt();
    const loc = locale ?? DEFAULT_LOCALE;

    const versions: string[] = [];
    for (const entry of this.entries) {
      if (entry.bundleStem !== bundleStem || entry.locale !== loc) {continue;}
      if (entry.version !== '' && !versions.includes(entry.version)) {
        versions.push(entry.version);
      }
    }

    return versions.sort((a, b) => compareVersions(b, a));
  }
}
