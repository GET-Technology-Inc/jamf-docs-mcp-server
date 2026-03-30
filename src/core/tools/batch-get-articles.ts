/**
 * jamf_docs_batch_get_articles tool
 * Retrieve multiple Jamf documentation articles in a single request.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerContext } from '../types/context.js';
import { GetBatchArticlesInputSchema } from '../schemas/index.js';
import { BatchArticlesOutputSchema } from '../schemas/output.js';
import { reportProgress } from '../utils/progress.js';
import { ResponseFormat, OutputMode, TOKEN_CONFIG, type LocaleId } from '../constants.js';
import type { ToolResult, TokenInfo } from '../types.js';
import { fetchArticle, type FetchArticleResult } from '../services/scraper.js';
import { sanitizeMarkdownText, sanitizeMarkdownUrl, getSafeErrorMessage } from '../utils/sanitize.js';

// ============================================================================
// Types
// ============================================================================

interface FetchSuccess {
  status: 'success';
  url: string;
  article: FetchArticleResult;
}

interface FetchError {
  status: 'error';
  url: string;
  error: string;
}

type FetchResult = FetchSuccess | FetchError;

interface BatchSummary {
  total: number;
  succeeded: number;
  failed: number;
}

import { limitConcurrency } from '../utils/concurrency.js';
export { limitConcurrency };

// ============================================================================
// Token budget
// ============================================================================

/**
 * Distribute token budget evenly across articles.
 * Each article gets at least MIN_TOKENS.
 */
export function distributeTokenBudget(totalTokens: number, count: number): number {
  const perArticle = Math.floor(totalTokens / count);
  return Math.max(perArticle, TOKEN_CONFIG.MIN_TOKENS);
}

// ============================================================================
// Formatting helpers
// ============================================================================

function formatArticleFull(article: FetchArticleResult): string {
  let md = `# ${article.title}\n\n`;

  const meta: string[] = [];
  if (article.product !== undefined && article.product !== '') {
    meta.push(`**Product**: ${article.product}`);
  }
  if (article.version !== undefined && article.version !== '') {
    meta.push(`**Version**: ${article.version}`);
  }
  meta.push(
    `**Tokens**: ${article.tokenInfo.tokenCount.toLocaleString()}/${article.tokenInfo.maxTokens.toLocaleString()}`
  );
  if (article.tokenInfo.truncated) {
    meta.push('*(truncated)*');
  }
  if (meta.length > 0) {
    md += `${meta.join(' | ')}\n\n`;
  }

  md += '---\n\n';
  md += article.content;

  const safeUrl = sanitizeMarkdownUrl(article.url);
  md += `\n\n---\n*Source: [${sanitizeMarkdownText(article.url)}](${safeUrl})*\n`;

  return md;
}

function formatArticleCompact(article: FetchArticleResult): string {
  let md = `# ${article.title}\n\n`;

  const meta: string[] = [];
  if (article.product !== undefined && article.product !== '') {
    meta.push(article.product);
  }
  if (article.version !== undefined && article.version !== '') {
    meta.push(`v${article.version}`);
  }
  if (meta.length > 0) {
    md += `*${meta.join(' | ')}*\n\n`;
  }

  md += article.content;

  const safeUrl = sanitizeMarkdownUrl(article.url);
  md += `\n---\n*[Source](${safeUrl}) | ${article.tokenInfo.tokenCount} tokens${article.tokenInfo.truncated ? ' (truncated)' : ''}*\n`;

  return md;
}

function formatBatchAsMarkdown(results: FetchResult[], compact: boolean): string {
  const parts: string[] = [];

  for (const result of results) {
    if (result.status === 'success') {
      parts.push(compact ? formatArticleCompact(result.article) : formatArticleFull(result.article));
    } else {
      parts.push(`# Error\n\n**URL**: ${result.url}\n**Error**: ${result.error}\n`);
    }
  }

  return parts.join('\n\n---\n\n');
}

// ============================================================================
// Tool registration
// ============================================================================

const TOOL_NAME = 'jamf_docs_batch_get_articles';

const TOOL_DESCRIPTION = `Retrieve multiple Jamf documentation articles in a single request.

Fetches up to 10 articles in parallel with concurrency control. Useful for
comparing articles, gathering information from multiple pages, or bulk research.

Args:
  - urls (string[], required): Array of 1-10 article URLs (must be from docs.jamf.com or learn.jamf.com)
  - concurrency (number, optional): Max parallel requests 1-5 (default: 3)
  - maxTokens (number, optional): Total token budget across all articles (default: 5000). Distributed evenly.
  - outputMode ('full' | 'compact'): Output detail level (default: 'full'). Use 'compact' for brief output.
  - responseFormat ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  An array of article results. Each article independently succeeds or fails.
  For JSON format, returns a BatchResponse object with results, summary, and tokenInfo.

Examples:
  - Compare two products: urls=["https://learn.jamf.com/.../page/A.html", "https://learn.jamf.com/.../page/B.html"]
  - Bulk fetch with compact output: urls=[...], outputMode="compact", maxTokens=10000

Note: Token budget is split evenly across articles. Use higher maxTokens for more articles.
Partial failures are reported per-article without failing the entire batch.`;

export function registerBatchGetArticlesTool(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: 'Batch Get Jamf Documentation Articles',
      description: TOOL_DESCRIPTION,
      inputSchema: GetBatchArticlesInputSchema,
      outputSchema: BatchArticlesOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (args, extra): Promise<ToolResult> => {
      const parseResult = GetBatchArticlesInputSchema.safeParse(args);
      if (!parseResult.success) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Invalid input: ${parseResult.error.message}` }]
        };
      }
      const params = parseResult.data;

      const totalMaxTokens = params.maxTokens ?? TOKEN_CONFIG.DEFAULT_MAX_TOKENS;
      const perArticleTokens = distributeTokenBudget(totalMaxTokens, params.urls.length);
      const compact = params.outputMode === OutputMode.COMPACT;

      await reportProgress(extra, { progress: 0, total: params.urls.length, message: 'Starting batch fetch...' });

      let completedCount = 0;

      // Build fetch tasks — each task catches its own errors
      const tasks = params.urls.map((url) => {
        return async (): Promise<FetchResult> => {
          try {
            const article = await fetchArticle(ctx, url, {
              maxTokens: perArticleTokens,
              locale: params.language as LocaleId | undefined
            });

            completedCount++;
            await reportProgress(extra, { progress: completedCount, total: params.urls.length, message: `Fetched ${String(completedCount)}/${String(params.urls.length)} articles...` });

            return { status: 'success', url: article.url, article };
          } catch (error) {
            completedCount++;
            await reportProgress(extra, { progress: completedCount, total: params.urls.length, message: `Fetched ${String(completedCount)}/${String(params.urls.length)} articles...` });

            return { status: 'error', url, error: getSafeErrorMessage(error) };
          }
        };
      });

      // Execute with concurrency control
      const results = await limitConcurrency(tasks, params.concurrency);

      // Build summary
      const succeeded = results.filter((r) => r.status === 'success').length;
      const failed = results.length - succeeded;
      const summary: BatchSummary = {
        total: results.length,
        succeeded,
        failed
      };

      // Calculate overall token info
      let totalTokenCount = 0;
      let anyTruncated = false;
      for (const r of results) {
        if (r.status === 'success') {
          totalTokenCount += r.article.tokenInfo.tokenCount;
          if (r.article.tokenInfo.truncated) {
            anyTruncated = true;
          }
        }
      }
      const overallTokenInfo: TokenInfo = {
        tokenCount: totalTokenCount,
        truncated: anyTruncated,
        maxTokens: totalMaxTokens
      };

      // Build structuredContent for MCP outputSchema
      const structuredContent = {
        results: results.map((r) => {
          if (r.status === 'success') {
            return {
              url: r.url,
              status: 'success' as const,
              title: r.article.title,
              content: r.article.content,
              tokenCount: r.article.tokenInfo.tokenCount,
              truncated: r.article.tokenInfo.truncated
            };
          }
          return {
            url: r.url,
            status: 'error' as const,
            error: r.error
          };
        }),
        summary
      };

      // All failed → isError
      const isError = succeeded === 0;

      if (params.responseFormat === ResponseFormat.JSON) {
        const jsonResponse = {
          results: results.map((r) => {
            if (r.status === 'success') {
              return {
                url: r.url,
                status: 'success',
                title: r.article.title,
                content: r.article.content,
                tokenInfo: r.article.tokenInfo
              };
            }
            return { url: r.url, status: 'error', error: r.error };
          }),
          summary,
          tokenInfo: overallTokenInfo
        };
        return {
          isError,
          content: [{ type: 'text', text: JSON.stringify(jsonResponse, null, 2) }],
          structuredContent
        };
      }

      // Markdown format
      let markdown = formatBatchAsMarkdown(results, compact);

      // Append summary footer
      markdown += `\n\n---\n\n**Batch Summary**: ${String(succeeded)}/${String(results.length)} articles retrieved`;
      if (failed > 0) {
        markdown += ` (${String(failed)} failed)`;
      }
      markdown += ` | ${overallTokenInfo.tokenCount.toLocaleString()} tokens`;
      if (overallTokenInfo.truncated) {
        markdown += ' *(some articles truncated)*';
      }
      markdown += '\n';

      return {
        isError,
        content: [{ type: 'text', text: markdown }],
        structuredContent
      };
    }
  );
}
