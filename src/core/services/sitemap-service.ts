/**
 * Table of contents for a static documentation source, built from its sitemap.
 *
 * A Fluid Topics publication ships a real TOC endpoint. A static site does
 * not — but concepts.jamf.com publishes a sitemap whose paths already encode
 * the hierarchy (`{locale}/guides/{category}/{article}`), so the tree can be
 * derived from 990 URLs in one request instead of crawling 99 pages per
 * locale and parsing each one's navigation.
 */

import { cacheKey } from './cache-key.js';
import { paginateTocEntries } from './toc-helpers.js';
import { canonicalStaticUrl, type StaticDocSource, type StaticSection } from '../constants/sources.js';
import type { ServerContext } from '../types/context.js';
import type { FetchTocOptions, FetchTocResult, TocEntry } from '../types.js';
import { PAGINATION_CONFIG, TOKEN_CONFIG } from '../constants.js';

/** One `<url>` of a sitemap, reduced to what a TOC needs. */
export interface SitemapEntry {
  /** Absolute URL, in the spelling the source serves. See {@link canonicalStaticUrl}. */
  url: string;
  /**
   * Path segments after the origin, e.g. `['en', 'guides', 'ai-governance']`,
   * spelled as `URL.pathname` spells them: a non-ASCII character is
   * percent-encoded. {@link titleFromSlug} decodes one for display.
   */
  segments: string[];
  /** `<lastmod>`, when present. */
  lastModified?: string;
}

/**
 * Extract every `<loc>` from a sitemap, with its `<lastmod>` when it has one.
 *
 * Deliberately a scan for `<url>` blocks rather than an XML parse: the
 * document is a flat list, cheerio would have to be told to treat it as XML,
 * and a sitemap that fails to parse should still yield the entries it does
 * have.
 *
 * Takes the source because a `<loc>` is not a page's canonical spelling: both
 * sitemaps list every page without a trailing slash, and only one of the two
 * sites serves that form.
 */
export function parseSitemap(source: StaticDocSource, xml: string): SitemapEntry[];
/**
 * The form this took until #338. Each `<loc>` is canonicalised by the source
 * its own host names, as the one-argument {@link canonicalStaticUrl} does.
 *
 * @deprecated Pass the source: `parseSitemap(source, xml)`.
 */
export function parseSitemap(xml: string): SitemapEntry[];
export function parseSitemap(sourceOrXml: StaticDocSource | string, maybeXml?: string): SitemapEntry[] {
  const source = typeof sourceOrXml === 'string' ? undefined : sourceOrXml;
  const xml = typeof sourceOrXml === 'string' ? sourceOrXml : maybeXml ?? '';
  const out: SitemapEntry[] = [];
  for (const block of xml.match(/<url\b[\s\S]*?<\/url>/g) ?? []) {
    const loc = /<loc>\s*([^<\s]+)\s*<\/loc>/.exec(block)?.[1];
    if (loc === undefined) { continue; }
    const lastmod = /<lastmod>\s*([^<\s]+)\s*<\/lastmod>/.exec(block)?.[1];
    let segments: string[];
    try {
      segments = new URL(loc).pathname.split('/').filter(Boolean);
    } catch {
      continue;
    }
    out.push({
      url: source === undefined ? canonicalStaticUrl(loc) : canonicalStaticUrl(source, loc),
      segments,
      ...(lastmod !== undefined ? { lastModified: lastmod } : {}),
    });
  }
  return out;
}

/** Fetch and cache a source's sitemap. */
export async function loadSitemap(
  ctx: ServerContext,
  source: StaticDocSource,
): Promise<SitemapEntry[]> {
  const key = cacheKey('static-sitemap', { source: source.id });
  const cached = await ctx.cache.get<SitemapEntry[]>(key);
  if (cached !== null) { return cached; }

  const xml = await ctx.http.getText(`${source.baseUrl}/sitemap.xml`);
  const entries = parseSitemap(source, xml);
  await ctx.cache.set(key, entries, ctx.config.cacheTtl.products);
  return entries;
}

/**
 * Terms whose casing a naive capitalise gets wrong.
 *
 * The sitemap gives slugs, not titles, and fetching 99 pages per locale to
 * read each `og:title` is not worth one heading apiece. Word-by-word
 * capitalisation produces "Ai Governance", "Byod" and "Ios", which read as
 * mistakes; this table is what the site's own index page shows those as.
 * Keyed lowercase.
 */
const TITLE_CASE_TERMS: Readonly<Record<string, string>> = {
  ai: 'AI', api: 'API', byod: 'BYOD', ddm: 'DDM', it: 'IT', mdm: 'MDM',
  pki: 'PKI', ldap: 'LDAP', scep: 'SCEP', ztna: 'ZTNA', sso: 'SSO',
  vpn: 'VPN', mfa: 'MFA', dns: 'DNS', ip: 'IP', tls: 'TLS', url: 'URL',
  json: 'JSON', xml: 'XML', sdk: 'SDK', cli: 'CLI', ui: 'UI', ux: 'UX',
  id: 'ID', edr: 'EDR', xdr: 'XDR', siem: 'SIEM', saas: 'SaaS',
  macos: 'macOS', ios: 'iOS', ipados: 'iPadOS', tvos: 'tvOS',
  watchos: 'watchOS', visionos: 'visionOS', jamf: 'Jamf', apple: 'Apple',
  aws: 'AWS', okta: 'Okta', entra: 'Entra', jss: 'JSS',
};

/** Words that stay lowercase unless they open the title. */
const TITLE_MINOR_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'of', 'on', 'or',
  'the', 'to', 'via', 'with',
]);

/**
 * Characters a title must not carry, though a slug can spell any of them as
 * an escape: the controls, of which a newline would end the Markdown list
 * item a title is written into; the line and paragraph separators; and the
 * bidi marks, embeddings, overrides and isolates, which reorder the text
 * around them when it is displayed.
 */
const UNSAFE_IN_TITLE = /[\p{Cc}\u061C\u200E\u200F\u2028\u2029\u202A-\u202E\u2066-\u2069]/gu;

/**
 * A path segment with its percent-escapes decoded, where they decode.
 *
 * Decoded one run of escapes at a time, and a run that will not decode is
 * kept as written: `decodeURIComponent` throws on an escape that is not
 * UTF-8, and one bad escape must not cost a sitemap its index. Neither live
 * sitemap holds such an escape: every one of their 1,906 `<loc>`s decodes
 * (2026-09-26). The escapes of one character always stand side by side, so a
 * slug that would decode whole decodes to the same text run by run.
 *
 * A character in {@link UNSAFE_IN_TITLE} is written as its escape, as it was
 * before slugs were decoded.
 */
function decodeSlug(slug: string): string {
  return slug
    .replace(/(?:%[0-9A-Fa-f]{2})+/g, run => {
      try { return decodeURIComponent(run); } catch { return run; }
    })
    .replace(UNSAFE_IN_TITLE, char => encodeURIComponent(char));
}

const LATIN_LETTER = /\p{Script=Latin}/u;

/**
 * A letter of a script other than Latin: kana, a CJK ideograph, and so on.
 * A letter of the Common script, which belongs to no one script, does not
 * count: `µ` in `10µs` does not make that a mixed word. (`ー`, the kana
 * length mark, is Common too, and stands beside kana, which count.)
 */
const NON_LATIN_LETTER = /(?![\p{Script=Latin}\p{Script=Common}])\p{L}/u;

/**
 * One run of Latin letters and digits, inside a word that also holds others.
 * A run keeps its digits, as a word does, so it is cased as the same letters
 * and digits would be on their own: `2faで` stays `2faで`, as `2fa` stays `2fa`.
 */
const LATIN_RUN = /[\p{Script=Latin}\p{N}]+/gu;

/** Whether a word mixes Latin letters with another script's, as `accountでjamf` does. */
function mixesScripts(word: string): boolean {
  return LATIN_LETTER.test(word) && NON_LATIN_LETTER.test(word);
}

/** One word of a heading, cased; `opensTitle` exempts it from the minor-word rule. */
function titleCaseWord(word: string, opensTitle: boolean): string {
  const known = TITLE_CASE_TERMS[word.toLowerCase()];
  if (known !== undefined) { return known; }
  if (!opensTitle && TITLE_MINOR_WORDS.has(word.toLowerCase())) { return word.toLowerCase(); }
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * Turn a slug into a heading: `ai-governance` → `AI Governance`.
 *
 * Checked against the fourteen real titles concepts.jamf.com's own guides
 * index renders, which is the only place the site publishes them without a
 * per-page request: eight of nine match exactly. The ninth is
 * `infrastructure-as-code`, which the site titles "Infrastructure As Code"
 * and this produces as "Infrastructure as Code" — standard title case
 * lowercases "as", and matching one page's capitalisation is not worth a
 * special case.
 *
 * `slug` is a path segment as `URL.pathname` spells it, which percent-encodes
 * every character that is not ASCII, so it is decoded first. Until it was,
 * each of the 29 support.jamf.com articles with a Japanese or Chinese slug —
 * every ja and zh-TW article it lists, 2026-09-26 — was titled with its
 * escapes ("Jamf ID %E3%81%AE%E4%BD%9C%E6%88%90"), and no query in either
 * language could match one. A slug that is already decoded comes out the
 * same, unless it holds a `%` and two hex digits, which are read as an
 * escape, or a character {@link UNSAFE_IN_TITLE} names, which is escaped. An
 * escaped hyphen, `%2D`, is a hyphen, as RFC 3986 says it is, and so
 * separates words like any other.
 *
 * Japanese writes no space between words, and Intercom's slugs keep that, so
 * one hyphen-separated word can hold several: `accountでjamf`. Each Latin run
 * in such a word is cased as a word of its own, or it reads "Accountでjamf
 * Idを…" where the article says "AccountでJamf IDを…". Only the run that
 * opens the title is exempt from the minor-word rule. Any other word is cased
 * whole, exactly as before.
 *
 * Measured against the titles Intercom's collection pages give those 29
 * (2026-09-26): all 29 have the letters and digits of their real title, in
 * order, and 24 match it exactly but for punctuation and spacing. The other
 * five differ only in case, which a slug loses and the rules here guess
 * wrong: `Cer` for `.cer`, `Apns` and `Idp` for `APNs` and `IdP`, and, in two
 * quoted error messages, `Jamf Auth` for `jamf-auth` and "We Are Sorry an
 * Error Occurred" for "We are sorry, an error occurred".
 */
export function titleFromSlug(slug: string): string {
  const words = decodeSlug(slug).split('-').filter(Boolean);
  return words
    .map((word, index) => mixesScripts(word)
      ? word.replace(LATIN_RUN, (run: string, offset: number) =>
        titleCaseWord(run, index === 0 && offset === 0))
      : titleCaseWord(word, index === 0))
    .join(' ');
}

interface TreeNode {
  slug: string;
  url?: string;
  children: Map<string, TreeNode>;
}

function toTocEntries(nodes: Iterable<TreeNode>, titles: Map<string, string>): TocEntry[] {
  return [...nodes]
    // By its words, not its escapes, which would sort every non-ASCII slug
    // ahead of every ASCII one.
    .sort((a, b) => decodeSlug(a.slug).localeCompare(decodeSlug(b.slug)))
    .map(node => {
      const children = toTocEntries(node.children.values(), titles);
      const entry: TocEntry = {
        title: titles.get(node.url ?? '') ?? titleFromSlug(node.slug),
        url: node.url ?? '',
      };
      if (children.length > 0) { entry.children = children; }
      return entry;
    });
}

/**
 * Build a TOC for one section of a static source, in one locale.
 *
 * @param locale the source's own locale code, e.g. `en` — not `en-US`
 */
export async function buildStaticToc(
  ctx: ServerContext,
  source: StaticDocSource,
  section: StaticSection,
  locale: string,
): Promise<TocEntry[]> {
  const entries = await loadSitemap(ctx, source);
  const root = new Map<string, TreeNode>();

  for (const entry of entries) {
    const [entryLocale, entrySection, ...rest] = entry.segments;
    if (entryLocale !== locale || entrySection !== section.path) { continue; }
    // The section's own index page is the container, not a child of itself.
    if (rest.length === 0) { continue; }

    let level = root;
    let node: TreeNode | undefined;
    for (const slug of rest) {
      node = level.get(slug);
      if (node === undefined) {
        node = { slug, children: new Map() };
        level.set(slug, node);
      }
      level = node.children;
    }
    if (node !== undefined) { node.url = entry.url; }
  }

  return toTocEntries(root.values(), new Map());
}

/**
 * A `FetchTocResult` for a static source's section.
 *
 * Pagination and token truncation are the same operations the Fluid Topics
 * path performs, applied to entries that came from a sitemap instead of a
 * map: a caller paging through a Concepts TOC must not get a different shape
 * from one paging through Jamf Pro's.
 */
export async function fetchStaticToc(
  ctx: ServerContext,
  source: StaticDocSource,
  section: StaticSection,
  sourceLocale: string,
  options: FetchTocOptions = {},
): Promise<FetchTocResult> {
  const page = options.page ?? PAGINATION_CONFIG.DEFAULT_PAGE;
  const maxTokens = options.maxTokens ?? TOKEN_CONFIG.DEFAULT_MAX_TOKENS;

  const allToc = await buildStaticToc(ctx, source, section, sourceLocale);

  return {
    ...paginateTocEntries(allToc, page, maxTokens),
    // The locale that answered is the one asked for: unlike Fluid Topics,
    // where a family may exist in en-US only, a static section either
    // publishes the locale or `resolveTocSource` refused before reaching here.
    resolvedLocale: sourceLocale,
  };
}
