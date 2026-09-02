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

/**
 * One browsable part of a static source.
 *
 * A Fluid Topics publication is a bundle with a TOC endpoint. A static site
 * has no such thing, so its browsable units are declared: `path` is the URL
 * segment that groups them and `id` is what `jamf_docs_get_toc`'s
 * `publication` parameter accepts, which keeps both kinds of source on one
 * tool surface rather than adding a third addressing mode.
 */
export interface StaticSection {
  /** Publication id, e.g. `jamf-concepts-guides`. */
  readonly id: string;
  /** URL segment after the locale, e.g. `guides`. */
  readonly path: string;
  /** Title for listings. */
  readonly title: string;
}

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
  /**
   * Locale codes this source uses, mapped from this server's.
   *
   * concepts.jamf.com uses bare short codes (`en`, `ja`, `de`) and is
   * case-sensitive; only `zh-TW` matches this server's form exactly. Locales
   * absent from this map are not published by the source at all — th-TH is
   * a hard gap, `/th` and `/th-TH` both 404.
   */
  readonly locales: Readonly<Record<string, string>>;
  /** Browsable sections, exposed as publications. */
  readonly sections: readonly StaticSection[];
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
    locales: {
      'en-US': 'en',
      'ja-JP': 'ja',
      'de-DE': 'de',
      'es-ES': 'es',
      'fr-FR': 'fr',
      'nl-NL': 'nl',
      'zh-TW': 'zh-TW',
      'zh-CN': 'zh-CN',
    },
    sections: [
      { id: 'jamf-concepts-guides', path: 'guides', title: 'Jamf Concepts: Guides' },
      { id: 'jamf-concepts-tools', path: 'concepts', title: 'Jamf Concepts: Open Source Tools' },
    ],
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

/** Every browsable section across all static sources, as publication rows. */
export const STATIC_SECTIONS: readonly { source: StaticDocSource; section: StaticSection }[] =
  Object.values(STATIC_DOC_SOURCES).flatMap(source =>
    source.sections.map(section => ({ source, section })));

/** The static section a publication id names, or undefined for a Fluid Topics one. */
export function staticSectionById(
  id: string,
): { source: StaticDocSource; section: StaticSection } | undefined {
  return STATIC_SECTIONS.find(row => row.section.id === id);
}
