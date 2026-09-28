/**
 * The MCP App shows a character the server's markdown escapes as that
 * character, not with a backslash before it.
 *
 * The server writes markdown with CommonMark's backslash escapes: Turndown
 * escapes the characters of a page's text that markdown would read as markup,
 * and `sanitizeMarkdownText` those of a title it writes into a link, such as
 * a support.jamf.com collection's list of articles. The App's renderer read
 * none of them. Live on 2026-09-28, 22 articles held 32 escapes outside code,
 * in 3 of them, and the built bundle showed all 32 with their backslash:
 * `.jmf\_settings.json`, `\-/v2/local-admin-password/{{management\_id}}`,
 * "Cloud Distribution Service \(JCDS\)". A table cell's escaped pipe (`\|`)
 * split the cell there.
 *
 * Asserted against `app-ui/markdown.ts`, which lives apart from app.ts
 * because importing app.ts throws outside a browser, on the markdown the
 * server's own writers produce, and then against the built bundle, which is
 * what ships. What a reader sees is read with cheerio, as a browser would
 * read the HTML.
 */

import { describe, it, expect } from 'vitest';
import * as cheerio from 'cheerio';

import { inline, markdown, tableCells, unescaped } from '../../../app-ui/markdown.js';
import { esc } from '../../../app-ui/escape.js';
import { htmlToMarkdown } from '../../../src/core/services/content-parser.js';
import { sanitizeMarkdownText } from '../../../src/core/utils/sanitize.js';
import { APP_HTML } from '../../../src/core/apps/generated/app-html.js';
import { bundledFunction, bundledFunctionsContaining, markdownFunction } from '../../helpers/app-bundle.js';

/** The text a reader sees of `html`. */
function shown(html: string): string {
  return cheerio.load(html, null, false).root().text();
}

/**
 * Paragraphs whose text holds a character Turndown escapes, the first two
 * from live pages: "Components Installed on Managed Computers" and the LAPS
 * technical paper's "Using LAPS" (2026-09-28).
 */
const PAGE_TEXTS = [
  '/Library/Application Support/JAMF/.jmf_settings.json—Contains settings used by the JamfDaemon.app',
  '-/v2/local-admin-password/{{management_id}}/accounts',
  '+ not a list item',
  '# not a heading',
  '1. not a numbered step',
  '> not a quotation',
  '=== not an underline',
  '~~~ not a fence',
  'an *asterisk* pair, and __underscores__',
  '[not a link](https://learn.jamf.com/)',
  '![not an image](https://learn.jamf.com/a.png)',
  'a `backtick` pair',
  'C:\\Program Files\\JSS\\ and a backslash "\\" before a quote',
  'a < b & c > d, and the text &lt;',
];

/** Titles with a character `sanitizeMarkdownText` escapes, the first four live (support.jamf.com). */
const TITLES = [
  'Troubleshooting Jamf Pro Package Upload Issues with the Jamf Cloud Distribution Service (JCDS)',
  'Updating Inbound/Outbound IPs for Jamf Cloud | 2025',
  'Unable to Save the Use Syslog Server Information in Settings > System > Change Management',
  'Jamf Pro Self Service showing "There was an error enrolling your device: ENROLLMENT_STATUS_FAIL"',
  'A [bracketed] #hash *star* `tick` ~tilde! <tag> \\ and &amp;',
];

const LINK = 'https://support.jamf.com/en/articles/11034132-troubleshooting';

/** Rendered with no Copy button, which these tests do not look at. */
const PLAIN = { copy: false };

/**
 * A table row whose cells hold what Turndown escapes in a paragraph's text,
 * `*`, `_` and `\`, and a pipe with a backslash, as the server's table
 * writers escape one. `\d` is a backslash before a letter, which escapes
 * nothing.
 */
const CELL_ROW = '| a\\*b\\* jmf\\_x \\\\ c\\d | x\\|y |';
const CELL_TEXTS = ['a*b* jmf_x \\ c\\d', 'x|y'];

/** The paragraph `markdown` makes of `html`, as the server writes it. */
function page(html: string): string {
  return htmlToMarkdown(html);
}

describe('a character the server escapes', () => {
  it('is shown as that character, whatever of a page\'s text Turndown escaped', () => {
    for (const text of PAGE_TEXTS) {
      const html = `<p>${esc(text)}</p>`;
      expect({ text, shown: shown(markdown(page(html), PLAIN)) }).toEqual({ text, shown: text });
    }
  });

  it('is shown as that character in a link\'s text, whatever sanitizeMarkdownText escaped', () => {
    for (const title of TITLES) {
      const $ = cheerio.load(markdown(`- [${sanitizeMarkdownText(title)}](${LINK})`, PLAIN), null, false);
      expect({ title, shown: $('a').text(), href: $('a').attr('href') }).toEqual({ title, shown: title, href: LINK });
    }
  });

  it('starts no markup: an escaped asterisk, bracket or backtick is that character', () => {
    expect(inline(esc('\\*not italic\\* \\[not a link\\](https://learn.jamf.com/) \\`not code\\`')))
      .toBe('*not italic* [not a link](https://learn.jamf.com/) `not code`');
  });

  it('is a backslash when the backslash is escaped, and a backslash before a letter is a backslash', () => {
    expect(inline(esc('\\\\server\\share and C:\\Program Files'))).toBe('\\server\\share and C:\\Program Files');
  });

  it('makes no markup of an escaped angle bracket or ampersand', () => {
    const html = inline(esc('\\<img src=x onerror=alert(1)\\> \\&lt;'));
    expect(html).not.toContain('<img');
    expect(shown(html)).toBe('<img src=x onerror=alert(1)> &lt;');
  });
});

describe('a code span', () => {
  it('shows its backslashes, and what would be markup, as they are', () => {
    expect(inline(esc('`a\\_b` and `**x**` and `[a](https://learn.jamf.com/)`')))
      .toBe('<code>a\\_b</code> and <code>**x**</code> and <code>[a](https://learn.jamf.com/)</code>');
  });

  it('is read as Turndown writes one that holds backticks', () => {
    for (const code of ['a`b', '`x`', 'a``b']) {
      const $ = cheerio.load(markdown(page(`<p>run <code>${esc(code)}</code> now</p>`), PLAIN), null, false);
      expect($('code').text()).toBe(code);
    }
  });

  it('keeps the spaces of one that is all spaces, as CommonMark does', () => {
    expect(inline('`  ` and ` a `')).toBe('<code>  </code> and <code>a</code>');
  });

  it('ends only at a run of as many backticks as opened it', () => {
    expect(inline('``a`b`` `c`')).toBe('<code>a`b</code> <code>c</code>');
    expect(inline('``no end`')).toBe('``no end`');
  });
});

describe('a table cell', () => {
  it('holds a pipe the server escaped, rather than being split at it', () => {
    const table = page(
      '<table><tr><th>Key</th><th>Value</th></tr>'
      + '<tr><td>a|b</td><td><code>x|y</code></td></tr></table>',
    );
    const $ = cheerio.load(markdown(table, PLAIN), null, false);
    expect($('th').map((_i, cell) => $(cell).text()).get()).toEqual(['Key', 'Value']);
    expect($('td').map((_i, cell) => $(cell).text()).get()).toEqual(['a|b', 'x|y']);
  });

  it('shows what else the server escaped in it as those characters, and starts no markup with them', () => {
    const $ = cheerio.load(markdown(`| K | V |\n|---|---|\n${CELL_ROW}`, PLAIN), null, false);
    expect($('td').map((_i, cell) => $(cell).text()).get()).toEqual(CELL_TEXTS);
    expect($('td em, td strong')).toHaveLength(0);
    // `tableCells` reads only the pipe's escape, and leaves the rest to `inline`.
    expect(tableCells(CELL_ROW)).toEqual(['a\\*b\\* jmf\\_x \\\\ c\\d', 'x|y']);
  });

  it('is split at a pipe with no backslash before it, with or without edge pipes', () => {
    expect(tableCells('| a \\| b | c |')).toEqual(['a | b', 'c']);
    expect(tableCells('a | b')).toEqual(['a', 'b']);
    // The last pipe is escaped, so it is the cell's and not an edge.
    expect(tableCells('| a \\|')).toEqual(['a |']);
  });
});

describe('a heading, as the list of an article\'s sections names it', () => {
  it('has its escapes read, and its code spans kept as written', () => {
    expect(unescaped(esc('Using the jamf\\_binary'))).toBe('Using the jamf_binary');
    expect(unescaped(esc('`a\\_b` \\*'))).toBe('`a\\_b` *');
  });
});

describe('a NUL in the text', () => {
  it('is not read as what the renderer holds out of it', () => {
    // `inline` holds escapes and code spans out of the text between NULs.
    const html = inline(esc('x\u00000\u0000 `y`'));
    expect(html).toBe('x\uFFFD0\uFFFD <code>y</code>');
  });
});

/** The bundle's name for `esc` in app-ui/escape.ts, found by what it does. */
function escapeFunction(): string {
  const escapes = bundledFunctionsContaining('"&quot;"').filter(name =>
    (bundledFunction(name) as (value: string) => string)('<"&>') === '&lt;&quot;&amp;&gt;');
  expect(escapes).toHaveLength(1);
  return escapes[0] ?? '';
}

describe('the built bundle', () => {
  const render = bundledFunction(markdownFunction()) as typeof markdown;

  it('shows a character the server escapes as that character', () => {
    for (const text of PAGE_TEXTS) {
      expect({ text, shown: shown(render(page(`<p>${esc(text)}</p>`), PLAIN)) }).toEqual({ text, shown: text });
    }
    for (const title of TITLES) {
      const $ = cheerio.load(render(`- [${sanitizeMarkdownText(title)}](${LINK})`, PLAIN), null, false);
      expect({ title, shown: $('a').text() }).toEqual({ title, shown: title });
    }
  });

  it('holds an escaped pipe in its table cell, and reads the cell\'s other escapes', () => {
    let $ = cheerio.load(render(page('<table><tr><th>K</th><th>V</th></tr><tr><td>a|b</td><td>c</td></tr></table>'), PLAIN), null, false);
    expect($('td').map((_i, cell) => $(cell).text()).get()).toEqual(['a|b', 'c']);
    $ = cheerio.load(render(`| K | V |\n|---|---|\n${CELL_ROW}`, PLAIN), null, false);
    expect($('td').map((_i, cell) => $(cell).text()).get()).toEqual(CELL_TEXTS);
    expect($('td em, td strong')).toHaveLength(0);
  });

  it('names a heading in the list of an article\'s sections with its escapes read', () => {
    // app.ts: `<a class="mini-item" …>${unescaped(esc(s.title))}</a>`.
    const reads = bundledFunctionsContaining('"code"').filter(name => {
      try {
        const read = bundledFunction(name) as (text: string) => unknown;
        return read(esc('Using the jamf\\_binary')) === 'Using the jamf_binary' && read('`a\\_b`') === '`a\\_b`';
      } catch {
        return false;
      }
    });
    expect(reads).toHaveLength(1);
    const label = /class="mini-item"[^`]*?">\$\{([\w$]+)\(([\w$]+)\([\w$]+\.title\)\)\}<\/a>/.exec(APP_HTML);
    expect(label?.[1]).toBe(reads[0]);
    expect(label?.[2]).toBe(escapeFunction());
  });

  it('shows a search result\'s snippet as text, as it shows an external result\'s', () => {
    // app.ts: `<span class="hit-snippet">${esc(r.snippet)}</span>`, and
    // search.ts's renderExternalHit likewise. Until 2026-09-28 the first was
    // `inline(esc(r.snippet))`, so a snippet was read as markdown: live that
    // day, "Use an asterisk (*) … a search for “*” …" lost both asterisks to
    // an italic, and with the escapes read it would have lost the backslash
    // of "Do not include a backslash "\" in your file path.".
    const spans = [...APP_HTML.matchAll(/<span class="hit-snippet">\$\{(.*?)\}<\/span>/g)].map(match => match[1]);
    expect(spans).toHaveLength(2);
    // Each is one call, `<name>(<result>.snippet)`, and `<name>` is `esc`'s.
    // The name is read off the span and compared, not written into a pattern.
    const escape = escapeFunction();
    for (const span of spans) {
      const call = /^([\w$]+)\([\w$]+\.snippet\)$/.exec(span);
      expect({ span, called: call?.[1] }).toEqual({ span, called: escape });
    }
  });
});
