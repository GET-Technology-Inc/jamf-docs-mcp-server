/**
 * jamf_docs_get_article tool
 * Retrieve the full content of a specific Jamf documentation article.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GetArticleInputSchema } from '../schemas/index.js';
import { ResponseFormat, TOKEN_CONFIG } from '../constants.js';
import type { ToolResult, ArticleResponse } from '../types.js';
import { fetchArticle } from '../services/scraper.js';

const TOOL_NAME = 'jamf_docs_get_article';

const TOOL_DESCRIPTION = `Retrieve the full content of a specific Jamf documentation article.

This tool fetches and parses a Jamf documentation article, converting it to
a clean, readable format. Works with any article from docs.jamf.com or learn.jamf.com.

Args:
  - url (string, required): Full URL of the article (must be from docs.jamf.com or learn.jamf.com)
  - section (string, optional): Extract only a specific section by title or ID (e.g., "Prerequisites", "Configuration")
  - includeRelated (boolean, optional): Include links to related articles (default: false)
  - maxTokens (number, optional): Maximum tokens in response 100-20000 (default: 5000)
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

export function registerGetArticleTool(server: McpServer): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: 'Get Jamf Documentation Article',
      description: TOOL_DESCRIPTION,
      inputSchema: GetArticleInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (args): Promise<ToolResult> => {
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
        // Fetch and parse the article with new options
        const article = await fetchArticle(params.url, {
          includeRelated: params.includeRelated,
          ...(params.section && { section: params.section }),
          maxTokens: params.maxTokens ?? TOKEN_CONFIG.DEFAULT_MAX_TOKENS
        });

        const { tokenInfo, sections } = article;

        // Build response
        const response: ArticleResponse = {
          ...article,
          format: params.responseFormat,
          tokenInfo,
          sections
        };

        // Format output
        if (params.responseFormat === ResponseFormat.JSON) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(response, null, 2)
            }]
          };
        }

        // Markdown format with Context7 style
        let markdown = '';

        // Breadcrumb
        if (article.breadcrumb && article.breadcrumb.length > 0) {
          markdown += `*${article.breadcrumb.join(' > ')}*\n\n`;
        }

        // Title with token info
        markdown += `# ${article.title}\n\n`;

        // Metadata including token info
        const meta: string[] = [];
        if (article.product) {meta.push(`**Product**: ${article.product}`);}
        if (article.version) {meta.push(`**Version**: ${article.version}`);}
        if (article.lastUpdated) {meta.push(`**Last Updated**: ${article.lastUpdated}`);}
        meta.push(`**Tokens**: ${tokenInfo.tokenCount.toLocaleString()}/${tokenInfo.maxTokens.toLocaleString()}`);
        if (tokenInfo.truncated) {meta.push('*(truncated)*');}

        if (meta.length > 0) {
          markdown += `${meta.join(' | ')}\n\n`;
        }

        // Section filter note
        if (params.section) {
          markdown += `*Showing section: "${params.section}"*\n\n`;
        }

        markdown += '---\n\n';

        // Content
        markdown += article.content;

        // Sections list (if not filtered to a specific section and there are sections)
        if (!params.section && sections.length > 0 && tokenInfo.truncated) {
          markdown += '\n\n---\n\n';
          markdown += '## Available Sections\n\n';
          for (const section of sections.slice(0, 15)) {
            const indent = '  '.repeat(Math.max(0, section.level - 1));
            markdown += `${indent}- **${section.title}** (~${section.tokenCount} tokens)\n`;
          }
          if (sections.length > 15) {
            markdown += `\n*...and ${sections.length - 15} more sections*\n`;
          }
          markdown += '\n*Use `section` parameter to retrieve a specific section.*\n';
        }

        // Related articles
        if (params.includeRelated && article.relatedArticles && article.relatedArticles.length > 0) {
          markdown += '\n\n---\n\n';
          markdown += '## Related Articles\n\n';
          for (const related of article.relatedArticles) {
            markdown += `- [${related.title}](${related.url})\n`;
          }
        }

        // Source link and token summary
        markdown += '\n\n---\n\n';
        markdown += `*Source: [${article.url}](${article.url})*\n`;
        markdown += `*${tokenInfo.tokenCount.toLocaleString()} tokens`;
        if (tokenInfo.truncated) {
          markdown += ` (truncated from original, max: ${tokenInfo.maxTokens.toLocaleString()})`;
        }
        markdown += '*\n';

        return {
          content: [{
            type: 'text',
            text: markdown
          }]
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';

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
