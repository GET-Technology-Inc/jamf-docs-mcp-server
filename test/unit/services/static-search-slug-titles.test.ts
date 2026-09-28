/**
 * How the search title index ranks a page by its listed title and by the one
 * its slug gives (`StaticSearchEntry.slugTitle`), and what a hit carries.
 *
 * Fuse multiplies a page's score over the keys it matched on, so the slug's
 * key falls back to the listed title: a page whose slug gives the same title
 * is matched on both keys as well. Without that, a page with a slug title of
 * its own scored better than one without that matched a query as well.
 * Measured over the live pages on 2026-09-28, with 10,158 en-US queries taken
 * from the titles, 5,171 then had other support.jamf.com pages in their top 3
 * than before the listed titles, against 1,383 with the fallback, each of
 * which has a page whose title's words changed among them.
 *
 * The pages here are concepts.jamf.com tools, titled by a tools index page
 * served in the site's format, so each entry is built as a live one is.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { searchStaticSources, loadStaticIndex } from '../../../src/core/services/static-search-service.js';
import { STATIC_DOC_SOURCES } from '../../../src/core/constants/sources.js';
import { HttpError, type HttpClient } from '../../../src/core/http-client.js';
import type { ServerContext } from '../../../src/core/types/context.js';
import { createMockContext } from '../../helpers/mock-context.js';
import { conceptsIndexUrl, flightPage } from '../../helpers/concepts-index-pages.js';

const CONCEPTS = STATIC_DOC_SOURCES['jamf-concepts'];

/** A tool as the tools index lists it: its slug, and the title the site gives it. */
interface Tool { slug: string; title: string }

const toolUrl = (slug: string): string => `${CONCEPTS.baseUrl}/en/concepts/${slug}/`;

/** A context whose concepts.jamf.com lists `tools`, and whose other pages answer 404. */
function listing(tools: readonly Tool[]): ServerContext {
  const pages = new Map<string, string>([
    [`${CONCEPTS.baseUrl}/sitemap.xml`, `<urlset>${tools
      .map(({ slug }) => `<url><loc>${CONCEPTS.baseUrl}/en/concepts/${slug}</loc></url>`).join('')}</urlset>`],
    [conceptsIndexUrl('en', 'concepts'), flightPage(`8:${JSON.stringify(['$', '$L26', null, { concepts: tools }])}\n`)],
  ]);
  const http: HttpClient = {
    getText: async (url) => {
      const page = pages.get(url);
      if (page === undefined) { throw new HttpError(404, 'Not Found', url); }
      return await Promise.resolve(page);
    },
    getJson: async url => await Promise.reject(new HttpError(404, 'Not Found', url)),
    postJson: async url => await Promise.reject(new HttpError(404, 'Not Found', url)),
  };
  return createMockContext({ http });
}

let ctx: ServerContext;

describe('a page\'s slug title in the search ranking', () => {
  beforeEach(() => { ctx = createMockContext(); });

  it('does not lift a page above one whose listed title matches as well and whose slug gives the same one', async () => {
    // As Intercom lists "How to determine if an IdP is configured to use
    // ROPG", whose slug gives "How to Determine If an IdP Is Configured to Use
    // ROPG": only the case differs, which Fuse ignores. 218 of the 820 en
    // support.jamf.com titles are such (2026-09-28).
    ctx = listing([
      { slug: 'enable-filevault', title: 'Enable Filevault' },
      { slug: 'cancel-filevault', title: 'Cancel FileVault' },
    ]);
    const index = await loadStaticIndex(ctx, CONCEPTS, 'en');
    expect(index.map(({ title, slugTitle }) => [title, slugTitle])).toEqual([
      ['Enable Filevault', 'Enable FileVault'],
      ['Cancel FileVault', undefined],
    ]);

    const hits = await searchStaticSources(ctx, 'filevault', 'en-US');

    expect(hits).toHaveLength(2);
    expect(hits[0]?.score).toBe(hits[1]?.score);
  });

  it('ranks a page whose listed title matches above one that matches only by its slug\'s', async () => {
    ctx = listing([
      // Found by its slug's words alone: its listed title is another.
      { slug: 'jamf-sync', title: 'Réplicateur' },
      // Found by its listed title alone: its slug gives another.
      { slug: 'replicator-tool', title: 'Jamf Sync' },
    ]);

    const hits = await searchStaticSources(ctx, 'Jamf Sync', 'en-US');

    expect(hits.map(hit => hit.url)).toEqual([toolUrl('replicator-tool'), toolUrl('jamf-sync')]);
    expect(hits[0]?.score).toBeLessThan(hits[1]?.score ?? 0);
  });
});

describe('a hit', () => {
  it('carries the title it is shown by, its URL, source and score, and not the slug\'s title', async () => {
    ctx = listing([{ slug: 'apiutil', title: 'API Utility' }]);
    expect((await loadStaticIndex(ctx, CONCEPTS, 'en'))[0]?.slugTitle).toBe('Apiutil');

    const hits = await searchStaticSources(ctx, 'Apiutil', 'en-US');

    expect(hits).toHaveLength(1);
    expect(Object.keys(hits[0] ?? {}).sort()).toEqual(['score', 'source', 'title', 'url']);
    expect(hits[0]).toMatchObject({ title: 'API Utility', url: toolUrl('apiutil'), source: CONCEPTS.name });
  });
});
