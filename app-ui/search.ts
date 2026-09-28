/**
 * The search view's other-source list, and what it shows for a search with no
 * results.
 *
 * Until 2026-09-28 the server dropped the other-source matches from a search
 * with no results, so the empty view never had any to show, and it said
 * "Nothing matched" as though nothing anywhere had. For a query the product
 * documentation has nothing on, those matches can be the whole answer: live,
 * Fluid Topics had no result for "jamformer", which is the title of a
 * concepts.jamf.com page.
 *
 * It also holds what paging needs: the arguments for the next page, and the
 * note for a page that was cut. What running a suggestion needs: the
 * arguments that search for it. And what opening a result needs: the
 * arguments that fetch that result's own article, which a table-of-contents
 * row is opened with too.
 *
 * Kept out of app.ts so it can be tested on its own, as toc.ts is: importing
 * app.ts runs its top-level wiring and throws outside a browser.
 */

import { esc } from './escape.js';

/** One other-source match, as `structuredContent.otherSources` carries it. */
export interface OtherSourceHit {
  title: string;
  url: string;
  source: string;
}

/** The part of the search payload the empty view reads. Unvalidated, like all of it. */
export interface NoResultsView {
  suggestions?: unknown;
  otherSources?: unknown;
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

/** The well-formed matches in `value`. A malformed one is skipped, not escaped into a crash. */
function hitsOf(value: unknown): OtherSourceHit[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return (value as unknown[]).filter((hit): hit is OtherSourceHit => {
    if (typeof hit !== 'object' || hit === null) {
      return false;
    }
    const { title, url, source } = hit as Record<string, unknown>;
    return text(title) && text(url) && text(source);
  });
}

/** How many well-formed matches `otherSources` carries. */
export function otherSourceCount(otherSources: unknown): number {
  return hitsOf(otherSources).length;
}

/**
 * The other-source matches as their own group, no more than `cap` of them,
 * or nothing when there are none.
 *
 * Titled "Elsewhere", apart from the results: the server does not rank them
 * against the results, and two of the three sources are not product
 * documentation.
 */
export function renderElsewhere(otherSources: unknown, cap = Number.POSITIVE_INFINITY): string {
  const hits = hitsOf(otherSources).slice(0, cap);
  if (hits.length === 0) {
    return '';
  }
  return `<section class="group">
          <h2 class="group-title">Elsewhere</h2>
          <ol class="list list-hits">${hits
            .map(
              (s) => `
              <li><a class="hit" href="${esc(s.url)}" data-external>
                <span class="hit-title">${esc(s.title)}</span>
                <span class="hit-meta">${esc(s.source)}</span>
              </a></li>`,
            )
            .join('')}</ol>
        </section>`;
}

/**
 * The view of a search the product documentation had nothing for, below its
 * header, with no more than `cap` of what other sites matched.
 *
 * Suggestions are runnable queries, so they get the same shape as a result.
 * The design before that rendered them as inline links in a sentence, which
 * made prose advice ("try fewer keywords") look identical to a query.
 *
 * What other sites matched is shown in either display mode. With results, an
 * inline panel leaves it out to save room for them; here there are none, and
 * it can be all that matched. The notice then says where nothing matched,
 * since something did.
 *
 * With no suggestion to run, the notice gives no advice. Until 2026-09-28 it
 * said "Try a broader query", which does not help on Fluid Topics: it finds a
 * page with any one word of a query that has no phrase in double quotes and
 * no word marked `+` or `-`, so fewer words find nothing more. Live that
 * day, in en-US, `xyzzyq` had no results and no suggestions, so the panel
 * told it to broaden, and `certificate xyzzyq` had the 2,768 of
 * `certificate`. The server's advice for the query is prose for the model,
 * and is not in `structuredContent`.
 */
export function renderNoResults(view: NoResultsView, cap = Number.POSITIVE_INFINITY): string {
  const suggestions = Array.isArray(view.suggestions) ? (view.suggestions as unknown[]).filter(text) : [];
  const tips =
    suggestions.length > 0
      ? `<ol class="list list-hits">${suggestions
          .map(
            (s) =>
              `<li><button class="hit" data-search="${esc(s)}">`
              + `<span class="hit-title">${esc(s)}</span></button></li>`,
          )
          .join('')}</ol>`
      : '';
  const elsewhere = renderElsewhere(view.otherSources, cap);
  const nothing = elsewhere === '' ? 'Nothing matched.' : 'Nothing matched in the product documentation.';
  return `
      <p class="notice">${nothing}${tips === '' ? '' : ' Try one of these:'}</p>
      ${tips}
      ${elsewhere}`;
}

/**
 * The filters a search ran under, as the server echoes them back, or none
 * when the payload's are not an object: it is cast, not validated (see
 * `classify` in app.ts).
 */
function filtersOf(view: { filters?: unknown }): Record<string, unknown> {
  const { filters } = view;
  return typeof filters === 'object' && filters !== null && !Array.isArray(filters)
    ? filters as Record<string, unknown>
    : {};
}

/**
 * The `jamf_docs_search` arguments that run a suggestion from a search with
 * no results: the suggestion, in the language the search ran in.
 *
 * A suggestion is made for that language: a query's Chinese and Japanese
 * words are suggested only in a language whose documentation has them (see
 * `generateSearchSuggestions`). Until 2026-09-28 it ran as `{ query }`, to
 * which the App added the host's language, or none. Live that day, the zh-TW
 * search "磁碟 加密 復原 金鑰 託管" (Jamf Pro 10.1.0) had no results and
 * suggested "磁碟 加密 復原", which has 50 results in zh-TW and none in en-US,
 * so on an en-US host the suggestion found nothing too.
 *
 * The search's other filters are not sent: a suggestion is a broader search,
 * as it always was.
 */
export function suggestionArgs(view: { filters?: unknown }, suggestion: string): Record<string, string> {
  const { language } = filtersOf(view);
  return { query: suggestion, ...(text(language) ? { language } : {}) };
}

/** A result too large for the budget on its own, as its page shows it. */
export interface SearchTruncatedResult {
  title: string;
  /** What the whole result costs, in tokens. */
  estimatedTokens: number;
}

/** The part of the search payload paging reads. Unvalidated, like all of it. */
export interface SearchPaging {
  query: string;
  /** The filters the search ran under, echoed back by the server. */
  filters?: unknown;
  page: number;
  /** Page size. */
  limit?: number;
  /** False when there is no next page to ask for, even below `totalPages`. */
  hasMore?: boolean;
  /** The budget this page was cut to. Older servers do not send it. */
  maxTokens?: number;
  /** Present when this page is one result cut to fit. */
  truncatedResult?: SearchTruncatedResult;
}

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

/**
 * The arguments that fetch the page after this one, or null when there is no
 * next page to ask for.
 *
 * Everything that decides where this page ends goes back: the filters, which
 * decide what is paged through, and `limit` and `maxTokens`, which decide
 * where each page ends. A page holds as many whole results as fit
 * `maxTokens`, and at most `limit`, so the next page starts right after this
 * one only when it is asked for with both the same. This view used to send
 * the filters, `limit` and the page, so a search the model had run at
 * `maxTokens: 1000` continued at the default 5000, from wherever the
 * default's pages begin: on 2026-09-28, page 1 of "enrollment" at 1000 held
 * its first 8 results, and page 2 at 5000 starts at the 11th.
 *
 * `hasMore` is false on the last page `page` accepts even when there are
 * more; asking past it is a validation error.
 */
export function nextSearchPageArgs(view: SearchPaging): { name: string; args: Record<string, unknown> } | null {
  if (view.hasMore === false) {
    return null;
  }
  const filters = filtersOf(view);
  const limit = count(view.limit);
  const maxTokens = count(view.maxTokens);
  return {
    name: 'jamf_docs_search',
    args: {
      ...filters,
      ...(limit !== undefined ? { limit } : {}),
      query: view.query,
      page: view.page + 1,
      ...(maxTokens !== undefined ? { maxTokens } : {}),
    },
  };
}

/**
 * The note for a page that is one result cut to fit, or nothing.
 *
 * The reader of the panel does not set `maxTokens`, so this says what the page
 * leaves out and what the whole result needs; the model reads the text
 * channel, which says what budget to ask for.
 */
export function searchBudgetNote(view: SearchPaging): string | undefined {
  // Read as unknown: the payload is only cast to this shape, not checked.
  const raw: unknown = view.truncatedResult;
  if (typeof raw !== 'object' || raw === null) {
    return undefined;
  }
  const cut = raw as Partial<Record<keyof SearchTruncatedResult, unknown>>;
  const needs = count(cut.estimatedTokens);
  const name = text(cut.title) ? `“${cut.title}”` : 'This result';
  return `${name} is too long for the token budget this page was given: its snippet is cut.${
    needs !== undefined ? ` The whole result needs ${String(needs)} tokens.` : ''
  }`;
}

/**
 * What `jamf_docs_get_article` accepts as a `mapId` or `contentId`. Anything
 * else would fail the call with a validation error, so it is not sent.
 */
const FT_ID = /^[\w~-]{1,200}$/;

function ftId(value: unknown): value is string {
  return typeof value === 'string' && FT_ID.test(value);
}

/** The locale in a learn.jamf.com url's path, `/r/en-US/…` or `/en-US/bundle/…`. */
function urlLocale(url: string): string | undefined {
  try {
    return /^\/(?:r\/)?([a-z]{2}-[A-Z]{2})(?:\/|$)/.exec(new URL(url).pathname)?.[1];
  } catch {
    return undefined;
  }
}

/**
 * The attributes that carry a search result's or a table-of-contents entry's
 * `mapId` + `contentId` pair to the click that opens it (see
 * {@link articleArgs}), or nothing when it has no pair to send.
 */
export function hitIdAttributes(hit: { mapId?: unknown; contentId?: unknown }): string {
  const { mapId, contentId } = hit;
  return ftId(mapId) && ftId(contentId)
    ? ` data-map-id="${esc(mapId)}" data-content-id="${esc(contentId)}"`
    : '';
}

/**
 * The `jamf_docs_get_article` arguments that open a search result or a
 * table-of-contents entry: its url, and its `mapId` + `contentId` pair when
 * it has one.
 *
 * Until 2026-09-28 both were opened by their url alone. Jamf publishes some
 * different topics at one url, and the url fetches only one of them, so every
 * other result or entry at that url opened the wrong article: live that day,
 * `/r/en-US/technical-articles/Additional_Information` opened the section of
 * "Jamf Pro External Patch Source Endpoints" from any of the 19 results there,
 * and the LAPS paper's "Use LAPS" opened its child "Using LAPS in the Jamf Pro
 * API". With the pair, learn.jamf.com fetches the pair's topic.
 *
 * Except in another language. The panel opens an article in the host's
 * language (`language`), and on a url that fetches the page in that language;
 * a pair names a topic of one map, which is in one language, and the server
 * ignores `language` for it. So a result or entry in another language than
 * the host's is opened by its url alone, as before, and the reader still gets
 * the page in theirs.
 */
export function articleArgs(
  hit: { url: string; mapId?: string | undefined; contentId?: string | undefined },
  language: string | undefined,
): Record<string, string> {
  const { url, mapId, contentId } = hit;
  if (!ftId(mapId) || !ftId(contentId) || (language !== undefined && language !== urlLocale(url))) {
    return { url };
  }
  return { url, mapId, contentId };
}
