/**
 * Version deduplication for search results that arrive as `SearchResult`s.
 *
 * The Fluid Topics path collapses version snapshots while they are still
 * clustered-search entries (`dedupeToLatestVersions` in search-service.ts),
 * grouping by `ft:clusterId`. A SearchProvider's results arrive already flat,
 * with no cluster id to read. Core used to collapse them too: #76 (v3.0.6)
 * ran `deduplicateByLatestVersion` over them whenever no version was asked
 * for. #78 (v3.0.7) replaced the scraper that held it and did not carry it
 * over, so from then on a provider returning a Jamf Pro topic once per
 * version produced one result per version, where the same search without a
 * provider produced one. This restores the collapse, over what a
 * `SearchResult` carries, so one question gets one answer whichever backend
 * is configured.
 *
 * It collapses versions and nothing else. Several results for one topic at
 * one version, such as passages of one page or its `#fragment` and `?query`
 * variants, are not versions of it, and come back as the provider returned
 * them. There the Fluid Topics path, which keeps one entry per cluster,
 * differs. Jamf can list one page under several breadcrumbs, with an entry
 * for each at every version; in the queries measured, the ja-JP
 * "クライテリア オペレータ" (Criteria Operators) page, under four. Those four
 * come back as one result from Fluid Topics, and as four from a provider that
 * returns each entry.
 *
 * @module
 */

import type { SearchResult } from '../types.js';
import {
  compareVersions,
  extractVersionFromBundleId,
  stripCurrentSuffix,
  stripVersionSuffix,
} from '../utils/bundle.js';
import { parseUrl } from './topic-resolver.js';

/**
 * The hosts a url is read on. learn.jamf.com is where Fluid Topics serves
 * Jamf's documentation. docs.jamf.com is Jamf's former documentation host:
 * it serves neither url form today (404; its home page sends readers to
 * learn.jamf.com), and is read only because `ALLOWED_HOSTNAMES` accepts it
 * as a Fluid Topics host. A url on any other host is not read.
 */
const FT_HOSTNAMES = new Set(['learn.jamf.com', 'docs.jamf.com']);

/**
 * `/r/{locale}/{bundle}`, the address of a whole publication, which is what a
 * MAP entry (a release-notes volume, say) is found under. The two addresses
 * of a topic are read by topic-resolver's {@link parseUrl}, as the article
 * path reads them.
 */
const PUBLICATION_PATH = /^\/r\/([a-z]{2}-[A-Z]{2})\/([^/]+)$/;

/** `11.32.0`, `2.45`: the shape of every version number Jamf publishes under. */
const VERSION_NUMBER = /^\d+(?:\.\d+)+$/;

/** Which topic a result is, and which version of it. */
export interface VersionedTopic {
  /** Equal for two results exactly when they are versions of one topic. */
  topic: string;
  version: string;
}

/** The locale, bundle and page slug a url names. A publication has no slug. */
interface Address {
  locale: string;
  bundle: string;
  slug: string;
}

/**
 * Read the address a url names, in one of three forms:
 * `/r/{locale}/{bundle}/{slug}` (a topic's reader address),
 * `/{locale}/bundle/{bundle}/page/{slug}.html` (its legacy address, which
 * learn.jamf.com redirects to the reader address) and `/r/{locale}/{bundle}`
 * (a publication). Jamf's `legacy_url` metadata, `/bundle/{bundle}/page/…`
 * with no locale, is not read: one such path is shared by every locale's
 * copy of a topic.
 */
function addressOf(url: URL): Address | null {
  const topic = parseUrl(url.href);
  if (topic?.type === 'legacy') {
    return { locale: topic.locale, bundle: topic.bundleId, slug: topic.pageSlug };
  }
  if (topic?.type === 'pretty') {
    return { locale: topic.locale, bundle: topic.productSlug, slug: topic.topicSlug };
  }
  const [, locale, bundle] = PUBLICATION_PATH.exec(url.pathname) ?? [];
  return locale !== undefined && bundle !== undefined ? { locale, bundle, slug: '' } : null;
}

/**
 * Read the topic and version a result is, or null when either is unknown.
 *
 * The topic is read off the url: host, locale, bundle stem and page slug. The
 * version is the result's `version` when that is a version number, or else
 * the number its url's bundle ends in (`jamf-pro-documentation-11.31.0`).
 * The field wins where both are there, as the Fluid Topics path takes a
 * result's version from its metadata.
 *
 * Jamf's `ft:clusterId` for a topic, which the Fluid Topics path groups by,
 * takes three forms. What the key does with each:
 *
 * - `<stem>-current/<slug>`: Jamf Pro's documentation, release notes and
 *   install guides, where one cluster holds every version of a topic, at a
 *   `-current` url for the newest and a numbered one for the rest. The key
 *   strips either suffix, so every version gets one key, as it gets one
 *   cluster. Jamf's unversioned publications at a `-current` url (the
 *   technical papers, the courses, Jamf Connect's current pages) use this
 *   form too.
 * - `<stem>/<slug>`: the other unversioned publications (Jamf School, Jamf
 *   Protect, the technical articles), at a url with no suffix.
 * - `<stem>-<version>/<slug>`: Jamf Connect's 2.45.0 snapshot, the only
 *   numbered publication Jamf clusters by version. The key strips the number,
 *   so the snapshot gets the key of Connect's current page, but that page has
 *   no version to read and is never merged with it. Should Jamf publish a
 *   second numbered Connect snapshot, though, the two would collapse here
 *   into one result that names the other in `otherVersions`, where Fluid
 *   Topics returns one per snapshot. On 2026-09-26 there was one (2.45.0 in
 *   each locale), so the two paths agree.
 *
 * No unversioned publication carries a version, so none is read (see below),
 * and each of their results passes through. Fluid Topics puts different
 * topics that share one url in one cluster, and so returns one of them (the
 * LAPS paper's "Use LAPS" and "Using LAPS in the Jamf Pro API"); here both
 * stay.
 *
 * A few topics carry a source path as their cluster id instead
 * (`JamfPro/Documentation/Topics/ja-jp_c_Criteria_Operators`). Each such
 * cluster measured with a version to read was one topic by url too.
 *
 * `current` is not a version. It is an alias, and on the Fluid Topics path it
 * is the only suffix a url carries without a `version` beside it. Those are
 * Jamf's unversioned publications: Jamf Connect's current documentation, the
 * technical papers and the courses. Reading `-current` as "the newest
 * version" would merge Connect's current pages with its 2.45.0 ones. Nor is a
 * `version` that is not a number a version. Two ja-JP Jamf Connect topics
 * carry Jamf's template text "Enter the latest product version for which the
 * topic was revised." there.
 *
 * So a result with no version to read is not a version of anything. Nothing
 * is merged into it, and it is never merged away. The same goes for a url in
 * any other shape or on another host.
 *
 * Measured against the live API on 2026-09-26, over the entries of 15 queries
 * in en-US and 15 in ja-JP. Where this reads a result, its topic and Jamf's
 * cluster name each other one to one: 273 topics for 273 clusters over 5,260
 * results in en-US, and 163 for 163 over 2,901 in ja-JP.
 */
export function versionedTopicOf(result: SearchResult): VersionedTopic | null {
  let url: URL;
  try {
    url = new URL(result.url);
  } catch {
    return null;
  }
  if (!FT_HOSTNAMES.has(url.hostname)) { return null; }

  const address = addressOf(url);
  if (address === null) { return null; }

  // A `-current` bundle ends in no number, so its url names no version.
  const version = namedVersion(result.version) ?? extractVersionFromBundleId(address.bundle);
  if (version === null) { return null; }

  const stem = stripVersionSuffix(stripCurrentSuffix(address.bundle));
  return {
    topic: [url.hostname, address.locale, stem, address.slug].join('|'),
    version,
  };
}

/**
 * A `version` value that is a version number. Not the `current` alias, and
 * not whatever else a `version` field was left holding.
 */
function namedVersion(version: string | undefined): string | null {
  return version !== undefined && VERSION_NUMBER.test(version) ? version : null;
}

/** One topic's results while they are being collapsed. */
interface TopicGroup {
  /** Where the topic's first result is. The lead takes that place. */
  first: number;
  /** The first-ranked result at the version kept, and where it is. */
  lead: { index: number; result: SearchResult };
  /** The version kept. */
  version: string;
  /** The versions the topic's results are at. More than one means a collapse. */
  versions: Set<string>;
  /** The versions its results name in `otherVersions`. */
  listed: Set<string>;
}

/**
 * Whether a result at `candidate` becomes the lead over the one at `kept`.
 *
 * The newer version wins, and an equal one does not, so the result ranked
 * first leads. That is the Fluid Topics rule. A requested version wins over
 * any other, newer or ranked higher. The Fluid Topics path sends it upstream
 * as a filter, so every entry it returns is that version and so is every one
 * it keeps. A provider handed the same `version` may not honour it. Without
 * this rule, newest-wins would then throw away the very version that was
 * asked for.
 */
function replaces(candidate: string, kept: string, requested: string | null): boolean {
  if (requested !== null) {
    if (kept === requested) { return false; }
    if (candidate === requested) { return true; }
  }
  return compareVersions(candidate, kept) > 0;
}

/**
 * Collapse the versions of each topic to one, as `dedupeToLatestVersions`
 * does for clustered-search entries.
 *
 * - **The same topic** is what {@link versionedTopicOf} reads. A result it
 *   cannot read is passed through untouched, in its place.
 * - **The version kept** is the newest, or the requested one when the topic
 *   has it. Results at every other version of the topic are dropped.
 * - **Every result at the version kept stays**, untouched and in its place,
 *   except the first-ranked of them, the lead. So a topic at one version only
 *   comes back as the provider returned it, however many results it has.
 * - **The lead** takes the place of the topic's first result, so the
 *   provider's ranking is kept topic by topic. The versions dropped are
 *   listed in its `otherVersions`, newest first, as on the Fluid Topics path,
 *   with any versions the topic's results already listed and never its own.
 *
 * Only the lead of a topic that lost a version is changed, and only its
 * `otherVersions`. Every other result comes back as the same object. So a
 * provider that already returns one version per topic gets its array back
 * unchanged, and running this twice gives what running it once gave.
 *
 * A provider collapsing its own results with this before core does should
 * pass the search's `version`: once the requested version is dropped, a
 * second pass cannot bring it back.
 *
 * @param requestedVersion The search's `version` parameter. Only a specific
 *   version counts, not `current` or an empty string.
 */
export function dedupeResultsToLatestVersions(
  results: readonly SearchResult[],
  requestedVersion?: string,
): SearchResult[] {
  const requested = namedVersion(requestedVersion);
  const groups = new Map<string, TopicGroup>();
  const read: { result: SearchResult; version: string | null; group: TopicGroup | null }[] = [];

  for (const [index, result] of results.entries()) {
    const id = versionedTopicOf(result);
    if (id === null) {
      read.push({ result, version: null, group: null });
      continue;
    }
    let group = groups.get(id.topic);
    if (group === undefined) {
      group = { first: index, lead: { index, result }, version: id.version, versions: new Set(), listed: new Set() };
      groups.set(id.topic, group);
    } else if (replaces(id.version, group.version, requested)) {
      group.lead = { index, result };
      group.version = id.version;
    }
    group.versions.add(id.version);
    for (const version of result.otherVersions ?? []) { group.listed.add(version); }
    read.push({ result, version: id.version, group });
  }

  return read.flatMap(({ result, version, group }, index) => {
    if (group === null || group.versions.size === 1) { return [result]; }
    if (index === group.first) { return [withDropped(group)]; }
    return version === group.version && index !== group.lead.index ? [result] : [];
  });
}

/** The lead of a topic that lost a version, naming what it lost. */
function withDropped(group: TopicGroup): SearchResult {
  const otherVersions = [...new Set([...group.versions, ...group.listed])]
    .filter(version => version !== group.version && version !== '')
    .sort((a, b) => compareVersions(b, a));
  return { ...group.lead.result, otherVersions };
}
