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

One exception, since 2026-09-28: `docType: "training"` is searched first by
`jamf:contentType` with Jamf's "Training Content" in every language at once,
because that is the only filter that reaches the Jamf Training Catalog courses
(see the `DOCUMENT` entry below), which carry no `content-*` label. Values
inside one filter union, so the one filter holds in every language. The values
are read from `/api/khub/maps` (`MapsRegistry.contentTypesOf`): those the maps
labelled `content-training` carry and no other map does, six on 2026-09-28.
While the maps list cannot be read, the search uses those six, compiled in as a
stand-in. When the filter finds nothing, the search asks by `content-training`.

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

**A query matches a page with any one of its words**, unless it says
otherwise. Measured 2026-09-28, en-US: `certificate` 2,768,
`certificate xyzzyq qwvzx plokm zzqqa jjjkk` 2,768, `certificate renewal`
3,007 (`renewal` alone 339); each entry's `missingTerms` lists the words it
lacks. What says otherwise: a phrase in straight double quotes, which a page
must have (`"push certificate renewal failed"` 0, and 0 with `certificate`
after it; `"push certificate"` 398, against 462 unquoted), a word with `+`
before it, which a page must have (`certificate +xyzzyq` 0), and a word with
`-` before it, which a page must not have (`certificate -push` 2,188,
`certificate -certificate` 0). A quote that pairs with none is read as no
quote (`"push certificate` 462), and so are the other quotation marks:
`“push certificate renewal failed”` 1,978, the unquoted count, and
`‘push certificate’`, `'push certificate'`, `«push certificate»` and
`＇push certificate＇` 462 each, as are `„Zertifikat erneuern“` and
`Zertifikat erneuern` in de-DE (2,352 each). A hyphen inside or between words
is a space (`wi-fi` and `wi fi` 501 each, `certificate - push` and
`certificate push` 3,010 each); `AND`, `OR` and `NOT` in capitals are dropped
(`certificate AND xyzzyq` and `NOT certificate` 2,768 each).

**A query with the full-width quotation mark ＂ (U+FF02) finds nothing**,
paired or not, whatever its words. Measured 2026-09-28: `＂push certificate＂`
0 (`"push certificate"` 398), `＂push certificate` 0, `push ＂certificate＂
renewal` 0 in en-US; `＂プッシュ証明書＂` 0 (`"プッシュ証明書"` 442,
`プッシュ証明書` 2,449) in ja-JP; and 0 in zh-TW, zh-CN and de-DE. An input
method in full-width mode can type it. So the search sends ＂ and the curly
double quotes (“ ” „ ‟) as a straight double quote, and ‘ ’ as a straight
single one (`straightenQuotes` in `src/core/services/search-suggestions.ts`):
a phrase quoted with them is then searched as a phrase, as the one who typed
it meant. „ is straightened with “ because a German phrase opens with „ and
closes with “; with “ alone straightened, `„Zertifikat erneuern“ „Push“` was
the phrase `" „Push"` (20, against 42 for `"Zertifikat erneuern" "Push"`).
The single quotes change no count (`Apple’s` and `Apple's` 9,811 each).

**Since 2026-09-28 the search sends 「」, 『』 and « » as a straight double
quote too, but in the two cases below, and ＇ as a straight single one.** 「」 are how Japanese and
Chinese quote (『』 inside a quote, or for a title), and « » how French
quotes, and German, either way round. Fluid Topics reads them as no quotes,
so until then a phrase in them was searched as loose words. Measured
2026-09-28, the count and how many of the first 10 results had the phrase,
typed and with the marks straightened:

| query | language | typed | straightened |
|---|---|---|---|
| `「プッシュ証明書」の更新` | ja-JP | 19,979, 6 of 10 | 442, 10 of 10 |
| `「スマートグループ」の作成` | ja-JP | 19,987, 10 of 10 | 1,640, 10 of 10 |
| `上傳「設定描述檔」失敗` | zh-TW | 15,749, 8 of 10 | 3,001, 10 of 10 |
| `傳送「遠端命令」` | zh-TW | 4,740, 8 of 10 | 789, 10 of 10 |
| `Renouvellement du « certificat push »` | fr-FR | 12,983, 6 of 10 | 379, 10 of 10 |
| `créer un « groupe intelligent »` | fr-FR | 16,476, 9 of 10 | 1,007, 10 of 10 |
| `»Zertifikat erneuern«` | de-DE | 2,352, 3 of 10 | 42, 4 of 4 |
| `「プッシュ証明書の更新に失敗しました」` | ja-JP | 20,138, 0 of 10 | 0 |

Jamf's own titles quote a label with these marks, such as
`構成プロファイルの「失敗」のステータスに関するトラブルシューティング`. Each of the
19 such titles that searches for common words in ja-JP, zh-TW and fr-FR
returned, searched as a query with its marks straightened, still had its
page first, among 1 to 2,842 results instead of 6,569 to 20,631. A quoted
word in a query of more is one a page must have: `「FileVault」を有効にする`
had 2 of its first 10 with FileVault in the title, and
`"FileVault"を有効にする` 8; `「原則」 無法執行` in zh-TW 2 with 原則, and
`"原則" 無法執行` 10.

Titles contain their phrase by construction, so they cannot show what a
phrase costs. Of 44 queries quoted as a person would quote a term or a
message (18 in ja-JP, 10 in zh-TW, 4 in zh-CN, 6 in fr-FR, 3 in de-DE, 2 in
es-ES, 1 in it-IT), 12 found nothing with every pair straightened, where as
typed each had results: 5 of the 18 in ja-JP, 1 in zh-TW, the 4 in zh-CN
(whose results as typed were not about the query), 1 in fr-FR and 1 in
it-IT. Among them were terms the documentation writes otherwise
(`「セルフサービス」`, 2,981 as typed; it writes Self Service;
`「プレステージ登録」`, 5,190, led by 登録 and 登録 URL),
messages it does not have word for word
(`「MDMプロファイルのインストールに失敗しました」`, 20,160, led by
`構成プロファイルの「失敗」のステータスに関するトラブルシューティング`), and
`« certificat push expiré »` (2,505, led by "Suppression du certificat
push" and "Certificats push"). So two cases are not left as phrases:

- **A pair around the query's one word is sent as typed**, which Fluid
  Topics reads as no quotes. A phrase of one word is that word in the form
  typed and no other: `"Konfigurationsprofil"` 1,717 in de-DE and
  `Konfigurationsprofil` 7,141, led by "Konfigurationsprofile für Computer",
  which the quoted one's first 10 lack. Of 25 such words in 9 languages, 14
  had fewer results quoted and lost from 1 to 8 of the first 10 (such as
  "Certificats" for `certificat` in fr-FR, 1,844 against 2,087); the other 11
  had the same first 10. Of 9 Chinese and Japanese words Unicode's rules
  find no other word in, such as ポリシー and 原則, each had the same first
  10 either way, 2 with fewer results quoted (ポリシー 2,879 against 2,948).
  A word is as the search reads words (`wordsSearchedFor`), so
  `「リモートコマンド」`, two words to Unicode's rules, stays a phrase; Fluid
  Topics has the same 769 for it either way.
- **When Fluid Topics finds nothing for the query with such a phrase, the
  search asks again with every pair sent as typed** (`looseQueryForFluidTopics`),
  with the filters it ended with: one more request, only then. The reply
  serves what that finds and says so in `queryNote` ("No page has
  「プレステージ登録」 as written, so these results are for the query searched
  without those quotes."), or, when that finds nothing either, says that too
  and suggests no query made only of the words that search had. With both, none of the 44
  finds nothing: 11 were searched again, and `「セルフサービス」` is sent as
  typed.

What is left is a phrase that finds little. 7 of the 44 found fewer than 50
pages as phrases, where as typed they found hundreds or thousands:
`「ユーザーの追加」` 4 (20,034 as typed), `「遠端指令」` 4 (1,919),
`»Smart Group«` 8 (274), `« échec de l'inscription »` 24 (20,194),
`「インベントリ更新」` 43 (4,960), `「管理対象のApple ID」` 43 (20,134) and
`「自助服務」` 46 (3,127). For 2 of them (`「ユーザーの追加」`,
`「インベントリ更新」`) the first 3 as typed were closer to the question, for 1
(`「管理対象のApple ID」`) the phrase's, and for the other 4 neither's. That
is the cost of the choice: the same query without the marks finds what it
found before.

｢｣, the half-width 「」, are straightened with them. The single guillemets
‹ ›, like ‘ ’, quote nothing (`‹certificat push›` has the 2,284 of
`certificat push` in fr-FR), and are sent as typed. ＇ is ' typed in full
width, and is sent as ': it quotes nothing either (`＇push certificate＇`
462), and `Apple＇s` has the 9,811 results of `Apple's` in another order,
where `Apple’s` has them in the same order.

A straight-quoted phrase that finds nothing is suggested its words without
the quotes, however few (`simplifyQuery`): until 2026-09-28 one of three
keywords or fewer was not, and `"certificat push expiré"` in fr-FR, which
finds nothing, was suggested `deploy` alone, while `certificat push expiré`
has 2,505.

**A narrow no-break space (U+202F) in a phrase finds nothing.** Measured
2026-09-28 in fr-FR: `"certificat push"` 379, and 0 with U+202F between its
words or inside its quotes, while it has 379 with the no-break space U+00A0
in either place, and with the thin space U+2009, the figure space U+2007 or
the ideographic space U+3000 inside its quotes. Out of a phrase U+202F is a
space too (`certificat push` 2,284 either way). French typography puts
U+202F or U+00A0 inside « », and Jamf's French titles use U+00A0
(`Correction d’une erreur « Impossible de modifier la clé » dans FileVault`).
So the search sends U+202F as a space (`queryForFluidTopics` in
`src/core/services/search-suggestions.ts`).

Words are split at every character that is not a letter or digit (`11.32.0`
and `11 32 0` 21,744 each; `xyzzyq_pro` has the count of `pro`, and
`Jamf Pro™` the 22,191 of `pro`, while `protm` has 0), and Chinese and Thai
are cut into words as the Unicode rules cut them (`推送證書續約失敗` and
`推送 證書 續約 失敗` 992 each in zh-TW). Each language's analysis then
applies to the words: in de-DE, compounds are taken apart, so the entries
found for `Zertifikat erneuern fehlgeschlagen` (2,986) list `fehl` and
`geschlagen` among their `missingTerms`. Accents are folded (`politica` and
`política` 2,409 each in es-ES), whether typed with the letter or as a
combining mark after it (`política` in NFD 2,409 too). So a query with none
of those parts that finds nothing has none of its words in the documentation
searched, and fewer of them find nothing either, since they are analysed as
the query's are: see `generateSearchSuggestions` in
`src/core/services/search-suggestions.ts`.

**Full-width Latin letters and digits are read as ASCII in few languages.**
Measured 2026-09-28, each of the eleven languages, full width against ASCII:

| language | letters (`ＳＳＯ`, `ＦｉｌｅＶａｕｌｔ`, `Ｊａｍｆ`, `ｉＯＳ`) | digits (`１５`, `１１．３２`) |
|---|---|---|
| ja-JP | read as ASCII: the same count and first 10 (`ＳＳＯ` and `SSO` 712 each) | read as ASCII (`１５` and `15` 1,626 each) |
| zh-TW, zh-CN | read as ASCII (`ＳＳＯ` and `SSO` 698 each in zh-TW) | not (`１５` 0, `15` 1,599 in zh-TW) |
| en-US, de-DE, es-ES, fr-FR, nl-NL, th-TH, it-IT, pt-BR | not: each 0, and in each language some had results in ASCII (`ＳＳＯ` 0, `SSO` 1,228 in en-US) | not (`１５` 0, `15` 1,934 in en-US) |

An input method in full-width mode types them. So since 2026-09-28 the search
sends a query's full-width letters and digits (U+FF10–FF19, U+FF21–FF3A,
U+FF41–FF5A) in ASCII, in every language (`queryForFluidTopics`). Where Fluid
Topics reads them as ASCII already, that changes no result: 12 queries in
ja-JP, among them `ＭＤＭ登録` and `Ｊａｍｆ Ｐｒｏの設定`, and 9 of letters
alone in zh-TW and zh-CN, had the same count and the same first 10 either
way. Full-width punctuation is sent as typed: Fluid Topics reads it as a
space, where its ASCII form can be an operator (`certificate －push` 3,010,
the count of `certificate push`; `certificate -push` 2,188), and `．` changes
only the order (`11．32` and `11.32` 16,330 each in zh-TW). The ligature ﬁ is
read as fi (`Configuration Profile` with it 11,602, as without); the
mathematical letters such as 𝐒 are not (`𝐒𝐒𝐎` 0), and are sent as typed.
The glossary lookup matches a term, and the other sites' titles are matched
against a query, with the same letters and digits in ASCII
(`foldFullWidthLatin` in `src/core/utils/cjk.ts`): the glossary had no
entry for `ＭＤＭ` and 2 for `MDM`, and `ｊａｍｆｏｒｍｅｒ` matched no
concepts.jamf.com title.

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

An entry is a `TOPIC` (`topic`), a `MAP` (`map`) or a `DOCUMENT` (`document`).
A `DOCUMENT` is in no map. Every one measured is a course or learning path of
the Jamf Training Catalog, crawled from Skilljar: 67 in 127 searches on
2026-09-28, in en-US, ja-JP and zh-TW, each a cluster of its own. It carries
`documentId`, `title`, `htmlExcerpt`, `openMode: "EXTERNAL"`, the course as
`originUrl` (on trainingcatalog.jamf.com) and a `viewerUrl` on learn.jamf.com,
and in its metadata Jamf's classification (`jamf:portal`, `jamf:app`) and a
`jamf:contentType` of "Training Content" (in the language searched), but no
`version` and no `content-*` label. So a `zoominmetadata` filter leaves it out
(none came back in five `content-training` searches), and a `version` filter
does too. Filtered on `jamf:contentType` = "Training Content" instead, the
same five searches returned the `content-training` topics in the same order,
and the courses ranked among them. The search returns a `DOCUMENT` as a result
marked `external`, which `jamf_docs_get_article` cannot read, and whose
`docType` is `training`.

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
| 2 | `jamf:contentType` | Content type. **Do not filter on one of its values**; they are localised (see the search section above). Use the `content-*` values of `zoominmetadata` instead. The one exception is training, sent in every language at once (see the same section). |
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
