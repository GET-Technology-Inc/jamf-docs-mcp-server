/**
 * Shared types and constants for the HTTP transport layer.
 */

import type { Logger } from '../core/services/interfaces/index.js';

export type { Logger };

// ============================================================================
// Configuration
// ============================================================================

export interface HttpHandlerConfig {
  serverVersion: string;
  corsAllowedOrigins: string[];
  trustProxy: boolean;
  rateLimitRpm: number;
  maxBodySize: number;
  enableJsonResponse: boolean;
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
  enableJsonResponse: true,
  shutdownTimeoutMs: 10_000,
};

// ============================================================================
// Static content
// ============================================================================

export const LLMS_TXT = `# Jamf Docs MCP Server

> MCP server providing access to official Jamf documentation from learn.jamf.com

## Products
- Jamf Pro — Apple device management for enterprise
- Jamf School — Apple device management for education
- Jamf Connect — identity and access management
- Jamf Protect — endpoint security for Apple
- Jamf Now — simple device management for small businesses
- Jamf Safe Internet — content filtering and web security
- Jamf Insights — analytics and reporting for Apple fleet
- RapidIdentity — identity and access management platform

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
en-US, ja-JP, zh-TW, de-DE, es-ES, fr-FR, nl-NL, th-TH

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
