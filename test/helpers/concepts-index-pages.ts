/**
 * concepts.jamf.com's section index pages, `/{locale}/guides/` and
 * `/{locale}/concepts/`, written the way the site writes them: the listing
 * (`CONCEPTS_LISTINGS`) in the React Server Components payload a Next.js App
 * Router page pushes onto `self.__next_f`, a string at a time, with the rows
 * around it that a live page has and that name none of its pages.
 */

import { STATIC_DOC_SOURCES } from '../../src/core/constants/sources.js';
import { CONCEPTS_LISTINGS } from '../fixtures/concepts-listings.js';

const ORIGIN = STATIC_DOC_SOURCES['jamf-concepts'].baseUrl;

export type ListedLocale = keyof typeof CONCEPTS_LISTINGS;
export type IndexSection = 'guides' | 'concepts';

/** A section index page's URL, as the reader requests it. */
export function conceptsIndexUrl(code: string, section: IndexSection): string {
  return `${ORIGIN}/${code}/${section}/`;
}

/**
 * A page whose inline scripts push `payload` onto `self.__next_f` in pieces
 * of `piece` characters, cut wherever that falls, as the site's are.
 */
export function flightPage(payload: string, piece = 500): string {
  const pushes: string[] = ['<script>(self.__next_f=self.__next_f||[]).push([0])</script>'];
  for (let at = 0; at < payload.length; at += piece) {
    pushes.push(`<script>self.__next_f.push([1,${JSON.stringify(payload.slice(at, at + piece))}])</script>`);
  }
  return `<!DOCTYPE html><html><head><title>Jamf Concepts</title></head><body>${pushes.join('')}</body></html>`;
}

/** The rows of a live page that come before its listing: the header's, and structured data. */
function leadingRows(code: string): string[] {
  const structured = JSON.stringify({ '@context': 'https://schema.org', '@type': 'Organization', name: 'Jamf' });
  return [
    `0:${JSON.stringify({ P: null, c: ['', code, ''], q: '', i: false })}`,
    '1:"$Sreact.fragment"',
    `7:${JSON.stringify(['$', '$L13', null, {
      locale: code,
      children: [['$', 'script', null, { type: 'application/ld+json', dangerouslySetInnerHTML: { __html: structured } }]],
      // The header's link to the tools, under the key the tools index lists them by.
      concepts: { title: 'Concepts', viewAllLabel: 'See all', viewAllHref: '/concepts' },
    }])}`,
  ];
}

/** The payload of one section's index page in one locale, as captured. */
export function conceptsIndexPayload(code: ListedLocale, section: IndexSection): string {
  const listing = CONCEPTS_LISTINGS[code];
  const rows = leadingRows(code);
  if (section === 'guides') {
    rows.push(
      // Among the site's other messages, as on a live page.
      `9:${JSON.stringify(['$', '$L1f', null, { messages: {
        conceptCategoryLabels: { 'developer-tools': 'Developer Tools' },
        guideCategoryLabels: listing.guideCategoryLabels,
      } }])}`,
      `8:${JSON.stringify(['$', '$L22', null, { guide: listing.guide, nav: listing.nav }])}`,
    );
  } else {
    rows.push(`8:${JSON.stringify(['$', '$L26', null, { concepts: listing.concepts }])}`);
  }
  return `${rows.join('\n')}\n`;
}

/** One section's index page in one locale, as the site serves it. */
export function conceptsIndexPage(code: ListedLocale, section: IndexSection): string {
  return flightPage(conceptsIndexPayload(code, section));
}

/** Every captured index page, by URL. */
export function conceptsIndexPages(): Map<string, string> {
  const pages = new Map<string, string>();
  for (const code of Object.keys(CONCEPTS_LISTINGS) as ListedLocale[]) {
    for (const section of ['guides', 'concepts'] as const) {
      pages.set(conceptsIndexUrl(code, section), conceptsIndexPage(code, section));
    }
  }
  return pages;
}

/** Every path a listing names under `/{code}/`, as the sitemap lists it: slashless. */
export function listedPaths(code: ListedLocale): string[] {
  const listing = CONCEPTS_LISTINGS[code];
  const paths: string[] = [`guides/${listing.guide.path}`];
  const walk = (categories: typeof listing.nav, at: string): void => {
    for (const category of categories) {
      const here = `${at}/${category.id}`;
      paths.push(`guides${here}`, ...category.guides.map(guide => `guides${here}/${guide.slug}`));
      walk(category.children, here);
    }
  };
  walk(listing.nav, '');
  // `mut` is listed, and is not in the sitemap.
  paths.push(...listing.concepts.filter(tool => tool.slug !== 'mut').map(tool => `concepts/${tool.slug}`));
  return paths;
}
