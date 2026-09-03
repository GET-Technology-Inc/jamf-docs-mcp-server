/**
 * Jamf documentation MCP App.
 *
 * One app serves the view-bearing tools. Which view renders is decided from
 * the tool the host says produced the result, falling back to the shape of the
 * `structuredContent` — so the tools can share a single `ui://` resource
 * instead of shipping four copies of the same bundle.
 *
 * The design rule the whole file answers to is in `styles.ts`: the panel paints
 * no background and owns no colour, because it is a piece of the host's
 * surface rather than a web page embedded in one. Everything here that looks
 * like presentation logic — reading the host's theme, its style variables, its
 * fonts, its device capabilities, its locale — exists to keep that true.
 */

import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
  type McpUiHostContext,
} from '@modelcontextprotocol/ext-apps';
import { esc } from './escape.js';
import { CSS as STYLESHEET } from './styles.js';
import { type TocEntry, indentCap, renderTocItems } from './toc.js';

// ---------------------------------------------------------------------------
// Tool result shapes (mirrors of src/core/schemas/output.ts)
// ---------------------------------------------------------------------------

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  product: string;
  version?: string;
  docType?: string;
  breadcrumb?: string[];
  otherVersions?: string[];
}

/**
 * The filters a search was run under, echoed back by the server.
 *
 * Needed to ask for page 2 of the *same* search: `product`, `docType` and
 * `version` reach Fluid Topics and `product`/`topic` are re-applied on the
 * server, so a page request without them queries a different population and
 * returns plausible-looking but wrong results.
 */
interface SearchFilters {
  product?: string;
  topic?: string;
  version?: string;
  docType?: string;
  language?: string;
}

interface SearchView {
  query: string;
  filters?: SearchFilters;
  totalResults: number;
  page: number;
  totalPages: number;
  /** Page size — carried forward so the next page is the same size as this one. */
  limit?: number;
  results: SearchResult[];
  otherSources?: { title: string; url: string; source: string }[];
  suggestions?: string[];
  filterRelaxation?: { removed: string[]; message: string };
  versionNote?: string;
  relevanceNote?: string;
  paginationNote?: string;
  truncatedContent?: { omittedCount: number };
}

interface TocView {
  /** Display name, for the heading. */
  product: string;
  /**
   * The id the entries were fetched under, echoed back under the same name the
   * request used. Exactly one of the two is present: a TOC can be addressed by
   * product or by publication, and passing a display name — or the wrong one of
   * these — back into `jamf_docs_get_toc` is a validation error.
   */
  productId?: string;
  publicationId?: string;
  version: string;
  totalEntries: number;
  page: number;
  totalPages: number;
  entries: TocEntry[];
  versionNote?: string;
  localeNote?: string;
  paginationNote?: string;
}

interface ArticleSection {
  id: string;
  title: string;
  level: number;
}

interface ArticleView {
  title: string;
  url: string;
  content: string;
  product?: string;
  version?: string;
  lastUpdated?: string;
  breadcrumb?: string[];
  sections: ArticleSection[];
  truncated: boolean;
  versionStatus?: 'latest' | 'superseded';
  contentLocale?: string;
  navigation?: {
    self: { title: string; url: string };
    parent?: { title: string; url: string };
    siblings: { title: string; url: string }[];
    children: { title: string; url: string }[];
    /** Totals, not array lengths — the arrays are capped server-side. */
    siblingCount: number;
    childCount: number;
  };
}

interface GlossaryView {
  term: string;
  totalMatches: number;
  entries: { term: string; definition: string; product?: string; url: string }[];
  truncated: boolean;
}

type View =
  | { kind: 'search'; data: SearchView }
  | { kind: 'toc'; data: TocView }
  | { kind: 'article'; data: ArticleView }
  | { kind: 'glossary'; data: GlossaryView }
  | { kind: 'pending'; label: string; rows: number; verb: string }
  | { kind: 'error'; message: string; retry?: { name: string; args: Record<string, unknown>; label?: string } };

/**
 * Decide which view a payload is.
 *
 * `toolName` wins when the host supplies it, because shape-sniffing is
 * genuinely ambiguous here: `jamf_docs_batch_get_articles` also emits a
 * top-level `results` array, and would classify as a search. The shape check
 * remains as the fallback for `callServerTool` results, which carry no
 * `toolInfo`.
 */
function classify(payload: unknown, toolName?: string): View | null {
  if (payload === null || typeof payload !== 'object') {
    return null;
  }
  const p = payload as Record<string, unknown>;

  if (toolName === 'jamf_docs_search' && Array.isArray(p.results)) {
    return { kind: 'search', data: p as unknown as SearchView };
  }
  if (toolName === 'jamf_docs_get_toc' && Array.isArray(p.entries)) {
    return { kind: 'toc', data: p as unknown as TocView };
  }
  if (toolName === 'jamf_docs_get_article' && typeof p.content === 'string') {
    return { kind: 'article', data: p as unknown as ArticleView };
  }
  if (toolName === 'jamf_docs_glossary_lookup' && Array.isArray(p.entries)) {
    return { kind: 'glossary', data: p as unknown as GlossaryView };
  }

  if (Array.isArray(p.results) && typeof p.query === 'string') {
    return { kind: 'search', data: p as unknown as SearchView };
  }
  if (Array.isArray(p.entries) && typeof p.term === 'string') {
    return { kind: 'glossary', data: p as unknown as GlossaryView };
  }
  if (Array.isArray(p.entries) && typeof p.product === 'string') {
    return { kind: 'toc', data: p as unknown as TocView };
  }
  if (typeof p.content === 'string' && typeof p.title === 'string') {
    return { kind: 'article', data: p as unknown as ArticleView };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Host environment
// ---------------------------------------------------------------------------

const el = document.documentElement;
const RTL = /^(ar|he|fa|ur|ps|ckb|yi)\b/i;

/**
 * The locales the tools accept.
 *
 * `hostContext.locale` is BCP 47 and can be anything; the tool parameter is a
 * closed enum. Forwarding an unlisted locale is a validation error that fails
 * the call, so the app forwards only what the server can accept and otherwise
 * says nothing — which is what it did for every locale before.
 */
const TOOL_LOCALES = new Set([
  'en-US', 'ja-JP', 'zh-TW', 'de-DE', 'es-ES', 'fr-FR', 'nl-NL', 'th-TH',
]);

/**
 * How much of each view an *inline* panel renders.
 *
 * Claude's design guidelines put a hard constraint on inline apps: they fit
 * their content height and do not scroll internally, because on a touch device
 * the conversation owns vertical panning and an internal scroll container
 * simply does not scroll — content past the host's cap is unreachable, not
 * merely below the fold. The documented escape hatch for anything longer is
 * `ui/request-display-mode` into fullscreen.
 *
 * So the panel is bounded by what it *renders*, not by a pixel ceiling. The
 * numbers come from the same guidelines: an inline card carries four to five
 * data points and at most two actions.
 *
 * Fullscreen is uncapped — it is the mode the reader asked for in order to
 * have the room.
 */
const INLINE_HITS = 3;
const INLINE_ROWS = 8;
/** Blank-line-separated blocks of article markdown shown inline. */
const INLINE_BLOCKS = 3;

const env = {
  width: 400,
  mode: 'inline' as 'inline' | 'fullscreen' | 'pip',
  canFullscreen: false,
  hover: true,
  locale: 'en-US',
  timeZone: undefined as string | undefined,
  canCopy: false,
  /** What the host says it has room for, when it says. */
  maxHeight: undefined as number | undefined,
};

/**
 * Adopt everything the host says about itself.
 *
 * Called once after `connect()` and again on every `hostcontextchanged`. The
 * second path is the one that matters: a user switching Claude to dark mode is
 * a notification, not a reload, and the sheet this replaced answered
 * `prefers-color-scheme` — the *operating system* — so the panel simply did
 * not move.
 */
function applyHostContext(ctx: Partial<McpUiHostContext>): void {
  applyHostAppearance(ctx);
  applyHostEnvironment(ctx);
}

/** The half that changes how the panel looks: theme, tokens, fonts, insets. */
function applyHostAppearance(ctx: Partial<McpUiHostContext>): void {
  if (ctx.theme !== undefined) {
    applyDocumentTheme(ctx.theme);
  }
  if (ctx.styles?.variables !== undefined) {
    applyHostStyleVariables(ctx.styles.variables);
  }
  if (ctx.styles?.css?.fonts !== undefined) {
    applyHostFonts(ctx.styles.css.fonts);
  }
  if (ctx.deviceCapabilities?.hover !== undefined) {
    env.hover = ctx.deviceCapabilities.hover;
    el.dataset.hover = env.hover ? '1' : '0';
  }
  if (ctx.safeAreaInsets !== undefined) {
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      el.style.setProperty(`--sa-${side}`, `${String(ctx.safeAreaInsets[side])}px`);
    }
  }
}

/** The half that changes what the panel renders: size, mode, locale, time zone. */
function applyHostEnvironment(ctx: Partial<McpUiHostContext>): void {
  const box = ctx.containerDimensions;
  if (box !== undefined) {
    const width = 'width' in box ? box.width : box.maxWidth;
    if (typeof width === 'number' && width > 0) {
      env.width = width;
    }

    // Recorded, not enforced. The host caps and clips an inline panel itself;
    // the app's job is to render little enough that it never gets there, which
    // is what the INLINE_* caps do. Writing this to a max-height would
    // reintroduce the internal scroll container the guidelines rule out.
    const height = 'height' in box ? box.height : box.maxHeight;
    if (typeof height === 'number' && height > 0) {
      env.maxHeight = height;
    }
  }
  if (ctx.displayMode !== undefined) {
    env.mode = ctx.displayMode;
    el.dataset.mode = env.mode;
  }
  if (ctx.availableDisplayModes !== undefined) {
    env.canFullscreen = ctx.availableDisplayModes.includes('fullscreen');
  }
  if (ctx.locale !== undefined) {
    env.locale = ctx.locale;
    el.lang = ctx.locale;
    el.dir = RTL.test(ctx.locale) ? 'rtl' : 'ltr';
  }
  if (ctx.timeZone !== undefined) {
    env.timeZone = ctx.timeZone;
  }
}

/** The `language` argument to forward, if the host's locale is one the tools take. */
function toolLanguage(): { language: string } | Record<string, never> {
  return TOOL_LOCALES.has(env.locale) ? { language: env.locale } : {};
}

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

/**
 * Whether a value is a string worth rendering.
 *
 * The interfaces in this file describe what the server sends, but `classify`
 * casts an entirely unvalidated payload — `JSON.parse` of whatever the host
 * relayed — after checking two fields. So an optional `string` really is
 * `unknown` at runtime, and a plain nullish check would let `null` or a number
 * through to `esc`, where `.replace` is not a function. A render that throws
 * from `ontoolresult` is uncaught and kills the view.
 */
function renderableText(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

/** Inline markdown: images, code spans, links, bold, italics. Operates on escaped text. */
function inline(escaped: string): string {
  return (
    escaped
      // Images first, and as links rather than as `<img>`: the host's sandbox
      // CSP blocks external image loads, so an `<img>` is a guaranteed broken
      // icon. Ahead of the link rule because `![a](b)` contains `[a](b)`, and
      // matching that first would leave a stray `!` in the prose.
      .replace(/!\[([^\]]*)\]\((https?:[^)\s]+)\)/g, (_m, alt: string, url: string) =>
        `<a href="${url}" data-external>${alt === '' ? 'image' : alt}</a>`)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" data-external>$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
  );
}

/** Paragraphs that Jamf writes as an advisory, and the kind each maps to. */
const CALLOUT_KINDS: [RegExp, string, string][] = [
  [/^(Warning|Caution)\s*:?\s*/i, 'warning', 'Warning'],
  [/^(Important)\s*:?\s*/i, 'warning', 'Important'],
  [/^(Note)\s*:?\s*/i, 'info', 'Note'],
  [/^(Tip)\s*:?\s*/i, 'info', 'Tip'],
];

/** Split a markdown table row into cells, tolerating optional edge pipes. */
function tableCells(line: string): string[] {
  return line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function isTableDivider(line: string | undefined): boolean {
  return line !== undefined && /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(line) && line.includes('-');
}

/** True for a line that starts a block a paragraph or callout must not absorb. */
function startsBlock(line: string): boolean {
  return /^(#{1,6}\s|\s*[-*+]\s|\s*\d+[.)]\s|\s*```|\s*>|\s*\|)/.test(line);
}

/**
 * What a block parser returns: the HTML it produced and the line to resume at.
 *
 * The parsers are separate functions rather than branches of one loop because
 * the loop that held all of them scored 47 on the complexity rule this repo
 * lints for — and, more to the point, because a table and a callout have
 * genuinely nothing to say to each other.
 */
interface Block {
  html: string;
  next: number;
}

/** Fenced code, consumed whole so nothing inside is parsed as markdown. */
function readFence(lines: string[], start: number): Block | null {
  if (!/^\s*```/.test(lines[start] ?? '')) {
    return null;
  }
  const body: string[] = [];
  let index = start + 1;
  while (index < lines.length && !/^\s*```/.test(lines[index] ?? '')) {
    body.push(esc(lines[index] ?? ''));
    index++;
  }
  // The button is gated on the host actually granting `clipboardWrite`. The
  // resource asks for it in `_meta.ui.permissions`, but a host may decline, and
  // `navigator.clipboard.writeText` in a sandboxed iframe without the grant
  // rejects — so an ungated button would be one that silently does nothing.
  const copy = env.canCopy ? '<button class="copy" data-copy type="button">Copy</button>' : '';
  return {
    html: `<div class="pre-wrap"><pre><code>${body.join('\n')}</code></pre>${copy}</div>`,
    next: index + 1,
  };
}

/**
 * An ATX heading, capped at `h4`.
 *
 * Left uncapped, `h5`/`h6` fall through to the user-agent's defaults, which are
 * *smaller than body text* — a heading that renders smaller than the paragraph
 * beneath it inverts the hierarchy in the middle of an article.
 */
function readHeading(lines: string[], start: number): Block | null {
  const match = /^(#{1,6})\s+(.*)$/.exec(lines[start] ?? '');
  if (match === null) {
    return null;
  }
  const level = Math.min((match[1] ?? '').length + 1, 4);
  return {
    html: `<h${String(level)}>${inline(esc(match[2] ?? ''))}</h${String(level)}>`,
    next: start + 1,
  };
}

/** A thematic break. Checked before lists, since `---` would read as a bullet. */
function readRule(lines: string[], start: number): Block | null {
  return /^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(lines[start] ?? '')
    ? { html: '<hr>', next: start + 1 }
    : null;
}

/**
 * A pipe table: a header row followed by a divider row.
 *
 * There was no table branch at all before this, despite the function's own
 * docstring claiming "tables collapsed to rows" — so a Jamf settings reference
 * rendered as a run of literal pipe characters.
 */
function readTable(lines: string[], start: number): Block | null {
  const header = (lines[start] ?? '').trim();
  if (!header.includes('|') || !isTableDivider(lines[start + 1])) {
    return null;
  }
  let index = start + 2;
  const body: string[][] = [];
  while (index < lines.length && (lines[index] ?? '').includes('|')) {
    const row = (lines[index] ?? '').trim();
    if (row === '') {
      break;
    }
    body.push(tableCells(row));
    index++;
  }
  const head = tableCells(header)
    .map((cell) => `<th>${inline(esc(cell))}</th>`)
    .join('');
  const rows = body
    .map((cells) => `<tr>${cells.map((c) => `<td>${inline(esc(c))}</td>`).join('')}</tr>`)
    .join('');
  return {
    html:
      `<div class="table-wrap"><table><thead><tr>${head}</tr></thead>`
      + `<tbody>${rows}</tbody></table></div>`,
    next: index,
  };
}

function readQuote(lines: string[], start: number): Block | null {
  if (!/^\s*>\s?/.test(lines[start] ?? '')) {
    return null;
  }
  const body: string[] = [];
  let index = start;
  while (index < lines.length && /^\s*>\s?/.test(lines[index] ?? '')) {
    body.push((lines[index] ?? '').replace(/^\s*>\s?/, ''));
    index++;
  }
  return { html: `<blockquote>${markdown(body.join('\n'))}</blockquote>`, next: index };
}

/**
 * A `Note:` / `Important:` / `Warning:` / `Tip:` advisory.
 *
 * Jamf writes these as a bare label on its own line, then a blank line, then
 * the text — so the body is collected *across* one blank line rather than up to
 * it. Stopping at the blank line produced an advisory box with a heading and
 * nothing in it, and left the sentence it was meant to contain outside as an
 * unrelated paragraph.
 */
function readCallout(lines: string[], start: number): Block | null {
  const first = (lines[start] ?? '').trim();
  const match = CALLOUT_KINDS.find(([pattern]) => pattern.test(first));
  if (match === undefined) {
    return null;
  }
  const [pattern, kind, label] = match;
  const head = first.replace(pattern, '').trim();
  const body: string[] = head === '' ? [] : [head];
  let index = start + 1;

  if (body.length === 0) {
    while (index < lines.length && (lines[index] ?? '').trim() === '') {
      index++;
    }
  }
  while (index < lines.length && (lines[index] ?? '').trim() !== '') {
    const line = (lines[index] ?? '').trim();
    if (startsBlock(line)) {
      break;
    }
    body.push(line);
    index++;
  }

  const text = body.join(' ').trim();
  // A label with nothing under it is not an advisory, it is a stray word.
  if (text === '') {
    return null;
  }
  return {
    html:
      `<div class="callout" data-kind="${kind}"><span class="callout-label">${label}</span>`
      + `<p>${inline(esc(text))}</p></div>`,
    next: index,
  };
}

/** The block parsers, in the order they must be tried. */
const BLOCKS = [readFence, readRule, readHeading, readTable, readQuote, readCallout];

/**
 * A deliberately small markdown subset, matched to what Jamf articles contain.
 *
 * Beyond the original headings/code/lists/paragraphs it handles tables, nested
 * lists, blockquotes, thematic breaks and advisory callouts. Two of those are
 * corrections rather than additions — see {@link readTable}, and the nesting
 * note in the list branch below.
 */
function markdown(source: string): string {
  const out: string[] = [];
  const lines = source.split('\n');
  /** Open list elements, outermost first, with the indent column each began at. */
  const lists: { tag: 'ul' | 'ol'; indent: number }[] = [];
  let index = 0;

  const closeLists = (toIndent = -1): void => {
    while (lists.length > 0 && (lists[lists.length - 1]?.indent ?? 0) > toIndent) {
      out.push(`</${lists.pop()?.tag ?? 'ul'}>`);
    }
  };

  while (index < lines.length) {
    const line = (lines[index] ?? '').replace(/\s+$/, '');

    if (line.trim() === '') {
      closeLists();
      index++;
      continue;
    }

    const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(line);
    const numbered = /^(\s*)\d+[.)]\s+(.*)$/.exec(line);
    const item = bullet ?? numbered;
    if (item !== null && readRule(lines, index) === null) {
      const tag = bullet !== null ? 'ul' : 'ol';
      const indent = (item[1] ?? '').length;
      // Indentation is the only signal markdown gives for nesting, and ignoring
      // it is what flattened every sub-step of a Jamf procedure into a sibling
      // of the step above it.
      closeLists(indent);
      const innermost = lists[lists.length - 1];
      if (innermost === undefined || indent > innermost.indent) {
        out.push(`<${tag}>`);
        lists.push({ tag, indent });
      } else if (innermost.tag !== tag) {
        out.push(`</${lists.pop()?.tag ?? 'ul'}>`);
        out.push(`<${tag}>`);
        lists.push({ tag, indent });
      }
      out.push(`<li>${inline(esc(item[2] ?? ''))}</li>`);
      index++;
      continue;
    }

    const block = BLOCKS.reduce<Block | null>(
      (found, parse) => found ?? parse(lines, index),
      null,
    );
    if (block !== null) {
      closeLists();
      out.push(block.html);
      index = block.next;
      continue;
    }

    closeLists();
    out.push(`<p>${inline(esc(line.trim()))}</p>`);
    index++;
  }

  closeLists();
  return out.join('\n');
}

/**
 * Stamp the server's section ids onto the rendered headings.
 *
 * Positional but title-verified, because the zip is not safe on its own:
 * `extractSections()` on the server scans for ATX headings line by line with
 * no fenced-code tracking, while `markdown()` above consumes fences whole. A
 * `# comment` inside a code block is therefore a section server-side and code
 * text here, and every index after it is off by one — silently, producing a
 * navigation list whose links all land one heading early. Compact mode
 * compounds it, since `content` is a preview while `sections` covers the whole
 * article.
 *
 * A heading whose text does not match keeps no id, and `renderArticle` drops
 * the corresponding nav entry: fewer links that work beats more that lie.
 */
function stampIds(html: string, sections: ArticleSection[]): { html: string; used: Set<number> } {
  const used = new Set<number>();
  let cursor = 0;
  const stamped = html.replace(/<h([2-4])>([\s\S]*?)<\/h\1>/g, (whole, level: string, body: string) => {
    const section = sections[cursor];
    if (section === undefined || !renderableText(section.id)) {
      return whole;
    }
    const text = body.replace(/<[^>]*>/g, '').trim();
    if (text !== section.title.trim()) {
      return whole;
    }
    used.add(cursor);
    cursor++;
    return `<h${level} id="${esc(section.id)}">${body}</h${level}>`;
  });
  return { html: stamped, used };
}

function crumbs(path: string[] | undefined, className: string, ...shownElsewhere: (string | undefined)[]): string {
  // Same reasoning as `renderableText`: `path` is only a `string[]` by
  // declaration. Anything else renders as no breadcrumbs rather than throwing.
  if (!Array.isArray(path)) {
    return '';
  }
  const parts = path.filter(renderableText);

  // Drop every trailing crumb the page already shows somewhere better.
  //
  // The last one is the page itself — measured at 3/3 on real search results
  // and 22/22 on real articles — so rendering it puts the title on screen
  // twice, in tertiary grey directly above itself. The one before it is
  // usually the parent, which the article view now shows as a *clickable* link
  // in the bar: on "Payload Variables for Configuration Profiles" the crumb
  // line read "… Settings and Security Management for Computers › Computer
  // Configuration Profiles" one line under "↑ Computer Configuration
  // Profiles", with the duplicate half truncated into uselessness.
  //
  // A loop rather than two checks because the two cases are the same rule, and
  // because dropping the title can expose a parent that was not previously
  // last.
  const excluded = new Set(
    shownElsewhere.filter(renderableText).map((value) => value.trim()),
  );
  while (parts.length > 0 && excluded.has((parts[parts.length - 1] ?? '').trim())) {
    parts.pop();
  }
  if (parts.length === 0) {
    return '';
  }

  // Keep the two deepest, not the two shallowest and not the lot. A Jamf crumb
  // path is four or five levels of increasingly specific nouns that share a
  // prefix with every sibling page, so the shallow end is the part that
  // distinguishes nothing; and the full path wraps to three lines in a 320px
  // panel, at which point it outweighs the title it is supposed to be
  // qualifying.
  //
  // This replaces a `direction: rtl` truncation trick, which put the ellipsis
  // in the right place but also right-aligned any crumb line short enough to
  // fit — so the column edge moved from row to row depending on path length.
  const shown = parts.slice(-2);
  const prefix = parts.length > shown.length ? '… ' : '';
  return (
    `<span class="${className}">${prefix}${shown.map((c) => esc(c)).join(' › ')}</span>`
  );
}

/** An advisory line. Every one the server can send goes through here. */
function notice(text: unknown, level: 'info' | 'warning' = 'info'): string {
  return renderableText(text)
    ? `<p class="notice" data-level="${level}">${inline(esc(text))}</p>`
    : '';
}

/**
 * The part of a transport error a reader can act on.
 *
 * `MCP error -32603: ` is the JSON-RPC envelope, not the problem. It was going
 * straight into the panel under a heading, which is exactly what the log call
 * beside it exists to avoid — the code was already right about where the raw
 * text belongs and then printed it anyway.
 */
function readableError(message: string): string {
  const stripped = message.replace(/^MCP error -?\d+:\s*/i, '').trim();
  return stripped === '' ? 'The request failed.' : stripped;
}

/** What the panel says while a tool runs. Matched to the tool, not to a guess. */
function pendingVerb(toolName: string): string {
  return toolName === 'jamf_docs_search'
    ? 'Searching…'
    : toolName === 'jamf_docs_get_toc'
      ? 'Loading contents…'
      : 'Opening…';
}

/** `lastUpdated` in the host's locale and time zone, or verbatim if unparseable. */
function formatDate(value: unknown): string {
  if (!renderableText(value)) {
    return '';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  try {
    return new Intl.DateTimeFormat(env.locale, {
      dateStyle: 'medium',
      ...(env.timeZone !== undefined ? { timeZone: env.timeZone } : {}),
    }).format(parsed);
  } catch {
    return value;
  }
}

/**
 * The version, phrased for a reader, or nothing.
 *
 * `version` is a real release number on an article ("11.31.0") but the literal
 * string "current" on a table of contents — which rendered as "Version
 * current", and as a pill labelled `current` before that. Neither says
 * anything a reader did not already assume, so the placeholder is dropped and
 * only an actual release number is shown.
 */
function versionLabel(value: unknown): string | undefined {
  if (!renderableText(value) || value === 'current' || value === 'latest') {
    return undefined;
  }
  return value;
}

/** Join the parts of a `.head-sub` line, dropping the ones that are empty. */
function subLine(parts: (string | false | undefined)[]): string {
  const kept = parts.filter((p): p is string => renderableText(p));
  return kept.length === 0 ? '' : `<p class="head-sub">${kept.join(' · ')}</p>`;
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

/** Whether the panel is currently allowed to be long. */
function isFullscreen(): boolean {
  return env.mode === 'fullscreen';
}

/**
 * The action that reveals what an inline slice left out.
 *
 * Fullscreen when the host offers it — that is the documented route for
 * content an inline card cannot hold. When it does not, the count is still
 * stated rather than silently dropped: a list that shows four of fifty and
 * says nothing is a list a reader takes as complete.
 */
function expandAction(hidden: number, noun: string): string {
  if (hidden <= 0) {
    return '';
  }
  const label = `Show ${String(hidden)} more ${noun}${hidden === 1 ? '' : 's'}`;
  return env.canFullscreen
    ? `<button class="more" data-fullscreen>${esc(label)}</button>`
    : notice(`${String(hidden)} more ${noun}${hidden === 1 ? '' : 's'} not shown here.`);
}

/**
 * What follows the result list: reveal, page, or nothing.
 *
 * Two different "more"s, and they are not interchangeable. Hits held back by
 * the inline slice are already in hand, so revealing them is a display-mode
 * change and costs no tokens. Only once everything fetched is on screen does
 * "more" mean another `tools/call`.
 */
function searchMore(view: SearchView, hidden: number): string {
  if (!isFullscreen()) {
    // Inline's single action is "more room". Fetching page 2 in place would be
    // a second view inside a card the guidelines cap at one, and it would
    // replace the results the reader is looking at rather than extend them.
    const more = hidden + (view.totalResults - view.results.length);
    return expandAction(more, 'result');
  }
  if (view.page >= view.totalPages) {
    return '';
  }
  const remaining = view.totalResults - view.page * (view.limit ?? view.results.length);
  const label =
    remaining > 0
      ? `${String(Math.min(remaining, view.limit ?? 10))} more of ${String(view.totalResults)}`
      : 'more';
  return `<button class="more" data-more>Show ${esc(label)}</button>`;
}

function renderSearch(view: SearchView): string {
  const notices = [
    notice(view.filterRelaxation?.message, 'warning'),
    notice(view.versionNote, 'warning'),
    notice(view.paginationNote, 'warning'),
    // `relevanceNote` is deliberately not rendered. It is the same two
    // sentences on every non-empty search — an explanation of the Fluid Topics
    // ranking written for the model reading the text channel. On screen it is
    // three lines of grey prose above the first result, every single time.
    view.truncatedContent !== undefined && view.truncatedContent.omittedCount > 0
      ? notice(
          `${String(view.truncatedContent.omittedCount)} long result${
            view.truncatedContent.omittedCount === 1 ? '' : 's'
          } omitted to fit the token budget.`,
        )
      : '',
  ].join('');

  // The query stays in the <h1> in every state, empty included: it is the
  // thing the reader is trying to locate on screen. The design this replaced
  // evicted it for the words "No results" and demoted the query to grey.
  const header = `
    <header class="head">
      <h1 class="head-title">${esc(view.query)}</h1>
      ${subLine([
        `${String(view.totalResults)} result${view.totalResults === 1 ? '' : 's'}`,
        // The display name off a result, not `filters.product` — that field
        // holds the id the request used ("jamf-pro"), which is not a thing to
        // show a reader.
        view.filters?.product !== undefined ? view.results[0]?.product : undefined,
        view.totalPages > 1 && `page ${String(view.page)} of ${String(view.totalPages)}`,
      ])}
      ${notices}
    </header>`;

  if (view.results.length === 0) {
    // Suggestions are runnable queries, so they get the same shape as a
    // result. The previous design rendered them as inline links in a sentence,
    // which made prose advice ("try fewer keywords") look identical to a query.
    const tips =
      Array.isArray(view.suggestions) && view.suggestions.length > 0
        ? `<ol class="list list-hits">${view.suggestions
            .filter(renderableText)
            .map(
              (s) =>
                `<li><button class="hit" data-search="${esc(s)}">`
                + `<span class="hit-title">${esc(s)}</span></button></li>`,
            )
            .join('')}</ol>`
        : '';
    return `${header}
      <p class="notice">Nothing matched. ${tips === '' ? 'Try a broader query.' : 'Try one of these:'}</p>
      ${tips}`;
  }

  const hit = (r: SearchResult): string => {
    // docType, not product: `product` is dropped from the meta whenever the
    // search was already filtered to one, which is the documented happy path —
    // and it is why ten identical "Jamf Pro" pills used to sit under ten
    // results. docType is the field that actually separates two similar titles
    // and it was being discarded entirely.
    const meta = [
      view.filters?.product === undefined ? r.product : undefined,
      r.docType,
      r.version,
      Array.isArray(r.otherVersions) && r.otherVersions.length > 0
        ? `also ${r.otherVersions.filter(renderableText).slice(0, 3).join(', ')}`
        : undefined,
    ].filter(renderableText);
    return `
      <li><a class="hit" href="${esc(r.url)}" data-url="${esc(r.url)}">
        ${crumbs(r.breadcrumb, 'hit-path', r.title)}
        <span class="hit-title">${esc(r.title)}</span>
        ${renderableText(r.snippet) ? `<span class="hit-snippet">${inline(esc(r.snippet))}</span>` : ''}
        ${meta.length > 0 ? `<span class="hit-meta">${esc(meta.join(' · '))}</span>` : ''}
      </a></li>`;
  };

  // Inline renders a slice; fullscreen renders the page. Paging the *server*
  // only makes sense once everything already fetched is on screen.
  const shown = isFullscreen() ? view.results : view.results.slice(0, INLINE_HITS);
  const more = searchMore(view, view.results.length - shown.length);

  // Inline drops this entirely. It is a separate population the server refuses
  // to rank against the main one, so it is the least likely thing a reader
  // needs in a compact card — and it was costing a rule, a heading and two
  // rows of the small budget an inline panel has.
  const elsewhere =
    isFullscreen() && Array.isArray(view.otherSources) && view.otherSources.length > 0
      ? `<section class="group">
          <h2 class="group-title">Elsewhere</h2>
          <ol class="list list-hits">${view.otherSources
            .map(
              (s) => `
              <li><a class="hit" href="${esc(s.url)}" data-external>
                <span class="hit-title">${esc(s.title)}</span>
                <span class="hit-meta">${esc(s.source)}</span>
              </a></li>`,
            )
            .join('')}</ol>
        </section>`
      : '';

  return `${header}
    <ol class="list list-hits">${shown.map(hit).join('')}</ol>
    ${more}
    ${elsewhere}`;
}

function renderToc(view: TocView): string {
  // The cap is a measurement, not a constant: the same bundle renders in a
  // 320px sidebar and a 1000px fullscreen panel.
  const indentPx = env.width < 400 ? 8 : env.width >= 700 ? 16 : 12;
  el.style.setProperty('--cap', String(indentCap(env.width, indentPx)));

  const shown = isFullscreen() ? view.entries : view.entries.slice(0, INLINE_ROWS);
  const items = renderTocItems(shown);
  const more = !isFullscreen()
    ? expandAction(view.totalEntries - shown.length, 'entry')
    : view.page < view.totalPages
      ? `<button class="more" data-more>Show more of ${String(view.totalEntries)}</button>`
      : '';

  return `
    <header class="head">
      <h1 class="head-title">${esc(view.product)}</h1>
      ${subLine([
        // Version moves into the sub-line as prose. As a pill it read as a
        // removable filter, which it is not: there is one version for the page.
        versionLabel(view.version) !== undefined && `Version ${String(versionLabel(view.version))}`,
        `${String(view.totalEntries)} article${view.totalEntries === 1 ? '' : 's'}`,
        view.totalPages > 1 && `page ${String(view.page)} of ${String(view.totalPages)}`,
      ])}
      ${notice(view.localeNote)}${notice(view.versionNote, 'warning')}${notice(view.paginationNote, 'warning')}
    </header>
    ${isFullscreen() ? `<div class="filter" hidden>
      <input type="search" placeholder="Filter these entries" autocomplete="off" spellcheck="false" aria-controls="rows">
      <span class="count"></span>
    </div>` : ''}
    <ol class="list" id="rows">${items}</ol>
    ${more}`;
}

/**
 * The neighbour list an article shows, or nothing.
 *
 * Children when there are any, siblings otherwise — never both. On a page with
 * children the siblings are one level up and already reachable through the
 * parent link, and eight more rows would double the panel to say so.
 */
function nearbyLinks(
  tree: ArticleView['navigation'],
): { title: string; links: { title: string; url: string }[]; total: number } | undefined {
  if (tree === undefined) {
    return undefined;
  }
  if (tree.children.length > 0) {
    return { title: 'In this section', links: tree.children, total: tree.childCount };
  }
  if (tree.siblings.length > 0) {
    const parent = tree.parent?.title;
    return {
      title: renderableText(parent) ? `More in ${parent}` : 'Nearby',
      links: tree.siblings,
      total: tree.siblingCount,
    };
  }
  return undefined;
}

/** The "In this section" block, which is what a Jamf page's `<h2>` sections became. */
function renderNearby(tree: ArticleView['navigation']): string {
  // Fluid Topics serves one topic per call while learn.jamf.com concatenates a
  // topic and its children into one page — measured at 9 of 9 on "Computer
  // Configuration Profiles", whose nine `<h2>` sections are nine separate
  // topics here. Without this list a reader who opens the parent gets its
  // introduction and no route to the procedure the page consists of on the
  // site.
  const nearby = nearbyLinks(tree);
  if (nearby === undefined) {
    return '';
  }
  const rows = nearby.links
    .map(
      (link) => `
      <li><a class="hit" href="${esc(link.url)}" data-url="${esc(link.url)}">
        <span class="hit-title">${esc(link.title)}</span>
      </a></li>`,
    )
    .join('');
  const more =
    nearby.total > nearby.links.length
      ? notice(`Showing ${String(nearby.links.length)} of ${String(nearby.total)}.`)
      : '';
  return `<section class="group">
    <h2 class="group-title">${esc(nearby.title)}</h2>
    <ol class="list list-hits">${rows}</ol>
    ${more}
  </section>`;
}

/**
 * The slice of an article an inline panel renders.
 *
 * Counted in blocks, not characters. A character budget does not predict
 * height: 900 characters of prose is three short paragraphs, and 900
 * characters containing a 22-row settings table is 700px of panel. Blocks are
 * what the reader sees, so blocks are what is budgeted.
 *
 * A table or a code block ends the preview wherever it appears, for the same
 * reason — both are unbounded vertically, and neither is what an inline card
 * is for. Claude's guidelines put long-form content in fullscreen; this is the
 * line between "here is what this page is" and "here is the page".
 */
function inlineProse(content: string): { text: string; truncated: boolean } {
  if (isFullscreen()) {
    return { text: content, truncated: false };
  }

  const blocks: string[] = [];
  let current: string[] = [];
  for (const line of content.split('\n')) {
    if (line.trim() === '') {
      if (current.length > 0) {
        blocks.push(current.join('\n'));
        current = [];
      }
      continue;
    }
    current.push(line);
  }
  if (current.length > 0) {
    blocks.push(current.join('\n'));
  }

  const kept: string[] = [];
  for (const block of blocks) {
    if (kept.length >= INLINE_BLOCKS) {
      break;
    }
    const head = block.split('\n')[0] ?? '';
    if (head.trimStart().startsWith('|') || head.trimStart().startsWith('```')) {
      break;
    }
    kept.push(block);
  }

  return kept.length >= blocks.length
    ? { text: content, truncated: false }
    : { text: kept.join('\n\n'), truncated: true };
}

/**
 * The two different kinds of "there is more" an article can have.
 *
 * `previewed` is this panel's own doing — the inline slice — and fullscreen
 * undoes it locally. `budgeted` is the server's: the tool dropped content to
 * fit `maxTokens`, and no display mode brings that back.
 */
function articleFooter(previewed: boolean, budgeted: boolean): string {
  const expand = previewed
    ? env.canFullscreen
      ? '<button class="more" data-fullscreen>Read the full article</button>'
      : notice('Showing the beginning of this article.')
    : '';
  const truncated = budgeted ? notice('Content was truncated to fit the token budget.') : '';
  return `${expand}${truncated}`;
}

/** Breadcrumb, title, provenance line and the two article-level advisories. */
function articleHeader(view: ArticleView, tree: ArticleView['navigation']): string {
  const version = versionLabel(view.version);
  const updated = formatDate(view.lastUpdated);
  const superseded =
    view.versionStatus === 'superseded'
      ? notice('This page documents a superseded release.', 'warning')
      : '';
  const translated =
    renderableText(view.contentLocale) && view.contentLocale !== env.locale
      ? notice(`Shown in ${view.contentLocale} — Jamf publishes no translation for your locale.`)
      : '';
  return `
    <header class="head">
      ${isFullscreen() ? crumbs(view.breadcrumb, 'head-path', view.title, tree?.parent?.title) : ''}
      <h1 class="head-title">${esc(view.title)}</h1>
      ${subLine([
        renderableText(view.product) &&
          `${view.product}${version !== undefined ? ` ${version}` : ''}`,
        updated !== '' && `Updated ${updated}`,
        `<a href="${esc(view.url)}" data-external>learn.jamf.com ↗</a>`,
      ])}
      ${superseded}${translated}
    </header>`;
}

function renderArticle(view: ArticleView, canGoBack: boolean): string {
  const prose = inlineProse(view.content);
  const body = markdown(prose.text);
  const sections = Array.isArray(view.sections) ? view.sections : [];
  const { html, used } = stampIds(body, sections);

  // Only sections that actually got stamped onto a heading become links, and
  // only when there are at least two of them. Most Jamf pages carry no
  // headings at all, so an unguarded nav would be an empty rail on nine pages
  // in ten — chrome announcing nothing.
  const nav = isFullscreen() ? sections.filter((s, i) => used.has(i) && s.level <= 3) : [];
  const mini =
    nav.length > 1
      ? `<nav class="mini" aria-label="On this page">${nav
          .map(
            (s) =>
              `<a class="mini-item" href="#${esc(s.id)}" data-anchor="${esc(s.id)}"`
              + ` style="--depth:${String(Math.max(0, Math.min(2, s.level - 2)))}">${esc(s.title)}</a>`,
          )
          .join('')}</nav>`
      : '';

  const tree = view.navigation;
  // Fullscreen only, and only once the prose is whole: a list of what comes
  // after a page the reader has not reached the end of is noise, and inline it
  // would be the drill-in navigation the guidelines rule out.
  const related = isFullscreen() && !prose.truncated ? renderNearby(tree) : '';

  // Back and the parent link are navigation chrome, so they exist only in
  // fullscreen. Claude's guidelines put "drill-ins, breadcrumbs, or multiple
  // views" among the patterns an inline card must avoid — an inline panel is a
  // summary of one thing, and the route to anything else is fullscreen.
  //
  // Inline keeps exactly one action, which is that route.
  const up =
    isFullscreen() && tree?.parent !== undefined
      ? `<a class="txt" href="${esc(tree.parent.url)}" data-url="${esc(tree.parent.url)}">↑ ${esc(tree.parent.title)}</a>`
      : '';
  const back = isFullscreen() && canGoBack ? '<button class="txt" data-back>← Back</button>' : '';
  // Only when the footer is not already offering the same thing. Two buttons
  // that both request fullscreen is one action presented twice, and an inline
  // card gets two actions in total.
  const expand =
    !isFullscreen() && env.canFullscreen && !prose.truncated
      ? '<button class="txt" data-fullscreen>Expand</button>'
      : '';
  const bar =
    back !== '' || up !== '' || expand !== ''
      ? `<nav class="bar">
          <span class="bar-start">${back}${up}</span>
          ${expand}
        </nav>`
      : '';

  return `
    ${bar}
    ${articleHeader(view, tree)}
    <div class="article-body">
      ${mini}
      <article class="prose" id="prose">${html}</article>
    </div>
    ${articleFooter(prose.truncated, view.truncated)}
    ${related}`;
}

/**
 * The glossary view.
 *
 * Reuses the search components wholesale — a term is a title, a definition is
 * an unclamped snippet. That it costs almost nothing is the point: a component
 * set that only works for the three views it was drawn against is not a
 * component set.
 */
function renderGlossary(view: GlossaryView): string {
  // One definition is an answer, not a result set.
  //
  // The list rendering below put "PreStage" in the heading, "1 definition"
  // under it, and then "PreStage enrollment" as the first and only row — the
  // same word three times in four lines, with a list header counting to one.
  // A single match reads as the thing it is: the term, and what it means.
  const only = view.entries.length === 1 ? view.entries[0] : undefined;
  if (only !== undefined) {
    return `
      <header class="head">
        <h1 class="head-title">${esc(only.term)}</h1>
        ${subLine([
          only.product,
          `<a href="${esc(only.url)}" data-external>learn.jamf.com ↗</a>`,
        ])}
      </header>
      <div class="prose">${markdown(only.definition)}</div>`;
  }

  return `
    <header class="head">
      <h1 class="head-title">${esc(view.term)}</h1>
      ${subLine([
        `${String(view.totalMatches)} definition${view.totalMatches === 1 ? '' : 's'}`,
      ])}
    </header>
    <ol class="list list-hits">${view.entries
      .map(
        (e) => `
        <li><a class="hit" href="${esc(e.url)}" data-url="${esc(e.url)}">
          <span class="hit-title">${esc(e.term)}</span>
          <span class="hit-snippet" style="-webkit-line-clamp:none;line-clamp:none">${inline(esc(e.definition))}</span>
          ${renderableText(e.product) ? `<span class="hit-meta">${esc(e.product)}</span>` : ''}
        </a></li>`,
      )
      .join('')}</ol>
    ${view.truncated ? notice('Some definitions were omitted to fit the token budget.') : ''}`;
}

/**
 * The pending view, rendered at the type sizes the real content will use.
 *
 * The host sends the tool's arguments *before* the tool runs, so the heading is
 * already the real query rather than the word "Loading". Bar heights are in
 * `em` so the swap to real text does not reflow the panel.
 */
function renderPending(label: string, rows: number, verb: string): string {
  const widths = ['92%', '78%', '85%', '70%', '88%'];
  return `
    <header class="head">
      <h1 class="head-title">${esc(label)}</h1>
      <p class="head-sub">${esc(verb)}</p>
    </header>
    <div class="sk">${Array.from({ length: rows }, (_v, i) => `
      <div style="margin-bottom:var(--sp-4)">
        <span class="sk-line" style="--w:38%"></span>
        <span class="sk-line" style="--w:${widths[i % widths.length] ?? '80%'}"></span>
        <span class="sk-line" style="--w:60%"></span>
      </div>`).join('')}</div>`;
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

/**
 * The container `app.html` ships.
 *
 * A missing one means the shell and this bundle have come apart — a build
 * fault, not a runtime state worth degrading into. Saying so beats rendering
 * into a detached node nobody will ever see.
 */
function requireRoot(): HTMLElement {
  const element = document.getElementById('root');
  if (element === null) {
    throw new Error('app.html is missing its #root container');
  }
  return element;
}

const root = requireRoot();
const style = document.createElement('style');
style.textContent = STYLESHEET;
document.head.appendChild(style);

const app = new App(
  { name: 'Jamf Documentation', version: '2.0.0' },
  // Without this a host is entitled never to offer fullscreen, and the spec
  // forbids it switching to a mode the app did not declare — so the Expand
  // affordance is dead unless it is announced here.
  { availableDisplayModes: ['inline', 'fullscreen'] },
);

const history: View[] = [];
let current: View | null = null;
/**
 * Monotonic call counter.
 *
 * Replaces an `if (busy) return` guard, which made an impatient second click do
 * nothing at all, with no feedback. Now a later call supersedes an earlier one
 * and the stale resolution is dropped.
 */
let seq = 0;
/** The last real (non-pending, non-error) view, for restoring after a cancel. */
let lastSettled: View | null = null;

function paint(): void {
  if (current === null) {
    return;
  }
  if (current.kind === 'error') {
    // Back renders here too. The version this replaced returned early on the
    // error branch, so one failed fetch bricked the panel until the model
    // happened to call a tool again.
    root.innerHTML = `
      ${history.length > 0 ? '<nav class="bar"><button class="txt" data-back>← Back</button></nav>' : ''}
      <header class="head">
        <h1 class="head-title">That didn’t load</h1>
        <p class="head-sub">${esc(readableError(current.message))}</p>
        ${current.retry !== undefined ? '<p class="notice"><button class="txt" data-retry>Try again</button></p>' : ''}
      </header>`;
    return;
  }
  root.innerHTML =
    current.kind === 'search'
      ? renderSearch(current.data)
      : current.kind === 'toc'
        ? renderToc(current.data)
        : current.kind === 'article'
          ? renderArticle(current.data, history.length > 0)
          : current.kind === 'glossary'
            ? renderGlossary(current.data)
            : renderPending(current.label, current.rows, current.verb);
  root.scrollTop = 0;
}

function show(view: View, push: boolean): void {
  if (push && current !== null && current.kind !== 'pending' && current.kind !== 'error') {
    history.push(current);
  }
  current = view;
  if (view.kind !== 'pending' && view.kind !== 'error') {
    lastSettled = view;
  }
  paint();
}

/** Structured payload of a tool result, whichever field the host populated. */
function payloadOf(result: {
  structuredContent?: unknown;
  content?: { type: string; text?: string }[];
}): unknown {
  if (result.structuredContent !== undefined) {
    return result.structuredContent;
  }
  const text = result.content?.find((c) => c.type === 'text')?.text;
  if (text === undefined) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** The arguments that fetch the next page of whatever is on screen. */
function pageArgs(view: View): { name: string; args: Record<string, unknown> } | null {
  if (view.kind === 'search') {
    return {
      name: 'jamf_docs_search',
      args: {
        ...view.data.filters,
        ...(view.data.limit !== undefined ? { limit: view.data.limit } : {}),
        query: view.data.query,
        page: view.data.page + 1,
      },
    };
  }
  if (view.kind === 'toc') {
    // Whichever id the response echoed back, under the name the request used.
    // A TOC addressed by publication reports `publicationId` and no
    // `productId`, and the previous code sent `product: undefined` — which is
    // a validation error, so "Load more" on a publication TOC always failed.
    const id = view.data.productId ?? view.data.publicationId;
    if (!renderableText(id)) {
      return null;
    }
    const key = renderableText(view.data.productId) ? 'product' : 'publication';
    return { name: 'jamf_docs_get_toc', args: { [key]: id, page: view.data.page + 1 } };
  }
  return null;
}

async function call(
  name: string,
  args: Record<string, unknown>,
  push: boolean,
  pendingLabel?: string,
): Promise<void> {
  const mine = ++seq;

  // A short delay before any skeleton, so a cached response is not a flash of
  // grey bars. The clicked row keeps its pressed tint in the meantime, which
  // is the feedback that actually matters.
  const timer = setTimeout(() => {
    if (mine === seq && pendingLabel !== undefined) {
      show({ kind: 'pending', label: pendingLabel, rows: 4, verb: pendingVerb(name) }, push);
    }
  }, 120);

  try {
    const result = await app.callServerTool({ name, arguments: { ...args, ...toolLanguage() } });
    if (mine !== seq) {
      return;
    }
    const view = classify(payloadOf(result), name);
    show(
      view ?? {
        kind: 'error',
        message: `${name} returned nothing renderable.`,
        retry: { name, args, ...(pendingLabel !== undefined ? { label: pendingLabel } : {}) },
      },
      push,
    );
  } catch (err) {
    if (mine !== seq) {
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    // The raw JSON-RPC text goes to the host's log, not into a heading the
    // reader has to make sense of.
    void app.sendLog({ level: 'error', logger: 'JamfDocsApp', data: `${name}: ${message}` });
    show(
      {
        kind: 'error',
        message,
        retry: { name, args, ...(pendingLabel !== undefined ? { label: pendingLabel } : {}) },
      },
      push,
    );
  } finally {
    clearTimeout(timer);
  }
}

// Every handler is registered before connect(). The version this replaced
// assigned `ontoolresult` *after* `void app.connect()` and worked only by
// accident of synchronous ordering.
app.onhostcontextchanged = (ctx) => {
  applyHostContext(ctx);
  paint();
};

app.ontoolinput = (params) => {
  const args = params.arguments ?? {};
  const label = renderableText(args.query)
    ? args.query
    : renderableText(args.term)
      ? args.term
      : renderableText(args.product)
        ? args.product
        : 'Jamf documentation';
  show(
    {
      kind: 'pending',
      label,
      rows: 4,
      verb: pendingVerb(app.getHostContext()?.toolInfo?.tool.name ?? ''),
    },
    false,
  );
};

app.ontoolcancelled = () => {
  // Without this a cancelled call left the panel on "Loading…" permanently:
  // there was no timeout and no other path back.
  if (lastSettled !== null) {
    current = lastSettled;
    paint();
  }
};

app.ontoolresult = (result) => {
  const toolName = app.getHostContext()?.toolInfo?.tool.name;
  const view = classify(payloadOf(result), toolName);
  if (view !== null) {
    seq++;
    history.length = 0;
    show(view, false);
  }
};

/**
 * Connect, then adopt whatever the host reported in the handshake.
 *
 * An async IIFE rather than a top-level `await`: the production bundle is
 * built as an `iife`, which has no module scope to await in, so a top-level
 * await is a build error rather than a runtime one. The listeners below are
 * registered synchronously and do not depend on the connection.
 */
void (async () => {
  try {
    await app.connect();
  } catch (error) {
    // A host that never completes the handshake leaves the panel on its
    // skeleton forever otherwise, with nothing anywhere saying why.
    show({ kind: 'error', message: error instanceof Error ? error.message : String(error) }, false);
    return;
  }
  applyHostContext(app.getHostContext() ?? {});
  env.canCopy = app.getHostCapabilities()?.sandbox?.permissions?.clipboardWrite !== undefined;
})();

// ---------------------------------------------------------------------------
// Interaction
// ---------------------------------------------------------------------------

/**
 * Open an external URL through the host.
 *
 * The iframe cannot open a tab itself, so navigation is a request. If the host
 * refuses it, the link becomes its own URL as selectable text — a dead click
 * with no explanation is worse than a visible address.
 */
function openExternal(link: HTMLAnchorElement): void {
  void app.openLink({ url: link.href }).then((result) => {
    if (result.isError === true) {
      link.removeAttribute('data-external');
      link.textContent = link.href;
    }
  });
}

/** Step back one entry in the in-panel history. */
function goBack(): void {
  const previous = history.pop();
  if (previous !== undefined) {
    seq++;
    current = previous;
    lastSettled = previous;
    paint();
  }
}

/** Scroll to a heading by the id the server issued and `stampIds` verified. */
function goToAnchor(id: string): void {
  // The version this replaced re-derived ids by slugifying heading text at
  // click time, which reduced any CJK heading to "-", took the first match on
  // duplicates, and searched only h2/h3 while the parser emitted level-3
  // sections as h4.
  root.querySelector(`#${CSS.escape(id)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * Follow an in-panel link to an article.
 *
 * From an inline panel this asks for fullscreen *first*. Opening an article in
 * place is a drill-in, and the guidelines put drill-ins among the patterns an
 * inline card must avoid — the documented route to a second view is
 * `ui/request-display-mode`. The request is awaited rather than fired and
 * forgotten so the article renders into the mode it was meant for; a host that
 * refuses, or offers no fullscreen at all, still gets the article in place,
 * because a link that does nothing is worse than one that degrades.
 */
async function openArticle(event: MouseEvent, target: HTMLElement): Promise<void> {
  // A modifier click is the reader asking the host for a real link; leave it
  // alone. A plain click routes in-panel.
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) {
    return;
  }
  event.preventDefault();
  target.setAttribute('aria-current', 'true');

  const { url } = target.dataset;
  if (url === undefined) {
    return;
  }
  // The title element, not the whole row. A `.hit` contains its breadcrumb,
  // title, snippet and meta, so `target.textContent` is the entire card —
  // which the loading view then rendered as a four-line heading.
  const label = (target.querySelector('.hit-title') ?? target).textContent.trim();

  if (!isFullscreen() && env.canFullscreen) {
    try {
      await app.requestDisplayMode({ mode: 'fullscreen' });
    } catch {
      // Fall through: the article is still worth opening.
    }
  }
  await call('jamf_docs_get_article', { url }, true, label === '' ? 'Article' : label);
}

root.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;

  const external = target.closest<HTMLAnchorElement>('a[data-external]');
  if (external !== null) {
    event.preventDefault();
    openExternal(external);
    return;
  }

  if (target.closest('[data-back]') !== null) {
    goBack();
    return;
  }

  if (target.closest('[data-retry]') !== null && current?.kind === 'error' && current.retry !== undefined) {
    // With the label, so the panel shows it is working. Without it the reader
    // clicked "Try again" and the error view sat there unchanged for the whole
    // round trip, which is indistinguishable from a dead button.
    const { name, args, label } = current.retry;
    void call(name, args, false, label);
    return;
  }

  if (target.closest('[data-fullscreen]') !== null) {
    void app.requestDisplayMode({ mode: 'fullscreen' });
    return;
  }

  const anchor = target.closest<HTMLElement>('[data-anchor]');
  if (anchor?.dataset.anchor !== undefined) {
    event.preventDefault();
    goToAnchor(anchor.dataset.anchor);
    return;
  }

  const suggestion = target.closest<HTMLElement>('[data-search]');
  if (suggestion?.dataset.search !== undefined) {
    const { search } = suggestion.dataset;
    void call('jamf_docs_search', { query: search }, true, search);
    return;
  }

  if (target.closest('button[data-more]') !== null) {
    // Paging arguments come from the view on screen, not from attributes on
    // the button: an attribute can only carry what fits in a string, which is
    // how both historical paging bugs arose.
    const next = current !== null ? pageArgs(current) : null;
    if (next !== null) {
      void call(next.name, next.args, true);
    }
    return;
  }

  const copy = target.closest<HTMLButtonElement>('[data-copy]');
  if (copy !== null) {
    copyCode(copy);
    return;
  }

  const openable = target.closest<HTMLElement>('[data-url]');
  if (openable !== null) {
    void openArticle(event, openable);
  }
});

/** Put a code block on the clipboard, and say so on the button that did it. */
function copyCode(button: HTMLButtonElement): void {
  const code = button.closest('.pre-wrap')?.querySelector('code');
  if (code === null || code === undefined) {
    return;
  }
  void navigator.clipboard.writeText(code.textContent).then(
    () => {
      button.textContent = 'Copied';
      setTimeout(() => {
        button.textContent = 'Copy';
      }, 1400);
    },
    () => {
      // The grant can be present and the write still refused. Saying so beats
      // a button that looks like it worked.
      button.textContent = 'Press ⌘C';
    },
  );
}

/** The rows the arrow keys move between, in document order. */
function navigableRows(): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('.hit, .row')).filter(
    (row) => row.offsetParent !== null,
  );
}

root.addEventListener('keydown', (event) => {
  const target = event.target as HTMLElement;
  const filterInput = root.querySelector<HTMLInputElement>('.filter input');

  if (event.key === 'Escape') {
    const box = root.querySelector<HTMLElement>('.filter');
    if (filterInput !== null && box !== null && box.hidden === false) {
      closeFilter();
      event.preventDefault();
    }
    return;
  }

  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    const rows = navigableRows();
    if (rows.length === 0) {
      return;
    }
    event.preventDefault();
    const focused = target.closest<HTMLElement>('.hit, .row');
    const index = focused === null ? -1 : rows.indexOf(focused);
    const next = event.key === 'ArrowDown' ? index + 1 : index - 1;
    rows[Math.max(0, Math.min(rows.length - 1, next === -1 ? 0 : next))]?.focus();
    return;
  }

  // Any printable key opens the TOC filter. Zero resting pixels, zero tokens:
  // it filters entries already in memory and never calls a tool. A 792-entry
  // table of contents is otherwise 12,000px of scrolling in a panel the host
  // clips at 640.
  if (
    current?.kind === 'toc' &&
    isFullscreen() &&
    target !== filterInput &&
    event.key.length === 1 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey
  ) {
    openFilter(event.key);
    event.preventDefault();
  }
});

function openFilter(seed: string): void {
  const box = root.querySelector<HTMLElement>('.filter');
  const input = root.querySelector<HTMLInputElement>('.filter input');
  if (box === null || input === null) {
    return;
  }
  box.hidden = false;
  input.value = seed;
  input.focus();
  applyFilter();
}

function closeFilter(): void {
  const box = root.querySelector<HTMLElement>('.filter');
  const input = root.querySelector<HTMLInputElement>('.filter input');
  if (box === null || input === null) {
    return;
  }
  input.value = '';
  applyFilter();
  box.hidden = true;
  navigableRows()[0]?.focus();
}

function applyFilter(): void {
  const input = root.querySelector<HTMLInputElement>('.filter input');
  const count = root.querySelector<HTMLElement>('.filter .count');
  if (input === null) {
    return;
  }
  const needle = input.value.trim().toLowerCase();
  const rows = Array.from(root.querySelectorAll<HTMLElement>('#rows > li'));
  let shown = 0;
  for (const row of rows) {
    const hit = needle === '' || row.textContent.toLowerCase().includes(needle);
    row.hidden = !hit;
    if (hit) {
      shown++;
    }
  }
  if (count !== null) {
    count.textContent = needle === '' ? '' : `${String(shown)}/${String(rows.length)}`;
  }
}

root.addEventListener('input', (event) => {
  if ((event.target as HTMLElement).closest('.filter') !== null) {
    applyFilter();
  }
});
