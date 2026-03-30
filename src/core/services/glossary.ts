/**
 * Glossary service for parsing and looking up Jamf documentation glossary terms
 *
 * Jamf's glossary uses DITA glossentry format where each term is a separate page:
 *   <h1 class="glossterm">Term Name</h1>
 *   <div class="glossdef"><p>Definition text</p></div>
 *
 * Also supports fallback formats:
 * - Definition list (<dl>/<dt>/<dd>)
 * - Heading + paragraph (h2/h3 followed by <p>)
 *
 * Uses fuse.js for fuzzy ranking of collected entries.
 */

import Fuse from 'fuse.js';
import * as cheerio from 'cheerio';
import TurndownService from 'turndown';

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
  SearchParams,
  TokenInfo,
} from '../types.js';
import {
  searchDocumentation,
  fetchHtml,
  transformToBackendUrl,
  transformToFrontendUrl,
} from './scraper.js';
import type { ServerContext } from '../types/context.js';
import { estimateTokens } from './tokenizer.js';
import { limitConcurrency } from '../utils/concurrency.js';

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});

/**
 * Parse glossary entries from HTML content.
 *
 * Priority order:
 * 1. DITA glossentry format (h1.glossterm + .glossdef) — Jamf's actual format
 * 2. Definition list (<dl>/<dt>/<dd>)
 * 3. Heading + paragraph (h2/h3 followed by <p>)
 * 4. Fallback: h1 title + article body content
 */
export function parseGlossaryEntries(html: string, sourceUrl: string, product?: string): GlossaryEntry[] {
  const $ = cheerio.load(html);

  // Remove unwanted elements
  $(SELECTORS.REMOVE).remove();

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
function parseDitaGlossentry($: cheerio.CheerioAPI, sourceUrl: string, product?: string): GlossaryEntry[] {
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
    definition = turndown.turndown(defHtml).trim();
  }

  // If no glossdef, try to get any content after the heading
  if (definition === '') {
    const article = $('article').first();
    if (article.length > 0) {
      // Get all content except the h1 itself
      const clone = article.clone();
      clone.find('h1').remove();
      const bodyHtml = clone.html() ?? '';
      definition = turndown.turndown(bodyHtml).trim();
    }
  }

  if (definition === '') { return []; }

  return [{ term, definition, url: sourceUrl, product }];
}

function parseDlFormat($: cheerio.CheerioAPI, sourceUrl: string, product?: string): GlossaryEntry[] {
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
        ddParts.push(turndown.turndown(ddHtml).trim());
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

function parseHeadingFormat($: cheerio.CheerioAPI, sourceUrl: string, product?: string): GlossaryEntry[] {
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
      const text = turndown.turndown(html).trim();
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

function parseFallbackFormat($: cheerio.CheerioAPI, sourceUrl: string, product?: string): GlossaryEntry[] {
  // Try to use h1 as term name instead of generic "Glossary"
  const h1 = $('h1').first().text().trim();
  const termName = h1 !== '' ? h1 : 'Glossary';

  const contentArea = $(SELECTORS.CONTENT).first();
  if (contentArea.length === 0) { return []; }

  const html = contentArea.html() ?? '';
  const content = turndown.turndown(html).trim();
  if (content === '') { return []; }

  return [{
    term: termName,
    definition: content,
    url: sourceUrl,
    product,
  }];
}

/**
 * Search for matching glossary entries using fuse.js fuzzy matching.
 * Used to rank and filter entries collected from multiple glossary pages.
 */
export function searchGlossaryEntries(entries: GlossaryEntry[], term: string): GlossaryEntry[] {
  if (entries.length === 0) { return []; }

  const fuse = new Fuse(entries, {
    keys: [
      { name: 'term', weight: 0.7 },
      { name: 'definition', weight: 0.3 },
    ],
    threshold: 0.5,
    includeScore: true,
    ignoreLocation: true,
    minMatchCharLength: 2,
  });

  const results = fuse.search(term);

  // If fuse.js returns no results, return all entries as-is
  // (the search API already filtered for relevance)
  if (results.length === 0) {
    return entries;
  }

  return results.map(r => r.item);
}

/**
 * Look up a glossary term across Jamf documentation.
 *
 * Strategy:
 * 1. Search via Zoomin API with docType=glossary to find glossary pages
 * 2. Fetch and parse each glossary page (with caching)
 * 3. Use fuse.js to rank matching terms
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
  const log = ctx.logger.createLogger('glossary');
  const { term, product, language, maxTokens = TOKEN_CONFIG.DEFAULT_MAX_TOKENS } = params;
  const locale = language ?? DEFAULT_LOCALE;

  log.info(`Looking up glossary term: "${term}" (product=${product ?? 'all'}, locale=${locale})`);

  // Step 1: Search for glossary pages via Zoomin API
  const searchParams: SearchParams = {
    query: term,
    product,
    docType: 'glossary',
    language: locale,
    limit: 10,
    page: 1,
  };

  const searchResult = await searchDocumentation(ctx, searchParams);

  // If docType filter was relaxed, it means no actual glossary pages were found
  const docTypeRelaxed = searchResult.filterRelaxation?.removed.includes('docType') === true;

  if (searchResult.results.length === 0 || docTypeRelaxed) {
    log.info(docTypeRelaxed
      ? 'docType filter was relaxed — no actual glossary pages found'
      : 'No glossary pages found via search API');
    return {
      entries: [],
      totalMatches: 0,
      tokenInfo: { tokenCount: 0, truncated: false, maxTokens },
    };
  }

  // Step 2: Fetch and parse glossary pages concurrently (with caching)
  const seenUrls = new Set<string>();
  const uniqueResults = searchResult.results.filter(r => {
    if (seenUrls.has(r.url)) { return false; }
    seenUrls.add(r.url);
    return true;
  });

  const tasks = uniqueResults.map(result => async () => {
    try {
      return await fetchAndParseGlossaryPage(ctx, result.url, locale, result.product ?? undefined);
    } catch (error) {
      log.warning(`Failed to fetch glossary page ${result.url}: ${String(error)}`);
      return [];
    }
  });

  const fetchedEntries = await limitConcurrency(tasks, 3);
  const allEntries = fetchedEntries.flat();

  if (allEntries.length === 0) {
    return {
      entries: [],
      totalMatches: 0,
      tokenInfo: { tokenCount: 0, truncated: false, maxTokens },
    };
  }

  // Step 3: Rank with fuse.js (search API already filtered, fuse.js re-ranks)
  const matchedEntries = searchGlossaryEntries(allEntries, term);

  // Step 4: Apply token limit
  const includedEntries: GlossaryEntry[] = [];
  let runningTokens = 0;
  let truncated = false;

  for (const entry of matchedEntries) {
    const entryTokens = estimateTokens(`${entry.term}: ${entry.definition}`);
    if (runningTokens + entryTokens > maxTokens) {
      truncated = true;
      break;
    }
    includedEntries.push(entry);
    runningTokens += entryTokens;
  }

  const tokenInfo: TokenInfo = {
    tokenCount: runningTokens,
    truncated,
    maxTokens,
  };

  log.info(`Found ${matchedEntries.length} matches, returning ${includedEntries.length} (truncated=${String(truncated)})`);

  return {
    entries: includedEntries,
    totalMatches: matchedEntries.length,
    tokenInfo,
  };
}

/**
 * Fetch a glossary page and parse its entries (with caching)
 */
async function fetchAndParseGlossaryPage(
  ctx: ServerContext,
  url: string,
  locale: string,
  product?: string,
): Promise<GlossaryEntry[]> {
  const log = ctx.logger.createLogger('glossary');
  const cacheKey = `${locale}:glossary:${url}`;

  // Check cache
  const cached = await ctx.cache.get<GlossaryEntry[]>(cacheKey);
  if (cached !== null) {
    log.info(`Cache hit for glossary page: ${url}`);
    return cached;
  }

  // Fetch raw HTML (reuses scraper's throttle + error handling)
  log.info(`Fetching glossary page: ${url}`);
  const backendUrl = transformToBackendUrl(url);
  const html = await fetchHtml(ctx, backendUrl, locale);

  // Transform URL to frontend format for display
  const displayUrl = transformToFrontendUrl(url);
  const entries = parseGlossaryEntries(html, displayUrl, product);

  // Cache parsed entries
  await ctx.cache.set(cacheKey, entries, ctx.config.cacheTtl.article);
  log.info(`Cached ${entries.length} glossary entries from: ${url}`);

  return entries;
}
