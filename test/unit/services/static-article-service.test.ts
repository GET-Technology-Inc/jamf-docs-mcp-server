/**
 * Unit tests for the non-Fluid-Topics article path.
 *
 * These cover the parts that are specific to reading a whole web page rather
 * than a Fluid Topics fragment: URL canonicalisation, the source's own
 * selectors and link base, the title fallback, and provenance. The view
 * shapes (summary, section, truncation) are shared with the FT path through
 * `buildArticleView` and are covered by article-service.test.ts.
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
import { STATIC_DOC_SOURCES, staticSourceForUrl } from '../../../src/core/constants/sources.js';
import { createMockContext } from '../../helpers/mock-context.js';

const CONCEPTS = STATIC_DOC_SOURCES['jamf-concepts'];

/** Shaped like the real pages: one `<article class="prose">`, chrome around it. */
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
