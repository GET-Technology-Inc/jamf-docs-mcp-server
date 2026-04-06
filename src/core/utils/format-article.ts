/**
 * Shared article formatting utilities
 *
 * Provides consistent Markdown formatting for article output
 * used by both get-article and batch-get-articles tools.
 */

import type { TokenInfo, ArticleSection, FetchArticleResult } from '../types.js';
import { sanitizeMarkdownText, sanitizeMarkdownUrl } from './sanitize.js';
import { estimateTokens } from '../services/tokenizer.js';

// ============================================================================
// Types
// ============================================================================

interface RelatedArticle {
  title: string;
  url: string;
}

/**
 * Options for full (non-compact) article formatting.
 * All fields are optional so that batch-get-articles can omit them.
 */
export interface FormatArticleFullOptions {
  /** Show breadcrumb trail above the title */
  breadcrumb?: string[] | undefined;
  /** Show "Last Updated" in metadata line */
  lastUpdated?: string | undefined;
  /** Show "Showing section: ..." note */
  section?: string | undefined;
  /** Show the sections list when content is truncated */
  sections?: ArticleSection[] | undefined;
  /** Include related article links at the bottom */
  relatedArticles?: RelatedArticle[] | undefined;
  /** Use brief footer (source link only, no token count line). Default: false */
  briefFooter?: boolean | undefined;
}

// ============================================================================
// Internal helpers
// ============================================================================

function formatBreadcrumb(breadcrumb: string[] | undefined): string {
  if (breadcrumb === undefined || breadcrumb.length === 0) {
    return '';
  }
  return `*${breadcrumb.join(' > ')}*\n\n`;
}

function formatFullMetadata(
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
  meta.push(
    `**Tokens**: ${tokenInfo.tokenCount.toLocaleString()}/${tokenInfo.maxTokens.toLocaleString()}`
  );
  if (tokenInfo.truncated) {
    meta.push('*(truncated)*');
  }
  return meta.length > 0 ? `${meta.join(' | ')}\n\n` : '';
}

function formatCompactMetadata(
  product: string | undefined,
  version: string | undefined
): string {
  const meta: string[] = [];
  if (product !== undefined && product !== '') {
    meta.push(product);
  }
  if (version !== undefined && version !== '') {
    meta.push(`v${version}`);
  }
  return meta.length > 0 ? `*${meta.join(' | ')}*\n\n` : '';
}

function formatSectionsList(
  sections: ArticleSection[],
  tokenInfo: TokenInfo
): string {
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
    result += `- [${sanitizeMarkdownText(related.title)}](${sanitizeMarkdownUrl(related.url)})\n`;
  }
  return result;
}

function formatFullFooter(url: string, tokenInfo: TokenInfo): string {
  const safeUrl = sanitizeMarkdownUrl(url);
  let result = '\n\n---\n\n';
  result += `*Source: [${sanitizeMarkdownText(url)}](${safeUrl})*\n`;
  result += `*${tokenInfo.tokenCount.toLocaleString()} tokens`;
  if (tokenInfo.truncated) {
    result += ` (truncated from original, max: ${tokenInfo.maxTokens.toLocaleString()})`;
  }
  result += '*\n';
  return result;
}

/**
 * Brief footer: source link only, no token count line.
 * Used by batch-get-articles in full mode.
 */
function formatBriefFooter(url: string): string {
  const safeUrl = sanitizeMarkdownUrl(url);
  return `\n\n---\n*Source: [${sanitizeMarkdownText(url)}](${safeUrl})*\n`;
}

function formatCompactFooter(url: string, tokenInfo: TokenInfo): string {
  const safeUrl = sanitizeMarkdownUrl(url);
  return `\n---\n*[Source](${safeUrl}) | ${tokenInfo.tokenCount} tokens${tokenInfo.truncated ? ' (truncated)' : ''}*\n`;
}

const COMPACT_PREVIEW_TOKENS = 500;

/** Break at paragraph boundaries so the preview reads cleanly. */
function truncateContentForPreview(content: string, maxTokens: number): string {
  if (estimateTokens(content) <= maxTokens) {
    return content;
  }

  const paragraphs = content.split(/\n\n+/);
  const included: string[] = [];
  let running = 0;

  for (const para of paragraphs) {
    const paraTokens = estimateTokens(para);
    if (running + paraTokens > maxTokens && included.length > 0) {
      break;
    }
    included.push(para);
    running += paraTokens;
    if (running >= maxTokens) {
      break;
    }
  }

  return included.join('\n\n');
}

/** Always shown so the AI knows which sections can be fetched individually. */
function formatCompactSectionsList(sections: ArticleSection[]): string {
  if (sections.length === 0) {
    return '';
  }

  let result = `\n## Available Sections (${String(sections.length)})\n\n`;
  for (const section of sections.slice(0, 15)) {
    const indent = '  '.repeat(Math.max(0, section.level - 1));
    result += `${indent}- ${section.title}\n`;
  }
  if (sections.length > 15) {
    result += `\n*...and ${String(sections.length - 15)} more sections*\n`;
  }
  return result;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Format an article in compact mode.
 *
 * Shows only a preview (~500 tokens) of the content plus a list of all
 * available sections so the AI knows what can be retrieved in full.
 *
 * Output: title, compact metadata, content preview, truncation notice,
 * available sections list, compact footer.
 */
export function formatArticleCompact(
  article: FetchArticleResult
): string {
  const preview = truncateContentForPreview(article.content, COMPACT_PREVIEW_TOKENS);
  const isPreviewTruncated = preview.length < article.content.length;

  let markdown = `# ${article.title}\n\n`;
  markdown += formatCompactMetadata(article.product, article.version);
  markdown += preview;

  if (isPreviewTruncated) {
    markdown += '\n\n*[Showing preview. '
      + 'Use outputMode="full" for complete content, '
      + 'or section="<name>" for specific section.]*';
  }

  markdown += formatCompactSectionsList(article.sections);
  markdown += formatCompactFooter(article.url, article.tokenInfo);
  return markdown;
}

/**
 * Format an article in full mode.
 *
 * Output: breadcrumb (optional), title, full metadata, section note (optional),
 * separator, content, sections list (optional), related articles (optional),
 * full footer.
 */
export function formatArticleFull(
  article: FetchArticleResult,
  options: FormatArticleFullOptions = {}
): string {
  const { tokenInfo } = article;
  let markdown = '';

  markdown += formatBreadcrumb(options.breadcrumb);
  markdown += `# ${article.title}\n\n`;
  markdown += formatFullMetadata(
    article.product,
    article.version,
    options.lastUpdated,
    tokenInfo
  );

  if (options.section !== undefined && options.section !== '') {
    markdown += `*Showing section: "${options.section}"*\n\n`;
  }

  markdown += '---\n\n';
  markdown += article.content;

  if (
    options.sections !== undefined &&
    (options.section === undefined || options.section === '')
  ) {
    markdown += formatSectionsList(options.sections, tokenInfo);
  }

  markdown += formatRelatedArticles(options.relatedArticles);

  if (options.briefFooter === true) {
    markdown += formatBriefFooter(article.url);
  } else {
    markdown += formatFullFooter(article.url, tokenInfo);
  }

  return markdown;
}
