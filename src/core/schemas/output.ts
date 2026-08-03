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
  truncatedContent: z.object({
    omittedCount: z.number(),
    omittedItems: z.array(z.object({
      title: z.string(),
      estimatedTokens: z.number(),
    })),
  }).optional(),
});

export const ArticleOutputSchema = z.object({
  title: z.string(),
  url: z.string(),
  content: z.string(),
  product: z.string().optional(),
  version: z.string().optional(),
  lastUpdated: z.string().optional(),
  breadcrumb: z.array(z.string()).optional(),
  mapId: z.string().optional(),
  contentId: z.string().optional(),
  sections: z.array(z.object({
    id: z.string(),
    title: z.string(),
    level: z.number(),
    tokenCount: z.number(),
  })),
  truncated: z.boolean(),
});

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
   */
  productId: z.string(),
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
  })),
});
