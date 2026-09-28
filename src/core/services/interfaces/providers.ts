/**
 * Optional data-source provider interfaces
 *
 * These interfaces allow external projects to inject custom backends
 * (e.g., Vectorize search, R2 article storage, D1 glossary database)
 * without modifying core tool handlers.
 *
 * Each provider method returns `T | null`:
 * - Non-null: the provider handled the request; core uses this result.
 * - null: fall through to the default implementation.
 *
 * What core tolerates. Each answer is checked against these types where it
 * enters core (services/provider-results.ts, and provider-maps.ts for maps),
 * before anything reads it: a provider built on untyped rows can return what
 * TypeScript cannot see, such as a database `NULL`, or a number where a
 * string belongs.
 * - An optional field that is not of its declared type, `null` included, is
 *   read as absent, on every channel.
 * - A row of a list that lacks a field it needs is left out, and the rest are
 *   used. Where a Fluid Topics row has a stand-in for the field, such as
 *   "Untitled" for a title, the row gets that instead. Each interface below
 *   says which, and which of the answer's counts describe the rows.
 * - An answer core cannot use as a whole, `undefined` included, is read as
 *   `null`, and the default implementation answers. So is a non-empty list
 *   whose every row is left out; an empty one is the provider's own answer.
 * None fails the reply; until 2026-09-28 one such field could fail it. Each
 * is logged, except for maps (see {@link MapsProvider}): an optional field
 * that is `null`, which is how a database row says "absent", at debug, and
 * everything else as a warning. Keys a type does not declare are left as they
 * are.
 *
 * A TocProvider, ArticleProvider or GlossaryProvider that throws or rejects
 * fails the call, and the reply quotes the error's message (or the string it
 * rejected with), with file paths and stack traces removed, on one line and
 * cut to 200 characters, or says no reason was given. That holds whatever it
 * throws: an HttpError, a SyntaxError or a TimeoutError of the provider's own
 * is quoted by its message, not described as a request of this server's, and
 * an HttpError's url is cut with the rest. A GlossaryUnavailableError is
 * quoted the same way, not as the glossary's own outage message. It reaches
 * the MCP client, so it must not carry anything a client should not see.
 * Until 2026-09-28 the reply quoted it whole, line breaks included, and the
 * TOC resource with file paths and stack lines too. {@link SearchProvider}
 * and {@link MapsProvider} say what a throw of theirs does.
 */

import type { ProductId, LocaleId } from '../../constants.js';
import type {
  SearchParams,
  SearchResult,
  GlossaryLookupResult,
  FetchArticleResult,
  FetchArticleOptions,
  FetchTocResult,
  FetchTocOptions,
  FtMapInfo,
} from '../../types.js';

/**
 * Custom search backend (e.g., Vectorize semantic search).
 *
 * A result without a `url` string is left out, and so, since 2026-09-28, is
 * one whose url is blank or not an absolute https URL, which markdown lists as
 * a link to nowhere. One without a `title` string is titled "Untitled", one
 * without a `snippet` string gets the title and product as its snippet, and
 * one without a `product` string has none (`null`), as a Fluid Topics result
 * would. A `docType` that is not one of the document type ids is read as
 * absent. An answer that is not an array, or whose every result is left out,
 * is read as `null`, so Fluid Topics answers; return `[]` for "no results".
 * See the module comment for the rest.
 *
 * A result's `title`, `snippet`, `mapTitle` and `breadcrumb` are plain text,
 * not HTML, and core does not decode them: structuredContent and the JSON
 * text carry them as they are, the MCP App shows them as text, and markdown
 * escapes them. Since 2026-09-28 that escaping covers a `<` and an `&` that
 * starts a named character reference too, so a `<b class=hit>` or `&amp;` in
 * a snippet reads as the characters it is written with. Before, a markdown
 * renderer read such a tag (one with an unquoted attribute) as HTML, and
 * `&amp;` as "&". A backend that holds HTML excerpts should return their
 * text, the tags stripped and each character reference decoded once, as the
 * Fluid Topics path does (`cleanSnippet`). Markdown escapes the `product`,
 * `version` and `otherVersions` too, which it wrote as they came until
 * 2026-09-28. And since that day it writes each of these on one line: a line
 * break or tab, with the spaces around it, is one space, and the other
 * control characters and the bidi marks and overrides are dropped.
 *
 * Return all matched results as a flat array, in the order you rank them:
 * the core keeps that order, and a JSON reply says the configured search
 * backend ranked it. The core handles version deduplication, pagination,
 * token truncation, and filter relaxation.
 *
 * Versions are collapsed by the rule Fluid Topics results follow
 * (`dedupeResultsToLatestVersions`). Of a topic you return at several
 * versions, the newest is kept, or the requested `version` when the topic has
 * it, and results at its other versions are dropped. The first-ranked result
 * kept takes the place of the topic's first result, so your ranking is kept
 * topic by topic, and lists the versions dropped in its `otherVersions`,
 * newest first. Only versions are collapsed: several results for a topic at
 * one version (passages of one page, its `#fragment` and `?query` variants,
 * or one page Jamf lists under several breadcrumbs) all come back as you
 * returned them, where the Fluid Topics path keeps one entry per topic
 * (`mapId` + `contentId`). So do results that name each topic at one
 * version, including any `otherVersions` you set.
 *
 * The topic and version are read from what a Fluid Topics result carries: a
 * learn.jamf.com (or docs.jamf.com) `url` in the `/r/{locale}/{bundle}/{slug}`
 * or `/{locale}/bundle/{bundle}/page/{slug}.html` form, or
 * `/r/{locale}/{bundle}` for a whole publication, and `version`, or else a
 * version number in the url's bundle (`jamf-pro-documentation-11.31.0`). A
 * result whose version cannot be read that way is never merged or dropped.
 * That includes one that has only a `-current` url, because Jamf's unversioned
 * publications (Jamf Connect's current documentation, the technical papers)
 * are published there too.
 *
 * Return `null` to fall through to the default Fluid Topics API search.
 *
 * A `search` that throws or rejects fails the call instead: since 2026-09-28
 * `jamf_docs_search` answers it with `isError`, and does not ask Fluid Topics
 * in its place, because an answer from another backend would hide a broken
 * one. Before, it answered "No results found". The reply quotes the error's
 * message (or the string it rejected with), with file paths and stack traces
 * removed, on one line and cut to 200 characters, whatever it throws, an
 * HttpError or a SyntaxError of its own included. That message reaches the
 * MCP client, where it was only logged before, so it must not carry anything
 * a client should not see.
 */
export interface SearchProvider {
  search: (params: SearchParams) => Promise<SearchResult[] | null>;
}

/**
 * Custom article provider (e.g., R2 local storage).
 * Return null to fall through to the default Fluid Topics API fetch.
 *
 * An article without a `title`, `content` or `url` string, or without a
 * well-typed `tokenInfo` and `sections`, is read as `null`: `getArticle` is
 * asked next, then Fluid Topics.
 *
 * Primary method is `getArticleByIds` — in the FT world, ID-based access
 * is the fast path (mapId + contentId are always resolved first).
 * The optional `getArticle` method provides a URL-based fallback.
 *
 * A provider changes where an article comes from, not which of the caller's
 * arguments decide or what the caller is told about them: the pair decides,
 * the caller's or the one core resolved the url to, as it does without a
 * provider (see `getArticle`), and core ends the reply with the note it would
 * end it with without one (see `ArticleProviderOptions.noteFor`). The `mapId`
 * and `contentId` an article carries are kept; the ones core asked for fill in
 * only when it carries none.
 */
export interface ArticleProvider {
  /** ID-based fetch — primary method, used when mapId+contentId are known. */
  getArticleByIds: (
    mapId: string,
    contentId: string,
    options?: ArticleProviderOptions,
  ) => Promise<FetchArticleResult | null>;

  /**
   * Optional URL-based fallback, asked when `getArticleByIds` returns null and
   * the call has a url.
   *
   * The article returned here is used only when it is the one core would
   * fetch without a provider: when it carries a `mapId` and `contentId` equal
   * to the pair `getArticleByIds` was just asked for, the caller's or the one
   * the url resolved to. One that carries neither cannot be checked, and is
   * used only when the url alone chose that pair: no pair from the caller, and
   * no `language` that moved the lookup to another locale. Otherwise the call
   * goes on to Fluid Topics by the pair.
   *
   * A url does not always name the pair's topic. Two topics can share one:
   * the LAPS technical paper publishes "Use LAPS" and its child at the same
   * `…/Using_LAPS`. A topic keeps its `contentId` from one Jamf Pro version to
   * the next, so only the `mapId` tells an older version's pair from the
   * `-current` url's page. And `language` names another locale's topic.
   */
  getArticle?: (
    url: string,
    options?: ArticleProviderOptions,
  ) => Promise<FetchArticleResult | null>;
}

/**
 * The options core passes an {@link ArticleProvider}: the caller's, and what
 * core will say about how the call was resolved.
 */
export interface ArticleProviderOptions extends FetchArticleOptions {
  /**
   * The note core ends this reply with, given the address the article is
   * labelled with, its place in the TOC and the language it is in; `undefined`
   * for none. It says when one of the caller's arguments went unused: a url
   * the pair overruled, or a `language` that could not apply. And it names
   * the edition a url's article is when that is not the page the url names in
   * the language asked for, from its `contentLocale`, or, when it has none,
   * from its own address.
   *
   * Pass the article's `contentLocale` with its url and navigation. The key
   * is optional, so a call written before 2026-09-28 still compiles, but
   * without it the note reads the language off the address alone, and for an
   * article labelled with the caller's url and no navigation it says the
   * language is not known, while the note core writes from the article itself
   * names it: the reply then carries both. Only one of the tool's locale ids
   * (`SUPPORTED_LOCALES`, such as `ja-JP`) counts as a language, compared
   * exactly with `language`; `ja`, `en` or `''` says nothing.
   *
   * Only core can decide it, because it depends on things a provider is not
   * told: the caller's url, and whether the pair came from the caller or from
   * resolving that url. It is the `noteFor` `fetchArticleFromFt` takes, so a
   * provider that renders through it passes the options on and the note is
   * charged to `maxTokens` with the body. A provider that renders its own reply
   * and leaves the note out gets it added by core, and when the two do not fit
   * `maxTokens` together, core cuts the reply to make room for the note.
   *
   * The note belongs to one call. It depends on the caller's url and on
   * whether the caller gave the pair, so the same article gets another note,
   * or none, on another call. A reply rendered with it must not be cached
   * under a key that leaves those out: the next call would get this call's
   * note, and core cannot take a note back out of a reply. Cache the article
   * unrendered and render it per call, or render without `noteFor` and let
   * core add the note.
   *
   * Core adds the note only when the reply does not already contain it, and
   * never removes one. A provider that passes these options on and also
   * appends its own copy of the sentence prints it twice, so a provider that
   * passes `noteFor` on must drop any copy of its own.
   */
  noteFor?: (labelled: Pick<FetchArticleResult, 'url' | 'navigation' | 'contentLocale'>) => string | undefined;
}

/**
 * Custom glossary provider (e.g., D1 database).
 * Return null to fall through to the default Fluid Topics API glossary.
 *
 * An entry without a `term`, `definition` and `url` string is left out, and
 * so, since 2026-09-28, is one whose url is blank or not an absolute https
 * URL. `totalMatches` is reduced by the entries left out. An answer without an
 * `entries` array, a numeric `totalMatches` and a well-typed `tokenInfo`, or
 * whose every entry is left out, is read as `null`.
 */
export interface GlossaryProvider {
  lookup: (params: {
    term: string;
    product?: ProductId | undefined;
    language?: LocaleId | undefined;
    maxTokens?: number | undefined;
  }) => Promise<GlossaryLookupResult | null>;
}

/**
 * Custom table-of-contents provider (e.g., D1/R2 stored TOC).
 * Return null to fall through to the default TOC fetching.
 *
 * An entry without a `url` string is left out with its `children`, and so,
 * since 2026-09-28, is one whose url is blank or not an absolute https URL.
 * `pagination.totalItems`, which counts nested entries too, is reduced by
 * every entry left out; one without a `title` string is titled "Untitled".
 * An answer without a `toc` array and a well-typed `pagination` and
 * `tokenInfo`, or whose every top-level entry is left out, is read as `null`.
 */
export interface TocProvider {
  getTableOfContents: (
    product: ProductId,
    version: string,
    options?: FetchTocOptions,
  ) => Promise<FetchTocResult | null>;
}

/**
 * Custom maps provider (e.g., KV storage on Workers).
 * When present, MapsRegistry uses this instead of the FT API fetchMaps().
 *
 * A map without an `id` string is left out, and so is a metadata entry
 * without a `key` string and a `values` array of strings. An answer that is
 * not an array, `null` and `undefined` included, or whose every map is left
 * out, is read as none: the registry fetches the maps from learn.jamf.com, as
 * it does without a MapsProvider. The registry keeps no logger, so none of
 * this is logged.
 *
 * A `getMaps` that throws or rejects is not answered from learn.jamf.com
 * instead: a reply that needs the maps fails, `jamf_docs_list_products` lists
 * what it can without them and says so, and `jamf://products` and
 * `jamf://products/{productId}/versions` answer with the compiled-in product
 * list and versions, with no message. The failed reply, the TOC resource's
 * error, and `jamf_docs_list_products`' note name the configured maps
 * provider and quote the error's message (or the string it rejected with),
 * with file paths and stack traces removed, on one line and cut to 200
 * characters, or say it gave no reason. It reaches the MCP client, so it
 * must not carry anything a client should not see. Until 2026-09-28 the
 * glossary and `jamf_docs_list_products` named learn.jamf.com instead, and
 * `jamf_docs_get_toc`, `jamf_docs_get_article`,
 * `jamf_docs_batch_get_articles` and the TOC resource quoted the message as
 * it was, the resource with file paths and stack lines included.
 */
export interface MapsProvider {
  getMaps: () => Promise<FtMapInfo[]>;
}
