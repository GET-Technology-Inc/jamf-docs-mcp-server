/**
 * support.jamf.com as its six locale home pages listed it on 2026-09-28
 * (`SUPPORT_COLLECTIONS_BY_LOCALE`), with switches to make any locale's home
 * page, or any collection page, fail each way a real one can.
 *
 * For suites that drive `jamf_docs_list_products` and `jamf_docs_get_toc`
 * over MCP with the real Intercom reader and cache keys, and stub only the
 * http client. A collection page holds its first entry and nothing else.
 */

import { HttpError, type HttpClient } from '../../src/core/http-client.js';
import { STATIC_DOC_SOURCES } from '../../src/core/constants/sources.js';
import {
  SUPPORT_COLLECTIONS_BY_LOCALE,
  type SupportCollectionFixture,
} from '../fixtures/support-collections-by-locale.js';

const ORIGIN = STATIC_DOC_SOURCES['jamf-support'].baseUrl;

/**
 * How a home page can fail to list its collections.
 *
 * - `503`: the request fails, which the reader has always reported.
 * - `no-next-data`: a 200 without `__NEXT_DATA__`, as a maintenance or
 *   bot-challenge page is.
 * - `no-home`: a 200 whose page data has no `home`, as a page of another
 *   kind has.
 * - `empty`: a 200 listing no collections, which is what support.jamf.com
 *   serves for `nl` and `th`, the locales it routes and does not publish in.
 *   An answer for any locale but en: that locale publishes nothing. For en,
 *   whose listing the publication ids come from, a failure.
 */
export type HomeFailure = '503' | 'no-next-data' | 'no-home' | 'empty';

export const HOME_FAILURES: readonly HomeFailure[] = ['503', 'no-next-data', 'no-home', 'empty'];

/** The ways a home page fails that the reader cannot read in any locale. */
export const UNREADABLE_HOMES: readonly HomeFailure[] = ['503', 'no-next-data', 'no-home'];

/**
 * How a collection page can fail to give its tree: `503`, or a 200 without
 * `__NEXT_DATA__` (`no-next-data`) or without `collection` (`no-collection`).
 */
export type CollectionFailure = '503' | 'no-next-data' | 'no-collection';

export const COLLECTION_FAILURES: readonly CollectionFailure[] = ['503', 'no-next-data', 'no-collection'];

/** A page carrying `pageProps` the way Intercom's Next.js pages do. */
export function nextDataPage(pageProps: unknown): string {
  return `<html><body><script id="__NEXT_DATA__" type="application/json" nonce="n">${
    JSON.stringify({ props: { pageProps } })}</script></body></html>`;
}

/** A locale's home page URL, as the reader requests it. */
export function homeUrl(code: string): string {
  return `${ORIGIN}/${code}/`;
}

/** A collection's URL as its locale's home page lists it: the slug raw. */
export function listedUrl(code: string, collection: SupportCollectionFixture): string {
  return `${ORIGIN}/${code}/collections/${collection.id}-${collection.slug}`;
}

/**
 * The fixture's copy of collection `id` in locale `code`, if it has one. The
 * live listing's, whatever a suite has put in `SupportUpstream.listings`.
 */
export function collectionIn(code: string, id: string): SupportCollectionFixture | undefined {
  return SUPPORT_COLLECTIONS_BY_LOCALE[code]?.find(c => c.id === id);
}

const MAINTENANCE_PAGE = '<!DOCTYPE html><html><head><title>Jamf Support</title></head>' +
  '<body><p>We will be back shortly.</p></body></html>';

function failedHome(failure: HomeFailure, url: string): string {
  switch (failure) {
    case '503':
      throw new HttpError(503, 'Service Unavailable', url);
    case 'no-next-data':
      return MAINTENANCE_PAGE;
    case 'no-home':
      return nextDataPage({});
    case 'empty':
      return nextDataPage({ home: { collections: [] } });
  }
}

function failedCollection(failure: CollectionFailure, url: string): string {
  switch (failure) {
    case '503':
      throw new HttpError(503, 'Service Unavailable', url);
    case 'no-next-data':
      return MAINTENANCE_PAGE;
    case 'no-collection':
      return nextDataPage({});
  }
}

function collectionPage(collection: SupportCollectionFixture): string {
  const { kind, title, url } = collection.first;
  return nextDataPage({
    collection: kind === 'article'
      ? { articleSummaries: [{ title, url }] }
      : { subcollections: [{ name: title, url, articleSummaries: [] }] },
  });
}

export interface SupportUpstream {
  http: HttpClient;
  /** Every url requested, in order. */
  requests: string[];
  /** Locale codes whose home page fails, and how. Read on every request. */
  failing: Map<string, HomeFailure>;
  /**
   * Collection pages that fail, and how, keyed `<locale code>/<Intercom id>`,
   * as in `en/12369024`. Read on every request.
   */
  failingCollections: Map<string, CollectionFailure>;
  /**
   * Listings served in place of the live ones, by locale code, for a case no
   * live listing has. Their collection pages are served too.
   */
  listings: Map<string, readonly SupportCollectionFixture[]>;
  /** Forget the requests, and serve every page as it was live again. */
  reset: () => void;
}

export function createSupportUpstream(): SupportUpstream {
  const requests: string[] = [];
  const failing = new Map<string, HomeFailure>();
  const failingCollections = new Map<string, CollectionFailure>();
  const listings = new Map<string, readonly SupportCollectionFixture[]>();

  const listingOf = (code: string): readonly SupportCollectionFixture[] | undefined =>
    listings.get(code) ?? SUPPORT_COLLECTIONS_BY_LOCALE[code];

  const http: HttpClient = {
    getText: async (url) => {
      requests.push(url);
      const segments = new URL(url).pathname.split('/').filter(Boolean);
      const [code = '', kind = '', leaf = ''] = segments;
      const listing = listingOf(code);
      if (segments.length === 1 && listing !== undefined) {
        const failure = failing.get(code);
        if (failure !== undefined) { return await Promise.resolve(failedHome(failure, url)); }
        return await Promise.resolve(nextDataPage({
          home: {
            collections: listing.map(c => ({
              id: c.id, slug: c.slug, name: c.name, description: '', url: listedUrl(code, c), articleCount: c.entries,
            })),
          },
        }));
      }
      const id = leaf.split('-')[0] ?? '';
      const collection = kind === 'collections' ? listing?.find(c => c.id === id) : undefined;
      if (collection !== undefined) {
        const failure = failingCollections.get(`${code}/${id}`);
        if (failure !== undefined) { return await Promise.resolve(failedCollection(failure, url)); }
        return await Promise.resolve(collectionPage(collection));
      }
      throw new HttpError(404, 'Not Found', url);
    },
    getJson: async (url) => await Promise.reject(new HttpError(404, 'Not Found', url)),
    postJson: async (url) => await Promise.reject(new HttpError(404, 'Not Found', url)),
  };

  return {
    http,
    requests,
    failing,
    failingCollections,
    listings,
    reset: () => {
      requests.length = 0;
      failing.clear();
      failingCollections.clear();
      listings.clear();
    },
  };
}
