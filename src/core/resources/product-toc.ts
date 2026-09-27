/**
 * The body of `jamf://products/{productId}/toc`.
 *
 * The resource used to answer with page 1 of the table of contents at
 * `maxTokens: 20000`, as though that were all of it. A page holds at most 10
 * top-level entries, so live on 2026-09-28 it held 10 of Jamf Pro's 20 (289
 * of 794 entries) beside `totalEntries: 794`, and 11 of the 28 products it
 * serves came back cut the same way, with nothing in the body to say so. The
 * budget was never what cut them: the whole of Jamf Pro, the largest, costs
 * 8447 tokens as the TOC services count them.
 *
 * So the resource now reads every page and holds them all, up to
 * {@link TOC_RESOURCE_MAX_TOKENS}, and says in its body whether it holds the
 * whole tree. A resource has no `page` to ask for the rest with, so when it
 * does not, `missing` says what is left out and, where one can, which
 * `jamf_docs_get_toc` call returns it.
 *
 * Until 2026-09-28 the body also held every entry's `contentId` (all 794 of
 * Jamf Pro's, live) without the map they belong to, so none of them could be
 * used: `jamf_docs_get_article` fetches by `mapId` + `contentId`, and a
 * contentId does not name its map. Live that day, the one for "General
 * Requirements" under Declarative Device Management is in the 11.31.0 map as
 * well, and fetches the 11.31.0 article with it. The body now names the map
 * its entries were read from, as `jamf_docs_get_toc` does.
 */

import { JAMF_PRODUCTS, PAGINATION_CONFIG, TOKEN_CONFIG, type ProductId } from '../constants.js';
import type { ServerContext } from '../types/context.js';
import type { FetchTocResult, TocEntry, TocTruncatedEntry } from '../types.js';
import { fetchTableOfContents } from '../services/toc-service.js';
import { countTocEntries } from '../services/toc-helpers.js';

/**
 * The most of a table of contents the resource holds, in tokens as
 * `jamf_docs_get_toc` counts `maxTokens`: from entry titles alone.
 *
 * The same 20000 the resource has always asked for, which was meant to hold a
 * whole product; the page size, not this, was what cut it. Live on
 * 2026-09-28 every product it serves fits: Jamf Pro is the largest at 8447,
 * then RapidIdentity at 5435 and Jamf Connect at 5009. The JSON carries each
 * entry's url and ids as well, 30 to 42 bytes to one such token across the
 * products over 1000 of them, so Jamf Pro is 267 KB and a body at this bound
 * would be 600 to 850 KB.
 *
 * It is also the `maxTokens` the pages are read at, so the rest of a larger
 * tree is exactly the pages after the last one held, asked for the same way.
 */
export const TOC_RESOURCE_MAX_TOKENS = 20000;

/** What `jamf://products/{productId}/toc` answers with. */
export interface ProductTocBody {
  product: string;
  /**
   * The map the entries were read from: with an entry's `contentId`, the pair
   * `jamf_docs_get_article` fetches that entry by. A map is one version of
   * the documentation in one language, so the pair needs nothing else.
   * Absent when the pages held do not name one map (see `mapOf`).
   */
  mapId?: string;
  /** Entries in the whole tree, nested ones included. */
  totalEntries: number;
  /** Whether `toc` is the whole tree. */
  complete: boolean;
  /** Entries in `toc`, nested ones included. Only when not `complete`. */
  shownEntries?: number;
  /** What `toc` leaves out, and how to get it. Only when not `complete`. */
  missing?: string;
  toc: TocEntry[];
}

/** The pages after the last one the resource holds. */
interface RestOfToc {
  firstTitle: string;
  fromPage: number;
  toPage: number;
}

/** A page held although it came back cut to fit, and what it says it cut. */
interface CutPage {
  page: number;
  /** Absent when the source reports `truncated` without saying what it cut. */
  entry: TocTruncatedEntry | undefined;
}

/**
 * Why the read ended before the source's last page, other than the budget:
 * the source did not page as asked, or it has pages past the last one `page`
 * accepts. `asked` is the page the read ended at; nothing from it on is held.
 */
type SourceStop =
  | { kind: 'renumbered'; asked: number; got: number }
  | { kind: 'repeated'; asked: number }
  | { kind: 'past-page-limit' };

/** What reading the pages found, beyond the entries themselves. */
interface ReadPages {
  toc: TocEntry[];
  /** The `mapId` of each page held, in order; absent where a page named none. */
  mapIds: (string | undefined)[];
  totalEntries: number;
  cuts: CutPage[];
  rest: RestOfToc | undefined;
  stop: SourceStop | undefined;
  paginationNote: string | undefined;
}

/** A page counts as cut if it names what it cut or only says it cut something. */
function cutOn(page: number, result: FetchTocResult): CutPage[] {
  return result.truncatedEntry !== undefined || result.tokenInfo.truncated
    ? [{ page, entry: result.truncatedEntry }]
    : [];
}

/**
 * Which top-level entry this is, for telling a repeated page from a new one.
 * The url and the `tocId` together: a map can place one topic, so one url, at
 * two points of its tree, and a `TocProvider` need not send `tocId`s.
 */
function entryKey(entry: TocEntry): string {
  return `${entry.url}#${entry.tocId ?? ''}`;
}

/**
 * Read pages from the first while they fit the resource's budget together.
 *
 * Whole pages only, so the rest of a tree that does not fit starts exactly at
 * a page of `jamf_docs_get_toc`. The first page is always held: it is cut to
 * the budget already.
 *
 * A `TocProvider` that ignores `page` cannot make the body hold a top-level
 * entry twice: the read ends at a page numbered other than the one asked for,
 * and at a page holding a top-level entry an earlier page held, which is what
 * a provider that echoes the page number back sends. It also ends at page
 * 100, the last `page` accepts, whatever `hasNext` says.
 *
 * On the Fluid Topics path the first page caches the whole tree and the later
 * pages are served from `ctx.cache`, so a read costs one upstream TOC fetch
 * when the cache keeps what it was just given. A `CacheProvider` that does
 * not (a no-op one, or a TTL of 0) costs one fetch per page.
 */
async function readPages(ctx: ServerContext, productId: ProductId): Promise<ReadPages> {
  const read = async (page: number): Promise<FetchTocResult> =>
    await fetchTableOfContents(ctx, productId, 'current', { page, maxTokens: TOC_RESOURCE_MAX_TOKENS });

  let page = 1;
  let last = await read(page);
  const toc = [...last.toc];
  const mapIds = [last.mapId];
  const held = new Set(toc.map(entryKey));
  const cuts = cutOn(page, last);
  let used = last.tokenInfo.tokenCount;
  let rest: RestOfToc | undefined;
  let stop: SourceStop | undefined;

  while (last.pagination.hasNext) {
    if (page >= PAGINATION_CONFIG.MAX_PAGE) {
      stop = { kind: 'past-page-limit' };
      break;
    }
    page += 1;
    const next = await read(page);
    if (next.pagination.page !== page) {
      stop = { kind: 'renumbered', asked: page, got: next.pagination.page };
      break;
    }
    if (next.toc.some(entry => held.has(entryKey(entry)))) {
      stop = { kind: 'repeated', asked: page };
      break;
    }
    if (used + next.tokenInfo.tokenCount > TOC_RESOURCE_MAX_TOKENS) {
      rest = {
        firstTitle: next.toc[0]?.title ?? '',
        fromPage: page,
        toPage: Math.min(next.pagination.totalPages, PAGINATION_CONFIG.MAX_PAGE),
      };
      break;
    }
    toc.push(...next.toc);
    mapIds.push(next.mapId);
    next.toc.forEach(entry => held.add(entryKey(entry)));
    cuts.push(...cutOn(page, next));
    used += next.tokenInfo.tokenCount;
    last = next;
  }

  // `paginateTocEntries` puts its note on every page of a tree, so the last
  // page held has it if any does.
  return {
    toc, mapIds, totalEntries: last.pagination.totalItems, cuts, rest, stop, paginationNote: last.paginationNote,
  };
}

/**
 * The single map the pages held name, or undefined when they name none or
 * several.
 *
 * On the Fluid Topics path every page names the map its tree was fetched
 * from, cached or not (`fetchTableOfContents`). A `TocProvider` may name it
 * on some pages only, and a page that names none leaves the others' answer
 * standing. Pages that name two maps have no one map for all their entries,
 * so the body offers no pair rather than a wrong one; each entry's `url`
 * still fetches it. On the Fluid Topics path that takes the tree fetched
 * again between two pages, its cache entry gone, with the registry naming
 * another map by then.
 */
function mapOf(pages: ReadPages): string | undefined {
  const named = new Set(pages.mapIds.filter(id => id !== undefined && id !== ''));
  return named.size === 1 ? [...named][0] : undefined;
}

/** The sentence for one page held although it was cut to fit. */
function cutSentence(productId: ProductId, cut: CutPage): string {
  if (cut.entry === undefined) {
    // The advice `jamf_docs_get_toc` gives under such a page.
    return `Page ${String(cut.page)} of \`jamf_docs_get_toc\` with \`product: "${productId}"\` and ` +
      `\`maxTokens: ${String(TOC_RESOURCE_MAX_TOKENS)}\` left out entries to fit that budget, without saying which; ` +
      'a larger `maxTokens` leaves out less.';
  }
  const { title, shownEntries, totalEntries, estimatedTokens } = cut.entry;
  const shown = `"${title}" is larger on its own than the ${String(TOC_RESOURCE_MAX_TOKENS)} tokens this resource holds, ` +
    `so this shows the first ${String(shownEntries)} of its ${String(totalEntries)} entries`;
  return estimatedTokens <= TOKEN_CONFIG.MAX_TOKENS_LIMIT
    ? `${shown}; \`jamf_docs_get_toc\` with \`product: "${productId}"\` and ` +
      `\`maxTokens: ${String(estimatedTokens)}\` shows it whole.`
    : `${shown}. It needs ${String(estimatedTokens)} tokens, more than \`jamf_docs_get_toc\` accepts as ` +
      `\`maxTokens\` (${String(TOKEN_CONFIG.MAX_TOKENS_LIMIT)}).`;
}

/** The sentences for pages past the budget: what is held, and where the rest is. */
function restSentences(productId: ProductId, pages: ReadPages, rest: RestOfToc, shownEntries: number): string[] {
  const { toc, totalEntries, cuts } = pages;
  const where = rest.fromPage === rest.toPage
    ? `page ${String(rest.fromPage)}`
    : `pages ${String(rest.fromPage)} to ${String(rest.toPage)}`;
  // "Whole" only when it is: a cut page has a sentence of its own.
  const held = toc.length === 1 ? 'the first top-level entry' : `the first ${String(toc.length)} top-level entries`;
  const whole = cuts.length > 0 ? '' : toc.length === 1 ? ', whole' : ', each whole';
  return [
    `This is ${held}${whole} (${String(shownEntries)} of ${String(totalEntries)} entries): ` +
    `the table of contents is larger than the ${String(TOC_RESOURCE_MAX_TOKENS)} tokens this resource holds, ` +
    'counted from entry titles as `jamf_docs_get_toc` counts `maxTokens`.',
    `The rest, from "${rest.firstTitle}" on, is on ${where} of \`jamf_docs_get_toc\` with ` +
    `\`product: "${productId}"\` and \`maxTokens: ${String(TOC_RESOURCE_MAX_TOKENS)}\`.`,
  ];
}

/**
 * The sentence for a read the source ended. It points at no call, since none
 * would help: `jamf_docs_get_toc` reads the same source, and cannot ask for a
 * page past 100 either.
 */
function stopSentence(stop: SourceStop): string {
  const notPaged = (asked: number, what: string): string =>
    `Asked for page ${String(asked)}, the table-of-contents source returned ${what}, so it did not page as asked ` +
    `and this holds nothing after page ${String(asked - 1)}; \`jamf_docs_get_toc\` reads the same source.`;
  switch (stop.kind) {
    case 'renumbered':
      return notPaged(stop.asked, `page ${String(stop.got)}`);
    case 'repeated':
      return notPaged(stop.asked, 'top-level entries an earlier page held');
    case 'past-page-limit':
      return `The table-of-contents source has pages after page ${String(PAGINATION_CONFIG.MAX_PAGE)}, the last one ` +
        '`jamf_docs_get_toc` accepts as `page`, so this holds nothing after it.';
  }
}

/**
 * What a body that is not the whole tree leaves out, and where it is.
 *
 * Every cause found gets its sentence, in the order met: pages cut to fit,
 * pages past the budget, the source ending the read. A shortfall none of them
 * explains says the source's pages hold fewer entries than it counts. A tree
 * with more pages than `page` accepts gets the note `jamf_docs_get_toc` gives
 * for it as well, since the pages named cannot reach the entries past the
 * last.
 */
function missingNote(productId: ProductId, pages: ReadPages, shownEntries: number): string {
  const { totalEntries, cuts, rest, stop, paginationNote } = pages;
  const sentences = cuts.map(cut => cutSentence(productId, cut));
  if (rest !== undefined) {
    sentences.push(...restSentences(productId, pages, rest, shownEntries));
  }
  const only = `Only ${String(shownEntries)} of ${String(totalEntries)} entries are here`;
  if (stop !== undefined) {
    if (shownEntries < totalEntries) {
      sentences.push(`${only}.`);
    }
    sentences.push(stopSentence(stop));
  } else if (sentences.length === 0) {
    sentences.push(paginationNote !== undefined
      ? `${only}.`
      : `${only}: the pages of the table-of-contents source, read to the last, hold fewer entries than it counts.`);
  }
  if (paginationNote !== undefined) {
    sentences.push(paginationNote);
  }
  return sentences.join(' ');
}

/**
 * A product's current table of contents, whole when it fits
 * {@link TOC_RESOURCE_MAX_TOKENS}, and marked when it does not.
 *
 * `complete` is false whenever anything is left out: an entry cut to fit,
 * pages past the budget, a source that ended the read, or fewer entries than
 * `totalEntries` for any other reason. It does not rest on the count alone,
 * since that is the source's own: a `TocProvider` whose `totalItems` counts
 * less than its tree still gets a body marked by what the read found.
 */
export async function readProductToc(ctx: ServerContext, productId: ProductId): Promise<ProductTocBody> {
  const pages = await readPages(ctx, productId);
  const shownEntries = countTocEntries(pages.toc);
  const complete = shownEntries >= pages.totalEntries && pages.cuts.length === 0 &&
    pages.rest === undefined && pages.stop === undefined;
  const mapId = mapOf(pages);
  return {
    product: JAMF_PRODUCTS[productId].name,
    ...(mapId !== undefined ? { mapId } : {}),
    totalEntries: pages.totalEntries,
    complete,
    ...(complete ? {} : { shownEntries, missing: missingNote(productId, pages, shownEntries) }),
    toc: pages.toc,
  };
}
