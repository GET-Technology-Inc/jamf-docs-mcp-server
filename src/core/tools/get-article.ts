/**
 * jamf_docs_get_article tool
 * Retrieve the full content of a specific Jamf documentation article.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerContext } from '../types/context.js';
import { GetArticleInputSchema } from '../schemas/index.js';
import { reportProgress } from '../utils/progress.js';
import { ArticleOutputSchema } from '../schemas/output.js';
import { ResponseFormat, OutputMode, TOKEN_CONFIG, type LocaleId } from '../constants.js';
import type { ToolResult, ArticleResponse, FetchArticleOptions } from '../types.js';
import { getSafeErrorMessage } from '../utils/sanitize.js';
import { resolveAndFetchArticle } from '../services/article-service.js';
import { formatArticleCompact, formatArticleFull } from '../utils/format-article.js';

const TOOL_NAME = 'jamf_docs_get_article';

const TOOL_DESCRIPTION = `Retrieve the full content of a specific Jamf documentation article.

This tool fetches and parses a Jamf documentation article, converting it to
a clean, readable format. Works with any article from docs.jamf.com or learn.jamf.com.

Args:
  - url (string, required): Full URL of the article (must be from docs.jamf.com or learn.jamf.com)
  - section (string, optional): Extract only a specific section by title or ID (e.g., "Prerequisites", "Configuration")
  - summaryOnly (boolean, optional): Return only article summary and outline instead of full content (default: false). Token-efficient way to preview an article
  - includeRelated (boolean, optional): Include links to related articles (default: false)
  - maxTokens (number, optional): Maximum tokens in response 100-50000 (default: 5000)
  - outputMode ('full' | 'compact'): Output detail level (default: 'full'). Use 'compact' for brief output
  - responseFormat ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  For JSON format:
  {
    "title": string,
    "content": string,
    "url": string,
    "product": string,
    "version": string,
    "breadcrumb": string[],
    "relatedArticles": [...],
    "tokenInfo": {
      "tokenCount": number,
      "truncated": boolean,
      "maxTokens": number
    },
    "sections": [
      {
        "id": string,
        "title": string,
        "level": number,
        "tokenCount": number
      }
    ]
  }

  For Markdown format:
  The article content with token info and available sections.

Examples:
  - Get full article: url="https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/Configuration_Profiles.html"
  - Get specific section: url="...", section="Prerequisites"
  - Limit response size: url="...", maxTokens=2000

Errors:
  - "Article not found (404)" if the URL returns a 404 error
  - "Invalid URL" if the URL is not from docs.jamf.com or learn.jamf.com
  - "Section not found" if the specified section doesn't exist (will list available sections)

Note: Large articles are intelligently truncated with remaining sections listed.
Use the \`section\` parameter to retrieve specific sections for long articles.`;

export function registerGetArticleTool(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: 'Get Jamf Documentation Article',
      description: TOOL_DESCRIPTION,
      inputSchema: GetArticleInputSchema,
      outputSchema: ArticleOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (args, extra): Promise<ToolResult> => {
      // Parse and validate input
      const parseResult = GetArticleInputSchema.safeParse(args);
      if (!parseResult.success) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Invalid input: ${parseResult.error.message}` }]
        };
      }
      const params = parseResult.data;

      try {
        await reportProgress(extra, { progress: 0, total: 4, message: 'Fetching article...' });

        // Validate: either url or (mapId + contentId) must be provided
        const articleUrl = params.url ?? '';
        if (articleUrl === '' && (params.mapId === undefined || params.contentId === undefined)) {
          return {
            isError: true,
            content: [{ type: 'text', text: 'Either url or both mapId and contentId must be provided.' }]
          };
        }

        const options: FetchArticleOptions = {
          includeRelated: params.includeRelated,
          summaryOnly: params.summaryOnly,
          ...(params.section !== undefined && { section: params.section }),
          maxTokens: params.maxTokens ?? TOKEN_CONFIG.DEFAULT_MAX_TOKENS,
          locale: params.language as LocaleId | undefined,
        };

        const article = await resolveAndFetchArticle(
          ctx,
          {
            url: articleUrl,
            ...(params.mapId !== undefined && { mapId: params.mapId }),
            ...(params.contentId !== undefined && { contentId: params.contentId }),
          },
          options
        );

        await reportProgress(extra, { progress: 2, total: 4, message: 'Processing content...' });

        const { tokenInfo, sections } = article;

        await reportProgress(extra, { progress: 3, total: 4, message: 'Formatting output...' });

        // Build response
        const response: ArticleResponse = {
          ...article,
          format: params.responseFormat,
          tokenInfo,
          sections
        };

        const structuredContent = {
          title: article.title,
          url: article.url,
          content: article.content,
          ...(article.product !== undefined ? { product: article.product } : {}),
          ...(article.version !== undefined ? { version: article.version } : {}),
          ...(article.lastUpdated !== undefined ? { lastUpdated: article.lastUpdated } : {}),
          ...(article.breadcrumb !== undefined ? { breadcrumb: article.breadcrumb } : {}),
          ...(article.mapId !== undefined ? { mapId: article.mapId } : {}),
          ...(article.contentId !== undefined ? { contentId: article.contentId } : {}),
          sections: sections.map(s => ({
            id: s.id,
            title: s.title,
            level: s.level,
            tokenCount: s.tokenCount
          })),
          truncated: tokenInfo.truncated
        };

        if (params.responseFormat === ResponseFormat.JSON) {
          await reportProgress(extra, { progress: 4, total: 4 });
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(response, null, 2)
            }],
            structuredContent
          };
        }

        // Markdown format (full or compact)
        const markdown = params.outputMode === OutputMode.COMPACT
          ? formatArticleCompact(article)
          : formatArticleFull(article, {
              breadcrumb: article.breadcrumb,
              lastUpdated: article.lastUpdated,
              section: params.section,
              sections,
              relatedArticles: params.includeRelated
                ? article.relatedArticles
                : undefined,
            });

        await reportProgress(extra, { progress: 4, total: 4 });
        return {
          content: [{
            type: 'text',
            text: markdown
          }],
          structuredContent
        };
      } catch (error) {
        const errorMessage = getSafeErrorMessage(error);

        // Provide helpful error messages
        let helpText = '';
        if (errorMessage.includes('404')) {
          helpText = '\n\nThe article may have been moved or deleted. Try searching with `jamf_docs_search` to find the current URL.';
        } else if (errorMessage.includes('rate limit')) {
          helpText = '\n\nPlease wait a moment and try again.';
        }

        return {
          isError: true,
          content: [{
            type: 'text',
            text: `Error fetching article: ${errorMessage}${helpText}`
          }]
        };
      }
    }
  );
}
