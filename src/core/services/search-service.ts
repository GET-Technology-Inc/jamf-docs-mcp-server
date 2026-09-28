/**
 * Search service — Fluid Topics powered search
 */

import type {
  SearchResult,
  SearchParams,
  SearchDocumentationResult,
  FtSearchEntry,
  FtSearchCluster,
  FtSearchFilter,
  FtSearchRequest,
  FtClusteredSearchResponse,
  FtMetadataEntry,
  FilterRelaxation,
  PaginationInfo,
  TokenInfo,
  SearchTruncatedResult,
} from '../types.js';
import type { DocTypeId, TopicId } from '../constants.js';
import {
  JAMF_PRODUCTS,
  JAMF_TOPICS,
  classificationValuesFor,
  DOC_TYPE_LABEL_MAP,
  DOC_TYPE_PRECEDENCE,
  LABEL_KEY_DOC_TYPE_MAP,
  CONTENT_LIMITS,
  TOKEN_CONFIG,
  PAGINATION_CONFIG,
  DEFAULT_LOCALE,
} from '../constants.js';
import type { ServerContext } from '../types/context.js';
import type { Logger } from './interfaces/index.js';
import { search as ftSearch } from './ft-client.js';
import { buildDisplayUrl, buildDisplayUrlFromPrettyUrlMeta } from './topic-resolver.js';
import type { MapsRegistry } from './maps-registry.js';
import { describeMapsListFailure } from './maps-list-failure.js';
import { cleanSnippet, titleProductSnippet } from './content-parser.js';
import { cacheKey, type CacheKey } from './cache-key.js';
import type { ProductId } from '../constants.js';
import { extractBundleStemFromUrl } from '../utils/url.js';
import { getMetaValue, getMetaValues, FT_META } from '../utils/ft-metadata.js';
import { compareVersions } from '../utils/bundle.js';
import {
  describeFetchFailure,
  mayBeTemporary,
  reasonGiven,
  MAY_BE_TEMPORARY,
  UNEXPECTED_FAILURE_ADVICE,
} from '../utils/fetch-failure.js';
import { dedupeResultsToLatestVersions, namedVersion } from './search-result-versions.js';
import { readSearchProviderResults } from './provider-results.js';
import { estimateTokens, buildPaginationNote } from './tokenizer.js';
import { pageStarts, pagesPastTheLastNote } from './budget-pages.js';

// ─── Types ─────────────────────────────────────────────────────

// Re-export for consumers that import from this module
export type { SearchDocumentationResult } from '../types.js';

type FilterName = 'product' | 'topic' | 'docType';

interface ActiveFilter {
  name: FilterName;
  value: string;
  apply: (results: SearchResultWithMeta[]) => SearchResultWithMeta[];
}

interface SearchResultWithMeta {
  result: SearchResult;
  /**
   * Every product Jamf files the result under: all the values of
   * `jamf:portal`, `jamf:app` and `jamf:utility` together. What the `product`
   * post-filter reads on the Fluid Topics path — see {@link belongsToProduct}.
   *
   * `null` for a SearchProvider result, which is a flat SearchResult with no
   * metadata to read. There the filter goes by the product name it reports.
   */
  classification: string[] | null;
  matchedTopics: TopicId[];
  labelKeys: string[];
}

// ─── Helpers ───────────────────────────────────────────────────

/** Pre-computed lowercase keywords per topic */
const TOPIC_KEYWORDS_LOWER: Record<TopicId, string[]> = Object.fromEntries(
  (Object.keys(JAMF_TOPICS) as TopicId[]).map(id => [
    id,
    JAMF_TOPICS[id].keywords.map(k => k.toLowerCase()),
  ])
) as Record<TopicId, string[]>;

const ALL_TOPIC_IDS = Object.keys(JAMF_TOPICS) as TopicId[];

function matchTopics(title: string, snippet: string): TopicId[] {
  const searchText = `${title} ${snippet}`.toLowerCase();
  return ALL_TOPIC_IDS.filter(
    topicId => TOPIC_KEYWORDS_LOWER[topicId].some(kw => searchText.includes(kw))
  );
}

/**
 * Pre-computed reverse lookup: product name → ProductId.
 *
 * Both names a product goes by: this server's display name, and every
 * classification value Jamf files it under. They differ for one product —
 * `jamf-setup-reset` is "Jamf Setup and Reset" here and "Jamf Setup" / "Jamf
 * Reset" to Jamf — and knowing only the display name meant a result reported
 * under either of Jamf's names could never satisfy that product's filter.
 */
const PRODUCT_NAME_TO_ID: Record<string, ProductId> = Object.fromEntries(
  (Object.keys(JAMF_PRODUCTS) as ProductId[]).flatMap(id =>
    [JAMF_PRODUCTS[id].name, ...classificationValuesFor(id)].map(name => [name, id])
  )
);

/**
 * Resolve a product name (e.g. 'Jamf Pro', or Jamf's 'Jamf Setup') to its
 * ProductId (e.g. 'jamf-pro'). Returns null when the name is unknown.
 */
function productNameToId(name: string | null): ProductId | null {
  if (name === null) { return null; }
  return PRODUCT_NAME_TO_ID[name] ?? null;
}

/**
 * The product a search result is about, as Jamf names it.
 *
 * Read straight off the result rather than translated: every topic carries
 * `jamf:portal` / `jamf:app` / `jamf:utility` in its own search metadata
 * (every result carried one when measured), and those values already ARE
 * product names. The previous version matched `zoominmetadata` against a
 * hand-written `searchLabel` per product, which meant a legacy Zoomin label
 * Jamf keeps re-tagging stood between a result and its own name.
 *
 * The axes are read most-specific first — utility, then app, then portal —
 * because a document carrying both is *about* the narrower one and merely
 * hosted on the broader: the Title Editor documentation is classified
 * `portal=[Jamf Pro], utility=[Title Editor]`, and calling it a Jamf Pro
 * document tells the reader nothing they did not already know from searching.
 * Measured over the 11 families that carry more than one axis, this order
 * never does worse than the `zoominmetadata` scan it replaced and does better
 * on five — Jamf App Catalog, Jamf Remote Assist, Jamf Setup and Reset,
 * Healthcare Listener and the AD CS technical paper all reported "Jamf Pro"
 * under a portal-first order.
 *
 * Only the first value within an axis is reported, because this feeds a single
 * `product` field on one result. A document Jamf files under several products
 * on the same axis — 29 maps carry two or three portals — is reported under
 * the first Jamf lists, the same choice {@link listPublications} documents.
 *
 * That makes this the attribution of a result nobody filtered by product, and
 * nothing more. It does not decide what a product search returns — that is
 * {@link belongsToProduct}, which reads every value — and a result that passed
 * a product filter is shown under the product asked for instead
 * ({@link showUnderProduct}). Until #334 it did decide it: the post-filter
 * compared this one value with the product, and a jamf-security-cloud search
 * rejected its own setup guide as "Jamf Connect".
 */
function extractProductFromClassification(metadata: FtMetadataEntry[] | undefined): string | null {
  for (const key of [FT_META.UTILITY, FT_META.APP, FT_META.PORTAL]) {
    const value = getMetaValues(metadata, key)[0];
    if (value !== undefined && value !== '') { return value; }
  }
  return null;
}

/**
 * Every classification value a result carries, all three axes together.
 *
 * Read in the same order as {@link extractProductFromClassification}, though
 * nothing depends on it: the product filter only asks whether any of these is
 * one of the product's values.
 */
function classificationValues(metadata: FtMetadataEntry[] | undefined): string[] {
  return [FT_META.UTILITY, FT_META.APP, FT_META.PORTAL]
    .flatMap(key => getMetaValues(metadata, key));
}

/**
 * Whether a result belongs to `product`, by the rule the upstream filter uses.
 *
 * On the Fluid Topics path that rule is Jamf's classification: the result
 * belongs when any value on any of the three axes is one of the product's
 * classification values. It is the test `clustered-search` applies to the
 * filter {@link resolveProductFilter} sends — a filter object keeps an entry
 * when its key carries any of the filter's values — so everything the API
 * returns for a product passes it: 12,597 of 12,597 topic and map entries over
 * 270 product x query searches, measured 2026-09-26. All three axes are read
 * rather than the filter's one because a value sits on one axis only, so the
 * two readings agree, and knowing which axis is the registry's job.
 *
 * Re-applied rather than skipped, although the API has already applied it:
 * the same rule costs nothing here, and if upstream ever returns a result it
 * should not have, that result is dropped and any relaxation that follows is
 * true. What it replaces was a different rule. It compared the single product
 * a result is DISPLAYED under ({@link extractProductFromClassification}) with
 * the product asked for, which for a document Jamf files under several
 * products is a different question with a different answer: over ten queries
 * per product it kept 0 of 181 upstream results for jamf-trust, 0 of 133 for
 * jamf-setup-reset and 1 of 401 for jamf-security-cloud, reporting "Removed
 * filter(s): product" over each, and dropped 38.8% of jamf-protect's and
 * 25.1% of jamf-safe-internet's without a word.
 *
 * So a document Jamf files under several products is returned for each of
 * them — the Security Cloud setup guide for jamf-security-cloud and for
 * jamf-protect. That is intended, not a side effect: Jamf's classification is
 * what Jamf files the document under and what the API selects on, and a local
 * rule that narrowed it further would be this server overruling Jamf without
 * saying so.
 *
 * A SearchProvider result has no classification to read, so its reported
 * product name is looked up instead.
 *
 * A product with no classification is filtered by its own publication
 * instead ({@link resolveProductFilter}), and `publication` then holds the
 * ids of its maps: see {@link fromPublication}.
 */
function belongsToProduct(
  r: SearchResultWithMeta,
  product: ProductId,
  publication?: ReadonlySet<string>,
): boolean {
  if (publication !== undefined) {
    return fromPublication(r, product, publication);
  }
  if (r.classification === null) {
    return productNameToId(r.result.product) === product;
  }
  const values = classificationValuesFor(product);
  return r.classification.some(value => values.includes(value));
}

/**
 * Whether a result is from the publication a product with no classification
 * is filtered by.
 *
 * On the Fluid Topics path that is its `mapId`, the `ft:publicationId` it was
 * matched on upstream, and nothing else.
 *
 * A SearchProvider result has no classification to read, and the product
 * name it reports is the provider's own reading. A provider that goes by
 * Jamf's classification reports Jamf Routines documentation as Jamf Pro,
 * which is where Jamf files it, and matched by that name alone, none of it
 * passed and the filter was relaxed away. So a provider result is also from
 * the publication when its `mapId` is one of the ids or its URL names the
 * product's bundle family, and it still belongs when it reports the product
 * by name, as any provider result does.
 */
function fromPublication(
  r: SearchResultWithMeta,
  product: ProductId,
  publication: ReadonlySet<string>,
): boolean {
  if (r.result.mapId !== undefined && publication.has(r.result.mapId)) { return true; }
  if (r.classification !== null) { return false; }
  return productNameToId(r.result.product) === product
    || extractBundleStemFromUrl(r.result.url) === JAMF_PRODUCTS[product].bundleId;
}

/**
 * Show a result under the product the caller filtered by.
 *
 * Display follows the filter. A result that passed a `product` filter carries
 * one of that product's classification values, or, for a product with none,
 * comes from that product's own publication. Either way it is that product's
 * document whichever value Jamf lists first on the most specific axis: a
 * Jamf Routines topic, filed under Jamf Pro, is shown as Jamf Routines. Without
 * this, a jamf-security-cloud search listed every hit as "Jamf Connect", and
 * {@link belongsToProduct} widening to every product Jamf files a document
 * under would have broken what test/integration/service-chain.test.ts checks
 * against the live API: that every result of a product search is shown under
 * the product asked for. For jamf-setup-reset that is this server's name for
 * it, "Jamf Setup and Reset", rather than whichever of Jamf's two came first.
 *
 * The short-snippet fallback repeats the product name, so it is rebuilt with
 * the new one rather than left naming the old.
 *
 * What the relabel gives up is the document's own identity, and for some
 * results that matters: the Jamf Trust release notes returned for jamf-protect
 * include topics titled "Windows" and "macOS", which shown as Jamf Protect
 * read as Jamf Protect's. So a result Jamf files first under a different
 * product, from a publication whose title does not name the product it is now
 * shown under, is marked `crossFiled` and the markdown output names the
 * publication beside it. A product's own publications are not marked even
 * when relabelled — "Jamf Security Cloud Portal Setup Guide", listed first
 * under Jamf Connect, needs no note under Jamf Security Cloud — nor is a
 * result only renamed within its product ("Jamf Reset" → "Jamf Setup and
 * Reset"), which is every relabel on the SearchProvider path save one: a
 * Jamf Routines result the provider reported as Jamf Pro
 * ({@link fromPublication}), which is marked by the same rule.
 */
function showUnderProduct(result: SearchResult, product: ProductId): SearchResult {
  const { name } = JAMF_PRODUCTS[product];
  if (result.product === name) { return result; }
  const snippet = result.snippet === titleProductSnippet(result.title, result.product)
    ? titleProductSnippet(result.title, name)
    : result.snippet;
  const crossFiled = productNameToId(result.product) !== product
    && result.mapTitle !== undefined
    && !namesProduct(result.mapTitle, name);
  return { ...result, product: name, snippet, ...(crossFiled ? { crossFiled } : {}) };
}

/**
 * Whether a publication title names a product as a whole name: "Jamf Protect
 * Release Notes" names Jamf Protect, but not Jamf Pro.
 */
function namesProduct(title: string, name: string): boolean {
  for (let at = title.indexOf(name); at !== -1; at = title.indexOf(name, at + 1)) {
    if (!/[\p{L}\p{N}]/u.test(title.charAt(at + name.length))) { return true; }
  }
  return false;
}

/** The metadata array of whichever payload an FT search entry actually carries. */
function entryMetadata(entry: FtSearchEntry): FtMetadataEntry[] | undefined {
  return entry.type === 'MAP' ? entry.map?.metadata : entry.topic?.metadata;
}

/**
 * Collect every docType label key a topic carries.
 *
 * Fluid Topics ships them under `zoominmetadata` as `content-*` values, whose
 * vocabulary is exactly DOC_TYPES' labelKey set. A topic legitimately carries
 * several — every Jamf Pro release note is tagged both `content-techdocs` and
 * `content-releasenotes` — so all of them are kept and the docType post-filter
 * matches on any one of them.
 *
 * This replaces a reverse lookup through DOC_TYPE_CONTENT_TYPE_MAP, which is
 * many-to-one ('Technical Documentation' covers four docTypes) and was walked
 * in object-literal insertion order: a release note matched `documentation`
 * first, was labelled `content-techdocs`, and was then dropped by its own
 * `docType: 'release-notes'` filter.
 */
function docTypeLabelKeys(metadata: FtMetadataEntry[] | undefined): string[] {
  return getMetaValues(metadata, FT_META.ZOOMIN_METADATA)
    .filter(value => LABEL_KEY_DOC_TYPE_MAP[value] !== undefined);
}

/**
 * Collapse label keys to the single most specific docType.
 *
 * Returns undefined when the topic carries no recognised `content-*` label
 * (Jamf's glossary topics ship with no metadata at all). "Unknown" must stay
 * unknown: reporting `documentation` there is a positive assertion nothing
 * backs, and it makes the docType filter drop the topic from every search
 * except `docType: 'documentation'`.
 */
function docTypeFromLabelKeys(labelKeys: string[]): DocTypeId | undefined {
  return DOC_TYPE_PRECEDENCE.find(
    docType => labelKeys.includes(DOC_TYPE_LABEL_MAP[docType])
  );
}

// ─── Filter Construction ───────────────────────────────────────

/**
 * The upstream filter for a `product`, in Jamf's own vocabulary.
 *
 * Replaces the hand-written `searchLabel` translation into `zoominmetadata`'s
 * legacy `product-*` values. Measured 2026-09-18 over 224 product x query
 * cells on the live API: filtering on `jamf:portal` / `jamf:app` /
 * `jamf:utility` returned 4850 results against the labels' 4861, 24 of 28
 * products byte-identical, and nothing gained that should not be. The few it
 * loses are tail entries of result windows large enough that the
 * classification matches a slightly wider upstream set; each still carries the
 * classification.
 *
 * What it buys is that nothing here is maintained by hand. `product-*` is a
 * legacy Zoomin vocabulary Jamf re-tags without warning — one map gaining
 * `product-elevate` in September 2026 was enough to turn the contract that
 * guarded the table red — while the classification is what Jamf files
 * documents under today, and the axis is looked up rather than written down.
 *
 * A product Jamf names nothing by, which today is `jamf-routines` alone, is
 * filtered by its own publication instead: `ft:publicationId`, carrying the
 * ids of every map of the product's `bundleId` family, which the registry
 * reads off `/api/khub/maps`. Jamf files the Routines documentation under
 * `jamf:portal = Jamf Pro`, so no classification value separates it from the
 * rest of Jamf Pro, but Fluid Topics files every entry under its map, and
 * that key filters: for the query "Jamf Routines", 13 entries against 26,081
 * unfiltered, all of them the Routines map or its topics (live, 2026-09-26).
 * It narrows to the one publication, so a document Jamf files elsewhere that
 * merely mentions the product is not found. With no classification there is
 * no wider set to find it by.
 *
 * Until then such a product was left out of the search and reported as not
 * applied, which was right while none of its topics were in the index
 * (2026-09-18). By 2026-09-26 they were, and ten live jamf-routines searches
 * all reported the filter as not applied (`removed: ['product']`) over
 * results of which 33 of 432 were Jamf Routines documentation. Filtering
 * locally instead would not have served: the unfiltered fetch is one
 * 50-cluster page of the whole library, and over twelve queries it held 34
 * of the 54 entries the upstream filter returns, and none at all for
 * "create", "policy", "install" or "trigger".
 *
 * Returns null in two cases, which the caller tells apart. When the product
 * has no classification and the registry has no map of its publication, the
 * caller treats it as "cannot filter", not as "no filter": the search still
 * goes out, unfiltered, but the product filter is reported as removed before
 * anything else is ({@link applyFiltersWithFallback}). An unfiltered search
 * that did not say so would answer a different question as if it were this
 * one. When the registry cannot place a classification value, only the
 * upstream half of the filter is lost; the local one still applies
 * ({@link belongsToProduct}).
 *
 * `mapIdsOf` is optional in the parameter's type so that a caller written
 * when only `classificationAxis` was needed still compiles; without it, a
 * product with no classification gets null, as it always did. A registry
 * whose maps list cannot be read throws here for every product; a search
 * catches that for a product with no classification only
 * ({@link resolveSearchProductFilter}).
 */
export async function resolveProductFilter(
  registry: Pick<MapsRegistry, 'classificationAxis'> & Partial<Pick<MapsRegistry, 'mapIdsOf'>>,
  product: ProductId | undefined,
): Promise<FtSearchFilter | null> {
  if (product === undefined) { return null; }

  const values = classificationValuesFor(product);
  if (values.length === 0) {
    const mapIds = await registry.mapIdsOf?.(JAMF_PRODUCTS[product].bundleId) ?? [];
    return mapIds.length === 0 ? null : { key: FT_META.PUBLICATION_ID, values: mapIds };
  }

  // Fluid Topics intersects filter objects and unions values within one, so
  // every value has to ride on the same key. They always do: a classification
  // value sits on exactly one axis, and the two-value case (Jamf Setup and
  // Jamf Reset) has both on `jamf:app`.
  const axis = await registry.classificationAxis(values[0] ?? '');
  if (axis === null) { return null; }

  return { key: axis, values: [...values] };
}

/** A product Jamf classifies nothing under, which is filtered by its own publication instead. */
function isUnclassified(product: ProductId | undefined): product is ProductId {
  return product !== undefined && classificationValuesFor(product).length === 0;
}

/**
 * {@link resolveProductFilter} for a search, which a maps list that cannot be
 * read fails only where it always did.
 *
 * A classified product's search has always needed the list, to know which
 * axis its value sits on, and fails without it. A product with no
 * classification needs the list only to be filtered by its publication, and
 * before it was, its search never read the list at all. So for that product
 * a list that cannot be read (the fetch fails, or an injected MapsProvider
 * throws) gives null, which leaves the search where it was then: unfiltered,
 * and the product reported as not applied.
 */
async function resolveSearchProductFilter(
  ctx: ServerContext,
  product: ProductId | undefined,
  log: Logger,
): Promise<FtSearchFilter | null> {
  try {
    return await resolveProductFilter(ctx.mapsRegistry, product);
  } catch (error) {
    if (!isUnclassified(product)) { throw error; }
    log.warning(
      `Could not read the maps list (${String(error)}); the product filter ` +
      `"${product}" cannot be applied by its publication`
    );
    return null;
  }
}

/**
 * Build Fluid Topics search filters from search params.
 *
 * - product → resolved separately by {@link resolveProductFilter} and passed
 *   in, because it needs the registry to know which axis the product lives on
 * - docType → `zoominmetadata` filter using DOC_TYPE_LABEL_MAP
 * - version → `version` filter (only when a specific version is requested)
 *
 * Both filters are pushed as *separate* entries. Fluid Topics intersects
 * filter objects and unions the values inside one — verified against the live
 * API when this was written, and again on 2026-09-18 for the classification
 * keys — so merging them into a single entry would widen a product+docType
 * search instead of narrowing it. The counts that first demonstrated it are
 * not repeated here: the union/intersection behaviour is the durable part, and
 * the numbers moved within days.
 *
 * NOTE: we intentionally do NOT add `latestVersion=yes` when no version is given.
 * Jamf migrated all non-Pro products (School, Connect, Protect, Now, …) to an
 * unversioned documentation model with no `latestVersion` metadata, so that filter
 * silently dropped every non-Pro product from results (and returned zero results
 * for product-filtered non-Pro searches). Jamf Pro's many version snapshots are
 * instead collapsed client-side via {@link dedupeToLatestVersions}.
 */
export function buildSearchFilters(
  params: Pick<SearchParams, 'docType' | 'version'>,
  productFilter?: FtSearchFilter | null,
): FtSearchFilter[] {
  const filters: FtSearchFilter[] = [];

  if (productFilter !== undefined && productFilter !== null) {
    filters.push(productFilter);
  }

  // Document type filter.
  //
  // Filters on the `content-*` label rather than `jamf:contentType`, because
  // the latter's *values* are translated per locale while its key is not:
  // `jamf:contentType = 'Release Notes'` matched topics under en-US and 0
  // under zh-TW, where the same topics carry '版本資訊' — and ja-JP
  // 'リリースノート', de-DE 'Versionshinweise', and so on for every locale this
  // server supports. Sending the English string therefore returned an empty
  // upstream result for every locale but en-US, and
  // because that emptiness arrives from the API, the client-side relaxation in
  // {@link applyFiltersWithFallback} has nothing left to relax.
  //
  // The `content-*` vocabulary is locale-invariant — the same label matches in
  // every locale, where the translated value matched only one — and is already
  // what the docType post-filter matches on, so both ends agree on one
  // vocabulary. `data-contracts` asserts every `content-*` label is still live;
  // the per-locale counts that first showed this are not repeated, because they
  // move with every Jamf release and prove nothing the assertion does not.
  if (params.docType !== undefined) {
    // Widened deliberately: DOC_TYPE_LABEL_MAP is total over DocTypeId, so the
    // type says this cannot miss — but params reach here from a JSON-RPC
    // payload, and a docType outside the enum would otherwise push
    // `values: [undefined]` upstream. Same idiom as the docType post-filter.
    const labelKey = DOC_TYPE_LABEL_MAP[params.docType] as string | undefined;
    if (labelKey !== undefined) {
      filters.push({
        key: FT_META.ZOOMIN_METADATA,
        values: [labelKey],
      });
    }
  }

  // Version handling — only filter when a specific version is requested.
  // See the function doc above for why `latestVersion=yes` is no longer auto-added.
  if (params.version !== undefined && params.version !== '' && params.version !== 'current') {
    filters.push({
      key: FT_META.VERSION,
      values: [params.version],
    });
  }

  return filters;
}

/** A survivor of {@link dedupeToLatestVersions}, with the versions it stands for. */
export interface DedupedEntry {
  entry: FtSearchEntry;
  /**
   * Versions collapsed into this one, newest first. Empty when nothing was,
   * and on every entry of a cluster but the first.
   */
  collapsedVersions: string[];
}

/**
 * Collapse Fluid Topics version snapshots to a single result per topic.
 *
 * Jamf Pro documentation publishes a separate search entry for every product
 * version (11.13 … 11.29), all sharing the same `ft:clusterId`. We keep only the
 * highest-versioned entries of a cluster so the user sees one (latest) result
 * per topic. A topic of a non-versioned product (Jamf School, Connect,
 * Protect, …) carries a single entry, nearly always in a cluster of its own,
 * so it passes through untouched. Entries with no `ft:clusterId` cannot be
 * version-deduped and are each kept.
 *
 * A cluster is not always one topic. A topic's cluster id is nearly always
 * its url's bundle and slug, with `-current` for a version number (16,687 of
 * 16,750 topic entries in 70 searches on 2026-09-28; the rest carry a source
 * path or a title). And Jamf publishes some different topics at one url: the
 * LAPS paper's "Use LAPS" and its child "Using LAPS in the Jamf Pro API", or
 * 26 technical articles' "General Requirements" sections. So of the entries
 * at the version kept, one is kept per topic, the `mapId` + `contentId` pair
 * `jamf_docs_get_article` fetches it by. Until 2026-09-28 one was kept per
 * cluster, and every topic but the first went missing, where a
 * SearchProvider returning the same entries got every one back. The same page
 * Jamf lists under several breadcrumbs, with an entry for each, is one pair
 * and still one result. The pair cannot stand in for the cluster across
 * versions, though. A topic's `contentId` can change from one version to
 * the next: of the 653 clusters that held several versions in those
 * searches, 43 carried more than one. So the cluster is still what makes two
 * entries versions of one topic.
 *
 * Only a version number is a version ({@link namedVersion}, which the
 * SearchProvider path reads by too). A few topics carry Jamf's template text,
 * "Enter the latest product version for which the topic was revised.", in
 * their `version`. Compared as a string, it sorted after every number, so it
 * would have been kept over every real version in its cluster; it now counts
 * as no version.
 *
 * First-seen (relevance) order is preserved, cluster by cluster: Fluid Topics
 * ranks clusters, not the topics in one. Each cluster's first topic keeps the
 * cluster's rank, and carries the versions collapsed. Its other topics come
 * after the first topic of every cluster, in cluster order. So the results
 * one per cluster gave come first, in the same order, and the topics it hid
 * follow them. Placed at their cluster's rank instead, one cluster of generic
 * sections could fill a page. Live on 2026-09-28, the first cluster of the
 * en-US search "Additional Information" held 19 technical-article sections
 * of that title; at their cluster's rank they took all 10 results of page 1,
 * and pushed the 2nd to 10th back to 20th to 28th. A SearchProvider ranks
 * each result itself, so its order is its own.
 *
 * Collapsing stays the default — one broad query returns roughly fifteen
 * snapshots per topic and a release-notes query returned 199 entries for ten
 * topics, so surfacing all of them would bury the answer. What changes is
 * that it is no longer silent: each survivor carries the versions that were
 * dropped, so "what changed in 11.26?" is answerable rather than invisible.
 * That matters most for release notes, whose whole value is the older
 * versions.
 *
 * A SearchProvider's results never pass through here, because they arrive
 * as `SearchResult`s. {@link dedupeResultsToLatestVersions} collapses them by
 * the same rule.
 */
export function dedupeToLatestVersions(
  clusters: FtSearchCluster[]
): DedupedEntry[] {
  const order: string[] = [];
  const best = new Map<string, {
    /** The version kept, or '' while no entry has one. */
    version: string;
    /** One entry per topic at `version`, by first-seen order. */
    topics: Map<string | FtSearchEntry, FtSearchEntry>;
    seen: Set<string>;
  }>();
  let anonCount = 0;

  for (const cluster of clusters) {
    for (const entry of cluster.entries) {
      const metadata = entry.topic?.metadata ?? entry.map?.metadata ?? [];
      const clusterId = getMetaValue(metadata, FT_META.CLUSTER_ID);
      const version = entryVersion(metadata);
      const topic = topicOf(entry);
      // Entries without a cluster id can't be version-deduped — keep each.
      const key = clusterId !== '' ? clusterId : `anon-${anonCount++}`;
      const existing = best.get(key);
      if (existing === undefined) {
        order.push(key);
        best.set(key, { version, topics: new Map([[topic, entry]]), seen: new Set(version !== '' ? [version] : []) });
        continue;
      }
      if (version !== '') { existing.seen.add(version); }
      const newer = compareVersions(version, existing.version);
      if (newer > 0) {
        existing.version = version;
        existing.topics = new Map([[topic, entry]]);
      } else if (newer === 0 && !existing.topics.has(topic)) {
        existing.topics.set(topic, entry);
      }
    }
  }

  const out: DedupedEntry[] = [];
  // Every cluster's other topics, in cluster order, after every cluster's
  // first: see "First-seen (relevance) order" above.
  const overflow: DedupedEntry[] = [];
  for (const key of order) {
    const hit = best.get(key);
    if (hit === undefined) { continue; }
    // Only the versions that lost. The survivor's own version is reported as
    // the result's `version`, so repeating it here would read as a duplicate.
    const collapsed = [...hit.seen]
      .filter(v => v !== hit.version)
      .sort((a, b) => compareVersions(b, a));
    // Named on the first topic only, as the SearchProvider path names them on
    // its first-ranked result. Which topic of a cluster an older version was
    // of cannot be told. No cluster measured held two topics at one version
    // number, though, so the question has not come up.
    const [first, ...others] = hit.topics.values();
    if (first === undefined) { continue; }
    out.push({ entry: first, collapsedVersions: collapsed });
    for (const entry of others) {
      overflow.push({ entry, collapsedVersions: [] });
    }
  }
  return [...out, ...overflow];
}

/** An entry's `version`, or '' when it holds no version number. */
function entryVersion(metadata: FtMetadataEntry[] | undefined): string {
  return namedVersion(getMetaValue(metadata, FT_META.VERSION)) ?? '';
}

/**
 * The topic an entry is, as `jamf_docs_get_article` addresses it: a topic by
 * its `mapId` + `contentId` pair, a MAP entry by its map. An entry that is
 * neither is a topic of its own.
 */
function topicOf(entry: FtSearchEntry): string | FtSearchEntry {
  if (entry.topic !== undefined) { return JSON.stringify(['topic', entry.topic.mapId, entry.topic.contentId]); }
  if (entry.map !== undefined) { return JSON.stringify(['map', entry.map.mapId]); }
  return entry;
}

// ─── Result Transformation ─────────────────────────────────────

/**
 * Transform a Fluid Topics search entry into an enriched SearchResult.
 */
export function transformFtSearchResult(
  entry: FtSearchEntry,
): SearchResult {
  if (entry.type === 'TOPIC' && entry.topic !== undefined) {
    return transformTopicEntry(entry);
  }

  if (entry.type === 'MAP' && entry.map !== undefined) {
    return transformMapEntry(entry);
  }

  // Fallback for unexpected entry shapes
  return {
    title: 'Untitled',
    url: '',
    snippet: '',
    product: null,
  };
}

/** Common fields extracted from either a TOPIC or MAP entry */
interface EntryFields {
  /** Absent when Fluid Topics sent the entry without one — see FtSearchTopic.title. */
  title?: string | undefined;
  url: string;
  htmlExcerpt: string;
  metadata?: FtMetadataEntry[] | undefined;
  mapId: string;
  contentId?: string;
  breadcrumb?: string[];
  /** A MAP entry reuses its own (optional) title here. Guarded at the use site. */
  mapTitle?: string | undefined;
}

/**
 * Shared builder: turns the common fields of a TOPIC or MAP entry
 * into a fully-populated SearchResult.
 */
function buildSearchResult(fields: EntryFields): SearchResult {
  const { metadata } = fields;
  // Both the absent and the empty case fall back, matching how the article
  // path picks its title (article-service.ts). Testing only `!== ''` let
  // `undefined` through, because `undefined !== ''` is true.
  const title = (fields.title !== undefined && fields.title !== '')
    ? fields.title
    : 'Untitled';
  const product = extractProductFromClassification(metadata);
  const snippet = cleanSnippet(fields.htmlExcerpt, title, product);
  const docType = docTypeFromLabelKeys(docTypeLabelKeys(metadata));

  const result: SearchResult = {
    title,
    url: fields.url,
    snippet,
    product,
    mapId: fields.mapId,
    // Omitted rather than set to undefined when the topic carries no
    // `content-*` label — `docType` is declared optional and the config has
    // exactOptionalPropertyTypes on.
    ...(docType !== undefined ? { docType } : {}),
  };

  if (fields.contentId !== undefined) {
    result.contentId = fields.contentId;
  }

  // A version number only, as the dedupe above reads one. Until 2026-09-28
  // whatever the field held was shown as the **Version**, and a few topics
  // hold Jamf's template text there ("Enter the latest product version for
  // which the topic was revised.": two ja-JP Jamf Connect topics and four
  // en-US technical-article sections, measured that day). Each is in an
  // unversioned publication, whose other topics carry no version, so the
  // result gets none either.
  const version = entryVersion(metadata);
  if (version !== '') {
    result.version = version;
  }
  if (fields.breadcrumb !== undefined && fields.breadcrumb.length > 0) {
    result.breadcrumb = fields.breadcrumb;
  }
  // A string only: the tool publishes it as `SearchOutputSchema` declares it,
  // and `showUnderProduct` reads it as one. Fluid Topics has sent a string on
  // every topic measured; until 2026-09-28 the tool itself dropped any other
  // value (#348), for this path as for a SearchProvider's.
  if (typeof fields.mapTitle === 'string' && fields.mapTitle !== '') {
    result.mapTitle = fields.mapTitle;
  }

  return result;
}

function resolveTopicUrl(topic: NonNullable<FtSearchEntry['topic']>): string {
  const prettyUrls = getMetaValues(topic.metadata, FT_META.PRETTY_URL);
  const rawPrettyUrl = prettyUrls[0];
  if (rawPrettyUrl !== undefined) {
    return buildDisplayUrlFromPrettyUrlMeta(rawPrettyUrl);
  }
  return buildDisplayUrl(`/r/en-US/${topic.mapId}/${topic.contentId}`);
}

function resolveMapUrl(map: NonNullable<FtSearchEntry['map']>): string {
  if (map.readerUrl !== '') { return buildDisplayUrl(map.readerUrl); }
  if (map.mapUrl !== '') { return buildDisplayUrl(map.mapUrl); }
  return '';
}

function transformTopicEntry(entry: FtSearchEntry): SearchResult {
  const { topic } = entry;
  if (topic === undefined) {
    return { title: 'Untitled', url: '', snippet: '', product: null };
  }

  return buildSearchResult({
    title: topic.title,
    url: resolveTopicUrl(topic),
    htmlExcerpt: topic.htmlExcerpt,
    metadata: topic.metadata,
    mapId: topic.mapId,
    contentId: topic.contentId,
    breadcrumb: topic.breadcrumb,
    mapTitle: topic.mapTitle,
  });
}

function transformMapEntry(entry: FtSearchEntry): SearchResult {
  const { map } = entry;
  if (map === undefined) {
    return { title: 'Untitled', url: '', snippet: '', product: null };
  }

  return buildSearchResult({
    title: map.title,
    url: resolveMapUrl(map),
    htmlExcerpt: map.htmlExcerpt,
    metadata: map.metadata,
    mapId: map.mapId,
    mapTitle: map.title,
  });
}

// ─── Filter Relaxation ─────────────────────────────────────────

/**
 * Build active filters from search params for progressive relaxation.
 *
 * These are client-side post-filters. Topic has no upstream equivalent; product
 * and docType are also sent upstream on the Fluid Topics path, and applied here
 * again by the same rule so the SearchProvider path is filtered too.
 *
 * `productFilterable` is false when the product cannot be filtered at all
 * (see `productUnfilterable` on {@link ResolvedSearchResults}). The product
 * filter is then left out entirely, because nothing fetched can satisfy it —
 * see {@link applyFiltersWithFallback} for how its removal is reported instead.
 * `publication` is set when the product is filtered by its own publication,
 * and is what the local filter matches then ({@link belongsToProduct}).
 */
function buildActiveFilters(
  params: SearchParams,
  productFilterable: boolean,
  publication?: ReadonlySet<string>,
): ActiveFilter[] {
  const activeFilters: ActiveFilter[] = [];

  if (params.product !== undefined && productFilterable) {
    const productId = params.product;
    activeFilters.push({
      name: 'product',
      value: productId,
      apply: (results) => results.filter(r => belongsToProduct(r, productId, publication)),
    });
  }

  if (params.topic !== undefined) {
    const topicFilter = params.topic;
    activeFilters.push({
      name: 'topic',
      value: topicFilter,
      apply: (results) => results.filter(r => r.matchedTopics.includes(topicFilter)),
    });
  }

  if (params.docType !== undefined) {
    const docTypeFilter = params.docType;
    const targetLabelKey = DOC_TYPE_LABEL_MAP[docTypeFilter] as string | undefined;
    if (targetLabelKey !== undefined) {
      activeFilters.push({
        name: 'docType',
        value: docTypeFilter,
        apply: (results) => results.filter(r => {
          if (r.labelKeys.length === 0) { return true; }
          return r.labelKeys.includes(targetLabelKey);
        }),
      });
    }
  }

  return activeFilters;
}

function applyAll(results: SearchResultWithMeta[], filters: ActiveFilter[]): SearchResultWithMeta[] {
  let filtered = results;
  for (const filter of filters) {
    filtered = filter.apply(filtered);
  }
  return filtered;
}

/**
 * What is said about a product filter that could not be applied at all.
 *
 * Both reasons are named, because the first alone is no longer why: a
 * product Jamf classifies nothing under is filtered by its own publication,
 * and this is said only when the maps list has no map of that either.
 *
 * With nothing found, it speaks of the search, not of "these results": since
 * 2026-09-28 a reply with no results carries the note too, and there are none
 * for it to describe.
 */
function unfilterableProductNote(product: ProductId, found: boolean): string {
  const { name, bundleId } = JAMF_PRODUCTS[product];
  return `The product filter "${product}" was not applied: Jamf classifies no `
    + `documentation as ${name}, and no map of its publication "${bundleId}" was `
    + `found to filter by instead, so ${found ? 'these results are' : 'the search was'} not limited to it. `
    + `Browse its documentation with jamf_docs_get_toc (product "${product}").`;
}

/**
 * Apply filters with progressive relaxation when results are zero.
 * Relaxation order: docType -> topic -> product
 *
 * Two cases are settled before relaxation rather than by it.
 *
 * A product that could not be filtered (`unfilterableProduct`: Jamf
 * classifies nothing under it, and the registry has no map of its own
 * publication to filter by instead) is reported as removed up front. It is not
 * among `activeFilters`, so it cannot be what empties the page, and topic and
 * docType are not relaxed away on its account. They used to be: the search
 * went out unfiltered, the local product filter matched none of it, and
 * relaxation removed topic before reaching product — `product:
 * 'jamf-routines', topic: 'scripts'` returned 50 unfiltered results where
 * `topic: 'scripts'` alone returned 4 (live, 2026-09-26).
 *
 * And a fetch that came back empty is not relaxed at all. Relaxation only
 * re-filters what was fetched, so with nothing there removing a filter changes
 * nothing, and "Removed filter(s): product" would name a filter that held —
 * upstream, where it matched no document for this query. Every one of the 40
 * empty product x query cells measured on 2026-09-26 carried that notice.
 */
function applyFiltersWithFallback(
  allResults: SearchResultWithMeta[],
  activeFilters: ActiveFilter[],
  unfilterableProduct?: ProductId,
): { filtered: SearchResultWithMeta[]; relaxation?: FilterRelaxation } {
  const removed: string[] = [];
  const original: Record<string, string> = {};
  const notes: string[] = [];

  if (unfilterableProduct !== undefined) {
    removed.push('product');
    original.product = unfilterableProduct;
  }

  let filtered = applyAll(allResults, activeFilters);

  if (filtered.length === 0 && allResults.length > 0) {
    // Progressive relaxation
    const relaxOrder: FilterName[] = ['docType', 'topic', 'product'];
    const relaxed: string[] = [];

    for (const filterName of relaxOrder) {
      if (filtered.length > 0) { break; }

      const filterIndex = activeFilters.findIndex(f => f.name === filterName);
      if (filterIndex === -1) { continue; }

      const removedFilter = activeFilters[filterIndex];
      if (removedFilter === undefined) { continue; }
      relaxed.push(removedFilter.name);
      original[removedFilter.name] = removedFilter.value;
      activeFilters.splice(filterIndex, 1);

      // Re-apply remaining filters
      filtered = applyAll(allResults, activeFilters);
    }

    if (relaxed.length > 0) {
      removed.push(...relaxed);
      const scope = unfilterableProduct === undefined ? 'all filters' : 'the remaining filters';
      notes.push(
        `No results with ${scope} applied. Removed filter(s): ${relaxed.join(', ')}. `
        + 'Try broader search terms or fewer filters.'
      );
    }
  }

  if (removed.length === 0) {
    return { filtered };
  }
  if (unfilterableProduct !== undefined) {
    // First, as it was before relaxation ran; worded by what it came to.
    notes.unshift(unfilterableProductNote(unfilterableProduct, filtered.length > 0));
  }
  return { filtered, relaxation: { removed, original, message: notes.join(' ') } };
}

// ─── Pages Cut to the Token Budget ─────────────────────────────

/** What a result costs against `maxTokens`: its title, snippet and URL. */
function resultToString(r: SearchResult): string {
  return `${r.title}\n${r.snippet}\n${r.url}`;
}

/**
 * One result larger than `maxTokens` on its own, with its snippet cut to the
 * longest start that fits and ended with `…`.
 *
 * The title and URL are kept whole: they are what a caller reads the result
 * by and fetches it with. If they alone are over budget the snippet is `…`,
 * and the result is still shown: a page that shows nothing reaches nothing.
 * Cut between code points, so no character is split. Adding a character never
 * makes the result cheaper, so the longest start that fits is found by
 * halving.
 */
function cutSnippetToFit(result: SearchResult, maxTokens: number): SearchResult {
  const chars = Array.from(result.snippet);
  const cutAt = (count: number): SearchResult => ({
    ...result,
    snippet: `${chars.slice(0, count).join('').trimEnd()}…`,
  });
  let best = 0;
  let low = 1;
  let high = chars.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (estimateTokens(resultToString(cutAt(mid))) <= maxTokens) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return cutAt(best);
}

/** One page of a search, as {@link paginateSearchResults} cuts it. */
interface SearchPage {
  results: SearchResult[];
  offset: number;
  pagination: PaginationInfo;
  tokenInfo: TokenInfo;
  paginationNote?: string;
  truncatedResult?: SearchTruncatedResult;
}

/**
 * Page the results of a search to a token budget.
 *
 * A page is a run of whole results: as many as fit `maxTokens`, and at most
 * `pageSize` (the `limit` parameter). The next page starts at the first result
 * that did not fit. Until 2026-09-28 a page was `pageSize` results cut to the
 * budget afterwards, and page N+1 still began at result `pageSize`·N, so a
 * result the cut dropped was on no page. `truncatedContent` listed it, and the
 * footer advised `page`, which could not reach it. Live on 2026-09-28,
 * walking every page of `query: "enrollment"` (50 results of 37 to 139
 * tokens) reached 45 of them at the default budget with `limit: 50`, 42 at
 * `maxTokens: 1000` with the default `limit: 10`, and none at 100, where every
 * page was empty. Cutting while walking puts every result on exactly one page.
 * It is the walk the table of contents' pages take since #351, `pageStarts` in
 * budget-pages.ts.
 *
 * A result that costs more than `maxTokens` on its own gets a page to itself,
 * with its snippet cut to fit. That page is the only one with
 * `tokenInfo.truncated`, and `truncatedResult` says which result it is and
 * what it costs whole. At `maxTokens: 100` that is most of them: live, 38 to
 * 47 of the 48 to 50 results of each of five queries. One with no snippet to
 * cut is shown whole even over budget, as a table of contents' leaf is.
 *
 * `hasNext` stops at the last page `page` accepts (`PAGINATION_CONFIG.MAX_PAGE`)
 * even when there are more, and `paginationNote` then says what reaches the
 * rest (see {@link pagesPastTheLastNote}).
 */
function paginateSearchResults(
  results: SearchResult[],
  page: number,
  pageSize: number,
  maxTokens: number,
): SearchPage {
  const costs = results.map(r => estimateTokens(resultToString(r)));
  const starts = pageStarts(costs, maxTokens, pageSize);
  const totalPages = starts.length;
  const current = Math.min(Math.max(1, page), Math.max(totalPages, 1));
  const start = starts[current - 1] ?? 0;
  const end = starts[current] ?? results.length;

  let shown = results.slice(start, end);
  let tokenCount = costs.slice(start, end).reduce((sum, cost) => sum + cost, 0);
  let truncatedResult: SearchTruncatedResult | undefined;

  const [only] = shown;
  if (shown.length === 1 && only !== undefined && tokenCount > maxTokens && only.snippet !== '') {
    const cut = cutSnippetToFit(only, maxTokens);
    truncatedResult = { title: only.title, estimatedTokens: tokenCount };
    shown = [cut];
    tokenCount = estimateTokens(resultToString(cut));
  }

  const notes = [
    buildPaginationNote({ pageWasClamped: current !== page, requestedPage: page, totalPages }),
    // The Fluid Topics path asks for 50 clusters and returns a result for
    // each topic in them (see dedupeToLatestVersions), so it can pass 50
    // results. The most measured on 2026-09-28 was 98, for en-US "technical
    // articles", which is 87 pages at `maxTokens: 100`: under the cap. A
    // SearchProvider can return enough to pass it.
    pagesPastTheLastNote(
      costs,
      { maxTokens, pageSize, totalPages, widestPageSize: CONTENT_LIMITS.MAX_SEARCH_RESULTS },
      { name: `these ${String(results.length)} results`, plural: true, items: 'results' },
    ),
  ].filter((note): note is string => note !== undefined);

  return {
    results: shown,
    offset: start,
    pagination: {
      page: current,
      pageSize,
      totalPages,
      totalItems: results.length,
      // Not past the last page `page` accepts: pointing there would send the
      // caller to a request the input schema rejects.
      hasNext: current < Math.min(totalPages, PAGINATION_CONFIG.MAX_PAGE),
      hasPrev: current > 1,
    },
    tokenInfo: { tokenCount, truncated: truncatedResult !== undefined, maxTokens },
    ...(notes.length > 0 ? { paginationNote: notes.join(' ') } : {}),
    ...(truncatedResult !== undefined ? { truncatedResult } : {}),
  };
}

// ─── Convert flat SearchResult to SearchResultWithMeta ─────────

/**
 * `matchedTopics` is computed unconditionally, not only when the caller asked
 * for a topic filter.
 *
 * It used to be gated on `params.topic !== undefined`, which made the cached
 * value a function of something that is not in — and cannot be in — the FT
 * request the cache is keyed on. A topic-less search wrote entries carrying
 * `matchedTopics: []`, and the next search for the same query WITH a topic hit
 * that entry, found nothing matching, and silently relaxed the topic filter it
 * had never actually run. Same question, different answer depending on cache
 * state; verified against the live path before this change.
 *
 * Computing it always costs 284 substring checks per result on a cache miss —
 * 40 topics' keyword lists, and only on the write path — which is the cheaper
 * half of the trade by a wide margin.
 */
function toSearchResultWithMeta(
  result: SearchResult,
  ft?: { labelKeys: string[]; classification: string[] },
): SearchResultWithMeta {
  // Prefer the full label set read off FT metadata: a topic carries several
  // and `result.docType` is only the most specific one, so re-deriving from it
  // would narrow a release note back down to release-notes alone. A
  // SearchProvider hands us a flat SearchResult with no metadata to read, so
  // there the single docType is all there is.
  const labelKeys: string[] = ft?.labelKeys ?? (
    result.docType !== undefined ? [DOC_TYPE_LABEL_MAP[result.docType]] : []
  );

  return {
    result,
    // The same holds for the product, and more strongly. `result.product` is
    // ONE of the classification values, picked for display, and filtering on
    // it is the defect #334 describes; the filter needs all of them. Nor can
    // `result.mapId` stand in: FT mapIds are opaque hashes (e.g.
    // 'uRhiWJWbjHyL1vegaHmj8g'), not bundle stems.
    classification: ft?.classification ?? null,
    // Matched on the document's own text. The short-snippet fallback is the
    // title plus the product the result is shown under, and that product is
    // attribution, not content: several topics list product names among their
    // keywords, so "11.42 — Jamf Connect" matched connect-login — and still
    // did once a jamf-trust search showed it as "11.42 — Jamf Trust".
    matchedTopics: matchTopics(
      result.title,
      result.snippet === titleProductSnippet(result.title, result.product) ? '' : result.snippet,
    ),
    labelKeys,
  };
}

// ─── Version Transparency ──────────────────────────────────────

/** A `version` value that asks for a specific snapshot rather than "whatever is current". */
function isSpecificVersion(version: string | undefined): version is string {
  return version !== undefined && version !== '' && version !== 'current';
}

/**
 * Explain a `version` filter that was asked for but demonstrably not applied.
 *
 * On the Fluid Topics path the filter goes upstream ({@link buildSearchFilters}),
 * so the API enforces it. On the SearchProvider path nothing here enforces
 * it — the provider is handed `params`, and its results are only collapsed to
 * one version per topic, the requested one wherever a topic has it
 * ({@link dedupeResultsToLatestVersions}). This runs on what survives. When a
 * surviving article is stamped with a *different* version, the filter provably
 * did not hold, and staying silent means the tool echoes `filters.version`
 * back as though it had: a claim about the result set that is false.
 *
 * Only a positive mismatch counts. Results with no version metadata are the
 * normal shape for the unversioned products (School, Connect, Protect, …) and
 * say nothing either way, so they must not raise the note.
 */
function buildVersionNote(
  requestedVersion: string | undefined,
  fromProvider: boolean,
  results: SearchResultWithMeta[],
): string | undefined {
  if (!fromProvider || !isSpecificVersion(requestedVersion)) {
    return undefined;
  }

  const mismatched = results.some(
    r => r.result.version !== undefined && r.result.version !== requestedVersion
  );
  if (!mismatched) {
    return undefined;
  }

  return `Version "${requestedVersion}" was not available for some results. `
    + 'The search backend returned articles from other versions; they are shown as-is.';
}

// ─── A Search That Could Not Be Completed ──────────────────────

/** A part of a search that can fail. */
type SearchStep =
  /** The injected SearchProvider. */
  | 'provider'
  /** The maps list a classified product's filter is built from. */
  | 'maps'
  /** The request to the Fluid Topics clustered search. */
  | 'fluid-topics'
  /** Reading what the clustered search answered. */
  | 'fluid-topics-response';

/**
 * What one step of a search threw, and which step it was.
 *
 * Thrown inside {@link resolveSearchResults} for {@link searchDocumentation}
 * to catch, because the message has to say what failed and the error alone
 * cannot: a network error from the maps list and one from the search are the
 * same `TypeError('fetch failed')`.
 */
class SearchStepError extends Error {
  readonly step: SearchStep;
  readonly failure: unknown;

  constructor(step: SearchStep, failure: unknown) {
    super(String(failure));
    this.name = 'SearchStepError';
    this.step = step;
    this.failure = failure;
  }
}

/** A `.catch` handler that rethrows what `step` threw, tagged with the step. */
function failedAt(step: SearchStep): (error: unknown) => never {
  return (error: unknown) => {
    throw new SearchStepError(step, error);
  };
}

const NOT_A_NO_RESULTS =
  'This is not a "no results": the search did not complete, so it cannot say whether the ' +
  'documentation has anything for this query.';

/**
 * A failed search, written for the caller: what failed and why, that this is
 * not a "no results", and whether trying again may help. The tool returns it
 * as is, with `isError: true`, as the glossary does with its own (#324).
 *
 * Until 2026-09-28 the tool answered a failed search with the reply for a
 * query nothing matches: "No results found", suggestions to change the query,
 * and no `isError`. Reproduced on 6.0.12 over stdio with learn.jamf.com
 * unreachable, and offline with the clustered search answering 503.
 *
 * What failed, and the advice for it:
 *
 * - A request to learn.jamf.com, for the search or for the maps list: the
 *   reason the glossary gives ({@link describeFetchFailure}), and "may be
 *   temporary" by the rule the glossary follows too ({@link mayBeTemporary}).
 * - A clustered-search answer that is not in the shape this server reads:
 *   learn.jamf.com is named, and it may be temporary, as the glossary says of
 *   a table of contents that came back with no terms.
 * - A SearchProvider, or a MapsProvider the maps list comes from: the error's
 *   own message, which is all this server knows of it, and no advice, which
 *   only the provider could give. Not learn.jamf.com, which was not asked.
 *   A MapsProvider is named only when it threw ({@link MapsProviderError}):
 *   one whose answer the registry could not use is replaced by learn.jamf.com,
 *   and a failure there is learn.jamf.com's. The glossary words its own maps
 *   list the same way: both take the words from {@link describeMapsListFailure}.
 * - Anything else: plain words, and the server log for what went wrong. The
 *   error itself is left out, because a raw JavaScript message ("clusters is
 *   not iterable") tells a caller nothing it can act on. A cache that fails
 *   is one of these only for a caller that hands `searchDocumentation` a
 *   context of its own: `createMcpServer` guards it (cache-guard.ts).
 */
function searchFailureMessage(params: SearchParams, error: unknown): string {
  const step = error instanceof SearchStepError ? error.step : undefined;
  const cause = error instanceof SearchStepError ? error.failure : error;
  const reason = reasonGiven(cause);
  const mapsList = 'the list of documentation maps, which the product filter ' +
    `"${String(params.product)}" is built from,`;

  let failed: string;
  let advice: string | undefined;
  switch (step) {
    case 'provider':
      failed = reason === undefined
        ? 'the configured search backend reported an error without saying what went wrong'
        : `the configured search backend reported an error (${reason})`;
      break;
    case 'maps': {
      const maps = describeMapsListFailure(cause);
      failed = `${mapsList} ${maps.failed}`;
      advice = maps.advice;
      break;
    }
    case 'fluid-topics':
      failed = `the search results could not be fetched from learn.jamf.com (${describeFetchFailure(cause)})`;
      advice = mayBeTemporary(cause) ? MAY_BE_TEMPORARY : undefined;
      break;
    case 'fluid-topics-response':
      failed = 'learn.jamf.com answered the search with results in a form this server could not read';
      advice = MAY_BE_TEMPORARY;
      break;
    case undefined:
      failed = 'this server hit an unexpected error while searching';
      advice = UNEXPECTED_FAILURE_ADVICE;
  }

  const paragraphs = [`Search for "${params.query}" failed: ${failed}.`, NOT_A_NO_RESULTS];
  if (advice !== undefined) {
    paragraphs.push(advice);
  }
  return paragraphs.join('\n\n');
}

/** What a search that could not be completed reports. */
type SearchFailure = Required<Pick<SearchDocumentationResult, 'searchError' | 'searchErrorMessage'>>;

/** {@link SearchFailure} for what a search threw. */
function searchFailure(params: SearchParams, error: unknown): SearchFailure {
  return {
    // What was thrown, not the step it was tagged with, so `searchError` reads
    // as it always has.
    searchError: String(error instanceof SearchStepError ? error.failure : error),
    searchErrorMessage: searchFailureMessage(params, error),
  };
}

// ─── Main Search Function ──────────────────────────────────────

/**
 * Search Jamf documentation using the Fluid Topics clustered-search API.
 *
 * 1. Checks SearchProvider first (custom backend injection).
 * 2. Calls ft-client.search() with constructed filters.
 * 3. Transforms results and applies post-processing pipeline:
 *    - Client-side product/topic/docType filtering with progressive relaxation
 *    - Pages cut to `maxTokens` (see {@link paginateSearchResults})
 *
 * Does not throw when the search cannot be completed: the result has no
 * results, and `searchError` and `searchErrorMessage` say what failed (see
 * {@link searchFailureMessage}). A caller must check them before reading no
 * results as "nothing matches".
 */
export async function searchDocumentation(
  ctx: ServerContext,
  params: SearchParams
): Promise<SearchDocumentationResult> {
  const log = ctx.logger.createLogger('search-service');
  const page = params.page ?? PAGINATION_CONFIG.DEFAULT_PAGE;
  const pageSize = params.limit ?? CONTENT_LIMITS.DEFAULT_SEARCH_RESULTS;
  const maxTokens = params.maxTokens ?? TOKEN_CONFIG.DEFAULT_MAX_TOKENS;

  let allResults: SearchResultWithMeta[];
  let fromProvider = false;
  let productUnfilterable = false;
  let productPublication: ReadonlySet<string> | undefined;
  let rankedBy: SearchDocumentationResult['rankedBy'];
  let failure: SearchFailure | undefined;

  try {
    const resolved = await resolveSearchResults(ctx, params, log);
    allResults = resolved.results;
    fromProvider = resolved.fromProvider;
    productUnfilterable = resolved.productUnfilterable;
    if (resolved.productPublication !== undefined) {
      productPublication = new Set(resolved.productPublication);
    } else if (fromProvider && isUnclassified(params.product)) {
      // Nothing was sent upstream, but the provider's results are still
      // matched against the product's publication (see fromPublication). With
      // no map of it, or no maps list, they are matched by URL and name only.
      const filter = await resolveSearchProductFilter(ctx, params.product, log);
      productPublication = new Set(filter?.values ?? []);
    }
    rankedBy = fromProvider ? 'provider' : 'fluid-topics';
  } catch (error) {
    failure = searchFailure(params, error);
    log.error(`Search error: ${failure.searchError}`);
    allResults = [];
  }

  // Build and apply filters with progressive relaxation
  const activeFilters = buildActiveFilters(params, !productUnfilterable, productPublication);
  const { filtered: filteredResults, relaxation: filterRelaxation } =
    applyFiltersWithFallback(allResults, activeFilters, productUnfilterable ? params.product : undefined);

  // Display follows the filter (see showUnderProduct), but only while it held:
  // a product filter that was relaxed or could not be applied says nothing
  // about which product the results are.
  const shownUnder = filterRelaxation?.removed.includes('product') === true
    ? undefined
    : params.product;

  // Priced as shown: showing a result under the product searched for can
  // change a stand-in snippet, which names the product.
  const shownResults = filteredResults
    .map(r => shownUnder === undefined ? r.result : showUnderProduct(r.result, shownUnder));
  const { results, offset, pagination, tokenInfo, paginationNote, truncatedResult } =
    paginateSearchResults(shownResults, page, pageSize, maxTokens);

  const versionNote = buildVersionNote(params.version, fromProvider, filteredResults);

  return {
    results,
    offset,
    pagination,
    tokenInfo,
    ...(paginationNote !== undefined ? { paginationNote } : {}),
    ...(versionNote !== undefined ? { versionNote } : {}),
    ...(filterRelaxation !== undefined ? { filterRelaxation } : {}),
    ...(truncatedResult !== undefined ? { truncatedResult } : {}),
    ...failure,
    ...(rankedBy !== undefined ? { rankedBy } : {}),
  };
}

// ─── Internal: Resolve results from provider or FT API ─────────

/**
 * Build a deterministic cache key for FT search results.
 *
 * Keyed off the *actual request object* rather than a hand-assembled string,
 * which buys two properties the previous projection did not have.
 *
 * **Injective.** The old key was `ft-search:{locale}:{query}:{k}={v}|{k}={v}`
 * with none of `: | = ,` escaped, while both `query` and `version` are
 * caller-supplied free text. Searching `{product: 'jamf-pro', version: '11.5'}`
 * and `{version: '11.5|zoominmetadata=product-pro'}` produced the byte-identical
 * key `ft-search:en-US:FileVault:version=11.5|zoominmetadata=product-pro` while
 * sending different filters upstream, so whichever ran first served its results
 * to the other for the whole TTL. One `FileCache` is shared per process
 * (src/index.ts), so under `--transport http` that crosses clients. JSON escapes
 * the delimiters, so no input can forge a neighbouring key.
 *
 * **Total.** Every field of the request is in the key — `sortId` included — so
 * a relevance-sorted and a last_update-sorted query cannot come to share one
 * entry the moment sort becomes configurable.
 *
 * That holds only while the cached value is a function of this request and
 * nothing else. `params.topic` is deliberately NOT here: it selects a
 * client-side post-filter, and `matchedTopics` is computed unconditionally
 * (see {@link toSearchResultWithMeta}) precisely so the stored value does not
 * vary with it. It used to, and a topic-less search then served its entry to a
 * topic search that silently relaxed the filter it never ran. Anything added to
 * the cached value that comes from `SearchParams` rather than from this request
 * reopens that hole and belongs in the key instead.
 *
 * `paging` is part of the keyed object but constant in practice: this layer
 * always fetches one over-fetched page and paginates client-side.
 */
export function buildSearchCacheKey(request: FtSearchRequest): CacheKey {
  return cacheKey('ft-search-v2', {
    query: request.query,
    // `?? null` rather than passing `undefined` through: the space declares
    // these nullable so that "absent" is one value, not two. `cacheKey` drops
    // undefined parts, so leaving them undefined would key an omitted locale
    // identically to a present one only by accident of that dropping rule.
    contentLocale: request.contentLocale ?? null,
    sortId: request.sortId ?? null,
    perPage: request.paging?.perPage ?? null,
    page: request.paging?.page ?? null,
    // Sorted into a canonical form here rather than in `cacheKey`, which must
    // not reorder arrays: a filter list is a set upstream, but `['a','b']` and
    // `['b','a']` are different data in general, and a helper that collapsed
    // them would be the very non-injectivity this replaces. Compared by
    // UTF-16 code unit on the serialized tuple, not `localeCompare` — a total
    // order and it does not vary with the runtime's ICU locale.
    filters: [...(request.filters ?? [])]
      .map(f => [f.key, [...f.values].sort()] as [string, readonly string[]])
      .sort((a, b) => {
        const left = JSON.stringify(a);
        const right = JSON.stringify(b);
        if (left < right) { return -1; }
        return left > right ? 1 : 0;
      }),
  });
}

/**
 * Where a result set came from. `fromProvider` is what tells the caller whether
 * the upstream `version` filter was applied — see {@link buildVersionNote}.
 */
interface ResolvedSearchResults {
  results: SearchResultWithMeta[];
  fromProvider: boolean;
  /**
   * A `product` was asked for that Jamf classifies nothing under, and the
   * registry has no map of its own publication to filter by instead, so no
   * filter for it exists upstream or here, and the results were fetched
   * without one. Not set merely because {@link resolveProductFilter} returned
   * null: when the registry cannot place a classification value, the product
   * is still filtered locally. Always false on the provider path, which is
   * handed `params` and whose results are then filtered by the name each one
   * reports, and for a product with no classification by its publication too
   * ({@link fromPublication}).
   */
  productUnfilterable: boolean;
  /**
   * The map ids a product with no classification was filtered by, upstream
   * as `ft:publicationId`, for the local filter to match each result's
   * `mapId` against. Absent for every other search, and on the provider path,
   * where {@link searchDocumentation} looks them up itself.
   */
  productPublication?: readonly string[];
}

async function resolveSearchResults(
  ctx: ServerContext,
  params: SearchParams,
  log: Logger
): Promise<ResolvedSearchResults> {
  // 1. Try SearchProvider first (custom backend injection — no caching)
  if (ctx.searchProvider !== undefined) {
    // Awaited inside a try, not tagged with `.catch` on what `search`
    // returns: a provider on untyped code can return its answer, or throw,
    // without a promise, and neither a plain answer nor a throw has `.catch`.
    let answer: unknown;
    try {
      answer = await ctx.searchProvider.search(params);
    } catch (error) {
      throw new SearchStepError('provider', error);
    }
    const provided = readSearchProviderResults(answer, log);
    if (provided !== null) {
      return {
        // Versions collapsed as the Fluid Topics path collapses them below, so
        // a topic comes back at one version whichever backend answered. Its
        // own ranking is kept; see dedupeResultsToLatestVersions for what it
        // can identify.
        results: dedupeResultsToLatestVersions(provided, params.version)
          .map(r => toSearchResultWithMeta(r)),
        fromProvider: true,
        productUnfilterable: false,
      };
    }
  }

  // 2. Build FT search request
  const locale = params.language ?? DEFAULT_LOCALE;

  const perPage = Math.min(
    CONTENT_LIMITS.MAX_SEARCH_RESULTS,
    CONTENT_LIMITS.FILTER_OVERFETCH_CAP
  );

  /** One cached round-trip to FT for a given filter set. */
  const fetchFiltered = async (filters: FtSearchFilter[]): Promise<SearchResultWithMeta[]> => {
    const request: FtSearchRequest = {
      query: params.query,
      contentLocale: locale,
      // Sent explicitly even though it matches Fluid Topics' default, so the
      // ordering this server promises its callers is a stated request
      // parameter rather than an undocumented upstream default that could
      // change under us. Verified identical to omitting it, and clearly
      // distinct from `last_update`, against the live corpus.
      sortId: 'relevance',
      paging: { perPage, page: 1 },
      filters,
    };
    const key = buildSearchCacheKey(request);

    const cached = await ctx.cache.get<SearchResultWithMeta[]>(key);
    if (cached !== null) {
      log.debug(`Search cache hit: key="${key}", ${cached.length} results`);
      return cached;
    }

    log.debug(
      `FT search: query="${params.query}", product=${params.product ?? 'all'}, ` +
      `locale=${locale}, filters=${JSON.stringify(filters)}`
    );

    const ftResponse: FtClusteredSearchResponse = await ftSearch(ctx.http, request)
      .catch(failedAt('fluid-topics'));

    // Collapse version snapshots to the latest per topic, then transform.
    // Deduping before transform avoids running cleanSnippet etc. over every
    // Jamf Pro version variant (a broad query can return ~15 snapshots/topic).
    const out: SearchResultWithMeta[] = [];
    try {
      for (const { entry, collapsedVersions } of dedupeToLatestVersions(ftResponse.results)) {
        const searchResult = transformFtSearchResult(entry);
        if (searchResult.url !== '') {
          const metadata = entryMetadata(entry);
          out.push(toSearchResultWithMeta(
            { ...searchResult, ...(collapsedVersions.length > 0 ? { otherVersions: collapsedVersions } : {}) },
            { labelKeys: docTypeLabelKeys(metadata), classification: classificationValues(metadata) },
          ));
        }
      }
    } catch (error) {
      // An answer that is not a clustered-search response, such as a 200 with
      // `{}` for a body ("clusters is not iterable").
      throw new SearchStepError('fluid-topics-response', error);
    }

    // Cache the raw results (before client-side filtering)
    await ctx.cache.set(key, out, ctx.config.cacheTtl.search);
    log.debug(`FT search returned ${out.length} results (cached)`);
    return out;
  };

  const productFilter = await resolveSearchProductFilter(ctx, params.product, log)
    .catch(failedAt('maps'));
  // No upstream filter has two causes, and only one makes the product
  // unfilterable. A product with no classification value, whose publication
  // the registry has no map of either, cannot be filtered anywhere. A value
  // the registry cannot place (an empty or trimmed maps list) only costs the
  // upstream filter: every result still carries its classification, so the
  // local filter narrows the unfiltered fetch, and relaxes as any filter does
  // if nothing fetched belongs to the product.
  const unclassified = isUnclassified(params.product);
  const productUnfilterable = unclassified && productFilter === null;
  const productPublication = unclassified && productFilter !== null ? productFilter.values : undefined;
  if (productUnfilterable) {
    log.debug(
      `No classification filter for product "${String(params.product)}", and no map of its ` +
      'publication to filter by; searching without one'
    );
  } else if (params.product !== undefined && productFilter === null) {
    log.debug(
      `Product "${params.product}" has no classification axis in the maps registry; ` +
      'searching without an upstream product filter and filtering locally'
    );
  }
  let results = await fetchFiltered(buildSearchFilters(params, productFilter));

  // 3. Re-query without docType when narrowing by it emptied the result set
  //    upstream.
  //
  //    docType is now a `content-*` filter on the API rather than a value of
  //    the much broader `jamf:contentType`, so a product+docType pair whose
  //    two labels never co-occur returns nothing at all instead of returning
  //    the product's topics for the post-filter to narrow. Measured on the
  //    live corpus for query "enrollment": `content-solutionguide` matches 40
  //    topics and `product-protect` 35, but their intersection is 0 — Jamf
  //    publishes no Jamf Protect solution guides.
  //
  //    {@link applyFiltersWithFallback} is a *client-side* relaxation: it can
  //    only re-filter what was fetched, so an empty upstream response leaves it
  //    nothing to relax and the caller reports a bare "no results" that does not
  //    even name docType as the cause. Dropping the filter here restores the
  //    fetch the relaxation expects — the post-filter then empties it again and
  //    the existing relaxation reports `removed: ['docType']`, which is what the
  //    user needs to see.
  if (results.length === 0 && params.docType !== undefined) {
    log.debug(`Empty upstream result with docType="${params.docType}"; re-querying without it`);
    results = await fetchFiltered(buildSearchFilters(
      { version: params.version },
      productFilter,
    ));
  }

  return {
    results,
    fromProvider: false,
    productUnfilterable,
    ...(productPublication !== undefined ? { productPublication } : {}),
  };
}
