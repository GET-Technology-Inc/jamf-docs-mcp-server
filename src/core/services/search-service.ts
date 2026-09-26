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
  TruncatedContentInfo,
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
import { cleanSnippet, titleProductSnippet } from './content-parser.js';
import { cacheKey, type CacheKey } from './cache-key.js';
import type { ProductId } from '../constants.js';
import { extractBundleStemFromUrl } from '../utils/url.js';
import { getMetaValue, getMetaValues, FT_META } from '../utils/ft-metadata.js';
import { compareVersions } from '../utils/bundle.js';
import { dedupeResultsToLatestVersions } from './search-result-versions.js';
import {
  estimateTokens,
  calculatePagination,
  truncateListByTokens,
  buildPaginationNote,
} from './tokenizer.js';

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
  /** Versions collapsed into this one, newest first. Empty when nothing was. */
  collapsedVersions: string[];
}

/**
 * Collapse Fluid Topics version snapshots to a single result per topic.
 *
 * Jamf Pro documentation publishes a separate search entry for every product
 * version (11.13 … 11.29), all sharing the same `ft:clusterId`. We keep only the
 * highest-versioned entry per cluster so the user sees one (latest) result per
 * topic. Non-versioned products (Jamf School, Connect, Protect, …) carry a single
 * entry per topic and a distinct `ft:clusterId`, so they pass through untouched.
 * Entries with no `ft:clusterId` cannot be version-deduped and are each kept.
 *
 * First-seen (relevance) order is preserved.
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
  const best = new Map<string, { entry: FtSearchEntry; version: string; seen: Set<string> }>();
  let anonCount = 0;

  for (const cluster of clusters) {
    for (const entry of cluster.entries) {
      const metadata = entry.topic?.metadata ?? entry.map?.metadata ?? [];
      const clusterId = getMetaValue(metadata, FT_META.CLUSTER_ID);
      const version = getMetaValue(metadata, FT_META.VERSION);
      // Entries without a cluster id can't be version-deduped — keep each.
      const key = clusterId !== '' ? clusterId : `anon-${anonCount++}`;
      const existing = best.get(key);
      if (existing === undefined) {
        order.push(key);
        best.set(key, { entry, version, seen: new Set(version !== '' ? [version] : []) });
      } else {
        if (version !== '') { existing.seen.add(version); }
        if (compareVersions(version, existing.version) > 0) {
          existing.entry = entry;
          existing.version = version;
        }
      }
    }
  }

  const out: DedupedEntry[] = [];
  for (const key of order) {
    const hit = best.get(key);
    if (hit === undefined) { continue; }
    // Only the versions that lost. The survivor's own version is reported as
    // the result's `version`, so repeating it here would read as a duplicate.
    const collapsed = [...hit.seen]
      .filter(v => v !== hit.version)
      .sort((a, b) => compareVersions(b, a));
    out.push({ entry: hit.entry, collapsedVersions: collapsed });
  }
  return out;
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
  const versionValues = getMetaValues(metadata, FT_META.VERSION);
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

  const firstVersion = versionValues[0];
  if (firstVersion !== undefined) {
    result.version = firstVersion;
  }
  if (fields.breadcrumb !== undefined && fields.breadcrumb.length > 0) {
    result.breadcrumb = fields.breadcrumb;
  }
  if (fields.mapTitle !== undefined && fields.mapTitle !== '') {
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
 */
function unfilterableProductNote(product: ProductId): string {
  const { name, bundleId } = JAMF_PRODUCTS[product];
  return `The product filter "${product}" was not applied: Jamf classifies no `
    + `documentation as ${name}, and no map of its publication "${bundleId}" was `
    + 'found to filter by instead, so these results are not limited to it. '
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
    notes.push(unfilterableProductNote(unfilterableProduct));
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
  return { filtered, relaxation: { removed, original, message: notes.join(' ') } };
}

// ─── Token Truncation ──────────────────────────────────────────

function resultToString(r: SearchResult): string {
  return `${r.title}\n${r.snippet}\n${r.url}`;
}

function truncateSearchResults(
  paginatedResults: SearchResult[],
  maxTokens: number
): {
  finalResults: SearchResult[];
  finalTokenCount: number;
  truncated: boolean;
  truncatedContent?: TruncatedContentInfo;
} {
  const { items: finalResults, tokenCount: finalTokenCount, truncated } =
    truncateListByTokens(paginatedResults, maxTokens, resultToString);

  if (!truncated) {
    return { finalResults, finalTokenCount, truncated: false };
  }

  const omittedResults = paginatedResults.slice(finalResults.length);
  const truncatedContent: TruncatedContentInfo = {
    omittedCount: omittedResults.length,
    omittedItems: omittedResults.map(r => ({
      title: r.title,
      estimatedTokens: estimateTokens(resultToString(r)),
    })),
  };

  return { finalResults, finalTokenCount, truncated: true, truncatedContent };
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

// ─── Main Search Function ──────────────────────────────────────

/**
 * Search Jamf documentation using the Fluid Topics clustered-search API.
 *
 * 1. Checks SearchProvider first (custom backend injection).
 * 2. Calls ft-client.search() with constructed filters.
 * 3. Transforms results and applies post-processing pipeline:
 *    - Client-side product/topic/docType filtering with progressive relaxation
 *    - Pagination
 *    - Token truncation
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
  let searchError: string | undefined;

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
    const message = String(error);
    log.error(`Search error: ${message}`);
    allResults = [];
    searchError = message;
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

  // Calculate pagination
  const paginationInfo = calculatePagination(filteredResults.length, page, pageSize);

  const paginatedResults = filteredResults
    .slice(paginationInfo.startIndex, paginationInfo.endIndex)
    .map(r => shownUnder === undefined ? r.result : showUnderProduct(r.result, shownUnder));

  const { finalResults, finalTokenCount, truncated, truncatedContent } =
    truncateSearchResults(paginatedResults, maxTokens);

  const paginationNote = buildPaginationNote(paginationInfo);
  const versionNote = buildVersionNote(params.version, fromProvider, filteredResults);

  return {
    results: finalResults,
    pagination: {
      page: paginationInfo.page,
      pageSize: paginationInfo.pageSize,
      totalPages: paginationInfo.totalPages,
      totalItems: filteredResults.length,
      hasNext: paginationInfo.hasNext,
      hasPrev: paginationInfo.hasPrev,
    },
    tokenInfo: {
      tokenCount: finalTokenCount,
      truncated,
      maxTokens,
    },
    ...(paginationNote !== undefined ? { paginationNote } : {}),
    ...(versionNote !== undefined ? { versionNote } : {}),
    ...(filterRelaxation !== undefined ? { filterRelaxation } : {}),
    ...(truncatedContent !== undefined ? { truncatedContent } : {}),
    ...(searchError !== undefined ? { searchError } : {}),
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
    const provided = await ctx.searchProvider.search(params);
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

    const ftResponse: FtClusteredSearchResponse = await ftSearch(ctx.http, request);

    // Collapse version snapshots to the latest per topic, then transform.
    // Deduping before transform avoids running cleanSnippet etc. over every
    // Jamf Pro version variant (a broad query can return ~15 snapshots/topic).
    const out: SearchResultWithMeta[] = [];
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

    // Cache the raw results (before client-side filtering)
    await ctx.cache.set(key, out, ctx.config.cacheTtl.search);
    log.debug(`FT search returned ${out.length} results (cached)`);
    return out;
  };

  const productFilter = await resolveSearchProductFilter(ctx, params.product, log);
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
