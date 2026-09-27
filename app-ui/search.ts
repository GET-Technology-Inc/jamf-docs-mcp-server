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
 * note for a page that was cut.
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
      <p class="notice">${nothing} ${tips === '' ? 'Try a broader query.' : 'Try one of these:'}</p>
      ${tips}
      ${elsewhere}`;
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
  const filters = typeof view.filters === 'object' && view.filters !== null && !Array.isArray(view.filters)
    ? view.filters as Record<string, unknown>
    : {};
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
