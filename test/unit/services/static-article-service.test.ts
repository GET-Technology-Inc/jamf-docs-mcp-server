/**
 * Unit tests for the non-Fluid-Topics article path.
 *
 * These cover the parts that are specific to reading a whole web page rather
 * than a Fluid Topics fragment: URL canonicalisation, the source's own
 * selectors and link base, the title fallback, the breadcrumb trail, and
 * provenance. The view shapes (summary, section, truncation) are shared with
 * the FT path through `buildArticleView` and are covered by
 * article-service.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockHttpGetText = vi.fn<(url: string) => Promise<string>>();
vi.mock('../../../src/core/http-client.js', () => ({
  httpGetText: async (url: string) => await mockHttpGetText(url),
}));

import {
  canonicalStaticUrl,
  extractDocumentTitle,
  fetchStaticArticle,
} from '../../../src/core/services/static-article-service.js';
import { STATIC_DOC_SOURCES, staticSourceForUrl, type StaticDocSource } from '../../../src/core/constants/sources.js';
import { createMockContext } from '../../helpers/mock-context.js';
import { CONCEPTS_GUIDE_HTML, CONCEPTS_GUIDE_URL } from '../../fixtures/concepts-guide-page.js';
import { CONCEPTS_STRAY_H1_HTML, CONCEPTS_STRAY_H1_URL } from '../../fixtures/concepts-guide-stray-h1-page.js';

const CONCEPTS = STATIC_DOC_SOURCES['jamf-concepts'];

/**
 * Shaped like a tool page: one `<article class="prose">`, chrome around it,
 * and the page's only other `<h1>` inside `<header>`. Guide pages put theirs
 * in a plain `<section>` instead, which no chrome rule removes; the captured
 * fixtures carry that shape and the title tests below use them.
 */
function pageHtml(options?: { h1?: string; ogTitle?: string; body?: string }): string {
  return `<!doctype html><html><head>
    <title>${options?.ogTitle ?? 'Some Page'} | Jamf Concepts</title>
    ${options?.ogTitle !== undefined ? `<meta property="og:title" content="${options.ogTitle}">` : ''}
  </head><body>
    <header><nav><a href="/en/guides/">Guides</a></nav>${options?.h1 === undefined ? '<h1>Hero</h1>' : ''}</header>
    <main class="flex-1">
      <aside><a href="/en/guides/overview">Overview</a></aside>
      <article class="prose">
        ${options?.h1 !== undefined ? `<h1>${options.h1}</h1>` : ''}
        ${options?.body ?? '<h2>Section A</h2><p>Body text with a <a href="/en/other">relative link</a>.</p>'}
      </article>
    </main>
    <footer>footer</footer>
  </body></html>`;
}

describe('canonicalStaticUrl', () => {
  // The sitemap lists all 990 entries without a trailing slash and the site
  // redirects to the slashed form, so fetching them as listed is 990 needless
  // round trips.
  it('adds the trailing slash a directory-style path redirects to', () => {
    expect(canonicalStaticUrl('https://concepts.jamf.com/en/guides'))
      .toBe('https://concepts.jamf.com/en/guides/');
  });

  it('leaves an already-canonical URL alone', () => {
    expect(canonicalStaticUrl('https://concepts.jamf.com/en/guides/'))
      .toBe('https://concepts.jamf.com/en/guides/');
  });

  it('leaves a file path alone', () => {
    expect(canonicalStaticUrl('https://concepts.jamf.com/llms-full.txt'))
      .toBe('https://concepts.jamf.com/llms-full.txt');
  });

  it('returns an unparseable input unchanged rather than throwing', () => {
    expect(canonicalStaticUrl('not a url')).toBe('not a url');
  });
});

describe('extractDocumentTitle', () => {
  it('prefers og:title, which carries no site-name suffix', () => {
    expect(extractDocumentTitle('<meta property="og:title" content="API Utility">'))
      .toBe('API Utility');
  });

  it('falls back to <title> with the site name trimmed', () => {
    expect(extractDocumentTitle('<title>API Utility | Jamf Concepts</title>'))
      .toBe('API Utility');
  });

  it('decodes the entities a title attribute carries', () => {
    expect(extractDocumentTitle('<meta property="og:title" content="Jamf &amp; You">'))
      .toBe('Jamf & You');
  });

  it('decodes each entity once, so an escaped entity stays literal text', () => {
    // `&amp;lt;` is the page saying the four characters "&lt;", not "<".
    expect(extractDocumentTitle('<meta property="og:title" content="Escaping &amp;lt;tags&amp;gt; &amp;amp; more">'))
      .toBe('Escaping &lt;tags&gt; &amp; more');
    expect(extractDocumentTitle('<title>A &lt;b&gt; &quot;c&quot; &#39;d&#x27; | Jamf Concepts</title>'))
      .toBe('A <b> "c" \'d\'');
  });

  it('returns undefined when the page has neither', () => {
    expect(extractDocumentTitle('<html><body>no title</body></html>')).toBeUndefined();
  });
});

describe('fetchStaticArticle', () => {
  beforeEach(() => { mockHttpGetText.mockReset(); });

  it('extracts the article body without the surrounding chrome', async () => {
    mockHttpGetText.mockResolvedValue(pageHtml({ h1: 'Real Title' }));
    const result = await fetchStaticArticle(createMockContext(), CONCEPTS, 'https://concepts.jamf.com/en/x');

    expect(result.title).toBe('Real Title');
    expect(result.content).toContain('Section A');
    // The sidebar and nav are what `main` would have pulled in ahead of the
    // article: `.html()` takes the first match in document order, so listing
    // `main` in CONTENT at all defeats the article selector.
    expect(result.content).not.toContain('Overview');
    expect(result.content).not.toContain('footer');
  });

  it('rewrites root-relative links to the source, not learn.jamf.com', async () => {
    mockHttpGetText.mockResolvedValue(pageHtml({ h1: 'T' }));
    const result = await fetchStaticArticle(createMockContext(), CONCEPTS, 'https://concepts.jamf.com/en/x');

    expect(result.content).toContain('https://concepts.jamf.com/en/other');
    expect(result.content).not.toContain('learn.jamf.com/en/other');
  });

  it('falls back to the document title when the chrome took the only h1', async () => {
    mockHttpGetText.mockResolvedValue(pageHtml({ ogTitle: 'API Utility' }));
    const result = await fetchStaticArticle(createMockContext(), CONCEPTS, 'https://concepts.jamf.com/en/concepts/apiutil');

    expect(result.title).toBe('API Utility');
  });

  it('labels the content as exploratory rather than product documentation', async () => {
    mockHttpGetText.mockResolvedValue(pageHtml({ h1: 'T' }));
    const result = await fetchStaticArticle(createMockContext(), CONCEPTS, 'https://concepts.jamf.com/en/x');

    expect(result.content).toContain('not official product documentation');
    expect(result.product).toBe('Jamf Concepts');
  });

  it('fetches the canonical URL, not the one it was handed', async () => {
    mockHttpGetText.mockResolvedValue(pageHtml({ h1: 'T' }));
    await fetchStaticArticle(createMockContext(), CONCEPTS, 'https://concepts.jamf.com/en/guides/a');

    expect(mockHttpGetText).toHaveBeenCalledWith('https://concepts.jamf.com/en/guides/a/');
  });

  it('serves a second read from cache', async () => {
    mockHttpGetText.mockResolvedValue(pageHtml({ h1: 'T' }));
    const ctx = createMockContext();
    await fetchStaticArticle(ctx, CONCEPTS, 'https://concepts.jamf.com/en/x');
    await fetchStaticArticle(ctx, CONCEPTS, 'https://concepts.jamf.com/en/x');

    expect(mockHttpGetText).toHaveBeenCalledTimes(1);
  });

  it('reads the breadcrumb trail off a live-shaped guide page (#285)', async () => {
    // Every concepts.jamf.com article returned `breadcrumb: []` until #295,
    // for two independent reasons, and fixing either alone still yields []:
    // the source's selector looked for a `breadcrumb` class the site does not
    // use (it marks the trail `aria-label="Breadcrumb"`), and `parseArticle`
    // read the trail after `cleanHtml`, whose static-source REMOVE list strips
    // every `<nav>` — the trail included. So this goes through the service,
    // with the source's own selectors, rather than calling `parseArticle`
    // directly: both halves have to hold for the trail to come back.
    //
    // This is the merge gate's only check on it. concepts-contracts only
    // asserts a multi-crumb trail on sampled live guides, on the Monday cron
    // (test/integration/concepts-contracts.test.ts:278-315), and with
    // all of #295's src changes reverted every other unit test still passes
    // (1748 of 1748 on 3f0ccfa, measured 2026-09-24).
    mockHttpGetText.mockResolvedValue(CONCEPTS_GUIDE_HTML);
    const result = await fetchStaticArticle(createMockContext(), CONCEPTS, CONCEPTS_GUIDE_URL);

    // Exact, in order: the header and sidebar navs carry the same link text,
    // so anything looser than the trail's own `nav` shows up here as extra or
    // reordered entries rather than passing.
    expect(result.breadcrumb).toEqual([
      'Guides',
      'Device Trust Identity and Deployment',
      'Platform SSO for macOS',
    ]);
  });
});

describe('fetchStaticArticle: concepts.jamf.com titles', () => {
  beforeEach(() => { mockHttpGetText.mockReset(); });

  /** The source as configured, minus any REMOVE clause that mentions `tracking`. */
  function withoutTrackingClause(source: StaticDocSource): StaticDocSource {
    const kept = source.selectors.REMOVE.split(',')
      .map(clause => clause.trim())
      .filter(clause => !clause.includes('tracking'));
    return { ...source, selectors: { ...source.selectors, REMOVE: kept.join(', ') } };
  }

  const HERO = /<section[^>]*>[\s\S]*?<h1 class="[^"]*\btracking-tight\b[^"]*">Guides<\/h1>/;

  it('titles a guide by its own name, not by an <h1> inside its body', async () => {
    // The title selector was a bare 'h1'. This guide's body holds a bash
    // script that the site's Markdown turned into <h1>s, and the first of
    // them became the title in all 10 locales: "Jamf Pro Extension Attribute
    // which checks and validates the following:". The article does not open
    // with a title <h1> of its own, so the answer has to be `og:title`.
    mockHttpGetText.mockResolvedValue(CONCEPTS_STRAY_H1_HTML);
    const result = await fetchStaticArticle(createMockContext(), CONCEPTS, CONCEPTS_STRAY_H1_URL);

    expect(result.title).toBe('Enforcing Compliance Baselines for Network Access');
    // Headings are still content. Only the title stopped reading them.
    expect(result.content).toContain('# Jamf Pro Extension Attribute which checks and validates the following:');
  });

  it('titles a guide by its own name, not by the "Guides" hero', async () => {
    mockHttpGetText.mockResolvedValue(CONCEPTS_GUIDE_HTML);
    const result = await fetchStaticArticle(createMockContext(), CONCEPTS, CONCEPTS_GUIDE_URL);

    expect(result.title).toBe('Platform SSO for macOS');
  });

  it('does not need the tracking clause to keep the hero <h1> out of the title', async () => {
    // Every guide page opens with a hero <h1>Guides</h1> in a plain
    // <section>, outside every chrome rule. With TITLE a bare 'h1', the only
    // thing keeping it out of the title was `[class*="tracking"]` in
    // SELECTORS.REMOVE, a clause written for tracking scripts that matches
    // the hero's Tailwind `tracking-tight`. Deleting it titled all 570
    // guide-section pages "Guides" and every other unit test still passed
    // (1843 of 1843 on 368f9a2, measured 2026-09-24). Scoping TITLE to the
    // article is what removes that dependency, and this is what pins it.
    expect(CONCEPTS_GUIDE_HTML, 'the fixture carries the hero').toMatch(HERO);
    expect(CONCEPTS_STRAY_H1_HTML, 'the fixture carries the hero').toMatch(HERO);

    const source = withoutTrackingClause(CONCEPTS);

    mockHttpGetText.mockResolvedValue(CONCEPTS_GUIDE_HTML);
    const guide = await fetchStaticArticle(createMockContext(), source, CONCEPTS_GUIDE_URL);
    expect(guide.title).toBe('Platform SSO for macOS');

    mockHttpGetText.mockResolvedValue(CONCEPTS_STRAY_H1_HTML);
    const stray = await fetchStaticArticle(createMockContext(), source, CONCEPTS_STRAY_H1_URL);
    expect(stray.title).toBe('Enforcing Compliance Baselines for Network Access');
  });
});

describe('staticSourceForUrl', () => {
  it('recognises a registered source', () => {
    expect(staticSourceForUrl('https://concepts.jamf.com/en/x')?.id).toBe('jamf-concepts');
  });

  it('leaves Fluid Topics URLs to the Fluid Topics path', () => {
    expect(staticSourceForUrl('https://learn.jamf.com/en-US/bundle/x/page/y.html')).toBeUndefined();
  });

  it('returns undefined for an unparseable URL rather than throwing', () => {
    expect(staticSourceForUrl('::::')).toBeUndefined();
  });
});
