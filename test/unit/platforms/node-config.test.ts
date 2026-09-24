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
import * as path from 'path';
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

/** Stands in for process.cwd(); never touched on disk, config.ts only does path arithmetic. */
const PROJECT = '/work/proj';

let stderr: MockInstance<typeof console.error>;

beforeEach(() => {
  // Start every case from an empty environment for these keys, so a shell or
  // CI job that happens to export one cannot change what "unset" means.
  for (const key of ENV_KEYS) {
    vi.stubEnv(key, undefined);
  }
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
      expect(warnings()).toEqual([
        `[WARNING] [config] CACHE_DIR "${raw}" points to a sensitive system directory. Using default ".cache".`,
      ]);
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
});
