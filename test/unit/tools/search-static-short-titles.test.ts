/**
 * A page of concepts.jamf.com or support.jamf.com titled with two Latin
 * letters is found by its title: `jamf_docs_search` over MCP, with the real
 * search service and other-source search, and only the http client stubbed,
 * serving concepts.jamf.com's sitemap and section index pages as the site
 * listed them on 2026-09-28.
 *
 * The other-source search matches a Latin query only on a run of three
 * characters or more in a title (`MIN_MATCH_CHAR_LENGTH` in
 * static-search-service.ts), and a query of two letters has no such run. So
 * until 2026-09-28 the category page concepts.jamf.com titles "AI" in en,
 * ja, nl, zh-TW and zh-CN, "KI" in de and "IA" in es and fr, could not be
 * found in any locale: live that day, `AI`, `KI` in de-DE and `IA` in fr-FR
 * each had no other-source match. It is the only page either site titles
 * with fewer than three Latin letters. Now a query of fewer than three
 * characters finds the pages titled exactly that, ahead of anything else it
 * found, within the source's three.
 *
 * Every query is searched without the spaces around it. Until 2026-09-28 a
 * Latin one was searched as typed, and a space counted in its runs: ` AI `
 * found the pages whose titles have `AI ` in them, which `AI` does not. And
 * with its full-width letters in ASCII, as Fuse is asked for it, so `ＡＩ`
 * finds the page too.
 */

import { describe, it, expect } from 'vitest';
import { callSearch, CLUSTERED_SEARCH, CONCEPTS_SITEMAP, MAPS_LIST, PRO_DOCUMENTATION_MAP } from '../../helpers/search-upstream.js';
import { conceptsIndexPages } from '../../helpers/concepts-index-pages.js';
import { createMockContext, createMockCache } from '../../helpers/mock-context.js';
import { cacheKey } from '../../../src/core/services/cache-key.js';
import { MapsRegistry } from '../../../src/core/services/maps-registry.js';
import { TopicResolver } from '../../../src/core/services/topic-resolver.js';
import { HttpError, type HttpClient } from '../../../src/core/http-client.js';
import type { FtClusteredSearchResponse } from '../../../src/core/types.js';
import type { StaticSearchEntry } from '../../../src/core/services/static-search-service.js';
import type { ServerContext } from '../../../src/core/types/context.js';

const PSSO = 'guides/device-trust-identity-and-deployment/platform-single-sign-on';

const PATHS = [
  'guides/threat-and-risk-management/ai',
  'guides/ai-governance',
  'concepts/jamformer',
  // A category page, and a guide in it, both titled "Platform SSO for macOS".
  PSSO,
  `${PSSO}/platform-sso-for-macos`,
];

/**
 * The guides overview, which concepts.jamf.com titles 概要 in ja, and a
 * guide whose ja title ends with that word.
 */
const JA_PATHS = [
  'guides/overview',
  'guides/infrastructure-as-code/managing-jamf-pro-with-terraform-the-jamf-pro-provider',
];

/** The live sitemap's entries for these pages, in en, fr and ja, in its order. */
const SITEMAP = `<urlset>${[
  ...['en', 'fr'].flatMap(code => PATHS.map(path => `https://concepts.jamf.com/${code}/${path}`)),
  ...JA_PATHS.map(path => `https://concepts.jamf.com/ja/${path}`),
].map(loc => `<url><loc>${loc}</loc></url>`).join('')}</urlset>`;

const AI_EN = 'https://concepts.jamf.com/en/guides/threat-and-risk-management/ai/';
const AI_FR = 'https://concepts.jamf.com/fr/guides/threat-and-risk-management/ai/';

function upstream(): ServerContext {
  const indexPages = conceptsIndexPages();
  const nothingFound: FtClusteredSearchResponse = {
    facets: [],
    announcements: [],
    paging: { currentPage: 1, isLastPage: true, totalResultsCount: 0, totalClustersCount: 0 },
    results: [],
  };
  const http: HttpClient = {
    getJson: async <T>(url: string) => {
      if (url === MAPS_LIST) { return await Promise.resolve([PRO_DOCUMENTATION_MAP] as T); }
      throw new HttpError(404, 'Not Found', url);
    },
    getText: async (url) => {
      if (url === CONCEPTS_SITEMAP) { return await Promise.resolve(SITEMAP); }
      const page = indexPages.get(url);
      if (page !== undefined) { return await Promise.resolve(page); }
      throw new HttpError(404, 'Not Found', url);
    },
    postJson: async <T>(url: string) => {
      if (url !== CLUSTERED_SEARCH) { throw new HttpError(404, 'Not Found', url); }
      return await Promise.resolve(nothingFound as T);
    },
  };
  const cache = createMockCache();
  const mapsRegistry = new MapsRegistry(cache, undefined, undefined, undefined, http);
  return createMockContext({
    cache, http, mapsRegistry, topicResolver: new TopicResolver(mapsRegistry, cache, undefined, undefined, http),
  });
}

interface Hit { title: string; url: string; source: string }

async function otherSources(ctx: ServerContext, query: string, language?: string): Promise<Hit[]> {
  const reply = await callSearch(ctx, { query, ...(language !== undefined ? { language } : {}) });
  expect(reply.isError, reply.text).not.toBe(true);
  return (reply.structuredContent?.otherSources ?? []) as Hit[];
}

describe('a Latin query of two letters', () => {
  it('finds the page titled with them, in the markdown too', async () => {
    const ctx = upstream();
    const reply = await callSearch(ctx, { query: 'AI' });

    expect(reply.structuredContent?.otherSources).toEqual([{ title: 'AI', url: AI_EN, source: 'Jamf Concepts' }]);
    expect(reply.text).toContain(AI_EN);
  });

  it('finds it in any case, and with spaces around it', async () => {
    const ctx = upstream();

    for (const query of ['ai', 'Ai', ' AI ']) {
      expect((await otherSources(ctx, query)).map(hit => hit.url)[0], query).toBe(AI_EN);
    }
  });

  it('finds with spaces around it what it finds without: the spaces are not searched', async () => {
    // Until 2026-09-28 ` AI ` was searched as typed, and found AI Governance
    // too, by the run `AI ` in its title, which `AI` has not.
    const ctx = upstream();

    for (const query of [' AI ', 'AI ', '\u3000AI']) {
      expect(await otherSources(ctx, query), JSON.stringify(query)).toEqual(await otherSources(ctx, 'AI'));
    }
    expect(await otherSources(ctx, 'AI')).toEqual([{ title: 'AI', url: AI_EN, source: 'Jamf Concepts' }]);
  });

  it('finds it typed in full-width letters, as it finds AI', async () => {
    // The whole title is matched against the query Fuse is asked for, whose
    // full-width letters are in ASCII (see `fuseQueryFor`). Were it matched
    // against the query as typed, `ＡＩ` would find nothing.
    const ctx = upstream();

    for (const query of ['ＡＩ', 'ａｉ', '\u3000ＡＩ ']) {
      expect(await otherSources(ctx, query), JSON.stringify(query)).toEqual(await otherSources(ctx, 'AI'));
    }
    expect((await otherSources(ctx, 'ＡＩ')).map(hit => hit.url)).toEqual([AI_EN]);
  });

  it('finds it by the title it has in the language searched, and by its slug\'s', async () => {
    const ctx = upstream();

    expect(await otherSources(ctx, 'IA', 'fr-FR')).toEqual([{ title: 'IA', url: AI_FR, source: 'Jamf Concepts' }]);
    // The fr page's slug is ai, which is searched too, at half the weight.
    expect((await otherSources(ctx, 'AI', 'fr-FR')).map(hit => hit.url)).toEqual([AI_FR]);
  });

  it('finds nothing that is not titled with them', async () => {
    const ctx = upstream();

    expect(await otherSources(ctx, 'AO')).toEqual([]);
    expect(await otherSources(ctx, 'IA')).toEqual([]);
  });
});

describe('a query of one or two characters that is also matched as a title', () => {
  it('lists a page matched both ways once: 概要, the ja title of the guides overview', async () => {
    const ctx = upstream();

    expect((await otherSources(ctx, '概要', 'ja-JP')).map(hit => hit.title)).toEqual([
      '概要',
      'Terraform を使用した Jamf 構成管理の概要',
    ]);
  });

  /** A Jamf Concepts page, `slug` its address and `title` what it is listed as. */
  const page = (slug: string, title: string, slugTitle?: string): StaticSearchEntry => ({
    title, url: `https://concepts.jamf.com/en/concepts/${slug}/`, source: 'Jamf Concepts',
    ...(slugTitle !== undefined ? { slugTitle } : {}),
  });

  /** A context whose en index of Jamf Concepts is `entries`, in their order. */
  async function indexed(entries: StaticSearchEntry[]): Promise<ServerContext> {
    const ctx = upstream();
    await ctx.cache.set(cacheKey('static-search-index-v5', { source: 'jamf-concepts', locale: 'en' }), entries);
    return ctx;
  }

  it('puts the page titled with it first, and keeps to the source\'s three', async () => {
    // Fuse finds four pages for `in`, each by the run `inin` in its title
    // (live, support.jamf.com's Training Pass FAQ was one), and gives its
    // best three. The page titled In is none of them.
    const ctx = await indexed([
      page('training-pass', 'Training Pass FAQ'),
      page('training-courses', 'Jamf Training Courses & Certifications'),
      page('app-categories', 'Determining App Categories'),
      page('wi-fi', 'Joining Wi-Fi Networks'),
      page('in', 'In'),
    ]);

    // Fuse's first two, after it.
    expect((await otherSources(ctx, 'in')).map(hit => hit.title))
      .toEqual(['In', 'Training Pass FAQ', 'Determining App Categories']);
  });

  it('lists the pages it is the title of before those it is the slug\'s title of, whatever their order', async () => {
    const ctx = await indexed([
      page('ai', 'Intelligence artificielle', 'AI'),
      page('ai-page', 'AI'),
    ]);

    expect((await otherSources(ctx, 'AI')).map(hit => hit.title)).toEqual(['AI', 'Intelligence artificielle']);
  });
});

describe('a Latin query of three characters or more', () => {
  it('that is a whole title, of three characters, gets Fuse\'s order, not the index\'s', async () => {
    // Both pages are titled API; the second's slug gives API too, so Fuse
    // ranks it first. Matched as whole titles, they would come in the
    // index's order.
    const ctx = upstream();
    const entries: StaticSearchEntry[] = [
      { title: 'API', url: 'https://concepts.jamf.com/en/concepts/api-overview/', source: 'Jamf Concepts', slugTitle: 'Api Overview' },
      { title: 'API', url: 'https://concepts.jamf.com/en/concepts/api/', source: 'Jamf Concepts' },
    ];
    await ctx.cache.set(cacheKey('static-search-index-v5', { source: 'jamf-concepts', locale: 'en' }), entries);

    expect((await otherSources(ctx, 'API')).map(hit => hit.url)).toEqual([
      'https://concepts.jamf.com/en/concepts/api/',
      'https://concepts.jamf.com/en/concepts/api-overview/',
    ]);
  });

  it('finds what it found before, in the order Fuse ranks it, even when it is a whole title', async () => {
    // Fuse ranks the guide first, a hair ahead of the category page the
    // guides index links by the same name. Matched as whole titles, they
    // would come in the sitemap's order.
    const ctx = upstream();

    expect((await otherSources(ctx, 'Platform SSO for macOS')).map(hit => hit.url)).toEqual([
      `https://concepts.jamf.com/en/${PSSO}/platform-sso-for-macos/`,
      `https://concepts.jamf.com/en/${PSSO}/`,
    ]);
  });
});
