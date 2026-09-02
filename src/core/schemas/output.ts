/**
 * Zod output schemas for structured tool output (outputSchema + structuredContent)
 */

import { z } from 'zod';

export const ProductListOutputSchema = z.object({
  products: z.array(z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    currentVersion: z.string(),
    availableVersions: z.array(z.string()),
    hasContent: z.boolean(),
  })),
  topics: z.array(z.object({
    id: z.string(),
    name: z.string(),
    keywords: z.array(z.string()),
  })),
  /**
   * Every bundle family Fluid Topics publishes — the publication axis.
   *
   * Separate from `products` on purpose. `products` is the curated set the
   * `product` search filter accepts; this is the set `jamf_docs_get_toc`'s
   * `publication` parameter accepts, and it is an order of magnitude larger
   * (97 vs 12) because most Jamf documents share a product label with
   * another document rather than having one of their own. Folding them
   * together would turn "which product" into "which document".
   *
   * Optional: it comes from the live maps registry, so a request that cannot
   * reach it still gets the products and topics it asked for.
   */
  publications: z.array(z.object({
    id: z.string(),
    title: z.string(),
    /** Jamf's own classification. Fields absent when Jamf assigns none. */
    portal: z.string().optional(),
    app: z.string().optional(),
    utility: z.string().optional(),
    locales: z.array(z.string()),
    versions: z.array(z.string()),
  })).optional(),
});

export const SearchOutputSchema = z.object({
  query: z.string(),
  /**
   * The filters this result set was produced under, echoed back so a client
   * paging through it can ask for page 2 of the *same* search.
   *
   * Without this the MCP App could only carry the query forward, and page 2 of
   * a filtered search silently returned unfiltered results — `product`,
   * `docType` and `version` go upstream to Fluid Topics and `product`/`topic`
   * are re-applied locally, so dropping them changes the population, not just
   * the ordering.
   */
  filters: z.object({
    product: z.string().optional(),
    topic: z.string().optional(),
    version: z.string().optional(),
    docType: z.string().optional(),
    language: z.string().optional(),
  }).optional(),
  totalResults: z.number(),
  page: z.number(),
  totalPages: z.number(),
  /** Page size, so a client asking for the next page keeps this one's. */
  limit: z.number().optional(),
  hasMore: z.boolean(),
  results: z.array(z.object({
    title: z.string(),
    url: z.string(),
    snippet: z.string(),
    product: z.string(),
    version: z.string().optional(),
    docType: z.string().optional(),
    mapId: z.string().optional(),
    contentId: z.string().optional(),
    breadcrumb: z.array(z.string()).optional(),
    mapTitle: z.string().optional(),
  })),
  suggestions: z.array(z.string()).optional(),
  filterRelaxation: z.object({
    removed: z.array(z.string()),
    original: z.record(z.string(), z.string()),
    message: z.string(),
  }).optional(),
  versionNote: z.string().optional(),
  relevanceNote: z.string().optional(),
  /**
   * Set when `page` was clamped to the last available page.
   *
   * Without it a request for page 99 of a 28-page result set comes back
   * looking exactly like a request for page 28 — same `page`, same `hasMore` —
   * and the client has no way to tell that its request was adjusted.
   */
  paginationNote: z.string().optional(),
  truncatedContent: z.object({
    omittedCount: z.number(),
    omittedItems: z.array(z.object({
      title: z.string(),
      estimatedTokens: z.number(),
    })),
  }).optional(),
});

/** One table-of-contents neighbour: a title to read, a URL to fetch. */
const NavigationLinkSchema = z.object({
  title: z.string(),
  url: z.string(),
});

export const ArticleOutputSchema = z.object({
  title: z.string(),
  url: z.string(),
  /**
   * The body actually sent. Under `outputMode: 'compact'` this is a preview,
   * not the whole article — the markdown half and this half always agree.
   */
  content: z.string(),
  /**
   * Estimated tokens of `content` above, so a caller can tell a compact preview
   * from a full body without re-tokenising it.
   */
  tokenCount: z.number().optional(),
  product: z.string().optional(),
  version: z.string().optional(),
  lastUpdated: z.string().optional(),
  breadcrumb: z.array(z.string()).optional(),
  mapId: z.string().optional(),
  contentId: z.string().optional(),
  /**
   * The three below are `ArticleProvider` signals. They are declared here
   * because a key absent from this schema is a key the tool's structured
   * output cannot promise, whatever the builder emits — and each one is a fact
   * a reader has to act on, not decoration.
   *
   * `versionStatus`: whether this copy is from the release upstream still
   * flags as current, so a client can say "this page describes an older
   * release" instead of quoting it as though it were current.
   */
  versionStatus: z.enum(['latest', 'superseded']).optional(),
  /**
   * The language of `content`. Distinct from the requested locale and from the
   * locale in `url`: Jamf serves English when it has no translation, and both
   * of those keep saying the language that was asked for.
   */
  contentLocale: z.string().optional(),
  /**
   * Where this page sits in its product's table of contents.
   *
   * `siblingCount`/`childCount` are the totals, not the array lengths — the
   * arrays are capped by the provider, and a truncated list that does not say
   * so is one a reader will treat as exhaustive.
   */
  navigation: z.object({
    self: NavigationLinkSchema,
    parent: NavigationLinkSchema.optional(),
    siblings: z.array(NavigationLinkSchema),
    children: z.array(NavigationLinkSchema),
    siblingCount: z.number(),
    childCount: z.number(),
  }).optional(),
  sections: z.array(z.object({
    id: z.string(),
    title: z.string(),
    level: z.number(),
    tokenCount: z.number(),
  })),
  truncated: z.boolean(),
});

/**
 * The keys `jamf_docs_get_article` may publish on the structured channel.
 *
 * `buildArticleStructuredContent` checks its own output against this, so that
 * emitting a key this schema does not declare fails the build rather than
 * failing output validation at runtime in front of a client.
 */
export type ArticleStructuredOutput = z.infer<typeof ArticleOutputSchema>;

export const GlossaryLookupOutputSchema = z.object({
  term: z.string(),
  totalMatches: z.number(),
  entries: z.array(z.object({
    term: z.string(),
    definition: z.string(),
    product: z.string().optional(),
    url: z.string(),
  })),
  truncated: z.boolean(),
});

export const BatchArticlesOutputSchema = z.object({
  results: z.array(z.object({
    url: z.string(),
    status: z.enum(['success', 'error']),
    title: z.string().optional(),
    content: z.string().optional(),
    error: z.string().optional(),
    tokenCount: z.number().optional(),
    truncated: z.boolean().optional(),
  })),
  summary: z.object({
    total: z.number(),
    succeeded: z.number(),
    failed: z.number(),
  }),
});

export const TocOutputSchema = z.object({
  /** Display name, for rendering. */
  product: z.string(),
  /**
   * The product *ID* the entries were fetched under.
   *
   * `product` above is the human-readable name ("Jamf Pro"), which the
   * `jamf_docs_get_toc` `product` parameter does not accept — it is an enum of
   * IDs ("jamf-pro"). A client paging through a table of contents needs the ID
   * to ask for page 2, so it is carried explicitly rather than inferred.
   *
   * Optional since 5.1: a TOC can also be addressed by `publication`, and a
   * response to that request reports {@link publicationId} instead. Exactly
   * one of the two is always present — echoing the id back under the same
   * name the request used is what lets a client resend it without having to
   * test it against the product enum first.
   */
  productId: z.string().optional(),

  /**
   * The bundle family id the entries were fetched under, when the request
   * addressed the publication axis rather than the product one.
   */
  publicationId: z.string().optional(),
  version: z.string(),
  /**
   * The Fluid Topics map these entries came from.
   *
   * `jamf_docs_get_article` accepts `mapId` + `contentId` and its description
   * points callers at "search results or TOC" for them. The map id is one per
   * response, the content id one per entry, so the pair is only assemblable if
   * both are emitted — this is the half that lives up here.
   *
   * Optional: a cached TOC re-resolves it best-effort, and a `TocProvider`
   * serving from its own store may not know it.
   */
  mapId: z.string().optional(),
  totalEntries: z.number(),
  page: z.number(),
  totalPages: z.number(),
  hasMore: z.boolean(),
  entries: z.array(z.object({
    title: z.string(),
    url: z.string(),
    contentId: z.string().optional(),
    /**
     * Nesting level of this entry, 0 for a top-level one.
     *
     * `entries` is the tree flattened in document order, so this is the only
     * thing that says where an entry sits in it. Without it a client reading
     * `structuredContent` got the table of contents as an unordered list of
     * titles — the markdown channel's indentation is not a substitute, since a
     * host that renders the structured output never sees it.
     *
     * Required, not optional: it is derived while flattening rather than read
     * off the entry, so it exists for every entry of every page, and a client
     * reconstructing the tree must not have to handle its absence.
     */
    depth: z.number().int().nonnegative(),
  })),
  /**
   * Set when a specific `version` was requested; the upstream API only serves
   * current-version content. Rendered by `jamf_docs_get_toc` since before this
   * schema existed — declaring it keeps the structured channel honest about
   * what the tool actually emits.
   */
  versionNote: z.string().optional(),
  /** Set when `page` was clamped to the last available page. */
  paginationNote: z.string().optional(),
});
