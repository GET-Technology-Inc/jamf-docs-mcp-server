/**
 * A Fluid Topics search result's snippet is the text of its excerpt, with
 * each character reference decoded once.
 *
 * Fluid Topics sends the excerpt as HTML (`htmlExcerpt`): the matched words in
 * `<span>`s, and `'`, `"`, `&`, `<` and `>` written as `&#x27;`, `&quot;`,
 * `&amp;`, `&lt;` and `&gt;`. `cleanSnippet` stripped the tags and kept the
 * references, so until 2026-09-28 a result read "the organization&#x27;s
 * Google integration" and "navigate to Devices &gt; Settings", in
 * structuredContent, in the JSON and markdown text, and in the MCP App, which
 * escapes what it shows and so showed the `&gt;` itself. Replayed through
 * this tool, 756 of the 3,584 results of 77 searches saved that day carried
 * one; live, 107 of the 429 results of 8 searches.
 *
 * Decoded once: a page that shows the text "&lt;" sends `&amp;lt;`, and its
 * snippet says "&lt;", not "<" (the double decoding #325 removed from static
 * page titles). And the text a snippet now holds, such as a plist's `<key>`,
 * is text in markdown too: `sanitizeMarkdownText` escapes a `<`, and an `&`
 * that would start a character reference, as it escapes a `*`.
 *
 * The other text fields are not HTML. `title`, `mapTitle` and `breadcrumb`
 * come as plain text (Fluid Topics sends the title's HTML separately, as
 * `htmlTitle`), so they are read as they are. Of 20,431 entries in the same
 * 77 searches, none of those fields held a reference. 21 titles held a quote
 * or an apostrophe, and each one's `htmlTitle` held the reference for it; 41
 * breadcrumb entries held a quote, an apostrophe or a bare `&`.
 *
 * A search an earlier build cached holds its snippets as they were sent, so
 * the search cache moved to `ft-search-v3` (cache-key.ts), and the last case
 * checks that such an entry is not served.
 *
 * Every case drives the registered tool over MCP with only the HttpClient
 * stubbed. The entries are live (test/fixtures/ft-search-excerpt-entities.json
 * says where from); a case that changes one says so.
 */

import { describe, it, expect, vi } from 'vitest';
import { loadFixture } from '../../helpers/fixtures.js';
import { CLUSTERED_SEARCH, callSearch, searchUpstream } from '../../helpers/search-upstream.js';
import type { CacheKey } from '../../../src/core/services/cache-key.js';
import type { FtSearchEntry, SearchResult } from '../../../src/core/types.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

interface Group { query: string; locale: string; entry: FtSearchEntry }

const FIXTURE = loadFixture('ft-search-excerpt-entities.json') as Partial<Record<string, Group>>;

function group(name: string): Group {
  const found = FIXTURE[name];
  if (found === undefined) { throw new Error(`no fixture group ${name}`); }
  return found;
}

/** A Jamf Connect topic whose excerpt quotes a plist: `&amp;`, `&lt;key&gt;`. */
const MENU_BAR = group('menuBarGoogleCloudId');
/** A Jamf Pro "General Requirements" section: `&#x27;`, a `&gt;` path, `&quot;`. */
const GENERAL_REQUIREMENTS = group('generalRequirementsGoogle');
/** A RapidIdentity topic under the breadcrumb "Authentication & Assurance", bare `&`. */
const ENTRA_PROMPTS = group('entraExtraPrompts');
/** A Jamf Now topic titled with plain double quotes, which its `htmlTitle` writes as `&quot;`. */
const FILEVAULT_KEY = group('fileVaultUnableToChangeKey');

/** `g`'s entry with its excerpt replaced: a case no live entry shows. */
function withExcerpt(g: Group, htmlExcerpt: string): FtSearchEntry {
  const { topic } = g.entry;
  if (topic === undefined) { throw new Error('not a topic entry'); }
  return { ...g.entry, topic: { ...topic, htmlExcerpt } };
}

/** `g`'s entry with its title replaced: a case no live entry shows. */
function withTitle(g: Group, title: string): FtSearchEntry {
  const { topic } = g.entry;
  if (topic === undefined) { throw new Error('not a topic entry'); }
  return { ...g.entry, topic: { ...topic, title } };
}

// ── Harness ─────────────────────────────────────────────────────────────────

interface Reply { text: string; results: SearchResult[] }

/** A search whose Fluid Topics answer is `entries`, in that order, as one cluster each. */
async function search(entries: FtSearchEntry[], args: Record<string, unknown> = {}): Promise<Reply> {
  const { ctx } = searchUpstream({ clusteredSearch: () => entries });
  // The query only reaches the stub, and the other sources, which match nothing for it.
  const reply = await callSearch(ctx, { query: 'excerpt', ...args });
  expect(reply.isError, reply.text).not.toBe(true);
  return { text: reply.text, results: (reply.structuredContent?.results ?? []) as SearchResult[] };
}

/** The snippet of the one result `entry` gives, in structuredContent and in the JSON text. */
async function snippetOf(entry: FtSearchEntry): Promise<string> {
  const structured = await search([entry]);
  const json = await search([entry], { responseFormat: 'json' });
  const inJson = (JSON.parse(json.text) as { results: SearchResult[] }).results;
  expect(inJson.map(r => r.snippet)).toEqual(structured.results.map(r => r.snippet));
  expect(structured.results).toHaveLength(1);
  return structured.results[0]?.snippet ?? '';
}

/** The markdown line that quotes the one result's snippet. */
function quotedSnippetLine(markdown: string): string {
  const lines = markdown.split('\n').filter(line => line.startsWith('> ') && !line.startsWith('> **'));
  expect(lines).toHaveLength(1);
  return lines[0] ?? '';
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('jamf_docs_search: the snippet is the excerpt\'s text', () => {
  it('decodes the apostrophes, quotes and arrows of a live excerpt', async () => {
    expect(await snippetOf(GENERAL_REQUIREMENTS.entry)).toBe(
      '...organization\'s Google integration To check if this is enabled, log in to the Google Admin '
      + 'portal, navigate to Devices > Settings > Universal > General > Mobile Management, and ensure '
      + 'that the iOS setting is set to "Basic". A Jamf Pro User account with Conditional Access and '
      + 'Smart Group privileges...',
    );
  });

  it('gives a plist quoted in an excerpt as the plist, not its escaped form', async () => {
    expect(await snippetOf(MENU_BAR.entry)).toBe(
      'You can configure the Jamf Connect menu bar app with the Application & Custom Settings payload '
      + 'in Jamf Pro or the Jamf Connect Configuration app. In the IdPSettings dictionary, set the '
      + 'Identity Provider (Provider) setting to GoogleID, like the following: <key>IdPSettings</key> '
      + '<dict> <key>Provider</...',
    );
  });

  it('decodes a reference once: a page that shows "&lt;" gets "&lt;", not "<"', async () => {
    // Constructed: the plist of MENU_BAR as a page shows it when it writes
    // the escaped form itself, as a page about escaping XML would.
    const entry = withExcerpt(MENU_BAR, '<span class="kwicstring">In the IdPSettings dictionary, '
      + 'write the key as &amp;lt;key&amp;gt;IdPSettings&amp;lt;/key&amp;gt; and the ampersand as '
      + '&amp;amp;.</span>');

    expect(await snippetOf(entry)).toBe(
      'In the IdPSettings dictionary, write the key as &lt;key&gt;IdPSettings&lt;/key&gt; and the '
      + 'ampersand as &amp;.',
    );
  });

  it('leaves no reference in any result of a page of live entries', async () => {
    const { results } = await search([MENU_BAR, GENERAL_REQUIREMENTS, ENTRA_PROMPTS, FILEVAULT_KEY]
      .map(g => g.entry));

    expect(results).toHaveLength(4);
    for (const r of results) {
      expect(r.snippet, r.title).not.toMatch(/&(?:#x?[0-9a-f]+|[a-z]+);/i);
    }
  });

  it('counts the characters it shows when it decides an excerpt is too short to keep', async () => {
    // Constructed: 56 characters as sent, 37 once decoded, under the 50 a
    // snippet needs before the title stands in for it.
    const excerpt = '<span class="kwicstring">The user&#x27;s &quot;Basic&quot; setting &amp; its key.</span>';
    const entry = withExcerpt(GENERAL_REQUIREMENTS, excerpt);

    expect(await snippetOf(entry)).toBe('General Requirements — Jamf Pro');
  });
});

describe('jamf_docs_search: the fields that are already text', () => {
  it('reads a title, a publication and a breadcrumb as they come', async () => {
    const { results } = await search([ENTRA_PROMPTS.entry, FILEVAULT_KEY.entry]);

    expect(results.map(r => r.title)).toEqual([
      'Troubleshooting Extra Login Prompts from Entra ID',
      'Resolving an "Unable to Change Key" FileVault Error',
    ]);
    expect(results[0]?.breadcrumb).toContain('Authentication & Assurance');
    expect(results[0]?.mapTitle).toBe('RapidIdentity Platform Documentation');
  });

  it('does not decode a title, which would decode it a second time', async () => {
    // Constructed: a title that names the reference, as plain text.
    const { results } = await search([withTitle(MENU_BAR, 'Writing &amp; in a Plist')]);

    expect(results.map(r => r.title)).toEqual(['Writing &amp; in a Plist']);
  });
});

describe('jamf_docs_search markdown: the decoded text stays text', () => {
  it('escapes the angle brackets of a decoded plist', async () => {
    const { text } = await search([MENU_BAR.entry]);

    expect(quotedSnippetLine(text)).toBe(
      '> You can configure the Jamf Connect menu bar app with the Application & Custom Settings '
      + 'payload in Jamf Pro or the Jamf Connect Configuration app. In the IdPSettings dictionary, set '
      + 'the Identity Provider \\(Provider\\) setting to GoogleID, like the following: '
      + '\\<key\\>IdPSettings\\</key\\> \\<dict\\> \\<key\\>Provider\\</...',
    );
  });

  it('cannot open a tag or emphasis from a decoded reference', async () => {
    // Constructed: markup a page could show as text, and a `*` sent as a reference.
    const entry = withExcerpt(MENU_BAR, '<span class="kwicstring">Shown as text on the page: '
      + '&lt;img src=x onerror=alert(1)&gt; and &#42;&#42;not bold&#42;&#42; and &lt;!-- not a comment --&gt;.</span>');
    const { text, results } = await search([entry]);

    expect(results[0]?.snippet).toBe('Shown as text on the page: <img src=x onerror=alert(1)> and '
      + '**not bold** and <!-- not a comment -->.');
    expect(quotedSnippetLine(text)).toBe('> Shown as text on the page: \\<img src=x onerror=alert\\(1\\)\\> '
      + 'and \\*\\*not bold\\*\\* and \\<\\!-- not a comment --\\>.');
  });

  it('keeps a decoded "&lt;" from being decoded again by a markdown renderer', async () => {
    // Constructed, as the "&lt;" case above, with a bare `&` beside it.
    const entry = withExcerpt(MENU_BAR, '<span class="kwicstring">In the IdPSettings dictionary, '
      + 'write the key as &amp;lt;key&amp;gt;IdPSettings&amp;lt;/key&amp;gt;, and AT&amp;T as it is.</span>');
    const { text } = await search([entry]);

    // CommonMark reads `&lt;` in text as "<"; `\&lt;` is the text "&lt;".
    // A bare `&`, which starts no reference, needs nothing.
    expect(quotedSnippetLine(text)).toBe('> In the IdPSettings dictionary, write the key as '
      + '\\&lt;key\\&gt;IdPSettings\\&lt;/key\\&gt;, and AT&T as it is.');
  });

  it('cuts a compact line\'s preview from the decoded text', async () => {
    const { text } = await search([GENERAL_REQUIREMENTS.entry], { outputMode: 'compact' });

    // 77 characters of what the result says, then "...". Cut from the text as
    // sent, `&#x27;` took six of them, and the line ended at "log in".
    expect(text).toContain(') - ...organization\'s Google integration To check if this is enabled, log in to t...\n');
  });
});

describe('jamf_docs_search: a search an earlier build cached', () => {
  it('does not serve the encoded snippets an earlier build cached', async () => {
    // This build's key for the search, and the page it caches under it.
    const first = searchUpstream({ clusteredSearch: () => [GENERAL_REQUIREMENTS.entry] });
    await callSearch(first.ctx, { query: 'excerpt' });
    const stored = vi.mocked(first.ctx.cache.set).mock.calls.filter(([key]) => key.startsWith('ft-search-'));
    expect(stored).toHaveLength(1);
    const [[key, page]] = stored;

    // What a build before 2026-09-28 cached for it, under its own key: the
    // same page, with the snippet as Fluid Topics sent it, tags stripped.
    // CACHE_TTL_SEARCH can keep it for up to 30 days.
    let sent = GENERAL_REQUIREMENTS.entry.topic?.htmlExcerpt ?? '';
    for (let before = ''; before !== sent;) {
      before = sent;
      sent = sent.replace(/<[^>]*>/g, '');
    }
    expect(sent).toContain('Devices &gt; Settings');
    const stale = (page as SearchResult[]).map(r => ({ ...r, snippet: sent }));
    const second = searchUpstream({ clusteredSearch: () => [GENERAL_REQUIREMENTS.entry] });
    await second.ctx.cache.set(key.replace(/^ft-search-v\d+:/, 'ft-search-v2:') as CacheKey, stale);

    const reply = await callSearch(second.ctx, { query: 'excerpt' });

    expect(second.requests).toContain(`POST ${CLUSTERED_SEARCH}`);
    const results = (reply.structuredContent?.results ?? []) as SearchResult[];
    expect(results.map(r => r.snippet)).toEqual([expect.stringContaining('Devices > Settings')]);
    expect(reply.text).not.toContain('&gt;');
  });
});
