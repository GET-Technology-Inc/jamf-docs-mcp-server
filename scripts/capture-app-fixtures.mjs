/**
 * Captures real `structuredContent` payloads for the app-ui dev harness.
 *
 * The harness renders the viewer against fixtures rather than a live server, so
 * a design change can be judged in under a second without a network round trip.
 * That only works if the fixtures are the real thing: the viewer's whole job is
 * to render fields that a hand-written payload tends to omit precisely because
 * they are the awkward ones — `filterRelaxation`, `otherSources`, `localeNote`,
 * a `versionStatus` of `superseded`, a TOC addressed by `publication` rather
 * than `product`. A fixture set that never exercises those is a fixture set
 * that certifies a viewer which drops them.
 *
 * So this drives the built server over stdio exactly as a host would, and
 * writes what came back. It needs network access to learn.jamf.com.
 *
 * The server keeps its cache in a temp directory of its own, removed when the
 * script ends, so every capture is a live answer. Until 2026-09-28 it was
 * started from the checkout with no CACHE_DIR, so it kept its cache in the
 * checkout's `.cache`, and a capture could record an answer that cache had
 * kept for up to its TTL, 7 days for the maps list.
 *
 *   npm run build && node scripts/capture-app-fixtures.mjs
 *
 * The output is committed. Re-run it when a tool's output schema changes; the
 * harness is not part of the published package, so a stale capture costs a
 * misleading preview rather than a shipped bug.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const outFile = path.join(repo, 'app-ui', 'dev', 'fixtures.json');

// The server's cache, not the checkout's `.cache`; see the header. Removed
// however the script ends, after the server has exited.
const cacheDir = mkdtempSync(path.join(os.tmpdir(), 'jamf-docs-capture-cache-'));
process.on('exit', () => { rmSync(cacheDir, { recursive: true, force: true }); });

/**
 * The captures, in the order they appear in the harness picker.
 *
 * `label` is what the picker shows; `why` documents which branch of the viewer
 * this payload is here to exercise, so a future edit can tell a fixture that
 * earns its place from one that is only another search.
 */
const CAPTURES = [
  {
    key: 'search',
    label: 'Search — typical',
    why: 'The common case: ten hits of a product\'s documentation, each with its breadcrumb. Until 2026-09-28 this said their docTypes were mixed; all ten were documentation then too. "Search — filter relaxed" mixes documentation and training.',
    tool: 'jamf_docs_search',
    args: { query: 'automated device enrollment', product: 'jamf-pro', responseFormat: 'json' },
  },
  {
    key: 'search-relaxed',
    label: 'Search — filter relaxed',
    why: 'A topic filter none of the results matched, so the server dropped it and said so in filterRelaxation. The viewer must surface that, or the user reads results the filter was meant to exclude as though it held. Until 2026-09-28 this asked for Jamf Pro 10.1.0, but a version filter goes upstream and is never relaxed: that search has no results.',
    tool: 'jamf_docs_search',
    args: { query: 'FileVault escrow', product: 'jamf-pro', topic: 'printers', responseFormat: 'json' },
  },
  {
    key: 'search-empty',
    label: 'Search — no results',
    why: 'Exercises the empty state and the suggestions list, and the other-source matches it shows in either display mode: no documentation is at version 10.1.0, so nothing matched. Until 2026-09-28 this was "zzzqqq nonexistent topic", which had 50 results, such as "Advanced Topics".',
    tool: 'jamf_docs_search',
    args: { query: 'FileVault escrow', product: 'jamf-pro', version: '10.1.0', responseFormat: 'json' },
  },
  {
    key: 'search-nothing',
    label: 'Search — nothing matched',
    why: 'A search with no results, no suggestion to run and no match on another site, so the view says "Nothing matched." and gives no advice: "xyzzyq" has none of the three in en-US (live 2026-09-28). Until that day the harness had no such search.',
    tool: 'jamf_docs_search',
    args: { query: 'xyzzyq', responseFormat: 'json' },
  },
  {
    key: 'search-training',
    label: 'Search — training courses',
    why: 'Jamf Training Catalog courses among the results, marked external: each opens in a browser rather than in the panel, and names trainingcatalog.jamf.com where an article shows its breadcrumb. The third result is one, so the inline view shows it (live 2026-09-28). Until that day the search dropped them.',
    tool: 'jamf_docs_search',
    args: { query: 'FileVault', docType: 'training', responseFormat: 'json' },
  },
  {
    key: 'search-other-sources',
    label: 'Search — other sources',
    why: 'Populates otherSources, the separate population the server refuses to interleave.',
    tool: 'jamf_docs_search',
    args: { query: 'Jamf Pro API authentication', responseFormat: 'json' },
  },
  {
    key: 'toc',
    label: 'TOC — Jamf Pro',
    why: 'A deep tree: exercises depth indentation and paging.',
    tool: 'jamf_docs_get_toc',
    args: { product: 'jamf-pro', responseFormat: 'json' },
  },
  {
    key: 'toc-shallow',
    label: 'TOC — small product',
    why: 'A short TOC: 13 entries, two levels deep, on one page, so there is nothing to page and little to indent, and the layout has to hold up anyway. Until 2026-09-28 this said it was flat.',
    tool: 'jamf_docs_get_toc',
    args: { product: 'jamf-routines', responseFormat: 'json' },
  },
  {
    key: 'toc-cut',
    label: 'TOC — entry cut to fit',
    why: 'A top-level entry larger than maxTokens on its own, alone on its page and cut to fit, so truncatedEntry and the note that goes with it render. Page 2 of Jamf Pro at 100 tokens is "Overview of Technologies", 14 of its 21 entries (live 2026-09-26).',
    tool: 'jamf_docs_get_toc',
    args: { product: 'jamf-pro', page: 2, maxTokens: 100, responseFormat: 'json' },
  },
  {
    key: 'article-parent',
    label: 'Article — with children',
    why: 'A parent topic. On learn.jamf.com its nine <h2> sections are this page; through the API they are nine separate topics, and navigation.children is the only thing that says so.',
    tool: 'jamf_docs_get_article',
    args: {
      url: 'https://learn.jamf.com/r/en-US/jamf-pro-documentation-current/Computer_Configuration_Profiles',
      responseFormat: 'json',
    },
  },
  {
    key: 'article-tables',
    label: 'Article — tables',
    why: 'A multi-row settings table. Turndown had no table rule, so this page used to arrive as an undifferentiated run of variable names and descriptions with nothing saying which belonged to which.',
    tool: 'jamf_docs_get_article',
    args: {
      url: 'https://learn.jamf.com/r/en-US/jamf-pro-documentation-current/Payload_Variables_for_Configuration_Profiles',
      responseFormat: 'json',
      maxTokens: 20000,
    },
  },
  {
    key: 'article-prose',
    label: 'Article — prose only',
    why: 'The common shape: no headings, so sections[] is empty and the section nav must not render. Almost every Jamf page looks like this (118 of 120 sampled in the Jamf Pro map, measured 2026-09-18).',
    tool: 'jamf_docs_get_article',
    args: {
      url: 'https://learn.jamf.com/r/en-US/jamf-pro-documentation-current/Computer_Inventory_Information',
      responseFormat: 'json',
    },
  },
  {
    key: 'article-zh',
    label: 'Article — zh-TW request',
    why: 'A zh-TW request for a page given by its en-US url. Jamf translates this page, so it comes back in zh-TW, with a note that the url was en-US: the CJK line-breaking case. Its contentLocale, on a server that gives a learn.jamf.com topic one, is zh-TW, the language asked for, so it does not reach the notice for a page shown in another language than asked for: "Article — no translation" does. Until 2026-09-28 this said only an ArticleProvider set contentLocale, which a concepts.jamf.com or support.jamf.com page has too since #378, and before that that it returned en-US with a localeNote.',
    tool: 'jamf_docs_get_article',
    args: {
      url: 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation-current/page/Smart_Groups.html',
      language: 'zh-TW',
      responseFormat: 'json',
    },
  },
  {
    key: 'article-untranslated',
    label: 'Article — no translation',
    why: 'A support.jamf.com article asked for in ja-JP, which Jamf publishes in en-US only, so it comes back in en-US, and contentLocale says so. The view says "Shown in en-US", and why: no translation for your locale on a ja-JP host, no ja-JP translation on an en-US one, and none for your locale available here on a ko-KR one, whose language the tools do not take. Until 2026-09-28 the view compared contentLocale with the host\'s locale, and the harness had no page that reached it.',
    tool: 'jamf_docs_get_article',
    args: {
      url: 'https://support.jamf.com/en/articles/10631322-get-started-with-jamf-now',
      language: 'ja-JP',
      responseFormat: 'json',
    },
  },
  {
    key: 'article-collection',
    label: 'Article — support.jamf.com collection',
    why: 'A support.jamf.com collection, read as the list of its articles. Their titles are written into links with markdown\'s characters escaped, as in "\\(JCDS\\)" and "ENROLLMENT\\_STATUS\\_FAIL", and the view shows each escaped character as itself. Until 2026-09-28 it showed each with its backslash.',
    tool: 'jamf_docs_get_article',
    args: { url: 'https://support.jamf.com/en/collections/12369024-jamf-pro', responseFormat: 'json' },
  },
  {
    key: 'article-sections',
    label: 'Article — with sections',
    why: 'One of the minority of topics whose author put headings inside a single topic (~2% within the Jamf Pro documentation map, measured 2026-09-18 — every fixture URL here comes from that map). The only fixture that exercises the section rail, the id stamping and anchor navigation.',
    tool: 'jamf_docs_get_article',
    args: {
      url: 'https://learn.jamf.com/r/en-US/jamf-pro-documentation-current/Components_Installed_on_Managed_Computers',
      responseFormat: 'json',
      maxTokens: 20000,
    },
  },
  {
    key: 'article-truncated',
    label: 'Article — truncated',
    why: 'A long article under a small token budget, so truncated=true and the notice that goes with it actually render.',
    tool: 'jamf_docs_get_article',
    args: {
      url: 'https://learn.jamf.com/r/en-US/jamf-pro-documentation-current/Payload_Variables_for_Configuration_Profiles',
      responseFormat: 'json',
      maxTokens: 400,
    },
  },
  {
    key: 'toc-publication',
    label: 'TOC — by publication',
    why: 'Addressed on the publication axis, so it reports publicationId and no productId. The Load more path for this used to send product: undefined and fail.',
    tool: 'jamf_docs_get_toc',
    args: { publication: 'jamf-pro-release-notes', responseFormat: 'json' },
  },
  {
    key: 'glossary',
    label: 'Glossary lookup',
    why: 'The glossary view with one definition, which it shows as the answer: the term, its product and its definition, not a list of one. Until 2026-09-28 this said the tool had no view.',
    tool: 'jamf_docs_glossary_lookup',
    args: { term: 'PreStage', responseFormat: 'json' },
  },
];

/** Minimal stdio MCP client. The SDK client would work too; this keeps the script dependency-free. */
class StdioClient {
  constructor(command, args) {
    this.child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'inherit'],
      cwd: repo,
      env: { ...process.env, CACHE_DIR: cacheDir },
    });
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = '';
    this.child.stdout.setEncoding('utf-8');
    this.child.stdout.on('data', (chunk) => this.consume(chunk));
  }

  consume(chunk) {
    this.buffer += chunk;
    let index = this.buffer.indexOf('\n');
    while (index !== -1) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (line !== '') {
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          // The server logs to stderr, so a non-JSON stdout line is a protocol
          // fault worth seeing rather than swallowing.
          console.error('non-JSON stdout line:', line.slice(0, 200));
          message = null;
        }
        if (message !== null && this.pending.has(message.id)) {
          const { resolve, reject } = this.pending.get(message.id);
          this.pending.delete(message.id);
          if (message.error !== undefined) {
            reject(new Error(message.error.message ?? 'unknown error'));
          } else {
            resolve(message.result);
          }
        }
      }
      index = this.buffer.indexOf('\n');
    }
  }

  request(method, params) {
    const id = this.nextId++;
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.delete(id)) {
          reject(new Error(`${method} timed out after 90s`));
        }
      }, 90_000);
    });
  }

  notify(method, params) {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  /** Resolves once the server has exited, so it writes nothing after the cache is removed. */
  close() {
    const { child } = this;
    const exited = child.exitCode !== null || child.signalCode !== null
      ? Promise.resolve()
      : new Promise((resolve) => { child.once('exit', resolve); });
    child.stdin.end();
    child.kill();
    return exited;
  }
}

const client = new StdioClient('node', ['dist/index.js']);

await client.request('initialize', {
  protocolVersion: '2026-07-28',
  capabilities: {},
  clientInfo: { name: 'capture-app-fixtures', version: '1.0.0' },
});
client.notify('notifications/initialized', {});

const fixtures = [];
for (const capture of CAPTURES) {
  process.stdout.write(`${capture.key} … `);
  try {
    const result = await client.request('tools/call', {
      name: capture.tool,
      arguments: capture.args,
    });
    const structured = result?.structuredContent;
    if (structured === undefined) {
      console.log('no structuredContent — skipped');
      continue;
    }
    fixtures.push({
      key: capture.key,
      label: capture.label,
      why: capture.why,
      tool: capture.tool,
      arguments: capture.args,
      structuredContent: structured,
    });
    console.log('ok');
  } catch (error) {
    console.log(`failed: ${error.message}`);
  }
}

await client.close();

if (fixtures.length === 0) {
  console.error('\nNothing captured. The existing fixtures.json is left untouched.');
  process.exit(1);
}

await writeFile(outFile, `${JSON.stringify(fixtures, null, 2)}\n`, 'utf-8');
console.log(`\n${fixtures.length}/${CAPTURES.length} captured → ${path.relative(repo, outFile)}`);
