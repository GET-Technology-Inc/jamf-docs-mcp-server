/**
 * One load of a cache entry at a time.
 *
 * A cold entry is loaded by the first call that reads it, and a call that
 * reads it before that load has stored it would load it again. Calls made at
 * once do exactly that: they reach the entry within milliseconds of each
 * other, well inside one request. Until 2026-09-28 these readers had no such
 * guard: support.jamf.com's listings and collection trees, the static
 * sources' sitemaps, search title indexes and articles, a Fluid Topics table
 * of contents, and the glossary's table of contents and definitions. So five
 * cold `jamf_docs_list_products` calls at once requested each of the six home
 * pages five times, five `jamf_docs_search` calls each sitemap five times,
 * and five `jamf_docs_glossary_lookup` calls for `MDM` the glossary's table
 * of contents and both its definitions five times (measured offline,
 * test/unit/tools/support-and-sitemap-fanout.test.ts and
 * glossary-lookup-fanout.test.ts). Live, one of those pages takes up to
 * 1.25 s and weighs up to 551 KB (2026-09-28). A Fluid Topics article and
 * learn.jamf.com's search results had none either, until later that day:
 * five `jamf_docs_get_article` calls at once for one topic requested its
 * metadata and its body five times each, and five `jamf_docs_search` calls
 * for one query made five searches (fluid-topics-fanout.test.ts).
 *
 * A map's TOC index (`loadMapTocIndex` in ft-internal-link.ts, #341 for
 * #339) and topic index (`TopicResolver.getTopicIndex`, #78) had guards of
 * their own until 2026-09-28, and have loaded through this one since.
 * `getTopicIndex` read the cache ahead of its guard, which left the gap the
 * rule on `loadOnce` closes (test/unit/tools/cache-answering-late.test.ts).
 * `MapsRegistry.buildPromise` still runs one build of the registry at a time
 * (#78).
 */

import type { CacheKey } from './cache-key.js';
import type { CacheProvider } from './interfaces/cache.js';

/**
 * Loads still in flight, per cache and then per key.
 *
 * Keyed by the `CacheProvider` rather than module-level, as the glossary's
 * and the static sources' Fuse indexes are: it lives as long as the
 * context's provider, not as long as the module, which in a runtime where
 * module scope persists (Cloudflare Workers) outlives the request.
 * src/index.ts builds a server per HTTP request over one context, and
 * through `createMcpServer` each server's provider is that provider's guard
 * (`guardCache`), one per provider, which the context's `MapsRegistry` and
 * `TopicResolver` hold too, so all of them share these loads.
 * It holds a load only while it runs and nothing after it settles, so it can
 * neither serve a stale entry nor pin a failure: the cache stays the only
 * store.
 */
const loadsInFlight = new WeakMap<CacheProvider, Map<CacheKey, Promise<unknown>>>();

/**
 * What `load` answers, or what the load of `key` already in flight on
 * `cache` answers, failures included.
 *
 * `key` is the key of the entry `load` stores. `load` must read that entry
 * from `cache` before it fetches, and store what it fetched, if it stores
 * anything, before it settles. A caller that read the cache first and checked
 * for a load second could miss both, reading before the entry was stored and
 * checking after the load had cleared, so only the read inside the load
 * closes that gap.
 *
 * A caller that joins gets the load as the first caller started it, with the
 * first caller's context: its client, its config's TTLs and its registry.
 * Those are one server's when the servers share a context, as src/index.ts
 * builds them.
 */
export async function loadOnce<T>(
  cache: CacheProvider,
  key: CacheKey,
  load: () => Promise<T>,
): Promise<T> {
  let inFlight = loadsInFlight.get(cache);
  if (inFlight === undefined) {
    inFlight = new Map();
    loadsInFlight.set(cache, inFlight);
  }
  // Each key is one reader's, the key of the entry that reader stores, so
  // every load of one key answers one type (cache-key.ts).
  const pending = inFlight.get(key) as Promise<T> | undefined;
  if (pending !== undefined) {
    return await pending;
  }

  const started = load();
  inFlight.set(key, started);
  // Cleaned up in a `finally` around the await, not with `started.finally(…)`:
  // that returns a second promise which rejects along with `started` and
  // which nothing handles, and an unhandled rejection terminates the process
  // (test/unit/services/topic-resolver-crash.test.ts).
  try {
    return await started;
  } finally {
    inFlight.delete(key);
  }
}
