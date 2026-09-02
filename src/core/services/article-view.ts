/**
 * The three shapes an article response can take.
 *
 * Its own module rather than a member of `article-service`: the static-source
 * path needs it too, and importing it from there would make the two services
 * cyclic — `article-service` dispatches into `static-article-service`, which
 * would import back. ESM tolerates that; a reader tracing which module owns
 * what does not.
 */

import { createTokenInfo, truncateToTokenLimit, extractSummary, extractSection } from './tokenizer.js';
import type { ArticleSection, FetchArticleOptions, FetchArticleResult } from '../types.js';

/**
 * Turn a parsed article and the caller's options into the view they asked for.
 *
 * Three mutually exclusive shapes — an outline, one named section, or the
 * whole thing truncated to budget — none of which depend on where the HTML
 * came from. Shared so a second source cannot drift from the first on the
 * part callers actually see: the "Available sections" list a missed section
 * falls back to, the read-time footer, the token accounting.
 */
export function buildArticleView(
  base: Omit<FetchArticleResult, 'content' | 'tokenInfo'>,
  content: string,
  options: Pick<FetchArticleOptions, 'summaryOnly' | 'section'>,
  maxTokens: number,
  allSections: ArticleSection[],
): FetchArticleResult {
  // ── summaryOnly mode ──
  if (options.summaryOnly === true) {
    const summaryResult = extractSummary(content, base.title, maxTokens);
    let summaryContent = `## Summary\n\n${summaryResult.summary}\n\n`;
    summaryContent += `## Article Outline (${summaryResult.outline.length} sections)\n\n`;
    for (const section of summaryResult.outline) {
      const indent = '  '.repeat(Math.max(0, section.level - 1));
      summaryContent += `${indent}- ${section.title} (~${section.tokenCount} tokens)\n`;
    }
    summaryContent += `\n*Estimated read time: ${summaryResult.estimatedReadTime} min`
      + ` (${summaryResult.totalTokens.toLocaleString()} tokens)*\n`;

    return { ...base, content: summaryContent, tokenInfo: summaryResult.tokenInfo };
  }

  // ── Section extraction ──
  if (options.section !== undefined && options.section !== '') {
    const sectionResult = extractSection(content, options.section, maxTokens);
    if (sectionResult.section !== null) {
      return { ...base, content: sectionResult.content, tokenInfo: sectionResult.tokenInfo };
    }
    const sectionsList = allSections.map(s => `- ${s.title}`).join('\n');
    const notFoundMsg =
      `*Section "${options.section}" not found.*\n\n**Available sections:**\n${sectionsList}`;
    return { ...base, content: notFoundMsg, tokenInfo: createTokenInfo(notFoundMsg, maxTokens) };
  }

  // ── Full content with truncation ──
  const truncateResult = truncateToTokenLimit(content, maxTokens, allSections);
  return { ...base, content: truncateResult.content, tokenInfo: truncateResult.tokenInfo };
}
