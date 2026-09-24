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
 * per page, and every page served under its own title. Most pages get that
 * title from `fetchStaticArticle`'s `og:title` fallback, not from
 * `parseArticle`: the source reads a title only from an `<h1>` that opens the
 * article, and 800 of the 990 pages have none (measured 2026-09-24). Assert
 * it through the service, never through `parseArticle` alone, or the fallback
 * is skipped and the result looks broken when it is not.
 *
 * Breadcrumbs ARE asserted now (#285). They used to be deliberately skipped
 * because they could not work: the selector looked for a class while the site
 * marks its trail `nav[aria-label="Breadcrumb"]`, and `cleanHtml` stripped
 * every `<nav>` before the extraction ran. Both are fixed, so the trail is
 * real and worth pinning — and pinning it is what would catch the site moving
 * back to a class, or the extraction drifting after the removal again.
 *
 * Only guide pages carry a trail; `/en/concepts/…` pages have no breadcrumb
 * nav at all, so the assertion below is on the guides in the sample rather
 * than on all of it. Related links remain unasserted: the site publishes no
 * related section at all, so a check would assert an intention.
 *
 * Cost, measured 2026-09-14: one sitemap (~6 KB) plus SAMPLE_SIZE pages,
 * CONCURRENCY at a time — a few seconds against the job's 5-minute timeout.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as cheerio from 'cheerio';
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

/**
 * The one page known to carry `<h1>`s in its body that are not its title: a
 * bash script typed in single backticks, whose `#` comments the site's
 * Markdown turned into headings. It was served under the first of them in all
 * 10 locales until the title selector was scoped to the article, and the
 * stride below never lands on it. So it joins the sample while the sitemap
 * lists it, and drops out quietly if it goes — its presence is not the
 * contract, the title check is.
 */
const KNOWN_STRAY_H1_PATH =
  '/en/guides/threat-and-risk-management/enforcing-compliance-baselines-for-network-access';

interface Fetched {
  url: string;
  title: string;
  /** Read off the served page here, independently of the code under test. */
  ogTitle: string | undefined;
  content: string;
  breadcrumb: string[];
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
  const known = deep.find(entry =>
    new URL(entry.url).pathname.replace(/\/$/, '') === KNOWN_STRAY_H1_PATH);
  if (known !== undefined && !sample.includes(known)) { sample.push(known); }

  // Keep what the service fetched, so each page's `og:title` can be read
  // without a second request.
  const served = new Map<string, string>();
  const live = createMockContext().http;
  const ctx = createMockContext({
    http: {
      ...live,
      getText: async (url, options) => {
        const html = await live.getText(url, options);
        served.set(url, html);
        return html;
      },
    },
  });
  sampled = await mapLimit(sample, async (entry) => {
    const article = await fetchStaticArticle(ctx, SOURCE, entry.url);
    const html = served.get(canonicalStaticUrl(entry.url)) ?? '';
    return {
      url: entry.url,
      title: article.title,
      ogTitle: cheerio.load(html)('meta[property="og:title"]').attr('content'),
      content: article.content,
      breadcrumb: article.breadcrumb ?? [],
    };
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
   * The source's TITLE reads only an `<h1>` that opens the article, and 800
   * of the 990 pages have none (2026-09-24). Tool pages keep their only
   * `<h1>` in the header, which the source strips to keep the navigation out
   * of the token budget. Guides mostly have only the hero `<h1>Guides</h1>`
   * above the article, which is not their title and which the selector
   * deliberately ignores. `parseArticle` alone therefore returns "Untitled"
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

  /**
   * Not just a title: the page's own. Rejecting only "Untitled" let one guide
   * go out as "Jamf Pro Extension Attribute which checks and validates the
   * following:", a heading from a script in its body, and would have let
   * every guide go out as "Guides" had the hero `<h1>` ever reached the
   * title.
   *
   * Containment rather than equality: `ja/guides/infrastructure-as-code`
   * opens its article with "Infrastructure as Code" while its `og:title` is
   * "Infrastructure as Code (コードとしてのインフラストラクチャ)". Both are
   * the page's title, and equality would go red on it with nothing wrong. A
   * page with no `og:title` is left to the check above; the code does not
   * need one.
   */
  it('serves every sampled page under its own title', () => {
    const normalize = (text: string): string => text.replace(/\s+/g, ' ').trim();
    const wrong = sampled
      .filter(page => page.ogTitle !== undefined)
      .filter(page => {
        const title = normalize(page.title);
        const og = normalize(page.ogTitle ?? '');
        return !og.includes(title) && !title.includes(og);
      })
      .map(page => ({ url: page.url, title: page.title, ogTitle: page.ogTitle }));

    expect(
      wrong,
      'These pages were served under a title that is not their og:title. ' +
      'Something other than the page title is being read as the title: an ' +
      '<h1> outside the article, or one from further down its body.'
    ).toEqual([]);
  });

  it('reads the breadcrumb trail off the guides that publish one', () => {
    // #285: this returned [] for every page until two independent bugs were
    // fixed — the selector matched a class the site does not use, and
    // `cleanHtml` deleted every `<nav>` (the trail among them) before the
    // extraction ran. Fixing either alone still yielded nothing, which is why
    // it survived so long looking like working code.
    //
    // Guides only. `/en/concepts/…` pages carry no breadcrumb nav at all, so
    // asserting across the whole sample would pin an absence as a failure.
    // Nor does `/{locale}/guides/overview`, the one guide-section page deep
    // enough for the sample that has no trail (the section roots, which also
    // have none, are too shallow to be sampled).
    const guides = sampled.filter(page =>
      page.url.includes('/guides/') && !/\/guides\/overview\/?$/.test(page.url));
    expect(guides.length, 'the sample contains no guide pages to check').toBeGreaterThan(0);

    const empty = guides.filter(page => page.breadcrumb.length === 0);
    expect(
      empty.map(page => page.url),
      'These guides returned no breadcrumb. Either the site stopped marking ' +
      'the trail with nav[aria-label="Breadcrumb"], or something is stripping ' +
      'nav before parseArticle reads it again — both are silent, and both ' +
      'produce exactly this.'
    ).toEqual([]);

    // The trail says where the page sits, and it usually stops above the
    // page: on 390 of the 550 guide trails (2026-09-24) the last crumb links
    // to the parent section. Only on the other 160, section index pages and
    // two childless guides per locale, is it the page itself. Either way, a
    // one-crumb trail is only the localised "Guides" root and places nothing.
    for (const page of guides) {
      expect(
        page.breadcrumb.length,
        `${page.url} has a one-element trail, which says nothing about where ` +
        'the page sits.'
      ).toBeGreaterThan(1);
    }
  });
});
