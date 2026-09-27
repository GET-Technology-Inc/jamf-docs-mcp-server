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
