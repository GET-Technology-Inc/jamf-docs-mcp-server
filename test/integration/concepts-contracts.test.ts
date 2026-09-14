/**
 * Live contract tests for concepts.jamf.com.
 *
 * The other non-Fluid-Topics source, and the other one that shipped without
 * live coverage — 5.6.0 and 5.7.0 added the reader and the sitemap TOC with
 * mocked unit tests only. support.jamf.com was carrying six silent defects
 * under the same arrangement (#280, #281); this source turned out to be in
 * good order, which is worth knowing rather than assuming in either
 * direction.
 *
 * What it pins is the reading the code depends on: a sitemap whose paths
 * encode the hierarchy, a trailing-slash canonical form, one `article.prose`
 * per page, and a title reachable for every page — that last one only
 * because `fetchStaticArticle` falls back to `og:title`, since stripping the
 * navigation also strips the `<h1>` on most pages. Assert it through the
 * service, never through `parseArticle` alone, or the fallback is skipped and
 * the result looks broken when it is not.
 *
 * Deliberately NOT asserted: breadcrumbs. `SELECTORS.BREADCRUMB` matches
 * nothing here and cannot — the live markup marks the trail with
 * `nav[aria-label="Breadcrumb"]` rather than a class, and `cleanHtml` removes
 * every `<nav>` before the extraction runs anyway. That costs no content, so
 * it is tracked separately rather than pinned red here. Related links are
 * likewise absent: the site publishes no related section at all, so a check
 * would assert an intention rather than a contract.
 *
 * Cost, measured 2026-09-14: one sitemap (~6 KB) plus SAMPLE_SIZE pages,
 * CONCURRENCY at a time — a few seconds against the job's 5-minute timeout.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { parseSitemap, type SitemapEntry } from '../../src/core/services/sitemap-service.js';
import {
  fetchStaticArticle,
  canonicalStaticUrl,
} from '../../src/core/services/static-article-service.js';
import { STATIC_DOC_SOURCES } from '../../src/core/constants/sources.js';
import { createMockContext } from '../helpers/mock-context.js';

const SOURCE = STATIC_DOC_SOURCES['jamf-concepts'];

/** Enough pages to cross both sections and more than one locale. */
const SAMPLE_SIZE = 12;
const CONCURRENCY = 4;

/**
 * A floor, not a count.
 *
 * The live sitemap carries 990 entries — 99 per locale across 10 — and Jamf
 * publishing a guide must not turn this suite red. What would matter is the
 * sitemap collapsing.
 */
const MIN_SITEMAP_ENTRIES = 400;

interface Fetched {
  url: string;
  title: string;
  content: string;
}

let xml: string;
let entries: SitemapEntry[];
let sampled: Fetched[];

async function getText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { 'user-agent': 'jamf-docs-mcp-server contract check' },
  });
  expect(response.status, `GET ${url}`).toBe(200);
  return await response.text();
}

async function mapLimit<T, R>(items: T[], work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    for (let i = next++; i < items.length; i = next++) {
      results[i] = await work(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

beforeAll(async () => {
  xml = await getText(`${SOURCE.baseUrl}/sitemap.xml`);
  entries = parseSitemap(xml);

  // Stride across the whole list so both sections and several locales are
  // represented, rather than the first N which are all one locale's roots.
  const deep = entries.filter(entry => entry.segments.length >= 3);
  const stride = Math.max(1, Math.floor(deep.length / SAMPLE_SIZE));
  const sample = deep.filter((_, i) => i % stride === 0).slice(0, SAMPLE_SIZE);

  const ctx = createMockContext();
  sampled = await mapLimit(sample, async (entry) => {
    const article = await fetchStaticArticle(ctx, SOURCE, entry.url);
    return { url: entry.url, title: article.title, content: article.content };
  });
}, 300_000);

describe('concepts.jamf.com contracts', () => {
  it('publishes a sitemap the parser can read', () => {
    expect(xml.startsWith('<?xml'), 'sitemap is XML').toBe(true);
    expect(entries.length, 'entries parsed from the sitemap').toBeGreaterThan(MIN_SITEMAP_ENTRIES);
    for (const entry of entries) {
      expect(entry.url, JSON.stringify(entry)).toMatch(/^https:\/\/concepts\.jamf\.com\//);
      expect(entry.segments.length, entry.url).toBeGreaterThan(0);
    }
  });

  /**
   * `parseSitemap` scans for `<url>` blocks rather than parsing XML, so a
   * single malformed block costs one entry instead of the whole document.
   * If the scan ever stopped matching, it would return an empty list and the
   * TOC would quietly go missing — which the count above is what catches.
   */
  it('tolerates both lastmod formats the sitemap mixes', () => {
    const stamped = entries.filter(entry => entry.lastModified !== undefined);
    expect(stamped.length, 'entries carrying a lastmod').toBeGreaterThan(0);

    const dateOnly = stamped.filter(e => /^\d{4}-\d{2}-\d{2}$/.test(e.lastModified ?? ''));
    const iso = stamped.filter(e => /^\d{4}-\d{2}-\d{2}T/.test(e.lastModified ?? ''));
    expect(
      dateOnly.length + iso.length,
      'every lastmod is one of the two shapes the site emits',
    ).toBe(stamped.length);
  });

  /**
   * The TOC is derived from these paths instead of crawling, so the shape
   * `{locale}/{section}/…` is load-bearing: flatten it and the tree is gone.
   */
  it('encodes the hierarchy in the sitemap paths', () => {
    const locales = Object.values(SOURCE.locales);
    expect(locales.length, 'locales declared for this source').toBeGreaterThan(0);

    for (const locale of locales) {
      const forLocale = entries.filter(entry => entry.segments[0] === locale);
      expect(forLocale.length, `sitemap entries under /${locale}/`).toBeGreaterThan(0);
    }

    for (const section of SOURCE.sections) {
      const forSection = entries.filter(entry => entry.segments[1] === section.path);
      expect(forSection.length, `sitemap entries under /*/${section.path}/`).toBeGreaterThan(0);
    }
  });

  /**
   * The sitemap lists paths without a trailing slash and the site 301s to the
   * slashed form, which is why `canonicalStaticUrl` exists. A fetch of the
   * canonical URL must be the 200, not the redirect — otherwise every article
   * request pays a round trip, and any client that does not follow redirects
   * gets nothing.
   */
  it('serves the canonical trailing-slash form directly', async () => {
    const leaf = entries.find(entry => entry.segments.length >= 4);
    if (leaf === undefined) { throw new Error('sitemap carries no leaf entry to test'); }

    const canonical = canonicalStaticUrl(leaf.url);
    expect(canonical.endsWith('/'), canonical).toBe(true);

    const response = await fetch(canonical, {
      redirect: 'manual',
      headers: { 'user-agent': 'jamf-docs-mcp-server contract check' },
    });
    expect(response.status, `no redirect from ${canonical}`).toBe(200);
  });

  it('wraps every page body in the one element the selectors read', async () => {
    const leaf = entries.find(entry => entry.segments.length >= 4);
    if (leaf === undefined) { throw new Error('sitemap carries no leaf entry to test'); }
    const html = await getText(canonicalStaticUrl(leaf.url));
    // `CONTENT` is 'article, [class*="prose"]', and `.html()` takes the first
    // match in document order. More than one would silently change which.
    expect((html.match(/<article/g) ?? []).length, 'article elements on the page').toBe(1);
    expect(html).toContain('class="prose');
  });

  /**
   * The end-to-end contract, and the one that must go through the service.
   *
   * Stripping nav/header/aside — which the source does deliberately, to keep
   * a 220px sidebar out of the token budget — also removes the only `<h1>` on
   * most of these pages. `parseArticle` alone therefore returns "Untitled"
   * for around 80% of the site; `fetchStaticArticle` falls back to `og:title`
   * and returns a real one for all of it. Asserting the wrong layer here
   * would report a defect that does not exist.
   */
  it('resolves a real title and a body for every sampled page', () => {
    const untitled = sampled.filter(page => page.title === 'Untitled' || page.title === '');
    expect(untitled.map(p => p.url), 'pages with no resolvable title').toEqual([]);

    const empty = sampled.filter(page => page.content.trim() === '');
    expect(empty.map(p => p.url), 'pages that render no content at all').toEqual([]);
  });
});
