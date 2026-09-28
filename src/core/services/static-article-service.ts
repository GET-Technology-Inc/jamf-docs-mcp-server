/**
 * Article retrieval for documentation sources outside Fluid Topics.
 *
 * The Fluid Topics path addresses a topic by `mapId` + `contentId` and gets
 * an HTML fragment back. A static site has neither: the address is the URL,
 * and the response is a whole page whose navigation has to be stripped before
 * anything else. Everything downstream of that — sections, summaries,
 * truncation — is shared with the FT path through
 * {@link buildArticleView}, so the two cannot drift on what a caller sees.
 */

import { parseArticle } from './content-parser.js';
import { buildArticleView, type ArticleViewOptions } from './article-view.js';
import { extractSections } from './tokenizer.js';
import type { CacheKey } from './cache-key.js';
import { loadOnce } from './load-once.js';
import {
  intercomPageEntry,
  isStaticRedirect,
  staticArticleKey,
  type CachedStaticArticle,
  type CachedStaticPage,
  type CachedStaticRedirect,
} from './static-article-cache.js';
import { DEFAULT_LOCALE, TOKEN_CONFIG } from '../constants.js';
import { canonicalStaticUrl, staticLocaleId, type StaticDocSource } from '../constants/sources.js';
import type { ServerContext } from '../types/context.js';
import { JamfDocsError, JamfDocsErrorCode } from '../types.js';
import type { FetchArticleOptions, FetchArticleResult } from '../types.js';
import { HttpError } from '../http-client.js';
import { logUnreadBlocks, parseIntercomPage, rememberCollectionToc } from './intercom-service.js';
import { NO_REASON_GIVEN } from './failure-reason.js';
import { describeFetchFailure, isRequestFailure, reasonGiven } from '../utils/fetch-failure.js';

// Exported from here until #338 moved it next to the registry it reads.
// `./core/*` is a published path, so an embedder's import of it from here
// keeps resolving.
export { canonicalStaticUrl };

/**
 * The page's own title, preferring Open Graph over `<title>`.
 *
 * `<title>` on these sites carries a site-name suffix ("API Utility | Jamf
 * Concepts"); `og:title` is the same string without it, so it is tried first
 * and the suffix trimmed only as a fallback.
 */
export function extractDocumentTitle(html: string): string | undefined {
  const og = /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i.exec(html)
    ?? /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i.exec(html);
  if (og?.[1] !== undefined && og[1].trim() !== '') { return decodeEntities(og[1].trim()); }

  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  if (title?.[1] === undefined) { return undefined; }
  const trimmed = title[1].split('|')[0]?.trim() ?? '';
  return trimmed !== '' ? decodeEntities(trimmed) : undefined;
}

/**
 * Where a page that only sends a reader on to another sends them: the page
 * its `<meta http-equiv="refresh">` names, in the source's spelling.
 * Undefined for a page with no such tag, or whose tag names no url, the page
 * itself, or a page on another host, which is not followed.
 *
 * concepts.jamf.com answers each of the 98 paths its sitemap lists under
 * `en`, asked for without the code (`/guides/ai-governance/`), with such a
 * page (live, 2026-09-28): a 200 whose refresh, and whose
 * `<link rel="canonical">`, name the en page
 * (`/en/guides/ai-governance`), titled "Redirecting..." and saying only
 * "Redirecting to /en/guides/ai-governance...". It is the page a Next.js
 * static export writes for a redirect, which a browser follows at once and
 * a server's request does not.
 */
function refreshTarget(html: string, source: StaticDocSource, url: string): string | undefined {
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    if (attributeOf(tag, HTTP_EQUIV)?.trim().toLowerCase() !== 'refresh') { continue; }
    // `<delay>;url=<url>`, `<delay>; URL='<url>'` or `<delay>,<url>`. A
    // delay alone reloads the page itself.
    const content = attributeOf(tag, CONTENT) ?? '';
    const separator = content.search(/[;,]/);
    if (separator === -1) { continue; }
    let target = content.slice(separator + 1).trim().replace(/^url\s*=/i, '').trim();
    if (target.length > 1 && (target.startsWith('"') || target.startsWith("'")) && target.endsWith(target.charAt(0))) {
      target = target.slice(1, -1).trim();
    }
    if (target === '') { continue; }
    let next: URL;
    try {
      next = new URL(target, url);
    } catch {
      continue;
    }
    if (next.hostname !== source.hostname) { return undefined; }
    const spelled = canonicalStaticUrl(source, next.toString());
    return spelled !== url ? spelled : undefined;
  }
  return undefined;
}

const HTTP_EQUIV = /\shttp-equiv\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i;
const CONTENT = /\scontent\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i;

/** An attribute's value in one tag, entities decoded, or undefined where the tag has none. */
function attributeOf(tag: string, attribute: RegExp): string | undefined {
  const match = attribute.exec(tag);
  return match === null ? undefined : decodeEntities(match[1] ?? match[2] ?? match[3] ?? '');
}

const TITLE_ENTITIES: Readonly<Record<string, string>> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'",
};

/**
 * The handful of entities that survive into a title attribute, decoded in one
 * pass. Chained replaces decoded `&amp;` first and then read its output again,
 * so a page writing the literal text "&lt;" (`&amp;lt;`) got "<" (CodeQL
 * js/double-escaping, alert #13, open since 2026-09-02).
 */
function decodeEntities(text: string): string {
  return text.replace(/&(?:amp|lt|gt|quot|#39|#x27);/g, entity => TITLE_ENTITIES[entity] ?? entity);
}

/**
 * Fetch and parse one article from a static documentation source.
 *
 * `options.locale` picks the edition, as `language` does on learn.jamf.com:
 * the locale's edition of the page `url` names, where the site publishes
 * one, and otherwise that page, with a note saying which edition it is (see
 * {@link servedEdition}). Until 2026-09-28 it was not read, and a
 * concepts.jamf.com or support.jamf.com url was served as it was whatever
 * `language` said, with no note.
 *
 * A page that only redirects to another is read as that page, which a
 * browser shows ({@link refreshTarget}), and labelled with its url. Until
 * 2026-09-28 it was served as it was: a concepts.jamf.com url with no locale
 * code came back titled "Redirecting...", with a one-line body. The site
 * root, whose only text is "Loading...", is read as the root of the edition
 * `language` asks for, en by default ({@link rootEdition}).
 *
 * @param source the registry row for the hostname in `url`
 * @param options `note` is one line to end the reply with, within `maxTokens`,
 *   before any about the language
 */
export async function fetchStaticArticle(
  ctx: ServerContext,
  source: StaticDocSource,
  url: string,
  options: FetchArticleOptions & Pick<ArticleViewOptions, 'note'> = {},
): Promise<FetchArticleResult> {
  const maxTokens = options.maxTokens ?? TOKEN_CONFIG.DEFAULT_MAX_TOKENS;
  // One spelling for the fetch, the cache key and the reported `url`, so
  // either spelling a caller passes is one request to the form the site
  // serves, one cache entry, and one name for the page.
  const asked = canonicalStaticUrl(source, url);
  // A fragment names a place in the page, not which page it is: it goes on
  // the label below, and not into the request or the cache key. Until
  // 2026-09-28 it went into both, so each fragment of one url was a request
  // and a cache entry of its own.
  const { page, note, edition } = await servedEdition(ctx, source, withoutFragment(asked), options.locale);
  const notes = [options.note, note].filter((line): line is string => line !== undefined);
  const contentLocale = servedLocale(source, page);
  return renderStaticArticle(
    page, source, { ...options, note: notes.length > 0 ? notes.join(' ') : undefined }, maxTokens, {
      // A fragment names a place in the page the url names, and it is kept on
      // that page's label as it always was. Another edition's headings have
      // ids of their own (support.jamf.com's `h_…` differ between the en, ja
      // and fr editions of an article, 2026-09-28), so its label has none.
      url: edition === true ? page.displayUrl : withFragmentOf(page.displayUrl, asked),
      ...(contentLocale !== undefined ? { contentLocale } : {}),
    },
  );
}

/** What is cached of the page at `url`, in the source's spelling, or that page read. */
async function readPage(ctx: ServerContext, source: StaticDocSource, url: string): Promise<CachedStaticPage> {
  const key = staticArticleKey(source, url);
  // One request for the page however many calls want it at once (load-once.ts).
  return await loadOnce(ctx.cache, key, async () => await readStaticArticle(ctx, source, url, key));
}

/**
 * The cached parse of the page at `url`, in the source's spelling, or that
 * page read: or of the page it redirects to, where it only redirects
 * ({@link refreshTarget}). One redirect is followed, which is all a live
 * page makes, and a page it names that redirects again is an error.
 */
async function loadPage(ctx: ServerContext, source: StaticDocSource, url: string): Promise<CachedStaticArticle> {
  const read = await readPage(ctx, source, url);
  if (!isStaticRedirect(read)) { return read; }
  const target = await readPage(ctx, source, read.movedTo);
  if (!isStaticRedirect(target)) { return target; }
  throw new JamfDocsError(
    `Could not read a ${source.name} page at ${url}: it redirects to ${read.movedTo}, which redirects again.`,
    JamfDocsErrorCode.PARSE_ERROR,
    url,
  );
}

/** What asking for another edition of a page came to. */
type EditionRead =
  | { status: 'read'; page: CachedStaticArticle }
  /** The site answered that there is none: a 404. */
  | { status: 'missing' }
  /** Anything else: a 5xx after the retries, a timeout, a page that could not be parsed. */
  | { status: 'failed'; error: unknown };

/**
 * The page at `url`, another edition of the one a call named.
 *
 * Its failure is never the call's: the page the url names is served in its
 * place, with a note saying why (see {@link servedEdition}). Only that page's
 * own failure fails the call, as it did before editions were read.
 */
async function loadEdition(ctx: ServerContext, source: StaticDocSource, url: string): Promise<EditionRead> {
  try {
    return { status: 'read', page: await loadPage(ctx, source, url) };
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) { return { status: 'missing' }; }
    ctx.logger.createLogger('static-article').warning(
      `Could not read the edition at ${url}; serving the page the url names instead: ${whyUnread(error)}`,
    );
    return { status: 'failed', error };
  }
}

/** The page to serve, and the note that says it is not in the language asked for. */
interface ServedEdition {
  page: CachedStaticArticle;
  note?: string;
  /** Set when `page` is another edition than the page the url names. */
  edition?: true;
}

/**
 * The edition of the page at `asked` that a call in `requested` gets.
 *
 * The two sites address editions differently, both measured live on
 * 2026-09-28:
 *
 * - concepts.jamf.com puts an edition under its locale code: the sitemap
 *   lists the same 99 paths under each of its ten codes, so the ja edition of
 *   `/en/guides/ai-governance/` is `/ja/guides/ai-governance/`. It is
 *   requested directly, and the page `asked` names only if that one is a 404
 *   or cannot be read. A url under `ko` or `pl`, which no `language` value
 *   names, is an edition too (see `StaticDocSource.otherLocales`). A url
 *   under no code is a page that redirects to the en one
 *   ({@link refreshTarget}), which is then the page asked for, so it costs
 *   one request more than that page's url. The site root is read as the en
 *   edition's root without a request for it ({@link rootEdition}). An
 *   edition whose url redirects to another locale's page is not there.
 * - support.jamf.com keeps an article's Intercom id in every locale and gives
 *   each locale its own slug, so an edition's address is read off the page
 *   `asked` names, from its `localeLinks` (see `IntercomEditions`).
 *   Without `requested`, the locale the url names is the one asked for, as it
 *   is on learn.jamf.com: the site answers a `/ja/` url of an article with no
 *   ja edition with the en one, which used to be labelled with the `/ja/`
 *   url and not said.
 *
 * A locale the source does not publish in at all, th-TH on either site, gets
 * the page `asked` names without a request for anything else. So does a
 * locale the page has no edition in. Either way a note says which edition it
 * is, as `jamf_docs_get_toc`'s `localeNote` does for a TOC. An edition that
 * could not be read for another reason than a 404, a 5xx after the retries or
 * a timeout, gets that page too, with a note that says so: the call does not
 * fail on a page it was not asked for.
 */
async function servedEdition(
  ctx: ServerContext,
  source: StaticDocSource,
  asked: string,
  requested: string | undefined,
): Promise<ServedEdition> {
  if (source.parser === 'intercom') {
    return await listedEdition(ctx, source, asked, requested);
  }
  const root = rootEdition(source, asked);
  if (root !== undefined) { return await servedEdition(ctx, source, root, requested); }
  if (requested === undefined) { return { page: await loadPage(ctx, source, asked) }; }

  const own = pathLocale(source, asked);
  const wanted = source.locales[requested];
  if (own === undefined) {
    // A page that redirects to one under a locale code is that page, and its
    // editions are addressed from there, without reading it first.
    const read = await readPage(ctx, source, asked);
    if (isStaticRedirect(read) && pathLocale(source, read.movedTo) !== undefined) {
      return await servedEdition(ctx, source, read.movedTo, requested);
    }
    return {
      page: isStaticRedirect(read) ? await loadPage(ctx, source, asked) : read,
      note: notApplied(requested, `this url's path does not start with one of ${
        source.hostname}'s locale codes (${pathLocales(source).join(', ')})`),
    };
  }
  if (wanted === own) { return { page: await loadPage(ctx, source, asked) }; }
  const edition = wanted !== undefined
    ? await loadEdition(ctx, source, canonicalStaticUrl(source, withPathLocale(asked, wanted)))
    : { status: 'missing' as const };
  // The edition's url can redirect too, and the page it ends at is the one
  // that says which edition it is, as an Intercom page's `localeLinks` do
  // ({@link listedEdition}). Until 2026-09-28 an edition's url that
  // redirected to another locale's page was served as the edition, with no
  // note. None did that day: 18 sampled /en/, /ja/ and /ko/ pages, 6 each,
  // carried no refresh.
  if (edition.status === 'read' && pathLocale(source, edition.page.displayUrl) === wanted) {
    return { page: edition.page, edition: true };
  }
  const page = await loadPage(ctx, source, asked);
  return {
    page,
    note: edition.status === 'failed'
      ? unreadEdition(source, page, requested, own, edition.error)
      : otherEdition(source, page, requested, own),
  };
}

/** {@link servedEdition} for a source whose pages list their editions. */
async function listedEdition(
  ctx: ServerContext,
  source: StaticDocSource,
  asked: string,
  requested: string | undefined,
): Promise<ServedEdition> {
  const page = await loadPage(ctx, source, asked);
  const own = pathLocale(source, asked);
  const wanted = requested !== undefined ? source.locales[requested] : own;
  const wantedId = requested ?? (wanted !== undefined ? staticLocaleId(source, wanted) : undefined);
  if (wantedId === undefined) { return { page }; }
  const { editions } = page;
  if (editions === undefined) {
    // Nothing on the page says which edition it is, so the url's locale code
    // is taken at its word, as a concepts.jamf.com url's is.
    return requested === undefined || (wanted !== undefined && wanted === own)
      ? { page }
      : { page, note: notApplied(requested, 'the page does not list its editions') };
  }
  if (wanted === editions.locale) { return { page }; }

  const url = wanted !== undefined ? editions.editions[wanted] : undefined;
  if (url !== undefined && url !== null) {
    const edition = await loadEdition(ctx, source, canonicalStaticUrl(source, url));
    // The edition's own page says which it is: a url for a locale with no
    // edition is answered with the en one.
    if (edition.status === 'read' && edition.page.editions?.locale === wanted) {
      return { page: edition.page, edition: true };
    }
    if (edition.status === 'failed') {
      return { page, note: unreadEdition(source, page, wantedId, editions.locale, edition.error) };
    }
  }
  return { page, note: otherEdition(source, page, wantedId, editions.locale) };
}

/**
 * The root of the en edition, for the site root, `/`, of a source whose
 * pages sit under a locale code: undefined for any other url.
 *
 * concepts.jamf.com's root is not a page of its own (live, 2026-09-28): a
 * 10 KB shell whose script picks an edition in the browser, titled "Jamf
 * Concepts", whose only text is "Loading...", with no refresh to follow. Each
 * of the site's ten locale codes has a root of its own, `/en/` and `/ja/`
 * among them, which its sitemap lists, and every page's
 * `<link rel="canonical">` names `/en/`. Until 2026-09-28 the root was served
 * as that shell. No tool hands the root out: the sitemap, which search and
 * the tables of contents are read from, does not list it.
 */
function rootEdition(source: StaticDocSource, url: string): string | undefined {
  const parsed = new URL(url);
  const code = source.locales[DEFAULT_LOCALE];
  if (parsed.pathname !== '/' || code === undefined) { return undefined; }
  parsed.pathname = `/${code}/`;
  return canonicalStaticUrl(source, parsed.toString());
}

/** `url` with no fragment: the page it names, not a place in it. */
function withoutFragment(url: string): string {
  const parsed = new URL(url);
  parsed.hash = '';
  return parsed.toString();
}

/** Every locale code a url on `source` can start with: its table's, then its `otherLocales`. */
function pathLocales(source: StaticDocSource): string[] {
  return [...Object.values(source.locales), ...(source.otherLocales ?? [])];
}

/** The source's locale code a url's path starts with, when it starts with one. */
function pathLocale(source: StaticDocSource, url: string): string | undefined {
  const first = new URL(url).pathname.split('/')[1] ?? '';
  return pathLocales(source).includes(first) ? first : undefined;
}

/**
 * `url` with its first path segment, its locale code, replaced by `code`, and
 * no fragment: that names a place in the page `url` names (see
 * {@link fetchStaticArticle}).
 */
function withPathLocale(url: string, code: string): string {
  const parsed = new URL(url);
  const segments = parsed.pathname.split('/');
  segments[1] = code;
  parsed.pathname = segments.join('/');
  parsed.hash = '';
  return parsed.toString();
}

/** `label` with the fragment of `asked`, where `asked` has one. */
function withFragmentOf(label: string, asked: string): string {
  const { hash } = new URL(asked);
  if (hash === '') { return label; }
  const parsed = new URL(label);
  parsed.hash = hash;
  return parsed.toString();
}

/**
 * This server's id for the locale `page` is in, for `contentLocale`: the
 * edition the page lists as its own, or on a site whose pages list none, the
 * locale code its url starts with. Undefined where neither says, or for a
 * code no `language` value names (concepts.jamf.com's `ko`).
 */
function servedLocale(source: StaticDocSource, page: CachedStaticArticle): string | undefined {
  const code = source.parser === 'intercom' ? page.editions?.locale : pathLocale(source, page.displayUrl);
  return code !== undefined ? staticLocaleId(source, code) : undefined;
}

/** The edition a note says is served, by this server's id for its locale code. */
function editionShown(source: StaticDocSource, servedCode: string): string {
  const served = staticLocaleId(source, servedCode);
  return served !== undefined ? `the ${served} edition` : 'the page this url names';
}

/**
 * The note on a page served in another language than `requested`: the one
 * `jamf_docs_get_toc` puts in `localeNote`, about an article or a collection.
 */
function otherEdition(
  source: StaticDocSource,
  page: CachedStaticArticle,
  requested: string,
  servedCode: string,
): string {
  return `Jamf does not publish this ${page.kind} in ${requested}. Showing ${editionShown(source, servedCode)} instead.`;
}

/** The note on a page served in place of its `requested` edition, which could not be read. */
function unreadEdition(
  source: StaticDocSource,
  page: CachedStaticArticle,
  requested: string,
  servedCode: string,
  error: unknown,
): string {
  return `The ${requested} edition of this ${page.kind} could not be read (${whyUnread(error)}). ` +
    `Showing ${editionShown(source, servedCode)} instead.`;
}

/** Why an edition could not be read, in a few words: "HTTP 503 Service Unavailable", "the request timed out". */
function whyUnread(error: unknown): string {
  if (isRequestFailure(error)) { return describeFetchFailure(error); }
  if (error instanceof JamfDocsError && error.code === JamfDocsErrorCode.PARSE_ERROR) {
    return 'its page could not be parsed';
  }
  return reasonGiven(error) ?? NO_REASON_GIVEN;
}

/** The note on a page whose editions cannot be told from its url or its page. */
function notApplied(requested: string, reason: string): string {
  return `Language "${requested}" was not applied: ${reason}, so the page was served as the url names it.`;
}

/**
 * The cached parse of the page at `url`, or the page read, parsed and
 * stored: the load {@link fetchStaticArticle} shares between calls. For a
 * page that only redirects ({@link refreshTarget}), where it redirects to.
 *
 * Takes none of a call's options, so what one call loads is what any other
 * would. The related links are read whether or not the call asked for them,
 * as the Fluid Topics path reads them (article-service.ts), and the reply
 * shows them only to a call that did ({@link renderStaticArticle}). Until
 * 2026-09-28 they were read only for a call that asked, and the parse was
 * cached for `cacheTtl.article`, 24 hours by default, so a call that asked
 * after one that did not was served none. That day concepts.jamf.com's
 * RELATED selector matched nothing on a guide or a tool page. A
 * support.jamf.com article's are read from its page data since that day too
 * (`IntercomArticle.relatedArticles`).
 *
 * A support.jamf.com collection page is read for `jamf_docs_get_toc` too,
 * which keeps this entry when it reads the page first, as this keeps its
 * tree ({@link rememberCollectionToc}).
 */
async function readStaticArticle(
  ctx: ServerContext,
  source: StaticDocSource,
  url: string,
  key: CacheKey,
): Promise<CachedStaticPage> {
  const hit = await ctx.cache.get<CachedStaticPage>(key);
  if (hit !== null) { return hit; }

  const html = await ctx.http.getText(url);

  // An Intercom Help Center's body is a block list in `__NEXT_DATA__`, not
  // markup — no selector set can read it, so the parser is chosen per
  // source rather than per page.
  if (source.parser === 'intercom') {
    // An article, or a collection read as the list of its articles.
    const page = parseIntercomPage(html, source);
    if (page === null) {
      throw new JamfDocsError(
        `Could not read a ${source.name} article at ${url}`,
        JamfDocsErrorCode.PARSE_ERROR,
      );
    }
    logUnreadBlocks(ctx, url, page);
    const cached = intercomPageEntry(page, source, url);
    await ctx.cache.set(key, cached, ctx.config.cacheTtl.article);
    if (page.toc !== undefined) {
      await rememberCollectionToc(ctx, source, cached.displayUrl, page.toc);
    }
    return cached;
  }

  const movedTo = refreshTarget(html, source, url);
  if (movedTo !== undefined) {
    const moved: CachedStaticRedirect = { movedTo };
    await ctx.cache.set(key, moved, ctx.config.cacheTtl.article);
    return moved;
  }

  const documentTitle = extractDocumentTitle(html);
  const parsed = parseArticle(html, url, {
    // The source's own markup rules. Parsing a static page with Fluid
    // Topics' selectors finds no content wrapper and falls through to
    // <body>, which is the whole site chrome.
    selectors: source.selectors,
    // Root-relative links belong to this source, not learn.jamf.com.
    linkBase: source.baseUrl,
    includeRelated: true,
  });
  // `parseArticle` reads the first match for the source's TITLE selector
  // that survives cleaning. On a static site the page heading often lives
  // outside the content wrapper: concepts.jamf.com's tool pages put their
  // only <h1> in the stripped header, so every one of the 37 came back
  // "Untitled", and its TITLE is scoped to the article so that a guide's
  // hero <h1> is never taken as the title (see sources.ts). So most pages
  // there — 800 of 990, measured 2026-09-24 — reach this line with no title
  // of their own. The document's own title is the reliable answer when the
  // body has none; Fluid Topics never needs this because its titles arrive
  // as metadata.
  const title = parsed.title !== 'Untitled' ? parsed.title : documentTitle ?? parsed.title;
  const cached: CachedStaticArticle = { kind: 'article', title, parsed, displayUrl: url };
  await ctx.cache.set(key, cached, ctx.config.cacheTtl.article);
  return cached;
}

/**
 * Assemble the response from a parsed page, whichever parser produced it.
 *
 * @param shown the page's label, and the language its content is in where
 *   that is known ({@link servedLocale}). Until 2026-09-28 a static page
 *   carried no `contentLocale`, which only an `ArticleProvider` set.
 */
function renderStaticArticle(
  cached: CachedStaticArticle,
  source: StaticDocSource,
  options: FetchArticleOptions & Pick<ArticleViewOptions, 'note'>,
  maxTokens: number,
  shown: { url: string; contentLocale?: string },
): FetchArticleResult {
  const { title, parsed } = cached;

  // Provenance is part of the content, not metadata: it has to survive
  // section extraction and truncation, both of which slice `content`, and a
  // reader who asked for one section still needs to know what they are
  // reading.
  const content = source.provenance !== undefined
    ? `${parsed.content}\n\n---\n\n*${source.provenance}*\n`
    : parsed.content;

  const allSections = extractSections(content);

  return buildArticleView(
    {
      title,
      url: shown.url,
      product: source.name,
      ...(shown.contentLocale !== undefined ? { contentLocale: shown.contentLocale } : {}),
      ...(cached.lastUpdated !== undefined ? { lastUpdated: cached.lastUpdated } : {}),
      breadcrumb: parsed.breadcrumb.length > 0 ? parsed.breadcrumb : undefined,
      relatedArticles: options.includeRelated === true && parsed.relatedArticles.length > 0
        ? parsed.relatedArticles
        : undefined,
      sections: allSections,
    },
    content,
    options,
    maxTokens,
    allSections,
  );
}
