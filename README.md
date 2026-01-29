# Jamf Docs MCP Server

[![CI](https://github.com/GET-Technology-Inc/jamf-docs-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/GET-Technology-Inc/jamf-docs-mcp-server/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@get-technology-inc/jamf-docs-mcp-server.svg)](https://www.npmjs.com/package/@get-technology-inc/jamf-docs-mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

An MCP server that gives AI assistants (Claude, Cursor, etc.) direct access to Jamf official documentation. Ask Jamf-related questions and get answers based on the latest docs from learn.jamf.com.

**Supported Products**: Jamf Pro, Jamf School, Jamf Connect, Jamf Protect

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

## Available Tools

| Tool | Description |
|------|-------------|
| `jamf_docs_search` | Search documentation |
| `jamf_docs_get_article` | Get article content |
| `jamf_docs_get_toc` | Get table of contents |
| `jamf_docs_list_products` | List supported products |

## MCP Resources

Static reference data accessible without tool calls:

| Resource | Description |
|----------|-------------|
| `jamf://products` | List of products with version info |
| `jamf://topics` | Topic categories for filtering |

## Key Features

- **Compact Mode**: Use `outputMode: "compact"` for token-efficient responses
- **Summary Only**: Use `summaryOnly: true` to preview articles before fetching full content
- **Version Query**: Use `version` parameter to query specific product versions
- **Search Suggestions**: Get helpful suggestions when no results found

## Configuration

Optional environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `CACHE_DIR` | Cache directory | `.cache` |
| `REQUEST_TIMEOUT` | Request timeout (ms) | `15000` |
| `CACHE_TTL_ARTICLE` | Article cache TTL (ms) | `86400000` (24hr) |

## Development

```bash
git clone https://github.com/GET-Technology-Inc/jamf-docs-mcp-server.git
cd jamf-docs-mcp-server
npm install
npm run dev
```

## License

MIT - Copyright (c) 2025 GET Technology Inc.

## Disclaimer

This is an unofficial tool and is not affiliated with Jamf.

## Links

- [Jamf Documentation](https://learn.jamf.com)
- [MCP Specification](https://spec.modelcontextprotocol.io/)
