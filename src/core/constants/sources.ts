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
  /**
   * Which spelling of a page URL this source answers with a 200 rather than a
   * redirect: `add` a trailing slash, or `strip` it. {@link canonicalStaticUrl}
   * applies it.
   *
   * Required, because the sources here disagree and neither answer is a safe
   * default. A sitemap is no guide either: both list every page without the
   * slash (990 of 990 and 916 of 916, 2026-09-26), whichever form the site
   * then serves.
   */
  readonly trailingSlash: 'add' | 'strip';
  /** Human name, for prose and error messages. */
  readonly name: string;
  /**
   * How this source's pages are read.
   *
   * `html` parses the DOM with {@link StaticDocSource.selectors}. `intercom`
   * ignores them entirely: an Intercom Help Center embeds its own data as
   * JSON in `<script id="__NEXT_DATA__">`, and the content model is a block
   * list rather than markup, so the rendered DOM is a view of the source of
   * truth rather than the source itself.
   */
  readonly parser: 'html' | 'intercom';
  /** How to read this source's HTML. Unused when `parser` is not `html`. */
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
  /**
   * Browsable sections, exposed as publications.
   *
   * Empty for a source whose sections are not knowable without a request —
   * an Intercom Help Center's collections are content, not configuration,
   * and pinning their ids here would mean a registry edit whenever Jamf adds
   * one. Those are discovered instead; see {@link StaticDocSource.dynamicSections}.
   */
  readonly sections: readonly StaticSection[];
  /**
   * Set when sections come from the source at runtime rather than this table.
   *
   * The publication id is then `{prefix}-{slug}`, so a caller can still name
   * one without knowing Intercom's numeric ids.
   */
  readonly dynamicSections?: { readonly kind: 'intercom-collections'; readonly idPrefix: string };
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
    // `…/apiutil` is a 301 to `…/apiutil/`, on 11 of 11 URLs sampled across
    // both sections and nine locales (2026-09-26). The page's own
    // `<link rel="canonical">` cannot settle it: every page names the site
    // root, `https://concepts.jamf.com/en/`.
    trailingSlash: 'add',
    name: 'Jamf Concepts',
    parser: 'html',
    selectors: {
      // Every page type — guide, concept, about — wraps its body in exactly
      // one `<article class="prose">`. `main` is deliberately NOT listed:
      // `.html()` takes the first match in *document* order regardless of
      // selector order, and `<main class="flex-1">` opens before the article
      // and encloses the 220px sidebar. Including it pulled the whole guide
      // index in ahead of the content.
      CONTENT: 'article, [class*="prose"]',
      // The article's own title, and nothing else on the page. The site
      // renders a guide's title above the article and hides the Markdown copy
      // inside it (the article is `class="prose … [&>h1:first-child]:hidden"`),
      // so an <h1> that opens the article is the title and no other <h1> is.
      // This used to be a bare `'h1'`, which went wrong two ways:
      //
      // - Every guide page opens with a hero `<h1>Guides</h1>` (localised) in
      //   a plain `<section>`, which no chrome rule removes. Only
      //   `[class*="tracking"]` in SELECTORS.REMOVE did, a clause written for
      //   tracking scripts that happens to match Tailwind's `tracking-tight`.
      //   Deleting it titled all 570 guide-section pages "Guides", and no
      //   test went red.
      // - A body can hold <h1>s that are not its title. One guide types a bash
      //   script in single backticks, the site's Markdown turns each `#`
      //   comment into an <h1>, and the guide was served as "Jamf Pro
      //   Extension Attribute which checks and validates the following:" in
      //   all 10 locales.
      //
      // Measured on all 990 sitemap pages on 2026-09-24: 190 articles open
      // with their title <h1>; every other page matches nothing here and gets
      // `og:title` from `fetchStaticArticle`. Titles that differ from
      // `og:title` went from 11 to 1, the benign `ja/guides/infrastructure-as-code`
      // ("Infrastructure as Code" against og "Infrastructure as Code
      // (コードとしてのインフラストラクチャ)"). Content is unchanged on all
      // 990, and titles are the same with or without the tracking clause.
      TITLE: 'article > h1:first-child',
      BREADCRUMB: '[class*="breadcrumb"] a, nav[aria-label="breadcrumb" i] a',
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

  'jamf-support': {
    id: 'jamf-support',
    hostname: 'support.jamf.com',
    baseUrl: 'https://support.jamf.com',
    // The mirror image of concepts.jamf.com: `…/articles/…/` is a 301 to the
    // slashless form, on 19 of 19 URLs sampled (articles and collections, all
    // six locales, 2026-09-26), and the slashless form is each article's
    // `<link rel="canonical">`, though that spells a non-ASCII slug raw where
    // core percent-encodes it (see `canonicalStaticUrl`). This source
    // inherited concepts.jamf.com's rule until #338, so every uncached article
    // fetch paid that redirect — a median 329 ms on eight measured.
    trailingSlash: 'strip',
    name: 'Jamf Support Knowledge Base',
    parser: 'intercom',
    // Unused: the Intercom parser reads __NEXT_DATA__, not the DOM. Present
    // because the shape requires it and because a future HTML fallback would
    // want somewhere sensible to start.
    selectors: {
      CONTENT: 'article, main',
      TITLE: 'h1',
      BREADCRUMB: '[class*="breadcrumb"] a, nav[aria-label="breadcrumb" i] a',
      RELATED: '[class*="related"] a',
      REMOVE: STATIC_PAGE_REMOVE,
    },
    provenance:
      'Source: Jamf Support Knowledge Base (support.jamf.com). Troubleshooting ' +
      'and known-issue articles, edited separately from the product ' +
      'documentation on learn.jamf.com.',
    // Six locales route and carry content. `nl` and `th` route but return an
    // empty collection list, so they are absent rather than listed and
    // silently empty.
    locales: {
      'en-US': 'en',
      'de-DE': 'de',
      'es-ES': 'es',
      'fr-FR': 'fr',
      'ja-JP': 'ja',
      'zh-TW': 'zh-TW',
    },
    sections: [],
    dynamicSections: { kind: 'intercom-collections', idPrefix: 'jamf-support' },
  },
} as const satisfies Record<string, StaticDocSource>;

/**
 * The one spelling of a page URL that `source` serves, rather than redirects.
 *
 * Every page URL core hands out goes through here — search hits, TOC entries
 * and an article's `url` — and so does every article and collection page it
 * requests, and the article cache key. So one page has one name whichever
 * tool reports it, and no page request pays for a redirect the site would
 * answer with. The two requests that name no page are made as spelled:
 * `sitemap.xml`, and an Intercom locale home (`/en/`), which support.jamf.com
 * answers with a 200 with or without the slash.
 *
 * Only the path's trailing slash changes, per
 * {@link StaticDocSource.trailingSlash}. `strip` drops every trailing slash:
 * support.jamf.com 301s `…/` and `…//` alike to the slashless form. `add`
 * leaves exactly one, since concepts.jamf.com serves `…//` as the same bytes
 * as `…/`; but under `add` a path whose last segment looks like a file
 * (`llms-full.txt`) is left exactly as it is. A query or fragment is kept,
 * and the rule still applies to the path in front of it: both sites redirect
 * on the path alone, `…/apiutil?x=1` to `…/apiutil/?x=1` on concepts.jamf.com
 * and the mirror image on support.jamf.com.
 *
 * The result is the WHATWG serialisation, so a non-ASCII slug comes back
 * percent-encoded: the form a request puts on the wire, the form a raw and an
 * encoded spelling of the same page both reduce to, and the form `get_article`
 * has always reported. support.jamf.com itself spells such a slug raw, in its
 * sitemap, its collection pages and its `<link rel="canonical">`, and the
 * encoded form is longer: about 182 characters against 75, on average, for its
 * 31 such pages (2026-09-26).
 *
 * An unparseable input is returned unchanged; rejecting it is validation's job.
 */
export function canonicalStaticUrl(source: StaticDocSource, urlStr: string): string;
/**
 * The form this took until #338, in `services/static-article-service`, which
 * still re-exports it. The source is the one whose host the URL names; a host
 * with no source gets `add`, which is what this did to every URL before.
 *
 * @deprecated Pass the source: `canonicalStaticUrl(source, url)`.
 */
export function canonicalStaticUrl(urlStr: string): string;
export function canonicalStaticUrl(sourceOrUrl: StaticDocSource | string, maybeUrl?: string): string {
  const urlStr = typeof sourceOrUrl === 'string' ? sourceOrUrl : maybeUrl ?? '';
  const source = typeof sourceOrUrl === 'string' ? staticSourceForUrl(sourceOrUrl) : sourceOrUrl;
  try {
    const url = new URL(urlStr);
    const bare = url.pathname.replace(/\/+$/, '');
    const last = bare.split('/').pop() ?? '';
    if (source?.trailingSlash === 'strip') {
      url.pathname = bare;
    } else if (!last.includes('.')) {
      url.pathname = `${bare}/`;
    }
    return url.toString();
  } catch {
    return urlStr;
  }
}

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

/** Sources whose sections are discovered at runtime rather than declared here. */
export const DYNAMIC_SECTION_SOURCES: readonly StaticDocSource[] =
  (Object.values(STATIC_DOC_SOURCES) as StaticDocSource[])
    .filter(source => source.dynamicSections !== undefined);

/**
 * Publication id for a runtime-discovered section.
 *
 * Built from the slug rather than Intercom's numeric id so a caller can name
 * a collection from its URL, and so recreating a collection upstream does not
 * change the id this server publishes.
 */
export function dynamicSectionId(source: StaticDocSource, slug: string): string {
  return `${source.dynamicSections?.idPrefix ?? source.id}-${slug}`;
}
