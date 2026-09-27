/**
 * What core reads from an injected provider's answer, before anything else
 * reads it.
 *
 * The provider interfaces type their answers, but TypeScript cannot check a
 * value a provider built from untyped rows: a database `NULL`, a number where
 * a string belongs, a row that is not an object. Until 2026-09-28 core read
 * such an answer as it came, and one bad field failed the whole reply it was
 * in. A SearchProvider result with `version: null` turned the search into
 * "Output validation error", one with `breadcrumb: null` into a "Search
 * error", and a `null` row, or an answer of `undefined`, into "No results
 * found". An ArticleProvider, GlossaryProvider or TocProvider answer with a
 * `null` field did the same to its tool. #348 had guarded two search fields,
 * in the tool, after the service had already read them. A MapsProvider's
 * maps are read by the same rule in provider-maps.ts.
 *
 * So each answer is read here, once, where it enters core. The rule is the
 * same for every provider:
 *
 * - An optional field whose value is not of its declared type, `null`
 *   included, is read as absent: the provider did not say.
 * - A row of a list (a search result, a glossary or TOC entry) that core
 *   cannot use without one of its required fields is left out, and the rest
 *   are used. Where Fluid Topics has a stand-in for a missing field (a title
 *   of "Untitled", a snippet made of the title and product), the row gets
 *   that stand-in instead, as a Fluid Topics row would. A count the provider
 *   set for the rows (a glossary's `totalMatches`, a TOC's `totalItems`) is
 *   reduced by the rows left out, so it describes the rows the reply has.
 * - An answer core cannot use as a whole is read as `null`: the default
 *   implementation answers, as it does when the provider returns `null`. So
 *   is a list whose every row was left out, which would otherwise say that
 *   nothing matched when the provider matched something.
 *
 * What is left out, read as absent or replaced is logged once per answer,
 * naming the fields: as a warning, except for an optional field that is
 * `null`, which is how a database row says "absent", and is logged at debug.
 * An answer that needs none of it comes back as the same objects.
 *
 * A field's declared type is taken from the outputSchema that publishes it,
 * wherever one does. The value checked is then the value published, so a
 * provider's value cannot fail the client's check of the reply against that
 * schema, and a result field declared on `SearchOutputSchema` later is checked
 * with no change here. Each table below `satisfies` a `Record` over its type's
 * keys, so a field added to a provider type without saying how it is checked
 * does not compile.
 *
 * @module
 */

import { z } from 'zod';
import { DOC_TYPE_IDS } from '../constants.js';
import {
  ArticleOutputSchema,
  GlossaryLookupOutputSchema,
  SearchOutputSchema,
  TocOutputSchema,
} from '../schemas/output.js';
import type {
  FetchArticleResult,
  FetchTocResult,
  GlossaryEntry,
  GlossaryLookupResult,
  PaginationInfo,
  SearchResult,
  TocEntry,
  TokenInfo,
} from '../types.js';
import type { Logger } from './interfaces/index.js';
import { titleProductSnippet } from './snippet.js';

// ─── Reading one object ─────────────────────────────────────────

type Fields = Record<string, z.ZodType>;
type Row = Record<string, unknown>;

function isRow(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** One object, read against its fields' schemas. */
interface Read {
  /** The object without the optional fields that did not fit: itself when none. */
  kept: Row;
  /** Optional fields that did not fit, and were removed. */
  absent: string[];
  /** Required fields that did not fit, left for the caller to decide. */
  missing: string[];
}

/**
 * Check each of `fields` on `row`. A field is optional when its schema takes
 * `undefined`. Keys `fields` does not list are left alone.
 */
function read(row: Row, fields: Fields): Read {
  const absent: string[] = [];
  const missing: string[] = [];
  for (const [field, schema] of Object.entries(fields)) {
    if (schema.safeParse(row[field]).success) { continue; }
    (schema.safeParse(undefined).success ? absent : missing).push(field);
  }
  if (absent.length === 0) { return { kept: row, absent, missing }; }
  const kept = { ...row };
  for (const field of absent) { Reflect.deleteProperty(kept, field); }
  return { kept, absent, missing };
}

/** Whether a list read row by row came back as the rows it was given. */
function sameRows(taken: readonly unknown[], given: readonly unknown[]): boolean {
  return taken.length === given.length && taken.every((row, i) => row === given[i]);
}

/** What a left-out row is, one and many, and why it was left out. */
interface RowName {
  one: string;
  many: string;
  why: string;
}

/** What one answer lost, gathered for its log lines. */
class Departures {
  /**
   * Optional fields that were `null`, read as absent. Logged at debug: `null`
   * is how a database row says a column is empty, so it can come on every
   * answer without anything being wrong.
   */
  private readonly nulls = new Set<string>();
  /** Optional fields of another type, read as absent. */
  private readonly mistyped = new Set<string>();
  /** Required fields given a stand-in. */
  private readonly replaced = new Set<string>();
  private leftOut = 0;

  constructor(private readonly what: string) {}

  /** Note the optional fields `read` found unfit on `row`, and read as absent. */
  absent(row: Row, fields: readonly string[]): void {
    for (const field of fields) { (row[field] === null ? this.nulls : this.mistyped).add(field); }
  }

  /** Note the required fields given a stand-in. */
  standIn(fields: readonly string[]): void {
    for (const field of fields) { this.replaced.add(field); }
  }

  drop(): void {
    this.leftOut += 1;
  }

  /**
   * Log what there is to say. `rows` names what a left-out row is, and `of`
   * how many were given.
   */
  report(log: Logger, rows?: RowName & { of?: number }): void {
    const parts: string[] = [];
    if (this.leftOut > 0 && rows !== undefined) {
      const of = rows.of !== undefined ? ` of ${String(rows.of)}` : '';
      const name = this.leftOut === 1 && rows.of === undefined ? rows.one : rows.many;
      parts.push(`left out ${String(this.leftOut)}${of} ${name} (${rows.why})`);
    }
    if (this.mistyped.size > 0) {
      parts.push(`read as absent, not being of the declared type: ${[...this.mistyped].join(', ')}`);
    }
    if (this.replaced.size > 0) {
      const replaced = [...this.replaced].join(', ');
      parts.push(`given the stand-in a Fluid Topics one gets, not being of the declared type: ${replaced}`);
    }
    if (parts.length > 0) { log.warning(`${this.what}: ${parts.join('; ')}`); }
    if (this.nulls.size > 0) {
      log.debug(`${this.what}: read as absent, being null: ${[...this.nulls].join(', ')}`);
    }
  }
}

/** Name what a provider answered with, for a warning. */
function describe(value: unknown): string {
  if (value === undefined) { return 'undefined'; }
  if (Array.isArray(value)) { return 'an array'; }
  return typeof value === 'object' ? 'an object' : `a ${typeof value}`;
}

/**
 * Read an answer as `null` when it is one core cannot use. `null` itself is
 * the documented fall-through and says nothing; anything else is logged.
 */
function unusable(log: Logger, what: string, answer: unknown, why: string): null {
  if (answer !== null) {
    log.warning(`${what} answered with ${why}; read as null, so the default implementation answers`);
  }
  return null;
}

// ─── Shared shapes ──────────────────────────────────────────────

const TOKEN_INFO: z.ZodType<TokenInfo> = z.object({
  tokenCount: z.number(),
  truncated: z.boolean(),
  maxTokens: z.number(),
});

const PAGINATION: z.ZodType<PaginationInfo> = z.object({
  page: z.number(),
  pageSize: z.number(),
  totalPages: z.number(),
  totalItems: z.number(),
  hasNext: z.boolean(),
  hasPrev: z.boolean(),
});

/** A list read row by row below, so only its being a list is checked here. */
const ROWS = z.array(z.unknown());

// ─── SearchProvider ─────────────────────────────────────────────

/**
 * Every field of a `SearchResult`, as `SearchOutputSchema` declares it.
 *
 * The search tool publishes every result field it does not withhold, and its
 * `SEARCH_RESULT_FIELD_DISPOSITION` checks do not compile unless the schema
 * declares exactly those. So spreading the schema's result item checks every
 * published field, one declared later included. `satisfies` stops a withheld
 * field compiling until it is given a schema here.
 *
 * Two fields are narrower or wider in `SearchResult` than in the schema.
 */
const SEARCH_RESULT_FIELDS = {
  ...SearchOutputSchema.shape.results.element.shape,
  // `null` is what Fluid Topics sends for an unclassified result; the tool
  // publishes it as the '' the schema declares.
  product: z.string().nullable(),
  // The docType filter reads it as a document type id. One that is not, such
  // as the "Technical Documentation" label, filtered the result out, where
  // Fluid Topics ignores a label it does not know.
  docType: z.enum(DOC_TYPE_IDS).optional(),
} satisfies Record<keyof SearchResult, z.ZodType>;

/** The required result fields a Fluid Topics result has a stand-in for. */
const SEARCH_STAND_INS: ReadonlySet<string> = new Set<keyof SearchResult>(['title', 'snippet', 'product']);

/**
 * One SearchProvider result as core reads it, or null to leave it out.
 *
 * - No `url` string: left out. Nothing can fetch it or tell it from another
 *   version of its topic, and the Fluid Topics path drops a result with no url.
 *   So is a result without any other required field that has no stand-in.
 * - No `title` string: "Untitled", as `buildSearchResult` titles a Fluid
 *   Topics result without one.
 * - No `snippet` string: the title and product, which is what `cleanSnippet`
 *   falls back to for an excerpt too short to use. `showUnderProduct` and the
 *   topic filter recognise that form, as they do on the Fluid Topics path.
 * - No `product` string: `null`, as for a Fluid Topics result Jamf does not
 *   classify.
 */
function readSearchResult(row: unknown, departures: Departures): SearchResult | null {
  if (!isRow(row)) {
    departures.drop();
    return null;
  }
  const { kept, absent, missing } = read(row, SEARCH_RESULT_FIELDS);
  if (missing.some(field => !SEARCH_STAND_INS.has(field))) {
    departures.drop();
    return null;
  }
  departures.absent(row, absent);
  departures.standIn(missing);
  if (missing.length === 0) { return kept as unknown as SearchResult; }

  const title = typeof row.title === 'string' ? row.title : 'Untitled';
  const product = typeof row.product === 'string' ? row.product : null;
  return {
    ...kept,
    title,
    product,
    snippet: typeof row.snippet === 'string' ? row.snippet : titleProductSnippet(title, product),
  } as unknown as SearchResult;
}

/**
 * A SearchProvider's answer as core reads it: its results, or `null` to search
 * Fluid Topics instead.
 *
 * An answer that is not an array is read as `null`. Until 2026-09-28
 * `undefined` threw inside the service and the tool answered "No results
 * found", where the interface says `null` falls through. So is one whose every
 * result was left out: read as it stands, it would say "No results found" for
 * a query the provider matched. An empty array is the provider's own "no
 * results", and is kept.
 */
export function readSearchProviderResults(answer: unknown, log: Logger): SearchResult[] | null {
  const what = 'SearchProvider';
  if (!Array.isArray(answer)) {
    return unusable(log, what, answer, `${describe(answer)}, not an array of results`);
  }
  const departures = new Departures(what);
  const results = answer.flatMap((row: unknown) => {
    const result = readSearchResult(row, departures);
    return result === null ? [] : [result];
  });
  if (answer.length > 0 && results.length === 0) {
    return unusable(log, what, answer, 'results none of which is an object with a url string');
  }
  departures.report(log, { one: 'result', many: 'results', why: 'not an object with a url string', of: answer.length });
  return results;
}

// ─── ArticleProvider ────────────────────────────────────────────

const {
  title, content, url, product, version, lastUpdated, breadcrumb,
  mapId, contentId, versionStatus, contentLocale, navigation, sections,
} = ArticleOutputSchema.shape;

/**
 * Every field of a `FetchArticleResult`. The ones get-article publishes are
 * `ArticleOutputSchema`'s own schemas; its `ARTICLE_FIELD_DISPOSITION` lists
 * which those are.
 */
const ARTICLE_FIELDS = {
  title, content, url, product, version, lastUpdated, breadcrumb,
  mapId, contentId, versionStatus, contentLocale, navigation, sections,
  // Rendered in the markdown only.
  relatedArticles: z.array(z.object({ title: z.string(), url: z.string() })).optional(),
  sectionNotFound: z.boolean().optional(),
  tokenInfo: TOKEN_INFO,
} satisfies Record<keyof FetchArticleResult, z.ZodType>;

/**
 * An ArticleProvider's article as core reads it, or `null` when core cannot
 * use it, so the call goes on as for a `null` (to `getArticle`, then to Fluid
 * Topics).
 *
 * Its `title`, `content`, `url`, `tokenInfo` and `sections` are what the reply
 * is made of, and none has a stand-in: the body is the provider's, and so are
 * the counts and outline that describe it. Fluid Topics has the same article
 * under the same pair, whole.
 */
export function readProviderArticle(answer: unknown, log: Logger): FetchArticleResult | null {
  const what = 'ArticleProvider';
  if (!isRow(answer)) {
    return unusable(log, what, answer, `${describe(answer)}, not an article`);
  }
  const { kept, absent, missing } = read(answer, ARTICLE_FIELDS);
  if (missing.length > 0) {
    return unusable(log, what, answer, `an article with fields not of the declared type (${missing.join(', ')})`);
  }
  const departures = new Departures(what);
  departures.absent(answer, absent);
  departures.report(log);
  return kept as unknown as FetchArticleResult;
}

// ─── GlossaryProvider ───────────────────────────────────────────

/** Every field of a `GlossaryEntry`, as `GlossaryLookupOutputSchema` declares it. */
const GLOSSARY_ENTRY_FIELDS = {
  ...GlossaryLookupOutputSchema.shape.entries.element.shape,
} satisfies Record<keyof GlossaryEntry, z.ZodType>;

const { totalMatches, truncatedContent, incomplete } = GlossaryLookupOutputSchema.shape;

const GLOSSARY_RESULT_FIELDS = {
  entries: ROWS,
  totalMatches,
  truncatedContent,
  incomplete,
  tokenInfo: TOKEN_INFO,
} satisfies Record<keyof GlossaryLookupResult, z.ZodType>;

/**
 * A GlossaryProvider's answer as core reads it, or `null` to look the term up
 * in the glossary on learn.jamf.com instead.
 *
 * An entry without a `term`, `definition` and `url` string is left out, and
 * `totalMatches` is reduced by the entries left out: it counts the entries
 * shown and those `truncatedContent` lists, and the ones left out are neither.
 * `null` is also the reading of an answer without usable `entries`,
 * `totalMatches` or `tokenInfo`, which the reply is decided on, and of one
 * whose every entry was left out: read as it stands, that answer would say
 * "No glossary entries found" for a term the provider matched.
 */
export function readGlossaryProviderResult(answer: unknown, log: Logger): GlossaryLookupResult | null {
  const what = 'GlossaryProvider';
  if (!isRow(answer)) {
    return unusable(log, what, answer, `${describe(answer)}, not a lookup result`);
  }
  const { kept, absent, missing } = read(answer, GLOSSARY_RESULT_FIELDS);
  if (missing.length > 0) {
    return unusable(log, what, answer, `a result with fields not of the declared type (${missing.join(', ')})`);
  }
  const departures = new Departures(what);
  departures.absent(answer, absent);
  const given = kept.entries as unknown[];
  const entries = given.flatMap((row: unknown) => {
    if (!isRow(row)) { departures.drop(); return []; }
    const entry = read(row, GLOSSARY_ENTRY_FIELDS);
    if (entry.missing.length > 0) { departures.drop(); return []; }
    departures.absent(row, entry.absent);
    return [entry.kept];
  });
  if (given.length > 0 && entries.length === 0) {
    return unusable(log, what, answer, 'entries none of which is an object with a term, definition and url string');
  }
  departures.report(log, {
    one: 'entry', many: 'entries', why: 'not an object with a term, definition and url string', of: given.length,
  });
  if (sameRows(entries, given)) { return kept as unknown as GlossaryLookupResult; }
  const leftOut = given.length - entries.length;
  const matches = Math.max(entries.length, (kept.totalMatches as number) - leftOut);
  return { ...kept, entries, totalMatches: matches } as unknown as GlossaryLookupResult;
}

// ─── TocProvider ────────────────────────────────────────────────

const { title: entryTitle, url: entryUrl, contentId: entryContentId } = TocOutputSchema.shape.entries.element.shape;

/** Every field of a `TocEntry`; `title`, `url` and `contentId` are published as `TocOutputSchema` declares them. */
const TOC_ENTRY_FIELDS = {
  title: entryTitle,
  url: entryUrl,
  contentId: entryContentId,
  tocId: z.string().optional(),
  children: ROWS.optional(),
} satisfies Record<keyof TocEntry, z.ZodType>;

const { mapId: tocMapId, paginationNote, truncatedEntry } = TocOutputSchema.shape;

const TOC_RESULT_FIELDS = {
  toc: ROWS,
  pagination: PAGINATION,
  tokenInfo: TOKEN_INFO,
  mapId: tocMapId,
  paginationNote,
  truncatedEntry,
  resolvedLocale: z.string().optional(),
} satisfies Record<keyof FetchTocResult, z.ZodType>;

/**
 * TOC entries as core reads them. One without a `url` string is left out with
 * its sub-entries, which have no place without it, and so is one without any
 * other required field but its title. One without a `title` string is
 * "Untitled", as `transformFtTocToTocEntries` titles a Fluid Topics node
 * without one. Returns `rows` itself when nothing changed.
 */
function readTocEntries(rows: readonly unknown[], departures: Departures): TocEntry[] {
  const entries = rows.flatMap((row: unknown): TocEntry[] => {
    if (!isRow(row)) {
      departures.drop();
      return [];
    }
    const { kept, absent, missing } = read(row, TOC_ENTRY_FIELDS);
    if (missing.some(field => field !== 'title')) {
      departures.drop();
      return [];
    }
    departures.absent(row, absent);
    departures.standIn(missing);
    let entry = kept;
    if (missing.includes('title')) { entry = { ...entry, title: 'Untitled' }; }
    const children = entry.children as unknown[] | undefined;
    if (children !== undefined) {
      const readChildren = readTocEntries(children, departures);
      if (readChildren !== children) { entry = { ...entry, children: readChildren }; }
    }
    return [entry as unknown as TocEntry];
  });
  return sameRows(entries, rows) ? rows as TocEntry[] : entries;
}

/**
 * Rows at every depth, each with the rows of its `children` array: what
 * `countTocEntries` counts, for rows not yet read.
 */
function countRows(rows: readonly unknown[]): number {
  return rows.reduce<number>(
    (count, row) => count + 1 + (isRow(row) && Array.isArray(row.children) ? countRows(row.children) : 0),
    0,
  );
}

/**
 * A TocProvider's answer as core reads it, or `null` to fetch the table of
 * contents from learn.jamf.com instead.
 *
 * `pagination.totalItems` counts the whole tree, nested entries included
 * (`paginateTocEntries`), so it is reduced by every entry left out of this
 * page, sub-entries included. The pages stay as the provider made them:
 * `totalPages`, `hasNext` and `hasPrev` are kept, since this page still holds
 * at least one top-level entry and the others are untouched.
 *
 * `null` is also the reading of an answer without a usable `toc`, `pagination`
 * or `tokenInfo`, which every page is built from, and of one whose every
 * top-level entry was left out.
 */
export function readTocProviderResult(answer: unknown, log: Logger): FetchTocResult | null {
  const what = 'TocProvider';
  if (!isRow(answer)) {
    return unusable(log, what, answer, `${describe(answer)}, not a table of contents`);
  }
  const { kept, absent, missing } = read(answer, TOC_RESULT_FIELDS);
  if (missing.length > 0) {
    return unusable(log, what, answer, `a result with fields not of the declared type (${missing.join(', ')})`);
  }
  const departures = new Departures(what);
  departures.absent(answer, absent);
  const given = kept.toc as unknown[];
  const toc = readTocEntries(given, departures);
  if (given.length > 0 && toc.length === 0) {
    return unusable(log, what, answer, 'a toc none of whose entries is an object with a url string');
  }
  // Counted at every depth, so not out of the top-level entries given.
  departures.report(log, {
    one: 'entry, with its sub-entries', many: 'entries, with their sub-entries', why: 'not an object with a url string',
  });
  if (toc === given) { return kept as unknown as FetchTocResult; }
  const leftOut = countRows(given) - countRows(toc);
  if (leftOut === 0) { return { ...kept, toc } as unknown as FetchTocResult; }
  const pagination = kept.pagination as PaginationInfo;
  const totalItems = Math.max(countRows(toc), pagination.totalItems - leftOut);
  return { ...kept, toc, pagination: { ...pagination, totalItems } } as unknown as FetchTocResult;
}
