# Jamf Docs MCP Server

[![CI](https://github.com/GET-Technology-Inc/jamf-docs-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/GET-Technology-Inc/jamf-docs-mcp-server/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@get-technology-inc/jamf-docs-mcp-server.svg)](https://www.npmjs.com/package/@get-technology-inc/jamf-docs-mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

An MCP server that gives AI assistants (Claude, Cursor, etc.) direct access to Jamf official documentation. Ask Jamf-related questions and get answers based on the latest docs from learn.jamf.com.

**Supported Products**: Jamf Pro, Jamf School, Jamf Connect, Jamf Protect, Jamf Now, Jamf Safe Internet, Jamf Insights, RapidIdentity, Jamf Trust, Jamf Routines, Self Service+, Jamf App Catalog

[中文文件](docs/README.zh-TW.md)

## Quick Start

### Claude Desktop

Edit `claude_desktop_config.json`:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "jamf-docs": {
      "command": "npx",
      "args": ["-y", "@get-technology-inc/jamf-docs-mcp-server"]
    }
  }
}
```

Restart Claude Desktop to apply.

### Claude Code (CLI)

```bash
claude mcp add jamf-docs -- npx -y @get-technology-inc/jamf-docs-mcp-server
```

### Cursor

Edit `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "jamf-docs": {
      "command": "npx",
      "args": ["-y", "@get-technology-inc/jamf-docs-mcp-server"]
    }
  }
}
```

### Verify Installation

Test with MCP Inspector:

```bash
npx @modelcontextprotocol/inspector npx -y @get-technology-inc/jamf-docs-mcp-server
```

## Usage Examples

Once configured, just ask your AI assistant:

- "How do I configure SSO in Jamf Pro?"
- "What are the system requirements for Jamf Protect?"
- "Explain the MDM enrollment process"
- "What changed in the latest Jamf Connect release notes?"

## Available Tools

| Tool | Description |
|------|-------------|
| `jamf_docs_list_products` | List all supported products, topics, and document type filters |
| `jamf_docs_search` | Search documentation by keyword with filtering and pagination |
| `jamf_docs_get_article` | Retrieve full content of a specific documentation article |
| `jamf_docs_get_toc` | Browse the table of contents for a product |
| `jamf_docs_batch_get_articles` | Fetch multiple articles in one call (up to 10 URLs) |
| `jamf_docs_glossary_lookup` | Look up Jamf terminology and definitions (fuzzy matching) |

### jamf_docs_list_products

Returns all available Jamf products and their IDs, available topic filters, and document type filters.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `language` | string | `en-US` | Documentation language/locale |
| `outputMode` | `"full"` \| `"compact"` | `"full"` | Detail level of the response |
| `responseFormat` | `"markdown"` \| `"json"` | `"markdown"` | Output format |
| `maxTokens` | number (100–20000) | `5000` | Maximum tokens in response |

### jamf_docs_search

Searches across all Jamf product documentation.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | string (2–200 chars) | required | Search keywords |
| `product` | string | — | Filter by product ID (e.g., `jamf-pro`) |
| `topic` | string | — | Filter by topic category (e.g., `enrollment`, `security`) |
| `docType` | string | — | Filter by document type: `documentation`, `release-notes`, `install-guide`, `technical-paper`, `configuration-guide`, `training` |
| `version` | string | — | Filter by version (e.g., `"11.5.0"`) |
| `language` | string | `en-US` | Documentation language/locale |
| `limit` | number (1–50) | `10` | Results per page |
| `page` | number (1–100) | `1` | Page number for pagination |
| `maxTokens` | number (100–20000) | `5000` | Maximum tokens in response |
| `outputMode` | `"full"` \| `"compact"` | `"full"` | Detail level; use `"compact"` for token-efficient output |
| `responseFormat` | `"markdown"` \| `"json"` | `"markdown"` | Output format |

### jamf_docs_get_article

Fetches and converts a documentation article to clean markdown or JSON.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `url` | string | required | Full URL from `docs.jamf.com` or `learn.jamf.com` |
| `section` | string | — | Extract only a named section (e.g., `"Prerequisites"`) |
| `summaryOnly` | boolean | `false` | Return only article outline — token-efficient way to preview before fetching full content |
| `includeRelated` | boolean | `false` | Include links to related articles |
| `language` | string | `en-US` | Documentation language/locale |
| `maxTokens` | number (100–20000) | `5000` | Maximum tokens in response |
| `outputMode` | `"full"` \| `"compact"` | `"full"` | Detail level; `"compact"` shows a ~500-token preview with available sections list |
| `responseFormat` | `"markdown"` \| `"json"` | `"markdown"` | Output format |

When content exceeds `maxTokens`, the tool truncates the response and lists all available sections with their token counts. Use the `section` parameter on a follow-up call to retrieve a specific part.

### jamf_docs_get_toc

Retrieves the navigation structure (table of contents) for a product.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `product` | string | required | Product ID (see supported products below) |
| `version` | string | latest | Specific version to fetch |
| `language` | string | `en-US` | Documentation language/locale |
| `page` | number (1–100) | `1` | Page number for paginated TOC |
| `maxTokens` | number (100–20000) | `5000` | Maximum tokens in response |
| `outputMode` | `"full"` \| `"compact"` | `"full"` | Use `"compact"` for a flat list without nested children |
| `responseFormat` | `"markdown"` \| `"json"` | `"markdown"` | Output format |

### jamf_docs_batch_get_articles

Fetches multiple documentation articles in a single call. Each URL is fetched concurrently, and invalid domains are reported as per-article errors without failing the entire batch.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `urls` | string[] (1–10) | required | Array of Jamf documentation URLs |
| `concurrency` | number (1–5) | `3` | Maximum parallel requests |
| `language` | string | `en-US` | Documentation language/locale |
| `maxTokens` | number (100–20000) | `5000` | Total token budget across all articles |
| `outputMode` | `"full"` \| `"compact"` | `"full"` | Detail level per article |
| `responseFormat` | `"markdown"` \| `"json"` | `"markdown"` | Output format |

### jamf_docs_glossary_lookup

Looks up a term in the Jamf official glossary and returns matching definitions using fuzzy matching. Glossary content is currently English-only; non-English `language` values are accepted but results will be in English.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `term` | string (2–100 chars) | required | Glossary term to look up |
| `product` | string | — | Filter by product ID |
| `language` | string | `en-US` | Documentation language/locale (glossary is English-only) |
| `maxTokens` | number (100–50000) | `5000` | Maximum tokens in response |
| `outputMode` | `"full"` \| `"compact"` | `"full"` | Detail level |
| `responseFormat` | `"markdown"` \| `"json"` | `"markdown"` | Output format |

## MCP Resources

Static and dynamic reference data accessible without tool calls:

| Resource | URI | Description |
|----------|-----|-------------|
| Products list | `jamf://products` | All available Jamf products with IDs and version info (fetched dynamically from API) |
| Topics list | `jamf://topics` | Topic categories for filtering documentation searches |
| Product TOC | `jamf://products/{productId}/toc` | Table of contents for a specific product (template resource) |
| Product versions | `jamf://products/{productId}/versions` | Available documentation versions for a specific product (template resource) |

Template resources support tab-completion on `productId` in compatible clients.

## MCP Prompts

Pre-built prompt workflows that guide the AI through multi-step documentation tasks:

### `jamf_troubleshoot`

Guides the AI through a structured troubleshooting workflow: searching for relevant documentation, previewing articles with `summaryOnly`, then providing a root-cause diagnosis and step-by-step resolution.

| Argument | Type | Description |
|----------|------|-------------|
| `problem` | string (required) | Description of the issue to troubleshoot |
| `product` | string (optional) | Jamf product ID to scope the search |

### `jamf_setup_guide`

Directs the AI to generate a step-by-step setup guide for a Jamf feature, including prerequisites, configuration steps, and verification.

| Argument | Type | Description |
|----------|------|-------------|
| `feature` | string (required) | The feature or capability to set up |
| `product` | string (optional) | Jamf product ID to scope the search |

### `jamf_compare_versions`

Instructs the AI to compare table-of-contents structures and key articles between two product versions, summarizing new features, removed capabilities, and migration considerations.

| Argument | Type | Description |
|----------|------|-------------|
| `product` | string (required) | Jamf product ID |
| `version_a` | string (required) | First version to compare (e.g., `"11.5.0"`) |
| `version_b` | string (required) | Second version to compare (e.g., `"11.12.0"`) |

## Supported Products

| Product ID | Name | Description |
|------------|------|-------------|
| `jamf-pro` | Jamf Pro | Apple device management for enterprise |
| `jamf-school` | Jamf School | Apple device management for education |
| `jamf-connect` | Jamf Connect | Identity and access management |
| `jamf-protect` | Jamf Protect | Endpoint security for Apple |
| `jamf-now` | Jamf Now | Simple Apple device management for small businesses |
| `jamf-safe-internet` | Jamf Safe Internet | Content filtering and web security for education and business |
| `jamf-insights` | Jamf Insights | Analytics and reporting platform for Apple fleet |
| `jamf-rapididentity` | RapidIdentity | Identity and access management platform |
| `jamf-trust` | Jamf Trust | Zero-trust network access for Apple devices |
| `jamf-routines` | Jamf Routines | Automated workflow orchestration for device management |
| `self-service-plus` | Self Service+ | Next-generation self-service portal for macOS |
| `jamf-app-catalog` | Jamf App Catalog | Curated application catalog for managed deployments |

## Key Features

- **Compact Mode**: Use `outputMode: "compact"` for token-efficient responses; articles show a ~500-token preview with an available sections list
- **Summary Only**: Use `summaryOnly: true` on `jamf_docs_get_article` to preview an article outline before fetching full content
- **Section Extraction**: Use `section: "Prerequisites"` to retrieve only the part of an article you need
- **Batch Fetching**: Use `jamf_docs_batch_get_articles` to fetch up to 10 articles in one call with concurrent requests
- **Glossary Lookup**: Use `jamf_docs_glossary_lookup` to look up Jamf terminology with fuzzy matching
- **Multi-language**: All tools accept a `language` parameter for localized documentation (e.g., `ja-JP`, `de-DE`)
- **Document Type Filter**: Use `docType` on `jamf_docs_search` to narrow results to `release-notes`, `install-guide`, `technical-paper`, `configuration-guide`, or `training`
- **Version Query**: Use the `version` parameter to query documentation for a specific product version
- **Pagination**: Search results support `page` and `limit`; table of contents supports `page`; product lists are not paginated
- **Search Suggestions**: Receive helpful suggestions when a search returns no results
- **Token Management**: All tools accept a `maxTokens` parameter (100–20000, default 5000) to control response size

## HTTP/SSE Transport Mode

In addition to the default `stdio` transport, the server supports an HTTP transport for use as a remote or shared MCP endpoint.

### Starting the HTTP Server

```bash
# Using the npm script (defaults: localhost:3000)
npm run start:http

# Using the built binary directly with custom options
node dist/index.js --transport http --port 8080 --host 127.0.0.1
```

### CLI Arguments

| Argument | Default | Description |
|----------|---------|-------------|
| `--transport` | `stdio` | Transport mode: `stdio` or `http` |
| `--port` | `3000` | Port to listen on (1–65535) |
| `--host` | `127.0.0.1` | Host to bind to |

> **Security note**: The default host `127.0.0.1` restricts access to localhost only. Binding to `0.0.0.0` exposes the server to the network; only do this in controlled environments.

### HTTP Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/mcp` | `POST` | MCP JSON-RPC endpoint (streamable HTTP transport) |
| `/health` | `GET` | Health check — returns `{"status":"ok","version":"<current>"}` |

### Connecting an MCP Client via HTTP

Claude Desktop or other MCP clients that support HTTP transport can connect with:

```json
{
  "mcpServers": {
    "jamf-docs": {
      "url": "http://127.0.0.1:3000/mcp"
    }
  }
}
```

### CORS Configuration

By default the server does not set CORS headers (cross-origin requests are blocked). To allow specific origins, set the `CORS_ALLOWED_ORIGINS` environment variable:

```bash
CORS_ALLOWED_ORIGINS=https://myapp.example.com node dist/index.js --transport http
```

Multiple origins are separated by commas.

### Rate Limiting

The HTTP server applies per-IP token-bucket rate limiting. The default is 60 requests per minute. Override with the `RATE_LIMIT_RPM` environment variable.

## Configuration

All settings are optional. Set them as environment variables before launching the server.

### Cache Settings

| Variable | Default | Range | Description |
|----------|---------|-------|-------------|
| `CACHE_DIR` | `.cache` | — | Cache directory (relative paths must stay within the project; sensitive system paths are rejected) |
| `CACHE_TTL_SEARCH` | `1800000` (30 min) | 1 min–30 days | TTL for search result cache entries |
| `CACHE_TTL_ARTICLE` | `86400000` (24 hr) | 1 min–30 days | TTL for article content cache entries |
| `CACHE_TTL_PRODUCTS` | `604800000` (7 days) | 1 min–30 days | TTL for product list cache entries |
| `CACHE_TTL_TOC` | `86400000` (24 hr) | 1 min–30 days | TTL for table of contents cache entries |
| `CACHE_MAX_ENTRIES` | `500` | 10–10000 | Maximum number of entries kept in the in-memory cache |

### Request Settings

| Variable | Default | Range | Description |
|----------|---------|-------|-------------|
| `REQUEST_TIMEOUT` | `15000` | 1000–60000 ms | HTTP request timeout |
| `MAX_RETRIES` | `3` | 0–10 | Number of retry attempts on failure |
| `RETRY_DELAY` | `1000` | 100–30000 ms | Delay between retries |
| `RATE_LIMIT_DELAY` | `500` | 0–10000 ms | Delay between outbound requests (politeness) |
| `USER_AGENT` | `JamfDocsMCP/1.0 ...` | — | User-Agent header sent to learn.jamf.com |

### HTTP Transport Settings

| Variable | Default | Range | Description |
|----------|---------|-------|-------------|
| `RATE_LIMIT_RPM` | `60` | 1–10000 | Inbound requests per minute per IP (HTTP transport only) |
| `CORS_ALLOWED_ORIGINS` | `` (empty) | — | Comma-separated list of allowed CORS origins (HTTP transport only) |

## Development

```bash
git clone https://github.com/GET-Technology-Inc/jamf-docs-mcp-server.git
cd jamf-docs-mcp-server
npm install
npm run dev        # stdio mode with file watching
npm run start:http # HTTP transport mode
```

### Available Scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run dev` | Development mode with auto-reload (stdio) |
| `npm run start:http` | Start HTTP/SSE transport mode |
| `npm test` | Run all tests |
| `npm run test:unit` | Unit tests only |
| `npm run test:integration` | Integration tests only |
| `npm run test:e2e` | End-to-end tests only |
| `npm run test:coverage` | Test coverage report |
| `npm run test:inspector` | Launch MCP Inspector against local build |
| `npm run lint` | Lint source files |
| `npm run typecheck` | TypeScript type check without emitting |

## License

MIT - Copyright (c) 2025 GET Technology Inc.

## Disclaimer

This is an unofficial tool and is not affiliated with Jamf.

## Links

- [Jamf Documentation](https://learn.jamf.com)
- [MCP Specification](https://spec.modelcontextprotocol.io/)
