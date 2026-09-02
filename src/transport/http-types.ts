/**
 * Shared types and constants for the HTTP transport layer.
 */

import type { PerRequestResponseMode } from '@modelcontextprotocol/server';
import type { Logger } from '../core/services/interfaces/index.js';
import { JAMF_PRODUCTS, SUPPORTED_LOCALE_IDS } from '../core/constants.js';

export type { Logger, PerRequestResponseMode };

// ============================================================================
// Configuration
// ============================================================================

export interface HttpHandlerConfig {
  serverVersion: string;
  corsAllowedOrigins: string[];
  trustProxy: boolean;
  rateLimitRpm: number;
  maxBodySize: number;
  /**
   * How responses are shaped.
   *
   * - `'auto'` (default) — a single JSON body, upgrading to an SSE stream only
   *   when a handler emits something before its result. In practice that means
   *   progress notifications reach the client instead of being discarded.
   * - `'sse'` — always stream.
   * - `'json'` — never stream, which silently drops mid-call notifications.
   *   Choose it when a response cache in front of this handler stores a single
   *   JSON body.
   */
  responseMode: PerRequestResponseMode;
  shutdownTimeoutMs: number;
}

/** Platform-specific IP extraction -- Node reads socket, Workers reads CF header */
export type ClientIpExtractor = (request: Request) => string;

export const DEFAULT_HTTP_CONFIG: HttpHandlerConfig = {
  serverVersion: '3.0.6',
  corsAllowedOrigins: [],
  trustProxy: false,
  rateLimitRpm: 60,
  maxBodySize: 1_048_576,
  responseMode: 'auto',
  shutdownTimeoutMs: 10_000,
};

// ============================================================================
// Static content
// ============================================================================

/**
 * Derived from JAMF_PRODUCTS rather than hand-written. The list this replaces
 * named 8 products while the server served 12 — Jamf Trust, Jamf Routines,
 * Self Service+ and Jamf App Catalog were all missing, so a client reading
 * llms.txt to decide what to ask about would never ask about them.
 */
const LLMS_PRODUCT_LINES = Object.values(JAMF_PRODUCTS)
  .map(p => `- ${p.name} — ${p.description}`)
  .join('\n');

export const LLMS_TXT = `# Jamf Docs MCP Server

> MCP server providing access to official Jamf documentation from learn.jamf.com

## Products
${LLMS_PRODUCT_LINES}

## Tools
- jamf_docs_list_products: discover available products and versions
- jamf_docs_search: search documentation by keyword with product/topic filters
- jamf_docs_get_article: retrieve full article content in markdown
- jamf_docs_get_toc: browse table of contents for a product
- jamf_docs_glossary_lookup: look up glossary terms with fuzzy matching
- jamf_docs_batch_get_articles: retrieve multiple articles in a single request

## Resources
- jamf://products — product list with metadata and versions
- jamf://topics — topic categories per product
- jamf://products/{productId}/toc — table of contents for a specific product
- jamf://products/{productId}/versions — available documentation versions

## Prompts
- jamf_troubleshoot: guided troubleshooting workflow
- jamf_setup_guide: step-by-step setup instructions
- jamf_compare_versions: compare features across versions

## Supported Locales
${SUPPORTED_LOCALE_IDS.join(', ')}

## Limitations
- Documentation content only — no Jamf REST API reference
- Content is sourced from learn.jamf.com and cached; not real-time
`;

// ============================================================================
// Error classes
// ============================================================================

export class PayloadTooLargeError extends Error {
  constructor() {
    super('Payload too large');
    this.name = 'PayloadTooLargeError';
  }
}
