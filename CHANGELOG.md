# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
