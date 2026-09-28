/**
 * What `jamf_docs_get_article` keeps of a page from a source outside Fluid
 * Topics, and the key it keeps it under.
 *
 * Its own module so that both readers of a support.jamf.com collection page
 * can keep what the other reads from it: `jamf_docs_get_article` reads the
 * page as the list of its articles (static-article-service.ts), and
 * `jamf_docs_get_toc` and the search title index read it as a tree
 * (intercom-service.ts). Both import this module, and the Intercom reader
 * stores the article service's entry from here without importing that
 * service, which imports it.
 */

import { cacheKey, type CacheKey } from './cache-key.js';
import { canonicalStaticUrl, staticSourceForHostname, type StaticDocSource } from '../constants/sources.js';
import type { ParsedArticleContent } from './content-parser.js';
import type { IntercomEditions, IntercomPage } from './intercom-service.js';

/** What gets cached: the parse, not the rendered view. */
export interface CachedStaticArticle {
  title: string;
  parsed: ParsedArticleContent;
  /**
   * The page's own address: the one it lists as its own in `editions` where
   * it lists one, else the url it was read from.
   */
  displayUrl: string;
  /** Only Intercom publishes one; the static pages carry no date. */
  lastUpdated?: string;
  /**
   * Which edition the page is, and where its others are, from the page
   * itself. Only an Intercom page says; a concepts.jamf.com page's editions
   * are addressed by the locale code its path starts with.
   */
  editions?: IntercomEditions;
  /**
   * What the page is, for a note about its editions to name: an article, or
   * a support.jamf.com collection, read as the list of its articles.
   */
  kind: 'article' | 'collection';
}

/**
 * A page that only sends a reader on to another page of its source, and
 * where, in the source's spelling: what is kept of it in place of a parse,
 * since the page it names is read in its place (`refreshTarget` in
 * static-article-service.ts).
 */
export interface CachedStaticRedirect {
  movedTo: string;
}

/** What is kept of the page at one url. */
export type CachedStaticPage = CachedStaticArticle | CachedStaticRedirect;

export function isStaticRedirect(page: CachedStaticPage): page is CachedStaticRedirect {
  return 'movedTo' in page;
}

/** The key the page at `url`, in the source's spelling, is kept under. */
export function staticArticleKey(source: StaticDocSource, url: string): CacheKey {
  return cacheKey('static-article-v3', { source: source.id, url });
}

/**
 * What is kept of an Intercom Help Center page read from `url`: an article,
 * or a collection, read as the list of its articles.
 *
 * Every url in it goes out in the spelling `jamf_docs_get_article` reports
 * and fetches (`canonicalStaticUrl`): the page's own, which Intercom spells
 * raw where the slug is not ASCII, and each related article's, which it
 * spells the same way (46 of the 193 listed by the 40 articles sampled on
 * 2026-09-28).
 */
export function intercomPageEntry(page: IntercomPage, source: StaticDocSource, url: string): CachedStaticArticle {
  const { editions } = page;
  return {
    kind: page.kind,
    title: page.title,
    parsed: {
      title: page.title,
      content: page.content,
      breadcrumb: page.breadcrumb,
      relatedArticles: (page.relatedArticles ?? []).flatMap(related => {
        const href = linkedUrl(related.url, url);
        return href !== undefined ? [{ title: related.title, url: href }] : [];
      }),
    },
    // The page's own address, which is not `url` when the site answered
    // `url` with another page: the en edition, for a locale the page has
    // none in, or the article under its current slug.
    displayUrl: editions !== undefined ? canonicalStaticUrl(source, editions.url) : url,
    ...(page.lastUpdated !== undefined ? { lastUpdated: page.lastUpdated } : {}),
    ...(editions !== undefined ? { editions } : {}),
  };
}

/**
 * A url a page links to, resolved against the page's own, in its source's
 * spelling where it is on a static source's host, and as given elsewhere.
 * Undefined for one that cannot be read as a url.
 */
function linkedUrl(href: string, page: string): string | undefined {
  let url: URL;
  try {
    url = new URL(href, page);
  } catch {
    return undefined;
  }
  const owner = staticSourceForHostname(url.hostname);
  return owner !== undefined ? canonicalStaticUrl(owner, url.toString()) : url.toString();
}
