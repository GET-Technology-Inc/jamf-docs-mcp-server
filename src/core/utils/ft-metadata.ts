/**
 * Shared utilities for working with Fluid Topics metadata entries.
 */
import type { FtMetadataEntry } from '../types.js';

// Well-known FT metadata keys used across the codebase
export const FT_META = {
  VERSION_BUNDLE_STEM: 'version_bundle_stem',
  VERSION: 'version',
  LATEST_VERSION: 'latestVersion',
  LOCALE: 'ft:locale',
  PRETTY_URL: 'ft:prettyUrl',
  BUNDLE: 'bundle',
  LEGACY_TOPICNAME: 'legacy_topicname',
  LEGACY_URL: 'legacy_url',
  ZOOMIN_METADATA: 'zoominmetadata',
  CONTENT_TYPE: 'jamf:contentType',
  /**
   * When this topic was last edited. Per-topic, unlike `ft:lastTechChange`,
   * which is the same date for every topic in a bundle and so says how old the
   * documentation *set* is rather than the page. Measured across 12 topics in
   * 7 products: lastEdition gave 9 distinct dates, lastTechChange gave 1.
   */
  LAST_EDITION: 'ft:lastEdition',
  CLUSTER_ID: 'ft:clusterId',
  /**
   * The map an entry belongs to: the map's own id, on the map and on every
   * topic of it. Not among the descriptors `/api/configuration/metadata`
   * lists, but `clustered-search` filters on it all the same, which is how a
   * product Jamf classifies nothing under is filtered by its publication
   * (`resolveProductFilter` in search-service.ts). docs/fluid-topics-api.md
   * has the measurements.
   */
  PUBLICATION_ID: 'ft:publicationId',
  PRODNAME: 'prodname',

  /**
   * Jamf's own publication classification.
   *
   * Unlike the `product-*` values inside `zoominmetadata` — a legacy Zoomin
   * vocabulary where one label covers many publications — these three name the
   * platform, client app or utility a publication documents. Every map of a
   * family reports the same values in every locale, which is what makes them
   * usable as a stable classification rather than display text, and is the
   * opposite of `jamf:contentType`, whose values ARE translated (see
   * DOC_TYPE_CONTENT_TYPE_MAP). That locale-invariance is asserted against the
   * live API in `data-contracts`, not merely recorded here.
   *
   * Two things this comment used to assert are false. A map may carry none of
   * the three, and it may carry several — so Jamf files "Jamf 170 Course"
   * under Jamf Pro and Jamf Protect alike, and the registry reads all three
   * through {@link getMetaValues} and keeps every value (#282). `jamf:utility`
   * happens to be single-valued, which is a fact about the catalogue rather
   * than a rule, so nothing depends on it.
   *
   * All three keys are present on every map; what varies is whether `values`
   * is empty. An absent classification is therefore an empty array, never a
   * missing key, and {@link getMetaValues} returns [] for both. That one IS
   * depended on, and `data-contracts` asserts it.
   *
   * Live shape, measured 2026-09-18 (678 maps). Figures are dated because they
   * decay: this block said 676 / 629 / 97 three days earlier and every number
   * had moved. Nothing below is load-bearing — what the code needs is asserted
   * in the contract suite — so a stale figure here is a stale note, not a bug.
   *   - classified maps: 631 of 678; 17 of the 98 families carry nothing
   *   - `jamf:portal`   12 distinct values over 566 maps; 29 carry more than
   *     one, spread 27x2, 1x3, 1x5
   *   - `jamf:app`       9 distinct values over  92 maps; 12 carry two, which
   *     is the maximum
   *   - `jamf:utility`   9 distinct values over  25 maps; none carries two
   *   - `product-pro`, for contrast, spans 39 bundle families on its own
   */
  PORTAL: 'jamf:portal',
  APP: 'jamf:app',
  UTILITY: 'jamf:utility',
} as const;

/**
 * `metadata` is optional on every FT payload type for the same reason their
 * `title` fields are: the shapes are bare casts over `response.json()` with no
 * runtime validation. Every metadata read in the codebase goes through these
 * two helpers, so tolerating an absent array here covers all of them at once —
 * and "no metadata at all" collapses naturally onto the same "key not found"
 * default they already return.
 */
export function getMetaValue(metadata: FtMetadataEntry[] | undefined, key: string): string {
  const entry = metadata?.find(m => m.key === key);
  return entry?.values[0] ?? '';
}

export function getMetaValues(metadata: FtMetadataEntry[] | undefined, key: string): string[] {
  const entry = metadata?.find(m => m.key === key);
  return entry?.values ?? [];
}

export function bundleStemToDisplayName(stem: string): string {
  return stem
    .replace(/-documentation$/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}
