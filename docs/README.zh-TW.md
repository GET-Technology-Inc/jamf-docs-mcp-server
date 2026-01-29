# Jamf Docs MCP Server

[![CI](https://github.com/GET-Technology-Inc/jamf-docs-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/GET-Technology-Inc/jamf-docs-mcp-server/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@get-technology-inc/jamf-docs-mcp-server.svg)](https://www.npmjs.com/package/@get-technology-inc/jamf-docs-mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

讓 AI 助手 (Claude、Cursor 等) 直接存取 Jamf 官方文件。當你詢問 Jamf 相關問題時，AI 可以即時搜尋並引用最新的官方文件內容。

**支援產品**: Jamf Pro、Jamf School、Jamf Connect、Jamf Protect

[English](../README.md)

## 快速開始

### Claude Desktop

編輯 `claude_desktop_config.json`：

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

重啟 Claude Desktop 即可使用。

### Claude Code (CLI)

```bash
claude mcp add jamf-docs -- npx -y @get-technology-inc/jamf-docs-mcp-server
```

### Cursor

編輯 `~/.cursor/mcp.json`：

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

### 測試安裝

使用 MCP Inspector 驗證：

```bash
npx @modelcontextprotocol/inspector npx -y @get-technology-inc/jamf-docs-mcp-server
```

## 使用範例

設定完成後，直接向 AI 提問即可：

- "如何在 Jamf Pro 設定 SSO？"
- "Jamf Protect 的系統需求是什麼？"
- "MDM enrollment 的流程是什麼？"

## 提供的工具

| 工具 | 功能 |
|------|------|
| `jamf_docs_search` | 搜尋文件 |
| `jamf_docs_get_article` | 取得文章內容 |
| `jamf_docs_get_toc` | 取得目錄結構 |
| `jamf_docs_list_products` | 列出支援的產品 |

## MCP Resources

無需呼叫工具即可存取的靜態資料：

| Resource | 說明 |
|----------|------|
| `jamf://products` | 產品清單與版本資訊 |
| `jamf://topics` | 搜尋過濾用的主題分類 |

## 主要功能

- **精簡模式**：使用 `outputMode: "compact"` 取得節省 token 的簡潔回應
- **摘要預覽**：使用 `summaryOnly: true` 預覽文章大綱，再決定是否取得完整內容
- **版本查詢**：使用 `version` 參數查詢特定產品版本的文件
- **搜尋建議**：搜尋無結果時提供替代關鍵字與主題建議

## 環境變數

可選的環境變數設定：

| 變數 | 說明 | 預設值 |
|------|------|--------|
| `CACHE_DIR` | 快取目錄 | `.cache` |
| `REQUEST_TIMEOUT` | 請求逾時 (ms) | `15000` |
| `CACHE_TTL_ARTICLE` | 文章快取時間 (ms) | `86400000` (24hr) |

## 開發

```bash
git clone https://github.com/GET-Technology-Inc/jamf-docs-mcp-server.git
cd jamf-docs-mcp-server
npm install
npm run dev
```

## License

MIT - Copyright (c) 2025 GET Technology Inc.

## 免責聲明

本工具為非官方專案，與 Jamf 無隸屬關係。

## 相關連結

- [Jamf Documentation](https://learn.jamf.com)
- [MCP Specification](https://spec.modelcontextprotocol.io/)
