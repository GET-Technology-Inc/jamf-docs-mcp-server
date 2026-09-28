/**
 * What the maps registry reads from a MapsProvider's answer, before it reads
 * any map, and from learn.jamf.com's since 2026-09-28 (readFetchedMaps in
 * maps-registry.ts).
 *
 * The same rule as for every other provider (provider-results.ts), for the
 * one answer the registry is built from. Kept apart from that module, and
 * checked without zod, because the registry needs neither zod nor the output
 * schemas, and it is imported wherever a publication is resolved.
 *
 * Until 2026-09-28 the maps were read as they came, and the registry is built
 * from all of them at once: one `null` map, or one map whose `metadata` was a
 * number or held a `null` entry, left the registry unreadable for every
 * publication, and a `title` of 42 failed `jamf_docs_list_products` with an
 * output validation error.
 *
 * @module
 */

import type { FtMapInfo, FtMetadataEntry } from '../types.js';

type Row = Record<string, unknown>;

function isRow(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Whether each field of an `FtMapInfo` fits. `satisfies` stops a field added
 * to the type compiling until it says how it is read.
 */
const MAP_FIELDS = {
  // Required: nothing can resolve to a map without one.
  id: (value: unknown) => typeof value === 'string',
  title: (value: unknown) => value === undefined || typeof value === 'string',
  metadata: (value: unknown) => value === undefined || Array.isArray(value),
  // Never read.
  mapApiEndpoint: () => true,
} satisfies Record<keyof FtMapInfo, (value: unknown) => boolean>;

/** A metadata entry as the registry reads it: `label` is never read. */
function isMetadataEntry(value: unknown): value is FtMetadataEntry {
  return isRow(value)
    && typeof value.key === 'string'
    && Array.isArray(value.values)
    && value.values.every(v => typeof v === 'string');
}

/** One map as the registry reads it, or null to leave it out. */
function readMap(row: unknown): FtMapInfo | null {
  if (!isRow(row) || !MAP_FIELDS.id(row.id)) { return null; }
  const unfit = (['title', 'metadata'] as const).filter(field => !MAP_FIELDS[field](row[field]));
  let map = row;
  if (unfit.length > 0) {
    map = { ...row };
    for (const field of unfit) { Reflect.deleteProperty(map, field); }
  }
  const metadata = map.metadata as unknown[] | undefined;
  if (metadata !== undefined) {
    const entries = metadata.filter(isMetadataEntry);
    if (entries.length !== metadata.length) { map = { ...map, metadata: entries }; }
  }
  return map as unknown as FtMapInfo;
}

/**
 * A MapsProvider's maps as the registry reads them, or `null` to fetch the
 * maps from learn.jamf.com instead, as the registry does without a provider.
 *
 * - A map without an `id` string is left out: nothing can resolve to it.
 * - A `title` that is not a string, or a `metadata` that is not an array, is
 *   read as absent, and a metadata entry without a `key` string and a
 *   `values` array of strings is left out of its map's metadata.
 * - An answer that is not an array, `null` and `undefined` included, or one
 *   whose every map is left out, is read as `null`. An empty array is the
 *   provider's own answer, and is kept.
 *
 * learn.jamf.com's answer is read by the same rule, and a `null` there is
 * the failure (readFetchedMaps in maps-registry.ts). The registry keeps no
 * logger, so none of this is logged.
 */
export function readProviderMaps(answer: unknown): FtMapInfo[] | null {
  if (!Array.isArray(answer)) { return null; }
  const maps = answer.flatMap((row: unknown): FtMapInfo[] => {
    const map = readMap(row);
    return map === null ? [] : [map];
  });
  return answer.length > 0 && maps.length === 0 ? null : maps;
}
