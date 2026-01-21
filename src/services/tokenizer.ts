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
export function estimateTokens(text: string): number {
  if (!text) {return 0;}

  // Split content into code blocks and regular text
  const codeBlockRegex = /```[\s\S]*?```/g;
  const codeBlocks = text.match(codeBlockRegex) || [];
  const regularText = text.replace(codeBlockRegex, '');

  // Calculate tokens for each type
  const codeTokens = codeBlocks.reduce((sum, block) => {
    return sum + Math.ceil(block.length / TOKEN_CONFIG.CODE_CHARS_PER_TOKEN);
  }, 0);

  const textTokens = Math.ceil(regularText.length / TOKEN_CONFIG.CHARS_PER_TOKEN);

  return codeTokens + textTokens;
}

/**
 * Create a TokenInfo object
 */
export function createTokenInfo(
  content: string,
  maxTokens: number,
  truncated: boolean = false
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

  let currentSection: { title: string; level: number; startLine: number } | null = null;
  let sectionContent = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);

    if (headingMatch) {
      // Save previous section
      if (currentSection) {
        const id = generateSectionId(currentSection.title);
        sections.push({
          id,
          title: currentSection.title,
          level: currentSection.level,
          tokenCount: estimateTokens(sectionContent)
        });
      }

      // Start new section
      const title = headingMatch[2]?.trim() ?? '';
      const level = headingMatch[1]?.length ?? 1;
      currentSection = {
        title,
        level,
        startLine: i
      };
      sectionContent = line + '\n';
    } else if (currentSection) {
      sectionContent += line + '\n';
    }
  }

  // Don't forget the last section
  if (currentSection) {
    const id = generateSectionId(currentSection.title);
    sections.push({
      id,
      title: currentSection.title,
      level: currentSection.level,
      tokenCount: estimateTokens(sectionContent)
    });
  }

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

  let inTargetSection = false;
  let targetLevel = 0;
  const sectionLines: string[] = [];
  let foundSection: ArticleSection | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);

    if (headingMatch) {
      const level = headingMatch[1]?.length ?? 1;
      const title = headingMatch[2]?.trim() ?? '';
      const id = generateSectionId(title);

      if (inTargetSection) {
        // Check if we've reached a heading at the same or higher level
        if (level <= targetLevel) {
          break; // End of target section
        }
      }

      // Check if this is the target section
      if (id === normalizedId || title.toLowerCase().includes(sectionIdentifier.toLowerCase())) {
        inTargetSection = true;
        targetLevel = level;
        foundSection = {
          id,
          title,
          level,
          tokenCount: 0 // Will be calculated later
        };
      }
    }

    if (inTargetSection) {
      sectionLines.push(line);
    }
  }

  const sectionContent = sectionLines.join('\n');

  // Apply token limit with smart truncation
  const truncateResult = truncateToTokenLimit(sectionContent, maxTokens);

  if (foundSection) {
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

    const lineTokens = estimateTokens(line + '\n');

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
  const normalizedPage = Math.min(Math.max(1, page), totalPages || 1);

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
  page: number = 1,
  pageSize: number = 10
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
