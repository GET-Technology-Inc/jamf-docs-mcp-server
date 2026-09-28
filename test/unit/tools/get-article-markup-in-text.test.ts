/**
 * Text an article shows is text in its markdown: a `<` or a character
 * reference the page shows is escaped, and a table cell keeps Turndown's
 * escapes as they are.
 *
 * Turndown escapes what would be Markdown syntax in a page's text (`*`, `_`,
 * `[`, a leading `>`, …), but not `<` or `&`, and CommonMark reads both: a
 * `<` that opens something tag-shaped is passed through as HTML, and `&lt;`,
 * `&amp;` or `&#60;` is decoded. The page's text is decoded by the time
 * Turndown sees it, so until 2026-09-28 a page that shows `<name>` or the
 * text "&lt;" was written as `<name>` and `&lt;`, and rendered as a tag, which
 * shows nothing, and as "<". And a table cell's backslashes were escaped
 * again after Turndown had escaped the text, so `\>` became `\\>`, which
 * renders as "\>".
 *
 * Live on 2026-09-28, through `jamf_docs_get_article`:
 *
 * - "Entity Equivalents for Disallowed XML Characters" lists `&lt;`, `&gt;`
 *   and `&amp;` as the entity of `<`, `>` and `&`. Its table read
 *   `| < | &lt; |`, `| \\> | &gt; |` and `| & | &amp; |`, which render as
 *   "<", "<"; "\>", ">"; and "&", "&".
 * - "Common Regex Patterns" lists `*` and `\d`, which read `\\*` and `\\\\d`
 *   and rendered as "\*" and "\\d".
 * - "Updating the Hostname and the Local Hostname Using a Policy" lists the
 *   options `-target <target volume>`, `-name <name>` and three more, each of
 *   which rendered as the option alone: the placeholder was read as a tag.
 *
 * Code spans and fenced code are left as they are: Turndown does not escape
 * code, and CommonMark reads neither escapes nor references in it.
 *
 * The three pages are live (test/fixtures/ft-article-markup-text.json says
 * where from); a case built for this suite says so. Every case drives the
 * registered tool over MCP, against a whole server with a real MapsRegistry
 * and TopicResolver and only the http client stubbed, and checks the
 * markdown and structuredContent's `content`, which is the same markdown.
 */

import { describe, it, expect } from 'vitest';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createMcpServer } from '../../../src/core/create-server.js';
import { MapsRegistry } from '../../../src/core/services/maps-registry.js';
import { TopicResolver } from '../../../src/core/services/topic-resolver.js';
import type { HttpClient } from '../../../src/core/http-client.js';
import { createMockCache, createMockContext } from '../../helpers/mock-context.js';
import { loadFixture } from '../../helpers/fixtures.js';
import type { FtMapInfo, FtTopicInfo } from '../../../src/core/types.js';
import type { ServerContext } from '../../../src/core/types/context.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

interface LivePage { mapId: string; contentId: string; topic: FtTopicInfo; content: string }

const FIXTURE = loadFixture('ft-article-markup-text.json') as Partial<Record<string, LivePage>>;

function page(name: string): LivePage {
  const found = FIXTURE[name];
  if (found === undefined) { throw new Error(`no fixture ${name}`); }
  return found;
}

const ENTITY_EQUIVALENTS = page('entityEquivalents');
const COMMON_REGEX_PATTERNS = page('commonRegexPatterns');
const HOSTNAME_OPTIONS = page('hostnameOptions');

const TECH_MAP = ENTITY_EQUIVALENTS.mapId;
const PRO_MAP = HOSTNAME_OPTIONS.mapId;

const meta = (key: string, ...values: string[]): { key: string; label: string; values: string[] } =>
  ({ key, label: key, values });

const MAPS: FtMapInfo[] = [
  {
    id: PRO_MAP,
    title: 'Jamf Pro Documentation 11.32.0',
    mapApiEndpoint: `/api/khub/maps/${PRO_MAP}`,
    metadata: [
      meta('version_bundle_stem', 'jamf-pro-documentation'),
      meta('version', '11.32.0'),
      meta('bundle', 'jamf-pro-documentation-current'),
      meta('latestVersion', 'yes'),
      meta('ft:locale', 'en-US'),
      meta('jamf:portal', 'Jamf Pro'),
    ],
  },
  {
    id: TECH_MAP,
    title: 'Technical Articles',
    mapApiEndpoint: `/api/khub/maps/${TECH_MAP}`,
    metadata: [meta('bundle', 'technical-articles'), meta('ft:locale', 'en-US')],
  },
];

/** A topic of Technical Articles built for this suite: `body` is its `/content`. */
function constructed(contentId: string, body: string): LivePage {
  return {
    mapId: TECH_MAP,
    contentId,
    topic: {
      title: contentId,
      id: contentId,
      contentApiEndpoint: `/api/khub/maps/${TECH_MAP}/topics/${contentId}/content`,
      metadata: [meta('ft:locale', 'en-US'), meta('ft:prettyUrl', `en-US/technical-articles/${contentId}`)],
    },
    content: `<div class="content-locale-en-US content-locale-en"><div class="body refbody">${body}</div></div>`,
  };
}

// ── Harness ─────────────────────────────────────────────────────────────────

const MAPS_LIST = 'https://learn.jamf.com/api/khub/maps';

function upstream(pages: LivePage[]): ServerContext {
  const byTopic = new Map(pages.map(p => [`/api/khub/maps/${p.mapId}/topics/${p.contentId}`, p]));
  const offline = (url: string): Error => new Error(`offline: no fixture for ${url}`);
  const http: HttpClient = {
    getJson: async <T>(url: string) => {
      await Promise.resolve();
      if (url === MAPS_LIST) { return MAPS as T; }
      const path = decodeURIComponent(new URL(url).pathname);
      if (path.endsWith('/toc')) { return [] as T; }
      const found = byTopic.get(path);
      if (found !== undefined) { return found.topic as T; }
      throw offline(url);
    },
    getText: async (url) => {
      await Promise.resolve();
      const path = decodeURIComponent(new URL(url).pathname);
      const found = path.endsWith('/content') ? byTopic.get(path.slice(0, -'/content'.length)) : undefined;
      if (found !== undefined) { return found.content; }
      throw offline(url);
    },
    postJson: async (url) => await Promise.reject(offline(url)),
  };
  const cache = createMockCache();
  const mapsRegistry = new MapsRegistry(cache, undefined, undefined, undefined, http);
  const topicResolver = new TopicResolver(mapsRegistry, cache, undefined, undefined, http);
  return createMockContext({ cache, http, mapsRegistry, topicResolver });
}

interface Reply { text: string; content: string }

/** The article `p` as `jamf_docs_get_article` gives it, by its `mapId` + `contentId`. */
async function article(p: LivePage, args: Record<string, unknown> = {}): Promise<Reply> {
  const server = createMcpServer(upstream([p]));
  const client = new Client({ name: 'test-client', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    // Listed first, so the client checks structuredContent against the
    // published outputSchema.
    await client.listTools();
    const result = await client.callTool({
      name: 'jamf_docs_get_article',
      arguments: { mapId: p.mapId, contentId: p.contentId, maxTokens: 50000, ...args },
    });
    const text = (result.content as { text?: string }[]).map(c => c.text ?? '').join('\n');
    expect(result.isError, text).not.toBe(true);
    const content = (result.structuredContent as { content?: unknown } | undefined)?.content;
    expect(typeof content).toBe('string');
    return { text, content: content as string };
  } finally {
    await client.close();
    await server.close();
  }
}

/** The lines of `reply`'s markdown that are pipe-table rows, and the same of its `content`. */
function tableRows(reply: Reply): string[] {
  const rows = (markdown: string): string[] => markdown.split('\n').filter(line => line.startsWith('|'));
  expect(rows(reply.content)).toEqual(rows(reply.text));
  return rows(reply.text);
}

/** `line` is a line of `reply`'s markdown, and of its `content`. */
function expectLine(reply: Reply, line: string): void {
  expect(reply.text.split('\n')).toContain(line);
  expect(reply.content.split('\n')).toContain(line);
}

// ── Live pages ──────────────────────────────────────────────────────────────

describe('jamf_docs_get_article: a live page\'s text is text in its markdown', () => {
  it('writes the entity table of "Entity Equivalents for Disallowed XML Characters" as the page shows it', async () => {
    const reply = await article(ENTITY_EQUIVALENTS);

    // Rendered: "<", "&lt;"; ">", "&gt;"; "&", "&amp;".
    expect(tableRows(reply)).toEqual([
      '| Reserved Character | Entity Name |',
      '| --- | --- |',
      '| \\< | \\&lt; |',
      '| \\> | \\&gt; |',
      '| & | \\&amp; |',
    ]);
  });

  it('escapes the "<" of its prose, and leaves the code span that names the entity as it is', async () => {
    const reply = await article(ENTITY_EQUIVALENTS);

    expectLine(reply, 'XML contains certain reserved characters that must be referenced as entities when the '
      + 'literal character is needed. For example, the open angle bracket (\\<) is a reserved character that '
      + 'must be referenced using the entity `&lt;` to attain the literal character in XML.');
  });

  it('writes "*" and "\\d" in the table of "Common Regex Patterns" with one escape each', async () => {
    const reply = await article(COMMON_REGEX_PATTERNS);

    // Rendered: ".", "^", "?", "+", "*", "$" and "\d".
    expect(tableRows(reply)).toEqual([
      '| Regex Patterns | Description |',
      '| --- | --- |',
      '| . | Matches any character, excluding new lines |',
      '| ^ | Matches the beginning of a line |',
      '| ? | Matches 0 or 1 occurrences of a value |',
      '| + | Matches 1 or more times |',
      '| \\* | Matches 0 or more times |',
      '| $ | Matches the end of a line |',
      '| \\\\d | Matches a numeric digit |',
    ]);
    expectLine(reply, 'The > & \\< characters are XML reserved characters that overlap with valid regex '
      + 'characters. These reserved characters must be referenced as entities when the literal character '
      + 'is needed.');
  });

  it('keeps each placeholder of "Updating the Hostname" as text, where it rendered as a tag', async () => {
    const reply = await article(HOSTNAME_OPTIONS);

    for (const line of [
      '\\-target \\<target volume>',
      '\\-name \\<name>',
      '\\-suffix \\<suffix>',
      '\\-prefix \\<prefix>',
      '\\-fromFile \\<file path>',
    ]) {
      expectLine(reply, line);
    }
    // The options without one, and the code spans, are as they were.
    expectLine(reply, '\\-useMACAddress');
    expect(reply.text).toContain('`sudo jamf setComputerName -useMACAddress -suffix \'-example\'`');
  });

  it('writes the same body in compact output and in the JSON text', async () => {
    const full = await article(ENTITY_EQUIVALENTS);
    const compact = await article(ENTITY_EQUIVALENTS, { outputMode: 'compact' });
    const json = await article(ENTITY_EQUIVALENTS, { responseFormat: 'json' });

    expect(compact.content).toBe(full.content);
    expect(compact.text).toContain(full.content);
    expect((JSON.parse(json.text) as { content: string }).content).toBe(full.content);
  });

  it('names a section by its heading as before: the escapes change no section id', async () => {
    const reply = await article(ENTITY_EQUIVALENTS, { section: 'xml-reserved-characters-and-entity-equivalents' });

    expect(tableRows(reply)).toHaveLength(5);
    expect(reply.content).not.toContain('open angle bracket');
  });
});

// ── Constructed pages ───────────────────────────────────────────────────────

describe('jamf_docs_get_article: markup a page shows as text stays text', () => {
  it('escapes the "<" of a tag, a comment and an autolink the page shows as text', async () => {
    // CommonMark reads none of the three as HTML or a link. GFM's extended
    // autolinks still find the bare URL after the escaped "<", and take the
    // ">" after it into the link.
    const reply = await article(constructed('Markup_Shown_As_Text',
      '<p class="p">Set &lt;img src=x onerror=alert(1)&gt;, &lt;!-- hidden --&gt; and '
      + '&lt;https://example.com&gt; as text.</p>'));

    expectLine(reply, 'Set \\<img src=x onerror=alert(1)>, \\<!-- hidden --> and \\<https://example.com> as text.');
  });

  it('escapes the & of each character reference the page shows, named or numeric, once', async () => {
    const reply = await article(constructed('References_Shown_As_Text',
      '<p class="p">Write &amp;lt;, &amp;LT;, &amp;frac12;, &amp;#60;, &amp;#x3C;, &amp;#X3C; and &amp;#x3c; '
      + 'as they are; AT&amp;T, R&amp;D, a &amp; b, &amp;; and &amp;lt stay.</p>'));

    expectLine(reply, 'Write \\&lt;, \\&LT;, \\&frac12;, \\&#60;, \\&#x3C;, \\&#X3C; and \\&#x3c; '
      + 'as they are; AT&T, R&D, a & b, &; and &lt stay.');
  });

  it('escapes a "<" after a backslash the page shows as its own character', async () => {
    // Turndown writes the backslash as `\\`; the `<` after it gets its own.
    const reply = await article(constructed('Backslash_Before_Markup',
      '<p class="p">The path C:\\&lt;folder&gt; and the escape \\&amp;lt;.</p>'));

    expectLine(reply, 'The path C:\\\\\\<folder> and the escape \\\\\\&lt;.');
  });

  it('leaves code spans and fenced code as the page has them', async () => {
    const reply = await article(constructed('Code_Unescaped',
      '<p class="p">The key <code class="ph codeph">&lt;key&gt;IdPSettings&lt;/key&gt; &amp;lt;</code>:</p>'
      + '<pre class="pre codeblock"><code>&lt;dict&gt;\n  &lt;key&gt;a_b&lt;/key&gt; &amp;amp;\n&lt;/dict&gt;</code></pre>'));

    expectLine(reply, 'The key `<key>IdPSettings</key> &lt;`:');
    expect(reply.content).toContain('```\n<dict>\n  <key>a_b</key> &amp;\n</dict>\n```');
  });

  it('keeps a table cell\'s code as the page has it, and escapes its pipes, and no more', async () => {
    const reply = await article(constructed('Cell_Code',
      '<table><tr><th>Value</th><th>Note</th></tr>'
      + '<tr><td><code>C:\\Temp\\</code></td><td><code>a|b</code> or a|b</td></tr>'
      + '<tr><td>&lt;string&gt;</td><td>a \\ b</td></tr></table>'));

    // Rendered: `C:\Temp\` | `a|b` or a|b; <string> | a \ b.
    expect(tableRows(reply)).toEqual([
      '| Value | Note |',
      '| --- | --- |',
      '| `C:\\Temp\\` | `a\\|b` or a\\|b |',
      '| \\<string> | a \\\\ b |',
    ]);
  });

  it('escapes the text of a cell that holds a table as a text node is escaped', async () => {
    // A pipe row cannot hold a table, so such a cell is written as its text.
    const reply = await article(constructed('Nested_Table_Text',
      '<table><tr><th>Outer</th></tr>'
      + '<tr><td><table><tr><td>*x* &lt;y&gt; a|b \\ z &amp;lt;</td></tr></table></td></tr></table>'));

    expect(tableRows(reply)).toEqual([
      '| Outer |',
      '| --- |',
      '| \\*x\\* \\<y> a\\|b \\\\ z \\&lt; |',
    ]);
  });
});
