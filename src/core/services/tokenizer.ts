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
 * Generate a unique section ID with duplicate suffix handling
 * Shared between extractSections() and extractSection() for consistency
 */
export function generateSectionId(
  title: string,
  index: number,
  idCounts: Map<string, number>
): string {
  let baseId = slugify(title);
  if (baseId === '') {
    baseId = `section-${index}`;
  }
  const count = idCounts.get(baseId) ?? 0;
  idCounts.set(baseId, count + 1);
  return count === 0 ? baseId : `${baseId}-${count}`;
}

/**
 * Extract sections (headings) from Markdown content
 * Generates unique slugified IDs with duplicate suffix handling
 */
export function extractSections(content: string): ArticleSection[] {
  const sections: ArticleSection[] = [];
  const lines = content.split('\n');
  let currentSection: { title: string; level: number } | null = null;
  let sectionContent = '';
  const idCounts = new Map<string, number>();
  let sectionIndex = 0;

  function saveCurrentSection(): void {
    if (currentSection !== null) {
      sectionIndex++;
      const id = generateSectionId(currentSection.title, sectionIndex, idCounts);

      sections.push({
        id,
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
      // Turndown converts HTML anchors inside headings to markdown links — strip them for clean titles
      const rawTitle = headingMatch[2]?.trim() ?? '';
      const cleanTitle = rawTitle.replace(/\[([^\]]*)\]\(#[^)]*\)/g, '$1').trim();
      currentSection = {
        title: cleanTitle,
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
 * Generate a section ID (slug) from heading title
 */
export function slugify(title: string): string {
  if (title.trim() === '') {
    return '';
  }
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Whether `identifier` is a substantial part of `title`: the loose half of how
 * `section` picks a heading, the other half being an exact id match.
 *
 * Shared with the not-found reply, which ranks a Fluid Topics topic's child
 * topics by it — so a child offered as "matching" is one this same rule would
 * have selected had it been a heading.
 */
export function titleMatchesSection(title: string, identifier: string): boolean {
  const lowerTitle = title.toLowerCase();
  const lowerIdent = identifier.toLowerCase();
  return lowerIdent.length >= 3
    && lowerTitle.includes(lowerIdent)
    && lowerIdent.length >= lowerTitle.length * 0.3;
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
  const normalizedId = slugify(sectionIdentifier);
  const sectionLines: string[] = [];
  let foundSection: ArticleSection | null = null;
  let targetLevel = 0;
  const idCounts = new Map<string, number>();
  let sectionIndex = 0;

  for (const line of lines) {
    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(line);

    if (headingMatch !== null) {
      const level = headingMatch[1]?.length ?? 1;
      const rawTitle = headingMatch[2]?.trim() ?? '';
      const title = rawTitle.replace(/\[([^\]]*)\]\(#[^)]*\)/g, '$1').trim();

      // Generate ID with duplicate handling (matching extractSections)
      sectionIndex++;
      const id = generateSectionId(title, sectionIndex, idCounts);

      // End section if we hit same or higher level heading
      if (foundSection !== null && level <= targetLevel) { break; }

      // Check if this is the target section (ID match, or substantial title substring match)
      if (foundSection === null && (id === normalizedId || titleMatchesSection(title, sectionIdentifier))) {
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
 * - Lists remaining sections when truncated, as many as the budget holds
 *
 * The notice is charged to `maxTokens` like the body it follows. It used to be
 * appended after the body had already taken 90% of the budget, and its list of
 * up to ten remaining sections was never counted against anything: live on
 * 2026-09-24, Components Installed on Managed Computers at `maxTokens: 100`
 * answered with 172 tokens, 87 of them the notice. Now the list is cut to what
 * is left once the body is in, and when not even the bare notice fits, body
 * lines are dropped until it does. The result is at most `maxTokens` whenever
 * `maxTokens` covers the bare notice (~12 tokens).
 */
export function truncateToTokenLimit(
  content: string,
  maxTokens: number = TOKEN_CONFIG.DEFAULT_MAX_TOKENS,
  preExtractedSections?: ArticleSection[]
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

  // Reuse pre-extracted sections when available; otherwise extract them now
  const allSections = preExtractedSections ?? extractSections(content);

  // Smart truncation
  const lines = content.split('\n');
  const kept: string[] = [];
  let runningTokens = 0;

  // Reserve tokens for truncation notice and remaining sections list
  const reservedTokens = Math.min(500, Math.floor(maxTokens * 0.1));
  const effectiveMax = maxTokens - reservedTokens;

  for (const line of lines) {
    const lineTokens = estimateTokens(`${line}\n`);
    if (runningTokens + lineTokens > effectiveMax) {
      break;
    }
    kept.push(line);
    runningTokens += lineTokens;
  }

  for (;;) {
    const body = closeCodeFence(kept);
    // Sections are ordered linearly — headings seen in the kept lines map 1:1
    const remainingSections = allSections.slice(kept.filter(isHeadingLine).length);
    const notice = formatTruncationNotice(remainingSections, maxTokens - estimateTokens(body));
    const finalContent = body + notice;
    const tokenCount = estimateTokens(finalContent);

    if (tokenCount <= maxTokens || kept.length === 0) {
      return {
        content: finalContent,
        tokenInfo: {
          tokenCount,
          truncated: true,
          maxTokens
        },
        remainingSections
      };
    }

    // Over by the notice, or by code lines, which the per-line estimate above
    // prices as prose. Drop about as much as the overshoot, then re-measure.
    let overshoot = tokenCount - maxTokens;
    while (overshoot > 0 && kept.length > 0) {
      overshoot -= estimateTokens(`${kept.pop() ?? ''}\n`);
    }
  }
}

/** The same heading rule as {@link extractSections}, so counts line up. */
function isHeadingLine(line: string): boolean {
  return /^#{1,6}\s+/.test(line);
}

/**
 * The kept lines, with a fence added when they stop inside a code block.
 *
 * Counted from the lines actually kept. It used to be toggled before the
 * budget check, so a cut that fell on an opening fence closed a block that was
 * never opened, and the stray fence opened one instead.
 */
function closeCodeFence(kept: string[]): string {
  const fences = kept.filter(line => line.startsWith('```')).length;
  return fences % 2 === 1 ? `${kept.join('\n')}\n\`\`\`` : kept.join('\n');
}

/**
 * The truncation notice, listing as many remaining sections (up to ten) as
 * `budget` holds and counting the rest; when none fit, only the count, and
 * when not even that fits, the bare notice.
 */
function formatTruncationNotice(remainingSections: ArticleSection[], budget: number): string {
  const notice = '\n\n---\n\n*[Content truncated due to token limit]*\n';
  if (remainingSections.length === 0) {
    return notice;
  }

  const listed = remainingSections.slice(0, 10).map((section) => {
    const indent = '  '.repeat(Math.max(0, section.level - 1));
    return `${indent}- ${section.title} (~${section.tokenCount} tokens)\n`;
  });
  for (let shown = listed.length; shown > 0; shown--) {
    const omitted = remainingSections.length - shown;
    const more = omitted > 0 ? `\n*...and ${omitted} more sections*\n` : '';
    const candidate = `${notice}\n**Remaining sections:**\n${listed.slice(0, shown).join('')}${more}`
      + '\n*Use the `section` parameter to retrieve specific sections.*';
    if (estimateTokens(candidate) <= budget) {
      return candidate;
    }
  }
  const counted = `${notice}\n*...and ${remainingSections.length} more sections;`
    + ' use the `section` parameter to retrieve one.*\n';
  return estimateTokens(counted) <= budget ? counted : notice;
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
  requestedPage: number;
  pageWasClamped: boolean;
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
    endIndex: Math.min(normalizedPage * pageSize, totalItems),
    requestedPage: page,
    pageWasClamped: normalizedPage !== page,
  };
}

/**
 * Truncate an already-paginated list to fit within a token budget.
 * Items are dropped from the end once cumulative tokens exceed maxTokens.
 */
export function truncateListByTokens<T>(
  items: T[],
  maxTokens: number,
  toString: (item: T) => string,
): { items: T[]; tokenCount: number; truncated: boolean } {
  const included: T[] = [];
  let tokenCount = 0;

  for (const item of items) {
    const itemTokens = estimateTokens(toString(item));
    if (tokenCount + itemTokens > maxTokens) {
      return { items: included, tokenCount, truncated: true };
    }
    included.push(item);
    tokenCount += itemTokens;
  }

  return { items: included, tokenCount, truncated: false };
}

/**
 * Build a human-readable note when the requested page was clamped.
 */
export function buildPaginationNote(
  pagination: { pageWasClamped: boolean; requestedPage: number; totalPages: number },
): string | undefined {
  return pagination.pageWasClamped
    ? `Note: Requested page ${pagination.requestedPage} exceeds total pages` +
      ` (${pagination.totalPages}). Showing last page.`
    : undefined;
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

  // Same stop-at-first-overflow rule as the standalone helper, which this used
  // to re-implement inline: break-then-build and return-early produce the same
  // items, the same running total and the same flag.
  const { items: includedItems, tokenCount, truncated } =
    truncateListByTokens(pageItems, maxTokens, itemToString);

  return {
    items: includedItems,
    tokenInfo: {
      tokenCount,
      truncated,
      maxTokens
    },
    pagination: {
      page: pagination.page,
      pageSize: pagination.pageSize,
      totalPages: pagination.totalPages,
      totalItems: pagination.totalItems,
      hasNext: pagination.hasNext,
      hasPrev: pagination.hasPrev
    }
  };
}
