/**
 * Table of contents for a static documentation source, built from its sitemap.
 *
 * A Fluid Topics publication ships a real TOC endpoint. A static site does
 * not — but concepts.jamf.com publishes a sitemap whose paths already encode
 * the hierarchy (`{locale}/guides/{category}/{article}`), so the tree can be
 * derived from 990 URLs in one request instead of crawling 99 pages per
 * locale and parsing each one's navigation.
 */

import { httpGetText } from '../http-client.js';
import { cacheKey } from './cache-key.js';
import { canonicalStaticUrl } from './static-article-service.js';
import type { StaticDocSource, StaticSection } from '../constants/sources.js';
import type { ServerContext } from '../types/context.js';
import type { FetchTocOptions, FetchTocResult, TocEntry } from '../types.js';
import { PAGINATION_CONFIG, TOKEN_CONFIG } from '../constants.js';
import {
  calculatePagination,
  truncateListByTokens,
  buildPaginationNote,
} from './tokenizer.js';

/** One `<url>` of a sitemap, reduced to what a TOC needs. */
export interface SitemapEntry {
  /** Canonical absolute URL. */
  url: string;
  /** Path segments after the origin, e.g. `['en', 'guides', 'ai-governance']`. */
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
 */
export function parseSitemap(xml: string): SitemapEntry[] {
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
      url: canonicalStaticUrl(loc),
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

  const xml = await httpGetText(`${source.baseUrl}/sitemap.xml`);
  const entries = parseSitemap(xml);
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
 * Turn a slug into a heading: `ai-governance` → `AI Governance`.
 *
 * Checked against the fourteen real titles concepts.jamf.com's own guides
 * index renders, which is the only place the site publishes them without a
 * per-page request: eight of nine match exactly. The ninth is
 * `infrastructure-as-code`, which the site titles "Infrastructure As Code"
 * and this produces as "Infrastructure as Code" — standard title case
 * lowercases "as", and matching one page's capitalisation is not worth a
 * special case.
 */
export function titleFromSlug(slug: string): string {
  const words = slug.split('-').filter(Boolean);
  return words
    .map((word, index) => {
      const known = TITLE_CASE_TERMS[word.toLowerCase()];
      if (known !== undefined) { return known; }
      if (index > 0 && TITLE_MINOR_WORDS.has(word.toLowerCase())) { return word.toLowerCase(); }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

interface TreeNode {
  slug: string;
  url?: string;
  children: Map<string, TreeNode>;
}

function toTocEntries(nodes: Iterable<TreeNode>, titles: Map<string, string>): TocEntry[] {
  return [...nodes]
    .sort((a, b) => a.slug.localeCompare(b.slug))
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

  const totalItems = countTocEntries(allToc);
  const paginationCalc = calculatePagination(allToc.length, page, PAGINATION_CONFIG.DEFAULT_PAGE_SIZE);
  const paginated = allToc.slice(paginationCalc.startIndex, paginationCalc.endIndex);

  const { items, tokenCount, truncated } =
    truncateListByTokens(paginated, maxTokens, tocEntryToString);

  const paginationNote = buildPaginationNote(paginationCalc);

  return {
    toc: items,
    pagination: {
      page: paginationCalc.page,
      pageSize: paginationCalc.pageSize,
      totalPages: paginationCalc.totalPages,
      totalItems,
      hasNext: paginationCalc.hasNext,
      hasPrev: paginationCalc.hasPrev,
    },
    tokenInfo: { tokenCount, truncated, maxTokens },
    // The locale that answered is the one asked for: unlike Fluid Topics,
    // where a family may exist in en-US only, a static section either
    // publishes the locale or `resolveTocSource` refused before reaching here.
    resolvedLocale: sourceLocale,
    ...(paginationNote !== undefined ? { paginationNote } : {}),
  };
}

/** Total entries including nested children. Mirrors toc-service's own count. */
function countTocEntries(entries: TocEntry[]): number {
  return entries.reduce(
    (count, entry) => count + 1 + (entry.children !== undefined ? countTocEntries(entry.children) : 0),
    0,
  );
}

/** Serialise one entry for token estimation. Mirrors toc-service's. */
function tocEntryToString(entry: TocEntry, depth = 0): string {
  const indent = '  '.repeat(depth);
  const childrenStr = entry.children?.map(c => tocEntryToString(c, depth + 1)).join('') ?? '';
  return `${indent}- ${entry.title}\n${childrenStr}`;
}
