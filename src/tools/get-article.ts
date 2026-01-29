/**
 * jamf_docs_get_article tool
 * Retrieve the full content of a specific Jamf documentation article.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GetArticleInputSchema } from '../schemas/index.js';
import { ResponseFormat, OutputMode, TOKEN_CONFIG } from '../constants.js';
import type { ToolResult, ArticleResponse, ArticleSection, TokenInfo } from '../types.js';
import { fetchArticle, type FetchArticleResult } from '../services/scraper.js';

interface FormatOptions {
  section?: string | undefined;
  includeRelated?: boolean | undefined;
  outputMode?: 'full' | 'compact' | undefined;
}

interface RelatedArticle {
  title: string;
  url: string;
}

function formatBreadcrumb(breadcrumb: string[] | undefined): string {
  if (breadcrumb === undefined || breadcrumb.length === 0) {
    return '';
  }
  return `*${breadcrumb.join(' > ')}*\n\n`;
}

function formatMetadata(
  product: string | undefined,
  version: string | undefined,
  lastUpdated: string | undefined,
  tokenInfo: TokenInfo
): string {
  const meta: string[] = [];
  if (product !== undefined && product !== '') {
    meta.push(`**Product**: ${product}`);
  }
  if (version !== undefined && version !== '') {
    meta.push(`**Version**: ${version}`);
  }
  if (lastUpdated !== undefined && lastUpdated !== '') {
    meta.push(`**Last Updated**: ${lastUpdated}`);
  }
  meta.push(`**Tokens**: ${tokenInfo.tokenCount.toLocaleString()}/${tokenInfo.maxTokens.toLocaleString()}`);
  if (tokenInfo.truncated) {
    meta.push('*(truncated)*');
  }
  return meta.length > 0 ? `${meta.join(' | ')}\n\n` : '';
}

function formatSectionsList(sections: ArticleSection[], tokenInfo: TokenInfo): string {
  if (sections.length === 0 || !tokenInfo.truncated) {
    return '';
  }

  let result = '\n\n---\n\n## Available Sections\n\n';
  for (const section of sections.slice(0, 15)) {
    const indent = '  '.repeat(Math.max(0, section.level - 1));
    result += `${indent}- **${section.title}** (~${String(section.tokenCount)} tokens)\n`;
  }
  if (sections.length > 15) {
    result += `\n*...and ${String(sections.length - 15)} more sections*\n`;
  }
  result += '\n*Use `section` parameter to retrieve a specific section.*\n';
  return result;
}

function formatRelatedArticles(articles: RelatedArticle[] | undefined): string {
  if (articles === undefined || articles.length === 0) {
    return '';
  }

  let result = '\n\n---\n\n## Related Articles\n\n';
  for (const related of articles) {
    result += `- [${related.title}](${related.url})\n`;
  }
  return result;
}

function formatFooter(url: string, tokenInfo: TokenInfo, compact = false): string {
  if (compact) {
    return `\n---\n*[Source](${url}) | ${tokenInfo.tokenCount} tokens${tokenInfo.truncated ? ' (truncated)' : ''}*\n`;
  }

  let result = '\n\n---\n\n';
  result += `*Source: [${url}](${url})*\n`;
  result += `*${tokenInfo.tokenCount.toLocaleString()} tokens`;
  if (tokenInfo.truncated) {
    result += ` (truncated from original, max: ${tokenInfo.maxTokens.toLocaleString()})`;
  }
  result += '*\n';
  return result;
}

/**
 * Format article in compact mode
 */
function formatArticleAsCompact(
  article: FetchArticleResult,
  tokenInfo: TokenInfo,
  _sections: ArticleSection[]
): string {
  let markdown = `# ${article.title}\n\n`;

  // Compact metadata
  const meta: string[] = [];
  if (article.product !== undefined && article.product !== '') {
    meta.push(article.product);
  }
  if (article.version !== undefined && article.version !== '') {
    meta.push(`v${article.version}`);
  }
  if (meta.length > 0) {
    markdown += `*${meta.join(' | ')}*\n\n`;
  }

  // Content
  markdown += article.content;

  // Compact footer
  markdown += formatFooter(article.url, tokenInfo, true);

  return markdown;
}

function formatArticleAsMarkdown(
  article: FetchArticleResult,
  tokenInfo: TokenInfo,
  sections: ArticleSection[],
  options: FormatOptions
): string {
  let markdown = '';

  markdown += formatBreadcrumb(article.breadcrumb);
  markdown += `# ${article.title}\n\n`;
  markdown += formatMetadata(article.product, article.version, article.lastUpdated, tokenInfo);

  if (options.section !== undefined && options.section !== '') {
    markdown += `*Showing section: "${options.section}"*\n\n`;
  }

  markdown += '---\n\n';
  markdown += article.content;

  if (options.section === undefined || options.section === '') {
    markdown += formatSectionsList(sections, tokenInfo);
  }

  if (options.includeRelated === true) {
    markdown += formatRelatedArticles(article.relatedArticles);
  }

  markdown += formatFooter(article.url, tokenInfo);

  return markdown;
}

const TOOL_NAME = 'jamf_docs_get_article';

const TOOL_DESCRIPTION = `Retrieve the full content of a specific Jamf documentation article.

This tool fetches and parses a Jamf documentation article, converting it to
a clean, readable format. Works with any article from docs.jamf.com or learn.jamf.com.

Args:
  - url (string, required): Full URL of the article (must be from docs.jamf.com or learn.jamf.com)
  - section (string, optional): Extract only a specific section by title or ID (e.g., "Prerequisites", "Configuration")
  - summaryOnly (boolean, optional): Return only article summary and outline instead of full content (default: false). Token-efficient way to preview an article
  - includeRelated (boolean, optional): Include links to related articles (default: false)
  - maxTokens (number, optional): Maximum tokens in response 100-20000 (default: 5000)
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
        const article = await fetchArticle(params.url, {
          includeRelated: params.includeRelated,
          summaryOnly: params.summaryOnly,
          ...(params.section !== undefined && { section: params.section }),
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

        // Markdown format (full or compact)
        const markdown = params.outputMode === OutputMode.COMPACT
          ? formatArticleAsCompact(article, tokenInfo, sections)
          : formatArticleAsMarkdown(article, tokenInfo, sections, {
              section: params.section,
              includeRelated: params.includeRelated
            });

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
