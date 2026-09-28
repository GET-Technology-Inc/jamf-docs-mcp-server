/**
 * The markdown renderer: an article's `content`, a glossary definition and a
 * server note, as the panel shows them.
 *
 * It honours CommonMark's backslash escapes. The server's markdown is full of
 * them: Turndown escapes the characters of a page's text that markdown would
 * read as markup (`jmf\_settings.json`, `\-/v2/local-admin-password`), and
 * `sanitizeMarkdownText` those of a title it writes into a link, such as a
 * support.jamf.com collection's list of articles (`\(JCDS\)`). Until
 * 2026-09-28 the renderer read none of them, so every one was shown with its
 * backslash: live that day, 32 in 3 of 22 articles, all 32 shown so. A table
 * cell's escaped pipe (`\|`) split the cell there.
 *
 * Moved out of app.ts that day so it can be tested on its own, as toc.ts is:
 * importing app.ts runs its top-level wiring and throws outside a browser.
 */

import { esc } from './escape.js';

/**
 * A backslash escape in text `esc` has escaped: a backslash before an ASCII
 * punctuation character. `&`, `<`, `>` and `"` are by then character
 * references, and the `&` that starts one is what is held, so an escaped
 * `<` is still `&lt;`.
 */
const ESCAPE = /^[!-/:-@[-`{-~]/;

/**
 * What stands in for an escaped character or a code span while the rules of
 * {@link inline} run, so none of them reads its content as markup: a NUL,
 * the index of what it stands for, and a NUL. A NUL in the text itself is
 * read as U+FFFD first, as an HTML parser reads it.
 */
const HELD = /\0(\d+)\0/g;

/** A run of backticks, and where the code span it opens ends, if it opens one. */
function codeSpan(escaped: string, start: number): { end: number; code: string } | undefined {
  const open = /^`+/.exec(escaped.slice(start))?.[0] ?? '';
  const runs = /`+/g;
  runs.lastIndex = start + open.length;
  for (let run = runs.exec(escaped); run !== null; run = runs.exec(escaped)) {
    if (run[0].length === open.length) {
      const code = escaped.slice(start + open.length, run.index);
      // One space is stripped from each end of a span that has one at both
      // and is not all spaces, which is how Turndown writes a span that
      // starts or ends with a backtick.
      const padded = code.startsWith(' ') && code.endsWith(' ') && code.trim() !== '';
      return { end: run.index + run[0].length, code: padded ? code.slice(1, -1) : code };
    }
  }
  return undefined;
}

/**
 * The code spans and backslash escapes of `escaped`, found left to right as
 * CommonMark finds them: a backslash escapes the character after it outside
 * a code span, a backtick it escapes opens none, and inside a span a
 * backslash is a backslash. `hold` is given each span's code, or each
 * escaped character, and returns what to put in its place.
 */
function holdLiterals(escaped: string, hold: (kind: 'code' | 'char', text: string, raw: string) => string): string {
  let out = '';
  let index = 0;
  while (index < escaped.length) {
    const char = escaped[index] ?? '';
    if (char === '\\') {
      const escape = ESCAPE.exec(escaped.slice(index + 1))?.[0];
      if (escape !== undefined) {
        out += hold('char', escape, `\\${escape}`);
        index += 1 + escape.length;
        continue;
      }
    } else if (char === '`') {
      const span = codeSpan(escaped, index);
      if (span !== undefined) {
        out += hold('code', span.code, escaped.slice(index, span.end));
        index = span.end;
        continue;
      }
      // A run that opens no span is literal backticks, all of it: a shorter
      // run inside it opens none either.
      const run = /^`+/.exec(escaped.slice(index))?.[0] ?? char;
      out += run;
      index += run.length;
      continue;
    }
    out += char;
    index++;
  }
  return out;
}

/**
 * Inline markdown: code spans, backslash escapes, images, links, bold,
 * italics. Operates on escaped text.
 *
 * Code spans and escapes first, held out of the text while the other rules
 * run, so a span's content and an escaped character are shown as they are:
 * `\*` is an asterisk and not the start of an italic, `\[` starts no link,
 * and a span's `**` is two asterisks. Until 2026-09-28 the rules ran over
 * each other's output, so a code span's `**x**` was also bold.
 */
export function inline(escaped: string): string {
  const held: string[] = [];
  const text = holdLiterals(escaped.replace(/\0/g, '\uFFFD'), (kind, content) => {
    held.push(kind === 'code' ? `<code>${content}</code>` : content);
    return `\0${String(held.length - 1)}\0`;
  });
  return (
    text
      // Images first, and as links rather than as `<img>`: the host's sandbox
      // CSP blocks external image loads, so an `<img>` is a guaranteed broken
      // icon. Ahead of the link rule because `![a](b)` contains `[a](b)`, and
      // matching that first would leave a stray `!` in the prose.
      .replace(/!\[([^\]]*)\]\((https?:[^)\s]+)\)/g, (_m, alt: string, url: string) =>
        `<a href="${url}" data-external>${alt === '' ? 'image' : alt}</a>`)
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" data-external>$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
      .replace(HELD, (_m, at: string) => held[Number(at)] ?? '')
  );
}

/**
 * Escaped text with its backslash escapes resolved and nothing else: the
 * text of a heading as a list of the article's sections names it. A code
 * span is kept as it is written, backticks and all, as that list always
 * showed it.
 */
export function unescaped(escaped: string): string {
  return holdLiterals(escaped, (kind, text, raw) => (kind === 'code' ? raw : text));
}

/** Paragraphs that Jamf writes as an advisory, and the kind each maps to. */
const CALLOUT_KINDS: [RegExp, string, string][] = [
  [/^(Warning|Caution)\s*:?\s*/i, 'warning', 'Warning'],
  [/^(Important)\s*:?\s*/i, 'warning', 'Important'],
  [/^(Note)\s*:?\s*/i, 'info', 'Note'],
  [/^(Tip)\s*:?\s*/i, 'info', 'Tip'],
];

/**
 * Split a markdown table row into cells, tolerating optional edge pipes.
 *
 * A pipe right after a backslash is one of the cell's characters, as the
 * server's two table writers mean it (content-parser.ts and
 * intercom-service.ts), and is passed on without that backslash, also
 * inside a code span. GFM reads it so too, except after an even run of
 * backslashes (`\\|`), which it reads as escaped backslashes and a pipe
 * that ends the cell. Every other escape is left for {@link inline} to
 * read. Until 2026-09-28 this split a cell at every pipe.
 */
export function tableCells(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  for (let index = 0; index < line.length; index++) {
    const char = line.charAt(index);
    if (char === '\\' && line.charAt(index + 1) === '|') {
      cell += '|';
      index++;
    } else if (char === '|') {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += char;
    }
  }
  cells.push(cell.trim());
  if (/^\s*\|/.test(line)) {
    cells.shift();
  }
  if (cells.length > 0 && /(?:^|[^\\])\|\s*$/.test(line)) {
    cells.pop();
  }
  return cells;
}

function isTableDivider(line: string | undefined): boolean {
  return line !== undefined && /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(line) && line.includes('-');
}

/** True for a line that starts a block a paragraph or callout must not absorb. */
function startsBlock(line: string): boolean {
  return /^(#{1,6}\s|\s*[-*+]\s|\s*\d+[.)]\s|\s*```|\s*>|\s*\|)/.test(line);
}

/** How the markdown is shown. */
export interface MarkdownOptions {
  /**
   * Whether a code block gets a Copy button: only when the host granted
   * `clipboardWrite`. The resource asks for it in `_meta.ui.permissions`,
   * but a host may decline, and `navigator.clipboard.writeText` in a
   * sandboxed iframe without the grant rejects, so an ungated button would
   * be one that silently does nothing.
   *
   * Required: until 2026-09-28 the renderer read the gate itself, and a call
   * that left it out would now drop every Copy button without a word.
   */
  copy: boolean;
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
function readFence(lines: string[], start: number, options: MarkdownOptions): Block | null {
  if (!/^\s*```/.test(lines[start] ?? '')) {
    return null;
  }
  const body: string[] = [];
  let index = start + 1;
  while (index < lines.length && !/^\s*```/.test(lines[index] ?? '')) {
    body.push(esc(lines[index] ?? ''));
    index++;
  }
  const copy = options.copy ? '<button class="copy" data-copy type="button">Copy</button>' : '';
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

function readQuote(lines: string[], start: number, options: MarkdownOptions): Block | null {
  if (!/^\s*>\s?/.test(lines[start] ?? '')) {
    return null;
  }
  const body: string[] = [];
  let index = start;
  while (index < lines.length && /^\s*>\s?/.test(lines[index] ?? '')) {
    body.push((lines[index] ?? '').replace(/^\s*>\s?/, ''));
    index++;
  }
  return { html: `<blockquote>${markdown(body.join('\n'), options)}</blockquote>`, next: index };
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
const BLOCKS: ((lines: string[], start: number, options: MarkdownOptions) => Block | null)[] = [
  readFence, readRule, readHeading, readTable, readQuote, readCallout,
];

/**
 * A deliberately small markdown subset, matched to what Jamf articles contain.
 *
 * Beyond the original headings/code/lists/paragraphs it handles tables, nested
 * lists, blockquotes, thematic breaks and advisory callouts. Two of those are
 * corrections rather than additions — see {@link readTable}, and the nesting
 * note in the list branch below.
 */
export function markdown(source: string, options: MarkdownOptions): string {
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
      (found, parse) => found ?? parse(lines, index, options),
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
