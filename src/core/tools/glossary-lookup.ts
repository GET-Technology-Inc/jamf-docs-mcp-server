/**
 * jamf_docs_glossary_lookup tool
 * Look up Jamf glossary terms and get their definitions.
 */

import type { McpServer } from '@modelcontextprotocol/server';
import type { ServerContext } from '../types/context.js';
import { GlossaryLookupInputSchema } from '../schemas/index.js';
import { GlossaryLookupOutputSchema } from '../schemas/output.js';
import { appToolMeta } from '../apps/index.js';
import type { ProductId, LocaleId } from '../constants.js';
import { ResponseFormat, OutputMode, JAMF_PRODUCTS, TOKEN_CONFIG } from '../constants.js';
import type { ToolResult, GlossaryEntry, GlossaryLookupResult } from '../types.js';
import { lookupGlossaryTerm, GlossaryUnavailableError } from '../services/glossary.js';
import { sanitizeMarkdownText, sanitizeMarkdownUrl, getSafeErrorMessage } from '../utils/sanitize.js';
import { reportProgress } from '../utils/progress.js';

const ENGLISH_ONLY_WARNING =
  'Note: Glossary content is currently only available in English (en-US).' +
  ' Showing English results.';

function isNonEnglishLocale(language: string | undefined): boolean {
  if (language === undefined) {
    return false;
  }
  const normalised = language.toLowerCase();
  return normalised !== 'en-us' && normalised !== 'en';
}

function formatEntryMarkdown(entry: GlossaryEntry): string {
  let output = `### ${sanitizeMarkdownText(entry.term)}\n\n`;
  output += `${entry.definition}\n\n`;
  if (entry.product !== undefined) {
    output += `**Product**: ${entry.product} | `;
  }
  output += `**Source**: [${sanitizeMarkdownText(entry.term)}](${sanitizeMarkdownUrl(entry.url)})\n\n`;
  output += '---\n\n';
  return output;
}

function formatEntryCompact(entry: GlossaryEntry, index: number): string {
  const defPreview = entry.definition.length > 100
    ? `${entry.definition.slice(0, 97)}...`
    : entry.definition;
  // Strip newlines for compact view
  const singleLine = defPreview.replace(/\n/g, ' ');
  return `${index}. **${sanitizeMarkdownText(entry.term)}** - ${singleLine}\n`;
}

/**
 * The note a partly fetched answer carries in markdown: the service's
 * sentence, then the entries it is missing as links a caller can fetch.
 */
function formatIncompleteMarkdown(incomplete: NonNullable<GlossaryLookupResult['incomplete']>): string {
  const links = incomplete.unfetched
    .map(e => `[${sanitizeMarkdownText(e.term)}](${sanitizeMarkdownUrl(e.url)})`)
    .join(', ');
  return `> **Results may be incomplete.** ${sanitizeMarkdownText(incomplete.message)}\n>\n` +
    `> Not fetched: ${links}\n\n`;
}

/**
 * What to do when entries match and none fits `maxTokens`.
 *
 * "Increase `maxTokens` or narrow your search" is the note for a partial
 * answer, and half of it is no use here: a single match cannot be narrowed,
 * and narrowing several does not make the first one shorter. What does work is
 * a budget that holds it, and the service says what that is. A figure over the
 * schema's limit is not advice, so that case says so instead of offering it.
 */
function formatNothingFits(result: GlossaryLookupResult): string {
  const { totalMatches } = result;
  const { maxTokens } = result.tokenInfo;
  const omitted = result.truncatedContent?.omittedItems ?? [];
  const lead = omitted[0];
  const named = lead !== undefined ? `, ${sanitizeMarkdownText(lead.title)},` : '';
  const matched = totalMatches === 1
    ? `The one matching entry${named} does not fit in \`maxTokens: ${String(maxTokens)}\`.`
    : `${String(totalMatches)} entries match, but not even the first${named} fits in \`maxTokens: ${String(maxTokens)}\`.`;

  if (lead === undefined) {
    return `${matched} Repeat the lookup with a larger \`maxTokens\` to get ${totalMatches === 1 ? 'it' : 'them'}.`;
  }
  const limit = TOKEN_CONFIG.MAX_TOKENS_LIMIT;
  if (lead.estimatedTokens > limit) {
    return `${matched} It needs ${String(lead.estimatedTokens)} tokens, more than \`maxTokens\` allows (${String(limit)}).`;
  }
  let advice = `Repeat the lookup with \`maxTokens: ${String(lead.estimatedTokens)}\` or more to get it`;
  // Every match is listed when none fits, so their costs add up to the whole
  // answer. Only said when it is a budget the schema accepts.
  const all = omitted.reduce((sum, e) => sum + e.estimatedTokens, 0);
  if (totalMatches > 1 && omitted.length === totalMatches && all <= limit) {
    advice += `, or \`maxTokens: ${String(all)}\` for all ${String(totalMatches)}`;
  }
  return `${matched} ${advice}.`;
}

function formatTokenFooter(result: GlossaryLookupResult): string {
  const { tokenInfo, totalMatches } = result;
  let footer = `\n*${result.entries.length} of ${totalMatches} match(es) | ${tokenInfo.tokenCount.toLocaleString()} tokens*`;
  if (tokenInfo.truncated) {
    footer += result.entries.length === 0
      ? `\n*${formatNothingFits(result)}*`
      : '\n*Results truncated due to token limit. Increase `maxTokens` or narrow your search.*';
  }
  return `${footer}\n`;
}

/** What the structured channel carries: `GlossaryLookupOutputSchema`, in every reply. */
function buildStructuredContent(term: string, result: GlossaryLookupResult): Record<string, unknown> {
  return {
    term,
    totalMatches: result.totalMatches,
    entries: result.entries.map(e => ({
      term: e.term,
      definition: e.definition,
      ...(e.product !== undefined ? { product: e.product } : {}),
      url: e.url,
    })),
    truncated: result.tokenInfo.truncated,
    ...(result.truncatedContent !== undefined ? { truncatedContent: result.truncatedContent } : {}),
    ...(result.incomplete !== undefined ? { incomplete: result.incomplete } : {}),
  };
}

const TOOL_NAME = 'jamf_docs_glossary_lookup';

/**
 * Examples and errors checked against the live glossary on 2026-09-24.
 *
 * The old example, "What does DEP stand for?" → `term="DEP"`, answered with
 * the entry for "zero-touch deployment", so it taught a client to expect a
 * definition it would not get. "Automated Device Enrollment", DEP's current
 * name, is an exact entry. The no-match text is "No glossary entries found",
 * and an unknown `product` is rejected by the schema's enum before the
 * handler's own "Invalid product ID" check can run.
 *
 * `product` filters nothing, and the description says so. Jamf publishes one
 * platform-wide glossary with no product classification, so until 2026-09-24
 * this promised a filter that was never applied, a `product` field on each
 * entry that was never set, and a no-result hint to "try removing the product
 * filter" that could not change the answer. It stays in the schema because
 * the schema is strict: removing it would reject callers that send it.
 *
 * "No glossary entries found" is listed as a note, not an error, because it
 * never was one: `isError` was always unset. Until 2026-09-24 it was also what
 * a lookup answered when learn.jamf.com could not be reached, so a client
 * concluded that a term it could not check did not exist. A failed read is
 * now the error listed above it.
 *
 * Until 2026-09-26 it was also the answer for a term whose entry did not fit
 * `maxTokens`, since the check read no entries as no match: live at
 * `maxTokens: 100`, six of the 123 terms looked up by their own title, Apple
 * School Manager (134 tokens) among them. The note now says which reply that
 * is, and "truncatedContent" in Returns is where the budget comes from.
 */
const TOOL_DESCRIPTION = `Look up a term in the Jamf official glossary and get its definition.

This tool searches the Jamf Platform Technical Glossary, one glossary shared by
every Jamf product, and returns matching term definitions using fuzzy matching.
A term of 4 characters or fewer is treated as an abbreviation and must be a
whole word of the entry's name, so "DEP" does not match "zero-touch deployment".
A 4-character term may be a plural, or miss a letter or swap two ("MDMs", "LDPA").

Note: Glossary content is currently only available in English (en-US).
Non-English language parameters are accepted but results will be in English.

Args:
  - term (string, required): Glossary term to look up (2-100 characters). Supports fuzzy matching.
  - product (string, optional): Accepted, but does not filter: Jamf publishes one platform-wide glossary with no product classification
  - language (string, optional): Documentation language/locale (default: en-US). Note: glossary is English-only.
  - maxTokens (number, optional): Maximum tokens in response ${TOKEN_CONFIG.MIN_TOKENS}-${TOKEN_CONFIG.MAX_TOKENS_LIMIT} (default: ${TOKEN_CONFIG.DEFAULT_MAX_TOKENS})
  - outputMode ('full' | 'compact'): Output detail level (default: 'full')
  - responseFormat ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  For JSON format:
  {
    "term": string,
    "totalMatches": number,
    "entries": [{ "term": string, "definition": string, "url": string }],
    "tokenInfo": { "tokenCount": number, "truncated": boolean, "maxTokens": number },
    "truncatedContent"?: { "omittedCount": number, "omittedItems": [{ "title": string, "estimatedTokens": number }] },
    "incomplete"?: { "unfetched": [{ "term": string, "url": string }], "message": string }
  }

  For Markdown format:
  A formatted list of glossary definitions with source links.

Examples:
  - "What is MDM?" → term="MDM"
  - "What is a configuration profile?" → term="Configuration Profile"
  - "What is Automated Device Enrollment (formerly DEP)?" → term="Automated Device Enrollment"

Errors:
  - "Glossary lookup for "<term>" failed: ..." (isError) if learn.jamf.com could not be read (a
    network error, a timeout, or a server error), so the lookup cannot say whether the glossary
    has the term. This is not a "no match". It may be temporary: try again.
  - "Invalid option: expected one of ..." (an input validation error) if product is not a known product ID

Note: "No glossary entries found" is not an error. It means the glossary was read and no entry
matches; in JSON that is "totalMatches": 0. If entries match but not even the first fits in
maxTokens, the reply says how many matched and the maxTokens the first one needs:
"truncatedContent" lists each entry left out and the tokens it costs. If some matching entries
could not be fetched, the reply answers from the rest and says so: "incomplete" names the entries
it may be missing. If the entry that would lead the answer is one of them, that is the error
above instead.`;

export function registerGlossaryLookupTool(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: 'Lookup Jamf Glossary Term',
      description: TOOL_DESCRIPTION,
      inputSchema: GlossaryLookupInputSchema,
      outputSchema: GlossaryLookupOutputSchema,
      // Hosts supporting the MCP Apps extension render this result in the
      // shared viewer; others ignore the metadata and get the markdown. The
      // glossary view reuses the search view's components wholesale — a term
      // is a title, a definition is a snippet — so it was the cheapest way to
      // check that the component set generalises past the three views it was
      // drawn against.
      _meta: appToolMeta(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args, extra): Promise<ToolResult> => {
      const parseResult = GlossaryLookupInputSchema.safeParse(args);
      if (!parseResult.success) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Invalid input: ${parseResult.error.message}` }],
        };
      }
      const params = parseResult.data;

      try {
        if (params.product !== undefined && !(params.product in JAMF_PRODUCTS)) {
          return {
            isError: true,
            content: [{
              type: 'text',
              text: `Invalid product ID: "${params.product}". Valid options: ${Object.keys(JAMF_PRODUCTS).join(', ')}`,
            }],
          };
        }

        await reportProgress(extra, { progress: 0, total: 3, message: 'Looking up term...' });

        const result = await lookupGlossaryTerm(ctx, {
          term: params.term,
          product: params.product as ProductId | undefined,
          language: params.language as LocaleId | undefined,
          maxTokens: params.maxTokens ?? TOKEN_CONFIG.DEFAULT_MAX_TOKENS,
        });

        await reportProgress(extra, { progress: 1, total: 3, message: 'Processing matches...' });

        const structuredContent = buildStructuredContent(params.term, result);

        await reportProgress(extra, { progress: 2, total: 3, message: 'Formatting output...' });

        const nonEnglish = isNonEnglishLocale(params.language);

        // JSON format, whatever the result: the body the description
        // documents is the answer to a no-match as well, `totalMatches: 0`.
        // Until 2026-09-26 the no-match check came first and answered JSON
        // callers with its markdown sentence.
        if (params.responseFormat === ResponseFormat.JSON) {
          const jsonPayload: Record<string, unknown> = {
            term: params.term,
            totalMatches: result.totalMatches,
            entries: result.entries,
            tokenInfo: result.tokenInfo,
          };
          if (result.truncatedContent !== undefined) {
            jsonPayload.truncatedContent = result.truncatedContent;
          }
          if (result.incomplete !== undefined) {
            jsonPayload.incomplete = result.incomplete;
          }
          if (nonEnglish) {
            jsonPayload.warning = ENGLISH_ONLY_WARNING;
          }
          await reportProgress(extra, { progress: 3, total: 3 });
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(jsonPayload, null, 2),
            }],
            structuredContent,
          };
        }

        // No match: nothing in the glossary matches the term. Decided on
        // `totalMatches`, as `jamf_docs_search` decides on its total, and not
        // on `entries` alone: no entries beside a nonzero total means the
        // matches did not fit `maxTokens`, and the renderers below say so and
        // what budget holds them. Until 2026-09-26 that case answered this
        // sentence too, for a term the glossary has.
        if (result.totalMatches === 0 && result.entries.length === 0) {
          const noResultText = `No glossary entries found for "${params.term}".\n\n*Tip: Try using \`jamf_docs_search\` with \`docType: "glossary"\` for broader results.*`;

          await reportProgress(extra, { progress: 3, total: 3 });
          return {
            content: [{ type: 'text', text: noResultText }],
            structuredContent,
          };
        }

        // Markdown format
        const langWarning = nonEnglish ? `> ${ENGLISH_ONLY_WARNING}\n\n` : '';
        const incompleteNote = result.incomplete !== undefined
          ? formatIncompleteMarkdown(result.incomplete)
          : '';
        let markdown: string;
        if (params.outputMode === OutputMode.COMPACT) {
          markdown = `## Glossary: "${params.term}" (${result.totalMatches} match${result.totalMatches !== 1 ? 'es' : ''})\n\n`;
          markdown += langWarning;
          markdown += incompleteNote;
          result.entries.forEach((entry, idx) => {
            markdown += formatEntryCompact(entry, idx + 1);
          });
          markdown += formatTokenFooter(result);
        } else {
          markdown = `# Glossary Lookup: "${params.term}"\n\n`;
          markdown += langWarning;
          markdown += `Found ${result.totalMatches} match${result.totalMatches !== 1 ? 'es' : ''}\n\n`;
          markdown += incompleteNote;
          markdown += '---\n\n';
          for (const entry of result.entries) {
            markdown += formatEntryMarkdown(entry);
          }
          markdown += formatTokenFooter(result);
        }

        await reportProgress(extra, { progress: 3, total: 3 });
        return {
          content: [{ type: 'text', text: markdown }],
          structuredContent,
        };
      } catch (error) {
        // The glossary could not be read. Its message is written for the
        // caller and ends with what to do, so it goes out as is: the generic
        // advice below, "use different search terms", is wrong for an outage.
        if (error instanceof GlossaryUnavailableError) {
          return {
            isError: true,
            content: [{ type: 'text', text: getSafeErrorMessage(error) }],
          };
        }
        return {
          isError: true,
          content: [{
            type: 'text',
            text: `Glossary lookup error: ${getSafeErrorMessage(error)}\n\nPlease try again or use different search terms.`,
          }],
        };
      }
    },
  );
}
