/**
 * jamf_docs_glossary_lookup tool
 * Look up Jamf glossary terms and get their definitions.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerContext } from '../types/context.js';
import { GlossaryLookupInputSchema } from '../schemas/index.js';
import { GlossaryLookupOutputSchema } from '../schemas/output.js';
import type { ProductId, LocaleId } from '../constants.js';
import { ResponseFormat, OutputMode, JAMF_PRODUCTS, TOKEN_CONFIG } from '../constants.js';
import type { ToolResult, GlossaryEntry, TokenInfo } from '../types.js';
import { lookupGlossaryTerm } from '../services/glossary.js';
import { sanitizeMarkdownText, sanitizeMarkdownUrl, getSafeErrorMessage } from '../utils/sanitize.js';
import { reportProgress } from '../utils/progress.js';

const ENGLISH_ONLY_WARNING =
  'Note: Glossary content is currently only available in English (en-US).' +
  ' Showing English results.';

function isNonEnglishLocale(language: string | undefined): boolean {
  if (language === undefined) return false;
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

function formatTokenFooter(tokenInfo: TokenInfo, totalMatches: number, returnedCount: number): string {
  let footer = `\n*${returnedCount} of ${totalMatches} match(es) | ${tokenInfo.tokenCount.toLocaleString()} tokens*`;
  if (tokenInfo.truncated) {
    footer += '\n*Results truncated due to token limit. Increase `maxTokens` or narrow your search.*';
  }
  return `${footer}\n`;
}

const TOOL_NAME = 'jamf_docs_glossary_lookup';

const TOOL_DESCRIPTION = `Look up a term in the Jamf official glossary and get its definition.

This tool searches glossary pages across Jamf product documentation and returns
matching term definitions using fuzzy matching.

Note: Glossary content is currently only available in English (en-US).
Non-English language parameters are accepted but results will be in English.

Args:
  - term (string, required): Glossary term to look up (2-100 characters). Supports fuzzy matching.
  - product (string, optional): Filter by product ID (use jamf_docs_list_products to see all)
  - language (string, optional): Documentation language/locale (default: en-US). Note: glossary is English-only.
  - maxTokens (number, optional): Maximum tokens in response 100-50000 (default: 5000)
  - outputMode ('full' | 'compact'): Output detail level (default: 'full')
  - responseFormat ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  For JSON format:
  {
    "term": string,
    "totalMatches": number,
    "entries": [{ "term": string, "definition": string, "product": string, "url": string }],
    "tokenInfo": { "tokenCount": number, "truncated": boolean, "maxTokens": number }
  }

  For Markdown format:
  A formatted list of glossary definitions with source links.

Examples:
  - "What is MDM?" → term="MDM"
  - "Configuration Profile in Jamf Pro" → term="Configuration Profile", product="jamf-pro"
  - "What does DEP stand for?" → term="DEP"

Errors:
  - "No matching term found" if no glossary entries match
  - "Invalid product ID" if product parameter is not recognized`;

export function registerGlossaryLookupTool(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: 'Lookup Jamf Glossary Term',
      description: TOOL_DESCRIPTION,
      inputSchema: GlossaryLookupInputSchema,
      outputSchema: GlossaryLookupOutputSchema,
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
        };

        await reportProgress(extra, { progress: 2, total: 3, message: 'Formatting output...' });

        // No results
        if (result.entries.length === 0) {
          const productHint = params.product !== undefined
            ? ' Try removing the product filter or use a different term.'
            : '';
          const noResultText = `No glossary entries found for "${params.term}".${productHint}\n\n*Tip: Try using \`jamf_docs_search\` with \`docType: "glossary"\` for broader results.*`;

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
        let markdown: string;
        if (params.outputMode === OutputMode.COMPACT) {
          markdown = `## Glossary: "${params.term}" (${result.totalMatches} match${result.totalMatches !== 1 ? 'es' : ''})\n\n`;
          markdown += langWarning;
          result.entries.forEach((entry, idx) => {
            markdown += formatEntryCompact(entry, idx + 1);
          });
          markdown += formatTokenFooter(result.tokenInfo, result.totalMatches, result.entries.length);
        } else {
          markdown = `# Glossary Lookup: "${params.term}"\n\n`;
          markdown += langWarning;
          markdown += `Found ${result.totalMatches} match${result.totalMatches !== 1 ? 'es' : ''}\n\n---\n\n`;
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
