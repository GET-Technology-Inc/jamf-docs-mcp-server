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
 *   npm run build && node scripts/capture-app-fixtures.mjs
 *
 * The output is committed. Re-run it when a tool's output schema changes; the
 * harness is not part of the published package, so a stale capture costs a
 * misleading preview rather than a shipped bug.
 */

import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const outFile = path.join(repo, 'app-ui', 'dev', 'fixtures.json');

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
    why: 'The common case: ten hits, breadcrumbs, mixed docTypes.',
    tool: 'jamf_docs_search',
    args: { query: 'automated device enrollment', product: 'jamf-pro', responseFormat: 'json' },
  },
  {
    key: 'search-relaxed',
    label: 'Search — filter relaxed',
    why: 'A version filter nothing matched, so the server dropped it and said so in filterRelaxation. The viewer must surface that, or the user reads results for the wrong version.',
    tool: 'jamf_docs_search',
    args: { query: 'FileVault escrow', product: 'jamf-pro', version: '10.1.0', responseFormat: 'json' },
  },
  {
    key: 'search-empty',
    label: 'Search — no results',
    why: 'Exercises the empty state and the suggestions list.',
    tool: 'jamf_docs_search',
    args: { query: 'zzzqqq nonexistent topic', responseFormat: 'json' },
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
    why: 'A short flat TOC, where indentation carries nothing and the layout has to hold up anyway.',
    tool: 'jamf_docs_get_toc',
    args: { product: 'jamf-routines', responseFormat: 'json' },
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
    why: 'A 22-row settings table. Turndown had no table rule, so this page used to arrive as an undifferentiated run of variable names and descriptions with nothing saying which belonged to which.',
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
    why: 'The common shape: no headings, so sections[] is empty and the section nav must not render. 20 of 22 sampled Jamf pages look like this.',
    tool: 'jamf_docs_get_article',
    args: {
      url: 'https://learn.jamf.com/r/en-US/jamf-pro-documentation-current/Computer_Inventory_Information',
      responseFormat: 'json',
    },
  },
  {
    key: 'article-zh',
    label: 'Article — zh-TW request',
    why: 'Jamf publishes no translation for most pages, so this returns en-US with a localeNote. Also the RTL/CJK line-breaking case.',
    tool: 'jamf_docs_get_article',
    args: {
      url: 'https://learn.jamf.com/en-US/bundle/jamf-pro-documentation-current/page/Smart_Groups.html',
      language: 'zh-TW',
      responseFormat: 'json',
    },
  },
  {
    key: 'article-sections',
    label: 'Article — with sections',
    why: 'One of the ~10% of topics whose author put headings inside a single topic. The only fixture that exercises the section rail, the id stamping and anchor navigation.',
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
    why: 'The fourth tool, which has an output schema and no view yet.',
    tool: 'jamf_docs_glossary_lookup',
    args: { term: 'PreStage', responseFormat: 'json' },
  },
];

/** Minimal stdio MCP client. The SDK client would work too; this keeps the script dependency-free. */
class StdioClient {
  constructor(command, args) {
    this.child = spawn(command, args, { stdio: ['pipe', 'pipe', 'inherit'], cwd: repo });
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

  close() {
    this.child.stdin.end();
    this.child.kill();
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

client.close();

if (fixtures.length === 0) {
  console.error('\nNothing captured. The existing fixtures.json is left untouched.');
  process.exit(1);
}

await writeFile(outFile, `${JSON.stringify(fixtures, null, 2)}\n`, 'utf-8');
console.log(`\n${fixtures.length}/${CAPTURES.length} captured → ${path.relative(repo, outFile)}`);
