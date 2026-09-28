/**
 * The titles a static source lists for its pages (static-titles.ts): read off
 * concepts.jamf.com's section index pages, which carry them in the data a
 * Next.js page streams into itself, with the order its guides index gives
 * them, and off support.jamf.com's collection pages. The index pages here are
 * the live ones' listings, captured 2026-09-28 (`CONCEPTS_LISTINGS`), written
 * as the site writes them.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  loadListedTitles,
  titlesOnIndexPage,
  UNREAD_LISTING_TTL_MS,
} from '../../../src/core/services/static-titles.js';
import { loadStaticIndex } from '../../../src/core/services/static-search-service.js';
import { titleFromSlug } from '../../../src/core/services/sitemap-service.js';
import { STATIC_DOC_SOURCES, type StaticSection } from '../../../src/core/constants/sources.js';
import { HttpError, type HttpClient } from '../../../src/core/http-client.js';
import type { Logger } from '../../../src/core/services/interfaces/index.js';
import type { ServerContext } from '../../../src/core/types/context.js';
import { createMockContext } from '../../helpers/mock-context.js';
import {
  conceptsIndexPage,
  conceptsIndexPayload,
  conceptsIndexUrl,
  flightPage,
  listedPaths,
} from '../../helpers/concepts-index-pages.js';
import { createSupportUpstream, homeUrl, nextDataPage } from '../../helpers/support-upstream.js';
import { CONCEPTS_LISTINGS } from '../../fixtures/concepts-listings.js';

const CONCEPTS = STATIC_DOC_SOURCES['jamf-concepts'];
const SUPPORT = STATIC_DOC_SOURCES['jamf-support'];
const GUIDES = CONCEPTS.sections.find(section => section.path === 'guides') as StaticSection;
const TOOLS = CONCEPTS.sections.find(section => section.path === 'concepts') as StaticSection;

const page = (code: string, path: string): string => `${CONCEPTS.baseUrl}/${code}/${path}/`;

function warnings(ctx: ServerContext): string[] {
  return vi.mocked(ctx.logger.createLogger).mock.results
    .flatMap(({ value }) => vi.mocked((value as Logger).warning).mock.calls)
    .map(([message]) => String(message));
}

afterEach(() => { vi.useRealTimers(); });

describe('titlesOnIndexPage: concepts.jamf.com\'s guides index', () => {
  it('lists every guide and category the sitemap has, under the URL get_toc and get_article report', () => {
    const titles = new Map(titlesOnIndexPage(conceptsIndexPage('ja', 'guides'), CONCEPTS, GUIDES, 'ja'));

    // 16 categories, 39 guides under them, and the index page's own guide.
    expect([...titles.keys()].sort()).toEqual(
      listedPaths('ja').filter(path => path.startsWith('guides/')).map(path => page('ja', path)).sort(),
    );
    expect(titles.size).toBe(56);
    expect(titles.get(page('ja', 'guides/device-trust-identity-and-deployment/android-enterprise/android-fully-managed')))
      .toBe('Android フル管理デバイス');
    expect(titles.get(page('ja', 'guides/overview'))).toBe('概要');
  });

  it('names a category as the index links it: by its label in the locale, or else by its label in nav', () => {
    const ja = new Map(titlesOnIndexPage(conceptsIndexPage('ja', 'guides'), CONCEPTS, GUIDES, 'ja'));
    const fr = new Map(titlesOnIndexPage(conceptsIndexPage('fr', 'guides'), CONCEPTS, GUIDES, 'fr'));

    // The page's own title, and the one the index links it by (2026-09-28).
    expect(ja.get(page('ja', 'guides/threat-and-risk-management'))).toBe('脅威とリスク管理');
    expect(fr.get(page('fr', 'guides/threat-and-risk-management'))).toBe('Gestion des menaces et des risques');
    // No label in the locale: nav's, in English, as the index links it.
    expect(ja.get(page('ja', 'guides/jamf-for-mobile'))).toBe('Jamf for Mobile');
    // `android-enterprise-1` has no label of its own, and is not "Android Enterprise 1".
    expect(ja.get(page('ja', 'guides/device-trust-identity-and-deployment/byod/android-enterprise-1')))
      .toBe('Android Enterprise');
  });

  it('lists them in the order the site\'s sidebar does: the overview, then each category by navOrder, its subcategories before its guides', () => {
    const paths = titlesOnIndexPage(conceptsIndexPage('en', 'guides'), CONCEPTS, GUIDES, 'en')
      .map(([url]) => url.slice(page('en', 'guides').length, -1));

    // As the sidebar lists them on 2026-09-28. By slug, AI Governance came
    // first and the overview between Jamf for Mobile and Resource Access
    // Control. Jamf for Mobile and AI Governance are both 8: nav's order.
    expect(paths.filter(path => !path.includes('/'))).toEqual([
      'overview',
      'device-trust-identity-and-deployment',
      'examples-and-demos',
      'getting-started-with-jamf-for-mac',
      'infrastructure-as-code',
      'it-workflows',
      'resource-access-control',
      'threat-and-risk-management',
      'jamf-for-mobile',
      'ai-governance',
    ]);
    // BYOD's subcategory is 1 and so is its first guide.
    expect(paths.filter(path => path.startsWith('device-trust-identity-and-deployment/byod/'))).toEqual([
      'device-trust-identity-and-deployment/byod/android-enterprise-1',
      'device-trust-identity-and-deployment/byod/android-work-profile-for-employee-owned-devices',
      'device-trust-identity-and-deployment/byod/user-only-enrollments',
    ]);
  });

  it('orders by navOrder a nav that lists its items out of it, a tie as nav lists it, and an item with none last', () => {
    const nav = [
      { id: 'none', label: 'No navOrder', guides: [], children: [] },
      {
        id: 'second',
        label: 'Second',
        navOrder: 2,
        guides: [{ slug: 'later', title: 'Later', navOrder: 5 }, { slug: 'sooner', title: 'Sooner', navOrder: 4 }],
        children: [{ id: 'sub', label: 'Subcategory', navOrder: 9, guides: [], children: [] }],
      },
      { id: 'first', label: 'First', navOrder: 1, guides: [], children: [] },
      { id: 'tied', label: 'Tied with Second', navOrder: 2, guides: [], children: [] },
    ];
    const html = flightPage(`8:${JSON.stringify(['$', '$L22', null, { nav }])}\n`);

    expect(titlesOnIndexPage(html, CONCEPTS, GUIDES, 'en').map(([, title]) => title))
      .toEqual(['First', 'Second', 'Subcategory', 'Sooner', 'Later', 'Tied with Second', 'No navOrder']);
  });

  it('reads the listing wherever the pushes cut it', () => {
    const payload = conceptsIndexPayload('en', 'guides');
    const whole = titlesOnIndexPage(flightPage(payload, payload.length), CONCEPTS, GUIDES, 'en');

    for (const piece of [1, 7, 97, 1000]) {
      expect(titlesOnIndexPage(flightPage(payload, piece), CONCEPTS, GUIDES, 'en'), String(piece)).toEqual(whole);
    }
    expect(whole).toHaveLength(56);
  });
});

describe('titlesOnIndexPage: concepts.jamf.com\'s tools index', () => {
  it('lists every tool, and not the header\'s link, under the same key', () => {
    const titles = new Map(titlesOnIndexPage(conceptsIndexPage('en', 'concepts'), CONCEPTS, TOOLS, 'en'));

    expect(titles.size).toBe(CONCEPTS_LISTINGS.en.concepts.length);
    expect(titles.get(page('en', 'concepts/apiutil'))).toBe('API Utility');
    expect(titles.get(page('en', 'concepts/mcp-rapidid'))).toBe('RapidID MCP Server');
    expect([...titles.values()]).not.toContain('Concepts');
  });

  it('reads only what the section says its index lists', () => {
    // The guides index has no tool list, and the tools index no guide tree.
    expect(titlesOnIndexPage(conceptsIndexPage('en', 'guides'), CONCEPTS, TOOLS, 'en')).toEqual([]);
    expect(titlesOnIndexPage(conceptsIndexPage('en', 'concepts'), CONCEPTS, GUIDES, 'en')).toEqual([]);
    expect(titlesOnIndexPage(conceptsIndexPage('en', 'guides'), SUPPORT, { id: 'x', path: 'x', title: 'X' }, 'en')).toEqual([]);
  });
});

describe('titlesOnIndexPage: what is not a title', () => {
  const tools = (list: unknown): Map<string, string> => new Map(titlesOnIndexPage(
    flightPage(`8:${JSON.stringify(['$', '$L26', null, { concepts: list }])}\n`), CONCEPTS, TOOLS, 'en'));

  it('reads a string React escaped, and skips one that refers to another row', () => {
    // React writes a string that begins with `$` as `$$…`, and a reference to
    // another row as `$` and the row's id.
    const titles = tools([
      { slug: 'dollar', title: '$$100 Tool' },
      { slug: 'reference', title: '$L2a' },
      { slug: 'blank', title: '  ' },
      { slug: 'spaced', title: ' Two\n lines ' },
      { slug: '', title: 'No slug' },
      { title: 'No slug either' },
      'not an object',
      null,
    ]);

    expect(Object.fromEntries(titles)).toEqual({
      [page('en', 'concepts/dollar')]: '$100 Tool',
      [page('en', 'concepts/spaced')]: 'Two lines',
    });
  });

  it('reads a value to its own closing bracket, past brackets, braces and escaped quotes in its strings', () => {
    // Each title would end the list early, or open another, if its string
    // were read as the list's own text: an unmatched bracket or brace, a
    // brace between escaped quotes, and a backslash that ends a string.
    const titles = tools([
      { slug: 'bracket', title: 'Beta ] build', description: 'Opens { and [ and closes neither' },
      { slug: 'quoted', title: 'He said "}" twice' },
      { slug: 'backslash', title: 'Ends in \\', tags: ['[', '}', '"]"'] },
      { slug: 'last', title: 'Last' },
    ]);

    expect(Object.fromEntries(titles)).toEqual({
      [page('en', 'concepts/bracket')]: 'Beta ] build',
      [page('en', 'concepts/quoted')]: 'He said "}" twice',
      [page('en', 'concepts/backslash')]: 'Ends in \\',
      [page('en', 'concepts/last')]: 'Last',
    });
  });

  it('makes a title fit to show: whitespace made one space, and controls and bidi marks removed', () => {
    // As titleFromSlug keeps them out of a title made from a slug.
    const [override, pop, noBreak, nul] = [0x202e, 0x202c, 0xa0, 0].map(code => String.fromCodePoint(code));
    const titles = tools([
      { slug: 'bidi', title: `${override}Jamf${pop} Sync` },
      { slug: 'spaces', title: `Jamf${noBreak}${noBreak}Sync${nul} ` },
      { slug: 'marks-only', title: `${override}${pop}` },
    ]);

    expect(Object.fromEntries(titles)).toEqual({
      [page('en', 'concepts/bidi')]: 'Jamf Sync',
      [page('en', 'concepts/spaces')]: 'Jamf Sync',
    });
  });

  it('skips a value that is not JSON, and reads the next one', () => {
    const html = flightPage('3:T20,"concepts":[{"slug":oops}]\n'
      + `8:${JSON.stringify(['$', '$L26', null, { concepts: [{ slug: 'jamformer', title: 'jamformer' }] }])}\n`);

    expect(titlesOnIndexPage(html, CONCEPTS, TOOLS, 'en')).toEqual([[page('en', 'concepts/jamformer'), 'jamformer']]);
  });

  it('does not read the key where it is inside a string', () => {
    // Structured data carries JSON inside a string, where every quote is escaped.
    const html = flightPage(`7:${JSON.stringify({ __html: JSON.stringify({ concepts: [{ slug: 'fake', title: 'Fake' }] }) })}\n`);

    expect(titlesOnIndexPage(html, CONCEPTS, TOOLS, 'en')).toEqual([]);
  });

  it('finds nothing on a page that carries no payload', () => {
    expect(titlesOnIndexPage('<html><body><p>We will be back shortly.</p></body></html>', CONCEPTS, GUIDES, 'en'))
      .toEqual([]);
  });
});

describe('loadListedTitles: concepts.jamf.com', () => {
  /** A context whose upstream serves the captured index pages, except those `failing` names. */
  function upstream(failing = new Set<string>()): { ctx: ServerContext; requests: string[] } {
    const requests: string[] = [];
    const http: HttpClient = {
      getText: async (url) => {
        requests.push(url);
        if (failing.has(url)) { throw new HttpError(503, 'Service Unavailable', url); }
        const [, code = '', section = ''] = new URL(url).pathname.split('/');
        if ((code === 'en' || code === 'ja' || code === 'fr') && (section === 'guides' || section === 'concepts')) {
          return await Promise.resolve(conceptsIndexPage(code, section));
        }
        throw new HttpError(404, 'Not Found', url);
      },
      getJson: async url => await Promise.reject(new HttpError(404, 'Not Found', url)),
      postJson: async url => await Promise.reject(new HttpError(404, 'Not Found', url)),
    };
    return { ctx: createMockContext({ http }), requests };
  }

  it('reads each section\'s index page once, and keeps it as long as a table of contents', async () => {
    const { ctx, requests } = upstream();

    const first = await loadListedTitles(ctx, CONCEPTS, 'ja');
    const second = await loadListedTitles(ctx, CONCEPTS, 'ja');

    expect(first.unread).toEqual([]);
    expect(first.titles.get(page('ja', 'guides/threat-and-risk-management'))).toBe('脅威とリスク管理');
    expect(first.titles.get(page('ja', 'concepts/apiutil'))).toBe('API Utility');
    expect(second).toEqual(first);
    expect(requests.sort()).toEqual([conceptsIndexUrl('ja', 'concepts'), conceptsIndexUrl('ja', 'guides')]);
    const ttls = vi.mocked(ctx.cache.set).mock.calls.map(([, , ttl]) => ttl);
    expect(ttls).toEqual([ctx.config.cacheTtl.toc, ctx.config.cacheTtl.toc]);
  });

  it('gives the guides\' order, and none for the tools, whose index states none', async () => {
    const { ctx } = upstream();

    const { order } = await loadListedTitles(ctx, CONCEPTS, 'en');
    const place = (path: string): number | undefined => order.get(page('en', path));

    expect(place('guides/overview')).toBe(0);
    expect(place('guides/device-trust-identity-and-deployment')).toBeLessThan(place('guides/ai-governance') ?? 0);
    expect(place('concepts/apiutil')).toBeUndefined();
  });

  it('reads only the sections asked for', async () => {
    const { ctx, requests } = upstream();

    const { titles } = await loadListedTitles(ctx, CONCEPTS, 'en', [GUIDES]);

    expect(requests).toEqual([conceptsIndexUrl('en', 'guides')]);
    expect(titles.get(page('en', 'concepts/apiutil'))).toBeUndefined();
    expect(titles.get(page('en', 'guides/overview'))).toBe('Overview');
  });

  it('names a page it could not read, logs it, and does not ask again for a minute', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const guides = conceptsIndexUrl('ja', 'guides');
    const failing = new Set([guides]);
    const { ctx, requests } = upstream(failing);

    const first = await loadListedTitles(ctx, CONCEPTS, 'ja');
    const again = await loadListedTitles(ctx, CONCEPTS, 'ja');

    expect(first.unread).toEqual([guides]);
    expect(again.unread).toEqual([guides]);
    // The tools' titles, which their own page lists, are unaffected.
    expect(first.titles.get(page('ja', 'concepts/apiutil'))).toBe('API Utility');
    expect(first.titles.get(page('ja', 'guides/threat-and-risk-management'))).toBeUndefined();
    expect(requests.filter(url => url === guides)).toHaveLength(1);
    expect(warnings(ctx)).toEqual([expect.stringContaining(
      `Could not read the titles Jamf Concepts lists at ${guides}, so its pages there keep the titles their slugs give: `,
    )]);
    expect(vi.mocked(ctx.cache.set).mock.calls.find(([key]) => key.includes('"section":"jamf-concepts-guides"'))?.[2])
      .toBe(UNREAD_LISTING_TTL_MS);

    // Back, and a minute on: read again.
    failing.clear();
    vi.setSystemTime(Date.now() + UNREAD_LISTING_TTL_MS + 1);
    const later = await loadListedTitles(ctx, CONCEPTS, 'ja');

    expect(later.unread).toEqual([]);
    expect(later.titles.get(page('ja', 'guides/threat-and-risk-management'))).toBe('脅威とリスク管理');
    expect(requests.filter(url => url === guides)).toHaveLength(2);
  });

  it('counts a page that lists no titles as one it could not read', async () => {
    // A maintenance page answers 200, and must not be kept for a day as a
    // section with no titles.
    const http: HttpClient = {
      getText: async () => await Promise.resolve('<html><body>We will be back shortly.</body></html>'),
      getJson: async url => await Promise.reject(new HttpError(404, 'Not Found', url)),
      postJson: async url => await Promise.reject(new HttpError(404, 'Not Found', url)),
    };
    const ctx = createMockContext({ http });

    const { titles, unread } = await loadListedTitles(ctx, CONCEPTS, 'en', [GUIDES]);

    expect(titles.size).toBe(0);
    expect(unread).toEqual([conceptsIndexUrl('en', 'guides')]);
    expect(vi.mocked(ctx.cache.set).mock.calls.map(([, , ttl]) => ttl)).toEqual([UNREAD_LISTING_TTL_MS]);
  });
});

describe('loadListedTitles: support.jamf.com', () => {
  const DE_PRO = 'https://support.jamf.com/de/collections/12369024-jamf-pro';
  const DE_ACCOUNT = 'https://support.jamf.com/de/collections/11814179-jamf-account';

  it('reads the title each collection page gives its articles, from the pages get_toc reads', async () => {
    const support = createSupportUpstream();
    const ctx = createMockContext({ http: support.http });
    support.listings.set('de', [{
      id: '12369024', slug: 'jamf-pro', name: 'Jamf Pro', entries: 1,
      first: {
        kind: 'article',
        title: 'Self Service muss mit dem Jamf-Server verknüpft sein',
        url: 'https://support.jamf.com/de/articles/10631329-self-service-muss-mit-dem-jamf-server-verknupft-sein',
      },
    }]);

    const { titles, unread } = await loadListedTitles(ctx, SUPPORT, 'de');

    expect(unread).toEqual([]);
    expect(Object.fromEntries(titles)).toEqual({
      'https://support.jamf.com/de/articles/10631329-self-service-muss-mit-dem-jamf-server-verknupft-sein':
        'Self Service muss mit dem Jamf-Server verknüpft sein',
    });
    expect(support.requests).toEqual([homeUrl('de'), DE_PRO]);
  });

  it('costs a collection page that cannot be read its own titles, and names it', async () => {
    const support = createSupportUpstream();
    const ctx = createMockContext({ http: support.http });
    support.failingCollections.set('de/12369024', '503');

    const { titles, unread } = await loadListedTitles(ctx, SUPPORT, 'de');

    expect(unread).toEqual([DE_PRO]);
    // The fixture's Jamf Account page lists one subcollection.
    expect([...titles.keys()]).toContain('https://support.jamf.com/de/collections/12671126-hilfe-von-jamf-erhalten');
    expect(warnings(ctx)).toEqual([expect.stringContaining(`lists at ${DE_PRO}`)]);
    expect(support.requests).toContain(DE_ACCOUNT);
  });

  it('names the home page when the listing cannot be read, and does not ask again for a minute', async () => {
    const support = createSupportUpstream();
    const ctx = createMockContext({ http: support.http });
    support.failing.set('de', '503');

    const first = await loadListedTitles(ctx, SUPPORT, 'de');
    const again = await loadListedTitles(ctx, SUPPORT, 'de');

    expect(first).toEqual({ titles: new Map(), order: new Map(), unread: [homeUrl('de')] });
    expect(again).toEqual(first);
    // Remembered as `list_products` remembers it (#360).
    expect(support.requests).toEqual([homeUrl('de')]);
  });
});

describe('the titles support.jamf.com lists, as the search index takes them', () => {
  const COLLECTION = 'https://support.jamf.com/es/collections/12369024-jamf-pro';
  const article = (slug: string): string => `https://support.jamf.com/es/articles/${slug}`;

  /** A context whose es listing has one collection, whose page lists `summaries`. */
  function upstream(summaries: { title?: unknown; url: string }[]): ServerContext {
    const pages = new Map<string, string>([
      [homeUrl('es'), nextDataPage({ home: { collections: [{
        id: '12369024', slug: 'jamf-pro', name: 'Jamf Pro', description: '', url: COLLECTION, articleCount: summaries.length,
      }] } })],
      [COLLECTION, nextDataPage({ collection: { articleSummaries: summaries, subcollections: [] } })],
      [`${SUPPORT.baseUrl}/sitemap.xml`, `<urlset>${summaries.map(({ url }) => `<url><loc>${url}</loc></url>`).join('')}</urlset>`],
    ]);
    const http: HttpClient = {
      getText: async (url) => {
        const found = pages.get(url);
        if (found === undefined) { throw new HttpError(404, 'Not Found', url); }
        return await Promise.resolve(found);
      },
      getJson: async url => await Promise.reject(new HttpError(404, 'Not Found', url)),
      postJson: async url => await Promise.reject(new HttpError(404, 'Not Found', url)),
    };
    return createMockContext({ http });
  }

  it('are made fit to show, as concepts.jamf.com\'s are', async () => {
    // Live, 10 of the 820 en titles hold a double space, and one ends in a
    // no-break space (2026-09-28).
    const [noBreak, isolate, popIsolate] = [0xa0, 0x2066, 0x2069].map(code => String.fromCodePoint(code));
    const ctx = upstream([
      { title: 'Managing FileVault  with Jamf School', url: article('1-managing-filevault-with-jamf-school') },
      { title: `Exportar a un archivo .csv${noBreak}`, url: article('2-exportar-a-un-archivo-csv') },
      { title: `Dos\nlíneas y ${isolate}aislado${popIsolate}`, url: article('3-dos-lineas-y-aislado') },
    ]);

    const index = await loadStaticIndex(ctx, SUPPORT, 'es');

    expect(index.map(entry => entry.title)).toEqual([
      'Managing FileVault with Jamf School',
      'Exportar a un archivo .csv',
      'Dos líneas y aislado',
    ]);
  });

  it('leave a page the collection page gives no title the title its slug gives, not "Untitled"', async () => {
    const ctx = upstream([
      { url: article('11003438-actualizar-la-licencia-de-jamf-connect') },
      { title: '  ', url: article('11003439-renovar-la-licencia') },
      { title: 'Self Service no se abre', url: article('11003440-self-service-no-se-abre') },
    ]);

    const [{ titles }, index] = await Promise.all([loadListedTitles(ctx, SUPPORT, 'es'), loadStaticIndex(ctx, SUPPORT, 'es')]);

    expect([...titles.keys()]).toEqual([article('11003440-self-service-no-se-abre')]);
    expect(index.map(entry => entry.title)).toEqual([
      titleFromSlug('actualizar-la-licencia-de-jamf-connect', 'es'),
      titleFromSlug('renovar-la-licencia', 'es'),
      'Self Service no se abre',
    ]);
    expect(index.map(entry => entry.title)).not.toContain('Untitled');
  });
});
