/**
 * The three shapes an article response can take.
 *
 * Its own module rather than a member of `article-service`: the static-source
 * path needs it too, and importing it from there would make the two services
 * cyclic — `article-service` dispatches into `static-article-service`, which
 * would import back. ESM tolerates that; a reader tracing which module owns
 * what does not.
 */

import {
  createTokenInfo,
  estimateTokens,
  truncateToTokenLimit,
  extractSummary,
  extractSection,
  slugify,
  titleMatchesSection,
} from './tokenizer.js';
import { sanitizeMarkdownText, sanitizeMarkdownUrl } from '../utils/sanitize.js';
import type {
  ArticleNavigation,
  ArticleNavigationLink,
  ArticleSection,
  FetchArticleOptions,
  FetchArticleResult,
} from '../types.js';

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
    // An outline of the topic's own headings is not an outline of the page:
    // on learn.jamf.com the page usually also shows the topic's children,
    // and those are separate topics here. Computer Configuration Profiles
    // answered "Article Outline (0 sections)" and nothing else, for a page of
    // nine. Children the site publishes as pages of their own are worth
    // listing too: they are the way down from here.
    const subTopics = formatSubTopics(base.navigation);
    summaryContent += subTopics;
    summaryContent += `\n*Estimated read time: ${summaryResult.estimatedReadTime} min`
      + ` (${summaryResult.totalTokens.toLocaleString()} tokens)*\n`;

    const tokenInfo = subTopics === ''
      ? summaryResult.tokenInfo
      : {
          ...summaryResult.tokenInfo,
          tokenCount: summaryResult.tokenInfo.tokenCount + estimateTokens(subTopics),
        };
    return { ...base, content: summaryContent, tokenInfo };
  }

  // ── Section extraction ──
  if (options.section !== undefined && options.section !== '') {
    const sectionResult = extractSection(content, options.section, maxTokens);
    if (sectionResult.section !== null) {
      return { ...base, content: sectionResult.content, tokenInfo: sectionResult.tokenInfo };
    }
    const notFoundMsg = formatSectionNotFound(options.section, allSections, base.navigation);
    return {
      ...base,
      content: notFoundMsg,
      tokenInfo: createTokenInfo(notFoundMsg, maxTokens),
      sectionNotFound: true,
    };
  }

  // ── Full content with truncation ──
  const truncateResult = truncateToTokenLimit(content, maxTokens, allSections);
  return { ...base, content: truncateResult.content, tokenInfo: truncateResult.tokenInfo };
}

/**
 * The reply to a `section` that matched no heading.
 *
 * It used to be the requested name, an "**Available sections:**" header and
 * the headings under it — and on learn.jamf.com there usually are none. The
 * Fluid Topics API serves one topic per call while the site usually folds a
 * topic's children into its page (195 of 247 Jamf Pro parents on 2026-09-24;
 * the other 52 publish them as pages of their own), so what a reader sees
 * there as sections are child topics. Sampled 2026-09-24, 337 of 360 topics
 * across five English maps (94%) have no `<h1>`–`<h6>` at all, and Computer
 * Configuration Profiles answered
 * `section: "Creating a Computer Configuration Profile in Jamf Pro"` — the
 * exact title of one of its nine children — with a header and an empty list.
 *
 * So: headings when there are some, a plain statement when there are none, and
 * in both cases the child topics, which the TOC already placed for this very
 * response, ranked so one that matches the request comes first. Static sources
 * carry no navigation, so their reply is unchanged.
 */
function formatSectionNotFound(
  section: string,
  allSections: ArticleSection[],
  navigation: ArticleNavigation | undefined,
): string {
  let reply = `*Section "${section}" not found.*\n\n`;
  if (allSections.length > 0) {
    reply += `**Available sections:**\n${allSections.map(s => `- ${s.title}`).join('\n')}\n`;
  } else {
    reply += 'This article has no headings, so it has no sections to select.\n';
  }
  // Trimmed: the formatter sets the footer off with its own blank line.
  return (reply + formatSubTopics(navigation, section)).trimEnd();
}

/**
 * The article's child topics as links, or nothing when it has none.
 *
 * With `requested`, children the `section` rule would have matched are listed
 * first and marked, since that is almost always what the caller was after.
 */
function formatSubTopics(
  navigation: ArticleNavigation | undefined,
  requested?: string,
): string {
  if (navigation === undefined || navigation.children.length === 0) {
    return '';
  }

  const matches = (child: ArticleNavigationLink): boolean =>
    requested !== undefined
    && (slugify(child.title) === slugify(requested) || titleMatchesSection(child.title, requested));
  const matching = navigation.children.filter(matches);
  const ordered = [...matching, ...navigation.children.filter(child => !matches(child))];

  // Worded to hold for either kind of parent, because the TOC does not say
  // which one this is. On 2026-09-24, of the 247 Jamf Pro topics with
  // children, 195 have every child inside their page on the site and 52 have
  // every child as a separate page (Policies, System Settings, Global
  // Management Settings); none mix the two. Only the map's `/pages` listing
  // tells them apart, and that would mean one more fetch per map. "These
  // appear as sections of this page" was untrue for Policies' four.
  let list = `\n**Sub-topics (${String(navigation.childCount)}):** this topic's children in`
    + ' the table of contents, each its own article. learn.jamf.com may show them as'
    + ' sections of this page or as pages of their own.'
    + ' Fetch one with `jamf_docs_get_article` and its url.\n\n';
  for (const child of ordered) {
    const marker = matching.includes(child) ? ` — matches "${sanitizeMarkdownText(requested ?? '')}"` : '';
    list += `- [${sanitizeMarkdownText(child.title)}](${sanitizeMarkdownUrl(child.url)})${marker}\n`;
  }
  const unlisted = navigation.childCount - navigation.children.length;
  if (unlisted > 0) {
    list += `\n*...and ${String(unlisted)} more, not listed here; \`jamf_docs_get_toc\` shows them all.*\n`;
  }
  return list;
}
