# Jamf Docs MCP Server

[![CI](https://github.com/GET-Technology-Inc/jamf-docs-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/GET-Technology-Inc/jamf-docs-mcp-server/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/GET-Technology-Inc/jamf-docs-mcp-server/graph/badge.svg)](https://app.codecov.io/gh/GET-Technology-Inc/jamf-docs-mcp-server)
[![npm version](https://img.shields.io/npm/v/@get-technology-inc/jamf-docs-mcp-server.svg)](https://www.npmjs.com/package/@get-technology-inc/jamf-docs-mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

讓 AI 助手 (Claude、Cursor 等) 直接存取 Jamf 官方文件。當你詢問 Jamf 相關問題時，AI 可以即時搜尋並引用最新的官方文件內容。

**支援產品** (28): Jamf Pro、Jamf School、Jamf Connect、Jamf Protect、Jamf Now、Jamf Safe Internet、Jamf Insights、RapidIdentity、Jamf Trust、Jamf Routines、Self Service+、Jamf App Catalog、Jamf Account、Jamf Security Cloud、Elevate、Composer、Jamf Parent、Jamf Teacher、Jamf Setup and Reset、Jamf Assessment、Title Editor、Jamf Infrastructure Manager、Jamf AD CS Connector、Jamf PKI Proxy、Jamf Migrate、Jamf Remote Assist、Jamf Cloud Distribution Service、Healthcare Listener

[English](../README.md)

## 安裝

`@modelcontextprotocol/server` 是 **peer dependency**，而 CLI 在啟動時就會載入它
(`dist/index.js` → `@modelcontextprotocol/server/stdio`)。若安裝樹中沒有它，程式會
立刻以 `ERR_MODULE_NOT_FOUND` 結束——安裝本身是成功的，問題只在實際執行時才浮現。

多數安裝方式會自動帶入：

| 安裝方式 | 是否安裝 peer |
| --- | --- |
| `npx -y @get-technology-inc/jamf-docs-mcp-server` | 是 |
| `npm install` (npm 7+，預設設定) | 是 |
| `pnpm add` (pnpm 10) | 是 |
| `npm install --legacy-peer-deps` | **否** |
| Yarn 1 (classic) | **否** |

若使用後兩者——或是自行 vendoring 本套件——請一併安裝 SDK：

```bash
npm install @get-technology-inc/jamf-docs-mcp-server @modelcontextprotocol/server@^2
```

**為什麼是 peer dependency 而不是一般 dependency。** 本套件會把 `McpServer` 實例交給
使用者，而使用者再把它傳給自己那份 SDK 的 `createMcpHandler`。若兩者解析到**不同**份
SDK，實例由某個模組的 `Protocol` 建立、卻被另一個模組檢查，每個 2026-07-28 請求都會以
`Cannot read properties of undefined (reading 'includes')` 失敗——回傳 HTTP 500 且沒有
可用的診斷資訊。把 SDK 宣告為 peer 是把「只能有一份」這個要求講明白，而不是寄望使用者的
依賴樹剛好會 hoist；若同時列進 `dependencies`，就會重新製造出它本來要避免的那份重複。

需要 Node.js 24 或更新版本。5.x 是最後一個支援 Node.js 20 與 22 的版本系列。
在這兩個版本上，未指定版本的 `npx -y @get-technology-inc/jamf-docs-mcp-server`
會自動解析到最新的 5.x，因為 npm 會優先選用 `engines` 相容於目前 Node 的最新釋出版本：
伺服器仍可正常運作，但在升級 Node 之前不會再收到更新。若要明確指定，請使用
`@get-technology-inc/jamf-docs-mcp-server@5`。

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
| `self-service-plus` | Self Service+ | macOS 與行動裝置的新一代自助服務入口 |
| `jamf-app-catalog` | Jamf App Catalog | 受管部署的精選應用程式目錄 |
| `jamf-account` | Jamf Account | 身分、授權與平台服務入口 |
| `jamf-security-cloud` | Jamf Security Cloud | Jamf Connect 與 Jamf Protect 的雲端安全入口 |
| `elevate` | Elevate | 引導式修復與裝置健康狀態入口 |
| `composer` | Composer | macOS 套件建置與編輯 |
| `jamf-parent` | Jamf Parent | 校方配發裝置的家長端管控 |
| `jamf-teacher` | Jamf Teacher | 教師端的課堂裝置管理 |
| `jamf-setup-reset` | Jamf Setup and Reset | 裝置個人化與抹除重佈署 App |
| `jamf-assessment` | Jamf Assessment | 教育裝置的鎖定測驗模式 |
| `title-editor` | Title Editor | 自訂軟體標題的修補定義 |
| `jamf-infrastructure-manager` | Jamf Infrastructure Manager | LDAP 等內部服務的地端代理 |
| `jamf-adcs-connector` | Jamf AD CS Connector | 透過 Active Directory 憑證服務簽發憑證 |
| `jamf-pki-proxy` | Jamf PKI Proxy | 防火牆後憑證授權單位的代理 |
| `jamf-migrate` | Jamf Migrate | 在 Jamf Pro 執行個體之間遷移 macOS 裝置 |
| `jamf-remote-assist` | Jamf Remote Assist | 遠端畫面共享與支援連線 |
| `jamf-cloud-distribution-service` | Jamf Cloud Distribution Service | Jamf 代管的套件派送（JCDS） |
| `healthcare-listener` | Healthcare Listener | 與醫療資訊系統整合 |

## 提供的工具

### jamf_docs_search

搜尋 Jamf 文件中符合查詢條件的文章。

| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `query` | string | 是 | 搜尋關鍵字 (2-200 字元，或單一個中文、日文或韓文字) |
| `product` | string | 否 | 依產品 ID 篩選 (詳見支援產品表) |
| `topic` | string | 否 | 依主題篩選 (enrollment、profiles、security 等) |
| `docType` | string | 否 | 依文件類型篩選: `documentation`、`release-notes`、`training`、`solution-guide`、`glossary`、`getting-started` |
| `version` | string | 否 | 依版本篩選 (例如 `"11.13.0"`) 或 `"current"`，最長 50 個字元 |
| `language` | string | 否 | 文件語系 (預設: `en-US`) |
| `limit` | number | 否 | 每頁最多結果數 1-50 (預設: 10) |
| `page` | number | 否 | 分頁頁碼 1-100 (預設: 1) |
| `maxTokens` | number | 否 | 回應最大 token 數 100-50000 (預設: 5000) |
| `outputMode` | string | 否 | 輸出詳細程度: `"full"` 或 `"compact"` (預設: `"full"`) |
| `responseFormat` | string | 否 | 輸出格式: `"markdown"` 或 `"json"` (預設: `"markdown"`) |

搜尋結果依 `maxTokens` 分頁。每頁最多 `limit` 筆結果，放得下多少就放多少，下一頁從第一筆放不下的結果開始。每筆結果都恰好出現在某一頁，但在第幾頁取決於 `limit` 與 `maxTokens`，所以翻頁時請維持這兩個參數不變。當它們不是預設值時，markdown 頁尾會在下一個 `page` 旁註明；`structuredContent` 會回傳翻頁時該重送的參數：`filters`、`limit` 與 `maxTokens`。MCP App 的「Show more」會全部重送。若某筆結果本身就超過 `maxTokens`，它會獨佔一頁，摘要 (snippet) 會截短到放得下為止並以 `…` 結尾。只有這種頁面的 `tokenInfo.truncated` 為 `true`，`truncatedResult` 會註明是哪一筆結果，以及整筆結果需要多少 token (`estimatedTokens`)；`outputMode: "full"` 的 markdown 會註明重新呼叫時該用多少 `maxTokens`。若 `limit` 與 `maxTokens` 使頁數超過 `page` 可接受的上限 (100)，第 100 頁不會再提供下一頁，`paginationNote` 會說明如何讀到其餘結果。

Jamf 的搜尋也會把 Jamf Training Catalog (trainingcatalog.jamf.com) 的課程與學習路徑排在文件之間。這些頁面會與其他結果一樣回傳，排在 Jamf 搜尋給的名次，也同樣受 `product` 與 `topic` 篩選，並標示為 `external: true` (markdown 中為 **External**)。`jamf_docs_get_article` 無法讀取這些頁面，請在瀏覽器中開啟其 `url`。它們沒有 `mapId` + `contentId`。Jamf 將它們歸類為培訓內容，因此其 `docType` 為 `training`：指定 `docType: "training"` 時，它們會依 Jamf 搜尋給的名次與培訓主題一同出現；指定其他 `docType` 或特定 `version` 時則不會出現。

「No results found」表示已完成搜尋，但產品文件中沒有符合的內容（使用 `responseFormat: "json"` 時，則是 `total: 0` 的 JSON 內容）。回應仍會列出產品文件以外的相符頁面（`otherSources`），以及可改用的查詢（`suggestions`）。若查詢含有中文、日文、韓文或泰文字詞，而搜尋的語言其文件並非以這些文字撰寫（例如預設的 `en-US`，其文件為英文），則不會建議這些字詞，回應會說明可改用英文術語搜尋，或改用哪個 `language` 搜尋（JSON 為 `localeNote`）。查詢若沒有以雙引號括住的片語，也沒有以 `+` 或 `-` 標示的字詞，Fluid Topics 只要頁面含有其中任一字詞即視為符合；因此這類查詢沒有結果時，不會建議只用其中較少的字詞（同樣找不到），而是在 markdown 回應中提示檢查拼字或改用其他詞彙。彎引號（“ ” „ ‟）與全形 ＂ 會以直雙引號送往 Fluid Topics，因此以它們括住的片語會當作片語搜尋。若無法完成搜尋（learn.jamf.com 無法連線、逾時或回應錯誤，或自訂的搜尋後端 `SearchProvider` 失敗），工具會回傳錯誤（`isError: true`），說明是哪一步失敗、這並不代表「沒有結果」，以及重試是否可能有幫助。產品文件以外的相符頁面會接在錯誤之後，放在第二個文字區塊。

### jamf_docs_get_article

取得特定 Jamf 文件文章的完整內容。可用 `url` 指定文章，或改用搜尋結果與目錄提供的
`mapId` + `contentId`；至少須提供其中一種，都沒提供會回傳錯誤。

搜尋結果會同時帶有這三個欄位，一起傳入也沒問題。在 learn.jamf.com 上由
`mapId` + `contentId` 決定取得哪篇文章，回傳的 `url` 就是該文章本身的網址，取自
文章的中繼資料，取不到時改用目錄；若傳入的 `url` 與它不符，回應會附註說明。只有兩者都
沒有這個網址時，才會沿用傳入的 `url`。concepts.jamf.com 與 support.jamf.com 的網址則依 `url` 取得，並附註說明
`mapId` + `contentId` 已被忽略。`jamf_docs_get_toc` 以 collection 頁面的網址列出
support.jamf.com 的每個子 collection，傳入這種網址會回傳該 collection 的文章清單。
concepts.jamf.com 路徑開頭沒有語系代碼的網址，網站只會回應一個轉址到英文版頁面的頁面，
因此會回傳該英文版頁面，並使用它本身的網址。網站根目錄 `https://concepts.jamf.com/`
是在瀏覽器中選擇語言的頁面，會回傳英文版首頁 `/en/`。指定 `language` 時，兩者都會在
網站有該語言版本時回傳該版本。

| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `url` | string | 擇一 | 文章完整 `https://` URL (須來自 `learn.jamf.com`、`docs.jamf.com`、`concepts.jamf.com` 或 `support.jamf.com`，最長 2,048 個字元) |
| `mapId` | string | 擇一 | Fluid Topics map ID (取自搜尋結果或目錄)，須與 `contentId` 一起提供，可取代 `url` 或與其並用 |
| `contentId` | string | 擇一 | Fluid Topics content ID (取自搜尋結果或目錄)，須與 `mapId` 一起提供，可取代 `url` 或與其並用 |
| `section` | string | 否 | 依標題或 ID 擷取特定段落 (例如 `"Prerequisites"`)，最長 200 個字元。找不到符合的標題不算錯誤：回應會列出文章的段落，或說明文章沒有段落，並附上子主題及其網址；learn.jamf.com 頁面上看到的段落大多其實是子主題 |
| `summaryOnly` | boolean | 否 | 只回傳文章摘要與大綱 (文章有子主題時一併列出)，節省 token (預設: `false`) |
| `includeRelated` | boolean | 否 | 回應中包含相關文章連結 (預設: `false`) |
| `language` | string | 否 | 文件語系 (預設: `url` 本身的語系)。會覆寫 `url` 中的語系。learn.jamf.com 上 Jamf 未以該語系發布的出版品，會回傳 en-US 版本；concepts.jamf.com、support.jamf.com 上沒有該語系版本的頁面，會回傳 `url` 所指的頁面；兩者皆附註說明，`contentLocale` 會標明實際回傳的語系。對 `mapId` + `contentId` 組合 (每個 map 已固定為單一語系) 沒有作用 |
| `maxTokens` | number | 否 | 回應最大 token 數 100-50000 (預設: 5000) |
| `outputMode` | string | 否 | 輸出詳細程度: `"full"` 或 `"compact"`；compact 模式顯示約 500 token 預覽加上段落清單 (預設: `"full"`) |
| `responseFormat` | string | 否 | 輸出格式: `"markdown"` 或 `"json"` (預設: `"markdown"`) |

`maxTokens` 涵蓋每一種回應：整篇文章或單一段落、`summaryOnly` 大綱、找不到段落時的回應，以及說明請求如何解析的附註，全部計入 `tokenInfo.tokenCount`。內容超過 `maxTokens` 時會被截斷，並在放得下的範圍內列出剩餘段落及其 token 數。大綱、段落清單或子主題清單被截短時，會註明還有幾項沒列出，`truncated` 也會是 `true`。之後可以用 `section` 參數取得特定段落。

### jamf_docs_get_toc

取得 Jamf 產品文件的目錄結構，也可以取得任何單一出版品 (版本說明、技術文件、課程、
評估與設定指南) 的目錄。`product` 與 `publication` 必須恰好提供其中一個，兩者都給或
都不給都會回傳錯誤。(5.1 之前 `product` 為必填，也還沒有 `publication`。)

| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `product` | string | 擇一 | 產品 ID (詳見支援產品表) |
| `publication` | string | 擇一 | 單一出版品的 bundle family ID (1-200 字元)，例如 `jamf-pro-release-notes` 或 `technical-paper-laps`；可用 `jamf_docs_list_products` 查詢 |
| `version` | string | 否 | 特定版本 (例如 `"11.13.0"`) 或 `"current"` (預設: 最新版)，最長 50 個字元 |
| `language` | string | 否 | 文件語系 (預設: `en-US`)。Jamf 未以該語系發布的產品或出版品，會提供 en-US 版本，並附上 `localeNote` 說明 |
| `page` | number | 否 | 分頁頁碼 1-100 (預設: 1) |
| `maxTokens` | number | 否 | 回應最大 token 數 100-50000 (預設: 5000) |
| `outputMode` | string | 否 | 輸出詳細程度: `"full"` 或 `"compact"` (預設: `"full"`) |
| `responseFormat` | string | 否 | 輸出格式: `"markdown"` 或 `"json"` (預設: `"markdown"`) |

目錄依 `maxTokens` 分頁。每頁最多 10 個頂層項目，每個都包含其下所有子項目，放得下多少就放多少，下一頁從第一個放不下的項目開始。每個頂層項目都恰好出現在某一頁，但在第幾頁取決於 `maxTokens`（也取決於目錄本身，因此與 `version`、`language` 有關），所以翻頁時請維持這些參數不變。當 `maxTokens` 不是預設值時，markdown 頁尾會在下一個 `page` 旁註明 `maxTokens`；`structuredContent` 會回傳翻頁時該重送的參數：`productId` 或 `publicationId`、`version`、`language`（有指定時）與 `maxTokens`。MCP App 的「Show more」會全部重送。若某個頂層項目本身就超過 `maxTokens`，它會獨佔一頁，只列出其下放得下的項目。只有這種頁面的 `tokenInfo.truncated` 為 `true`，`truncatedEntry` 會說明列出了其中幾個項目，以及整個項目需要多少 token (`estimatedTokens`)；`outputMode: "full"` 的 markdown 會註明重新呼叫時該用多少 `maxTokens`。(`"compact"` 只列出頂層項目，所以這種截短不會藏起它原本會列出的內容。) 若 `maxTokens` 使頁數超過 `page` 可接受的上限 (100)，第 100 頁不會再提供下一頁，`paginationNote` 會註明能讀到其餘項目的 `maxTokens`。

### jamf_docs_batch_get_articles

一次取得多篇文件文章。每個 URL 平行取得，無效網域會以單篇錯誤回報，不影響整批結果。

| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `urls` | string[] | 是 | Jamf 文件 URL 陣列 (1-10 筆，網域限制同 `jamf_docs_get_article`，每筆最長 2,048 個字元) |
| `concurrency` | number | 否 | 最大平行請求數 1-5 (預設: 3) |
| `language` | string | 否 | 文件語系 (預設: 各網址本身的語系)。會覆寫每個網址中的語系。learn.jamf.com 上 Jamf 未以該語系發布的出版品，會回傳 en-US 版本；concepts.jamf.com、support.jamf.com 上沒有該語系版本的頁面，會回傳該網址所指的頁面；兩者皆附註說明，每筆結果的 `contentLocale` 會標明實際回傳的語系 |
| `maxTokens` | number | 否 | 所有文章的總 token 預算 100-50000 (預設: 5000) |
| `outputMode` | string | 否 | 每篇文章的輸出詳細程度: `"full"` 或 `"compact"` (預設: `"full"`) |
| `responseFormat` | string | 否 | 輸出格式: `"markdown"` 或 `"json"` (預設: `"markdown"`) |

### jamf_docs_glossary_lookup

查詢 Jamf 官方術語表，支援模糊比對。4 個字元以內的查詢會視為縮寫，必須與術語名稱中的完整單字相符，因此 `DEP` 不會比對到 `zero-touch deployment`。4 個字元的查詢可容許複數形、漏打一個字母或兩個字母前後對調（如 `MDMs`、`LDPA`）。目前術語表僅提供英文版，傳入非英文 `language` 仍會回傳英文結果。若以其他語言查詢，或術語以拉丁字母以外的文字（如中文）書寫，查無結果時回應也會說明這一點（JSON 為 `warning`）。

「No glossary entries found」表示已讀取術語表，但沒有符合的條目（使用 `responseFormat: "json"` 時，則是 `totalMatches: 0` 的 JSON 內容）。若有符合的條目，但連排在第一位的條目都超出 `maxTokens`，回應會說明符合的條目數，以及第一個條目所需的 `maxTokens`；`truncatedContent` 會列出每個被省略的條目及其估計 token 數。若無法讀取術語表（learn.jamf.com 無法連線、逾時或回應錯誤，或自訂的文件地圖清單來源 `MapsProvider` 失敗），工具會回傳錯誤（`isError: true`），說明是哪一步失敗，以及重試是否可能有幫助。若部分符合的條目無法取得，回應會以其餘條目作答並加以註明：`incomplete` 會列出可能缺少的條目。若其中有原本應排在回應第一位的條目（其名稱比所有已取得的條目都更貼近查詢術語），則改為回傳錯誤，不會以其他較不相關的條目代替作答。

| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `term` | string | 是 | 要查詢的術語 (2-100 字元) |
| `product` | string | 否 | 可傳入但不會篩選：Jamf 只提供一份全平台共用的術語表，未依產品分類 |
| `language` | string | 否 | 文件語系 (預設: `en-US`，術語表僅英文) |
| `maxTokens` | number | 否 | 回應最大 token 數 100-50000 (預設: 5000) |
| `outputMode` | string | 否 | 輸出詳細程度: `"full"` 或 `"compact"` (預設: `"full"`) |
| `responseFormat` | string | 否 | 輸出格式: `"markdown"` 或 `"json"` (預設: `"markdown"`) |

### jamf_docs_list_products

列出所有支援的 Jamf 產品、主題分類及文件類型。

| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `maxTokens` | number | 否 | 回應最大 token 數 100-50000 (預設: 10000，因為回傳的是完整的產品與出版品清單，所以比其他工具的 5000 高) |
| `outputMode` | string | 否 | 輸出詳細程度: `"full"` 或 `"compact"` (預設: `"full"`) |
| `responseFormat` | string | 否 | 輸出格式: `"markdown"` 或 `"json"` (預設: `"markdown"`) |

這是唯一沒有 `language` 參數的工具。所有工具的輸入 schema 都是嚴格模式，無法辨識的
參數會直接被拒絕 (`Unrecognized key: "language"`)，而不是默默忽略。

每個出版品的 `locales` 列出 Jamf 以哪些語系發布它。`jamf-support-*` 開頭的出版品，則是
support.jamf.com 首頁有列出它的語系。以其他任何語系呼叫 `jamf_docs_get_toc` 時，會提供
en-US 版本，並附上 `localeNote` 說明。

若有來源無法讀取，回應會列出能取得的部分並加以註明：`incomplete` 會列出每個無法讀取的
來源，Markdown 回應開頭也會有同樣的說明。`maps-registry` 指文件地圖清單（來自
learn.jamf.com，或自訂的 `MapsProvider`），出版品清單與產品版本都來自這裡，因此兩者
可能缺漏或改用內建的預設值。`jamf-support` 指 support.jamf.com，此時會缺少
`jamf-support-*` 開頭的出版品；若只有部分語系無法讀取，這些出版品仍會列出，但其 `locales`
不會包含那些語系。沒有 `incomplete` 表示所有來源都有回應。

## MCP Resources

無需呼叫工具即可存取的參考資料：

| Resource | URI | 說明 |
|----------|-----|------|
| Jamf Products List | `jamf://products` | 所有支援產品的清單與版本資訊，從 API 動態取得 |
| Jamf Documentation Topics | `jamf://topics` | 搜尋過濾用的主題分類 |
| Product Table of Contents | `jamf://products/{productId}/toc` | 特定產品目前版本文件的完整目錄結構 (範本資源，詳見下方) |
| Product Documentation Versions | `jamf://products/{productId}/versions` | 特定產品的可用文件版本清單 (範本資源) |

範本資源 (`jamf://products/{productId}/toc` 與 `jamf://products/{productId}/versions`) 支援 MCP 自動補全：輸入 `{productId}` 時會提供所有有效產品 ID 的建議選項。超過 100 個字元的 `productId` 會以參數無效 (invalid params) 拒絕；不是任何產品的 `productId` 則會回傳說明此事並列出所有產品 ID 的內容。

`jamf://products/{productId}/toc` 包含該產品目前版本 en-US 文件的完整目錄，巢狀結構與 `jamf_docs_get_toc` 的 JSON 回應相同，上限為 20000 token (與該工具計算 `maxTokens` 的方式相同，只計算項目標題)。這是標題的上限，不是 JSON 的大小；JSON 還包含每個項目的 URL 與 ID。2026-09-28 量測時所有產品都在上限內：最大的 Jamf Pro 約 8,400 token (794 個項目，JSON 為 267 KB)。`complete` 表示 `toc` 是否為完整目錄；若不完整，`shownEntries` 為其中的項目數，`missing` 會說明缺少哪些項目，以及在 `jamf_docs_get_toc` 能取得時該如何呼叫。`mapId` 是這些項目所屬的 map，與項目的 `contentId` 組成 `jamf_docs_get_article` 取得該項目文章所用的 `mapId` + `contentId`。每個 map 已固定為單一版本與單一語系，因此不需另外指定版本或語系。無法確定這些項目屬於哪一個 map 時不會有 `mapId`，此時仍可用各項目的 `url` 取得文章。

## MCP Prompts

內建提示範本，引導 AI 執行常見的 Jamf 文件查詢工作流程：

### jamf_troubleshoot

引導 AI 使用官方文件進行 Jamf 問題排查。

| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `problem` | string | 是 | 問題描述 (最多 2000 字元) |
| `product` | string | 否 | Jamf 產品 ID (支援自動補全，最多 100 字元) |

執行步驟：搜尋相關文件 → 以 `summaryOnly` 快速評估相關性 → 深入閱讀解決方案 → 提供根本原因分析與逐步解決方案。

### jamf_setup_guide

根據官方文件產生 Jamf 功能的逐步設定指南。

| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `feature` | string | 是 | 要設定的功能或能力 (最多 2000 字元) |
| `product` | string | 否 | Jamf 產品 ID (支援自動補全，最多 100 字元) |

執行步驟：搜尋設定文件 → 找到主要設定文章 → 擷取詳細步驟 → 整理成含前置需求、設定步驟、驗證方法的完整指南。

### jamf_compare_versions

比較 Jamf 產品兩個版本之間的文件差異。

| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `product` | string | 是 | Jamf 產品 ID (支援自動補全，最多 100 字元) |
| `version_a` | string | 是 | 第一個比較版本 (例如 `"11.13.0"`，最多 50 字元) |
| `version_b` | string | 是 | 第二個比較版本 (例如 `"11.32.0"`，最多 50 字元) |

執行步驟：取得兩個版本的目錄 → 識別結構差異 → 審閱關鍵變更文章 → 彙整新增功能、移除功能及遷移注意事項。

## 主要功能

- **精簡模式**：使用 `outputMode: "compact"` 取得節省 token 的簡潔回應；文章會顯示約 500 token 預覽加上可用段落清單
- **摘要預覽**：使用 `summaryOnly: true` 預覽文章大綱，再決定是否取得完整內容
- **批次取得**：使用 `jamf_docs_batch_get_articles` 一次取得最多 10 篇文章
- **術語查詢**：使用 `jamf_docs_glossary_lookup` 模糊比對 Jamf 官方術語
- **多語系支援**：除 `jamf_docs_list_products` 外，所有工具皆支援 `language` 參數切換文件語系：`en-US` (預設)、`ja-JP`、`zh-TW`、`de-DE`、`es-ES`、`fr-FR`、`nl-NL`、`th-TH`、`it-IT`、`pt-BR`、`zh-CN`
- **版本查詢**：使用 `version` 參數查詢特定產品版本的文件
- **搜尋建議**：搜尋無結果時提供替代關鍵字與主題建議
- **分頁支援**：大型搜尋結果與目錄支援分頁瀏覽
- **自動補全**：產品、主題、版本參數支援 MCP 自動補全

## MCP Apps (互動式檢視器)

支援 MCP Apps 擴充 (`io.modelcontextprotocol/ui`) 的 host，會把
`jamf_docs_search`、`jamf_docs_get_toc`、`jamf_docs_get_article` 的結果渲染成互動式
檢視器，而不是純 markdown：搜尋結果可直接點進文章、目錄項目就地開啟、文章帶有段落
導覽與返回堆疊。三個工具共用同一份自包含的 `ui://jamf-docs/app.html` 資源。不支援此
擴充的 host 會忽略相關 metadata，拿到的就是原本的 markdown。

> [!WARNING]
> **4.0.0 的 MCP Apps 檢視器無法使用，請升級。** 把 UI bundle 內嵌進 HTML 文件的建置
> 步驟使用了 replacement string，導致壓縮後 JavaScript 中的每個 `$` 樣式被展開而非
> 原樣複製。實際發佈的文件不是合法的 JavaScript，host 渲染時會得到
> `SyntaxError: missing ) after argument list` 與一片空白。4.0.0 的其他部分不受影響
> ——工具、resources 與 prompts 的結果完全相同，因為無法渲染 app 的 host 會退回
> markdown。已於 4.0.1 修正。

## 環境變數

可選的環境變數設定。設定為空值或只有空白字元時，視同未設定。數值設定必須是有效範圍內的
整數，其他值會被忽略，在 stderr 輸出警告並改用預設值。

### 快取設定

| 變數 | 說明 | 預設值 | 有效範圍 |
|------|------|--------|----------|
| `CACHE_DIR` | 快取目錄路徑。必須是專供此快取使用的目錄，見下方說明 | `.cache` | 相對或絕對路徑 |
| `CACHE_TTL_SEARCH` | 搜尋結果快取時間 (ms) | `1800000` (30 分鐘) | 1 分鐘 - 30 天 |
| `CACHE_TTL_ARTICLE` | 文章、術語表與各 map 主題索引的快取時間 (ms)，見下方說明 | `86400000` (24 小時) | 1 分鐘 - 30 天 |
| `CACHE_TTL_PRODUCTS` | 產品清單的快取時間 (ms)：產品與版本清單所依據的 map 清單、support.jamf.com 的 collection 清單，以及 concepts.jamf.com 與 support.jamf.com 的搜尋索引，見下方說明 | `604800000` (7 天) | 1 分鐘 - 30 天 |
| `CACHE_TTL_TOC` | 任何來源的目錄，以及 `navigation` 所依據的 map TOC 索引的快取時間 (ms)，見下方說明 | `86400000` (24 小時) | 1 分鐘 - 30 天 |
| `CACHE_MAX_ENTRIES` | 快取最大項目數 | `500` | 10 - 10000 |

`CACHE_DIR` 必須是專供此快取使用的目錄。伺服器會把快取項目寫成
`<hash>.json`，每次啟動都會刪除其中已過期或無法讀取的項目。其他名稱的檔案不會被
動到，但仍請不要指向專案根目錄或其他工具也在用的目錄。

- 相對路徑（包括預設的 `.cache`）以伺服器的工作目錄為基準解析，而且必須位於該目錄
  之內。如果 host 從 `/` 啟動伺服器，請設定絕對路徑的 `CACHE_DIR`：在 macOS 上
  無法建立 `/.cache`，快取完全寫不進磁碟。
- 位於 `/etc`、`/usr`、`/var`、`/sys`、`/proc`、`/dev`、`/sbin` 或 `/bin` 之下的
  路徑會被拒絕，相對路徑和絕對路徑都一樣。判斷前會先解析符號連結，所以在 macOS 上
  `/private/etc/…` 和 `/etc/…` 一樣會被拒絕。`CACHE_DIR` 未設定或為空白時不做這項
  檢查。
- 使用者的家目錄和伺服器的暫存目錄（`TMPDIR`）即使位於上述目錄之下也允許使用。在
  macOS 上，使用者專屬的暫存目錄（位於 `/private/var/folders` 之下）也允許使用，
  即使 host 沒有把 `TMPDIR` 傳給伺服器（MCP SDK 的 stdio client 就不會傳）。在
  Fedora Silverblue 等 ostree 系統上，`/home` 是指向 `/var/home` 的連結。
- 被拒絕的值會改用 `.cache`，並在 stderr 輸出一行警告。`.cache` 同樣以工作目錄為
  基準解析，所以工作目錄本身位於系統目錄之下時，改用的 `.cache` 也會在那裡。

各快取時間涵蓋的範圍：

- `CACHE_TTL_SEARCH`：`jamf_docs_search` 從 learn.jamf.com 取得的搜尋結果。
- `CACHE_TTL_ARTICLE`：`jamf_docs_get_article` 與 `jamf_docs_batch_get_articles`
  取得的每一篇文章（不論來源），連同取得時建立的 breadcrumb 與內部連結；術語表的
  詞條清單與定義；learn.jamf.com 各 map 用來解析頁面 URL 的主題索引；以及
  `jamf://topics` 清單。
- `CACHE_TTL_PRODUCTS`：learn.jamf.com 的 map 清單（產品、版本與出版品每次呼叫都由此
  讀出，因此 `jamf_docs_list_products` 與 `jamf://products` 列出的產品與版本不會比它舊）；
  support.jamf.com 的 collection 清單；以及 `jamf_docs_search` 搜尋 concepts.jamf.com
  與 support.jamf.com 時使用的標題索引。map 清單的存放時間從取得時起算，稍後啟動、
  從快取讀取它的伺服器也一樣。若建立標題索引時，列出其標題的頁面有無法讀取者，
  該索引只保存一分鐘。
- `CACHE_TTL_TOC`：`jamf_docs_get_toc` 與 `jamf://products/{productId}/toc` 提供的
  每一份目錄，不論是從 learn.jamf.com 的 map、concepts.jamf.com 的 sitemap，還是
  support.jamf.com 的 collection 頁面讀出；concepts.jamf.com 各區段索引頁列出的標題
  （其目錄與標題索引所用）；以及文章 `navigation` 所依據的 map TOC 索引。術語表的
  詞條清單雖然也是從 map 的目錄讀出，但隨術語表沿用 `CACHE_TTL_ARTICLE`。

support.jamf.com 的 collection 頁面只會為兩種用途請求一次：`jamf_docs_get_article`
與目錄或標題索引，誰先讀取該頁面，就會一併保存另一方從中讀取的內容，各自沿用自己的
快取時間。

文章的 breadcrumb 與內部連結是在取得文章時由 map TOC 索引建立，隨文章保存
`CACHE_TTL_ARTICLE` 的時間；`navigation` 則每次呼叫都從索引讀取。因此
`CACHE_TTL_TOC` 比 `CACHE_TTL_ARTICLE` 短時，同一個回應中的 breadcrumb 可能比
`navigation` 舊。

6.0.12 及更早的版本不會讀取 `CACHE_TTL_TOC`。在 6.0.12 中，Fluid Topics 的目錄與
map TOC 索引沿用 `CACHE_TTL_ARTICLE`，concepts.jamf.com 與 support.jamf.com 的目錄
則沿用 `CACHE_TTL_PRODUCTS`，預設為 7 天，現在是 24 小時。`jamf_docs_list_products`
列出的產品與版本原本與 map 清單分開快取，沿用 `CACHE_TTL_ARTICLE`，因此 Jamf 新發布
的版本可能先出現在 `publications`，最多 24 小時後才出現在 `products`。從快取讀取 map
清單的伺服器，會從讀取時起算 `CACHE_TTL_PRODUCTS`，而不是從清單取得時起算，因此
提供的清單最舊可達該時間的兩倍。

### 請求設定

套用於每一個對文件來源的對外請求。

| 變數 | 說明 | 預設值 | 有效範圍 |
|------|------|--------|----------|
| `REQUEST_TIMEOUT` | 單次嘗試的 HTTP 逾時 (ms) | `15000` | 1 秒 - 60 秒 |
| `MAX_RETRIES` | 首次之後的重試次數。僅重試 429、 5xx、網路錯誤與逾時，採指數退避並尊重 `Retry-After`。`0` 表示不重試 | `0` | 0 - 10 |
| `RETRY_DELAY` | 重試退避的基準時間 (ms)。`MAX_RETRIES` 為 `0` 時無作用 | `1000` | 100ms - 30 秒 |
| `RATE_LIMIT_DELAY` | 對外請求 (含重試) 的最小間隔 (ms)。`0` 讓平行抓取維持平行 | `0` | 0 - 10 秒 |
| `USER_AGENT` | 每個請求都會送出，讓 Jamf 能辨識這個 client。HTTP 標頭無法承載超過 U+00FF 的字元，也無法承載 tab 以外的控制字元。換行字元會被移除；含有其他這類字元的值會被忽略，在 stderr 輸出警告並改用預設值 | `jamf-docs-mcp-server/<version> (+<repo url>)` | Latin-1 字串 |

### HTTP 傳輸設定

| 變數 | 說明 | 預設值 | 有效範圍 |
|------|------|--------|----------|
| `RATE_LIMIT_RPM` | HTTP 模式每 IP 每分鐘請求上限 | `60` | 1 - 10000 |
| `CORS_ALLOWED_ORIGINS` | CORS 允許的來源 (逗號分隔) | `""` (停用 CORS) | 逗號分隔的 URL 列表 |
| `TRUST_PROXY` | 改以 `X-Forwarded-For` 最右側的位址作為每 IP 速率限制的客戶端 IP，而非連線來源位址。僅限在反向代理後方啟用，詳見下方說明 | 關閉 | `true` 或 `1` |

`RATE_LIMIT_RPM` 的「每 IP」預設指的是 TCP 連線的來源位址。放在反向代理後方時，所有
請求都來自代理，所有客戶端會共用同一份額度，一個忙碌的客戶端就會拖累所有人。設定
`TRUST_PROXY=true` (或 `1`) 後，改從 `X-Forwarded-For` 取得客戶端位址；只有這兩個值
會啟用，`TRUE`、`yes` 或其他任何值都視為關閉。啟用後：

- 取**最右側**的項目，也就是緊鄰伺服器的那一層代理所附加的位址。左側的項目是客戶端
  自行送出的內容、可以偽造，因此不採用。這只適用於恰好一層代理；若有兩層 (例如 nginx
  前面還有 CDN)，最右側會是外層代理的位址，經由它連入的客戶端又會共用同一份額度。
- 請求沒有 `X-Forwarded-For` 時，退回使用連線來源位址。本伺服器不讀取 `X-Real-IP` 與
  `Forwarded`，代理必須送出 `X-Forwarded-For`，這項設定才會生效。
- 這個位址只用於速率限制，沒有其他用途。

客戶端直接連到伺服器時請保持關閉：若前面沒有代理卻啟用，客戶端可以自行填入任意
`X-Forwarded-For`，每次請求都拿到全新的額度，速率限制形同虛設。

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
npm test               # 送 PR 前的完整檢查：unit + integration + e2e
npm run test:unit      # 單元測試（封閉環境，不連外）
npm run test:integration  # 整合測試（連線真實 Jamf API）
npm run test:contract  # 上游契約套件，由 upstream-contract.yml 排程執行，不納入合併閘門
npm run test:e2e       # E2E 測試（連線真實 Jamf API）
npm run test:all       # 全部，含契約套件
npm run test:coverage  # 單元測試覆蓋率，與 CI 回報的一致
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
