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
  })),
  topics: z.array(z.object({
    id: z.string(),
    name: z.string(),
    keywords: z.array(z.string()),
  })),
});

export const SearchOutputSchema = z.object({
  query: z.string(),
  totalResults: z.number(),
  page: z.number(),
  totalPages: z.number(),
  hasMore: z.boolean(),
  results: z.array(z.object({
    title: z.string(),
    url: z.string(),
    snippet: z.string(),
    product: z.string(),
    version: z.string().optional(),
    docType: z.string().optional(),
  })),
  suggestions: z.array(z.string()).optional(),
});

export const ArticleOutputSchema = z.object({
  title: z.string(),
  url: z.string(),
  content: z.string(),
  product: z.string().optional(),
  version: z.string().optional(),
  lastUpdated: z.string().optional(),
  breadcrumb: z.array(z.string()).optional(),
  sections: z.array(z.object({
    id: z.string(),
    title: z.string(),
    level: z.number(),
    tokenCount: z.number(),
  })),
  truncated: z.boolean(),
});

export const TocOutputSchema = z.object({
  product: z.string(),
  version: z.string(),
  totalEntries: z.number(),
  page: z.number(),
  totalPages: z.number(),
  hasMore: z.boolean(),
  entries: z.array(z.object({
    title: z.string(),
    url: z.string(),
  })),
});
