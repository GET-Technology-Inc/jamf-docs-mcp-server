/**
 * Guard: every environment variable the READMEs document does what its row
 * says, checked where it takes effect, and the server reads no variable they
 * leave out, when its platform entry starts in either transport and while
 * each tool is called.
 *
 * env-vars-documented.test.ts asks whether each documented name appears
 * under src/, which a variable that is parsed and then read by nothing
 * passes. Replayed on the tree before #296, when the five request variables
 * were parsed and read by nothing, it flagged 0 of the 13 documented (#369).
 * cache-ttl-documented.test.ts asks what each CACHE_TTL_* value does. This
 * asks it of every other documented variable, on the server the Node entry
 * builds:
 *
 * - the request and cache settings on the context `createNodeContext` builds
 *   from the environment, with the registered tools driven over MCP. Only
 *   `fetch` is stubbed, and the cache is a FileCache in a directory of the
 *   test's own;
 * - the HTTP transport settings on the platform entry itself, `src/index.ts
 *   --transport http` in a child process, since the adapter reads them when
 *   it starts.
 *
 * What the server reads is recorded by a Proxy on `process.env`
 * (test/helpers/env-reads.ts): here while the context is built and every
 * tool is called, and in the platform entry's own process, preloaded, when it
 * starts in HTTP mode or on stdio. A read on a path none of these takes, an
 * error branch say, is not seen.
 *
 * With the defect #296 fixed put back, the context building its http client
 * from the defaults instead of `config.request`, seven cases here fail.
 *
 * Until 2026-09-28 RATE_LIMIT_DELAY spaced the calls to the http client but
 * not the retries inside a call. Measured that day through
 * `jamf_docs_list_products`, with RATE_LIMIT_DELAY=400, MAX_RETRIES=3 and
 * RETRY_DELAY=150: the maps list's 503 was retried 152 ms after the first
 * attempt, and the next retry started 55 ms after a support.jamf.com request.
 *
 * Every case starts from an environment with every documented variable
 * unset: stubbed away in this process, and left out of what a child process
 * inherits. So a shell or CI job that exports one cannot change what "unset"
 * means here.
 */

import { describe, it, expect, vi, afterAll, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createMcpServer } from '../../src/core/create-server.js';
import { defaultUserAgent } from '../../src/core/config.js';
import { HttpError } from '../../src/core/http-client.js';
import { createNodeContext } from '../../src/platforms/node/context.js';
import type { ServerContext } from '../../src/core/types/context.js';
import { createMockLoggerFactory } from '../helpers/mock-context.js';
import { CCP, CCP_URL, PRO_MAP } from '../helpers/article-upstream.js';
import { everyDocumentedEnvVar } from '../helpers/documented-env-vars.js';
import { recordEnvReads } from '../helpers/env-reads.js';
import { everySourceUpstream, SUPPORT_ARTICLE_URL } from '../helpers/every-source-upstream.js';
import { MAPS_LIST } from '../helpers/search-upstream.js';
import { getFreePort, waitForServerStart } from '../helpers/server-process.js';
import { CONCEPTS_GUIDE_URL } from '../fixtures/concepts-guide-page.js';

const ROOT = path.resolve(__dirname, '../..');

const DOCUMENTED = everyDocumentedEnvVar();

/** The prefix of the variables cache-ttl-documented.test.ts checks, which it reads from the READMEs itself. */
const CHECKED_ELSEWHERE = 'CACHE_TTL_';

/** The variables a `describe` below checks, each added by {@link describeVariables}. */
const checkedHere = new Set<string>();

/**
 * A `describe` named for the variables its cases check, which counts them as
 * checked here. The count is complete before any case runs: vitest collects
 * every `describe` in the file first.
 */
function describeVariables(names: readonly string[], cases: () => void): void {
  for (const name of names) { checkedHere.add(name); }
  describe(names.join(' and '), cases);
}

const PKG_VERSION = (JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { version: string }).version;

const CCP_CONTENT = `https://learn.jamf.com/api/khub/maps/${PRO_MAP}/topics/${CCP}/content`;

// ── Directories ─────────────────────────────────────────────────────────────

const tempDirs: string[] = [];

/** A fresh directory under the OS temp directory, which CACHE_DIR accepts; removed after the file. */
function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jamf-docs-env-'));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ── Upstream, at fetch ──────────────────────────────────────────────────────

/** The no-network guard the setup file installs, which only lets a local host through. */
const guardedFetch = globalThis.fetch;

afterEach(() => {
  vi.stubGlobal('fetch', guardedFetch);
});

/** A request, as it reached `fetch`. */
interface Sent {
  url: string;
  userAgent: string | null;
  /** `performance.now()` when it was sent. */
  at: number;
  /** When its signal aborted it, for one that was never answered. */
  abortedAt?: number;
}

/** What answers a request in place of the upstream: a status, or `'hang'` for no answer at all. */
type Override = number | 'hang';

/**
 * Serve {@link everySourceUpstream} over `fetch`, so the http client the
 * context builds is the one in use, and record every request it sends.
 * A request to a local host goes to the guard, which lets it through.
 */
function serve(override: (url: string) => Override | undefined = () => undefined): Sent[] {
  const { http } = everySourceUpstream();
  const sent: Sent[] = [];
  vi.stubGlobal('fetch', async (input: string | URL, init: RequestInit = {}): Promise<Response> => {
    const url = String(input);
    if (['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) { return await guardedFetch(input, init); }
    const headers = new Headers(init.headers);
    const request: Sent = { url, userAgent: headers.get('user-agent'), at: performance.now() };
    sent.push(request);
    const answer = override(url);
    if (answer === 'hang') {
      return await new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          request.abortedAt = performance.now();
          // What fetch rejects with when an `AbortSignal.timeout` fires.
          reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
        });
      });
    }
    if (answer !== undefined) { return new Response('', { status: answer }); }
    try {
      if (init.method === 'POST') {
        return Response.json(await http.postJson(url, typeof init.body === 'string' ? JSON.parse(init.body) : undefined));
      }
      if (headers.get('accept') === 'application/json') { return Response.json(await http.getJson(url)); }
      return new Response(await http.getText(url));
    } catch (error) {
      if (error instanceof HttpError) { return new Response('', { status: error.status, statusText: error.statusText }); }
      throw error;
    }
  });
  return sent;
}

/** The gaps between the starts of consecutive requests, in the order they were sent. */
function gapsBetween(sent: readonly Sent[]): number[] {
  const starts = sent.map(request => request.at).sort((a, b) => a - b);
  return starts.slice(1).map((at, i) => at - starts[i]);
}

// ── The context the Node server builds ──────────────────────────────────────

interface Running {
  client: Client;
  ctx: ServerContext;
  close: () => Promise<void>;
}

/**
 * Unset every documented variable, then set `env`, while `read` runs. The
 * server reads them when it builds its config, synchronously, so an async
 * `read` sees them up to its first await, and nothing after it does.
 */
function withEnv<T>(env: Record<string, string>, read: () => T): T {
  for (const name of DOCUMENTED) { vi.stubEnv(name, undefined); }
  for (const [name, value] of Object.entries(env)) { vi.stubEnv(name, value); }
  try {
    return read();
  } finally {
    vi.unstubAllEnvs();
  }
}

/**
 * A server on `createNodeContext`, with its config read from `env` alone.
 * The logger is the test's, to keep the cache's messages off stderr; every
 * other part is the one the server builds. CACHE_DIR is a fresh directory
 * unless `env` names one, so nothing is written to the working directory.
 */
async function start(env: Record<string, string>): Promise<Running> {
  const ctx = withEnv({ CACHE_DIR: tempDir(), ...env }, () => createNodeContext({ logger: createMockLoggerFactory() }));
  const server = createMcpServer(ctx);
  const client = new Client({ name: 'env-vars-take-effect', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  // Listed first, so every structuredContent is checked against its schema.
  await client.listTools();
  return {
    client,
    ctx,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

interface CallResult {
  isError?: boolean;
  content: { type: string; text?: string }[];
}

async function call(running: Running, name: string, args: Record<string, unknown>): Promise<CallResult> {
  return await running.client.callTool({ name, arguments: args }) as CallResult;
}

/** `call`, for a call the upstream answers in full. */
async function callOk(running: Running, name: string, args: Record<string, unknown>): Promise<void> {
  const result = await call(running, name, args);
  expect(result.isError, `${name} ${JSON.stringify(args)}: ${result.content[0]?.text ?? ''}`).not.toBe(true);
}

/**
 * A call of every tool, which between them read learn.jamf.com,
 * concepts.jamf.com and support.jamf.com and write more than a dozen cache
 * entries.
 */
const EVERY_TOOL: readonly (readonly [string, Record<string, unknown>])[] = [
  ['jamf_docs_list_products', {}],
  ['jamf_docs_search', { query: 'prestage' }],
  ['jamf_docs_get_toc', { product: 'jamf-pro' }],
  ['jamf_docs_get_toc', { publication: 'jamf-concepts-guides' }],
  ['jamf_docs_get_toc', { publication: 'jamf-support-jamf-pro' }],
  ['jamf_docs_get_article', { mapId: PRO_MAP, contentId: CCP }],
  ['jamf_docs_batch_get_articles', { urls: [CCP_URL, CONCEPTS_GUIDE_URL, SUPPORT_ARTICLE_URL] }],
  ['jamf_docs_glossary_lookup', { term: 'MDM' }],
];

async function callEveryTool(running: Running): Promise<void> {
  const registered = (await running.client.listTools()).tools.map(tool => tool.name);
  // A tool added later is called here too.
  expect(registered.filter(name => !EVERY_TOOL.some(([called]) => called === name))).toEqual([]);
  for (const [name, args] of EVERY_TOOL) { await callOk(running, name, args); }
}

// ── The platform entry ──────────────────────────────────────────────────────

interface Entry {
  base: string;
  /** Everything the server has written to stderr so far. */
  stderr: () => string;
}

const entries: ChildProcess[] = [];

/** SIGTERM, which the adapter drains and exits on; SIGKILL if it has not gone in 5 s. */
async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) { return; }
  const exited = new Promise<void>((resolve) => { child.once('exit', () => { resolve(); }); });
  child.kill('SIGTERM');
  const timer = setTimeout(() => { child.kill('SIGKILL'); }, 5_000);
  await exited;
  clearTimeout(timer);
}

afterEach(async () => {
  await Promise.all(entries.splice(0).map(stop));
});

/**
 * `src/index.ts` with `args` in a child process, as a user launches it, with
 * every documented variable removed from the environment it inherits and
 * `env` set. Each module in `preload` is imported before the entry.
 */
function spawnEntry(
  args: readonly string[], env: Record<string, string>, preload: readonly string[],
): { child: ChildProcess; stderr: () => string } {
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([name]) => !DOCUMENTED.includes(name)));
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', ...preload.flatMap(module => ['--import', module]), path.join(ROOT, 'src/index.ts'), ...args],
    // stdin is left open, so a server on stdio waits for its client.
    { cwd: ROOT, env: { ...inherited, CACHE_DIR: tempDir(), ...env }, stdio: ['pipe', 'ignore', 'pipe'] },
  );
  entries.push(child);
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
  return { child, stderr: () => stderr };
}

/**
 * The platform entry in HTTP mode, `src/index.ts --transport http`, started
 * by {@link spawnEntry}. It never reaches a documentation host: only /health
 * and a CORS preflight are asked of it, and neither calls a tool.
 */
async function launch(env: Record<string, string>, preload: readonly string[] = []): Promise<Entry> {
  const port = await getFreePort();
  const { child, stderr } = spawnEntry(['--transport', 'http', '--port', String(port)], env, preload);
  await waitForServerStart(child, 20_000);
  return { base: `http://127.0.0.1:${String(port)}`, stderr };
}

/** The platform entry on stdio, its default, started by {@link spawnEntry}; once it says it is running. */
async function launchStdio(env: Record<string, string>, preload: readonly string[] = []): Promise<void> {
  const { child, stderr } = spawnEntry([], env, preload);
  await vi.waitFor(() => {
    if (child.exitCode !== null) { throw new Error(`the entry exited with ${String(child.exitCode)}: ${stderr()}`); }
    expect(stderr()).toContain('running on stdio');
  }, { timeout: 20_000, interval: 50 });
}

/** GET /health `times` times, one after another; the status of each. */
async function health(entry: Entry, times: number, headers: (i: number) => Record<string, string> = () => ({})): Promise<number[]> {
  const statuses: number[] = [];
  for (let i = 0; i < times; i++) {
    statuses.push((await fetch(`${entry.base}/health`, { headers: headers(i) })).status);
  }
  return statuses;
}

/** `n` 200s, then a 429. */
function allowed(n: number): number[] {
  return [...Array<number>(n).fill(200), 429];
}

// ── Which variables ─────────────────────────────────────────────────────────

describe('every documented variable is checked', () => {
  it('checks only variables the READMEs document', () => {
    // A misspelt name here, or a regex that silently stops matching and would
    // make the next case vacuous, fails this.
    expect([...checkedHere].filter(name => !DOCUMENTED.includes(name))).toEqual([]);
  });

  it('has a describe here, or a check in cache-ttl-documented.test.ts, for each', () => {
    // A variable documented later fails this until a describe below checks
    // what it does.
    expect(DOCUMENTED.filter(name => !name.startsWith(CHECKED_ELSEWHERE) && !checkedHere.has(name))).toEqual([]);
  });
});

describe('the server reads the documented variables and no other', () => {
  /** The preload that records, in the entry's own process, what it reads; see env-reads.preload.ts. */
  const RECORD_READS = pathToFileURL(path.join(ROOT, 'test/helpers/env-reads.preload.ts')).href;

  /** What the entry recorded as read so far, sorted. */
  function readByEntry(out: string): string[] {
    return (JSON.parse(fs.readFileSync(out, 'utf8')) as string[]).sort();
  }

  it('while the context is built and every tool is called', async () => {
    serve();
    const read = new Set<string>();
    const restore = recordEnvReads((name) => { read.add(name); });
    try {
      const running = await start({});
      try {
        await callEveryTool(running);
      } finally {
        await running.close();
      }
    } finally {
      restore();
    }
    expect([...read].filter(name => !DOCUMENTED.includes(name))).toEqual([]);
    expect(read.size, 'nothing was recorded').toBeGreaterThan(0);
  });

  it('when the platform entry starts in HTTP mode and answers /health', async () => {
    // src/index.ts and its argument parsing included, which no case in this
    // process can run: the entry starts its server when it is imported.
    const out = path.join(tempDir(), 'env-reads.json');
    const entry = await launch({ ENV_READS_FILE: out }, [RECORD_READS]);
    expect((await fetch(`${entry.base}/health`)).status).toBe(200);
    expect(readByEntry(out)).toEqual(DOCUMENTED);
  });

  it('when the platform entry starts on stdio', async () => {
    const out = path.join(tempDir(), 'env-reads.json');
    await launchStdio({ ENV_READS_FILE: out }, [RECORD_READS]);
    const read = readByEntry(out);
    expect(read.filter(name => !DOCUMENTED.includes(name))).toEqual([]);
    expect(read, 'nothing was recorded').not.toEqual([]);
  });
});

describe('a value the server cannot use', () => {
  it('is warned about once by the platform entry in HTTP mode', async () => {
    // Until 2026-09-28 the HTTP adapter built the config again to read the
    // version, and each warning appeared twice.
    const entry = await launch({ REQUEST_TIMEOUT: '5' });
    expect(entry.stderr().split('\n').filter(line => line.includes('REQUEST_TIMEOUT=5 is below minimum 1000')))
      .toHaveLength(1);
  });
});

// ── Request settings ────────────────────────────────────────────────────────

describeVariables(['USER_AGENT'], () => {
  const AGENT = 'env-vars-take-effect/7.3 (+https://example.test/agent)';

  it('is sent on every request, to every host', async () => {
    const sent = serve();
    const running = await start({ USER_AGENT: AGENT });
    try {
      await callEveryTool(running);
    } finally {
      await running.close();
    }
    expect([...new Set(sent.map(request => new URL(request.url).hostname))].sort())
      .toEqual(['concepts.jamf.com', 'learn.jamf.com', 'support.jamf.com']);
    expect(sent.filter(request => request.userAgent !== AGENT).map(request => `${request.url}: ${String(request.userAgent)}`))
      .toEqual([]);
  });

  it('unset, is this package and version', async () => {
    const sent = serve();
    const running = await start({});
    try {
      await callOk(running, 'jamf_docs_get_article', { mapId: PRO_MAP, contentId: CCP });
    } finally {
      await running.close();
    }
    expect(sent).not.toEqual([]);
    expect(new Set(sent.map(request => request.userAgent))).toEqual(new Set([defaultUserAgent(PKG_VERSION)]));
  });
});

describeVariables(['REQUEST_TIMEOUT'], () => {
  it('abandons each attempt that has not been answered after it', async () => {
    // 1100 ms, which no other timeout or delay in src/ is. The retry shows
    // that the timeout is per attempt, not per call.
    const sent = serve(url => url === CCP_CONTENT ? 'hang' : undefined);
    const running = await start({ REQUEST_TIMEOUT: '1100', MAX_RETRIES: '1', RETRY_DELAY: '100' });
    try {
      await call(running, 'jamf_docs_get_article', { mapId: PRO_MAP, contentId: CCP });
    } finally {
      await running.close();
    }
    const attempts = sent.filter(request => request.url === CCP_CONTENT);
    expect(attempts).toHaveLength(2);
    for (const attempt of attempts) {
      expect(attempt.abortedAt, 'an attempt was never aborted').toBeDefined();
      const waited = (attempt.abortedAt ?? Infinity) - attempt.at;
      // The signal is made just before fetch is called, so a little under.
      expect(waited).toBeGreaterThanOrEqual(1100 - 5);
      // The default is 15 s.
      expect(waited).toBeLessThan(5_000);
    }
  });
});

describeVariables(['MAX_RETRIES', 'RETRY_DELAY'], () => {
  it('a 503 is tried MAX_RETRIES more times, RETRY_DELAY apart and then twice and four times that', async () => {
    const sent = serve(url => url === CCP_CONTENT ? 503 : undefined);
    const running = await start({ MAX_RETRIES: '3', RETRY_DELAY: '130' });
    try {
      await call(running, 'jamf_docs_get_article', { mapId: PRO_MAP, contentId: CCP });
    } finally {
      await running.close();
    }
    const gaps = gapsBetween(sent.filter(request => request.url === CCP_CONTENT));
    expect(gaps).toHaveLength(3);
    gaps.forEach((gap, i) => { expect(gap).toBeGreaterThanOrEqual(130 * 2 ** i - 5); });
    // The default base is 1000 ms.
    expect(gaps[0]).toBeLessThan(1_000);
  });

  it('a 404 is not retried, whatever MAX_RETRIES allows', async () => {
    const sent = serve(url => url === CCP_CONTENT ? 404 : undefined);
    const running = await start({ MAX_RETRIES: '3', RETRY_DELAY: '100' });
    try {
      await call(running, 'jamf_docs_get_article', { mapId: PRO_MAP, contentId: CCP });
    } finally {
      await running.close();
    }
    expect(sent.filter(request => request.url === CCP_CONTENT)).toHaveLength(1);
  });

  it('unset, a 503 is not retried', async () => {
    const sent = serve(url => url === CCP_CONTENT ? 503 : undefined);
    const running = await start({});
    try {
      await call(running, 'jamf_docs_get_article', { mapId: PRO_MAP, contentId: CCP });
    } finally {
      await running.close();
    }
    expect(sent.filter(request => request.url === CCP_CONTENT)).toHaveLength(1);
  });
});

describeVariables(['RATE_LIMIT_DELAY'], () => {
  // 170 ms, which no other delay in src/ is.
  const DELAY = 170;

  it('spaces the requests a batch fans out', async () => {
    const sent = serve();
    const running = await start({ RATE_LIMIT_DELAY: String(DELAY) });
    try {
      await callOk(running, 'jamf_docs_batch_get_articles', { urls: [CCP_URL, CONCEPTS_GUIDE_URL, SUPPORT_ARTICLE_URL] });
    } finally {
      await running.close();
    }
    expect(sent.length).toBeGreaterThan(3);
    expect(gapsBetween(sent).filter(gap => gap < DELAY - 5)).toEqual([]);
  });

  // The maps list is the request the defect was measured on, and a JSON one:
  // each of the client's methods makes its own retries.
  it.each([
    { what: 'an article\'s content (text)', url: CCP_CONTENT, tool: 'jamf_docs_get_article', args: { mapId: PRO_MAP, contentId: CCP } },
    { what: 'the maps list (JSON)', url: MAPS_LIST, tool: 'jamf_docs_list_products', args: {} },
  ])('spaces a retry of $what from the request before it, although its backoff is shorter', async ({ url, tool, args }) => {
    const sent = serve(requested => requested === url ? 503 : undefined);
    const running = await start({ RATE_LIMIT_DELAY: String(DELAY), MAX_RETRIES: '2', RETRY_DELAY: '100' });
    try {
      await call(running, tool, args);
    } finally {
      await running.close();
    }
    // 1 + MAX_RETRIES attempts each time it is fetched.
    const attempts = sent.filter(request => request.url === url).length;
    expect(attempts).toBeGreaterThan(0);
    expect(attempts % 3).toBe(0);
    expect(gapsBetween(sent).filter(gap => gap < DELAY - 5)).toEqual([]);
  });

  it('unset, lets the requests a batch fans out go together', async () => {
    const sent = serve();
    const running = await start({});
    try {
      await callOk(running, 'jamf_docs_batch_get_articles', { urls: [CCP_URL, CONCEPTS_GUIDE_URL, SUPPORT_ARTICLE_URL] });
    } finally {
      await running.close();
    }
    // The first request of each article. The 500 ms the README once gave as
    // the default would put the last a second after the first.
    const first = ['learn.jamf.com', 'concepts.jamf.com', 'support.jamf.com']
      .map(host => sent.find(request => new URL(request.url).hostname === host)?.at ?? Infinity);
    expect(Math.max(...first) - Math.min(...first)).toBeLessThan(400);
  });
});

// ── Cache settings ──────────────────────────────────────────────────────────

describeVariables(['CACHE_DIR'], () => {
  it('is where the cache is written, and a server started later reads it from there', async () => {
    const dir = path.join(tempDir(), 'cache-dir-take-effect');
    const sent = serve();
    const first = await start({ CACHE_DIR: dir });
    try {
      await callOk(first, 'jamf_docs_get_article', { mapId: PRO_MAP, contentId: CCP });
    } finally {
      await first.close();
    }
    const written = fs.readdirSync(dir);
    expect(written).not.toEqual([]);
    expect(written.filter(file => !/^[0-9a-f]{64}\.json$/.test(file))).toEqual([]);

    expect(sent.filter(request => request.url === CCP_CONTENT)).toHaveLength(1);
    const second = await start({ CACHE_DIR: dir });
    try {
      await callOk(second, 'jamf_docs_get_article', { mapId: PRO_MAP, contentId: CCP });
    } finally {
      await second.close();
    }
    expect(sent.filter(request => request.url === CCP_CONTENT)).toHaveLength(1);
  });

  it('is what the platform entry sweeps of expired entries when it starts', async () => {
    const dir = tempDir();
    const expired = path.join(dir, `${'e'.repeat(64)}.json`);
    const live = path.join(dir, `${'a'.repeat(64)}.json`);
    fs.writeFileSync(expired, JSON.stringify({ data: 'old', timestamp: 0, ttl: 60_000 }));
    fs.writeFileSync(live, JSON.stringify({ data: 'new', timestamp: Date.now(), ttl: 60_000 }));
    const entry = await launch({ CACHE_DIR: dir });
    await vi.waitFor(() => { expect(entry.stderr()).toContain('Cache sweep reclaimed 1 stale entries'); }, { timeout: 5_000 });
    expect(fs.existsSync(expired)).toBe(false);
    expect(fs.existsSync(live)).toBe(true);
  });
});

describeVariables(['CACHE_MAX_ENTRIES'], () => {
  it('is how many entries the cache keeps in memory', async () => {
    serve();
    const running = await start({ CACHE_MAX_ENTRIES: '12' });
    try {
      await callEveryTool(running);
      const stats = await running.ctx.cache.stats();
      expect(stats.totalEntries).toBeGreaterThan(12);
      expect(stats.memoryEntries).toBe(12);
    } finally {
      await running.close();
    }
  });

  it('unset, keeps every one of them', async () => {
    serve();
    const running = await start({});
    try {
      await callEveryTool(running);
      const stats = await running.ctx.cache.stats();
      expect(stats.totalEntries).toBeGreaterThan(12);
      expect(stats.memoryEntries).toBe(stats.totalEntries);
    } finally {
      await running.close();
    }
  });
});

// ── HTTP transport settings, on the platform entry ──────────────────────────

describeVariables(['RATE_LIMIT_RPM'], () => {
  it('RATE_LIMIT_RPM=7: the eighth request in a minute from one address is refused', async () => {
    const entry = await launch({ RATE_LIMIT_RPM: '7' });
    expect(await health(entry, 8)).toEqual(allowed(7));
  });

  it('unset: the sixty-first is', async () => {
    const entry = await launch({});
    expect(await health(entry, 61)).toEqual(allowed(60));
  });
});

describeVariables(['TRUST_PROXY'], () => {
  it.each(['true', '1'])('TRUST_PROXY=%s: the rightmost X-Forwarded-For address has a bucket of its own', async (value) => {
    const entry = await launch({ RATE_LIMIT_RPM: '7', TRUST_PROXY: value });
    expect(await health(entry, 8, i => ({ 'X-Forwarded-For': `203.0.113.${String(i)}` }))).toEqual(Array<number>(8).fill(200));
    // What the client wrote to the left of the proxy's entry is not read.
    expect(await health(entry, 8, i => ({ 'X-Forwarded-For': `198.51.100.${String(i)}, 192.0.2.1` }))).toEqual(allowed(7));
  });

  it.each([
    { label: 'TRUST_PROXY=TRUE', env: { TRUST_PROXY: 'TRUE' } },
    { label: 'TRUST_PROXY=yes', env: { TRUST_PROXY: 'yes' } },
    { label: 'unset', env: {} },
  ])('$label: X-Forwarded-For is not read', async ({ env }) => {
    const entry = await launch({ RATE_LIMIT_RPM: '7', ...env });
    expect(await health(entry, 8, i => ({ 'X-Forwarded-For': `203.0.113.${String(i)}` }))).toEqual(allowed(7));
  });
});

describeVariables(['CORS_ALLOWED_ORIGINS'], () => {
  it('answers each origin it lists, and no other', async () => {
    const entry = await launch({ CORS_ALLOWED_ORIGINS: 'https://a.example, https://b.example' });
    const allowOrigin = async (origin: string): Promise<string | null> =>
      (await fetch(`${entry.base}/health`, { headers: { Origin: origin } })).headers.get('access-control-allow-origin');
    expect(await allowOrigin('https://a.example')).toBe('https://a.example');
    expect(await allowOrigin('https://b.example')).toBe('https://b.example');
    expect(await allowOrigin('https://c.example')).toBeNull();

    const preflight = await fetch(`${entry.base}/mcp`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://b.example', 'Access-Control-Request-Method': 'POST' },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('https://b.example');
  });

  it('unset, answers none', async () => {
    const entry = await launch({});
    const response = await fetch(`${entry.base}/health`, { headers: { Origin: 'https://a.example' } });
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });
});
