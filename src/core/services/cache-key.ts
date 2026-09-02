/**
 * Cache key derivation.
 *
 * Every cached value in this server shares one `CacheProvider` instance (one
 * `FileCache` per process — see src/index.ts), so a key is only useful if it
 * satisfies two properties, and this module exists to make both of them the
 * compiler's job rather than the caller's.
 *
 * **Injective** — different data must never collide onto one key. `CacheKey`
 * is a branded string that only {@link cacheKey} can mint, and the payload is
 * canonical JSON, so no value can forge a neighbouring key by embedding a
 * delimiter. The hole this closes was real: `ft-search:{locale}:{query}:{k}={v}`
 * with nothing escaped let `{version: '11.5|zoominmetadata=product-pro'}`
 * produce the same key as `{product: 'jamf-pro', version: '11.5'}`.
 *
 * **Total** — everything the value depends on must be *in* the key.
 * {@link CacheKeySpaces} does NOT discover what a value depends on; nothing
 * can. What it does is make the answer explicit and then hold every call site
 * to it: once a namespace declares its parts, omitting one is a compile error
 * and misspelling one is a compile error. Deciding what belongs on that list
 * is still a human judgement, and getting it wrong is still a bug the compiler
 * cannot see — as it did not see glossary entries keyed on `{ locale }` while
 * the content was fetched per `mapId`, so two maps' glossaries in the same
 * locale overwrote each other. Reading the fetch is what found that; the types
 * are what stop it drifting back.
 *
 * Note what is deliberately NOT here: hashing, truncation, or any other
 * accommodation of a backend's key limits. Those are properties of the store,
 * not of the identity of the data, and the store is already injected —
 * `FileCache` sha256s whatever it is handed (src/platforms/node/cache.ts), and
 * a Workers KV implementation would do the same for its own 512-byte ceiling.
 * Keys here stay readable, which is what makes a cache directory debuggable.
 */

import type { LocaleId } from '../constants/index.js';

declare const CACHE_KEY_BRAND: unique symbol;

/** A key produced by {@link cacheKey}. Not constructible by concatenation. */
export type CacheKey = string & { readonly [CACHE_KEY_BRAND]: true };

type CacheKeyScalar = string | number | boolean | null;

/**
 * Key material: scalars and nested arrays only.
 *
 * Nested *objects* are deliberately excluded. Their property order is caller
 * controlled and `JSON.stringify` preserves it, so `{a:1,b:2}` and `{b:2,a:1}`
 * would key one value twice. Arrays are ordered data and serialize as given —
 * a caller holding an unordered collection sorts it first (see
 * `buildSearchCacheKey`), because sorting *here* would map `['a','b']` and
 * `['b','a']` onto one key and destroy the injectivity this exists for.
 */
export type CacheKeyValue = CacheKeyScalar | readonly CacheKeyValue[];

/**
 * `[filterKey, sortedValues]` pairs, the list itself sorted.
 *
 * A tuple rather than an object because {@link CacheKeyValue} excludes nested
 * objects; canonicalising into this shape is `buildSearchCacheKey`'s job.
 */
export type CanonicalSearchFilters = readonly (readonly [string, readonly string[]])[];

/**
 * Every cache this server keeps, mapped to the parts that identify ONE entry
 * in it. `null` means the cache holds a single entry and takes no parts.
 *
 * Adding a cache means adding a line here and a line to
 * {@link CACHE_NAMESPACE_REGISTRY}; there is no other way to address one. No
 * member may contain `:` — that is what keeps the `namespace:payload` split
 * unambiguous, and it is locked by a unit test.
 */
/* eslint-disable @typescript-eslint/naming-convention --
   These are cache namespaces, not code identifiers: the literal strings that
   prefix keys on disk. They are kebab-case for the same reason the config
   already allows snake_case on typeProperty for API response shapes — the
   format is dictated by what they name, not by TypeScript convention. */
export interface CacheKeySpaces {
  'ft-search': {
    query: string;
    contentLocale: string | null;
    sortId: string | null;
    perPage: number | null;
    page: number | null;
    filters: CanonicalSearchFilters;
  };
  // `articleUrl` is a determinant, not decoration. Fluid Topics' topic
  // metadata carries no `readerUrl` — the payload is `{contentApiEndpoint, id,
  // metadata, title}` — so `deriveDisplayUrl` always falls through to the
  // caller's URL, and that value is both stored as the article's `url` and
  // used as the base `parseArticle` resolves internal links against. Fetching
  // by `mapId`+`contentId` passes `''` for it, so without this part the first
  // such call would cache an article whose `url` is empty and serve it to
  // every later caller that asked by URL.
  'ft-article-v3': { mapId: string; contentId: string; articleUrl: string };
  // `product` is a ProductId **or** a bundle family stem: `get_toc` addresses
  // both axes and they land in the same cache. The two id spaces overlap on
  // exactly one value — `jamf-app-catalog` is both a product id and its own
  // bundle stem — and there they name the same publication, so sharing the
  // namespace cannot serve one caller another's TOC. Kept as `product` rather
  // than renamed: the field name is part of the key material, so renaming it
  // would orphan every TOC entry on disk to buy nothing.
  'ft-toc': { locale: LocaleId; product: string; version: string };
  'ft-tocindex-v2': { mapId: string };
  'ft-topic-index': { mapId: string };
  // `mapId` and nothing else. `fetchGlossaryToc` calls `fetchMapToc(mapId)`
  // and `fetchGlossaryContent` calls `fetchTopicContent(mapId, contentId)`;
  // the `locale` both functions also take never reaches the fetch, and a
  // Fluid Topics mapId is already locale-specific (each language has its own
  // mapId for the same publication), so listing locale here would assert a
  // determinant that is not one. `mapId` was the part actually missing: these
  // were keyed on locale alone, so two maps' glossaries in one locale
  // overwrote each other.
  'glossary-toc': { mapId: string };
  'glossary-content': { mapId: string; contentId: string };
  /**
   * An article from a non-Fluid-Topics source, keyed on the URL it was
   * fetched from.
   *
   * Not folded into `ft-article-v3`: that space is `{mapId, contentId,
   * articleUrl}`, and a static page has neither of the first two. `source`
   * rides along so two sources cannot collide on a path, even though the URL
   * alone already carries the hostname — it keeps the namespace readable on
   * disk, which is the stated reason these keys are not just hashes.
   */
  'static-article': { source: string; url: string };
  'maps-registry-v2': null;
  'metadata-products-v2': null;
  'metadata-topics': null;
  'metadata-product-availability': null;
}

/* eslint-enable @typescript-eslint/naming-convention */

export type CacheNamespace = keyof CacheKeySpaces;

type CacheKeyMaterial = Readonly<Record<string, CacheKeyValue | undefined>>;

/** The keys of `T` whose value type is not usable as key material. */
type NonMaterialKeys<T> = {
  [K in keyof T]-?: T[K] extends CacheKeyValue | undefined ? never : K;
}[keyof T];

/**
 * Whether a space can be turned into a key.
 *
 * Written as a per-property check rather than `T extends CacheKeyMaterial`,
 * because that form silently rejects a space declared as a named `interface`:
 * TypeScript gives implicit index signatures to type *aliases* and anonymous
 * object types but never to interfaces, so an interface failed the constraint
 * and reported `Type 'true' is not assignable to type 'never'` against the
 * registry — a line that says nothing about the declaration that caused it.
 *
 * `null extends T` rejects a union like `{ mapId: string } | null`. That form
 * satisfied the old constraint (both arms were assignable) but makes
 * `CacheKeyArgs` distribute to `[] | [parts]`, so `cacheKey(ns, null)` type
 * checked and then threw on `Object.keys(null)` at runtime.
 */
type IsKeyMaterial<T> =
  [T] extends [null] ? true
  : null extends T ? never
  : T extends object ? ([NonMaterialKeys<T>] extends [never] ? true : never)
  : never;

/**
 * One entry per namespace. The annotation carries two proofs the compiler
 * checks: the list is complete and typo-free (a missing namespace is TS2741,
 * an unknown one TS2353), and every space is usable as key material — a space
 * holding a `Date`, a function or a nested object maps to `never`, and `true`
 * is not assignable to `never`.
 */
const CACHE_NAMESPACE_REGISTRY: {
  readonly [N in CacheNamespace]: IsKeyMaterial<CacheKeySpaces[N]>;
} = {
  'ft-search': true,
  'ft-article-v3': true,
  'ft-toc': true,
  'ft-tocindex-v2': true,
  'ft-topic-index': true,
  'glossary-toc': true,
  'glossary-content': true,
  'static-article': true,
  'maps-registry-v2': true,
  'metadata-products-v2': true,
  'metadata-topics': true,
  'metadata-product-availability': true,
};

/** Every namespace, at runtime. The only enumerable list of this server's caches. */
export const CACHE_NAMESPACES: readonly CacheNamespace[] =
  Object.keys(CACHE_NAMESPACE_REGISTRY) as CacheNamespace[];

/** No parts for a single-entry cache; the declared parts, required, for any other. */
export type CacheKeyArgs<N extends CacheNamespace> =
  CacheKeySpaces[N] extends null ? [] : [parts: CacheKeySpaces[N]];

/**
 * Drop `undefined` parts and sort by property name, so a part list assembled
 * with the codebase's `...(x !== undefined ? { x } : {})` idiom keys the same
 * as one written out in full.
 */
function canonicalise(parts: CacheKeyMaterial): Record<string, CacheKeyValue> {
  const canonical: Record<string, CacheKeyValue> = {};
  for (const name of Object.keys(parts).sort()) {
    const value = parts[name];
    if (value !== undefined) {
      assertFinite(value, name);
      canonical[name] = value;
    }
  }
  return canonical;
}

/**
 * Reject non-finite numbers, which `JSON.stringify` maps to `null` — so `NaN`,
 * `Infinity` and a genuine `null` would all key the same entry, which is
 * exactly the collision this module exists to prevent. No caller passes one
 * today; this is here so that if one ever does it fails loudly at the call
 * site instead of quietly serving another entry's value.
 */
function assertFinite(value: CacheKeyValue, name: string): void {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new TypeError(
      `Cache key part '${name}' is ${String(value)}; only finite numbers can be part of a key.`
    );
  }
  if (Array.isArray(value)) {
    for (const item of value) { assertFinite(item as CacheKeyValue, name); }
  }
}

/**
 * Derive a cache key from a namespace and the parts {@link CacheKeySpaces}
 * declares for it.
 */
export function cacheKey<N extends CacheNamespace>(
  namespace: N,
  ...args: CacheKeyArgs<N>
): CacheKey {
  // `CacheKeyArgs<N>` does not narrow while `N` is still generic. The registry
  // above is what makes this assertion sound: every space is key material.
  const [parts] = args as readonly [CacheKeyMaterial?];
  const payload = parts === undefined ? '' : `:${JSON.stringify(canonicalise(parts))}`;
  return `${namespace}${payload}` as CacheKey;
}
