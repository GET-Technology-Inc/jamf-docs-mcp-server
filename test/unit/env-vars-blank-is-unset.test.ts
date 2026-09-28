/**
 * Guard: every environment variable the READMEs document, set to an empty
 * value or to whitespace alone, does what it does unset, and nothing is
 * printed about it. A shell, a `.env` file or a container manifest that
 * writes `NAME=` for a setting it means to leave alone configures nothing.
 *
 * Until 2026-09-28 only the numeric settings read a blank value as unset
 * (#375). Measured that day on the context `createNodeContext` builds, with
 * `fetch` stubbed, from a working directory of its own:
 *
 * - CACHE_DIR= wrote the cache's entries into the working directory itself,
 *   and `prune()` could not list the directory `''`, so it reclaimed no
 *   expired entry there, not even one planted for it. CACHE_DIR='   ' wrote
 *   them into a directory named with three spaces.
 * - USER_AGENT= made the configured User-Agent `''`, and every request went
 *   out with `User-Agent: ` and nothing after it. USER_AGENT='   ' did the
 *   same, since fetch trims a header value.
 *
 * Neither printed a warning.
 *
 * Checked three ways:
 *
 * - the config `createNodeConfig` builds, for each variable it reads, against
 *   the one it builds with that variable unset. Which variables it reads is
 *   recorded (test/helpers/env-reads.ts), not listed here;
 * - USER_AGENT on the requests the server sends, with the registered tools
 *   driven over MCP, and CACHE_DIR on the platform entry's startup sweep, run
 *   from a working directory of the test's own;
 * - every other documented variable, which the HTTP adapter reads when it
 *   starts, on the platform entry in HTTP mode.
 *
 * Every case starts from an environment with every documented variable
 * unset, as env-vars-take-effect.test.ts does.
 */

import { describe, it, expect, vi, afterAll, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createMcpServer } from '../../src/core/create-server.js';
import { defaultUserAgent } from '../../src/core/config.js';
import type { ServerConfig } from '../../src/core/config.js';
import { HttpError } from '../../src/core/http-client.js';
import { createNodeConfig } from '../../src/platforms/node/config.js';
import { createNodeContext } from '../../src/platforms/node/context.js';
import { createMockLoggerFactory } from '../helpers/mock-context.js';
import { CCP, PRO_MAP } from '../helpers/article-upstream.js';
import { everyDocumentedEnvVar } from '../helpers/documented-env-vars.js';
import { recordEnvReads } from '../helpers/env-reads.js';
import { everySourceUpstream } from '../helpers/every-source-upstream.js';
import { getFreePort, waitForServerStart } from '../helpers/server-process.js';

const ROOT = path.resolve(__dirname, '../..');

const DOCUMENTED = everyDocumentedEnvVar();

const PKG_VERSION = (JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { version: string }).version;

/** Values that say nothing: empty, spaces, and a tab and a newline. */
const BLANK = ['', '   ', '\t\n'];

// ── Directories ─────────────────────────────────────────────────────────────

const tempDirs: string[] = [];

/** A fresh directory under the OS temp directory, which CACHE_DIR accepts; removed after the file. */
function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jamf-docs-blank-'));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ── The environment ─────────────────────────────────────────────────────────

/** Unset every documented variable, then set `env`, while `read` runs. */
function withEnv<T>(env: Record<string, string>, read: () => T): T {
  for (const name of DOCUMENTED) { vi.stubEnv(name, undefined); }
  for (const [name, value] of Object.entries(env)) { vi.stubEnv(name, value); }
  try {
    return read();
  } finally {
    vi.unstubAllEnvs();
  }
}

/** The config, and what was printed while it was built. */
function configUnder(env: Record<string, string>): { config: ServerConfig; printed: string[] } {
  const printed: string[] = [];
  const stderr = vi.spyOn(console, 'error').mockImplementation((line: unknown) => { printed.push(String(line)); });
  try {
    return { config: withEnv(env, createNodeConfig), printed };
  } finally {
    stderr.mockRestore();
  }
}

/** The variables `createNodeConfig` reads, recorded while it builds a config. */
function readByConfig(): string[] {
  const read = new Set<string>();
  const restore = recordEnvReads((name) => { read.add(name); });
  try {
    configUnder({});
  } finally {
    restore();
  }
  return [...read].sort();
}

const READ_BY_CONFIG = readByConfig();

/** The rest, which the HTTP adapter reads when the platform entry starts in HTTP mode. */
const READ_BY_ADAPTER = DOCUMENTED.filter(name => !READ_BY_CONFIG.includes(name));

// ── Which variables ─────────────────────────────────────────────────────────

/** The variables the entry's answers are checked for below, each by what it does unset. */
const CHECKED_ON_ENTRY = ['CORS_ALLOWED_ORIGINS', 'RATE_LIMIT_RPM', 'TRUST_PROXY'];

describe('every documented variable is checked', () => {
  it('createNodeConfig reads only documented variables, and some', () => {
    // A recorder that stopped matching src/ frames would leave every
    // variable to the entry, and the cases below vacuous.
    expect(READ_BY_CONFIG.filter(name => !DOCUMENTED.includes(name))).toEqual([]);
    expect(READ_BY_CONFIG).toContain('CACHE_DIR');
  });

  it('has a check on the entry for each of the others', () => {
    // A variable documented later, and read somewhere else, fails this until
    // a check below says what it does unset.
    expect(READ_BY_ADAPTER).toEqual([...CHECKED_ON_ENTRY].sort());
  });
});

// ── The config ──────────────────────────────────────────────────────────────

describe.each(READ_BY_CONFIG)('%s, set to a blank value', (name) => {
  it.each(BLANK)('%j gives the config it gives unset, and prints nothing', (value) => {
    const unset = configUnder({});
    const blank = configUnder({ [name]: value });
    expect(blank.config).toEqual(unset.config);
    expect(blank.printed).toEqual([]);
  });
});

// ── On the server ───────────────────────────────────────────────────────────

/** The no-network guard the setup file installs, which only lets a local host through. */
const guardedFetch = globalThis.fetch;

afterEach(() => {
  vi.stubGlobal('fetch', guardedFetch);
});

/**
 * Serve {@link everySourceUpstream} over `fetch`, so the http client the
 * context builds is the one in use, and record the User-Agent each request
 * carries, as fetch would send it.
 */
function serve(): (string | null)[] {
  const { http } = everySourceUpstream();
  const agents: (string | null)[] = [];
  vi.stubGlobal('fetch', async (input: string | URL, init: RequestInit = {}): Promise<Response> => {
    const url = String(input);
    const headers = new Headers(init.headers);
    agents.push(headers.get('user-agent'));
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
  return agents;
}

describe('USER_AGENT, on the requests the server sends', () => {
  it.each(BLANK)('set to %j, is this package and version, as unset', async (value) => {
    const agents = serve();
    const ctx = withEnv({ CACHE_DIR: tempDir(), USER_AGENT: value }, () => createNodeContext({ logger: createMockLoggerFactory() }));
    const server = createMcpServer(ctx);
    const client = new Client({ name: 'env-vars-blank-is-unset', version: '0.0.1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const result = await client.callTool({ name: 'jamf_docs_get_article', arguments: { mapId: PRO_MAP, contentId: CCP } });
      expect(result.isError).not.toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
    expect(agents).not.toEqual([]);
    expect(new Set(agents)).toEqual(new Set([defaultUserAgent(PKG_VERSION)]));
  });
});

// ── The platform entry ──────────────────────────────────────────────────────

/**
 * tsx, by the file it resolves to. A bare `--import tsx` is resolved from the
 * child's working directory, which here is not always the checkout.
 */
const TSX = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;

const children: ChildProcess[] = [];

/** SIGTERM, which the entry exits on; SIGKILL if it has not gone in 5 s. */
async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) { return; }
  const exited = new Promise<void>((resolve) => { child.once('exit', () => { resolve(); }); });
  child.kill('SIGTERM');
  const timer = setTimeout(() => { child.kill('SIGKILL'); }, 5_000);
  await exited;
  clearTimeout(timer);
}

afterEach(async () => {
  await Promise.all(children.splice(0).map(stop));
});

/**
 * `src/index.ts` with `args` in a child process, run from `cwd`, with every
 * documented variable removed from the environment it inherits and `env`
 * set. CACHE_DIR is a fresh directory unless `env` names one, so nothing is
 * swept or written in the checkout.
 */
function spawnEntry(
  args: readonly string[], env: Record<string, string>, cwd: string,
): { child: ChildProcess; stderr: () => string } {
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([name]) => !DOCUMENTED.includes(name)));
  const child = spawn(
    process.execPath,
    ['--import', TSX, path.join(ROOT, 'src/index.ts'), ...args],
    // stdin is left open, so a server on stdio waits for its client.
    { cwd, env: { ...inherited, CACHE_DIR: tempDir(), ...env }, stdio: ['pipe', 'ignore', 'pipe'] },
  );
  children.push(child);
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
  return { child, stderr: () => stderr };
}

describe('CACHE_DIR, on the platform entry', () => {
  it.each(BLANK)('set to %j, is .cache in the working directory, as unset, which the startup sweep clears', async (value) => {
    const cwd = tempDir();
    const expired = path.join(cwd, '.cache', `${'e'.repeat(64)}.json`);
    fs.mkdirSync(path.dirname(expired));
    fs.writeFileSync(expired, JSON.stringify({ data: 'old', timestamp: 0, ttl: 60_000 }));

    const { child, stderr } = spawnEntry([], { CACHE_DIR: value }, cwd);
    await vi.waitFor(() => {
      if (child.exitCode !== null) { throw new Error(`the entry exited with ${String(child.exitCode)}: ${stderr()}`); }
      expect(stderr()).toContain('running on stdio');
      expect(stderr()).toContain('Cache sweep reclaimed 1 stale entries');
    }, { timeout: 10_000, interval: 50 });
    expect(fs.existsSync(expired)).toBe(false);
    expect(stderr()).not.toContain('[WARNING]');
  });
});

describe('the HTTP transport\'s variables, on the platform entry', () => {
  /** What one GET /health was answered with. */
  interface Answer { status: number; allowOrigin: string | null }

  async function health(base: string, times: number, headers: Record<string, string>): Promise<Answer[]> {
    const answers: Answer[] = [];
    for (let i = 0; i < times; i++) {
      const response = await fetch(`${base}/health`, { headers });
      answers.push({ status: response.status, allowOrigin: response.headers.get('access-control-allow-origin') });
    }
    return answers;
  }

  it.each(BLANK)('each set to %j, does what it does unset', async (value) => {
    const port = await getFreePort();
    const { child, stderr } = spawnEntry(
      ['--transport', 'http', '--port', String(port)],
      Object.fromEntries(READ_BY_ADAPTER.map(name => [name, value])),
      ROOT,
    );
    await waitForServerStart(child, 20_000);
    const base = `http://127.0.0.1:${String(port)}`;

    const answers = await health(base, 61, { Origin: 'https://a.example' });
    // RATE_LIMIT_RPM: 60 a minute from one address, and the 61st refused.
    expect(answers.map(answer => answer.status)).toEqual([...Array<number>(60).fill(200), 429]);
    // CORS_ALLOWED_ORIGINS: no origin is answered.
    expect(answers.filter(answer => answer.allowOrigin !== null)).toEqual([]);
    // TRUST_PROXY: X-Forwarded-For is not read, so an address named there
    // does not get a bucket of its own.
    expect((await health(base, 1, { 'X-Forwarded-For': '203.0.113.7' }))[0].status).toBe(429);

    expect(stderr()).not.toContain('[WARNING]');
  });
});
