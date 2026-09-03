# Jamf Docs MCP Server

[![CI](https://github.com/GET-Technology-Inc/jamf-docs-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/GET-Technology-Inc/jamf-docs-mcp-server/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@get-technology-inc/jamf-docs-mcp-server.svg)](https://www.npmjs.com/package/@get-technology-inc/jamf-docs-mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

An MCP server that gives AI assistants (Claude, Cursor, etc.) direct access to Jamf official documentation. Ask Jamf-related questions and get answers based on the latest docs from learn.jamf.com.

**Supported Products** (28): Jamf Pro, Jamf School, Jamf Connect, Jamf Protect, Jamf Now, Jamf Safe Internet, Jamf Insights, RapidIdentity, Jamf Trust, Jamf Routines, Self Service+, Jamf App Catalog, Jamf Account, Jamf Security Cloud, Elevate, Composer, Jamf Parent, Jamf Teacher, Jamf Setup and Reset, Jamf Assessment, Title Editor, Jamf Infrastructure Manager, Jamf AD CS Connector, Jamf PKI Proxy, Jamf Migrate, Jamf Remote Assist, Jamf Cloud Distribution Service, Healthcare Listener

[中文文件](docs/README.zh-TW.md)

## Installation

`@modelcontextprotocol/server` is a **peer dependency**, and the CLI imports it
at startup (`dist/index.js` → `@modelcontextprotocol/server/stdio`). If it is
missing from the install tree the process exits immediately with
`ERR_MODULE_NOT_FOUND` — the install itself succeeds, so the failure only
shows up when you run the server.

Most install paths bring it in automatically:

| Install method | Peer installed |
| --- | --- |
| `npx -y @get-technology-inc/jamf-docs-mcp-server` | Yes |
| `npm install` (npm 7+, default settings) | Yes |
| `pnpm add` (pnpm 10) | Yes |
| `npm install --legacy-peer-deps` | **No** |
| Yarn 1 (classic) | **No** |

If you use one of the last two — or if you are vendoring the package — install
the SDK alongside it:

```bash
npm install @get-technology-inc/jamf-docs-mcp-server @modelcontextprotocol/server@^2
```

**Why it is a peer dependency, not a regular one.** This package hands
`McpServer` instances to its consumers, and those consumers pass them to
`createMcpHandler` from their own SDK copy. If the two resolve to *different*
copies of the SDK, an instance built by one module's `Protocol` is inspected by
another's, and every 2026-07-28 request fails with
`Cannot read properties of undefined (reading 'includes')` — an HTTP 500 with
no useful diagnostic. Declaring the SDK as a peer states the single-copy
requirement instead of relying on the consumer's tree happening to hoist it;
listing it under `dependencies` as well would reintroduce exactly the duplicate
it exists to prevent.

Node.js 20 or newer is required.

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
| `jamf_docs_get_toc` | Browse the table of contents for a product or any single publication |
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
| `docType` | string | — | Filter by document type: `documentation`, `release-notes`, `training`, `solution-guide`, `glossary`, `getting-started` |
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
| `self-service-plus` | Self Service+ | Next-generation self-service portal for macOS and mobile |
| `jamf-app-catalog` | Jamf App Catalog | Curated application catalog for managed deployments |
| `jamf-account` | Jamf Account | Identity, licensing, and platform services portal |
| `jamf-security-cloud` | Jamf Security Cloud | Cloud security portal for Jamf Connect and Jamf Protect |
| `elevate` | Elevate | Guided remediation and device health portal |
| `composer` | Composer | macOS package building and editing |
| `jamf-parent` | Jamf Parent | Parental device controls for school-issued devices |
| `jamf-teacher` | Jamf Teacher | Classroom device management for teachers |
| `jamf-setup-reset` | Jamf Setup and Reset | Device personalisation and wipe-and-reprovision apps |
| `jamf-assessment` | Jamf Assessment | Locked-down assessment mode for education devices |
| `title-editor` | Title Editor | Custom software title patch definitions |
| `jamf-infrastructure-manager` | Jamf Infrastructure Manager | On-premises proxy for LDAP and other internal services |
| `jamf-adcs-connector` | Jamf AD CS Connector | Certificate issuance via Active Directory Certificate Services |
| `jamf-pki-proxy` | Jamf PKI Proxy | Proxy for certificate authorities behind a firewall |
| `jamf-migrate` | Jamf Migrate | Migrating macOS devices between Jamf Pro instances |
| `jamf-remote-assist` | Jamf Remote Assist | Remote screen sharing and support sessions |
| `jamf-cloud-distribution-service` | Jamf Cloud Distribution Service | Jamf-hosted package distribution (JCDS) |
| `healthcare-listener` | Healthcare Listener | Integration with healthcare information systems |

## Key Features

- **Compact Mode**: Use `outputMode: "compact"` for token-efficient responses; articles show a ~500-token preview with an available sections list
- **Summary Only**: Use `summaryOnly: true` on `jamf_docs_get_article` to preview an article outline before fetching full content
- **Section Extraction**: Use `section: "Prerequisites"` to retrieve only the part of an article you need
- **Batch Fetching**: Use `jamf_docs_batch_get_articles` to fetch up to 10 articles in one call with concurrent requests
- **Glossary Lookup**: Use `jamf_docs_glossary_lookup` to look up Jamf terminology with fuzzy matching
- **Multi-language**: All tools accept a `language` parameter for localized documentation (e.g., `ja-JP`, `de-DE`)
- **Document Type Filter**: Use `docType` on `jamf_docs_search` to narrow results to `documentation`, `release-notes`, `training`, `solution-guide`, `glossary`, or `getting-started`
- **Version Query**: Use the `version` parameter to query documentation for a specific product version
- **Pagination**: Search results support `page` and `limit`; table of contents supports `page`; product lists are not paginated
- **Search Suggestions**: Receive helpful suggestions when a search returns no results
- **Token Management**: All tools accept a `maxTokens` parameter (100–20000, default 5000) to control response size

## MCP Apps (interactive viewer)

Hosts that negotiate the MCP Apps extension (`io.modelcontextprotocol/ui`) render
`jamf_docs_search`, `jamf_docs_get_toc` and `jamf_docs_get_article` results as an
interactive viewer instead of plain markdown: search hits are clickable through to
the article, TOC entries open in place, and articles carry section navigation and a
back stack. All three tools reference one self-contained `ui://` resource, whose
URI carries a hash of the bundle it names (`ui://jamf-docs/app-<hash>.html`).
Hosts that do not negotiate the extension ignore the metadata and get exactly the
markdown they always did.

The resource is served with a 24-hour public cache hint, which is safe precisely
because the URI is content-addressed: a given URI names one exact bundle forever,
and a new bundle arrives under a new URI rather than replacing an old one. Hosts
pick up a changed viewer on their next `tools/list` refresh.

### Design

The viewer paints no background and owns no colour. It reads the host's theme,
design tokens and fonts out of `hostContext` (`applyDocumentTheme`,
`applyHostStyleVariables`, `applyHostFonts`) and builds every rule from those,
so the panel is a piece of the host's surface rather than a web page embedded in
one. `app-ui/styles.ts` carries a `:root` fallback for each token, because hosts
may send any subset of the 76 style variables.

Before 5.10 it did the opposite: a hardcoded palette with a
`prefers-color-scheme` dark block. That media query reports the **operating
system**, not the host — so a user running Claude in dark mode on a light OS got
a white slab in a dark conversation, and no tuning of the greys could fix it.

### Inline and fullscreen

The two display modes render different things, because Claude's
[design guidelines](https://claude.com/docs/connectors/building/mcp-apps/design-guidelines)
make them different surfaces. An inline card is a compact summary that fits its
own content; fullscreen is where a documentation browser lives.

|                                   | Inline                        | Fullscreen |
| --------------------------------- | ----------------------------- | ---------- |
| Search hits                       | 3                             | the page   |
| Table-of-contents rows            | 8                             | the page   |
| Article prose                     | 3 blocks, stopping before any table or code block | whole |
| Breadcrumbs, Back, parent link    | —                             | ✓          |
| Section rail, neighbour list      | —                             | ✓          |
| Type-ahead filter, paging         | —                             | ✓          |
| Actions                           | 1                             | as needed  |

Opening a result from an inline panel sends `ui/request-display-mode` **before**
the `tools/call`, so the article arrives in the mode built for it. A host that
declines, or that offers no fullscreen, still gets the article in place.

Two documented constraints drive this.

**Inline apps must not scroll internally.** On a touch device the conversation
view owns vertical panning, so a vertical gesture starting inside an inline app
is handed to the conversation — an internal scroll container does not scroll at
all, and everything past the host's cap becomes *unreachable* rather than below
the fold. Bounding what is rendered instead keeps search at ~518px, the table of
contents at ~373px and an article at ~554px, all fully visible.

**Inline apps must not drill in.** "Drill-ins, breadcrumbs, or multiple views"
are named patterns to avoid, which is why every piece of navigation chrome above
is fullscreen-only.

The article preview is counted in blocks rather than characters. A character
budget does not predict height: 900 characters of prose is three short
paragraphs, and 900 characters containing a 22-row settings table is 700px of
panel.

Style variables in `app-ui/styles.ts` are transcribed from the same guidelines.

### Article navigation

`jamf_docs_get_article` publishes `navigation` — `parent`, `siblings`,
`children`, and the true totals alongside the (capped) lists.

This matters more than it sounds. Fluid Topics serves **one topic per API call**
while learn.jamf.com concatenates a topic and its children into a single page,
so every `<h2>` a reader sees on the site is a separate topic here — verified at
9 of 9 on "Computer Configuration Profiles", whose API payload contains zero
heading tags of any level. Without `navigation`, a client showing that page has
the introduction and no route to the nine procedures the page consists of on the
website. The viewer renders them as *In this section*.

It is derived from the map's TOC index, which the breadcrumb lookup already
fetches and caches, so an article pays no extra request for it.

### Developing the viewer

```bash
npm run dev:app-ui     # http://127.0.0.1:5173 — edit app-ui/*.ts, the frame reloads
```

`app-ui/dev/harness.ts` is a local MCP Apps host built on the SDK's `AppBridge`,
which accepts `Client | null` — a host with no server behind it is a supported
mode. It speaks the real protocol to the real `App` class and answers
`tools/call` out of `app-ui/dev/fixtures.json`, real `structuredContent`
captured from the live tools by `npm run fixtures:app-ui`.

It exists because the viewer only runs inside a host, so there is nothing to
look at without one, and the alternative loop — build, launch the Inspector,
click through — is tens of seconds per edit. It also does three things no
inspector can: strip `hostContext.styles` entirely (the check that proves the
`:root` fallbacks are coherent as a set), resize the container continuously
across the `@container` breakpoints, and lie about `deviceCapabilities.hover`.

Before shipping, run the viewer through the real thing as well — it is the only
place the actual `ui://` resource, CSP and `_meta` are exercised:

```bash
npm run build && npm run test:inspector
```

> [!WARNING]
> **The MCP Apps viewer is broken in 4.0.0 — upgrade past it.** The build step that
> inlines the UI bundle into the HTML document used a replacement string, so every
> `$` pattern in the minified JavaScript was expanded instead of copied. The
> document that shipped is not parseable JavaScript, and a host that renders it gets
> `SyntaxError: missing ) after argument list` and a blank panel. Nothing else in
> 4.0.0 is affected — tools, resources and prompts return the same results either
> way, since a host that cannot render the app falls back to the markdown. Fixed in
> 4.0.1.
>
> **4.0.1 alone did not reach every host.** Up to and including 4.0.1 the resource
> lived at a fixed `ui://jamf-docs/app.html` with a 24-hour public cache hint, so a
> host that had read the broken 4.0.0 bundle kept serving it from cache for up to a
> day after the server was upgraded — the corrected bundle was published under the
> same URI and never fetched. Upgrading past 4.0.1 fixes the distribution as well as
> the bundle: the URI now changes with the content, so a host holding the 4.0.0 copy
> simply stops asking for it. No manual cache clearing is needed, and the remaining
> delay is the one-hour `tools/list` hint rather than 24 hours.

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
| `npm run dev:app-ui` | Live preview of the MCP Apps viewer at http://127.0.0.1:5173 |
| `npm run fixtures:app-ui` | Re-capture the viewer's fixtures from the live tools |
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
