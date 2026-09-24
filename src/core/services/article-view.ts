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
  estimateTokens,
  truncateToTokenLimit,
  extractSummary,
  extractSection,
  slugify,
  titleMatchesSection,
} from './tokenizer.js';
import { TOKEN_CONFIG } from '../constants.js';
import { sanitizeMarkdownText, sanitizeMarkdownUrl } from '../utils/sanitize.js';
import type {
  ArticleNavigation,
  ArticleNavigationLink,
  ArticleSection,
  FetchArticleOptions,
  FetchArticleResult,
} from '../types.js';

/** What shapes the view: the caller's choice of shape, and a note to end it with. */
export interface ArticleViewOptions extends Pick<FetchArticleOptions, 'summaryOnly' | 'section'> {
  /**
   * One line the reply ends with, set off like the article's other notes. It
   * is charged to `maxTokens` first, and the body gets the rest.
   */
  note?: string | undefined;
}

/**
 * Turn a parsed article and the caller's options into the view they asked for.
 *
 * Three mutually exclusive shapes — an outline, one named section, or the
 * whole thing truncated to budget — none of which depend on where the HTML
 * came from. Shared so a second source cannot drift from the first on the
 * part callers actually see: the "Available sections" list a missed section
 * falls back to, the read-time footer, the token accounting.
 *
 * `maxTokens` bounds `content` on every path, `note` included, and
 * `tokenInfo.tokenCount` is the estimate of exactly that string. Until
 * 2026-09-24 only the full-article path was cut to budget. The outline and the
 * missed-section reply were built whole, and `summaryOnly` reported the token
 * count of a different string. Measured live on Computer Configuration
 * Profiles at `maxTokens: 100`: a missed section reported 415/100 and
 * `summaryOnly` 459/100, both `truncated: false`. A note was appended after
 * the count was taken, so it was in no count at all. The header and footer the
 * formatter wraps around `content` stay outside the count, as they always
 * were for the full article.
 */
export function buildArticleView(
  base: Omit<FetchArticleResult, 'content' | 'tokenInfo'>,
  content: string,
  options: ArticleViewOptions,
  maxTokens: number,
  allSections: ArticleSection[],
): FetchArticleResult {
  const { note } = options;
  const noteBlock = note === undefined ? '' : `\n\n---\n*Note: ${note}*\n`;
  const body = buildBody(base, content, options, maxTokens - estimateTokens(noteBlock), allSections);
  const reply = body.content + noteBlock;
  return {
    ...base,
    content: reply,
    tokenInfo: { tokenCount: estimateTokens(reply), truncated: body.truncated, maxTokens },
    ...(body.sectionNotFound === true && { sectionNotFound: true }),
  };
}

/** The reply before any note, and whether it left something out. */
interface ArticleBody {
  content: string;
  truncated: boolean;
  sectionNotFound?: boolean;
}

function buildBody(
  base: Omit<FetchArticleResult, 'content' | 'tokenInfo'>,
  content: string,
  options: ArticleViewOptions,
  budget: number,
  allSections: ArticleSection[],
): ArticleBody {
  // ── summaryOnly mode ──
  if (options.summaryOnly === true) {
    return formatSummary(content, base.title, base.navigation, budget);
  }

  // ── Section extraction ──
  if (options.section !== undefined && options.section !== '') {
    const sectionResult = extractSection(content, options.section, budget);
    if (sectionResult.section !== null) {
      return { content: sectionResult.content, truncated: sectionResult.tokenInfo.truncated };
    }
    return {
      ...formatSectionNotFound(options.section, allSections, base.navigation, budget),
      sectionNotFound: true,
    };
  }

  // ── Full content with truncation ──
  const truncateResult = truncateToTokenLimit(content, budget, allSections);
  return { content: truncateResult.content, truncated: truncateResult.tokenInfo.truncated };
}

/**
 * The `summaryOnly` reply: the first paragraph, the outline of the topic's
 * headings, its sub-topics and the read time, within `budget`.
 */
function formatSummary(
  content: string,
  title: string,
  navigation: ArticleNavigation | undefined,
  budget: number,
): ArticleBody {
  const summaryResult = extractSummary(content, title);
  const { outline } = summaryResult;
  const outlineHeader = `## Article Outline (${outline.length} sections)\n\n`;
  const outlineBlock = listBlock({
    headers: [outlineHeader],
    items: outline.map((section) => {
      const indent = '  '.repeat(Math.max(0, section.level - 1));
      return `${indent}- ${section.title} (~${section.tokenCount} tokens)\n`;
    }),
    more: omitted => (omitted > 0 ? `\n*...and ${omitted} more sections, ${NOT_LISTED}.*\n` : ''),
    minimal: `${outlineHeader}*${capitalise(NOT_LISTED)}.*\n`,
  });
  // An outline of the topic's own headings is not an outline of the page:
  // on learn.jamf.com the page usually also shows the topic's children,
  // and those are separate topics here. Computer Configuration Profiles
  // answered "Article Outline (0 sections)" and nothing else, for a page of
  // nine. Children the site publishes as pages of their own are worth
  // listing too: they are the way down from here.
  const subTopics = subTopicsBlock(navigation);
  const readTime = fixedBlock(`\n*Estimated read time: ${summaryResult.estimatedReadTime} min`
    + ` (${summaryResult.totalTokens.toLocaleString()} tokens)*\n`);

  // A long first paragraph must not squeeze the outline down to its count:
  // what an outline is for is the list. So when not everything fits, the
  // paragraph gets at most half the budget.
  const rest = [outlineBlock, subTopics, readTime];
  const restInFull = rest.reduce((sum, block) => sum + estimateTokens(block.fit(Infinity).text), 0);
  const paragraphCap = Math.max(budget - restInFull, Math.floor(budget / 2));
  const summaryBlock: Block = {
    minimal: '',
    fit: (available) => {
      const frame = '## Summary\n\n';
      const paragraph = cutProse(
        summaryResult.summary,
        Math.min(available, paragraphCap) - estimateTokens(`${frame}\n\n`),
      );
      return paragraph === undefined
        ? { text: '', cut: true }
        : { text: `${frame}${paragraph.text}\n\n`, cut: paragraph.cut };
    },
  };

  return composeWithinBudget([summaryBlock, ...rest], budget);
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
 *
 * Both lists are cut to `budget`, each ending with a count of what it left out.
 */
function formatSectionNotFound(
  section: string,
  allSections: ArticleSection[],
  navigation: ArticleNavigation | undefined,
  budget: number,
): ArticleBody {
  const sections = allSections.length > 0
    ? listBlock({
        headers: ['**Available sections:**\n'],
        items: allSections.map(s => `- ${s.title}\n`),
        more: omitted => (omitted > 0 ? `*...and ${omitted} more, ${NOT_LISTED}.*\n` : ''),
        minimal: `**Available sections (${allSections.length}):** ${NOT_LISTED}.\n`,
      })
    : fixedBlock('This article has no headings, so it has no sections to select.\n');

  const reply = composeWithinBudget([
    fixedBlock(`*Section "${section}" not found.*\n\n`),
    sections,
    subTopicsBlock(navigation, section),
  ], budget);
  // Trimmed: the formatter sets the footer off with its own blank line.
  return { content: reply.content.trimEnd(), truncated: reply.truncated };
}

/**
 * The article's child topics as links, or nothing when it has none.
 *
 * With `requested`, children the `section` rule would have matched are listed
 * first and marked, since that is almost always what the caller was after.
 */
function subTopicsBlock(
  navigation: ArticleNavigation | undefined,
  requested?: string,
): Block {
  if (navigation === undefined || navigation.children.length === 0) {
    return fixedBlock('');
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
  const count = String(navigation.childCount);
  const header = `\n**Sub-topics (${count}):** this topic's children in`
    + ' the table of contents, each its own article. learn.jamf.com may show them as'
    + ' sections of this page or as pages of their own.'
    + ' Fetch one with `jamf_docs_get_article` and its url.\n\n';
  // The TOC caps how many children it hands over; those are counted with any
  // the budget left out, and `jamf_docs_get_toc` has all of them either way.
  const unlisted = navigation.childCount - navigation.children.length;
  return listBlock({
    // The full header alone is ~60 tokens. Under a tight budget the bare one
    // leaves room for a link, and the first is the one that matched.
    headers: [header, `\n**Sub-topics (${count}):**\n\n`],
    items: ordered.map((child) => {
      const marker = matching.includes(child) ? ` — matches "${sanitizeMarkdownText(requested ?? '')}"` : '';
      return `- [${sanitizeMarkdownText(child.title)}](${sanitizeMarkdownUrl(child.url)})${marker}\n`;
    }),
    more: (omitted) => {
      const more = omitted + unlisted;
      return more > 0
        ? `\n*...and ${String(more)} more, not listed here; \`jamf_docs_get_toc\` shows them all.*\n`
        : '';
    },
    minimal: `\n*Sub-topics (${count}): ${NOT_LISTED}; \`jamf_docs_get_toc\` shows them all.*\n`,
  });
}

// ─── Fitting a reply to its budget ─────────────────────────────

/** How a list cut to budget says so. */
const NOT_LISTED = 'not listed within `maxTokens`';

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A block cut to a budget, and whether cutting left anything out. */
interface Fitted {
  text: string;
  cut: boolean;
}

/** One part of a reply. */
interface Block {
  /** The block within `budget` tokens, as much of it as fits. */
  fit: (budget: number) => Fitted;
  /**
   * What the block shrinks to when none of it fits. Blocks before it leave
   * room for this, so each later block at least says what it left out.
   */
  minimal: string;
}

/** Text that is never cut. */
function fixedBlock(text: string): Block {
  return { minimal: text, fit: () => ({ text, cut: false }) };
}

/**
 * A list: every item if they fit, else the first items that do followed by
 * `more(omitted)`, else `minimal`. `more(0)` is printed too, so a list can
 * count items it never had.
 *
 * `headers` are the list's header, longest first. A shorter one is used only
 * when the one before it leaves no room for a single item.
 */
function listBlock(list: {
  headers: [string, ...string[]];
  items: string[];
  more: (omitted: number) => string;
  minimal: string;
}): Block {
  const { headers, items, more, minimal } = list;
  return {
    minimal,
    fit: (budget) => {
      const whole = headers[0] + items.join('') + more(0);
      if (estimateTokens(whole) <= budget) {
        return { text: whole, cut: false };
      }
      for (const header of headers) {
        // Per-item estimates add up to at least the estimate of the joined
        // string, so a running sum never admits more than fits.
        let used = estimateTokens(header);
        let shown = 0;
        for (const item of items) {
          const next = used + estimateTokens(item);
          if (next + estimateTokens(more(items.length - shown - 1)) > budget) {
            break;
          }
          used = next;
          shown++;
        }
        if (shown > 0) {
          return {
            text: header + items.slice(0, shown).join('') + more(items.length - shown),
            cut: shown < items.length,
          };
        }
      }
      return { text: minimal, cut: items.length > 0 };
    },
  };
}

/** Prose cut at a word to `budget` tokens and marked with an ellipsis, or nothing if none fits. */
function cutProse(text: string, budget: number): Fitted | undefined {
  if (estimateTokens(text) <= budget) {
    return { text, cut: false };
  }
  if (budget <= 0) {
    return undefined;
  }
  // One character is left for the ellipsis.
  const slice = text.slice(0, budget * TOKEN_CONFIG.CHARS_PER_TOKEN - 1);
  const atWord = slice.lastIndexOf(' ') > 0 ? slice.slice(0, slice.lastIndexOf(' ')) : slice;
  const trimmed = atWord.trimEnd();
  return trimmed === '' ? undefined : { text: `${trimmed}…`, cut: true };
}

/**
 * The blocks, in order, within `budget`.
 *
 * Each block gets what the blocks before it have left, less the `minimal` of
 * every block after it. If even the minimal forms overrun — only when `budget`
 * is barely above a long note — the reply is cut like an article, and says so.
 */
function composeWithinBudget(blocks: Block[], budget: number): { content: string; truncated: boolean } {
  let content = '';
  let truncated = false;
  blocks.forEach((block, index) => {
    const reserved = blocks
      .slice(index + 1)
      .reduce((sum, later) => sum + estimateTokens(later.minimal), 0);
    const fitted = block.fit(budget - estimateTokens(content) - reserved);
    content += fitted.text;
    truncated ||= fitted.cut;
  });

  if (estimateTokens(content) > budget) {
    return { content: truncateToTokenLimit(content, budget, []).content, truncated: true };
  }
  return { content, truncated };
}
