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
import type { ToolResult, GlossaryEntry, GlossaryLookupResult, TokenInfo } from '../types.js';
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

function formatTokenFooter(tokenInfo: TokenInfo, totalMatches: number, returnedCount: number): string {
  let footer = `\n*${returnedCount} of ${totalMatches} match(es) | ${tokenInfo.tokenCount.toLocaleString()} tokens*`;
  if (tokenInfo.truncated) {
    footer += '\n*Results truncated due to token limit. Increase `maxTokens` or narrow your search.*';
  }
  return `${footer}\n`;
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
matches. If some matching entries could not be fetched, the reply answers from the rest and
says so: "incomplete" names the entries it may be missing. If the entry that would lead the
answer is one of them, that is the error above instead.`;

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

        const structuredContent = {
          term: params.term,
          totalMatches: result.totalMatches,
          entries: result.entries.map(e => ({
            term: e.term,
            definition: e.definition,
            ...(e.product !== undefined ? { product: e.product } : {}),
            url: e.url,
          })),
          truncated: result.tokenInfo.truncated,
          ...(result.incomplete !== undefined ? { incomplete: result.incomplete } : {}),
        };

        await reportProgress(extra, { progress: 2, total: 3, message: 'Formatting output...' });

        // No results
        if (result.entries.length === 0) {
          const noResultText = `No glossary entries found for "${params.term}".\n\n*Tip: Try using \`jamf_docs_search\` with \`docType: "glossary"\` for broader results.*`;

          await reportProgress(extra, { progress: 3, total: 3 });
          return {
            content: [{ type: 'text', text: noResultText }],
            structuredContent,
          };
        }

        const nonEnglish = isNonEnglishLocale(params.language);

        // JSON format
        if (params.responseFormat === ResponseFormat.JSON) {
          const jsonPayload: Record<string, unknown> = {
            term: params.term,
            totalMatches: result.totalMatches,
            entries: result.entries,
            tokenInfo: result.tokenInfo,
          };
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
          markdown += formatTokenFooter(result.tokenInfo, result.totalMatches, result.entries.length);
        } else {
          markdown = `# Glossary Lookup: "${params.term}"\n\n`;
          markdown += langWarning;
          markdown += `Found ${result.totalMatches} match${result.totalMatches !== 1 ? 'es' : ''}\n\n`;
          markdown += incompleteNote;
          markdown += '---\n\n';
          for (const entry of result.entries) {
            markdown += formatEntryMarkdown(entry);
          }
          markdown += formatTokenFooter(result.tokenInfo, result.totalMatches, result.entries.length);
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
