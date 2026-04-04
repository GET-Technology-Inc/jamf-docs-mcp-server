# Fluid Topics API Reference (learn.jamf.com)

Research findings for the Fluid Topics (FT) platform powering Jamf's documentation site.

## 1. Overview

| Property | Value |
|----------|-------|
| Platform | Fluid Topics 5.2.58 |
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
    { "key": "zoominmetadata", "values": ["product-pro"] },
    { "key": "latestVersion", "values": ["yes"] }
  ],
  "sortId": "relevance"
}
```

**Sort options:** `"relevance"` | `"last_update"` | `"last_publication"`

**Key filters:**

| Filter key | Values | Purpose |
|------------|--------|---------|
| `zoominmetadata` | `product-pro`, `product-connect`, `product-protect`, `product-school`, etc. | Filter by product |
| `jamf:contentType` | `Technical Documentation`, `Release Notes`, `Glossary` | Filter by content type |
| `latestVersion` | `yes` | Deduplicate cross-version results |
| `version` | Specific version string (e.g. `"11.13.0"`) | Pin to a version |

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

Returns all publications (~577 maps). Each map represents a product/version/locale combination.

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

Returns all 15 filterable metadata descriptors (see section 3).

#### `GET /api/khub/locales`

Returns the 11 supported locales with article counts per locale.

---

## 3. Metadata Fields Available for Filtering

These are the metadata descriptors returned by `GET /api/configuration/metadata`. Each can be used as a filter key in search requests.

| # | Key | Description |
|---|-----|-------------|
| 1 | `zoominmetadata` | Product identifier (product-pro, product-connect, etc.) |
| 2 | `jamf:contentType` | Content type (Technical Documentation, Release Notes, Glossary) |
| 3 | `latestVersion` | Whether the content is from the latest version |
| 4 | `version` | Specific product version string |
| 5 | `bundle` | Bundle identifier (maps to legacy bundleId format) |
| 6 | `ft:locale` | Content locale |
| 7 | `ft:editorialType` | Editorial type classification |
| 8 | `ft:title` | Publication title |
| 9 | `ft:originId` | Origin system identifier |
| 10 | `ft:lastEdition` | Last edited date |
| 11 | `ft:lastPublication` | Last published date |
| 12 | `ft:creationDate` | Creation date |
| 13 | `ft:sourceType` | Source format type |
| 14 | `ft:mapTitle` | Map/publication title |
| 15 | `ft:topicTitle` | Topic title |

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

4. **Use `latestVersion=yes` to deduplicate.** Without this filter, search returns results from every published version of every product.

5. **`bundle` metadata maps to legacy bundleId format.** This provides backward compatibility with URL patterns like `/bundle/{product}-documentation/`.

6. **No rate limiting observed.** The API does not appear to enforce rate limits for anonymous access, but be respectful of server resources.

7. **Pagination is 1-indexed.** The first page is `page: 1`, not `page: 0`.
