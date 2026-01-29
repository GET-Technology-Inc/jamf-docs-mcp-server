/**
 * Tokenizer service for Context7-style token management
 *
 * Provides token estimation, smart truncation, and section extraction
 * for controlling response size in LLM contexts.
 */

import { TOKEN_CONFIG } from '../constants.js';
import type { TokenInfo, ArticleSection } from '../types.js';

/**
 * Result of truncation operation
 */
export interface TruncateResult {
  content: string;
  tokenInfo: TokenInfo;
  remainingSections?: ArticleSection[];
}

/**
 * Result of summary extraction
 */
export interface SummaryResult {
  title: string;
  summary: string;
  outline: ArticleSection[];
  totalTokens: number;
  estimatedReadTime: number;
  tokenInfo: TokenInfo;
}

/**
 * Result of section extraction
 */
export interface ExtractSectionResult {
  content: string;
  section: ArticleSection | null;
  tokenInfo: TokenInfo;
}

/**
 * Estimate token count for a text string
 * Uses different ratios for code blocks vs normal text
 */
export function estimateTokens(text: string | null | undefined): number {
  if (text === null || text === undefined || text === '') {
    return 0;
  }

  const codeBlockRegex = /```[\s\S]*?```/g;
  const codeBlocks = text.match(codeBlockRegex) ?? [];
  const regularText = text.replace(codeBlockRegex, '');

  const codeTokens = codeBlocks.reduce(
    (sum, block) => sum + Math.ceil(block.length / TOKEN_CONFIG.CODE_CHARS_PER_TOKEN),
    0
  );
  const textTokens = Math.ceil(regularText.length / TOKEN_CONFIG.CHARS_PER_TOKEN);

  return codeTokens + textTokens;
}

/**
 * Create a TokenInfo object
 */
export function createTokenInfo(
  content: string,
  maxTokens: number,
  truncated = false
): TokenInfo {
  return {
    tokenCount: estimateTokens(content),
    truncated,
    maxTokens
  };
}

/**
 * Extract sections (headings) from Markdown content
 */
export function extractSections(content: string): ArticleSection[] {
  const sections: ArticleSection[] = [];
  const lines = content.split('\n');
  let currentSection: { title: string; level: number } | null = null;
  let sectionContent = '';

  function saveCurrentSection(): void {
    if (currentSection !== null) {
      sections.push({
        id: generateSectionId(currentSection.title),
        title: currentSection.title,
        level: currentSection.level,
        tokenCount: estimateTokens(sectionContent)
      });
    }
  }

  for (const line of lines) {
    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(line);

    if (headingMatch !== null) {
      saveCurrentSection();
      currentSection = {
        title: headingMatch[2]?.trim() ?? '',
        level: headingMatch[1]?.length ?? 1
      };
      sectionContent = `${line}\n`;
    } else if (currentSection !== null) {
      sectionContent += `${line}\n`;
    }
  }

  saveCurrentSection();
  return sections;
}

/**
 * Generate a section ID from title
 */
function generateSectionId(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Extract a specific section from Markdown content
 */
export function extractSection(
  content: string,
  sectionIdentifier: string,
  maxTokens: number = TOKEN_CONFIG.DEFAULT_MAX_TOKENS
): ExtractSectionResult {
  const lines = content.split('\n');
  const normalizedId = generateSectionId(sectionIdentifier);
  const sectionLines: string[] = [];
  let foundSection: ArticleSection | null = null;
  let targetLevel = 0;

  for (const line of lines) {
    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(line);

    if (headingMatch !== null) {
      const level = headingMatch[1]?.length ?? 1;
      const title = headingMatch[2]?.trim() ?? '';
      const id = generateSectionId(title);

      // End section if we hit same or higher level heading
      if (foundSection !== null && level <= targetLevel) {break;}

      // Check if this is the target section
      if (foundSection === null && (id === normalizedId || title.toLowerCase().includes(sectionIdentifier.toLowerCase()))) {
        targetLevel = level;
        foundSection = { id, title, level, tokenCount: 0 };
      }
    }

    if (foundSection !== null) {
      sectionLines.push(line);
    }
  }

  const truncateResult = truncateToTokenLimit(sectionLines.join('\n'), maxTokens);

  if (foundSection !== null) {
    foundSection.tokenCount = truncateResult.tokenInfo.tokenCount;
  }

  return {
    content: truncateResult.content,
    section: foundSection,
    tokenInfo: truncateResult.tokenInfo
  };
}

/**
 * Smart truncation that preserves document structure
 * - Preserves paragraph boundaries
 * - Correctly closes code blocks
 * - Lists remaining sections when truncated
 */
export function truncateToTokenLimit(
  content: string,
  maxTokens: number = TOKEN_CONFIG.DEFAULT_MAX_TOKENS
): TruncateResult {
  const currentTokens = estimateTokens(content);

  // If within limit, return as-is
  if (currentTokens <= maxTokens) {
    return {
      content,
      tokenInfo: {
        tokenCount: currentTokens,
        truncated: false,
        maxTokens
      }
    };
  }

  // Extract all sections before truncation
  const allSections = extractSections(content);

  // Smart truncation
  const lines = content.split('\n');
  const truncatedLines: string[] = [];
  let runningTokens = 0;
  let inCodeBlock = false;

  // Reserve tokens for truncation notice and remaining sections list
  const reservedTokens = Math.min(500, Math.floor(maxTokens * 0.1));
  const effectiveMax = maxTokens - reservedTokens;

  for (const line of lines) {
    // Track code blocks
    if (line.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
    }

    const lineTokens = estimateTokens(`${line}\n`);

    if (runningTokens + lineTokens > effectiveMax) {
      // Close any open code block
      if (inCodeBlock) {
        truncatedLines.push('```');
      }
      break;
    }

    truncatedLines.push(line);
    runningTokens += lineTokens;
  }

  // Find remaining sections (sections not fully included)
  const truncatedContent = truncatedLines.join('\n');
  const includedSections = extractSections(truncatedContent);
  const includedIds = new Set(includedSections.map(s => s.id));

  const remainingSections = allSections.filter(s => !includedIds.has(s.id));

  // Build truncation notice
  let notice = '\n\n---\n\n*[Content truncated due to token limit]*\n';

  if (remainingSections.length > 0) {
    notice += '\n**Remaining sections:**\n';
    for (const section of remainingSections.slice(0, 10)) {
      const indent = '  '.repeat(Math.max(0, section.level - 1));
      notice += `${indent}- ${section.title} (~${section.tokenCount} tokens)\n`;
    }
    if (remainingSections.length > 10) {
      notice += `\n*...and ${remainingSections.length - 10} more sections*\n`;
    }
    notice += '\n*Use the `section` parameter to retrieve specific sections.*';
  }

  const finalContent = truncatedContent + notice;

  return {
    content: finalContent,
    tokenInfo: {
      tokenCount: estimateTokens(finalContent),
      truncated: true,
      maxTokens
    },
    remainingSections
  };
}

/**
 * Extract summary from Markdown content
 * Returns the first paragraph and an outline of sections with token estimates
 */
export function extractSummary(
  content: string,
  title: string,
  maxTokens: number = TOKEN_CONFIG.DEFAULT_MAX_TOKENS
): SummaryResult {
  const lines = content.split('\n');
  const sections = extractSections(content);
  const totalTokens = estimateTokens(content);

  // Extract first meaningful paragraph (skip headings, code blocks, and empty lines)
  let summary = '';
  let inParagraph = false;
  let inCodeBlock = false;

  for (const line of lines) {
    // Track code blocks
    if (line.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      if (inParagraph) {break;}
      continue;
    }

    // Skip content inside code blocks
    if (inCodeBlock) {
      continue;
    }

    // Skip headings
    if (line.startsWith('#')) {
      if (inParagraph) {break;}
      continue;
    }

    // Skip empty lines at the start
    if (line.trim() === '' && !inParagraph) {
      continue;
    }

    // Skip list items and other non-paragraph content
    if (line.trim().startsWith('-') || line.trim().startsWith('*') || line.trim().startsWith('|')) {
      if (inParagraph) {break;}
      continue;
    }

    // Found content
    if (line.trim() !== '') {
      inParagraph = true;
      summary += `${line} `;
    } else if (inParagraph) {
      // End of paragraph
      break;
    }
  }

  summary = summary.trim();

  // If no paragraph found, use first 200 chars of content
  if (summary === '') {
    const plainText = content.replace(/^#+\s+.+$/gm, '').replace(/\n+/g, ' ').trim();
    summary = plainText.slice(0, 200) + (plainText.length > 200 ? '...' : '');
  }

  // Estimate read time (assuming 200 words per minute, ~5 chars per word)
  const wordCount = Math.ceil(content.length / 5);
  const estimatedReadTime = Math.max(1, Math.ceil(wordCount / 200));

  // Build the summary output
  let output = `# ${title}\n\n`;
  output += `## Summary\n\n${summary}\n\n`;
  output += `## Article Outline (${sections.length} sections)\n\n`;

  for (const section of sections) {
    const indent = '  '.repeat(Math.max(0, section.level - 1));
    output += `${indent}- ${section.title} (~${section.tokenCount} tokens)\n`;
  }

  output += `\n*Estimated read time: ${estimatedReadTime} min | Total: ${totalTokens.toLocaleString()} tokens*\n`;

  const outputTokens = estimateTokens(output);

  return {
    title,
    summary,
    outline: sections,
    totalTokens,
    estimatedReadTime,
    tokenInfo: {
      tokenCount: outputTokens,
      truncated: false,
      maxTokens
    }
  };
}

/**
 * Calculate pagination info
 */
export function calculatePagination(
  totalItems: number,
  page: number,
  pageSize: number
): {
  page: number;
  pageSize: number;
  totalPages: number;
  totalItems: number;
  hasNext: boolean;
  hasPrev: boolean;
  startIndex: number;
  endIndex: number;
} {
  const totalPages = Math.ceil(totalItems / pageSize);
  const normalizedPage = Math.min(Math.max(1, page), Math.max(totalPages, 1));

  return {
    page: normalizedPage,
    pageSize,
    totalPages,
    totalItems,
    hasNext: normalizedPage < totalPages,
    hasPrev: normalizedPage > 1,
    startIndex: (normalizedPage - 1) * pageSize,
    endIndex: Math.min(normalizedPage * pageSize, totalItems)
  };
}

/**
 * Truncate an array of items to fit within token limit
 * Returns items that fit and pagination info
 */
export function truncateItemsToTokenLimit<T>(
  items: T[],
  maxTokens: number,
  itemToString: (item: T) => string,
  page = 1,
  pageSize = 10
): {
  items: T[];
  tokenInfo: TokenInfo;
  pagination: {
    page: number;
    pageSize: number;
    totalPages: number;
    totalItems: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
} {
  const pagination = calculatePagination(items.length, page, pageSize);
  const pageItems = items.slice(pagination.startIndex, pagination.endIndex);

  // Check if page items fit in token limit
  const includedItems: T[] = [];
  let runningTokens = 0;
  let truncated = false;

  for (const item of pageItems) {
    const itemString = itemToString(item);
    const itemTokens = estimateTokens(itemString);

    if (runningTokens + itemTokens > maxTokens) {
      truncated = true;
      break;
    }

    includedItems.push(item);
    runningTokens += itemTokens;
  }

  return {
    items: includedItems,
    tokenInfo: {
      tokenCount: runningTokens,
      truncated,
      maxTokens
    },
    pagination: {
      page: pagination.page,
      pageSize: pagination.pageSize,
      totalPages: pagination.totalPages,
      totalItems: pagination.totalItems,
      hasNext: pagination.hasNext || truncated,
      hasPrev: pagination.hasPrev
    }
  };
}
