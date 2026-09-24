/**
 * jamf_docs_get_article tool
 * Retrieve the full content of a specific Jamf documentation article.
 */

import type { McpServer } from '@modelcontextprotocol/server';
import type { ServerContext } from '../types/context.js';
import { appToolMeta } from '../apps/index.js';
import { GetArticleInputSchema } from '../schemas/index.js';
import { reportProgress } from '../utils/progress.js';
import { ArticleOutputSchema, type ArticleStructuredOutput } from '../schemas/output.js';
import { ResponseFormat, OutputMode, TOKEN_CONFIG, type LocaleId } from '../constants.js';
import type {
  ToolResult,
  ArticleResponse,
  ArticleSection,
  FetchArticleOptions,
  FetchArticleResult,
  ParsedArticle,
} from '../types.js';
import { getSafeErrorMessage } from '../utils/sanitize.js';
import { ALLOWED_HOSTNAME_LIST, ALLOWED_HOSTNAME_MESSAGE } from '../utils/url.js';
import { STATIC_SOURCE_HOSTNAMES } from '../constants/sources.js';
import { resolveAndFetchArticle } from '../services/article-service.js';
import {
  buildArticleContentView,
  formatArticleCompact,
  formatArticleFull,
  type ArticleContentView,
} from '../utils/format-article.js';

const TOOL_NAME = 'jamf_docs_get_article';

/** What the structured channel does with one field of a provider's article. */
type ArticleFieldDisposition =
  /** Copied through verbatim when the provider set it. */
  | 'publish'
  /** Emitted, but from `view` rather than from the article — see below. */
  | 'replace'
  /** Deliberately not on this channel. */
  | 'withhold';

/**
 * Every field of {@link ParsedArticle}, and what becomes of it here.
 *
 * The `satisfies Record<keyof ParsedArticle, …>` is the whole point. This
 * function used to enumerate its output key by key, which made it a second,
 * silent schema: an `ArticleProvider` could return a field and have it dropped
 * on the structured channel — the one a program reads — with no error anywhere,
 * and that happened three times in a week (`lastUpdated`, then `breadcrumb` on
 * search results, then `versionStatus`/`contentLocale`/`navigation` here, all
 * of them present in the markdown channel and absent at the client).
 *
 * So the allowlist is now derived from the provider contract instead of
 * maintained alongside it: add a field to `ParsedArticle` and this object stops
 * compiling until someone says what happens to it. That is the design decision
 * behind issue #215 — option (1), "add the keys", but with the maintenance cost
 * it warns about converted from a silent drop into a build failure.
 */
const ARTICLE_FIELD_DISPOSITION = {
  title: 'publish',
  url: 'publish',
  product: 'publish',
  version: 'publish',
  lastUpdated: 'publish',
  breadcrumb: 'publish',
  mapId: 'publish',
  contentId: 'publish',
  versionStatus: 'publish',
  contentLocale: 'publish',
  navigation: 'publish',
  // `view` — not the article — supplies the body, so that `outputMode:
  // 'compact'` compacts the half programmatic consumers actually read. Copying
  // `article.content` through here would republish the whole body next to the
  // preview and undo that.
  content: 'replace',
  // Markdown-only: they are rendered as a link list at the foot of the article
  // and only when `includeRelated` asked for them, so publishing them
  // unconditionally would hand out a payload the caller declined.
  relatedArticles: 'withhold',
} as const satisfies Record<keyof ParsedArticle, ArticleFieldDisposition>;

/** The subset of `ParsedArticle` keys the loop below copies through. */
type PublishedArticleField = {
  [K in keyof typeof ARTICLE_FIELD_DISPOSITION]:
    (typeof ARTICLE_FIELD_DISPOSITION)[K] extends 'publish' ? K : never
}[keyof typeof ARTICLE_FIELD_DISPOSITION];

/**
 * Compile error unless every `publish` field above is declared on
 * `ArticleOutputSchema`.
 *
 * A key the builder emits but the schema does not declare is a key the tool
 * cannot promise a client: `tools/list` advertises the schema, and the SDK
 * validates `structuredContent` against it before the result goes out. Catching
 * the mismatch here means the two lists cannot disagree, rather than the
 * disagreement surfacing as an output-validation error mid-call.
 */
type MustBeDeclared<Declared, Published extends Declared> = Published;
export type PublishedArticleFieldsAreDeclared = MustBeDeclared<
  keyof ArticleStructuredOutput,
  PublishedArticleField
>;

/**
 * The machine-readable view of an article, for clients that render it — the
 * MCP App, chiefly — rather than reading the markdown.
 *
 * Optional fields are omitted rather than emitted as `undefined`, so the
 * payload stays a faithful JSON object: a client can tell "the provider does
 * not know this article's `versionStatus`" from "it is `latest`", which an
 * emitted `null` would erase.
 */
function buildArticleStructuredContent(
  article: FetchArticleResult,
  sections: ArticleSection[],
  view: ArticleContentView,
): Record<string, unknown> {
  const published: Record<string, unknown> = {};
  for (const [field, disposition] of Object.entries(ARTICLE_FIELD_DISPOSITION)) {
    if (disposition !== 'publish') {
      continue;
    }
    const value = article[field as keyof ParsedArticle];
    if (value !== undefined) {
      published[field] = value;
    }
  }

  return {
    ...published,
    content: view.content,
    tokenCount: view.tokenCount,
    sections: sections.map(s => ({
      id: s.id,
      title: s.title,
      level: s.level,
      tokenCount: s.tokenCount
    })),
    truncated: view.truncated
  };
}

/** Returned when neither addressing form is complete. Quoted in the description. */
const MISSING_ADDRESS_MESSAGE = 'Either url or both mapId and contentId must be provided.';

/**
 * What `tools/list` tells a client about this tool.
 *
 * Until 2026-09-24 this said `url (string, required)` and left `mapId`,
 * `contentId` and `language` out of Args altogether, while the schema has had
 * `url` optional since the mapId + contentId pair was added in #78. So a
 * client holding the pair a search result hands it was told it could not use
 * it. The READMEs had the same drift and were corrected in #303;
 * `description-accuracy.test.ts` now checks every Args list against its
 * schema's properties and `required` array.
 *
 * Both addressing forms at once is allowed and described, not rejected. A
 * search result carries url, mapId and contentId together, so a client passes
 * all three; 46 of 48 sampled results' urls resolve to their own pair, and the
 * other two (the LAPS technical paper, where two topics share each of the
 * slugs `Using_LAPS` and `Implementing_LAPS`) are only right because the pair
 * decides. What was wrong was the label: until 2026-09-24 a Policies.html url
 * with the Computer Configuration Profiles pair returned the latter under the
 * former's link, and a concepts.jamf.com url dropped the pair without a word.
 * The article is now labelled with its own address, a note names an argument
 * that went unused, and the description says which one wins.
 *
 * A missed `section` is likewise not an error, and the description no longer
 * files it under Errors: it never returned `isError`, and the reply is still
 * the article's metadata and navigation. What it lists changed — see
 * `formatSectionNotFound` in services/article-view.ts.
 *
 * The example URL changed at the same time: `.../page/Configuration_Profiles.html`
 * answered "Topic not found" (live, 2026-09-24); the page Jamf publishes is
 * `Computer_Configuration_Profiles`.
 */
const TOOL_DESCRIPTION = `Retrieve the full content of a specific Jamf documentation article.

This tool fetches and parses a Jamf documentation article, converting it to
a clean, readable format. Works with any article from ${ALLOWED_HOSTNAME_LIST}.

Address the article either by \`url\`, or by the \`mapId\` + \`contentId\` pair
that search results and TOC entries carry. One of the two is required. Passing
both, as a search result allows, is fine: on learn.jamf.com the pair decides
which article is fetched, and the result's url is that article's own address
(a note says so if the url you passed does not match it). A
${STATIC_SOURCE_HOSTNAMES.join(' or ')} url is fetched by url, and a note says
the pair was ignored.

Args:
  - url (string, optional): Full https:// URL of the article, on ${ALLOWED_HOSTNAME_LIST}. Required unless mapId and contentId are given
  - mapId (string, optional): Fluid Topics map ID, from a search result or a TOC. Use with contentId, instead of url or alongside it
  - contentId (string, optional): Fluid Topics content ID, from a search result or a TOC entry. Use with mapId, instead of url or alongside it
  - language (string, optional): Documentation language/locale. Overrides the locale in url, which is used when this is omitted. No effect on a mapId + contentId pair (a map is in one language) or on ${STATIC_SOURCE_HOSTNAMES.join(' or ')} URLs
  - section (string, optional): Extract only a specific section by title or ID (e.g., "Prerequisites", "Configuration")
  - summaryOnly (boolean, optional): Return only article summary and outline instead of full content (default: false). Token-efficient way to preview an article and its sub-topics
  - includeRelated (boolean, optional): Include links to related articles (default: false)
  - maxTokens (number, optional): Maximum tokens in response ${TOKEN_CONFIG.MIN_TOKENS}-${TOKEN_CONFIG.MAX_TOKENS_LIMIT} (default: ${TOKEN_CONFIG.DEFAULT_MAX_TOKENS})
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
  - Get full article: url="https://learn.jamf.com/en-US/bundle/jamf-pro-documentation/page/Computer_Configuration_Profiles.html"
  - Fetch a search result directly: mapId="...", contentId="..." (both from the result)
  - Get specific section: url="...", section="Prerequisites"
  - Limit response size: url="...", maxTokens=2000

Errors:
  - "${MISSING_ADDRESS_MESSAGE}" if neither url nor the full pair is given
  - "${ALLOWED_HOSTNAME_MESSAGE}" (an input validation error) if url is not https:// on one of those hosts
  - "Topic not found", "Cannot resolve bundleId" or "HTTP 404" if there is no article at that address

Note: \`maxTokens\` bounds every reply: the article or one section, a
\`summaryOnly\` outline, a missed section's reply, and any note about how the
call was resolved, all counted in \`tokenInfo.tokenCount\`. Large articles are
intelligently truncated with remaining sections listed, as many as fit; a list
cut to fit says how many it left out, and \`truncated\` is true.
Use the \`section\` parameter to retrieve specific sections for long articles.
A \`section\` that matches no heading is not an error: the reply says
'Section "<section>" not found' and lists the article's sections, or says it has
none. Most learn.jamf.com topics have no headings; what the website shows as
their sections are sub-topics, which the reply lists with their urls, a matching
one first.`;

export function registerGetArticleTool(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: 'Get Jamf Documentation Article',
      description: TOOL_DESCRIPTION,
      inputSchema: GetArticleInputSchema,
      outputSchema: ArticleOutputSchema,
      // Hosts supporting the MCP Apps extension render this result in the
      // shared viewer; others ignore the metadata and get the markdown.
      _meta: appToolMeta(),
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
            content: [{ type: 'text', text: MISSING_ADDRESS_MESSAGE }]
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

        // `outputMode` governs how much of the body goes out, on every channel:
        // markdown, JSON and structuredContent alike. Applying it to only one of
        // them is what made "compact" a markdown-only illusion.
        const view = buildArticleContentView(article, params.outputMode === OutputMode.COMPACT);

        // Build response
        const response: ArticleResponse = {
          ...article,
          content: view.content,
          format: params.responseFormat,
          tokenInfo: {
            ...tokenInfo,
            tokenCount: view.tokenCount,
            truncated: view.truncated,
          },
          sections
        };

        const structuredContent = buildArticleStructuredContent(article, sections, view);

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
              // An outline is already the list of sections. Cut to fit
              // `maxTokens`, it is marked truncated, and the formatter would
              // then print the whole list again under it.
              sections: params.summaryOnly ? undefined : sections,
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
