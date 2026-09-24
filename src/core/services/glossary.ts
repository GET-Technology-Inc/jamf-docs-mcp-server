/**
 * Glossary service for parsing and looking up Jamf documentation glossary terms
 *
 * Uses Fluid Topics API on learn.jamf.com:
 * - GET /api/khub/maps/{mapId}/toc — list all glossary terms
 * - GET /api/khub/maps/{mapId}/topics/{contentId}/content — term HTML
 *
 * Each glossary term is a separate topic, and its `/content` is the
 * definition alone — no heading, no term name (all 123 live topics,
 * 2026-09-24):
 *   <div id="glossentry-6081"><div class="abstract glossdef"><p class="p">…</p></div></div>
 * The term's name comes from its TOC title. `parseGlossaryEntries` also reads
 * a glossterm heading, a definition list, or heading + paragraph markup, but
 * the live glossary serves none of them.
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
import type { Logger } from './interfaces/index.js';
import { cacheKey } from './cache-key.js';
import { truncateItemsToTokenLimit } from './tokenizer.js';
import { limitConcurrency } from '../utils/concurrency.js';
import { HttpError } from '../http-client.js';
import { sanitizeErrorMessage } from '../utils/sanitize.js';

/**
 * The glossary could not be read, so the lookup has no answer to give. That
 * includes "no match": a term can only be said to be missing from a glossary
 * that was checked.
 *
 * Until 2026-09-24 every failure on the way to a definition returned the same
 * empty result as a term the glossary lacks, and the tool answered both with
 * "No glossary entries found" and no `isError`. Reproduced over stdio with
 * learn.jamf.com answering 503 (or unreachable) for the map list, for the
 * glossary TOC, and for the definitions: `MDM` and `Automated Device
 * Enrollment`, both exact entries, came back as terms the glossary does not
 * have. The failure reached nothing but a server log line.
 *
 * The message is written for the caller, whole: it says what could not be
 * fetched, that the term was therefore not checked, and whether trying again
 * may help. The tool returns it as is, with `isError: true`.
 */
export class GlossaryUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'GlossaryUnavailableError';
  }
}

/** Why one request failed, in words a caller can act on. */
function describeFetchFailure(error: unknown): string {
  // Not `error.message`: an HttpError's ends in the request URL, which is
  // noise in a message for the caller, and fetch reports every network
  // failure as the bare "fetch failed", with the reason on `cause`.
  if (error instanceof HttpError) {
    return `HTTP ${String(error.status)}${error.statusText !== '' ? ` ${error.statusText}` : ''}`;
  }
  if (!(error instanceof Error)) { return 'an unknown error'; }
  if (error.name === 'TimeoutError') { return 'the request timed out'; }
  if (error instanceof SyntaxError) { return 'a response that was not valid JSON'; }
  const code = (error.cause as { code?: unknown } | undefined)?.code;
  if (typeof code === 'string') { return `a network error: ${code}`; }
  if (error instanceof TypeError) { return 'a network error'; }
  return sanitizeErrorMessage(error.message);
}

/** The distinct reasons behind several failures, in the order first seen. */
function describeFetchFailures(errors: unknown[]): string {
  return [...new Set(errors.map(describeFetchFailure))].join('; ');
}

const MAY_BE_TEMPORARY = 'This may be temporary: try again in a moment.';

/**
 * A {@link GlossaryUnavailableError} for `term`.
 *
 * `failed` completes "Glossary lookup for "<term>" failed: …". `notChecked`
 * says why the reply is not a "no match". `temporary` is false only where
 * nothing was fetched that could fail: trying again will not help there.
 */
function glossaryUnavailable(
  term: string,
  failed: string,
  notChecked: string,
  options: { temporary?: boolean; cause?: unknown } = {},
): GlossaryUnavailableError {
  const paragraphs = [
    `Glossary lookup for "${term}" failed: ${failed}.`,
    `This is not a "no match": ${notChecked}.`,
  ];
  if (options.temporary !== false) { paragraphs.push(MAY_BE_TEMPORARY); }
  return new GlossaryUnavailableError(
    paragraphs.join('\n\n'),
    options.cause !== undefined ? { cause: options.cause } : undefined,
  );
}

const GLOSSARY_NOT_READ = 'the glossary was not read, so the term was not checked against it';

/** A TOC node's name for a caller: its title, which every candidate has. */
function titleOf(node: FtTocNode): string {
  return node.title ?? node.contentId;
}

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
 *
 * A TOC that yields no terms is returned but not cached. The live glossary
 * has 123, so none means the response was not the glossary's TOC — a root
 * with no children, `[]`, or an object that is not a TOC node. Cached, it
 * answered every lookup with "No glossary entries found" for the article TTL
 * (24 hours by default) after learn.jamf.com had recovered: reproduced
 * 2026-09-24 by serving a childless root for `/toc` once, then looking up
 * `MDM` and `Automated Device Enrollment` directly.
 */
async function fetchGlossaryToc(
  ctx: ServerContext,
  mapId: string
): Promise<FtTocNode[]> {
  const key = cacheKey('glossary-toc', { mapId });

  const cached = await ctx.cache.get<FtTocNode[]>(key);
  if (cached !== null) {
    return cached;
  }

  const nodes = await fetchMapToc(ctx.http, mapId);

  // Flatten: collect all leaf terms (children of the root)
  const terms: FtTocNode[] = [];
  for (const node of nodes) {
    // A node that arrived without `children` is a leaf, so it carries no
    // terms — the same as one with an empty list.
    for (const child of node.children ?? []) {
      // A glossary term *is* its title, so an entry that arrived without one
      // is not usable. Skipping it loses that entry; reading through blindly
      // would throw and lose every other term in the map with it.
      if (child.title === undefined) {
        continue;
      }
      // Skip non-term entries like "Glossary Revision History"
      if (!child.title.toLowerCase().includes('revision history')) {
        terms.push(child);
      }
    }
  }

  if (terms.length > 0) {
    await ctx.cache.set(key, terms, ctx.config.cacheTtl.article);
  }
  return terms;
}

/**
 * Fetch the HTML content of a single glossary topic via ft-client.
 */
async function fetchGlossaryContent(
  ctx: ServerContext,
  mapId: string,
  contentId: string
): Promise<string> {
  const key = cacheKey('glossary-content', { mapId, contentId });

  const cached = await ctx.cache.get<string>(key);
  if (cached !== null) {
    return cached;
  }

  const html = await fetchTopicContent(ctx.http, mapId, contentId);

  await ctx.cache.set(key, html, ctx.config.cacheTtl.article);
  return html;
}

// ─── HTML parsing ───────────────────────────────────────────────

/**
 * Parse glossary entries from HTML content.
 *
 * Priority order:
 * 1. DITA glossentry format (h1.glossterm + .glossdef)
 * 2. Definition list (<dl>/<dt>/<dd>)
 * 3. Heading + paragraph (h2/h3 followed by <p>)
 * 4. Fallback: h1 title + article body content
 *
 * None of these matches what Jamf's glossary serves today. `/content` has no
 * heading and no `article` (0 of 123 live topics, 2026-09-24), so this
 * returns `[]` for every live term and `lookupGlossaryTerm` builds the entry
 * from the TOC title instead.
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
 * The shape of a rendered DITA glossentry page. Jamf's `/content` endpoint
 * serves the `.glossdef` without the `.glossterm`, so this finds no term there.
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
  /** Threshold the cached index was built with — see `thresholdFor`. */
  threshold: number;
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
 * Queries at or below this length are abbreviations, and Fuse's threshold is a
 * fraction of the *pattern* length — so a value tuned for a multi-word term is
 * wildly permissive on a three-letter one. `DEP` at 0.4 returned `patch
 * definition`, which shares no substring with it at all.
 */
const SHORT_QUERY_LENGTH = 4;

/**
 * Threshold for those queries.
 *
 * Measured against the live glossary (125 terms), with ground truth taken from
 * the data rather than invented: every term that publishes its own
 * abbreviation in parentheses — `(LDAP)`, `(MDM)`, `(SSH)`, 18 in all — is a
 * query whose correct answer is that term.
 *
 *   short threshold   top-1     results returned   noise on 2 unanswerable
 *   0.0 - 0.2         22/22     24                 1
 *   0.3               22/22     24                 1
 *   0.4 (previous)    22/22     75                 52
 *
 * 0.4 is a cliff, not a slope. Everything at or below 0.3 is identical on
 * precision, so the value is chosen on what separates them — typo tolerance:
 * `LDPA` still finds LDAP at 0.3 and finds nothing at 0.2 or below.
 *
 * Re-measured 2026-09-24 over the 123 live topics, once `titleNamesShortQuery`
 * began filtering the fuzzy hits. Same 18 abbreviations, plus nine short
 * queries with no entry of their own (`DEP`, `dep`, `ADE`, `APNs`, `APNS`,
 * `VPP`, `SSO`, `ABM`, `PPPC`); pages fetched is the total over all 29
 * queries, each on a cold cache:
 *
 *                     top-1    LDPA   MDMs   absent answered   pages fetched
 *   before the filter
 *   0.0 - 0.2         18/18    no     no     2 of 9            33
 *   0.3               18/18    yes    yes    4 of 9            44
 *   0.4               18/18    yes    yes    8 of 9            163
 *   with it
 *   0.0 - 0.2         18/18    no     no     0 of 9            28
 *   0.3 - 0.5         18/18    yes    yes    0 of 9            31
 *
 * The filter, not the threshold, now decides precision. What the threshold
 * still sets is typo tolerance: 0.3 is the lowest value that keeps `LDPA` and
 * `MDMs`, and 0.4 would extend a slip to three-letter queries as well (`EIF`,
 * `IDs`) — a looser rule, and not one this value was chosen for.
 */
const SHORT_QUERY_THRESHOLD = 0.3;

function isShortQuery(term: string): boolean {
  return term.length <= SHORT_QUERY_LENGTH;
}

function thresholdFor(term: string): number {
  return isShortQuery(term)
    ? SHORT_QUERY_THRESHOLD
    : (TOC_FUSE_OPTIONS.threshold ?? 0.4);
}

/**
 * Whether `title` names the short query `term`, rather than merely containing
 * its letters.
 *
 * A short query is an abbreviation, and what it names is a whole word — Jamf
 * publishes one as `mobile device management (MDM)`. Fuse cannot tell that
 * apart from the same letters inside a longer word: with `ignoreLocation` a
 * three-letter pattern at 0.3 is an unanchored substring search, so `DEP`
 * matched the `dep` of `deployment`; and the one edit it allows a
 * four-letter pattern turned `APNs` into `Apps` and `APFS` — other words, not
 * misspellings of this one.
 *
 * So a fuzzy hit counts only if a word of the title is the query, or the
 * query is one slip from it (see `isOneSlipFrom`): `MDMs`, `LDPA` — the typo
 * #209 set the threshold to keep — and `clam` for `claim` all still land. A
 * changed letter never does, nor an extra one other than a plural `s`: `prof`
 * is the start of `profile`, not `Pro` mistyped. A slip is allowed only where
 * the threshold allows an error at all, which at 0.3 is four letters: below
 * that one letter is a third of the query, and `OS` one slip from `DoS` is not
 * a typo. The downstream `D1GlossaryProvider` applies the same idea: a query
 * of four characters or fewer does not qualify for its prefix tier (#208).
 */
function titleNamesShortQuery(title: string, term: string): boolean {
  if (hasWordBoundaryMatch(title, term)) { return true; }
  const query = term.toLowerCase();
  return Math.floor(query.length * SHORT_QUERY_THRESHOLD) >= 1 &&
    wordsOf(title).some(word => isOneSlipFrom(word, query));
}

/**
 * Whether `typed` is `word` with at most one slip of the keyboard: a missed
 * letter, or two neighbours swapped. A plural `s` counts too.
 *
 * Not a changed letter. Fuse counts it as one edit like the others, but it is
 * the edit that turns one abbreviation into another: `APNs` into `APFS`, or
 * `SDN` into `SDP`, which are two separate entries in the live glossary.
 *
 * Nor an extra letter, other than that `s`. One letter more than a title word
 * is usually the start of a longer word, not a typo of the shorter one.
 * Accepting it answered `prof`, `prop`, `prov` and `prot` with
 * `policy (Jamf Pro)` alone, and `defi` and `exfi` with
 * `Extensible Firmware Interface (EFI)` alone: the letters that start
 * profile, property, provider, protection, definition and exfiltration (123
 * live topics, 2026-09-24). What it costs is a letter added to an
 * abbreviation: `UEFI`, `DDoS` and `sshd` no longer find `EFI`, `DoS` and
 * `SSH`. No definition in the glossary mentions any of the three, so, like
 * `zero-touch deployment` for `DEP`, those were related entries rather than
 * the term's own.
 */
function isOneSlipFrom(word: string, typed: string): boolean {
  if (typed === word || typed === `${word}s`) { return true; }
  if (typed.length === word.length - 1) {
    for (let i = 0; i < word.length; i++) {
      if (word.slice(0, i) + word.slice(i + 1) === typed) { return true; }
    }
    return false;
  }
  if (typed.length !== word.length) { return false; }
  let i = 0;
  while (word.charAt(i) === typed.charAt(i)) { i++; }
  return word.charAt(i) === typed.charAt(i + 1) &&
    word.charAt(i + 1) === typed.charAt(i) &&
    word.slice(i + 2) === typed.slice(i + 2);
}

function wordsOf(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

/**
 * Whether `term` appears in `title` delimited by non-alphanumerics.
 *
 * This is what makes `MDM` prefer `mobile device management (MDM)` over `User
 * Approved MDM`: both contain it, but ranking by fuzzy distance alone put the
 * shorter title first, and fuzzy relevance is not term relevance.
 */
function hasWordBoundaryMatch(title: string, term: string): boolean {
  const escaped = escapeRegExp(term.toLowerCase());
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(title.toLowerCase());
}

/**
 * Whether a word of three letters or more from `query` starts a word of
 * `entryTerm`, or is one slip from one (see `isOneSlipFrom`).
 *
 * The fallback for when the ranker's own fuzzy pass rejects every candidate.
 * It used to return all of them, so `group` reported `property list (PLIST)`
 * and `resource owner password credentials (ROPC)` — candidates the 0.4 TOC
 * pass admitted on `prop` and `ROP` — as two matches the ranker had just
 * turned down.
 *
 * Returning nothing instead loses three kinds of query that land here
 * because 0.3 rejects them too, and that returning everything used to answer
 * by accident. Measured over the 123 live titles on 2026-09-24:
 * - an extra word: `Device Enrollment Program` → `device enrollment`,
 *   `Automated Device Enrollment`;
 * - truncated words: `config prof`, `ext attr`;
 * - a swap in a short word, two edits to Fuse: `deamon`, `cipehr`, `btonet`.
 */
function sharesWordWithQuery(entryTerm: string, query: string): boolean {
  const termWords = wordsOf(entryTerm);
  return wordsOf(query)
    .filter(word => word.length >= 3)
    .some(word => termWords.some(
      termWord => termWord.startsWith(word) || isOneSlipFrom(termWord, word),
    ));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * How definitional a boundary match is. Lower sorts first.
 *
 * Jamf writes an abbreviation into the title of the entry that defines it —
 * `mobile device management (MDM)` — while other entries merely mention it, as
 * `User Approved MDM` does. Both are word-boundary matches, so without this the
 * winner is decided by the order the TOC happens to arrive in. Measured across
 * four orderings of the live glossary (TOC order, locale sort, ASCII sort,
 * reversed), unranked scored 21/22 on two of them and ranked scored 22/22 on
 * all four: the unranked version was right by collation, not by rule.
 */
function boundaryMatchRank(title: string, term: string): number {
  const lowerTitle = title.toLowerCase();
  const lowerTerm = term.toLowerCase();
  if (lowerTitle === lowerTerm) { return 0; }
  if (new RegExp(`\\(${escapeRegExp(lowerTerm)}\\)`).test(lowerTitle)) { return 1; }
  if (lowerTitle.startsWith(lowerTerm)) { return 2; }
  return 3;
}

/**
 * The order `searchGlossaryEntries` puts two word-boundary matches in: the
 * more definitional title first (see `boundaryMatchRank`), then the shorter.
 */
function compareBoundaryMatches(a: string, b: string, term: string): number {
  const byRank = boundaryMatchRank(a, term) - boundaryMatchRank(b, term);
  return byRank !== 0 ? byRank : a.length - b.length;
}

/**
 * Get or create a Fuse index for the given TOC entries.
 * Rebuilds the index when the entries array reference changes
 * (i.e., the cache was refreshed).
 */
function getTocFuse(
  fuseCache: GlossaryFuseCache,
  locale: string,
  entries: FtTocNode[],
  threshold: number,
): Fuse<FtTocNode> {
  // Keyed by threshold as well as source: the threshold is baked into the
  // index at construction, so reusing an index built for a long term would
  // silently apply that threshold to a short one — reintroducing exactly what
  // `thresholdFor` exists to prevent, and only for the second caller.
  const cached = fuseCache.get(locale);
  if (cached?.source === entries && cached.threshold === threshold) {
    return cached.fuse;
  }

  const fuse = new Fuse(entries, { ...TOC_FUSE_OPTIONS, threshold });
  fuseCache.set(locale, { source: entries, fuse, threshold });
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

  // An entry whose *term* contains the query as a word answers it; one that
  // merely scores close does not. This runs before the fuzzy pass because the
  // fuzzy pass also weighs `definition`, and a body-text hit outranking a
  // term-level one is how `DEP` came back as `patch definition` — whose
  // definition happens to contain "dependencies".
  const boundaryMatches = entries
    .filter(e => hasWordBoundaryMatch(e.term, term))
    .sort((a, b) => compareBoundaryMatches(a.term, b.term, term));
  if (boundaryMatches.length > 0) {
    return boundaryMatches;
  }

  const fuse = new Fuse(entries, {
    keys: [
      { name: 'term', weight: 0.7 },
      { name: 'definition', weight: 0.3 },
    ],
    // Unchanged at 0.3. This ranker always used one value, and it is already
    // the short-query threshold — widening it for long queries here would be
    // an unrelated loosening smuggled in by a shared helper.
    threshold: 0.3,
    includeScore: true,
    ignoreLocation: true,
    minMatchCharLength: 2,
  });

  const results = fuse.search(term);

  if (results.length === 0) {
    return entries.filter(e => sharesWordWithQuery(e.term, term));
  }

  return results.map(r => r.item);
}

/** One candidate after its definition was fetched, or failed to be. */
type FetchOutcome =
  | { node: FtTocNode; entries: GlossaryEntry[] }
  | FetchFailure;

interface FetchFailure { node: FtTocNode; error: unknown }

/**
 * Fetch and parse one candidate's definition.
 *
 * A failed fetch is returned, not thrown, and no longer reads as an entry
 * with no definition: it used to come back as `[]`, the same as a page with
 * nothing on it, so a lookup whose every fetch failed answered "No glossary
 * entries found". What a failure means depends on the other candidates, so
 * the caller decides (see `throwIfUnanswerable`).
 */
async function fetchCandidate(
  ctx: ServerContext,
  mapId: string,
  tocNode: FtTocNode,
  log: Logger,
): Promise<FetchOutcome> {
  let html: string;
  try {
    html = await fetchGlossaryContent(ctx, mapId, tocNode.contentId);
  } catch (error) {
    log.warning(
      `Failed to fetch glossary entry "${titleOf(tocNode)}": ${String(error)}`
    );
    return { node: tocNode, error };
  }

  // Parsing keeps the catch it always had: a page that throws in here is
  // dropped, as before. That would be this server's bug, not a failure of
  // learn.jamf.com, and a "could not be fetched" message would misname it.
  try {
    return { node: tocNode, entries: parseCandidate(html, tocNode) };
  } catch (error) {
    log.warning(
      `Failed to parse glossary entry "${titleOf(tocNode)}": ${String(error)}`
    );
    return { node: tocNode, entries: [] };
  }
}

/** The entries in one candidate's `/content`. */
function parseCandidate(html: string, tocNode: FtTocNode): GlossaryEntry[] {
  const displayUrl = buildDisplayUrl(tocNode.prettyUrl);

  // Try parsing with the existing format parsers
  const parsed = parseGlossaryEntries(html, displayUrl);

  // If parsing returned nothing, use TOC title + raw HTML as fallback
  // The TOC title is the only name this fallback has for the term, so
  // an entry without one cannot be emitted here.
  if (parsed.length === 0 && html.trim() !== '' && tocNode.title !== undefined) {
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
}

/**
 * The candidate that could not be fetched but would have led the answer, if
 * its title alone shows that.
 *
 * Only a title that names the term as a word can show it: the ranker puts
 * those first, in `compareBoundaryMatches` order, whatever the definitions
 * say. Where no failed title names the term, its place in the answer turned
 * on a definition that was never read, so nothing is claimed.
 */
function unfetchedLead(
  term: string,
  matched: GlossaryEntry[],
  failures: FetchFailure[],
): string | undefined {
  const lead = [
    ...matched.map(e => ({ title: e.term, fetched: true })),
    ...failures.map(f => ({ title: titleOf(f.node), fetched: false })),
  ]
    .filter(c => hasWordBoundaryMatch(c.title, term))
    .sort((a, b) => compareBoundaryMatches(a.title, b.title, term))[0];
  return lead?.fetched === false ? lead.title : undefined;
}

/**
 * Throw when failed fetches leave the lookup without an answer it can stand
 * behind.
 *
 * - None of the candidates was fetched: there is nothing to answer from.
 * - Some were, and none of them answers the term: that is not a "no match"
 *   either, because the answer may be a candidate that failed.
 * - The entry whose title names the term failed, and a lesser one would take
 *   its place. Live on 2026-09-24, with only its own definition failing,
 *   `Automated Device Enrollment` came back as `device enrollment`, "1 match".
 *
 * Otherwise what was fetched leads the answer a whole read would give, and
 * the result carries `incomplete` (see `incompleteNote`) for the rest: an
 * answer that may be missing its later entries is still an answer, and the
 * caller can fetch them.
 */
function throwIfUnanswerable(
  term: string,
  candidates: number,
  failures: FetchFailure[],
  matched: GlossaryEntry[],
): void {
  if (failures.length === 0) { return; }

  const reason = describeFetchFailures(failures.map(f => f.error));
  const titles = failures.map(f => titleOf(f.node)).join(', ');
  const cause = failures[0]?.error;

  if (failures.length === candidates) {
    const one = candidates === 1;
    throw glossaryUnavailable(
      term,
      `the glossary has ${countOf(candidates, 'entry', 'entries')} whose ` +
        `${one ? 'title is' : 'titles are'} close to it, ` +
        `and ${one ? 'its definition' : 'none of their definitions'} could be fetched from ` +
        `learn.jamf.com (${reason}): ${titles}`,
      `the ${one ? 'entry' : 'entries'} that might define it could not be read`,
      { cause },
    );
  }

  if (matched.length === 0) {
    const fetched = candidates - failures.length;
    const others = fetched === 1
      ? 'The other one was fetched and does not match it'
      : `The other ${String(fetched)} were fetched and do not match it`;
    throw glossaryUnavailable(
      term,
      `${String(failures.length)} of the ${String(candidates)} glossary entries whose titles are ` +
        `close to it could not be fetched from learn.jamf.com (${reason}): ${titles}. ${others}`,
      'it was checked against only part of the glossary, and its entry may be one that could not be fetched',
      { cause },
    );
  }

  const lead = unfetchedLead(term, matched, failures);
  if (lead !== undefined) {
    const more = failures.length - 1;
    throw glossaryUnavailable(
      term,
      `the entry whose title names it, ${lead}, could not be fetched from learn.jamf.com ` +
        `(${reason})${more > 0 ? `, nor could ${countOf(more, 'other candidate', 'other candidates')}` : ''}`,
      'answering from the entries that were fetched would put another entry in its place',
      { cause },
    );
  }
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
 *
 * An empty result means the glossary was read and nothing in it matches.
 * Anything that stops that from being known throws a
 * {@link GlossaryUnavailableError}: the map list or the TOC failing to fetch,
 * every candidate's definition failing, some failing while the rest do not
 * answer the term, or the one that would lead the answer failing (see
 * `throwIfUnanswerable`). When others fail, the result says so in
 * `incomplete`.
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
  if (ctx.glossaryProvider !== undefined) {
    const provided = await ctx.glossaryProvider.lookup(params);
    if (provided !== null) {return provided;}
  }
  const log = ctx.logger.createLogger('glossary');
  // `params.product` is deliberately not read past this point. Jamf publishes
  // one platform-wide glossary: the map and all 125 of its topics have empty
  // `jamf:portal`, `jamf:app` and `jamf:utility` (2026-09-24), so there is
  // nothing to filter by. It stays in the signature because a
  // `GlossaryProvider` receives it.
  const { term, maxTokens = TOKEN_CONFIG.DEFAULT_MAX_TOKENS } = params;
  const locale = params.language ?? DEFAULT_LOCALE;

  log.info(`Looking up glossary term: "${term}" (locale=${locale})`);

  // Every way this can fail before a definition is in hand throws a
  // GlossaryUnavailableError; only a glossary that was read can answer "no
  // match". See that class for why.

  // Resolve glossary mapId dynamically via MapsRegistry
  let mapId: string | null;
  try {
    mapId = await ctx.mapsRegistry.resolveGlossaryMapId(locale);
  } catch (error) {
    log.error(`Failed to resolve glossary mapId: ${String(error)}`);
    throw glossaryUnavailable(
      term,
      'the list of documentation maps, which says where the glossary is, could not be ' +
        `fetched from learn.jamf.com (${describeFetchFailure(error)})`,
      GLOSSARY_NOT_READ,
      { cause: error },
    );
  }

  if (mapId === null) {
    // `resolveGlossaryMapId` already falls back to en-US, so this is a map
    // list with no glossary in it at all, not a locale without one.
    log.error(`No glossary map found for locale="${locale}"`);
    throw glossaryUnavailable(
      term,
      "learn.jamf.com's list of documentation maps has no glossary in it",
      'there was no glossary to check the term against',
      { temporary: false },
    );
  }

  log.info(`Resolved glossary mapId: ${mapId} (locale=${locale})`);

  // Step 1: Fetch glossary TOC (cached after first call)
  let tocEntries: FtTocNode[];
  try {
    tocEntries = await fetchGlossaryToc(ctx, mapId);
  } catch (error) {
    log.error(`Failed to fetch glossary TOC: ${String(error)}`);
    throw glossaryUnavailable(
      term,
      "the glossary's table of contents could not be fetched from learn.jamf.com " +
        `(${describeFetchFailure(error)})`,
      GLOSSARY_NOT_READ,
      { cause: error },
    );
  }

  if (tocEntries.length === 0) {
    log.error('Glossary TOC lists no terms');
    throw glossaryUnavailable(
      term,
      "the glossary's table of contents came back from learn.jamf.com with no terms in it",
      GLOSSARY_NOT_READ,
    );
  }

  // Step 2: narrow the TOC to candidate pages.
  //
  // Selection only — which pages are worth reading. Ranking happens in
  // `searchGlossaryEntries` once the terms themselves are in hand, and doing
  // it here as well was redundant: no query behaved differently with the
  // duplicate pass removed, because anything a word-boundary check would
  // promote is already inside the fuzzy candidate set at this threshold.
  //
  // What does matter here is the threshold, because every candidate is an
  // upstream fetch. Fuse's is a fraction of the pattern length, so a value
  // tuned for a multi-word term admits roughly a fifth of the glossary on a
  // three-letter one.
  const fuseCache = getFuseCacheForContext(ctx);
  const tocFuse = getTocFuse(fuseCache, locale, tocEntries, thresholdFor(term));
  const tocMatches = tocFuse.search(term).map(m => m.item);

  let matchedTocEntries: FtTocNode[];
  if (isShortQuery(term)) {
    // Filtered here, before anything is fetched: a title that does not name
    // the abbreviation is neither an answer nor worth a page read.
    //
    // No substring fallback: every title containing a short query is already
    // a fuzzy hit at 0.3 (an exact substring scores 0), so the fallback could
    // only re-admit what this filter rejects — `deployment`.
    matchedTocEntries = tocMatches.filter(
      e => e.title !== undefined && titleNamesShortQuery(e.title, term),
    );
  } else if (tocMatches.length > 0) {
    matchedTocEntries = tocMatches;
  } else {
    // Last resort: an unanchored substring, which is how a term embedded in a
    // longer word stays reachable when fuzzy found nothing.
    matchedTocEntries = tocEntries.filter(
      e => e.title?.toLowerCase().includes(term.toLowerCase()) === true,
    );
  }

  if (matchedTocEntries.length === 0) {
    log.info(`No matching glossary terms found for "${term}"`);
    return emptyGlossaryResult(maxTokens);
  }

  log.info(
    `Found ${matchedTocEntries.length} TOC matches for "${term}"`
  );

  // Step 3: Fetch and parse content for top matches (limit to 10)
  const toFetch = matchedTocEntries.slice(0, 10);

  const outcomes = await limitConcurrency(
    toFetch.map(tocNode => async (): Promise<FetchOutcome> =>
      await fetchCandidate(ctx, mapId, tocNode, log)),
    3,
  );
  const failures = outcomes.flatMap(o => ('error' in o ? [o] : []));
  const allEntries = outcomes.flatMap(o => ('entries' in o ? o.entries : []));

  // Step 4: Rank with fuse.js and apply token limit
  const matchedEntries = searchGlossaryEntries(allEntries, term);

  throwIfUnanswerable(term, toFetch.length, failures, matchedEntries);

  if (allEntries.length === 0) {
    return emptyGlossaryResult(maxTokens);
  }

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
    ...(failures.length > 0
      ? { incomplete: incompleteNote(term, toFetch.length, failures) }
      : {}),
  };
}

/** "1 entry", "2 entries". */
function countOf(n: number, one: string, many: string): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}

/**
 * What a partly fetched answer is missing, and what to do about it.
 *
 * Every candidate that failed is named, including ones the ranker might have
 * turned down had it seen them: without a definition there is no telling, and
 * a reply that says less than it knows is how this defect hid.
 */
function incompleteNote(
  term: string,
  candidates: number,
  failures: FetchFailure[],
): NonNullable<GlossaryLookupResult['incomplete']> {
  const one = failures.length === 1;
  return {
    unfetched: failures.map(f => ({
      term: titleOf(f.node),
      url: buildDisplayUrl(f.node.prettyUrl),
    })),
    message:
      `Could not fetch ${String(failures.length)} of the ${String(candidates)} glossary entries ` +
      `whose titles are close to "${term}" from learn.jamf.com ` +
      `(${describeFetchFailures(failures.map(f => f.error))}): ` +
      `${failures.map(f => titleOf(f.node)).join(', ')}. ` +
      `These results may be missing ${one ? 'its definition' : 'their definitions'}. ` +
      `This may be temporary: repeat the lookup, or fetch ${one ? 'it' : 'them'} with jamf_docs_get_article.`,
  };
}
