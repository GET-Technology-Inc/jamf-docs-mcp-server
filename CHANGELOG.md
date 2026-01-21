# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2024-01-21

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

## [Unreleased]

### Planned

- Additional language support
- Offline documentation caching
- Custom search filters
- Documentation version comparison
