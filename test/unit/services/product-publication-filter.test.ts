/**
 * The upstream `product` filter for a product Jamf classifies nothing under:
 * its own publication, as the ids of that publication's maps.
 *
 * jamf-routines is the only such product. Checked against every product in
 * JAMF_PRODUCTS on 2026-09-26 (`/api/khub/maps`, 685 maps): the other 27 each
 * have a classification value some map carries, and each one's own
 * publication carries it. Jamf Routines' one map is filed under
 * `jamf:portal = Jamf Pro`.
 *
 * `ft:publicationId` is the key because it is the one that selects exactly a
 * publication. On a map it is the map's own id (685 of 685), and on a search
 * entry it is the entry's `mapId` (4,466 of 4,466 over five unfiltered
 * queries), so the registry can supply it and the local filter can check it.
 * The others tried live select less: `bundle` is on maps only, so it finds the
 * map and none of its topics; `legacy_bundle` is on topics only;
 * `version_bundle_stem` is on 311 of 685 maps, not this one; `ft:mapId` is
 * silently ignored.
 */

import { describe, it, expect, vi } from 'vitest';
import { resolveProductFilter } from '../../../src/core/services/search-service.js';
import { MapsRegistry } from '../../../src/core/services/maps-registry.js';
import { createMockCache } from '../../helpers/mock-context.js';
import type { FtMapInfo } from '../../../src/core/types.js';

function map(id: string, bundle: string, locale: string, extra: { key: string; values: string[] }[] = []): FtMapInfo {
  return {
    id,
    title: id,
    mapApiEndpoint: `/api/khub/maps/${id}`,
    metadata: [
      { key: 'ft:locale', label: 'ft:locale', values: [locale] },
      { key: 'bundle', label: 'bundle', values: [bundle] },
      { key: 'jamf:portal', label: 'jamf:portal', values: ['Jamf Pro'] },
      { key: 'jamf:app', label: 'jamf:app', values: [] },
      { key: 'jamf:utility', label: 'jamf:utility', values: [] },
      ...extra.map(e => ({ ...e, label: e.key })),
    ],
  };
}

function registryOf(maps: FtMapInfo[]): MapsRegistry {
  return new MapsRegistry(createMockCache(), undefined, { getMaps: async () => await Promise.resolve(maps) });
}

describe('MapsRegistry.mapIdsOf', () => {
  it('returns every map of a family, in every locale and version', async () => {
    const registry = registryOf([
      map('routines-en', 'jamf-routines-documentation', 'en-US'),
      // Hypothetical: Jamf Routines is en-US only today. The search sends
      // `contentLocale`, so the family's other maps are harmless to include
      // and would be needed the day it is translated.
      map('routines-ja', 'jamf-routines-documentation', 'ja-JP'),
      map('pro-11.31', 'jamf-pro-documentation-11.31.0', 'en-US', [
        { key: 'version_bundle_stem', values: ['jamf-pro-documentation'] },
        { key: 'version', values: ['11.31.0'] },
      ]),
      map('pro-11.30', 'jamf-pro-documentation-11.30.0', 'en-US', [
        { key: 'version_bundle_stem', values: ['jamf-pro-documentation'] },
        { key: 'version', values: ['11.30.0'] },
      ]),
    ]);

    expect(await registry.mapIdsOf('jamf-routines-documentation')).toEqual(['routines-en', 'routines-ja']);
    expect(await registry.mapIdsOf('jamf-pro-documentation')).toEqual(['pro-11.31', 'pro-11.30']);
    // Addressed as get_toc addresses it, `-current` and all.
    expect(await registry.mapIdsOf('jamf-routines-documentation-current')).toEqual(['routines-en', 'routines-ja']);
    expect(await registry.mapIdsOf('no-such-publication')).toEqual([]);
  });

  it('does not take a family whose name only starts with the one asked for', async () => {
    // Live pairs of this shape exist: training-video-shorts-jamf-pro and
    // training-video-shorts-jamf-protect, jamf-pro-release-notes and
    // jamf-pro-release-notes-videos.
    const registry = registryOf([
      map('shorts-pro', 'training-video-shorts-jamf-pro', 'en-US'),
      map('shorts-protect', 'training-video-shorts-jamf-protect', 'en-US'),
    ]);

    expect(await registry.mapIdsOf('training-video-shorts-jamf-pro')).toEqual(['shorts-pro']);
  });
});

describe('resolveProductFilter for a product with no classification value', () => {
  it('filters by the ids of its own publication', async () => {
    const registry = registryOf([
      map('C~Tmp9IxyjJUYOFsJQew8g', 'jamf-routines-documentation', 'en-US'),
      map('pro-map', 'jamf-pro-documentation-current', 'en-US'),
    ]);

    expect(await resolveProductFilter(registry, 'jamf-routines')).toEqual({
      key: 'ft:publicationId',
      values: ['C~Tmp9IxyjJUYOFsJQew8g'],
    });
    // A classified product is unchanged: its classification, on its axis.
    expect(await resolveProductFilter(registry, 'jamf-pro')).toEqual({
      key: 'jamf:portal',
      values: ['Jamf Pro'],
    });
  });

  it('returns null when the registry has no map of that publication', async () => {
    const registry = registryOf([map('pro-map', 'jamf-pro-documentation-current', 'en-US')]);

    expect(await resolveProductFilter(registry, 'jamf-routines')).toBeNull();
  });

  it('returns null for a registry that cannot list map ids, as it did before', async () => {
    // The parameter used to be `Pick<MapsRegistry, 'classificationAxis'>`.
    // A caller passing only that still compiles and still gets null here.
    const classificationAxis = vi.fn(async () => await Promise.resolve('jamf:portal'));

    expect(await resolveProductFilter({ classificationAxis }, 'jamf-routines')).toBeNull();
    expect(await resolveProductFilter({ classificationAxis }, 'jamf-pro')).toEqual({
      key: 'jamf:portal',
      values: ['Jamf Pro'],
    });
  });
});
