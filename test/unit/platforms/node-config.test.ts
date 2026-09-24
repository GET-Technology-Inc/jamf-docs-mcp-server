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
import * as fs from 'fs';
import type * as OsModule from 'os';
import * as path from 'path';

/**
 * The disk, as far as config.ts looks at it.
 *
 * Since 2026-09-24 the CACHE_DIR guard asks where a path really is
 * (`fs.realpathSync`) and where the temp directory is (`os.tmpdir()`). Asking
 * the machine running the suite would make the answers depend on it: on macOS
 * `/etc` is `/private/etc` and `os.tmpdir()` is under `/var/folders`, on the
 * Linux CI runners neither is true. So each case describes the layout it needs.
 * By default every path exists, none is a symlink and the temp directory is
 * `/tmp`, which is what config.ts assumed before it resolved anything.
 *
 * POSIX paths only, like the rest of this file (CI runs on Linux).
 */
const disk = vi.hoisted(() => ({
  /** Symlink -> target, both absolute. One hop: targets are real paths. */
  links: new Map<string, string>(),
  /** Real paths that exist. `undefined` means every path does. */
  existing: undefined as Set<string> | undefined,
  tmpdir: '/tmp',
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
  stderr = vi.spyOn(console, 'error').mockImplementation(() => {
    // Swallow the [WARNING] lines; the spy records them.
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
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

  it.each(['abc', '', 'NaN', ' '])('falls back to the default for the non-numeric value %j', value => {
    vi.stubEnv(KEY, value);
    expect(getEnvNumber(KEY, 42, 0, 100)).toBe(42);
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

    it('falls back to the default for a non-numeric value', () => {
      vi.stubEnv(key, 'fast');
      expect(read(createNodeConfig())).toBe(def);
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

    it('leaves the default alone even when the working directory is a system directory', () => {
      // `.cache` is also what a rejected value falls back to, so rejecting it
      // could only warn and hand back the same thing.
      vi.spyOn(process, 'cwd').mockReturnValue('/etc');
      expect(cacheDir(undefined)).toBe('.cache');
      expect(warnings()).toEqual([]);
    });
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
    });

    it.each([
      ['/etc/jamf', '/private/etc/jamf'],
      // The same directory. v6.0.4 rejected the line above and accepted this one.
      ['/private/etc/jamf', '/private/etc/jamf'],
      ['/PRIVATE/ETC/jamf', '/PRIVATE/ETC/jamf'],
      // root's home, which v6.0.4 accepted.
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
});
