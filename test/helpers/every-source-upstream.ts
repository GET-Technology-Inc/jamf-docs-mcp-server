/**
 * Every documentation host the server reads, at the http client: enough of
 * learn.jamf.com, concepts.jamf.com and support.jamf.com for each tool to
 * answer without an error, with the real services and cache keys behind it.
 *
 * For suites that build the server on the Node context (`createNodeContext`)
 * and drive every tool over MCP: cache-ttl-documented.test.ts, which reads the
 * TTL each cache entry is written with, and env-vars-take-effect.test.ts,
 * which serves this over `fetch` to see what each request carries.
 */

import { HttpError, type HttpClient } from '../../src/core/http-client.js';
import type { FtClusteredSearchResponse, FtMapInfo, FtTopicInfo } from '../../src/core/types.js';
import { articleUpstream, CCP, PRO_MAP } from './article-upstream.js';
import { GLOSSARY_MAP_ID, LIVE_GLOSSARY_TOC, serveGlossaryContent } from './glossary-upstream.js';
import {
  CLUSTERED_SEARCH, CONCEPTS_SITEMAP, MAPS_LIST, PRESTAGE, PRO_DOCUMENTATION_MAP,
} from './search-upstream.js';
import { createSupportUpstream, nextDataPage } from './support-upstream.js';
import { CONCEPTS_GUIDE_HTML, CONCEPTS_GUIDE_URL } from '../fixtures/concepts-guide-page.js';
import { conceptsIndexPage, conceptsIndexUrl } from './concepts-index-pages.js';

/**
 * A concepts.jamf.com sitemap with two guides and one tool, as the live one
 * lists them. `CONCEPTS_GUIDE_URL` is the second guide, and the one served.
 */
const CONCEPTS_SITEMAP_XML = '<urlset>'
  + '<url><loc>https://concepts.jamf.com/en/guides/ai-governance</loc></url>'
  + '<url><loc>https://concepts.jamf.com/en/concepts/jamformer</loc></url>'
  + `<url><loc>${CONCEPTS_GUIDE_URL}</loc></url>`
  + '</urlset>';

const GLOSSARY_MAP: FtMapInfo = {
  id: GLOSSARY_MAP_ID,
  title: 'Jamf Platform Technical Glossary',
  mapApiEndpoint: `/api/khub/maps/${GLOSSARY_MAP_ID}`,
  metadata: [
    { key: 'version_bundle_stem', label: 'version_bundle_stem', values: ['jamf-technical-glossary'] },
    { key: 'ft:locale', label: 'ft:locale', values: ['en-US'] },
  ],
};

/** `GET …/maps/{PRO_MAP}/topics`, which a legacy `…/page/<slug>.html` url is resolved through. */
const PRO_TOPICS: FtTopicInfo[] = [{
  id: CCP,
  title: 'Computer Configuration Profiles',
  contentApiEndpoint: `/api/khub/maps/${PRO_MAP}/topics/${CCP}/content`,
  metadata: [],
}];

/** A support.jamf.com article, which is read off its page's `__NEXT_DATA__`. */
export const SUPPORT_ARTICLE_URL = 'https://support.jamf.com/en/articles/10631322-get-started-with-jamf-now';
const SUPPORT_ARTICLE_HTML = nextDataPage({
  articleContent: { title: 'Get started with Jamf Now', blocks: [{ type: 'paragraph', text: 'Enrol a device.' }] },
  breadcrumbs: [],
});

export interface EverySourceUpstream {
  http: HttpClient;
  /** Every url requested, in order. */
  requests: string[];
}

/**
 * learn.jamf.com (the maps list, Jamf Pro's map, its TOC and topics, the
 * glossary and the clustered search), concepts.jamf.com's sitemap, its en
 * section index pages and one guide, and support.jamf.com's pages and one
 * article. Anything else is a 404, which every tool survives. The index
 * pages are served so that a search index is built with every title listed,
 * and so kept for CACHE_TTL_PRODUCTS rather than the minute one built
 * without them is.
 */
export function everySourceUpstream(): EverySourceUpstream {
  const requests: string[] = [];
  const ft = articleUpstream();
  const support = createSupportUpstream();
  const glossaryContent = serveGlossaryContent(() => new Set());
  const http: HttpClient = {
    getJson: async <T>(url: string) => {
      requests.push(url);
      const pathname = decodeURIComponent(new URL(url).pathname);
      if (url === MAPS_LIST) { return await Promise.resolve([PRO_DOCUMENTATION_MAP, GLOSSARY_MAP] as T); }
      if (pathname === `/api/khub/maps/${PRO_MAP}/topics`) { return await Promise.resolve(PRO_TOPICS as T); }
      if (pathname === `/api/khub/maps/${GLOSSARY_MAP_ID}/toc`) { return await Promise.resolve(LIVE_GLOSSARY_TOC as T); }
      return await ft.getJson(url) as T;
    },
    getText: async (url) => {
      requests.push(url);
      if (url === CONCEPTS_SITEMAP) { return await Promise.resolve(CONCEPTS_SITEMAP_XML); }
      if (url === CONCEPTS_GUIDE_URL) { return await Promise.resolve(CONCEPTS_GUIDE_HTML); }
      for (const section of ['guides', 'concepts'] as const) {
        if (url === conceptsIndexUrl('en', section)) { return await Promise.resolve(conceptsIndexPage('en', section)); }
      }
      const { hostname, pathname } = new URL(url);
      if (hostname === 'support.jamf.com') {
        if (pathname.replace(/\/$/, '') === new URL(SUPPORT_ARTICLE_URL).pathname) { return SUPPORT_ARTICLE_HTML; }
        return await support.http.getText(url);
      }
      const glossary = new RegExp(`^/api/khub/maps/${GLOSSARY_MAP_ID}/topics/([^/]+)/content$`)
        .exec(decodeURIComponent(pathname));
      if (glossary !== null) { return await glossaryContent(undefined, GLOSSARY_MAP_ID, glossary[1]); }
      if (hostname === 'learn.jamf.com') { return await ft.getText(url); }
      throw new HttpError(404, 'Not Found', url);
    },
    postJson: async <T>(url: string) => {
      requests.push(url);
      if (url !== CLUSTERED_SEARCH) { throw new HttpError(404, 'Not Found', url); }
      const response: FtClusteredSearchResponse = {
        facets: [],
        announcements: [],
        paging: { currentPage: 1, isLastPage: true, totalResultsCount: 1, totalClustersCount: 1 },
        results: [{ metadataVariableAxis: 'version', entries: [PRESTAGE] }],
      };
      return await Promise.resolve(response as T);
    },
  };
  return { http, requests };
}
