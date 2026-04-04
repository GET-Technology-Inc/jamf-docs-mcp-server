/**
 * Integration smoke tests for ft-client — verifies each FT API endpoint returns data
 */

import { describe, it, expect } from 'vitest';
import {
  search,
  fetchMaps,
  fetchMapToc,
  fetchMapTopics,
  fetchTopicContent,
  fetchTopicMetadata,
} from '../../src/core/services/ft-client.js';

describe('ft-client integration', () => {
  it('search() should return results for a common term', async () => {
    const result = await search({
      query: 'MDM',
      contentLocale: 'en-US',
      paging: { perPage: 2, page: 1 },
    });

    expect(result.results.length).toBeGreaterThan(0);
    expect(result.paging.totalResultsCount).toBeGreaterThan(0);

    const firstEntry = result.results[0].entries[0];
    expect(firstEntry.type).toBe('TOPIC');
    expect(firstEntry.topic).toBeDefined();
    expect(firstEntry.topic!.mapId).toBeTruthy();
    expect(firstEntry.topic!.contentId).toBeTruthy();
    expect(firstEntry.topic!.title).toBeTruthy();
  }, 15000);

  it('fetchMaps() should return publications', async () => {
    const maps = await fetchMaps();

    expect(maps.length).toBeGreaterThan(100);

    // Should include known products
    const titles = maps.map(m => m.title);
    expect(titles.some(t => t.includes('Jamf Pro'))).toBe(true);
  }, 15000);

  let knownMapId: string;

  it('fetchMaps() should contain a glossary map', async () => {
    const maps = await fetchMaps();
    const glossary = maps.find(m =>
      m.metadata.some(
        md => (md.key === 'bundle' || md.key === 'version_bundle_stem') &&
        md.values.some(v => v.includes('jamf-technical-glossary'))
      )
    );

    expect(glossary).toBeDefined();
    knownMapId = glossary!.id;
  }, 15000);

  it('fetchMapToc() should return a TOC tree', async () => {
    if (!knownMapId) return;

    const toc = await fetchMapToc(knownMapId);

    expect(toc.length).toBeGreaterThan(0);
    expect(toc[0].title).toBeTruthy();
    expect(toc[0].contentId).toBeTruthy();
  }, 15000);

  it('fetchMapTopics() should return flat topic list', async () => {
    if (!knownMapId) return;

    const topics = await fetchMapTopics(knownMapId);

    expect(topics.length).toBeGreaterThan(0);
    expect(topics[0].title).toBeTruthy();
    expect(topics[0].id).toBeTruthy();
  }, 15000);

  it('fetchTopicContent() should return HTML', async () => {
    if (!knownMapId) return;

    const toc = await fetchMapToc(knownMapId);
    // Find a leaf topic (not the root)
    const leaf = toc[0].children?.[0];
    if (!leaf) return;

    const html = await fetchTopicContent(knownMapId, leaf.contentId);

    expect(html).toBeTruthy();
    expect(html).toContain('<');
  }, 15000);

  it('fetchTopicMetadata() should return metadata', async () => {
    if (!knownMapId) return;

    const toc = await fetchMapToc(knownMapId);
    const leaf = toc[0].children?.[0];
    if (!leaf) return;

    const meta = await fetchTopicMetadata(knownMapId, leaf.contentId);

    expect(meta.title).toBeTruthy();
    expect(meta.metadata.length).toBeGreaterThan(0);
  }, 15000);
});
