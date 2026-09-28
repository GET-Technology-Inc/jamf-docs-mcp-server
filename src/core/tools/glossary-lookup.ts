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
import { ResponseFormat, OutputMode, JAMF_PRODUCTS, TOKEN_CONFIG, DEFAULT_LOCALE } from '../constants.js';
import type { ToolResult, GlossaryEntry, GlossaryLookupResult, TruncatedContentInfo } from '../types.js';
import { lookupGlossaryTerm, GlossaryUnavailableError, type GlossaryLookupAnswer } from '../services/glossary.js';
import { estimateTokens } from '../services/tokenizer.js';
import { sanitizeMarkdownText, sanitizeMarkdownUrl, getSafeErrorMessage } from '../utils/sanitize.js';
import { reportProgress } from '../utils/progress.js';
import { failureReason } from '../services/failure-reason.js';
import { NON_LATIN_LETTER } from '../utils/cjk.js';

const ENGLISH_ONLY_WARNING =
  'Note: Glossary content is currently only available in English (en-US).' +
  ' Showing English results.';

/** `language`, unless it is English (en-US or `en`) or not given. */
function nonEnglishLocale(language: string | undefined): string | undefined {
  if (language === undefined) {
    return undefined;
  }
  const normalised = language.toLowerCase();
  return normalised !== 'en-us' && normalised !== 'en' ? language : undefined;
}

/**
 * Whether the answer came from the English glossary. The lookup says which
 * glossary it read; a `GlossaryProvider`'s answer does not, and is taken to be
 * English, as every answer was before the lookup said (2026-09-28).
 */
function fromEnglishGlossary(result: GlossaryLookupAnswer): boolean {
  return (result.resolvedLocale ?? DEFAULT_LOCALE) === DEFAULT_LOCALE;
}

/**
 * Why the English glossary may have had nothing for a term, and where to look
 * instead; `code` marks up a name to type.
 *
 * Jamf publishes its glossary in en-US only (one glossary map in the live maps
 * list, 2026-09-28) and names its entries in English. Until 2026-09-28 a term
 * in another language that matched none of them got "No glossary entries
 * found" and nothing more, and in JSON a warning that said "Showing English
 * results." beside none: live that day, 憑證 and 密碼 in zh-TW, and 認証 and
 * 証明書 in ja-JP.
 *
 * Only a term with a letter of a script other than Latin is told to look up
 * the English term instead. A Latin one may already be English, mistyped or
 * missing from the glossary, as `Smart Grup` asked in zh-TW is; it is told
 * only which glossary was read.
 *
 * Undefined for a Latin term asked in English, and when the glossary read is
 * in the language asked for.
 */
function englishGlossaryNote(
  term: string,
  language: string | undefined,
  result: GlossaryLookupAnswer,
  code: (name: string) => string,
): string | undefined {
  if (!fromEnglishGlossary(result)) { return undefined; }
  const asked = nonEnglishLocale(language);
  const notEnglish = NON_LATIN_LETTER.test(term);
  if (asked === undefined && !notEnglish) { return undefined; }
  const read = asked !== undefined
    ? `Jamf does not publish the glossary in ${asked}, so the term was looked up in the English (en-US) glossary`
    : 'The term was looked up in the English (en-US) glossary';
  if (!notEnglish) { return `Note: ${read}, whose entries are named in English.`; }
  const where = asked !== undefined ? `and ${code(`language: "${asked}"`)}` : 'in the language it is written in';
  return `Note: ${read}, whose entries are named in English. Look up the English term instead, ` +
    `or search for it with ${code('jamf_docs_search')} ${where}.`;
}

/**
 * What a reply says about the glossary's language, if anything: for a
 * no-match, {@link englishGlossaryNote}; for matches from the English glossary
 * to a term asked in another language, that they are English.
 */
function languageNote(
  params: { term: string; language?: string | undefined },
  result: GlossaryLookupAnswer,
  code: (name: string) => string,
): string | undefined {
  if (result.totalMatches === 0 && result.entries.length === 0) {
    return englishGlossaryNote(params.term, params.language, result, code);
  }
  return nonEnglishLocale(params.language) !== undefined && fromEnglishGlossary(result)
    ? ENGLISH_ONLY_WARNING
    : undefined;
}

/** A name to type, in markdown. */
function codeSpan(name: string): string {
  return `\`${name}\``;
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
 * " Look up <which> by its own name to get it: …", naming each of `entries`
 * that fits in the largest `maxTokens` on its own, or nothing when none does.
 *
 * For the entries no `maxTokens` brings into this answer: those left out of
 * one cut at the largest, or of one the largest would cut at the same entry,
 * and those after a first entry larger than it. An entry looked up by its
 * own name ranks first (see the service's `boundaryMatchRank`), so it is
 * returned if it fits in the budget it is looked up with. `maxTokens` is the
 * budget this lookup had. When a named entry costs more than that, the line
 * gives the largest cost among those it names, a budget that gets each of
 * them (", with `maxTokens: 20007` or more,"), so that the lookup it advises
 * is not one that answers "does not fit" again.
 *
 * When that cost is the largest `maxTokens` itself, the line says so (", with
 * `maxTokens: 50000` (the largest it can be),"). Until 2026-09-28 it said "or
 * more" there too, and no budget the schema accepts is more.
 */
function lookUpByName(entries: TruncatedContentInfo['omittedItems'], which: string, maxTokens: number): string {
  const limit = TOKEN_CONFIG.MAX_TOKENS_LIMIT;
  const fitting = entries.filter(e => e.estimatedTokens <= limit);
  if (fitting.length === 0) {
    return '';
  }
  const needs = fitting.reduce((most, e) => Math.max(most, e.estimatedTokens), 0);
  const budget = needs <= maxTokens ? '' : `, with ${budgetOf(needs)},`;
  const names = fitting.map(e => sanitizeMarkdownText(e.title)).join(', ');
  return ` Look up ${which} by its own name${budget} to get it: ${names}.`;
}

/**
 * A budget to advise, for a cost of at most the largest `maxTokens`:
 * "`maxTokens: 134` or more", or at the largest itself, "`maxTokens: 50000`
 * (the largest it can be)", since no budget is more.
 */
function budgetOf(needs: number): string {
  return needs < TOKEN_CONFIG.MAX_TOKENS_LIMIT
    ? `\`maxTokens: ${String(needs)}\` or more`
    : `\`maxTokens: ${String(needs)}\` (the largest it can be)`;
}

/**
 * What to do when entries match and none fits `maxTokens`.
 *
 * "Increase `maxTokens` or narrow your search" is the note for a partial
 * answer, and half of it is no use here: a single match cannot be narrowed,
 * and narrowing several does not make the first one shorter. What does work is
 * a budget that holds it, and the service says what that is. A figure over the
 * schema's limit is not advice, so that case says so instead of offering it,
 * and names the other matches a lookup by name can get, at any `maxTokens`.
 * A figure of the limit itself is advised as the largest `maxTokens` can be.
 * Until 2026-09-28 it was "`maxTokens: 50000` or more", and no budget the
 * schema accepts is more.
 *
 * At the limit itself no budget is advice either. Until 2026-09-28 a reply
 * that did not say what the first entry costs advised "a larger `maxTokens`"
 * there too, the shape #364 fixed for `jamf_docs_get_toc`. It now says the
 * budget is the largest there is, and, when several match, to narrow the
 * search. That is the half of the partial answer's note that is left: no
 * budget holds the first entry, but a narrower term can lead with another
 * entry, one that fits.
 *
 * A `GlossaryProvider` can say its first entry costs no more than the budget
 * it did not fit in: its cut and its costs disagree. Until 2026-09-28 the
 * reply advised that figure, a `maxTokens` the lookup already had ("Repeat
 * the lookup with `maxTokens: 80` or more" at 100). At the limit such a reply
 * now gets the sentence above. Below it, the reply says the cost it was given
 * and that it did not fit, and advises a larger `maxTokens` with no figure,
 * as when no cost is given.
 */
function formatNothingFits(result: GlossaryLookupResult): string {
  const { totalMatches } = result;
  const { maxTokens } = result.tokenInfo;
  const omitted = result.truncatedContent?.omittedItems ?? [];
  const lead = omitted[0];
  const named = lead !== undefined ? `, ${sanitizeMarkdownText(lead.title)},` : '';
  const budget = `\`maxTokens: ${String(maxTokens)}\``;
  const matched = totalMatches === 1
    ? `The one matching entry${named} does not fit in ${budget}`
    : `${String(totalMatches)} entries match, but not even the first${named} fits in ${budget}`;
  const larger = `Repeat the lookup with a larger \`maxTokens\` to get ${totalMatches === 1 ? 'it' : 'them'}.`;

  const limit = TOKEN_CONFIG.MAX_TOKENS_LIMIT;
  if (lead !== undefined && lead.estimatedTokens > limit) {
    return `${matched}. It needs ${String(lead.estimatedTokens)} tokens, more than \`maxTokens\` allows ` +
      `(${String(limit)}).${lookUpByName(omitted.slice(1), 'another entry', maxTokens)}`;
  }
  if (maxTokens >= limit) {
    return `${matched}, which is the largest \`maxTokens\` can be.${totalMatches > 1 ? ' Narrow your search.' : ''}`;
  }
  if (lead === undefined) {
    return `${matched}. ${larger}`;
  }
  if (lead.estimatedTokens <= maxTokens) {
    return `${matched}, although its cost is given as ${String(lead.estimatedTokens)} tokens. ${larger}`;
  }
  let advice = `Repeat the lookup with ${budgetOf(lead.estimatedTokens)} to get it`;
  // Every match is listed when none fits, so their costs add up to the whole
  // answer. Only said when it is a budget the schema accepts.
  const all = omitted.reduce((sum, e) => sum + e.estimatedTokens, 0);
  if (totalMatches > 1 && omitted.length === totalMatches && all <= limit) {
    advice += `, or \`maxTokens: ${String(all)}\` for all ${String(totalMatches)}`;
  }
  return `${matched}. ${advice}.`;
}

/**
 * The line under an answer that some matching entries were left out of.
 *
 * Below the largest `maxTokens` a larger one is the advice when it gets the
 * next entry, and a reply at that limit says what then works. At the limit,
 * until 2026-09-28 it still said "Increase `maxTokens`", as
 * `jamf_docs_get_toc` did until #364. It now names the entries left out that
 * a lookup by name gets, if any, or, when the result does not list them, says
 * to narrow the search.
 *
 * Below the limit a larger `maxTokens` is no use either when the next entry
 * left out and those shown cost more than the limit together: the cut stops
 * at the first entry that does not fit, so the answer at the limit shows the
 * same entries. #372 fixed the line at the limit and left this case, which
 * until 2026-09-28 still said "Increase `maxTokens`", at 49999 with 40008
 * tokens shown and a next entry of 20006 for one. It now says why no budget
 * gets that entry and, as at the limit, names the lookups by name that do,
 * with the budget they need when the lookup had less. It is decided on the
 * costs the result gives, so a result without them keeps the usual line.
 */
function partialAnswerLine(result: GlossaryLookupResult): string {
  const limit = TOKEN_CONFIG.MAX_TOKENS_LIMIT;
  const { maxTokens, tokenCount } = result.tokenInfo;
  const omitted = result.truncatedContent?.omittedItems ?? [];
  if (maxTokens >= limit) {
    const advice = omitted.length > 0
      ? lookUpByName(omitted, 'an entry that was left out', maxTokens)
      : ' Narrow your search.';
    return `Results truncated due to token limit, and \`maxTokens\` is already the largest it can be (${String(limit)}).${advice}`;
  }
  const next = omitted[0];
  if (next === undefined || tokenCount + next.estimatedTokens <= limit) {
    return 'Results truncated due to token limit. Increase `maxTokens` or narrow your search.';
  }
  const needs = next.estimatedTokens > limit
    ? `it needs ${String(next.estimatedTokens)} tokens on its own, more than`
    : `it needs ${String(next.estimatedTokens)} tokens, and with the ${String(tokenCount)} shown that is more than`;
  const byName = lookUpByName(omitted, 'an entry that was left out', maxTokens);
  return `Results truncated due to token limit, and no \`maxTokens\` gets the next entry, ${sanitizeMarkdownText(next.title)}: ` +
    `${needs} \`maxTokens\` allows (${String(limit)}).${byName}`;
}

/** How many of the entries left out a partial answer names at most. */
const LEFT_OUT_NAMED = 5;

/**
 * The line under a partial answer that names the entries left out, with what
 * each costs: "Left out: Apple School Manager (134 tokens), and 1 more.", or
 * nothing when not even one name `fits`.
 *
 * Until 2026-09-28 only `truncatedContent`, in JSON and on the structured
 * channel, named them, so the markdown's "narrow your search" gave its reader
 * nothing to narrow it to. Live that day, `device` at `maxTokens: 100` showed
 * device activation and said nothing of the six others, device enrollment
 * and Automated Device Enrollment among them.
 *
 * It names the entries in the order the answer ranks them, the first
 * {@link LEFT_OUT_NAMED} at most, for as long as the line fits, and counts
 * the rest. The count is taken from `totalMatches`, as the "1 of 4
 * match(es)" line above it is, and no more entries are named than it, so the
 * two agree whatever a `GlossaryProvider` lists.
 */
function leftOutLine(result: GlossaryLookupResult, fits: (line: string) => boolean): string | undefined {
  const leftOut = Math.max(0, result.totalMatches - result.entries.length);
  const names = (result.truncatedContent?.omittedItems ?? [])
    .slice(0, Math.min(LEFT_OUT_NAMED, leftOut))
    .map(e => `${sanitizeMarkdownText(e.title)} (${String(e.estimatedTokens)} tokens)`);
  let line: string | undefined;
  // One name more always lengthens the line, so the first that does not fit
  // ends the search.
  for (let count = 1; count <= names.length; count++) {
    const rest = leftOut - count;
    const candidate = `Left out: ${names.slice(0, count).join(', ')}${rest > 0 ? `, and ${String(rest)} more` : ''}.`;
    if (!fits(candidate)) {
      break;
    }
    line = candidate;
  }
  return line;
}

/**
 * The {@link leftOutLine} that ends `reply`, a markdown answer, when some of
 * its entries were left out and the reply with the line is still within
 * `maxTokens`; otherwise nothing.
 *
 * The line is charged to the whole reply as it is sent, by the estimate the
 * cut is made with, and to the `maxTokens` the lookup was asked with, not one
 * a `GlossaryProvider` gives back. So it never takes a reply over
 * `maxTokens`. The cut counts only each entry's `term: definition`, not the
 * headings, links and footer, so a full reply is often over `maxTokens`
 * already, and then gets no line. Live on 2026-09-28, five broad terms at
 * `maxTokens` 100 to 400 gave 19 partial answers. In full, 18 of them were
 * over `maxTokens` before any line (`Apple` at 150 was 197 tokens), and the
 * 19th, `Apple` at 200, had 3 tokens left, so none names an entry. In
 * compact none was over, and 18 name entries left out: `device` at 100 names
 * three of the six in a reply of 98 tokens.
 */
function leftOutFooter(reply: string, result: GlossaryLookupResult, maxTokens: number): string {
  if (!result.tokenInfo.truncated || result.entries.length === 0) {
    return '';
  }
  const line = leftOutLine(result, candidate => estimateTokens(`${reply}*${candidate}*\n`) <= maxTokens);
  return line !== undefined ? `*${line}*\n` : '';
}

function formatTokenFooter(result: GlossaryLookupResult): string {
  const { tokenInfo, totalMatches } = result;
  let footer = `\n*${result.entries.length} of ${totalMatches} match(es) | ${tokenInfo.tokenCount.toLocaleString()} tokens*`;
  if (tokenInfo.truncated) {
    footer += `\n*${result.entries.length === 0 ? formatNothingFits(result) : partialAnswerLine(result)}*`;
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
 *
 * The failed-read error names a configured maps provider when the maps list
 * failed there. Until 2026-09-28 it named learn.jamf.com whatever failed, and
 * the description said every such failure "may be temporary", which neither
 * a provider's failure nor, since #354, a 404 is. The description now says
 * the message decides.
 *
 * `warning` joined the JSON shape on 2026-09-28. It was already sent on a
 * reply asked in another language than en-US, and that day it began to say
 * why a no-match may have none (see englishGlossaryNote).
 */
const TOOL_DESCRIPTION = `Look up a term in the Jamf official glossary and get its definition.

This tool searches the Jamf Platform Technical Glossary, one glossary shared by
every Jamf product, and returns matching term definitions using fuzzy matching.
A term of 4 characters or fewer is treated as an abbreviation and must be a
whole word of the entry's name, so "DEP" does not match "zero-touch deployment".
A 4-character term may be a plural, or miss a letter or swap two ("MDMs", "LDPA").

Note: Glossary content is currently only available in English (en-US).
Non-English language parameters are accepted but results will be in English.
A reply with no match says so when the term was asked in another language or
written in a script other than Latin, such as Chinese.

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
    "incomplete"?: { "unfetched": [{ "term": string, "url": string }], "message": string },
    // Set when the English glossary answered a term asked in another language,
    // or found no match for one written in a script other than Latin.
    "warning"?: string
  }

  For Markdown format:
  A formatted list of glossary definitions with source links.

Examples:
  - "What is MDM?" → term="MDM"
  - "What is a configuration profile?" → term="Configuration Profile"
  - "What is Automated Device Enrollment (formerly DEP)?" → term="Automated Device Enrollment"

Errors:
  - "Glossary lookup for "<term>" failed: ..." (isError) if the glossary could not be read:
    learn.jamf.com could not be reached, timed out or answered with an error, or a configured
    maps provider failed. The lookup cannot say whether the glossary has the term, so this is
    not a "no match". The message says whether trying again may help.
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

        const maxTokens = params.maxTokens ?? TOKEN_CONFIG.DEFAULT_MAX_TOKENS;
        const result = await lookupGlossaryTerm(ctx, {
          term: params.term,
          product: params.product as ProductId | undefined,
          language: params.language as LocaleId | undefined,
          maxTokens,
        });

        await reportProgress(extra, { progress: 1, total: 3, message: 'Processing matches...' });

        const structuredContent = buildStructuredContent(params.term, result);

        await reportProgress(extra, { progress: 2, total: 3, message: 'Formatting output...' });

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
          const warning = languageNote(params, result, name => name);
          if (warning !== undefined) {
            jsonPayload.warning = warning;
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
          const note = languageNote(params, result, codeSpan);
          const noResultText = `No glossary entries found for "${params.term}".\n\n${
            note !== undefined ? `> ${note}\n\n` : ''
          }*Tip: Try using \`jamf_docs_search\` with \`docType: "glossary"\` for broader results.*`;

          await reportProgress(extra, { progress: 3, total: 3 });
          return {
            content: [{ type: 'text', text: noResultText }],
            structuredContent,
          };
        }

        // Markdown format
        const note = languageNote(params, result, codeSpan);
        const langWarning = note !== undefined ? `> ${note}\n\n` : '';
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
        markdown += leftOutFooter(markdown, result, maxTokens);

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
            text: `Glossary lookup error: ${failureReason(error)}\n\nPlease try again or use different search terms.`,
          }],
        };
      }
    },
  );
}
