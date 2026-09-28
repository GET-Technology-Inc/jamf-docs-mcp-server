/**
 * Tests for createNodeConfig: the one place process.env and process.cwd()
 * become a ServerConfig.
 *
 * Until 2026-09-24 this module had no unit test at all (0% coverage), although
 * what it parses is live: since ee39762 (#296, released as 34b16f6) the five
 * request settings reach the HTTP client, and USER_AGENT is sent as a header on
 * every outbound request. CACHE_DIR decides where the server writes files.
 * input-sanitization.test.ts looked like coverage of the CRLF strip and the
 * sensitive-directory list, but it tested inline copies of both and imported
 * nothing from src/, so it would have stayed green through any regression here.
 * Everything below goes through the real module.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MockInstance } from 'vitest';
import type * as ChildProcessModule from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import type { AddressInfo } from 'net';
import type * as OsModule from 'os';
import * as path from 'path';

/**
 * The disk, as far as config.ts looks at it.
 *
 * Since 2026-09-24 the CACHE_DIR guard asks where a path really is
 * (`fs.realpathSync`), and where the temp and home directories are
 * (`os.tmpdir()`, `os.homedir()`). Asking the machine running the suite would
 * make the answers depend on it: on macOS `/etc` is `/private/etc` and
 * `os.tmpdir()` is under `/var/folders`, on the Linux CI runners neither is
 * true. So each case describes the layout it needs. By default every path
 * exists, none is a symlink, the temp directory is `/tmp` and the home
 * directory `/home/me`, none of which config.ts rejected before it resolved
 * anything. Since 2026-09-28 it also asks getconf for macOS's per-user temp
 * directory; by default that fails, as on any other system.
 *
 * POSIX paths only, like the rest of this file (CI runs on Linux).
 */
interface Disk {
  /** Symlink -> target, both absolute. One hop: targets are real paths. */
  links: Map<string, string>;
  /** Real paths that exist. `undefined` means every path does. */
  existing: Set<string> | undefined;
  tmpdir: string;
  /** `undefined` makes `os.homedir()` throw, as Node's does with no $HOME and no passwd entry. */
  homedir: string | undefined;
  /**
   * What `getconf DARWIN_USER_TEMP_DIR` prints, macOS's per-user temp
   * directory. `undefined` makes it fail, as it does on any other system.
   */
  darwinUserTempDir: string | undefined;
  /** Each command config.ts ran, as `file arg…`. */
  ran: string[];
}

const disk = vi.hoisted((): Disk => ({
  links: new Map<string, string>(),
  existing: undefined,
  tmpdir: '/tmp',
  homedir: '/home/me',
  darwinUserTempDir: undefined,
  ran: [],
}));

vi.mock('fs', async importOriginal => {
  const real = await importOriginal<typeof fs>();
  const { posix } = await import('path');
  return {
    ...real,
    realpathSync: (p: string): string => {
      let resolved = posix.resolve(p);
      for (const [link, target] of disk.links) {
        if (resolved === link || resolved.startsWith(`${link}/`)) {
          resolved = target + resolved.slice(link.length);
        }
      }
      if (disk.existing !== undefined && !disk.existing.has(resolved)) {
        throw Object.assign(new Error(`ENOENT: no such file or directory, realpath '${p}'`), { code: 'ENOENT' });
      }
      return resolved;
    },
  };
});

vi.mock('os', async importOriginal => ({
  ...await importOriginal<typeof OsModule>(),
  tmpdir: (): string => disk.tmpdir,
  homedir: (): string => {
    if (disk.homedir === undefined) {
      throw Object.assign(new Error('ENOENT: no such file or directory, uv_os_get_passwd'), { code: 'ERR_SYSTEM_ERROR' });
    }
    return disk.homedir;
  },
}));

vi.mock('child_process', async importOriginal => ({
  ...await importOriginal<typeof ChildProcessModule>(),
  execFileSync: (file: string, args: readonly string[]): string => {
    disk.ran.push([file, ...args].join(' '));
    if (disk.darwinUserTempDir === undefined) {
      throw Object.assign(new Error('Command failed: getconf DARWIN_USER_TEMP_DIR'), { status: 1 });
    }
    // getconf ends it with a slash and a newline.
    return `${disk.darwinUserTempDir}/\n`;
  },
}));

import { createNodeConfig, getEnvNumber } from '../../../src/platforms/node/config.js';
import { createDefaultConfig, defaultUserAgent } from '../../../src/core/config.js';
import type { ServerConfig } from '../../../src/core/config.js';

const ROOT = path.resolve(__dirname, '../../..');
const PKG_VERSION = (JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
  version: string;
}).version;

/** Every variable createNodeConfig reads. */
const ENV_KEYS = [
  'CACHE_TTL_SEARCH', 'CACHE_TTL_ARTICLE', 'CACHE_TTL_PRODUCTS', 'CACHE_TTL_TOC',
  'REQUEST_TIMEOUT', 'MAX_RETRIES', 'RETRY_DELAY', 'RATE_LIMIT_DELAY', 'USER_AGENT',
  'CACHE_MAX_ENTRIES', 'CACHE_DIR',
] as const;

/** Stands in for process.cwd(). Never touched on disk: `disk` above answers config.ts's lookups. */
const PROJECT = '/work/proj';

/** The real `process.platform`, put back after each case. */
const PLATFORM = Object.getOwnPropertyDescriptor(process, 'platform');

/** Stands in for `process.platform` until the case ends. */
function onPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

let stderr: MockInstance<typeof console.error>;

beforeEach(() => {
  // Start every case from an empty environment for these keys, so a shell or
  // CI job that happens to export one cannot change what "unset" means.
  for (const key of ENV_KEYS) {
    vi.stubEnv(key, undefined);
  }
  disk.links = new Map();
  disk.existing = undefined;
  disk.tmpdir = '/tmp';
  disk.homedir = '/home/me';
  disk.darwinUserTempDir = undefined;
  disk.ran = [];
  stderr = vi.spyOn(console, 'error').mockImplementation(() => {
    // Swallow the [WARNING] lines; the spy records them.
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  if (PLATFORM !== undefined) { Object.defineProperty(process, 'platform', PLATFORM); }
});

/** Warnings config.ts wrote to stderr during the case. */
function warnings(): string[] {
  return stderr.mock.calls.map(args => String(args[0]));
}

// ============================================================================
// getEnvNumber
// ============================================================================

describe('getEnvNumber', () => {
  const KEY = 'JAMF_DOCS_TEST_NUMBER';

  it('returns the default when the variable is unset', () => {
    vi.stubEnv(KEY, undefined);
    expect(getEnvNumber(KEY, 42, 0, 100)).toBe(42);
    expect(warnings()).toEqual([]);
  });

  it('returns the parsed value when it is in range', () => {
    vi.stubEnv(KEY, '7');
    expect(getEnvNumber(KEY, 42, 0, 100)).toBe(7);
  });

  it('treats both bounds as inclusive', () => {
    vi.stubEnv(KEY, '0');
    expect(getEnvNumber(KEY, 42, 0, 100)).toBe(0);
    vi.stubEnv(KEY, '100');
    expect(getEnvNumber(KEY, 42, 0, 100)).toBe(100);
    expect(warnings()).toEqual([]);
  });

  it('falls back to the default below the minimum, and says so', () => {
    // Out of range means "use the default", not "clamp to the bound".
    vi.stubEnv(KEY, '-1');
    expect(getEnvNumber(KEY, 42, 0, 100)).toBe(42);
    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]).toContain(`${KEY}=-1 is below minimum 0`);
  });

  it('falls back to the default above the maximum, and says so', () => {
    vi.stubEnv(KEY, '101');
    expect(getEnvNumber(KEY, 42, 0, 100)).toBe(42);
    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]).toContain(`${KEY}=101 exceeds maximum 100`);
  });

  it.each(['', ' '])('treats %j as unset, without a warning', value => {
    vi.stubEnv(KEY, value);
    expect(getEnvNumber(KEY, 42, 0, 100)).toBe(42);
    expect(warnings()).toEqual([]);
  });

  // Until 2026-09-28 parseInt read a value up to its first character that is
  // not a digit: 1500ms and 1500.5 as 1500 and 12abc as 12, without a
  // warning. abc, NaN and Infinity fell back to the default without one.
  it.each(['1500ms', '1500.5', '12abc', 'abc', 'NaN', 'Infinity'])(
    'falls back to the default for %j, which is not a whole number, and says so',
    value => {
      vi.stubEnv(KEY, value);
      expect(getEnvNumber(KEY, 42, 0, 20_000)).toBe(42);
      expect(warnings()).toEqual([`[WARNING] [config] ${KEY}=${value} is not a whole number. Using default 42.`]);
    },
  );

  it.each([['1e4', 10_000], ['2.5e3', 2_500], [' 2000 ', 2_000]])('reads %j as %d', (value, expected) => {
    vi.stubEnv(KEY, value);
    expect(getEnvNumber(KEY, 42, 0, 20_000)).toBe(expected);
    expect(warnings()).toEqual([]);
  });

  it('quotes a value out of range as it was written', () => {
    // parseInt read 0x10 as 0, and the warning quoted that.
    vi.stubEnv(KEY, '0x10');
    expect(getEnvNumber(KEY, 42, 1000, 20_000)).toBe(42);
    expect(warnings()).toEqual([`[WARNING] [config] ${KEY}=0x10 is below minimum 1000. Using default 42.`]);
  });

  it('applies no range when no bounds are given', () => {
    vi.stubEnv(KEY, '-99999');
    expect(getEnvNumber(KEY, 42)).toBe(-99999);
  });
});

// ============================================================================
// Numeric settings
// ============================================================================

const DAY = 24 * 60 * 60 * 1000;

interface NumericSetting {
  key: typeof ENV_KEYS[number];
  read: (c: ServerConfig) => number;
  def: number;
  min: number;
  max: number;
}

const NUMERIC: NumericSetting[] = [
  { key: 'REQUEST_TIMEOUT', read: c => c.request.timeout, def: 15000, min: 1000, max: 60000 },
  { key: 'MAX_RETRIES', read: c => c.request.maxRetries, def: 0, min: 0, max: 10 },
  { key: 'RETRY_DELAY', read: c => c.request.retryDelay, def: 1000, min: 100, max: 30000 },
  { key: 'RATE_LIMIT_DELAY', read: c => c.request.rateLimitDelay, def: 0, min: 0, max: 10000 },
  { key: 'CACHE_MAX_ENTRIES', read: c => c.cache.maxEntries, def: 500, min: 10, max: 10000 },
  { key: 'CACHE_TTL_SEARCH', read: c => c.cacheTtl.search, def: 30 * 60 * 1000, min: 60_000, max: 30 * DAY },
  { key: 'CACHE_TTL_ARTICLE', read: c => c.cacheTtl.article, def: DAY, min: 60_000, max: 30 * DAY },
  { key: 'CACHE_TTL_PRODUCTS', read: c => c.cacheTtl.products, def: 7 * DAY, min: 60_000, max: 30 * DAY },
  { key: 'CACHE_TTL_TOC', read: c => c.cacheTtl.toc, def: DAY, min: 60_000, max: 30 * DAY },
];

describe('numeric settings', () => {
  it('with nothing set, equals the platform-neutral defaults', () => {
    // core/config.ts and this module each spell out the defaults. If they
    // drift, the stdio/HTTP server and anything built on createDefaultConfig
    // silently disagree.
    const node = createNodeConfig();
    const core = createDefaultConfig({ version: PKG_VERSION });
    expect(node.request).toEqual(core.request);
    expect(node.cacheTtl).toEqual(core.cacheTtl);
    expect(node.cache.maxEntries).toBe(core.cache.maxEntries);
  });

  it('reads REQUEST_TIMEOUT=1e4 as 10000', () => {
    // Until 2026-09-28 it warned "REQUEST_TIMEOUT=1 is below minimum 1000"
    // and used 15000.
    vi.stubEnv('REQUEST_TIMEOUT', '1e4');
    expect(createNodeConfig().request.timeout).toBe(10_000);
    expect(warnings()).toEqual([]);
  });

  describe.each(NUMERIC)('$key', ({ key, read, def, min, max }) => {
    it(`defaults to ${def} when unset`, () => {
      expect(read(createNodeConfig())).toBe(def);
    });

    it('takes an in-range value', () => {
      const mid = Math.floor((min + max) / 2);
      vi.stubEnv(key, String(mid));
      expect(read(createNodeConfig())).toBe(mid);
    });

    it(`accepts both bounds, ${min} and ${max}`, () => {
      vi.stubEnv(key, String(min));
      expect(read(createNodeConfig())).toBe(min);
      vi.stubEnv(key, String(max));
      expect(read(createNodeConfig())).toBe(max);
      expect(warnings()).toEqual([]);
    });

    it('falls back to the default just below the minimum, with a warning', () => {
      vi.stubEnv(key, String(min - 1));
      expect(read(createNodeConfig())).toBe(def);
      expect(warnings().some(w => w.includes(`${key}=${min - 1} is below minimum`))).toBe(true);
    });

    it('falls back to the default just above the maximum, with a warning', () => {
      vi.stubEnv(key, String(max + 1));
      expect(read(createNodeConfig())).toBe(def);
      expect(warnings().some(w => w.includes(`${key}=${max + 1} exceeds maximum`))).toBe(true);
    });

    it('falls back to the default for a non-numeric value, with a warning', () => {
      vi.stubEnv(key, 'fast');
      expect(read(createNodeConfig())).toBe(def);
      expect(warnings().some(w => w.includes(`${key}=fast is not a whole number`))).toBe(true);
    });
  });
});

// ============================================================================
// USER_AGENT
// ============================================================================

describe('USER_AGENT', () => {
  const userAgent = (): string => createNodeConfig().request.userAgent;

  it('defaults to one naming this package at its installed version', () => {
    expect(userAgent()).toBe(defaultUserAgent(PKG_VERSION));
  });

  it('passes a clean value through unchanged', () => {
    vi.stubEnv('USER_AGENT', 'JamfDocsMCP/1.0 (ops@example.com)');
    expect(userAgent()).toBe('JamfDocsMCP/1.0 (ops@example.com)');
  });

  // The value is sent verbatim as an HTTP header, so a CR or LF in it is a
  // header-injection vector, not a formatting nit.
  it.each([
    ['CRLF', 'Bot/1.0\r\nX-Injected: true', 'Bot/1.0X-Injected: true'],
    ['a lone LF', 'Bot/1.0\nX-Injected: true', 'Bot/1.0X-Injected: true'],
    ['a lone CR', 'Bot/1.0\rX-Injected: true', 'Bot/1.0X-Injected: true'],
    ['several of each', 'a\nb\rc\r\nd', 'abcd'],
  ])('strips %s', (_label, raw, expected) => {
    vi.stubEnv('USER_AGENT', raw);
    expect(userAgent()).toBe(expected);
  });

  it('keeps spaces and tabs, which a User-Agent may contain', () => {
    vi.stubEnv('USER_AGENT', 'Agent\t1.0 (compatible)');
    expect(userAgent()).toBe('Agent\t1.0 (compatible)');
  });

  // Until 2026-09-28 any of these was taken, and every request then failed
  // before it was sent, reported as a network error that might be temporary.
  const UNSENDABLE: [label: string, raw: string, codePoint: string][] = [
    ['a CJK character', 'ops-bot (客戶)', 'U+5BA2'],
    ['an emoji', 'ops-bot 😀', 'U+1F600'],
    ['the first character past Latin-1', 'ops-bot \u0100', 'U+0100'],
    // Not NUL, which no environment variable can hold: process.env ends the value there.
    ['a bell', 'ops-bot\u0007', 'U+0007'],
    ['ESC', 'ops-bot \u001b[31m', 'U+001B'],
    ['DEL', 'ops-bot\u007f', 'U+007F'],
    ['a vertical tab', 'ops-bot\u000bx', 'U+000B'],
  ];

  /** Latin-1, which a header value can carry. */
  const SENDABLE = ['ops-bot (Müller)', 'ops-bot\u00a0x', 'ops-bot \u00ff', 'Agent\t1.0'];

  it.each(UNSENDABLE)('falls back to the default for one with %s, which a header cannot carry, and says so once', (_label, raw, codePoint) => {
    vi.stubEnv('USER_AGENT', raw);
    expect(userAgent()).toBe(defaultUserAgent(PKG_VERSION));
    expect(warnings()).toEqual([
      `[WARNING] [config] USER_AGENT ${JSON.stringify(raw)} contains ${codePoint}, which an HTTP header `
      + `cannot carry, so no request could be sent. Using default "${defaultUserAgent(PKG_VERSION)}".`,
    ]);
  });

  it.each(SENDABLE)('keeps %j, which is Latin-1, without a warning', raw => {
    vi.stubEnv('USER_AGENT', raw);
    expect(userAgent()).toBe(raw);
    expect(warnings()).toEqual([]);
  });

  it('refuses exactly what fetch cannot send', async () => {
    // A local server, which the no-network guard lets through, to see what
    // fetch really sends.
    const server = http.createServer((request, response) => { response.end(request.headers['user-agent']); });
    await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve); });
    const url = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/`;
    const send = async (agent: string): Promise<string> =>
      await (await fetch(url, { headers: { 'User-Agent': agent } })).text();
    try {
      for (const raw of SENDABLE) {
        expect(await send(raw)).toBe(raw);
      }
      for (const [, raw] of UNSENDABLE) {
        await expect(send(raw), raw).rejects.toThrow(TypeError);
        vi.stubEnv('USER_AGENT', raw);
        expect(await send(userAgent())).toBe(defaultUserAgent(PKG_VERSION));
      }
    } finally {
      server.close();
    }
  });
});

// ============================================================================
// CACHE_DIR
// ============================================================================

describe('CACHE_DIR', () => {
  beforeEach(() => {
    // path.resolve() reads process.cwd() on every call, so this moves both
    // config.ts's own cwd and the base it resolves relative paths against.
    vi.spyOn(process, 'cwd').mockReturnValue(PROJECT);
  });

  const cacheDir = (raw: string | undefined): string | undefined => {
    vi.stubEnv('CACHE_DIR', raw);
    return createNodeConfig().cache.dir;
  };

  /** The warning for a value that lies in a system directory, naming where it really is. */
  const sensitive = (raw: string, location: string): string =>
    `[WARNING] [config] CACHE_DIR "${raw}" points to a sensitive system directory (${location}). Using default ".cache".`;

  it('defaults to .cache', () => {
    expect(cacheDir(undefined)).toBe('.cache');
  });

  describe('relative paths must resolve inside the working directory', () => {
    it.each([
      'cache',
      './cache',
      'nested/deeper/cache',
      '.',
      // A name that merely starts with two dots is a child, not a parent.
      '..cache',
      // Spelled via the parent, but resolves back inside.
      `../${path.basename(PROJECT)}/cache`,
      'a/../b',
      // A sensitive-looking name is fine when it is under the project.
      'etc/cache',
    ])('accepts %j', raw => {
      expect(cacheDir(raw)).toBe(raw);
      expect(warnings()).toEqual([]);
    });

    it.each([
      '..',
      '../other/cache',
      '../../cache',
      'nested/../../outside',
      // Siblings whose names start with the project's own name. They resolve
      // to /work/proj-evil/... and /work/project2, which begin with the string
      // "/work/proj"; a string-prefix check accepted both.
      `../${path.basename(PROJECT)}-evil/cache`,
      `../${path.basename(PROJECT)}ect2`,
    ])('rejects %j', raw => {
      expect(cacheDir(raw)).toBe('.cache');
      expect(warnings()).toEqual([
        `[WARNING] [config] CACHE_DIR "${raw}" resolves outside project directory. Using default ".cache".`,
      ]);
    });
  });

  describe('absolute paths are allowed anywhere except system directories', () => {
    it.each([
      '/etc',
      '/etc/',
      '/etc/jamf-cache',
      '/usr/local/cache',
      '/var/cache',
      '/sys/kernel',
      '/proc/self',
      '/dev/null',
      '/sbin/cache',
      '/bin/local',
      // Matched case-insensitively.
      '/ETC/passwd',
      '/Usr/Local',
      // Matched after normalisation, not on the spelling.
      '/tmp/../etc/cache',
      '//etc//cache',
    ])('rejects %j', raw => {
      expect(cacheDir(raw)).toBe('.cache');
      expect(warnings()).toEqual([sensitive(raw, path.resolve(raw))]);
    });

    it.each([
      '/tmp/jamf-cache',
      '/home/user/.cache/jamf-docs',
      '/opt/cache',
      // Outside the working directory is fine for an absolute path.
      '/work/other/cache',
      // Shares a prefix with a sensitive directory but is not under it.
      '/etc-like/path',
      '/variable/cache',
      '/binaries',
      // Normalises out of a sensitive directory.
      '/etc/../tmp/cache',
    ])('accepts %j', raw => {
      expect(cacheDir(raw)).toBe(raw);
      expect(warnings()).toEqual([]);
    });
  });

  describe('a relative path is checked against the system directories too', () => {
    // Until 2026-09-24 the relative branch checked containment only, and with
    // cwd `/` everything is contained. A container with no WORKDIR runs there.
    it.each([
      ['/', 'etc/jamf', '/etc/jamf'],
      ['/', 'usr/local/jamf', '/usr/local/jamf'],
      ['/', 'var/cache/jamf', '/var/cache/jamf'],
      ['/etc', '.', '/etc'],
      ['/etc', 'jamf', '/etc/jamf'],
    ])('from cwd %j, rejects %j (%s)', (cwd, raw, location) => {
      vi.spyOn(process, 'cwd').mockReturnValue(cwd);
      expect(cacheDir(raw)).toBe('.cache');
      expect(warnings()).toEqual([sensitive(raw, location)]);
    });

    it.each(['home/user/cache', 'tmp/jamf', 'etc-like/cache'])('from cwd "/", accepts %j', raw => {
      vi.spyOn(process, 'cwd').mockReturnValue('/');
      expect(cacheDir(raw)).toBe(raw);
      expect(warnings()).toEqual([]);
    });

    it.each([undefined, '', '   ', '\t\n'])(
      'leaves the default alone for %j even when the working directory is a system directory',
      raw => {
        // `.cache` is also what a rejected value falls back to, so rejecting it
        // could only warn and hand back the same thing. A blank value is unset
        // since 2026-09-28, and checked no more than an unset one.
        vi.spyOn(process, 'cwd').mockReturnValue('/etc');
        expect(cacheDir(raw)).toBe('.cache');
        expect(warnings()).toEqual([]);
      },
    );
  });

  describe('a path is judged by where it is, not how it is spelled', () => {
    it.each([
      // Inside the project by spelling, so the #313 containment check passes it.
      'etc-link/cache',
      `${PROJECT}/etc-link/cache`,
    ])('rejects %j, which reaches /etc through a symlink in the project', raw => {
      disk.links = new Map([[`${PROJECT}/etc-link`, '/etc']]);
      expect(cacheDir(raw)).toBe('.cache');
      expect(warnings()).toEqual([sensitive(raw, '/etc/cache')]);
    });

    it('rejects an innocent-looking absolute path that is a symlink into /var', () => {
      disk.links = new Map([['/opt/cache', '/var/lib/cache']]);
      expect(cacheDir('/opt/cache/jamf')).toBe('.cache');
      expect(warnings()).toEqual([sensitive('/opt/cache/jamf', '/var/lib/cache/jamf')]);
    });

    it('still checks the relative containment by spelling', () => {
      // A link out of the project to somewhere harmless is the operator's
      // own doing; `../` is what #313 keeps out.
      disk.links = new Map([[`${PROJECT}/elsewhere`, '/srv/cache']]);
      expect(cacheDir('elsewhere/jamf')).toBe('elsewhere/jamf');
      expect(cacheDir('../elsewhere/jamf')).toBe('.cache');
    });
  });

  describe('on macOS, where /etc, /var and /tmp are symlinks into /private', () => {
    // As measured on macOS 27.0 (2026-09-24): `ls -l /` shows
    // `etc -> private/etc`, `tmp -> private/tmp`, `var -> private/var`, and
    // os.tmpdir() is a per-user directory under /var/folders.
    const TMPDIR = '/var/folders/b8/gdh0sv_91mqb8xwhy0q3wrw80000gn/T';
    const REAL_TMPDIR = `/private${TMPDIR}`;

    beforeEach(() => {
      disk.links = new Map([['/etc', '/private/etc'], ['/tmp', '/private/tmp'], ['/var', '/private/var']]);
      disk.existing = new Set([
        '/', '/private', '/private/etc', '/private/tmp', '/private/var', '/private/var/root',
        '/private/var/folders', REAL_TMPDIR, '/usr', '/Users', '/Users/me', '/Users/me/Library/Caches',
      ]);
      disk.tmpdir = TMPDIR;
      disk.homedir = '/Users/me';
    });

    it.each([
      ['/etc/jamf', '/private/etc/jamf'],
      // The same directory. v6.0.4 rejected the line above and accepted this one.
      ['/private/etc/jamf', '/private/etc/jamf'],
      ['/PRIVATE/ETC/jamf', '/PRIVATE/ETC/jamf'],
      // root's home, which v6.0.4 accepted. The user here is not root; for
      // root it is its own home, see below.
      ['/private/var/root/jamf', '/private/var/root/jamf'],
      ['/var/db/jamf', '/private/var/db/jamf'],
      // The temp directory's parent is not exempt, only the directory itself.
      [path.dirname(TMPDIR), path.dirname(REAL_TMPDIR)],
    ])('rejects %j (really %s)', (raw, location) => {
      expect(cacheDir(raw)).toBe('.cache');
      expect(warnings()).toEqual([sensitive(raw, location)]);
    });

    it.each([
      // $TMPDIR, which v6.0.4 rejected. From cwd `/` its fallback, `/.cache`,
      // cannot be created, so the disk cache was off for the whole session.
      `${TMPDIR}/jamf-docs`,
      `${REAL_TMPDIR}/jamf-docs`,
      TMPDIR,
      // /tmp was allowed before and still is, by either name.
      '/tmp/jamf-docs',
      '/private/tmp/jamf-docs',
      '/Users/me/Library/Caches/jamf-docs',
      '/usrlocal/cache',
    ])('accepts %j', raw => {
      expect(cacheDir(raw)).toBe(raw);
      expect(warnings()).toEqual([]);
    });

    it('accepts a relative path from a working directory inside the temp directory', () => {
      // process.cwd() reports the real path.
      vi.spyOn(process, 'cwd').mockReturnValue(REAL_TMPDIR);
      expect(cacheDir('cache')).toBe('cache');
      expect(warnings()).toEqual([]);
    });

    it('rejects "." from cwd /private/etc, which is where `cd /etc` leaves you', () => {
      vi.spyOn(process, 'cwd').mockReturnValue('/private/etc');
      expect(cacheDir('.')).toBe('.cache');
      expect(warnings()).toEqual([sensitive('.', '/private/etc')]);
    });

    it.each(['/var/root/.cache/jamf-docs', '/private/var/root/.cache/jamf-docs'])(
      'accepts %j when running as root, whose home it is',
      raw => {
        disk.homedir = '/var/root';
        expect(cacheDir(raw)).toBe(raw);
        expect(warnings()).toEqual([]);
      },
    );

    describe('when the host passes no TMPDIR', () => {
      // An MCP SDK stdio transport passes the server only HOME, LOGNAME, PATH,
      // SHELL, TERM and USER, and os.tmpdir() is then /tmp. Until 2026-09-28
      // the per-user temp directory was rejected then, measured that day on
      // the built entry, and the server fell back to `.cache`.
      beforeEach(() => {
        onPlatform('darwin');
        disk.tmpdir = '/tmp';
        disk.darwinUserTempDir = TMPDIR;
      });

      it.each([`${TMPDIR}/jamf-docs`, `${REAL_TMPDIR}/jamf-docs`, TMPDIR])(
        'accepts %j, in the per-user temp directory getconf names',
        raw => {
          expect(cacheDir(raw)).toBe(raw);
          expect(warnings()).toEqual([]);
          expect(disk.ran).toEqual(['/usr/bin/getconf DARWIN_USER_TEMP_DIR']);
        },
      );

      it.each([
        // Its parent, a sibling of it, another user's, and the rest of /var.
        [path.dirname(TMPDIR), path.dirname(REAL_TMPDIR)],
        [`${path.dirname(TMPDIR)}/C/jamf-docs`, `${path.dirname(REAL_TMPDIR)}/C/jamf-docs`],
        ['/var/folders/zz/other/T/jamf-docs', '/private/var/folders/zz/other/T/jamf-docs'],
        ['/var/db/jamf', '/private/var/db/jamf'],
      ])('still rejects %j (really %s)', (raw, location) => {
        expect(cacheDir(raw)).toBe('.cache');
        expect(warnings()).toEqual([sensitive(raw, location)]);
      });

      it('rejects it, as before, when getconf fails', () => {
        disk.darwinUserTempDir = undefined;
        expect(cacheDir(`${TMPDIR}/jamf-docs`)).toBe('.cache');
        expect(warnings()).toEqual([sensitive(`${TMPDIR}/jamf-docs`, `${REAL_TMPDIR}/jamf-docs`)]);
      });

      it('runs getconf only for a path in a system directory', () => {
        expect(cacheDir('/Users/me/Library/Caches/jamf-docs')).toBe('/Users/me/Library/Caches/jamf-docs');
        expect(cacheDir('/tmp/jamf-docs')).toBe('/tmp/jamf-docs');
        expect(disk.ran).toEqual([]);
      });

      it('does not run getconf on another system', () => {
        onPlatform('linux');
        expect(cacheDir(`${TMPDIR}/jamf-docs`)).toBe('.cache');
        expect(disk.ran).toEqual([]);
      });
    });
  });

  describe('on ostree systems, where /home is a symlink to /var/home', () => {
    // Fedora Silverblue, Kinoite and CoreOS, and bootc images. The ostree docs
    // (https://ostreedev.github.io/ostree/adapting-existing/) list /home ->
    // /var/home, /opt -> /var/opt and /root -> /var/roothome, and $HOME is
    // /var/home/<user>. Judged by location with no home exemption, every path
    // in the user's home is in /var.
    beforeEach(() => {
      disk.links = new Map([['/home', '/var/home'], ['/opt', '/var/opt'], ['/root', '/var/roothome']]);
      disk.homedir = '/var/home/me';
    });

    it.each([
      // v6.0.4 accepted this spelling and rejected the next, $HOME's own.
      '/home/me/.cache/jamf-docs',
      '/var/home/me/.cache/jamf-docs',
    ])('accepts %j in the home directory', raw => {
      expect(cacheDir(raw)).toBe(raw);
      expect(warnings()).toEqual([]);
    });

    it('accepts a relative path from a project in the home directory', () => {
      // process.cwd() reports the real path.
      vi.spyOn(process, 'cwd').mockReturnValue('/var/home/me/proj');
      expect(cacheDir('cache')).toBe('cache');
      expect(warnings()).toEqual([]);
    });

    it('accepts root\'s home when running as root', () => {
      disk.homedir = '/var/roothome';
      expect(cacheDir('/root/.cache/jamf-docs')).toBe('/root/.cache/jamf-docs');
      expect(warnings()).toEqual([]);
    });

    it.each([
      ['/var/lib/jamf', '/var/lib/jamf'],
      // Only this user's home is exempt, not /var/home as a whole.
      ['/home/other/jamf', '/var/home/other/jamf'],
      // Stored in /var like /home, but nobody's home. v6.0.4 accepted it.
      ['/opt/cache', '/var/opt/cache'],
    ])('still rejects %j (really %s)', (raw, location) => {
      expect(cacheDir(raw)).toBe('.cache');
      expect(warnings()).toEqual([sensitive(raw, location)]);
    });
  });

  describe('the temp-directory exemption', () => {
    it('lets a TMPDIR inside /var through, and nothing else in /var', () => {
      disk.tmpdir = '/var/tmp';
      expect(cacheDir('/var/tmp/jamf-docs')).toBe('/var/tmp/jamf-docs');
      expect(cacheDir('/var/cache/jamf-docs')).toBe('.cache');
      expect(cacheDir('/var/TMP/jamf-docs')).toBe('.cache');
    });

    it.each(['/', '/var', '/private'])('does not apply when TMPDIR=%j contains a system directory', tmpdir => {
      disk.tmpdir = tmpdir;
      disk.links = new Map([['/etc', '/private/etc'], ['/var', '/private/var']]);
      expect(cacheDir('/etc/jamf')).toBe('.cache');
      expect(cacheDir('/var/cache/jamf')).toBe('.cache');
    });
  });

  describe('the home-directory exemption', () => {
    it('lets a home inside /var through, and nothing else in /var', () => {
      // A service account, say, whose passwd entry puts its home in /var/lib.
      disk.homedir = '/var/lib/jamf-docs';
      expect(cacheDir('/var/lib/jamf-docs/cache')).toBe('/var/lib/jamf-docs/cache');
      expect(cacheDir('/var/lib/other/cache')).toBe('.cache');
      expect(cacheDir('/var/lib/JAMF-docs/cache')).toBe('.cache');
    });

    it.each(['/', '/var', '/private'])('does not apply when HOME=%j contains a system directory', homedir => {
      disk.homedir = homedir;
      disk.links = new Map([['/etc', '/private/etc'], ['/var', '/private/var']]);
      expect(cacheDir('/etc/jamf')).toBe('.cache');
      expect(cacheDir('/var/cache/jamf')).toBe('.cache');
    });

    it('does not apply when HOME is empty, which Node reports as ""', () => {
      // "" would resolve to the working directory and exempt it.
      disk.homedir = '';
      vi.spyOn(process, 'cwd').mockReturnValue('/var/lib/app');
      expect(cacheDir('cache')).toBe('.cache');
      expect(warnings()).toEqual([sensitive('cache', '/var/lib/app/cache')]);
    });

    it('still checks the list when there is no home directory at all', () => {
      disk.homedir = undefined;
      expect(cacheDir('/etc/jamf')).toBe('.cache');
      expect(cacheDir('/tmp/jamf')).toBe('/tmp/jamf');
    });
  });
});
