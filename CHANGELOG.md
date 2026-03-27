## [1.3.0](https://github.com/GET-Technology-Inc/jamf-docs-mcp-server/compare/v1.2.0...v1.3.0) (2026-03-27)

### Features

* migrate to semantic-release for automated versioning ([#51](https://github.com/GET-Technology-Inc/jamf-docs-mcp-server/issues/51)) ([6f3c4a7](https://github.com/GET-Technology-Inc/jamf-docs-mcp-server/commit/6f3c4a7b48ac306f7addbf122939335a2abf2fc4))

### Bug Fixes

* use GitHub App token for semantic-release push ([#52](https://github.com/GET-Technology-Inc/jamf-docs-mcp-server/issues/52)) ([f48a3d5](https://github.com/GET-Technology-Inc/jamf-docs-mcp-server/commit/f48a3d50993c3fa49e7c987f0937cfeebeca62d4))

### Dependencies

* bump @vitest/coverage-v8 from 4.0.18 to 4.1.0 ([#42](https://github.com/GET-Technology-Inc/jamf-docs-mcp-server/issues/42)) ([9493891](https://github.com/GET-Technology-Inc/jamf-docs-mcp-server/commit/9493891579494950e7db421c89df37b5230e0939))
* bump typescript-eslint from 8.56.1 to 8.57.1 ([#40](https://github.com/GET-Technology-Inc/jamf-docs-mcp-server/issues/40)) ([190e7be](https://github.com/GET-Technology-Inc/jamf-docs-mcp-server/commit/190e7be0be33b85d1abc6fc9b7ac07d09b54acc3))

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-03-25

### Added

- **HTTP/SSE Transport**: `--transport http` flag with Streamable HTTP server support
  - `npm run start:http` for HTTP mode, default stdio unchanged
  - CLI argument parsing (`--port`, `--host`, `--transport`)

- **MCP Prompts**: 3 prompt templates for AI-guided workflows
  - `jamf_troubleshoot` — guided troubleshooting with product/keyword input
  - `jamf_setup_guide` — step-by-step product setup guidance
  - `jamf_compare_versions` — version comparison for migration planning

- **Completions**: Auto-complete support for product, topic, and version fields in tool inputs

- **Resource Templates**: Dynamic resources with URI templates
  - `jamf://products/{productId}/toc` — product table of contents
  - `jamf://products/{productId}/versions` — available documentation versions

- **Output Schemas**: Structured output for `get_article` and `get_toc` tools via `structuredContent`

- **Server Instructions**: AI-facing usage guide embedded in server metadata (tool usage order, output modes, token management)

- **Server Icon**: 32x32 PNG base64 data URI in server metadata

- **9 New Products**: Jamf Now, Jamf Safe Internet, Jamf Insights, RapidIdentity, Jamf Trust, Jamf Routines, Self Service+, Jamf App Catalog

- **Doc Type Filter**: New `docType` parameter on search (documentation, release-notes, install-guide, technical-paper, configuration-guide, training)

- **Progress Reporting**: `reportProgress()` on article fetch and TOC operations

### Changed

- **LRU Cache**: Memory cache now bounded with LRU eviction (configurable `CACHE_MAX_ENTRIES`, default 500)
- **SHA-256 Cache Keys**: Replaced MD5 with SHA-256 for cache key hashing
- **Concurrent Metadata Fetch**: `Promise.all` with internal error handling for parallel product metadata loading
- **Cache Entry Validation**: Zod schema validation on disk cache reads
- **Atomic Cache Writes**: Write to `.tmp` then rename to prevent corruption

### Security

- URL hostname allowlist validation — rejects search results from unexpected domains
- Markdown injection prevention (`sanitizeMarkdownText`, `sanitizeMarkdownUrl`)
- Cache directory path traversal protection (rejects `../`, sensitive system paths)
- Bundle ID validation pattern (regex whitelist)
- HTTP header injection prevention (CRLF stripping in env vars)
- Error message sanitization — no internal details leaked to clients
- `stripHtml` iteration cap (max 10) to prevent CPU exhaustion
- CI workflow: `permissions: contents: read` (least privilege)
- `getEnvNumber` min/max bounds validation

### Dependencies

- `@modelcontextprotocol/sdk`: `^1.0.0` → `^1.27.1`
- `axios`: `^1.7.0` → `^1.13.6`
- `eslint`: `10.x` → `9.x` (typescript-eslint 8.x compatibility)

### Tests

- ~30 new test files covering tools, services, schemas, prompts, resources, transport, utils
- E2E test for HTTP transport lifecycle
- Integration tests for server instructions, icons, prompts, completions, resource templates
- Total: 848 tests (29 test files)

## [1.1.0] - 2025-01-29

### Added

- **MCP Resources**: Static reference data accessible without tool calls
  - `jamf://products` - List of products with dynamic version info and available versions
  - `jamf://topics` - Topic categories for filtering searches

- **Dynamic metadata service**: Fetches latest product versions and TOC categories from API
  - Automatic version detection (e.g., Jamf Pro 11.24.0)
  - TOC-based topic discovery from all 4 products
  - 24-hour caching with fallback to static constants

- **Version query support**: Query documentation for specific product versions
  - `jamf_docs_get_toc` now supports `version` parameter
  - Automatic discovery of available versions per product
  - Example: `version: "11.13.0"` for Jamf Pro historical docs

- **Compact output mode**: New `outputMode` parameter for all tools
  - `outputMode: "compact"` returns token-efficient, brief output
  - `outputMode: "full"` (default) returns detailed output
  - Search: Single-line results vs full cards with metadata
  - Article: Minimal metadata vs full breadcrumb and section lists
  - TOC: Flat list vs nested hierarchy with children
  - List Products: Simple ID/name list vs full descriptions

- **Summary-only article retrieval**: New `summaryOnly` parameter for `jamf_docs_get_article`
  - Returns article summary (first paragraph) instead of full content
  - Includes article outline with token estimates per section
  - Shows estimated read time and total token count
  - Token-efficient way to preview articles before fetching full content

- **Search suggestions**: Helpful suggestions when search returns no results
  - Simplified query suggestions (removes stop words)
  - Alternative keywords based on synonym dictionary
  - Relevant topic filter suggestions
  - Tips for improving search results

### Changed

- Refactored `get-toc.ts` to reduce cyclomatic complexity
  - Extracted formatting functions: `renderTocEntry`, `formatTocCompact`, `formatTocFull`

### Tests

- Added `test/unit/search-suggestions.test.ts` (22 tests)
- Added `test/unit/tokenizer-summary.test.ts` (16 tests)
- Added 10 integration tests for new features
- Total: 99 tests (66 unit + 33 integration)

## [1.0.0] - 2025-01-21

### Added

- Initial release of Jamf Docs MCP Server
- **jamf_docs_list_products**: List all available Jamf products and documentation topics
- **jamf_docs_search**: Search across Jamf documentation with product and topic filtering
- **jamf_docs_get_article**: Retrieve full article content with section extraction support
- **jamf_docs_get_toc**: Get table of contents for product documentation
- Support for all major Jamf products:
  - Jamf Pro (Enterprise device management)
  - Jamf School (Education device management)
  - Jamf Connect (Identity and access management)
  - Jamf Protect (Endpoint security)
- 44 topic categories for intelligent search filtering
- Token-aware response management (Context7 style)
- Pagination support for large result sets
- Section extraction from articles
- Dual-layer caching (memory + file-based)
- Environment variable configuration support
- Both Markdown and JSON response formats
- Comprehensive error handling with specific error codes
- Unit and integration tests with Vitest

### Technical Details

- Built with TypeScript and the MCP TypeScript SDK
- Uses Zoomin API backend for documentation search
- HTML to Markdown conversion with Turndown
- Zod schema validation for all inputs
- Rate limiting to prevent API overload
