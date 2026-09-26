# Fluid Topics API Reference (learn.jamf.com)

Research findings for the Fluid Topics (FT) platform powering Jamf's documentation site.

## 1. Overview

| Property | Value |
|----------|-------|
| Platform | Fluid Topics 5.3.50 (`ft-called-app-version`, 2026-09-18) |
| Base URL | `https://learn.jamf.com` |
| Auth | None required -- all endpoints below are unauthenticated |
| Old API | `learn-be.jamf.com` -- **decommissioned**, returns HTTP 410 Gone |

All requests use `Content-Type: application/json` unless noted otherwise.

---

## 2. Working Endpoints

### 2.1 Search

#### `POST /api/khub/clustered-search`

Primary search endpoint. Returns results grouped into clusters.

**Request body:**

```json
{
  "query": "FileVault",
  "contentLocale": "en-US",
  "paging": {
    "perPage": 20,
    "page": 1
  },
  "filters": [
    { "key": "jamf:portal", "values": ["Jamf Pro"] },
    { "key": "zoominmetadata", "values": ["content-releasenotes"] }
  ],
  "sortId": "relevance"
}
```

**Sort options:** `"relevance"` | `"last_update"` | `"last_publication"`

**Key filters:**

| Filter key | Values | Purpose |
|------------|--------|---------|
| `jamf:portal` / `jamf:app` / `jamf:utility` | A product's classification value(s), e.g. `Jamf Pro`, `Jamf Connect`, `Title Editor` | Filter by product — one key, whichever the value sits on (see section 3) |
| `ft:publicationId` | Map ids from `/api/khub/maps` | Filter by publication. Used for a product Jamf classifies nothing under (see section 3) |
| `zoominmetadata` | `content-techdocs`, `content-releasenotes`, `content-training`, `content-solutionguide`, `content-glossary`, `content-gettingstarted` | Filter by content type |
| `zoominmetadata` | `product-pro`, `product-connect`, `product-protect`, `product-school`, etc. | Legacy product labels. Still accepted, no longer used by this server |
| `version` | Specific version string (e.g. `"11.13.0"`) | Pin to a version |

**Filter by content type with `content-*`, never with `jamf:contentType`.** The
`jamf:contentType` key is real and is returned on every topic, but its *values*
are translated per locale — the topics that read `Release Notes` under `en-US`
read `版本資訊` under `zh-TW`, `リリースノート` under `ja-JP` and
`Versionshinweise` under `de-DE`. Filtering on the English string matched
topics under `en-US` and **exactly 0** under every other locale — of which
there are ten, not the seven this line claimed before 2026-09-18. The
`content-*` vocabulary under `zoominmetadata` is locale-invariant
(`content-releasenotes` matches in every locale, where the translated value matched only its own).
See `DOC_TYPE_LABEL_MAP` in `src/core/constants/doc-types.ts`.

**Filter objects intersect; values inside one filter union.** Product and
content type share the `zoominmetadata` key, so they must be sent as two
separate objects. Measured 2026-09-18, en-US: `product-protect` alone
1239, `content-releasenotes` alone 1366, two objects 394 (the intersection),
one object holding both values 2211 (the union, exactly 1239 + 1366 - 394).
Merging them widens the search instead of narrowing it.

An earlier version of this line read `content-releasenotes alone 940` while the
paragraph above said 1323 for the same en-US filter. Both cannot have been
en-US at one moment — a zh-TW number was pasted into an en-US measurement — and
nobody could tell, because neither figure carried a date.

**A key Fluid Topics does not know is not rejected.** The request succeeds,
and what comes back depends on how the key is spelled. Most unknown keys are
ignored, and the unfiltered ranking looks like a filter that matched
everything. One with a hyphen in it matches nothing instead, which looks like
a query with no hits. Measured 2026-09-26, en-US: `madeupkey`, `foo_bar`,
`ft:madeUp` and `ft:mapId` each returned the unfiltered count, 3930 for
"policy" and 26,081 for "Jamf Routines", while `made-up-key`, `foo-bar` and
`ft:made-up` returned 0 for both. So a new filter key is checked by comparing
filtered and unfiltered counts, and by checking that every hit carries the
value, never by the absence of an error.

**Do not send `latestVersion=yes`.** See architectural note 4 below.

**Response shape:**

```json
{
  "results": [
    {
      "entries": [
        {
          "type": "TOPIC",
          "topic": { "id": "...", "title": "...", "mapId": "...", ... },
          "map": { "id": "...", "title": "...", ... }
        }
      ]
    }
  ],
  "paging": {
    "totalResultsCount": 142,
    "totalClustersCount": 72,
    "isLastPage": false
  }
}
```

### 2.2 Maps & Content

#### `GET /api/khub/maps`

Returns all publications. Each map represents a product/version/locale combination.
Measured 2026-09-18: 678 maps collapsing to 98 bundle families.

#### `GET /api/khub/maps/{mapId}/toc`

Returns the JSON table-of-contents tree for a publication.

#### `GET /api/khub/maps/{mapId}/topics`

Returns a flat list of all topics in a map with metadata (title, contentId, etc.).

#### `GET /api/khub/maps/{mapId}/topics/{contentId}/content`

Returns the **HTML content** of a specific topic. Always returns `text/html` regardless of the `Accept` header.

#### `GET /api/khub/maps/{mapId}/topics/{contentId}`

Returns topic metadata (title, breadcrumb, associated map info) without the full HTML body.

### 2.3 Configuration

#### `GET /api/configuration/search`

Returns available sort options for search.

#### `GET /api/configuration/metadata`

Returns the filterable metadata descriptors (see section 3). 15 of them as of 2026-09-18 — but the count is a poor health check: it stayed at 15 while 9 of the 15 keys turned over, so re-read the list rather than the number.

#### `GET /api/khub/locales`

Returns the 11 supported locales with article counts per locale.

---

## 3. Metadata Fields Available for Filtering

These are the metadata descriptors returned by `GET /api/configuration/metadata`. Each can be used as a filter key in search requests.

| # | Key | Description |
|---|-----|-------------|
| 1 | `zoominmetadata` | Legacy Zoomin vocabulary: `product-*` and `content-*` values. Still the source for docType filtering (`content-*`); no longer used for product filtering — see rows 4-6. |
| 2 | `jamf:contentType` | Content type. **Descriptive only — do not filter on it**; its values are localised (see the search section above). Use the `content-*` values of `zoominmetadata` instead. |
| 3 | `jamf:product` | Jamf product descriptor. |
| 4 | `jamf:portal` | Platform a publication documents. Multi-valued. |
| 5 | `jamf:app` | Client app a publication documents. Multi-valued. |
| 6 | `jamf:utility` | Utility a publication documents. Single-valued on every live map so far; read as a list all the same. |
| 7 | `jamf:solution` | Solution grouping. |
| 8 | `latestVersion` | Whether the content is from the latest version |
| 9 | `version` | Specific product version string |
| 10 | `revised_modified` | Revision timestamp |
| 11 | `SkillJarLastModification` | Training-platform modification timestamp |
| 12 | `ft:lastEdition` | Last edited date (per topic) |
| 13 | `ft:lastPublication` | Last published date |
| 14 | `ft:lastTechChange` | Last technical change (per bundle, not per topic) |
| 15 | `ft:searchableFrom` | Date the content became searchable |

**Rows 4-6 are what the `product` search filter uses.** Upstream it sends one
of them: the key the product's value sits on, which `MapsRegistry` derives
from the maps (each value sits on exactly one key; sending all three would
intersect to nothing). Client-side it keeps a result when **any** value on
**any** of the three keys is one of the product's values — the same any-value
test Fluid Topics applies — so a document Jamf files under several products is
found under each of them, and shown under the product searched for. The
Security Cloud setup guide carries `jamf:portal = [Jamf Security Cloud, Jamf
Protect]` and `jamf:app = [Jamf Connect]`, and is returned for all three.

Until #334 the client-side filter read one value per result instead — the
first on the most specific key — and rejected most of what the API returned
for `jamf-security-cloud`, `jamf-setup-reset` and `jamf-trust`. Measured
2026-09-26 over 270 product-filtered searches, every topic and map entry
returned carried the filter's value on the filter's key (12,597 of 12,597).

**A product Jamf classifies nothing under is filtered by its publication.**
Today that is `jamf-routines` alone: its one map, and every topic of it, is
filed under `jamf:portal = Jamf Pro`, so no classification value separates it
from Jamf Pro. The other 27 products each have a value some map carries, and
their own publication carries it (checked 2026-09-26 against all 685 maps).
For Jamf Routines the server sends `ft:publicationId` with the ids of every
map of the product's `bundleId` family, read from `/api/khub/maps`, and the
client-side filter keeps a result whose `mapId` is one of them. A
SearchProvider result is also kept when its URL names that family, or when it
reports the product by name.

`ft:publicationId` is not among the descriptors above, but `clustered-search`
filters and facets on it. On a map it is the map's own id (685 of 685 maps),
and on a search entry it is the entry's `mapId` (4,466 of 4,466 entries over
five unfiltered queries). Measured 2026-09-26, en-US, for the query "Jamf
Routines" (26,081 unfiltered), each key filtering on the Routines publication:

| Key | Results | What it matched |
|-----|---------|-----------------|
| `ft:publicationId` | 13 | The map and 12 topics: the publication, and only it |
| `legacy_bundle` | 12 | Topics only; maps do not carry it |
| `bundle` | 1 | The map only; topics do not carry it |
| `ft:clusterId` | 1 | The map only; a topic's is `{bundle}/{topic}` |
| `version_bundle_stem` | 0 | Carried by 311 of 685 maps, and not by this one |
| `ft:mapId` | 26,081 | Ignored |

The upstream filter matters, and a client-side filter alone would not do.
The server fetches one page of 50 clusters, and unfiltered that page is a
window on the whole library. Over twelve queries it held 34 of the 54
entries `ft:publicationId` returned, and none of them for "create", "policy",
"install" or "trigger". The twelve: "Jamf Routines", "routine", "connection",
"create", "delete", "single sign-on", "policy", "scripts", "template",
"install", "trigger", "schedule".

`ft:publicationId` intersects with `zoominmetadata` like any other filter
object (13 for "routine" with `content-techdocs`, 0 with
`content-releasenotes`), and a value that is no map id returns 0, not the
unfiltered set.

---

## 4. Known Product MapIds (en-US latest)

> **Important:** MapIds change when new versions are published. Always use `GET /api/khub/maps` to discover current mapIds dynamically rather than hardcoding these values.

| Product | Example mapId (point-in-time) |
|---------|-------------------------------|
| Jamf Pro | Discover via `/api/khub/maps` filtering by title/metadata |
| Jamf Connect | Discover via `/api/khub/maps` filtering by title/metadata |
| Jamf Protect | Discover via `/api/khub/maps` filtering by title/metadata |
| Jamf School | Discover via `/api/khub/maps` filtering by title/metadata |

To find the current mapId for a product, filter the `/api/khub/maps` response by the product metadata and `latestVersion` flag.

---

## 5. Disabled / Unavailable Endpoints

These endpoints exist in the Fluid Topics platform but are **not enabled** on learn.jamf.com:

| Endpoint | Method | Status | Notes |
|----------|--------|--------|-------|
| `/api/khub/semantic/search` | POST | 404 | Semantic search not enabled |
| `/api/khub/semantic/clustered-search` | POST | 404 | Semantic clustered search not enabled |
| `/api/khub/suggest` | GET | 404 | Autocomplete suggestions not enabled |

---

## 6. Future Capabilities (Available but Unused)

These Fluid Topics features exist in the platform API but are not currently leveraged by this MCP server.

### Rating

```
POST /api/khub/maps/{mapId}/topics/{tocId}/rating
```

Supports rating modes: `STARS`, `LIKE`, `DICHOTOMOUS` (thumbs up/down).

### Feedback

```
POST /api/khub/maps/{mapId}/topics/{tocId}/feedback
```

Free-text feedback submission on topics.

### RAG Chatbot

```
POST /api/ai/rag/chat
```

Server-Sent Events (SSE) streaming response. Currently disabled on learn.jamf.com.

### AI Translation

```
POST /api/ai/translate
```

On-demand AI translation of content. Currently disabled on learn.jamf.com.

### Authenticated Features

The following require user authentication and are not available for anonymous API access:

- **Bookmarks** -- save topics for later
- **Saved Searches** -- persist search queries
- **Collections** -- curated sets of topics

---

## 7. Key Architectural Notes

1. **mapId is locale-specific.** Each language has its own mapId for the same product/version. There is no cross-locale mapId.

2. **Content API always returns `text/html`.** The `/content` endpoint ignores the `Accept` header and always serves HTML.

3. **Search requires POST with JSON body.** It does not support GET with query parameters.

4. **Do NOT use `latestVersion=yes` to deduplicate.** Jamf migrated every
   non-Pro product (School, Connect, Protect, Now, …) to an unversioned
   documentation model that carries no `latestVersion` metadata at all, so the
   filter silently drops them entirely: `product-protect` alone returns 1238
   topics and `product-protect` + `latestVersion=yes` returns **0**. Only Jamf
   Pro survives it (984). This server collapses Jamf Pro's version snapshots
   client-side instead — see `dedupeToLatestVersions` in
   `src/core/services/search-service.ts`.

5. **`bundle` metadata maps to legacy bundleId format.** This provides backward compatibility with URL patterns like `/bundle/{product}-documentation/`.

6. **No rate limiting observed.** The API does not appear to enforce rate limits for anonymous access, but be respectful of server resources.

7. **Pagination is 1-indexed.** The first page is `page: 1`, not `page: 0`.
