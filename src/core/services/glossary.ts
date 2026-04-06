/**
 * Glossary service for parsing and looking up Jamf documentation glossary terms
 *
 * Uses Fluid Topics API on learn.jamf.com:
 * - GET /api/khub/maps/{mapId}/toc — list all glossary terms
 * - GET /api/khub/maps/{mapId}/topics/{contentId}/content — term HTML
 *
 * Jamf's glossary uses DITA glossentry format where each term is a separate topic:
 *   <div class="glossdef"><p>Definition text</p></div>
 *
 * Also supports fallback formats:
 * - Definition list (<dl>/<dt>/<dd>)
 * - Heading + paragraph (h2/h3 followed by <p>)
 *
 * Uses fuse.js for fuzzy ranking of collected entries.
 */

import Fuse, { type IFuseOptions } from 'fuse.js';
import * as cheerio from 'cheerio';

import {
  SELECTORS,
  TOKEN_CONFIG,
  DEFAULT_LOCALE,
  type ProductId,
  type LocaleId,
} from '../constants.js';

import type {
  GlossaryEntry,
  GlossaryLookupResult,
  FtTocNode,
} from '../types.js';
import { fetchMapToc, fetchTopicContent } from './ft-client.js';
import { buildDisplayUrl } from './topic-resolver.js';
import { cleanHtml, htmlToMarkdown } from './content-parser.js';
import type { ServerContext } from '../types/context.js';
import type { CacheProvider } from './interfaces/cache.js';
import { truncateItemsToTokenLimit } from './tokenizer.js';
import { limitConcurrency } from '../utils/concurrency.js';

/** Return a zero-entry result when there is nothing to report. */
function emptyGlossaryResult(maxTokens: number): GlossaryLookupResult {
  return {
    entries: [],
    totalMatches: 0,
    tokenInfo: { tokenCount: 0, truncated: false, maxTokens },
  };
}

// ─── Fluid Topics API helpers ───────────────────────────────────

/**
 * Fetch the glossary TOC from Fluid Topics via ft-client.
 * The TOC is a tree: root node has children, each child is a glossary term.
 * Cached with article TTL to avoid repeated requests.
 */
async function fetchGlossaryToc(
  ctx: ServerContext,
  mapId: string,
  locale: string
): Promise<FtTocNode[]> {
  const cacheKey = `${locale}:glossary-toc`;

  const cached = await ctx.cache.get<FtTocNode[]>(cacheKey);
  if (cached !== null) {
    return cached;
  }

  const nodes = await fetchMapToc(mapId);

  // Flatten: collect all leaf terms (children of the root)
  const terms: FtTocNode[] = [];
  for (const node of nodes) {
    // Skip non-term entries like "Glossary Revision History"
    if (node.children && node.children.length > 0) {
      for (const child of node.children) {
        if (!child.title.toLowerCase().includes('revision history')) {
          terms.push(child);
        }
      }
    }
  }

  await ctx.cache.set(cacheKey, terms, ctx.config.cacheTtl.article);
  return terms;
}

/**
 * Fetch the HTML content of a single glossary topic via ft-client.
 */
async function fetchGlossaryContent(
  ctx: ServerContext,
  mapId: string,
  contentId: string,
  locale: string
): Promise<string> {
  const cacheKey = `${locale}:glossary-content:${contentId}`;

  const cached = await ctx.cache.get<string>(cacheKey);
  if (cached !== null) {
    return cached;
  }

  const html = await fetchTopicContent(mapId, contentId);

  await ctx.cache.set(cacheKey, html, ctx.config.cacheTtl.article);
  return html;
}

// ─── HTML parsing ───────────────────────────────────────────────

/**
 * Parse glossary entries from HTML content.
 *
 * Priority order:
 * 1. DITA glossentry format (h1.glossterm + .glossdef) — Jamf's actual format
 * 2. Definition list (<dl>/<dt>/<dd>)
 * 3. Heading + paragraph (h2/h3 followed by <p>)
 * 4. Fallback: h1 title + article body content
 */
export function parseGlossaryEntries(
  html: string,
  sourceUrl: string,
  product?: string
): GlossaryEntry[] {
  const $ = cheerio.load(html);

  cleanHtml($);

  // 1. Try DITA glossentry format (Jamf's actual structure)
  const ditaEntries = parseDitaGlossentry($, sourceUrl, product);
  if (ditaEntries.length > 0) {
    return ditaEntries;
  }

  // 2. Try <dl>/<dt>/<dd> format
  const dlEntries = parseDlFormat($, sourceUrl, product);
  if (dlEntries.length > 0) {
    return dlEntries;
  }

  // 3. Try heading + paragraph format
  const headingEntries = parseHeadingFormat($, sourceUrl, product);
  if (headingEntries.length > 0) {
    return headingEntries;
  }

  // 4. Fallback: use h1 as term name + article body as definition
  return parseFallbackFormat($, sourceUrl, product);
}

/**
 * Parse DITA glossentry format:
 *   <h1 class="glossterm">Term</h1>
 *   <div class="glossdef"><p>Definition</p></div>
 *
 * Each Jamf glossary page contains exactly one term.
 */
function parseDitaGlossentry(
  $: cheerio.CheerioAPI,
  sourceUrl: string,
  product?: string
): GlossaryEntry[] {
  // Look for the DITA glossterm heading
  const glossterm = $('h1.glossterm, .glossterm').first();
  if (glossterm.length === 0) { return []; }

  const term = glossterm.text().trim();
  if (term === '') { return []; }

  // Look for the glossdef container
  const glossdef = $('.glossdef, .abstract.glossdef, div.glossdef').first();
  let definition = '';

  if (glossdef.length > 0) {
    const defHtml = glossdef.html() ?? '';
    definition = htmlToMarkdown(defHtml).trim();
  }

  // If no glossdef, try to get any content after the heading
  if (definition === '') {
    const article = $('article').first();
    if (article.length > 0) {
      // Get all content except the h1 itself
      const clone = article.clone();
      clone.find('h1').remove();
      const bodyHtml = clone.html() ?? '';
      definition = htmlToMarkdown(bodyHtml).trim();
    }
  }

  if (definition === '') { return []; }

  return [{ term, definition, url: sourceUrl, product }];
}

function parseDlFormat(
  $: cheerio.CheerioAPI,
  sourceUrl: string,
  product?: string
): GlossaryEntry[] {
  const entries: GlossaryEntry[] = [];
  const dlElements = $('dl');

  if (dlElements.length === 0) {
    return entries;
  }

  dlElements.each((_, dl) => {
    const dtElements = $(dl).children('dt');
    dtElements.each((_idx, dt) => {
      const term = $(dt).text().trim();
      if (term === '') { return; }

      const ddParts: string[] = [];
      let next = $(dt).next();
      while (next.length > 0 && next.is('dd')) {
        const ddHtml = next.html() ?? '';
        ddParts.push(htmlToMarkdown(ddHtml).trim());
        next = next.next();
      }

      const definition = ddParts.join('\n\n');
      if (definition !== '') {
        entries.push({ term, definition, url: sourceUrl, product });
      }
    });
  });

  return entries;
}

function parseHeadingFormat(
  $: cheerio.CheerioAPI,
  sourceUrl: string,
  product?: string
): GlossaryEntry[] {
  const entries: GlossaryEntry[] = [];
  const contentArea = $(SELECTORS.CONTENT).first();
  if (contentArea.length === 0) { return entries; }

  const headings = contentArea.find('h2, h3');
  if (headings.length === 0) { return entries; }

  headings.each((_, heading) => {
    const term = $(heading).text().trim();
    if (term === '') { return; }

    const level = heading.tagName;
    const parts: string[] = [];
    let next = $(heading).next();

    while (next.length > 0) {
      const tag = next.prop('tagName')?.toLowerCase() ?? '';
      if ((level === 'h2' && (tag === 'h2' || tag === 'h1')) ||
          (level === 'h3' && (tag === 'h3' || tag === 'h2' || tag === 'h1'))) {
        break;
      }
      const html = next.html() ?? '';
      const text = htmlToMarkdown(html).trim();
      if (text !== '') {
        parts.push(text);
      }
      next = next.next();
    }

    const definition = parts.join('\n\n');
    if (definition !== '') {
      entries.push({ term, definition, url: sourceUrl, product });
    }
  });

  return entries;
}

function parseFallbackFormat(
  $: cheerio.CheerioAPI,
  sourceUrl: string,
  product?: string
): GlossaryEntry[] {
  // Try to use h1 as term name instead of generic "Glossary"
  const h1 = $('h1').first().text().trim();
  const termName = h1 !== '' ? h1 : 'Glossary';

  const contentArea = $(SELECTORS.CONTENT).first();
  if (contentArea.length === 0) { return []; }

  const html = contentArea.html() ?? '';
  const content = htmlToMarkdown(html).trim();
  if (content === '') { return []; }

  return [{
    term: termName,
    definition: content,
    url: sourceUrl,
    product,
  }];
}

// ─── Cached TOC Fuse index ──────────────────────────────────────

/**
 * Per-server cache for glossary Fuse.js indexes.
 * Keyed by locale. Stores the Fuse instance alongside the source array
 * reference so we can detect when the underlying TOC data has changed.
 *
 * Uses a WeakMap keyed by CacheProvider so each ServerContext gets its
 * own isolated cache without leaking across requests in runtimes where
 * module scope persists (e.g. Cloudflare Workers).  When a
 * CacheProvider is garbage-collected, its Fuse cache is too.
 */
type GlossaryFuseCache = Map<string, {
  source: FtTocNode[];
  fuse: Fuse<FtTocNode>;
}>;

const fuseCacheByServer = new WeakMap<CacheProvider, GlossaryFuseCache>();

/** Get (or lazily create) the GlossaryFuseCache for the given context. */
function getFuseCacheForContext(ctx: ServerContext): GlossaryFuseCache {
  let cache = fuseCacheByServer.get(ctx.cache);
  if (cache === undefined) {
    cache = new Map();
    fuseCacheByServer.set(ctx.cache, cache);
  }
  return cache;
}

const TOC_FUSE_OPTIONS: IFuseOptions<FtTocNode> = {
  keys: [{ name: 'title', weight: 1.0 }],
  threshold: 0.4,
  includeScore: true,
  ignoreLocation: true,
  minMatchCharLength: 2,
};

/**
 * Get or create a Fuse index for the given TOC entries.
 * Rebuilds the index when the entries array reference changes
 * (i.e., the cache was refreshed).
 */
function getTocFuse(
  fuseCache: GlossaryFuseCache,
  locale: string,
  entries: FtTocNode[],
): Fuse<FtTocNode> {
  const cached = fuseCache.get(locale);
  if (cached?.source === entries) {
    return cached.fuse;
  }

  const fuse = new Fuse(entries, TOC_FUSE_OPTIONS);
  fuseCache.set(locale, { source: entries, fuse });
  return fuse;
}

// ─── Fuzzy matching ─────────────────────────────────────────────

/**
 * Search for matching glossary entries using fuse.js fuzzy matching.
 * Used to rank and filter entries collected from multiple glossary pages.
 */
export function searchGlossaryEntries(
  entries: GlossaryEntry[],
  term: string
): GlossaryEntry[] {
  if (entries.length === 0) { return []; }

  const fuse = new Fuse(entries, {
    keys: [
      { name: 'term', weight: 0.7 },
      { name: 'definition', weight: 0.3 },
    ],
    threshold: 0.3,
    includeScore: true,
    ignoreLocation: true,
    minMatchCharLength: 2,
  });

  const results = fuse.search(term);

  // If fuse.js returns no results, return all entries as-is
  if (results.length === 0) {
    return entries;
  }

  return results.map(r => r.item);
}

// ─── Main lookup ────────────────────────────────────────────────

/**
 * Look up a glossary term across Jamf documentation.
 *
 * Strategy:
 * 1. Fetch glossary TOC from Fluid Topics API (cached)
 * 2. Fuzzy-match term against TOC titles
 * 3. Fetch and parse matching glossary topics
 * 4. Rank results with fuse.js and apply token limit
 */
export async function lookupGlossaryTerm(
  ctx: ServerContext,
  params: {
    term: string;
    product?: ProductId | undefined;
    language?: LocaleId | undefined;
    maxTokens?: number | undefined;
  }
): Promise<GlossaryLookupResult> {
  if (ctx.glossaryProvider) {
    const provided = await ctx.glossaryProvider.lookup(params);
    if (provided !== null) {return provided;}
  }
  const log = ctx.logger.createLogger('glossary');
  const { term, maxTokens = TOKEN_CONFIG.DEFAULT_MAX_TOKENS } = params;
  const locale = params.language ?? DEFAULT_LOCALE;

  log.info(
    `Looking up glossary term: "${term}"` +
    ` (product=${params.product ?? 'all'}, locale=${locale})`
  );

  // Resolve glossary mapId dynamically via MapsRegistry
  let mapId: string | null;
  try {
    mapId = await ctx.mapsRegistry.resolveGlossaryMapId(locale);
  } catch (error) {
    log.error(`Failed to resolve glossary mapId: ${String(error)}`);
    return emptyGlossaryResult(maxTokens);
  }

  if (mapId === null) {
    log.info(`No glossary map found for locale="${locale}"`);
    return emptyGlossaryResult(maxTokens);
  }

  log.info(`Resolved glossary mapId: ${mapId} (locale=${locale})`);

  // Step 1: Fetch glossary TOC (cached after first call)
  let tocEntries: FtTocNode[];
  try {
    tocEntries = await fetchGlossaryToc(ctx, mapId, locale);
  } catch (error) {
    log.error(`Failed to fetch glossary TOC: ${String(error)}`);
    return emptyGlossaryResult(maxTokens);
  }

  if (tocEntries.length === 0) {
    log.info('Glossary TOC is empty');
    return emptyGlossaryResult(maxTokens);
  }

  // Step 2: Fuzzy-match term against TOC titles (Fuse index is cached per locale)
  const fuseCache = getFuseCacheForContext(ctx);
  const tocFuse = getTocFuse(fuseCache, locale, tocEntries);
  const tocMatches = tocFuse.search(term);

  // If no fuzzy match, try exact substring match as fallback
  const matchedTocEntries = tocMatches.length > 0
    ? tocMatches.map(m => m.item)
    : tocEntries.filter(e =>
        e.title.toLowerCase().includes(term.toLowerCase())
      );

  if (matchedTocEntries.length === 0) {
    log.info(`No matching glossary terms found for "${term}"`);
    return emptyGlossaryResult(maxTokens);
  }

  log.info(
    `Found ${matchedTocEntries.length} TOC matches for "${term}"`
  );

  // Step 3: Fetch and parse content for top matches (limit to 10)
  const toFetch = matchedTocEntries.slice(0, 10);

  const tasks = toFetch.map(tocNode => async (): Promise<GlossaryEntry[]> => {
    try {
      const html = await fetchGlossaryContent(
        ctx, mapId, tocNode.contentId, locale
      );

      const displayUrl = buildDisplayUrl(tocNode.prettyUrl);

      // Try parsing with the existing format parsers
      const parsed = parseGlossaryEntries(html, displayUrl);

      // If parsing returned nothing, use TOC title + raw HTML as fallback
      if (parsed.length === 0 && html.trim() !== '') {
        const definition = htmlToMarkdown(html).trim();
        if (definition !== '') {
          return [{
            term: tocNode.title,
            definition,
            url: displayUrl,
          }];
        }
      }

      return parsed;
    } catch (error) {
      log.warning(
        `Failed to fetch glossary entry "${tocNode.title}": ${
        String(error)}`
      );
      return [];
    }
  });

  const fetchedEntries = await limitConcurrency(tasks, 3);
  const allEntries = fetchedEntries.flat();

  if (allEntries.length === 0) {
    return emptyGlossaryResult(maxTokens);
  }

  // Step 4: Rank with fuse.js and apply token limit
  const matchedEntries = searchGlossaryEntries(allEntries, term);

  const glossaryEntryToString = (e: GlossaryEntry): string =>
    `${e.term}: ${e.definition}`;

  const { items: includedEntries, tokenInfo } = truncateItemsToTokenLimit(
    matchedEntries,
    maxTokens,
    glossaryEntryToString,
    1,
    matchedEntries.length,
  );

  log.info(
    `Found ${matchedEntries.length} matches, ` +
    `returning ${includedEntries.length} ` +
    `(truncated=${String(tokenInfo.truncated)})`
  );

  return {
    entries: includedEntries,
    totalMatches: matchedEntries.length,
    tokenInfo,
  };
}
