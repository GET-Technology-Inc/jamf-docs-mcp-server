/**
 * Documentation sources outside Fluid Topics.
 *
 * `learn.jamf.com` is a Fluid Topics instance and is addressed through
 * bundles, maps and topics; everything in this file is a plain website that
 * happens to hold Jamf documentation. They need different selectors, a
 * different link-rewrite base, and their own cache namespace, so they are
 * described here rather than being squeezed into {@link JAMF_PRODUCTS}.
 *
 * Adding a source means adding a row here, teaching
 * {@link ALLOWED_HOSTNAMES} nothing (it derives from this table), and nothing
 * else: the article path dispatches on hostname.
 */

import { SELECTORS, type SelectorSet } from './limits.js';

export interface StaticDocSource {
  /** Stable id, used as the cache namespace discriminator. */
  readonly id: string;
  /** The single hostname this source serves from. */
  readonly hostname: string;
  /** Origin, without a trailing slash. Root-relative links resolve against it. */
  readonly baseUrl: string;
  /** Human name, for prose and error messages. */
  readonly name: string;
  /** How to read this source's HTML. */
  readonly selectors: SelectorSet;
  /**
   * Appended to every article served from this source.
   *
   * Not decoration. Jamf Concepts describes itself as an innovation lab whose
   * subjects "aren't official products, although some of them might be one
   * day" — presenting that beside learn.jamf.com's product documentation
   * without saying which is which would be the actual error.
   */
  readonly provenance?: string;
}

/**
 * Elements to strip that a static marketing-shaped site has and a Fluid
 * Topics fragment does not.
 *
 * `nav`, `header` and `aside` are deliberately absent from
 * {@link SELECTORS}.REMOVE: that set is also used by the glossary path and by
 * every learn.jamf.com article, where removing them would change existing
 * output. Here they are the difference between an article and an article
 * plus the entire site navigation — one Concepts guide measures 23,824
 * characters of text with the nav in and would spend a large part of any
 * token budget on a sidebar.
 */
const STATIC_PAGE_REMOVE =
  `${SELECTORS.REMOVE}, nav, header, aside, [role="navigation"], [class*="sidebar"]`;

export const STATIC_DOC_SOURCES = {
  'jamf-concepts': {
    id: 'jamf-concepts',
    hostname: 'concepts.jamf.com',
    baseUrl: 'https://concepts.jamf.com',
    name: 'Jamf Concepts',
    selectors: {
      // Every page type — guide, concept, about — wraps its body in exactly
      // one `<article class="prose">`. `main` is deliberately NOT listed:
      // `.html()` takes the first match in *document* order regardless of
      // selector order, and `<main class="flex-1">` opens before the article
      // and encloses the 220px sidebar. Including it pulled the whole guide
      // index in ahead of the content.
      CONTENT: 'article, [class*="prose"]',
      TITLE: 'h1',
      BREADCRUMB: '[class*="breadcrumb"] a',
      RELATED: '[class*="related"] a',
      REMOVE: STATIC_PAGE_REMOVE,
    },
    provenance:
      'Source: Jamf Concepts (concepts.jamf.com), Jamf\'s innovation lab. ' +
      'This is exploratory material, not official product documentation — ' +
      'see learn.jamf.com for the supported configuration steps.',
  },
} as const satisfies Record<string, StaticDocSource>;

export type StaticSourceId = keyof typeof STATIC_DOC_SOURCES;

/** Every non-Fluid-Topics hostname this server will fetch from. */
export const STATIC_SOURCE_HOSTNAMES: readonly string[] =
  Object.values(STATIC_DOC_SOURCES).map(source => source.hostname);

/** The source that serves a hostname, or undefined when none does. */
export function staticSourceForHostname(hostname: string): StaticDocSource | undefined {
  return Object.values(STATIC_DOC_SOURCES).find(source => source.hostname === hostname);
}

/**
 * The source a URL belongs to, or undefined for Fluid Topics and anything else.
 *
 * Returns undefined rather than throwing on an unparseable URL: callers use
 * this to *choose* a path, and the existing validation is what rejects a bad
 * URL with a message about it.
 */
export function staticSourceForUrl(urlStr: string): StaticDocSource | undefined {
  try {
    return staticSourceForHostname(new URL(urlStr).hostname);
  } catch {
    return undefined;
  }
}
