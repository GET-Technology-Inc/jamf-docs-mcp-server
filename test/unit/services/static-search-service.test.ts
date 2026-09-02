/**
 * Unit tests for searching the non-Fluid-Topics sources.
 *
 * The index is titles recovered from each source's sitemap, so these cover
 * what a path has to survive to become one: the locale segment, the section
 * index pages, the JS-only shells that are in the sitemap, and Intercom's
 * numeric id prefix.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockHttpGetText = vi.fn<(url: string) => Promise<string>>();
vi.mock('../../../src/core/http-client.js', () => ({
  httpGetText: async (url: string) => await mockHttpGetText(url),
}));

import {
  loadStaticIndex,
  searchStaticSources,
} from '../../../src/core/services/static-search-service.js';
import { STATIC_DOC_SOURCES } from '../../../src/core/constants/sources.js';
import { createMockContext } from '../../helpers/mock-context.js';

const CONCEPTS = STATIC_DOC_SOURCES['jamf-concepts'];
const SUPPORT = STATIC_DOC_SOURCES['jamf-support'];

function sitemap(paths: string[], origin = 'https://concepts.jamf.com'): string {
  return `<urlset>${paths.map(p => `<url><loc>${origin}${p}</loc></url>`).join('')}</urlset>`;
}

describe('loadStaticIndex', () => {
  beforeEach(() => { mockHttpGetText.mockReset(); });

  it('indexes article paths and cases their slugs', async () => {
    mockHttpGetText.mockResolvedValue(sitemap([
      '/en/guides/threat-and-risk-management/enforcing-compliance-baselines',
    ]));

    const [entry] = await loadStaticIndex(createMockContext(), CONCEPTS, 'en');

    expect(entry.title).toBe('Enforcing Compliance Baselines');
    expect(entry.source).toBe('Jamf Concepts');
  });

  it('strips the numeric id Intercom prefixes its slugs with', async () => {
    // Leaving it in indexes "10631322 Get Started with Jamf Now".
    mockHttpGetText.mockResolvedValue(sitemap(
      ['/en/articles/10631322-get-started-with-jamf-now'],
      'https://support.jamf.com',
    ));

    const [entry] = await loadStaticIndex(createMockContext(), SUPPORT, 'en');

    expect(entry.title).toBe('Get Started with Jamf Now');
  });

  it('skips section index pages, which are containers rather than articles', async () => {
    mockHttpGetText.mockResolvedValue(sitemap(['/en/guides', '/en/guides/real-article']));

    const entries = await loadStaticIndex(createMockContext(), CONCEPTS, 'en');

    expect(entries.map(e => e.title)).toEqual(['Real Article']);
  });

  it('skips the shells that are in the sitemap but hold no content', async () => {
    // `/en/browse` is in concepts.jamf.com's sitemap and is thirteen
    // characters once tags are stripped.
    mockHttpGetText.mockResolvedValue(sitemap([
      '/en/browse/anything', '/en/about/team', '/en/ecosystem/partners', '/en/guides/keep-me',
    ]));

    const entries = await loadStaticIndex(createMockContext(), CONCEPTS, 'en');

    expect(entries.map(e => e.title)).toEqual(['Keep Me']);
  });

  it('reads only the requested locale', async () => {
    mockHttpGetText.mockResolvedValue(sitemap(['/en/guides/english', '/ja/guides/japanese']));

    const entries = await loadStaticIndex(createMockContext(), CONCEPTS, 'ja');

    expect(entries.map(e => e.title)).toEqual(['Japanese']);
  });

  it('fetches each sitemap once', async () => {
    mockHttpGetText.mockResolvedValue(sitemap(['/en/guides/a']));
    const ctx = createMockContext();

    await loadStaticIndex(ctx, CONCEPTS, 'en');
    await loadStaticIndex(ctx, CONCEPTS, 'en');

    expect(mockHttpGetText).toHaveBeenCalledTimes(1);
    expect(mockHttpGetText).toHaveBeenCalledWith('https://concepts.jamf.com/sitemap.xml');
  });
});

describe('searchStaticSources', () => {
  beforeEach(() => { mockHttpGetText.mockReset(); });

  it('ranks title matches across every source that publishes the locale', async () => {
    mockHttpGetText.mockImplementation(async (url: string) =>
      await Promise.resolve(url.startsWith('https://support.jamf.com')
        ? sitemap(['/en/articles/1-zero-trust-network-access-reports'], 'https://support.jamf.com')
        : sitemap(['/en/guides/networking/zero-trust-network-access', '/en/guides/other/unrelated-topic'])));

    const hits = await searchStaticSources(createMockContext(), 'zero trust network access', 'en-US');

    const titles = hits.map(h => h.title);
    expect(titles).toContain('Zero Trust Network Access');
    expect(titles).toContain('Zero Trust Network Access Reports');
    expect(titles).not.toContain('Unrelated Topic');
    expect(new Set(hits.map(h => h.source)).size).toBe(2);
  });

  it('skips a source that does not publish the requested locale', async () => {
    // th-TH is a hard gap on both sources: concepts 404s on /th and /th-TH,
    // and support routes but returns nothing.
    const hits = await searchStaticSources(createMockContext(), 'anything', 'th-TH');

    expect(hits).toEqual([]);
    expect(mockHttpGetText).not.toHaveBeenCalled();
  });

  it('lets one unreachable source cost only its own hits', async () => {
    mockHttpGetText.mockImplementation(async (url: string) =>
      url.startsWith('https://support.jamf.com')
        ? await Promise.reject(new Error('sitemap down'))
        : await Promise.resolve(sitemap(['/en/guides/networking/still-here'])));

    const hits = await searchStaticSources(createMockContext(), 'still here', 'en-US');

    expect(hits.map(h => h.title)).toEqual(['Still Here']);
  });

  it('caps the hits it returns per source', async () => {
    mockHttpGetText.mockResolvedValue(sitemap(
      Array.from({ length: 20 }, (_, i) => `/en/guides/x/policy-topic-${String(i)}`)
    ));

    const hits = await searchStaticSources(createMockContext(), 'policy topic', 'en-US', 3);

    // Two sources are served the same sitemap here, so three each.
    expect(hits.length).toBeLessThanOrEqual(6);
  });
});
