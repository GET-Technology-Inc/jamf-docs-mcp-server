/**
 * Unit tests for content-parser
 */

import { describe, it, expect } from 'vitest';
import { parseArticle, cleanSnippet, htmlToMarkdown } from '../../../src/core/services/content-parser.js';
import { extractSections } from '../../../src/core/services/tokenizer.js';

describe('parseArticle', () => {
  it('should extract title and convert content to markdown', () => {
    const html = `
      <html><body>
        <h1>MDM Profile Settings</h1>
        <article>
          <p>The MDM Profile allows you to configure device management.</p>
          <h2>Configuration</h2>
          <p>Configure the settings below.</p>
        </article>
      </body></html>
    `;

    const result = parseArticle(html, 'https://learn.jamf.com/r/en-US/doc/page');

    expect(result.title).toBe('MDM Profile Settings');
    expect(result.content).toContain('MDM Profile');
    expect(result.content).toContain('## Configuration');
  });

  it('should strip script and style elements', () => {
    const html = `
      <html><body>
        <script>alert('xss')</script>
        <style>.hidden{display:none}</style>
        <h1>Title</h1>
        <article><p>Clean content</p></article>
      </body></html>
    `;

    const result = parseArticle(html, 'https://example.com');

    expect(result.content).not.toContain('alert');
    expect(result.content).not.toContain('display');
    expect(result.content).toContain('Clean content');
  });

  it('should fix relative URLs', () => {
    const html = `
      <html><body>
        <h1>Test</h1>
        <article>
          <a href="/r/en-US/doc/other">Link</a>
          <img src="/images/photo.png" alt="Photo">
        </article>
      </body></html>
    `;

    const result = parseArticle(html, 'https://learn.jamf.com/r/en-US/doc/page');

    expect(result.content).toContain('https://learn.jamf.com/r/en-US/doc/other');
    expect(result.content).toContain('https://learn.jamf.com/images/photo.png');
  });

  it('should handle FT article with main content area', () => {
    const html = `
      <html><body>
        <main>
          <article>
            <h1>Automated Device Enrollment</h1>
            <p>Automated Device Enrollment streamlines the deployment of devices.</p>
            <h2>Requirements</h2>
            <p>You need an Apple Business Manager account.</p>
          </article>
        </main>
      </body></html>
    `;

    const result = parseArticle(html, 'https://learn.jamf.com/r/en-US/doc/ADE');
    expect(result.title).toBe('Automated Device Enrollment');
    expect(result.content).toContain('streamlines');
    expect(result.content).toContain('## Requirements');
  });

  it('should return Untitled when no h1 found', () => {
    const html = '<html><body><article><p>Content only</p></article></body></html>';
    const result = parseArticle(html, 'https://example.com');
    expect(result.title).toBe('Untitled');
  });

  it('should handle FT API HTML fragment with content-locale wrapper', () => {
    const html = `<div class="content-locale-en-US content-locale-en">
  <div id="ID-000023b2">
    <div class="body taskbody">
      <section class="section context">
        <p class="p">Jamf Connect licenses are available for purchase.</p>
      </section>
    </div>
  </div>
</div>`;

    const result = parseArticle(html, 'https://learn.jamf.com/r/en-US/doc/page');

    expect(result.title).toBe('Untitled');
    expect(result.content).toContain('Jamf Connect licenses');
    expect(result.content.length).toBeGreaterThan(10);
  });

  it('should handle FT API HTML fragment with taskbody and no locale wrapper', () => {
    const html = `<div id="task-9280">
  <div class="body taskbody">
    <section class="section context">
      <p class="p">When a policy is applied to all cloud apps, any login request will be included.</p>
    </section>
  </div>
</div>`;

    const result = parseArticle(html, 'https://learn.jamf.com/r/en-US/doc/page');

    expect(result.content).toContain('policy is applied');
    expect(result.content.length).toBeGreaterThan(10);
  });

  it('should extract title when h1 is outside body wrapper', () => {
    const html = `
      <html><body>
        <h1>Computer Configuration Profiles</h1>
        <div class="taskbody">
          <section class="section"><h2>Prerequisites</h2><p>Content here</p></section>
        </div>
      </body></html>
    `;
    const result = parseArticle(html, 'https://learn.jamf.com/r/en-US/doc/page');
    expect(result.title).toBe('Computer Configuration Profiles');
    // Body wrapper content is extracted separately from the h1 title
    expect(result.content).toContain('Prerequisites');
    expect(result.content).toContain('Content here');
  });

  it('should extract sections when headings are inside body wrapper', () => {
    const html = `
      <html><body>
        <h1>Main Title</h1>
        <div class="conbody">
          <h2>Section One</h2><p>Content one</p>
          <h2>Section Two</h2><p>Content two</p>
        </div>
      </body></html>
    `;
    const result = parseArticle(html, 'https://learn.jamf.com/r/en-US/doc/page');
    const sections = extractSections(result.content);
    expect(sections.length).toBeGreaterThanOrEqual(2);
  });

  it('should prefer article wrapper over body wrapper when they are siblings', () => {
    const html = `
      <html><body>
        <article>
          <h1>Article Title</h1>
          <p>Full article content with details</p>
        </article>
        <div class="taskbody">
          <p>Narrow body only</p>
        </div>
      </body></html>
    `;
    const result = parseArticle(html, 'https://learn.jamf.com/r/en-US/doc/page');
    expect(result.title).toBe('Article Title');
    expect(result.content).toContain('Full article content');
    expect(result.content).not.toContain('Narrow body only');
  });
});

  describe('parseArticle — includeRelated option', () => {
    it('should extract related article links when includeRelated is true', () => {
      const html = `
        <html><body>
          <h1>MDM Profile Settings</h1>
          <article>
            <p>Main content here.</p>
          </article>
          <nav class="related-links">
            <a href="https://learn.jamf.com/r/en-US/doc/Smart_Groups">Smart Groups</a>
            <a href="https://learn.jamf.com/r/en-US/doc/Policies">Policies</a>
          </nav>
        </body></html>
      `;

      const result = parseArticle(html, 'https://learn.jamf.com/r/en-US/doc/page', {
        includeRelated: true,
      });

      expect(result.relatedArticles).toHaveLength(2);
      expect(result.relatedArticles[0].title).toBe('Smart Groups');
      expect(result.relatedArticles[0].url).toBe('https://learn.jamf.com/r/en-US/doc/Smart_Groups');
      expect(result.relatedArticles[1].title).toBe('Policies');
    });

    it('should return empty relatedArticles when includeRelated is false (default)', () => {
      const html = `
        <html><body>
          <h1>Title</h1>
          <article><p>Content</p></article>
          <nav class="related-links">
            <a href="https://learn.jamf.com/r/en-US/doc/Other">Other Article</a>
          </nav>
        </body></html>
      `;

      const result = parseArticle(html, 'https://learn.jamf.com/r/en-US/doc/page');

      expect(result.relatedArticles).toEqual([]);
    });

    it('should skip related articles with empty href', () => {
      const html = `
        <html><body>
          <h1>Title</h1>
          <article><p>Content</p></article>
          <nav class="related-links">
            <a href="">Empty Href Article</a>
            <a href="https://learn.jamf.com/r/en-US/doc/Valid">Valid Article</a>
          </nav>
        </body></html>
      `;

      const result = parseArticle(html, 'https://learn.jamf.com/r/en-US/doc/page', {
        includeRelated: true,
      });

      expect(result.relatedArticles).toHaveLength(1);
      expect(result.relatedArticles[0].title).toBe('Valid Article');
    });

    it('should skip related articles with anchor-only href (#section)', () => {
      const html = `
        <html><body>
          <h1>Title</h1>
          <article><p>Content</p></article>
          <nav class="related-links">
            <a href="#section-1">Section Link</a>
            <a href="https://learn.jamf.com/r/en-US/doc/Real">Real Article</a>
          </nav>
        </body></html>
      `;

      const result = parseArticle(html, 'https://learn.jamf.com/r/en-US/doc/page', {
        includeRelated: true,
      });

      expect(result.relatedArticles).toHaveLength(1);
      expect(result.relatedArticles[0].title).toBe('Real Article');
    });

    it('should resolve relative hrefs against displayUrl', () => {
      const html = `
        <html><body>
          <h1>Title</h1>
          <article><p>Content</p></article>
          <nav class="related-links">
            <a href="/r/en-US/doc/OtherPage">Other Page</a>
          </nav>
        </body></html>
      `;

      const result = parseArticle(html, 'https://learn.jamf.com/r/en-US/doc/page', {
        includeRelated: true,
      });

      expect(result.relatedArticles).toHaveLength(1);
      // The relative href was already rewritten to absolute by cleanHtml, so it resolves correctly
      expect(result.relatedArticles[0].url).toContain('learn.jamf.com');
    });
  });

  describe('parseArticle — ft-internal-link spans', () => {
    // Copied from the live topic content of Smart_Groups
    // (GET /api/khub/maps/{mapId}/topics/{contentId}/content): FT emits links
    // that stay inside the documentation as hrefless spans addressed by TOC
    // node id, and only external links as anchors.
    const MAP_ID = 'FtEgPHSd28ZhPyLlTkrYTA';
    const REPORTS_TOC_ID = '8Tflt44ylUo_Jo99tcQj5w';
    const MASS_ACTIONS_TOC_ID = 'R13oRSNchZgR4eU7id0Chw';
    const INVENTORY_TOC_ID = '2yXTYrap2pDeisTv2J4ffw';

    const HTML = [
      '<div class="content-locale-en-US"><div class="body conbody">',
      '<p class="p">See <span class="xref ft-internal-link"',
      ` data-ft-warning="excluded-from-rendering" data-mapid="${MAP_ID}"`,
      ` data-tocid="${INVENTORY_TOC_ID}">Computer Inventory and Criteria`,
      ' Reference</span> for details.</p>',
      '<nav role="navigation" class="related-links">',
      '<div class="relinfo linklist"><strong>Related content</strong>',
      '<ul class="linklist">',
      '<li class="linklist"><span class="link ft-internal-link"',
      ` data-ft-warning="excluded-from-rendering" data-mapid="${MAP_ID}"`,
      ` data-tocid="${REPORTS_TOC_ID}">Computer Reports</span></li>`,
      '<li class="linklist"><span class="link ft-internal-link"',
      ` data-ft-warning="excluded-from-rendering" data-mapid="${MAP_ID}"`,
      ` data-tocid="${MASS_ACTIONS_TOC_ID}">Mass Actions for Computers</span></li>`,
      '<li class="linklist"><a class="link" href="https://support.apple.com/guide">',
      'Manage FileVault with MDM (Apple)</a></li>',
      '</ul></div></nav>',
      '</div></div>',
    ].join('');

    const URLS: Record<string, string> = {
      [REPORTS_TOC_ID]: 'https://learn.jamf.com/r/en-US/jamf-pro-documentation-current/Computer_Reports',
      [MASS_ACTIONS_TOC_ID]: 'https://learn.jamf.com/r/en-US/jamf-pro-documentation-current/Mass_Actions_for_Computers',
      [INVENTORY_TOC_ID]: 'https://learn.jamf.com/r/en-US/jamf-pro-documentation-current/Computer_Inventory_and_Criteria_Reference',
    };

    const resolveInternalLink = (mapId: string, tocId: string): string | undefined =>
      mapId === MAP_ID ? URLS[tocId] : undefined;

    const DISPLAY_URL = 'https://learn.jamf.com/r/en-US/jamf-pro-documentation-current/Smart_Groups';

    it('should surface resolved internal spans as related articles', () => {
      const result = parseArticle(HTML, DISPLAY_URL, {
        includeRelated: true,
        resolveInternalLink,
      });

      expect(result.relatedArticles).toEqual([
        { title: 'Computer Reports', url: URLS[REPORTS_TOC_ID] },
        { title: 'Mass Actions for Computers', url: URLS[MASS_ACTIONS_TOC_ID] },
        {
          title: 'Manage FileVault with MDM (Apple)',
          url: 'https://support.apple.com/guide',
        },
      ]);
    });

    it('should render internal spans in the body as Markdown links', () => {
      const result = parseArticle(HTML, DISPLAY_URL, {
        includeRelated: true,
        resolveInternalLink,
      });

      expect(result.content).toContain(
        `[Computer Inventory and Criteria Reference](${URLS[INVENTORY_TOC_ID]})`,
      );
      expect(result.content).toContain(`[Computer Reports](${URLS[REPORTS_TOC_ID]})`);
    });

    it('should leave unresolvable spans as plain text rather than invent an href', () => {
      const result = parseArticle(HTML, DISPLAY_URL, {
        includeRelated: true,
        resolveInternalLink: () => undefined,
      });

      // The tocId is a TOC node id, not a contentId — with no TOC to place it
      // against there is no honest URL to emit, so the text stands alone and
      // the entry is not claimed as a related article.
      expect(result.content).toContain('Computer Reports');
      expect(result.content).not.toContain(REPORTS_TOC_ID);
      expect(result.relatedArticles).toEqual([
        {
          title: 'Manage FileVault with MDM (Apple)',
          url: 'https://support.apple.com/guide',
        },
      ]);
    });

    it('should not rewrite spans that carry no destination', () => {
      const html =
        '<div class="body"><p><span class="ft-internal-link">Bare span</span></p></div>';

      const result = parseArticle(html, DISPLAY_URL, {
        includeRelated: true,
        resolveInternalLink: () => 'https://learn.jamf.com/r/en-US/doc/Nope',
      });

      expect(result.content).toContain('Bare span');
      expect(result.content).not.toContain('](');
    });
  });

  describe('parseArticle — Turndown code block rule', () => {
    it('should produce a fenced code block with language tag from <pre><code class="language-typescript">', () => {
      const html = `
        <html><body>
          <h1>Code Example</h1>
          <article>
            <pre><code class="language-typescript">const x: number = 42;</code></pre>
          </article>
        </body></html>
      `;

      const result = parseArticle(html, 'https://learn.jamf.com/r/en-US/doc/page');

      expect(result.content).toContain('```typescript');
      expect(result.content).toContain('const x: number = 42;');
      expect(result.content).toContain('```');
    });

    it('should produce a fenced code block without language tag for plain <pre><code>', () => {
      const html = `
        <html><body>
          <h1>Code Example</h1>
          <article>
            <pre><code>plain code block</code></pre>
          </article>
        </body></html>
      `;

      const result = parseArticle(html, 'https://learn.jamf.com/r/en-US/doc/page');

      expect(result.content).toContain('```\nplain code block\n```');
    });
  });

describe('cleanSnippet', () => {
  it('should strip HTML tags from snippet', () => {
    const snippet = '<span class="kwicmatch">MDM</span> Profile Settings allow configuration.  This is a long enough snippet for testing purposes.';
    const result = cleanSnippet(snippet, 'MDM', null);
    expect(result).not.toContain('<span');
    expect(result).toContain('MDM');
  });

  it('should strip breadcrumb prefix', () => {
    const snippet = 'Home > Settings > MDM Profile allows you to configure device management settings and renewal periods.';
    const result = cleanSnippet(snippet, 'MDM', null);
    expect(result).not.toMatch(/^Home/);
  });

  it('should use fallback for short snippets', () => {
    const result = cleanSnippet('Short', 'MDM Profile', 'Jamf Pro');
    expect(result).toBe('MDM Profile \u2014 Jamf Pro');
  });
});

describe('htmlToMarkdown', () => {
  it('should convert HTML to markdown', () => {
    const result = htmlToMarkdown('<h2>Title</h2><p>Paragraph</p>');
    expect(result).toContain('## Title');
    expect(result).toContain('Paragraph');
  });
});

describe('htmlToMarkdown renders tables as tables', () => {
  // Turndown's core has no table handling. Left to itself it walks the cells as
  // ordinary block content and emits their text separated by blank lines, so a
  // two-column settings reference arrives as an alternating run of labels and
  // descriptions with nothing saying which belongs to which — and the damage is
  // done before any client sees it, on the text channel the model reads as much
  // as on the structured one the MCP App renders.
  //
  // Jamf's admin guides are full of these; the captured article fixture in this
  // repo carries two of them.

  it('keeps the header row and the column relationship', () => {
    const markdown = htmlToMarkdown(
      '<table><thead><tr><th>Setting</th><th>Description</th></tr></thead>'
      + '<tbody><tr><td>Display Name</td><td>Name shown to the user</td></tr>'
      + '<tr><td>Scope</td><td>Computers to target</td></tr></tbody></table>',
    );

    expect(markdown).toContain('| Setting | Description |');
    expect(markdown).toMatch(/\|\s*---\s*\|\s*---\s*\|/);
    expect(markdown).toContain('| Display Name | Name shown to the user |');
    expect(markdown).toContain('| Scope | Computers to target |');
  });

  it('keeps inline markup inside a cell', () => {
    // Half the reason a Jamf settings table is worth reading is the variable
    // name in it, and a cell converted with textContent loses the code span.
    const markdown = htmlToMarkdown(
      '<table><tr><th>Variable</th></tr><tr><td>The <code>$UDID</code> token</td></tr></table>',
    );

    expect(markdown).toContain('`$UDID`');
  });

  it('escapes a pipe inside a cell', () => {
    // An unescaped pipe ends the cell early and shifts every column after it,
    // silently — the table still renders, with the wrong values under the
    // wrong headings.
    const markdown = htmlToMarkdown(
      '<table><tr><th>Value</th><th>Note</th></tr>'
      + '<tr><td>Computers | devices</td><td>both</td></tr></table>',
    );

    expect(markdown).toContain('Computers \\| devices');
    expect(markdown).toContain('| Computers \\| devices | both |');
  });

  it('escapes a backslash before escaping a pipe', () => {
    // Escaping the pipe alone is not enough. A cell containing a backslash
    // immediately before a pipe becomes `\\|` — a doubled backslash, which is
    // itself an escaped backslash, followed by a *live* pipe. The row then
    // breaks at exactly the input the escaping exists to handle, and every
    // column after it shifts.
    //
    // Flagged by CodeQL as js/incomplete-sanitization on the first version of
    // this rule.
    const markdown = htmlToMarkdown(
      '<table><tr><th>Path</th><th>Note</th></tr>'
      + '<tr><td>C:\\|next</td><td>ok</td></tr></table>',
    );

    const rows = markdown.split('\n').filter((line) => line.startsWith('|'));
    expect(rows).toHaveLength(3);
    // Split on pipes that are not themselves escaped: the row must still be
    // two columns, not three.
    const cells = (rows[2] ?? '').split(/(?<!\\)\|/).filter((cell) => cell.trim() !== '');
    expect(cells).toHaveLength(2);
    expect(rows[2]).toContain('\\\\');
  });

  it('still emits a divider for a table with no header row', () => {
    // Jamf frequently omits `<thead>`. A pipe table without a divider is not a
    // table to any renderer, so an unlabelled table gets an empty header rather
    // than no table.
    const markdown = htmlToMarkdown('<table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>');

    expect(markdown).toMatch(/\|\s*---\s*\|\s*---\s*\|/);
    expect(markdown).toContain('| a | b |');
    expect(markdown).toContain('| c | d |');
  });

  it('pads a short row so the columns stay aligned', () => {
    // A row with fewer cells than the header — a merged cell, usually — would
    // otherwise shift the remaining values one column left.
    const markdown = htmlToMarkdown(
      '<table><tr><th>A</th><th>B</th><th>C</th></tr><tr><td>1</td></tr></table>',
    );

    expect(markdown).toContain('| 1 |  |  |');
  });

  it('does not recurse into a nested table', () => {
    // A table cannot be nested inside a Markdown pipe row at all, so the inner
    // one degrades to its text rather than emitting pipes that break the outer.
    const markdown = htmlToMarkdown(
      '<table><tr><th>Outer</th></tr>'
      + '<tr><td><table><tr><td>inner</td></tr></table></td></tr></table>',
    );

    expect(markdown).toContain('| inner |');
    expect(markdown.split('\n').filter((line) => line.startsWith('|'))).toHaveLength(3);
  });
});
