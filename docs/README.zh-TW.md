# Jamf Docs MCP Server

[![CI](https://github.com/GET-Technology-Inc/jamf-docs-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/GET-Technology-Inc/jamf-docs-mcp-server/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@get-technology-inc/jamf-docs-mcp-server.svg)](https://www.npmjs.com/package/@get-technology-inc/jamf-docs-mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

讓 AI 助手 (Claude、Cursor 等) 直接存取 Jamf 官方文件。當你詢問 Jamf 相關問題時，AI 可以即時搜尋並引用最新的官方文件內容。

**支援產品**: Jamf Pro、Jamf School、Jamf Connect、Jamf Protect、Jamf Now、Jamf Safe Internet、Jamf Insights、RapidIdentity、Jamf Trust、Jamf Routines、Self Service+、Jamf App Catalog

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

### HTTP/SSE 傳輸模式

除了預設的 stdio 模式，也支援 HTTP 傳輸模式，適合在 Docker、服務器或需要網路存取的情境中使用。

```bash
# 使用預設設定啟動 (127.0.0.1:3000)
npm run start:http

# 自訂 port 與 host
node dist/index.js --transport http --port 8080 --host 0.0.0.0
```

啟動後可用的端點：

| 端點 | 說明 |
|------|------|
| `POST /mcp` | MCP 協議端點 |
| `GET /health` | 健康檢查，回傳 `{"status":"ok","version":"<current>"}` |

在 MCP 客戶端設定中使用 HTTP 模式：

```json
{
  "mcpServers": {
    "jamf-docs": {
      "url": "http://127.0.0.1:3000/mcp"
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

## 支援的產品

| 產品 ID | 產品名稱 | 說明 |
|---------|----------|------|
| `jamf-pro` | Jamf Pro | 企業級 Apple 裝置管理 |
| `jamf-school` | Jamf School | 教育機構 Apple 裝置管理 |
| `jamf-connect` | Jamf Connect | 身分識別與存取管理 |
| `jamf-protect` | Jamf Protect | Apple 端點安全防護 |
| `jamf-now` | Jamf Now | 中小企業 Apple 裝置簡易管理 |
| `jamf-safe-internet` | Jamf Safe Internet | 教育與企業的內容過濾與網路安全 |
| `jamf-insights` | Jamf Insights | Apple 設備群分析與報告平台 |
| `jamf-rapididentity` | RapidIdentity | 身分識別與存取管理平台 |
| `jamf-trust` | Jamf Trust | Apple 裝置的零信任網路存取 |
| `jamf-routines` | Jamf Routines | 裝置管理自動化工作流程編排 |
| `self-service-plus` | Self Service+ | macOS 新一代自助服務入口 |
| `jamf-app-catalog` | Jamf App Catalog | 受管部署的精選應用程式目錄 |

## 提供的工具

### jamf_docs_search

搜尋 Jamf 文件中符合查詢條件的文章。

| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `query` | string | 是 | 搜尋關鍵字 (2-200 字元) |
| `product` | string | 否 | 依產品 ID 篩選 (詳見支援產品表) |
| `topic` | string | 否 | 依主題篩選 (enrollment、profiles、security 等) |
| `docType` | string | 否 | 依文件類型篩選: `documentation`、`release-notes`、`install-guide`、`technical-paper`、`configuration-guide`、`training` |
| `version` | string | 否 | 依版本篩選 (例如 `"11.5.0"`) |
| `language` | string | 否 | 文件語系 (預設: `en-US`) |
| `limit` | number | 否 | 每頁最多結果數 1-50 (預設: 10) |
| `page` | number | 否 | 分頁頁碼 1-100 (預設: 1) |
| `maxTokens` | number | 否 | 回應最大 token 數 100-20000 (預設: 5000) |
| `outputMode` | string | 否 | 輸出詳細程度: `"full"` 或 `"compact"` (預設: `"full"`) |
| `responseFormat` | string | 否 | 輸出格式: `"markdown"` 或 `"json"` (預設: `"markdown"`) |

### jamf_docs_get_article

取得特定 Jamf 文件文章的完整內容。

| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `url` | string | 是 | 文章完整 URL (須來自 `docs.jamf.com` 或 `learn.jamf.com`) |
| `section` | string | 否 | 依標題或 ID 擷取特定段落 (例如 `"Prerequisites"`) |
| `summaryOnly` | boolean | 否 | 只回傳文章摘要與大綱，節省 token (預設: `false`) |
| `includeRelated` | boolean | 否 | 回應中包含相關文章連結 (預設: `false`) |
| `language` | string | 否 | 文件語系 (預設: `en-US`) |
| `maxTokens` | number | 否 | 回應最大 token 數 100-20000 (預設: 5000) |
| `outputMode` | string | 否 | 輸出詳細程度: `"full"` 或 `"compact"`；compact 模式顯示約 500 token 預覽加上段落清單 (預設: `"full"`) |
| `responseFormat` | string | 否 | 輸出格式: `"markdown"` 或 `"json"` (預設: `"markdown"`) |

### jamf_docs_get_toc

取得 Jamf 產品文件的目錄結構。

| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `product` | string | 是 | 產品 ID (詳見支援產品表) |
| `version` | string | 否 | 特定版本 (預設: 最新版) |
| `language` | string | 否 | 文件語系 (預設: `en-US`) |
| `page` | number | 否 | 分頁頁碼 1-100 (預設: 1) |
| `maxTokens` | number | 否 | 回應最大 token 數 100-20000 (預設: 5000) |
| `outputMode` | string | 否 | 輸出詳細程度: `"full"` 或 `"compact"` (預設: `"full"`) |
| `responseFormat` | string | 否 | 輸出格式: `"markdown"` 或 `"json"` (預設: `"markdown"`) |

### jamf_docs_batch_get_articles

一次取得多篇文件文章。每個 URL 平行取得，無效網域會以單篇錯誤回報，不影響整批結果。

| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `urls` | string[] | 是 | Jamf 文件 URL 陣列 (1-10 筆) |
| `concurrency` | number | 否 | 最大平行請求數 1-5 (預設: 3) |
| `language` | string | 否 | 文件語系 (預設: `en-US`) |
| `maxTokens` | number | 否 | 所有文章的總 token 預算 100-20000 (預設: 5000) |
| `outputMode` | string | 否 | 每篇文章的輸出詳細程度: `"full"` 或 `"compact"` (預設: `"full"`) |
| `responseFormat` | string | 否 | 輸出格式: `"markdown"` 或 `"json"` (預設: `"markdown"`) |

### jamf_docs_glossary_lookup

查詢 Jamf 官方術語表，支援模糊比對。目前術語表僅提供英文版，傳入非英文 `language` 仍會回傳英文結果。

| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `term` | string | 是 | 要查詢的術語 (2-100 字元) |
| `product` | string | 否 | 依產品 ID 篩選 |
| `language` | string | 否 | 文件語系 (預設: `en-US`，術語表僅英文) |
| `maxTokens` | number | 否 | 回應最大 token 數 100-50000 (預設: 5000) |
| `outputMode` | string | 否 | 輸出詳細程度: `"full"` 或 `"compact"` (預設: `"full"`) |
| `responseFormat` | string | 否 | 輸出格式: `"markdown"` 或 `"json"` (預設: `"markdown"`) |

### jamf_docs_list_products

列出所有支援的 Jamf 產品、主題分類及文件類型。

| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `language` | string | 否 | 文件語系 (預設: `en-US`) |
| `maxTokens` | number | 否 | 回應最大 token 數 100-20000 (預設: 5000) |
| `outputMode` | string | 否 | 輸出詳細程度: `"full"` 或 `"compact"` (預設: `"full"`) |
| `responseFormat` | string | 否 | 輸出格式: `"markdown"` 或 `"json"` (預設: `"markdown"`) |

## MCP Resources

無需呼叫工具即可存取的參考資料：

| Resource | URI | 說明 |
|----------|-----|------|
| Jamf Products List | `jamf://products` | 所有支援產品的清單與版本資訊，從 API 動態取得 |
| Jamf Documentation Topics | `jamf://topics` | 搜尋過濾用的主題分類 |
| Product Table of Contents | `jamf://products/{productId}/toc` | 特定產品的文件目錄結構 (範本資源) |
| Product Documentation Versions | `jamf://products/{productId}/versions` | 特定產品的可用文件版本清單 (範本資源) |

範本資源 (`jamf://products/{productId}/toc` 與 `jamf://products/{productId}/versions`) 支援 MCP 自動補全：輸入 `{productId}` 時會提供所有有效產品 ID 的建議選項。

## MCP Prompts

內建提示範本，引導 AI 執行常見的 Jamf 文件查詢工作流程：

### jamf_troubleshoot

引導 AI 使用官方文件進行 Jamf 問題排查。

| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `problem` | string | 是 | 問題描述 (最多 2000 字元) |
| `product` | string | 否 | Jamf 產品 ID (支援自動補全) |

執行步驟：搜尋相關文件 → 以 `summaryOnly` 快速評估相關性 → 深入閱讀解決方案 → 提供根本原因分析與逐步解決方案。

### jamf_setup_guide

根據官方文件產生 Jamf 功能的逐步設定指南。

| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `feature` | string | 是 | 要設定的功能或能力 (最多 2000 字元) |
| `product` | string | 否 | Jamf 產品 ID (支援自動補全) |

執行步驟：搜尋設定文件 → 找到主要設定文章 → 擷取詳細步驟 → 整理成含前置需求、設定步驟、驗證方法的完整指南。

### jamf_compare_versions

比較 Jamf 產品兩個版本之間的文件差異。

| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `product` | string | 是 | Jamf 產品 ID (支援自動補全，最多 100 字元) |
| `version_a` | string | 是 | 第一個比較版本 (例如 `"11.5.0"`) |
| `version_b` | string | 是 | 第二個比較版本 (例如 `"11.12.0"`) |

執行步驟：取得兩個版本的目錄 → 識別結構差異 → 審閱關鍵變更文章 → 彙整新增功能、移除功能及遷移注意事項。

## 主要功能

- **精簡模式**：使用 `outputMode: "compact"` 取得節省 token 的簡潔回應；文章會顯示約 500 token 預覽加上可用段落清單
- **摘要預覽**：使用 `summaryOnly: true` 預覽文章大綱，再決定是否取得完整內容
- **批次取得**：使用 `jamf_docs_batch_get_articles` 一次取得最多 10 篇文章
- **術語查詢**：使用 `jamf_docs_glossary_lookup` 模糊比對 Jamf 官方術語
- **多語系支援**：所有工具皆支援 `language` 參數切換文件語系 (例如 `ja-JP`、`de-DE`)
- **版本查詢**：使用 `version` 參數查詢特定產品版本的文件
- **搜尋建議**：搜尋無結果時提供替代關鍵字與主題建議
- **分頁支援**：大型搜尋結果與目錄支援分頁瀏覽
- **自動補全**：產品、主題、版本參數支援 MCP 自動補全

## 環境變數

可選的環境變數設定：

### 快取設定

| 變數 | 說明 | 預設值 | 有效範圍 |
|------|------|--------|----------|
| `CACHE_DIR` | 快取目錄路徑 | `.cache` | 相對或絕對路徑 |
| `CACHE_TTL_SEARCH` | 搜尋結果快取時間 (ms) | `1800000` (30 分鐘) | 1 分鐘 - 30 天 |
| `CACHE_TTL_ARTICLE` | 文章內容快取時間 (ms) | `86400000` (24 小時) | 1 分鐘 - 30 天 |
| `CACHE_TTL_PRODUCTS` | 產品清單快取時間 (ms) | `604800000` (7 天) | 1 分鐘 - 30 天 |
| `CACHE_TTL_TOC` | 目錄快取時間 (ms) | `86400000` (24 小時) | 1 分鐘 - 30 天 |
| `CACHE_MAX_ENTRIES` | 快取最大項目數 | `500` | 10 - 10000 |

### 請求設定

| 變數 | 說明 | 預設值 | 有效範圍 |
|------|------|--------|----------|
| `REQUEST_TIMEOUT` | HTTP 請求逾時 (ms) | `15000` (15 秒) | 1 秒 - 60 秒 |
| `MAX_RETRIES` | 請求失敗最大重試次數 | `3` | 0 - 10 |
| `RETRY_DELAY` | 重試延遲時間 (ms) | `1000` (1 秒) | 100ms - 30 秒 |
| `RATE_LIMIT_DELAY` | 速率限制延遲 (ms) | `500` | 0 - 10 秒 |
| `USER_AGENT` | HTTP 請求的 User-Agent 字串 | `JamfDocsMCP/1.0 (...)` | 任意字串 |

### HTTP 傳輸設定

| 變數 | 說明 | 預設值 | 有效範圍 |
|------|------|--------|----------|
| `RATE_LIMIT_RPM` | HTTP 模式每 IP 每分鐘請求上限 | `60` | 1 - 10000 |
| `CORS_ALLOWED_ORIGINS` | CORS 允許的來源 (逗號分隔) | `""` (停用 CORS) | 逗號分隔的 URL 列表 |

## 開發

```bash
git clone https://github.com/GET-Technology-Inc/jamf-docs-mcp-server.git
cd jamf-docs-mcp-server
npm install
npm run dev
```

### 常用指令

```bash
npm run build          # 編譯 TypeScript
npm test               # 執行所有測試
npm run test:unit      # 單元測試
npm run test:integration  # 整合測試
npm run test:e2e       # E2E 測試
npm run test:coverage  # 測試覆蓋率報告
npm run lint           # ESLint 檢查
npm run typecheck      # TypeScript 型別檢查
npm run start:http     # 以 HTTP 模式啟動
npm run test:inspector # MCP Inspector 測試
```

## License

MIT - Copyright (c) 2025 GET Technology Inc.

## 免責聲明

本工具為非官方專案，與 Jamf 無隸屬關係。

## 相關連結

- [Jamf Documentation](https://learn.jamf.com)
- [MCP Specification](https://spec.modelcontextprotocol.io/)
