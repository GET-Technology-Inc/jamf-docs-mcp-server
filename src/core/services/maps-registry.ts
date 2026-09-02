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
import { cacheKey } from './cache-key.js';
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
  /** `jamf:portal` — the platform this publication documents. '' when absent. */
  portal: string;
  /** `jamf:app` — the client app this publication documents. '' when absent. */
  app: string;
  /** `jamf:utility` — the utility this publication documents. '' when absent. */
  utility: string;
}

export interface RegistryProductInfo {
  bundleStem: string;
  title: string;
  versions: string[];   // sorted descending (newest first)
}

/**
 * One bundle family, as Jamf classifies it.
 *
 * This is the *publication* axis: it answers "which document is this",
 * whereas {@link JAMF_PRODUCTS} answers "which product is this about". Fluid
 * Topics keeps them separate and so does this type — `get_toc` and
 * `get_article` only ever needed a bundle stem, and binding them to the
 * product registry is what limited reachable content to 12 of 97 families.
 */
export interface PublicationInfo {
  /** The bundle family stem, e.g. `technical-paper-laps`. Addresses get_toc. */
  id: string;
  /** Title of the family's map in the requested locale. */
  title: string;
  /** `jamf:portal` — platform. '' when Jamf assigns none. */
  portal: string;
  /** `jamf:app` — client app. '' when Jamf assigns none. */
  app: string;
  /** `jamf:utility` — utility. '' when Jamf assigns none. */
  utility: string;
  /** Locales this family actually publishes in, sorted. */
  locales: string[];
  /** Versions, newest first. Empty for the unversioned majority. */
  versions: string[];
}

/** {@link PublicationInfo} plus the bookkeeping `listPublications` needs while building it. */
interface PublicationDraft extends PublicationInfo {
  /** Version of the map `title` came from, used to break rank ties. */
  versionOfTitle: string;
}

// ─── Metadata helpers ───────────────────────────────────────────

/**
 * Derive bundleStem from metadata.
 * Prefers `version_bundle_stem` (clean stem), otherwise parses `bundle` values.
 */
function deriveBundleStem(metadata: FtMetadataEntry[] | undefined): string {
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

/** Convert an FT map payload into a registry entry. */
function parseMap(map: FtMapInfo): MapEntry {
  const { metadata } = map;
  return {
    mapId: map.id,
    // '' is this type's existing sentinel for an absent value (see `version`
    // and `locale` below). Nothing renders this field today — product names
    // come from the compiled-in JAMF_PRODUCTS — so there is no user-visible
    // fallback to choose.
    title: map.title ?? '',
    bundleStem: deriveBundleStem(metadata),
    version: getMetaValue(metadata, FT_META.VERSION),
    locale: getMetaValue(metadata, FT_META.LOCALE),
    isLatest: getMetaValue(metadata, FT_META.LATEST_VERSION) === 'yes',
    bundleValues: getMetaValues(metadata, FT_META.BUNDLE),
    portal: getMetaValue(metadata, FT_META.PORTAL),
    app: getMetaValue(metadata, FT_META.APP),
    utility: getMetaValue(metadata, FT_META.UTILITY),
  };
}

// ─── Registry ───────────────────────────────────────────────────

// v2: MapEntry gained portal/app/utility. A v1 payload deserialises into
// entries missing those fields, which would surface as every publication
// reporting no classification rather than as an error — so the namespace
// moves rather than the shape being widened in place. Entries left under the
// old namespace expire on their TTL and are reclaimed by the startup sweep.
const CACHE_KEY = cacheKey('maps-registry-v2');
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
    this.entries = maps.map(m => parseMap(m));
    this.builtAt = Date.now();

    await this.cache.set(CACHE_KEY, this.entries, this.cacheTtl);
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

    // Default: latest version. When no candidate is flagged latest (Jamf's
    // unversioned non-Pro docs carry no `latestVersion`), resolve
    // deterministically instead of falling through to API array order:
    //   1. prefer the unversioned/current map (version === ''), e.g. the
    //      jamf-connect-documentation `-current` vs `-2.45.0` collision;
    //   2. otherwise pick the highest version, so a family that loses
    //      `latestVersion` but keeps per-version maps still resolves to the
    //      newest rather than an arbitrary array position.
    return candidates.find(e => e.isLatest)
      ?? candidates.find(e => e.version === '')
      ?? [...candidates].sort((a, b) => compareVersions(b.version, a.version))[0];
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
    if (direct !== undefined) {return direct.mapId;}

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
      if (existing !== undefined) {
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
   * Every bundle family Fluid Topics publishes, with Jamf's own
   * classification attached.
   *
   * Sourced from the same `/api/khub/maps` payload the registry already
   * builds from, so it needs no extra request and cannot drift from what
   * `resolveMapId` can actually reach: 97 families as of 2026-09-02, against
   * the 12 reachable through {@link JAMF_PRODUCTS}.
   *
   * `locale` selects which locale's title to report and nothing else — the
   * list is not filtered by it, because a caller asking in zh-TW still needs
   * to see the en-US-only families (24 of them) rather than have them
   * silently vanish. Each entry's `locales` says what it actually has.
   */
  async listPublications(locale?: LocaleId): Promise<PublicationInfo[]> {
    await this.ensureBuilt();
    const loc = locale ?? DEFAULT_LOCALE;

    const byStem = new Map<string, PublicationDraft>();
    // Best title rank seen per family, so a later entry only replaces the
    // title when it is a strictly better source — not merely the last one.
    const titleRank = new Map<string, number>();

    for (const entry of this.entries) {
      if (entry.bundleStem === '') { continue; }

      let info = byStem.get(entry.bundleStem);
      if (info === undefined) {
        info = {
          id: entry.bundleStem,
          title: '',
          portal: entry.portal,
          app: entry.app,
          utility: entry.utility,
          locales: [],
          versions: [],
          versionOfTitle: '',
        };
        byStem.set(entry.bundleStem, info);
      }

      if (!info.locales.includes(entry.locale)) { info.locales.push(entry.locale); }
      if (entry.version !== '' && !info.versions.includes(entry.version)) {
        info.versions.push(entry.version);
      }

      // Title preference: the requested locale's latest map, then the highest
      // version in that locale, then that locale at all, then anything.
      // Ranking rather than last-write-wins matters for the versioned
      // families — `jamf-pro-release-notes` publishes 43 maps whose titles
      // each carry their own version, and API order is not version order, so
      // taking the last match reported "Jamf Pro Release Notes 11.13.1" as
      // the name of a family whose newest release is 11.31.1.
      const rank =
        (entry.locale === loc && entry.isLatest) ? 4 :
        (entry.locale === loc && entry.version === '') ? 3 :
        (entry.locale === loc) ? 2 :
        1;
      const seen = titleRank.get(entry.bundleStem) ?? 0;
      const wins = rank > seen
        // Same rank: for a versioned family this is version order, since two
        // entries only tie at rank 2 when both are dated maps in `loc`.
        || (rank === seen && rank === 2 && compareVersions(entry.version, info.versionOfTitle) > 0);
      if (wins) {
        info.title = entry.title;
        info.versionOfTitle = entry.version;
        titleRank.set(entry.bundleStem, rank);
      }
    }

    for (const info of byStem.values()) {
      info.locales.sort();
      info.versions.sort((a, b) => compareVersions(b, a));
    }

    return [...byStem.values()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(({ versionOfTitle: _drop, ...info }) => info);
  }

  /**
   * The title Jamf gives one specific map of a family.
   *
   * `listPublications` reports a family-level title, which for a versioned
   * family is the latest map's — and those titles carry their own version
   * ("Jamf Pro Release Notes 11.31.0"). Serving 11.26.0 under that name is
   * wrong in the one place a reader would check, so a request that names a
   * version resolves its own title through the same selection `resolveMapId`
   * uses, locale fallback included.
   */
  async resolveTitle(
    bundleStem: string,
    version?: string,
    locale?: LocaleId,
  ): Promise<string | null> {
    await this.ensureBuilt();
    const loc = locale ?? DEFAULT_LOCALE;
    const normalized = stripCurrentSuffix(bundleStem);

    const match = this.findMap(normalized, version, loc)
      ?? (loc !== DEFAULT_LOCALE ? this.findMap(normalized, version, DEFAULT_LOCALE) : null);

    return match?.title ?? null;
  }

  /**
   * Whether a bundle family exists at all, in any locale.
   *
   * `resolveMapId` returning null cannot distinguish "no such publication"
   * from "this publication has no map in that locale", and those need
   * different messages.
   */
  async hasPublication(bundleStem: string): Promise<boolean> {
    await this.ensureBuilt();
    const normalized = stripCurrentSuffix(bundleStem);
    return this.entries.some(e => e.bundleStem === normalized);
  }

  /**
   * Bundle family ids closest to a miss, for the "did you mean" in an error.
   */
  async suggestPublications(bundleStem: string, limit = 5): Promise<string[]> {
    await this.ensureBuilt();
    const needle = stripCurrentSuffix(bundleStem).toLowerCase();
    const all = [...new Set(this.entries.map(e => e.bundleStem))].filter(id => id !== '');

    const scored = all
      .map(id => {
        const haystack = id.toLowerCase();
        // Substring either way scores highest; otherwise share of the
        // needle's hyphen-separated words that appear in the candidate.
        if (haystack.includes(needle) || needle.includes(haystack)) { return { id, score: 1 }; }
        const words = needle.split('-').filter(w => w.length > 2);
        if (words.length === 0) { return { id, score: 0 }; }
        const hits = words.filter(w => haystack.includes(w)).length;
        return { id, score: hits / words.length };
      })
      .filter(c => c.score > 0)
      .sort((a, b) => (b.score - a.score !== 0 ? b.score - a.score : a.id.localeCompare(b.id)));

    return scored.slice(0, limit).map(c => c.id);
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
