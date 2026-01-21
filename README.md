# Jamf Docs MCP Server

[![CI](https://github.com/GET-Technology-Inc/jamf-docs-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/GET-Technology-Inc/jamf-docs-mcp-server/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@get-technology-inc/jamf-docs-mcp-server.svg)](https://www.npmjs.com/package/@get-technology-inc/jamf-docs-mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

An MCP (Model Context Protocol) server that provides AI assistants with direct access to Jamf documentation from learn.jamf.com.

## Features

- 🔍 **Search**: Search across all Jamf product documentation
- 📖 **Read Articles**: Fetch full article content in Markdown format
- 📚 **Browse TOC**: Explore documentation structure by product
- 🏷️ **Product Filtering**: Filter by Jamf Pro, School, Connect, or Protect
- 💾 **Caching**: Built-in caching for faster responses

## Supported Products

| Product | Description |
|---------|-------------|
| Jamf Pro | Enterprise Apple device management |
| Jamf School | Education-focused device management |
| Jamf Connect | Identity and access management |
| Jamf Protect | Endpoint security for Apple |

## Requirements

- Node.js 20.0.0 or higher

## Installation

```bash
# Clone the repository
git clone https://github.com/GET-Technology-Inc/jamf-docs-mcp-server.git
cd jamf-docs-mcp-server

# Install dependencies
npm install

# Build
npm run build
```

## Usage

### Quick Start with npx

```bash
npx @get-technology-inc/jamf-docs-mcp-server
```

### With Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "jamf-docs": {
      "command": "node",
      "args": ["/path/to/jamf-docs-mcp-server/dist/index.js"]
    }
  }
}
```

### With Claude Code

```bash
claude mcp add jamf-docs -- node /path/to/jamf-docs-mcp-server/dist/index.js
```

### Testing with MCP Inspector

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

## Available Tools

### `jamf_docs_list_products`

List all available Jamf products and their documentation versions.

```
"What Jamf products have documentation?"
```

### `jamf_docs_search`

Search Jamf documentation for articles matching your query.

```
"Search for SSO configuration in Jamf Pro"
"Find articles about MDM enrollment"
```

### `jamf_docs_get_article`

Retrieve the full content of a specific documentation article.

```
"Get the article at https://docs.jamf.com/..."
```

### `jamf_docs_get_toc`

Get the table of contents for a product's documentation.

```
"Show me the Jamf Pro documentation structure"
```

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run build

# Run tests
npm test

# Type check
npm run typecheck
```

## Project Structure

```
jamf-docs-mcp-server/
├── src/
│   ├── index.ts          # Entry point
│   ├── types.ts          # Type definitions
│   ├── constants.ts      # Configuration
│   ├── tools/            # MCP tool implementations
│   │   ├── list-products.ts
│   │   ├── search.ts
│   │   ├── get-article.ts
│   │   └── get-toc.ts
│   ├── services/         # Core services
│   │   ├── scraper.ts    # Web scraping
│   │   └── cache.ts      # Caching
│   └── schemas/          # Zod validation schemas
├── .cache/               # Local cache (gitignored)
├── dist/                 # Build output
├── package.json
├── tsconfig.json
└── CLAUDE.md             # Development guide
```

## Configuration

The server uses sensible defaults but can be configured via environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `CACHE_DIR` | Cache directory | `.cache` |
| `REQUEST_TIMEOUT` | HTTP timeout (ms) | `15000` |
| `RATE_LIMIT_DELAY` | Delay between requests (ms) | `500` |
| `MAX_RETRIES` | Maximum retry attempts | `3` |
| `RETRY_DELAY` | Delay between retries (ms) | `1000` |
| `USER_AGENT` | Custom User-Agent string | `JamfDocsMCP/1.0` |
| `CACHE_TTL_SEARCH` | Search results cache TTL (ms) | `1800000` (30 min) |
| `CACHE_TTL_ARTICLE` | Article content cache TTL (ms) | `86400000` (24 hr) |
| `CACHE_TTL_TOC` | TOC cache TTL (ms) | `86400000` (24 hr) |
| `CACHE_TTL_PRODUCTS` | Products list cache TTL (ms) | `604800000` (7 days) |

Example:

```bash
CACHE_DIR=/tmp/jamf-cache REQUEST_TIMEOUT=30000 node dist/index.js
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests and type checks
5. Submit a pull request

## License

MIT - Copyright (c) 2025 GET Technology Inc.

## Maintainer

Developed and maintained by [GET Technology Inc.](https://github.com/GET-Technology-Inc)

## Disclaimer

This is an unofficial tool for accessing Jamf documentation. It is not affiliated with or endorsed by Jamf. Use responsibly and respect Jamf's terms of service.

## Related Resources

- [Jamf Documentation](https://learn.jamf.com)
- [Jamf Developer Portal](https://developer.jamf.com)
- [MCP Specification](https://spec.modelcontextprotocol.io/)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
