## [3.0.1](https://github.com/GET-Technology-Inc/jamf-docs-mcp-server/compare/v3.0.0...v3.0.1) (2026-03-31)

### Bug Fixes

* prevent sanitizeErrorMessage from mangling URLs into https:<path> ([c858128](https://github.com/GET-Technology-Inc/jamf-docs-mcp-server/commit/c8581288a453f50f41b215789d97a1151c321770))

## [3.0.0](https://github.com/GET-Technology-Inc/jamf-docs-mcp-server/compare/v2.0.0...v3.0.0) (2026-03-30)

### ⚠ BREAKING CHANGES

* Tool registration and service function signatures now
require a ServerContext parameter for dependency injection.

Core changes:
- Define platform interfaces: CacheProvider, MetadataStore, LoggerFactory
- Add ServerContext DI container and createMcpServer() factory function
- Replace axios with native fetch (httpGetText/httpGetJson/HttpError)
- Remove all process.env access from core — moved to platforms/node
- Add package.json exports for ./core and ./platforms/node sub-paths
- Add TypeScript declarations for all export paths

Platform Node.js:
- FileCache implements CacheProvider (fs/path/crypto)
- NodeMetadataStore implements MetadataStore
- NodeLoggerFactory implements LoggerFactory (stderr + MCP notifications)
- createNodeConfig() reads process.env with validation

Dependencies:
- Remove axios (replaced by global fetch)
- Update @modelcontextprotocol/sdk to 1.28.0
- Set engines.node >= 18.11

The public API (bin entry, MCP tools, resources, prompts) is unchanged.
All 1116 tests pass across unit, integration, and E2E suites.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>

* fix: resolve search product filter regression, list_products gap, and dedup residuals

- list_products: stop filtering out products with unavailable TOC — all 12
  products now always appear, with hasContent marking availability status
- search: send product searchLabel as API `label` param to Zoomin so
  server-side filtering works for jamf-routines, jamf-trust, etc.
- dedup: add title-based fallback key in deduplicateByLatestVersion() to
  catch cross-version duplicates when page slugs differ but titles match

Verified via E2E: jamf-routines search returns 5 Routines articles (no
relaxation), jamf-trust returns 5 Trust articles, FileVault shows 0
cross-version duplicates.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>

* feat: add provider injection interfaces and selective tool registration

Add optional data-source provider interfaces (SearchProvider, ArticleProvider,
GlossaryProvider, TocProvider) to ServerContext, enabling external projects to
inject custom backends (e.g., Vectorize, R2, D1) without modifying core code.
Each provider uses null-fallthrough pattern — return null to use default impl.

Also add CreateServerOptions with tools whitelist to createMcpServer(), allowing
selective tool registration. Refactor interfaces.ts into interfaces/ directory
with domain-specific files (cache, metadata, logger, providers).

Remove 2 stale integration tests for jamf-routines (now has content upstream).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>

* fix: use explicit undefined check to satisfy strict-boolean-expressions lint

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>

### Features

* provider injection interfaces & selective tool registration ([#61](https://github.com/GET-Technology-Inc/jamf-docs-mcp-server/issues/61)) ([db01a30](https://github.com/GET-Technology-Inc/jamf-docs-mcp-server/commit/db01a30eed38752afad0ea305b24b7555c5859ec))

## [2.0.0](https://github.com/GET-Technology-Inc/jamf-docs-mcp-server/compare/v1.5.1...v2.0.0) (2026-03-30)

### ⚠ BREAKING CHANGES

* Tool registration and service function signatures now
require a ServerContext parameter for dependency injection.

Core changes:
- Define platform interfaces: CacheProvider, MetadataStore, LoggerFactory
- Add ServerContext DI container and createMcpServer() factory function
- Replace axios with native fetch (httpGetText/httpGetJson/HttpError)
- Remove all process.env access from core — moved to platforms/node
- Add package.json exports for ./core and ./platforms/node sub-paths
- Add TypeScript declarations for all export paths

Platform Node.js:
- FileCache implements CacheProvider (fs/path/crypto)
- NodeMetadataStore implements MetadataStore
- NodeLoggerFactory implements LoggerFactory (stderr + MCP notifications)
- createNodeConfig() reads process.env with validation

Dependencies:
- Remove axios (replaced by global fetch)
- Update @modelcontextprotocol/sdk to 1.28.0
- Set engines.node >= 18.11

The public API (bin entry, MCP tools, resources, prompts) is unchanged.
All 1116 tests pass across unit, integration, and E2E suites.

Co-authored-by: Claude Opus 4.6 (1M context) <noreply@anthropic.com>

### Refactoring

* decouple core from Node.js for multi-platform support ([#60](https://github.com/GET-Technology-Inc/jamf-docs-mcp-server/issues/60)) ([61f2c3a](https://github.com/GET-Technology-Inc/jamf-docs-mcp-server/commit/61f2c3af1f24a646b22f92a09396b26acbdb89c3))

## [1.5.1](https://github.com/GET-Technology-Inc/jamf-docs-mcp-server/compare/v1.5.0...v1.5.1) (2026-03-30)

### Bug Fixes

* resolve 5 verified issues with section IDs, search dedup, pagination, related URLs, and locale handling ([819ec0f](https://github.com/GET-Technology-Inc/jamf-docs-mcp-server/commit/819ec0f83df97e03c850dd851de3a3180c9ceda7)), closes [#section](https://github.com/GET-Technology-Inc/jamf-docs-mcp-server/issues/section)

## [1.5.0](https://github.com/GET-Technology-Inc/jamf-docs-mcp-server/compare/v1.4.1...v1.5.0) (2026-03-29)

### Features

* MCP server enhancements — logging, llms.txt, glossary, batch articles, progress notifications ([#58](https://github.com/GET-Technology-Inc/jamf-docs-mcp-server/issues/58)) ([88d59c6](https://github.com/GET-Technology-Inc/jamf-docs-mcp-server/commit/88d59c681d7f15b39defd615ddd8883134958a7d))

## [1.4.1](https://github.com/GET-Technology-Inc/jamf-docs-mcp-server/compare/v1.4.0...v1.4.1) (2026-03-29)

### Refactoring

* extract product slug utility, TOC search fallback, and cleanup ([#56](https://github.com/GET-Technology-Inc/jamf-docs-mcp-server/issues/56)) ([f434077](https://github.com/GET-Technology-Inc/jamf-docs-mcp-server/commit/f43407778d0c7c257de22d51f29c601a6c79b0a0))

## [1.4.0](https://github.com/GET-Technology-Inc/jamf-docs-mcp-server/compare/v1.3.1...v1.4.0) (2026-03-29)

### Features

* add multi-locale support and security hardening ([#55](https://github.com/GET-Technology-Inc/jamf-docs-mcp-server/issues/55)) ([ba76f50](https://github.com/GET-Technology-Inc/jamf-docs-mcp-server/commit/ba76f507e6b89770d6a63e05f792e5aeeb096328))

## [1.3.1](https://github.com/GET-Technology-Inc/jamf-docs-mcp-server/compare/v1.3.0...v1.3.1) (2026-03-29)

### Dependencies

* bump path-to-regexp from 8.3.0 to 8.4.0 ([#53](https://github.com/GET-Technology-Inc/jamf-docs-mcp-server/issues/53)) ([b1a348c](https://github.com/GET-Technology-Inc/jamf-docs-mcp-server/commit/b1a348c9f53662c4237b4be07388cf995db2aa2d))

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
