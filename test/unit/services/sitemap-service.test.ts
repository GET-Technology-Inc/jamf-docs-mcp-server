/**
 * Unit tests for the sitemap-derived table of contents.
 *
 * A static source has no TOC endpoint. Its hierarchy is in the shape of its
 * sitemap paths, so these cover the parse, the tree, and the slug-to-heading
 * step that stands in for titles the sitemap does not carry.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockHttpGetText = vi.fn<(url: string) => Promise<string>>();
vi.mock('../../../src/core/http-client.js', () => ({
  httpGetText: async (url: string) => await mockHttpGetText(url),
}));

import {
  parseSitemap,
  titleFromSlug,
  buildStaticToc,
  fetchStaticToc,
} from '../../../src/core/services/sitemap-service.js';
import { STATIC_DOC_SOURCES } from '../../../src/core/constants/sources.js';
import { createMockContext } from '../../helpers/mock-context.js';

const CONCEPTS = STATIC_DOC_SOURCES['jamf-concepts'];
const GUIDES = CONCEPTS.sections[0];

function sitemapXml(paths: string[]): string {
  const urls = paths.map(p =>
    `<url><loc>https://concepts.jamf.com${p}</loc><lastmod>2026-09-02</lastmod></url>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><urlset>${urls}</urlset>`;
}

describe('parseSitemap', () => {
  it('extracts loc, path segments and lastmod', () => {
    const [entry] = parseSitemap(sitemapXml(['/en/guides/ai-governance']));
    expect(entry.url).toBe('https://concepts.jamf.com/en/guides/ai-governance/');
    expect(entry.segments).toEqual(['en', 'guides', 'ai-governance']);
    expect(entry.lastModified).toBe('2026-09-02');
  });

  it('canonicalises every loc, since all 990 are listed unslashed', () => {
    const entries = parseSitemap(sitemapXml(['/en/guides', '/en/concepts/apiutil']));
    expect(entries.map(e => e.url)).toEqual([
      'https://concepts.jamf.com/en/guides/',
      'https://concepts.jamf.com/en/concepts/apiutil/',
    ]);
  });

  it('skips an entry whose loc will not parse rather than failing the sitemap', () => {
    const xml = '<urlset><url><loc>::::</loc></url>'
      + '<url><loc>https://concepts.jamf.com/en/guides/x</loc></url></urlset>';
    expect(parseSitemap(xml)).toHaveLength(1);
  });

  it('returns nothing for a document with no url blocks', () => {
    expect(parseSitemap('<html>not a sitemap</html>')).toEqual([]);
  });
});

describe('titleFromSlug', () => {
  // Checked against the titles concepts.jamf.com's own guides index renders.
  it.each([
    ['ai-governance', 'AI Governance'],
    ['it-workflows', 'IT Workflows'],
    ['jamf-for-mobile', 'Jamf for Mobile'],
    ['getting-started-with-jamf-for-mac', 'Getting Started with Jamf for Mac'],
    ['device-trust-identity-and-deployment', 'Device Trust Identity and Deployment'],
  ])('renders %s as its published title', (slug, expected) => {
    expect(titleFromSlug(slug)).toBe(expected);
  });

  it('cases Apple and Jamf terminology the way the vendors do', () => {
    expect(titleFromSlug('ios-corporate-owned-device')).toBe('iOS Corporate Owned Device');
    expect(titleFromSlug('macos-setup')).toBe('macOS Setup');
    expect(titleFromSlug('byod')).toBe('BYOD');
    expect(titleFromSlug('ddm-explorer')).toBe('DDM Explorer');
  });

  it('keeps a minor word capitalised when it opens the title', () => {
    expect(titleFromSlug('for-mac')).toBe('For Mac');
  });
});

describe('buildStaticToc', () => {
  beforeEach(() => { mockHttpGetText.mockReset(); });

  it('nests by path segment and keeps the section index out of its own tree', async () => {
    mockHttpGetText.mockResolvedValue(sitemapXml([
      '/en/guides',
      '/en/guides/ai-governance',
      '/en/guides/ai-governance/enforcement-with-jamf-extender',
      '/en/guides/it-workflows',
    ]));

    const toc = await buildStaticToc(createMockContext(), CONCEPTS, GUIDES, 'en');

    expect(toc.map(e => e.title)).toEqual(['AI Governance', 'IT Workflows']);
    expect(toc[0].children?.map(e => e.title)).toEqual(['Enforcement with Jamf Extender']);
    expect(toc[1].children).toBeUndefined();
  });

  it('reads only the requested locale', async () => {
    mockHttpGetText.mockResolvedValue(sitemapXml([
      '/en/guides/only-english',
      '/ja/guides/only-japanese',
    ]));

    const toc = await buildStaticToc(createMockContext(), CONCEPTS, GUIDES, 'ja');

    expect(toc.map(e => e.url)).toEqual(['https://concepts.jamf.com/ja/guides/only-japanese/']);
  });

  it('ignores sections other than the one asked for', async () => {
    mockHttpGetText.mockResolvedValue(sitemapXml([
      '/en/guides/a',
      '/en/concepts/apiutil',
      // In the sitemap and a JS-only shell — 13 characters after tag
      // stripping. The issue claimed these were absent from the sitemap and
      // therefore excluded for free; they are not.
      '/en/browse',
    ]));

    const toc = await buildStaticToc(createMockContext(), CONCEPTS, GUIDES, 'en');

    expect(toc.map(e => e.title)).toEqual(['A']);
  });

  it('fetches the sitemap once per source', async () => {
    mockHttpGetText.mockResolvedValue(sitemapXml(['/en/guides/a']));
    const ctx = createMockContext();

    await buildStaticToc(ctx, CONCEPTS, GUIDES, 'en');
    await buildStaticToc(ctx, CONCEPTS, GUIDES, 'en');

    expect(mockHttpGetText).toHaveBeenCalledTimes(1);
    expect(mockHttpGetText).toHaveBeenCalledWith('https://concepts.jamf.com/sitemap.xml');
  });
});

describe('fetchStaticToc', () => {
  beforeEach(() => { mockHttpGetText.mockReset(); });

  it('counts nested entries and reports the locale it served', async () => {
    mockHttpGetText.mockResolvedValue(sitemapXml([
      '/en/guides/a', '/en/guides/a/one', '/en/guides/a/two', '/en/guides/b',
    ]));

    const result = await fetchStaticToc(createMockContext(), CONCEPTS, GUIDES, 'en');

    // Two top-level entries, four counting the children.
    expect(result.toc).toHaveLength(2);
    expect(result.pagination.totalItems).toBe(4);
    expect(result.resolvedLocale).toBe('en');
  });

  it('truncates to the token budget like the Fluid Topics path', async () => {
    mockHttpGetText.mockResolvedValue(sitemapXml(
      Array.from({ length: 60 }, (_, i) => `/en/guides/a-rather-long-guide-slug-number-${String(i)}`)
    ));

    const result = await fetchStaticToc(createMockContext(), CONCEPTS, GUIDES, 'en', { maxTokens: 60 });

    expect(result.tokenInfo.truncated).toBe(true);
    expect(result.toc.length).toBeLessThan(60);
  });
});
