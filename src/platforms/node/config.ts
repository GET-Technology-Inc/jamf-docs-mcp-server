/**
 * Node.js platform configuration
 *
 * Reads environment variables and local package.json to build a ServerConfig.
 * All process.env / path / fs access is isolated here.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRequire } from 'module';
import { createDefaultConfig, defaultUserAgent } from '../../core/config.js';
import type { ServerConfig } from '../../core/config.js';

// ============================================================================
// Range constants (pure values, no env dependency)
// ============================================================================

const CACHE_TTL_MIN = 60_000;
const CACHE_TTL_MAX = 30 * 24 * 60 * 60 * 1000;

// System directories a cache must not be written into. Matched by where a
// path really is, not by how it is spelled; see isInSystemDir().
const SENSITIVE_DIR_PREFIXES = ['/etc', '/usr', '/var', '/sys', '/proc', '/dev', '/sbin', '/bin'];
const DEFAULT_CACHE_DIR = '.cache';

// ============================================================================
// Environment variable helpers
// ============================================================================

/**
 * The whole number `key` is set to, or `defaultValue`, with a warning that
 * quotes the value as written, when it is not a whole number or is outside
 * `min`–`max`. An empty or blank value counts as unset.
 *
 * Until 2026-09-28 this used `parseInt`, which reads up to the first
 * character that is not a digit. Measured through `createNodeConfig` that
 * day: REQUEST_TIMEOUT=1e4 warned "REQUEST_TIMEOUT=1 is below minimum 1000"
 * and used 15000, and `2.5e3` and `0x10` did the same, quoting 2 and 0.
 * `1500ms` and `1500.5` were taken as 1500, and MAX_RETRIES=2.5 as 2, with
 * no warning, and `fast` fell back to the default with none either.
 */
export function getEnvNumber(
  key: string,
  defaultValue: number,
  min?: number,
  max?: number
): number {
  const value = process.env[key];
  if (value === undefined || value.trim() === '') {
    return defaultValue;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    console.error(`[WARNING] [config] ${key}=${value} is not a whole number. Using default ${defaultValue}.`);
    return defaultValue;
  }
  if (min !== undefined && parsed < min) {
    console.error(`[WARNING] [config] ${key}=${value} is below minimum ${min}. Using default ${defaultValue}.`);
    return defaultValue;
  }
  if (max !== undefined && parsed > max) {
    console.error(`[WARNING] [config] ${key}=${value} exceeds maximum ${max}. Using default ${defaultValue}.`);
    return defaultValue;
  }
  return parsed;
}

/**
 * The string `key` is set to, or `defaultValue`. An empty or blank value
 * counts as unset, as it does for a number.
 *
 * Until 2026-09-28 only an unset one did. Measured through
 * `createNodeContext` that day: with USER_AGENT= or USER_AGENT='   ' every
 * request went out with an empty `User-Agent:` header, since fetch trims a
 * header value. With CACHE_DIR= the cache wrote its entries into the working
 * directory itself, and the startup sweep could not list `''`, so it
 * reclaimed no expired entry there; with CACHE_DIR='   ' it wrote them into a
 * directory named with three spaces. None of the four printed a warning.
 */
function getEnvString(key: string, defaultValue: string): string {
  const value = process.env[key];
  if (value === undefined || value.trim() === '') {
    return defaultValue;
  }
  // Strip CRLF characters to prevent HTTP header injection
  return value.replace(/[\r\n]/g, '');
}

/**
 * A character an HTTP header value cannot carry: anything but a tab, visible
 * ASCII and the rest of Latin-1 (RFC 9110's field-vchar, obs-text and SP).
 * CR and LF never get here; getEnvString strips them.
 */
const NOT_IN_A_HEADER = /[^\t\x20-\x7E\x80-\xFF]/u;

/**
 * USER_AGENT, or `defaultValue`, with a warning, when fetch could not send it.
 *
 * Until 2026-09-28 any value was taken. Measured that day on
 * `createNodeContext`, jamf_docs_search called over MCP: with
 * USER_AGENT='ops-bot (客戶)' each of its 5 requests failed before it was
 * sent, fetch throwing "Cannot convert argument to a ByteString because the
 * character at index 9 has a value of 23458", and the tool answered that the
 * results could not be fetched from learn.jamf.com (a network error) and
 * that this may be temporary. With an ESC in it, fetch threw "fetch failed"
 * instead, and with MAX_RETRIES=2 the HTTP client, which takes a TypeError
 * for a network error, made 17 attempts. Nothing was printed at startup. An
 * emoji or DEL fails in fetch too; `ops-bot (Müller)`, Latin-1, is sent.
 */
function getUserAgent(defaultValue: string): string {
  const value = getEnvString('USER_AGENT', defaultValue);
  const bad = NOT_IN_A_HEADER.exec(value)?.[0].codePointAt(0);
  if (bad === undefined) { return value; }
  const codePoint = `U+${bad.toString(16).toUpperCase().padStart(4, '0')}`;
  // Quoted by JSON.stringify, which writes a C0 control character, such as
  // ESC, as an escape rather than sending it to the terminal.
  console.error(
    `[WARNING] [config] USER_AGENT ${JSON.stringify(value)} contains ${codePoint}, which an HTTP header `
    + `cannot carry, so no request could be sent. Using default "${defaultValue}".`,
  );
  return defaultValue;
}

/**
 * Whether `target` is `dir` itself or somewhere beneath it.
 *
 * Compared by path segment, not by string prefix. Until 2026-09-24 the check
 * was `resolved.startsWith(cwd)`, which a sibling passes whenever its name
 * begins with the project's: with cwd `/x/proj`, `../proj-evil/cache` resolves
 * to `/x/proj-evil/cache`, starts with `/x/proj`, and was accepted, while
 * `../other/cache` was rejected.
 */
function isWithin(dir: string, target: string): boolean {
  const rel = path.relative(dir, target);
  // '' is `dir` itself. Escaping shows as a leading '..' segment; a child
  // whose name merely starts with two dots (`..cache`) is still inside. On
  // Windows a target on another drive comes back as an absolute path.
  return !path.isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`);
}

/**
 * Where `p` really is, symlinks resolved, even if it does not exist yet.
 *
 * The cache creates its directory on first write, so `realpathSync(p)` alone
 * would usually throw ENOENT. This resolves the nearest ancestor that does
 * resolve and puts the rest back on. Any error moves one level up: ENOENT,
 * ENOTDIR, and also EACCES from a directory this user cannot search, such as
 * `/private/var/root` on macOS. Its parent still resolves, and that is enough
 * to say where the path is. If not even `/` resolves, the spelling is all
 * there is.
 */
function realLocation(p: string): string {
  const resolved = path.resolve(p);
  const rest: string[] = [];
  let existing = resolved;
  for (;;) {
    try {
      return path.join(fs.realpathSync(existing), ...rest);
    } catch {
      const parent = path.dirname(existing);
      if (parent === existing) { return resolved; }
      rest.unshift(path.basename(existing));
      existing = parent;
    }
  }
}

/**
 * macOS's per-user temp directory, `/var/folders/<..>/T/`, as the system
 * gives it (`confstr(_CS_DARWIN_USER_TEMP_DIR)`, through getconf), or
 * nothing on another system or if getconf fails.
 *
 * `os.tmpdir()` is that directory only when TMPDIR says so, and a host need
 * not pass TMPDIR: an MCP SDK stdio transport passes the server only HOME,
 * LOGNAME, PATH, SHELL, TERM and USER, and `os.tmpdir()` is then `/tmp`.
 * Until 2026-09-28 that was the only temp directory exempt. Measured that
 * day, `env -i HOME=… PATH=… USER=… CACHE_DIR=$TMPDIR/x node dist/index.js`
 * warned that `/private/var/folders/…` was a sensitive system directory and
 * fell back to `.cache`; with TMPDIR it printed nothing.
 */
function darwinUserTempDir(): string[] {
  if (process.platform !== 'darwin') { return []; }
  try {
    return [execFileSync('/usr/bin/getconf', ['DARWIN_USER_TEMP_DIR'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2_000,
    }).trim()];
  } catch {
    return [];
  }
}

/**
 * The OS temp directory and the user's home directory, where they really are.
 * A cache under either one is allowed even when it lies in a system directory.
 *
 * Both are per-user directories that some systems keep under `/var`, so
 * judging paths by location would reject them:
 * - macOS: `os.tmpdir()` is `/var/folders/<..>/T`, really `/private/var/…`.
 *   Root's home is `/var/root`.
 * - ostree systems (Fedora Silverblue, Kinoite and CoreOS, bootc images):
 *   `/home` links to `/var/home`, and `$HOME` is `/var/home/<user>`
 *   (https://ostreedev.github.io/ostree/adapting-existing/). Without the
 *   home exemption every `CACHE_DIR` in the user's home is rejected, a
 *   relative one from a project there too, since `process.cwd()` reports
 *   `/var/home/…`. v6.0.4 compared spellings and accepted `/home/<user>/…`.
 *
 * On macOS the per-user temp directory is exempt too, whatever TMPDIR says;
 * see darwinUserTempDir().
 *
 * A directory is dropped if it contains one of the system directories
 * (`TMPDIR=/` or `HOME=/`, say), since it would otherwise cancel the whole
 * list. So is one that is not absolute: `HOME=""` makes `os.homedir()`
 * return `""`, which would resolve to the working directory and exempt it.
 */
function ownDirs(roots: readonly string[]): string[] {
  const dirs = [os.tmpdir(), ...darwinUserTempDir()];
  try {
    dirs.push(os.homedir());
  } catch {
    // No $HOME and no passwd entry for this uid. Nothing to exempt.
  }
  return dirs
    .filter(dir => path.isAbsolute(dir))
    .map(realLocation)
    .filter(dir => !roots.some(root => isWithin(dir, root)));
}

/**
 * Whether `location` lies in one of the system directories.
 *
 * Until 2026-09-24 this compared spellings, and on macOS, where `/etc`, `/var`
 * and `/tmp` are symlinks into `/private`, that failed both ways. Measured
 * against v6.0.4 on macOS 27.0: `/etc/jamf` was rejected but
 * `/private/etc/jamf`, the same directory, was accepted. `$TMPDIR/jamf-docs`
 * was rejected, because `os.tmpdir()` is `/var/folders/<..>/T`, and the
 * server fell back to `.cache`; from cwd `/` that is `/.cache`, which
 * cannot be created, so the disk cache was off for the session. Now both
 * sides are compared by location: `location` has been through
 * realLocation(), and so has each prefix. On macOS that adds `/private/etc`
 * and `/private/var`; `/tmp`, like `/private/tmp`, stays allowed.
 *
 * The process's own directories are exempt; see ownDirs().
 *
 * POSIX only, as the list always was. On Windows no path ever matched it, and
 * resolving `/etc` there would turn it into `C:\etc` and start rejecting
 * paths that were accepted before.
 */
function isInSystemDir(location: string): boolean {
  if (process.platform === 'win32') { return false; }
  const roots = [...new Set(SENSITIVE_DIR_PREFIXES.flatMap(p => [p, realLocation(p)]))];
  // Case-insensitive, as before: macOS volumes are by default, and
  // `fs.realpathSync('/USR/Local')` there returns the spelling it was given.
  const lower = location.toLowerCase();
  if (!roots.some(root => isWithin(root.toLowerCase(), lower))) {
    return false;
  }
  // Case-sensitive, so on a case-sensitive filesystem the exemption cannot
  // reach a sibling that differs only in case. Asked only here, so getconf
  // runs only for a path that would otherwise be rejected.
  return !ownDirs(roots).some(dir => isWithin(dir, location));
}

function getValidatedCacheDir(): string {
  // The default is not checked. It is relative to the working directory, so a
  // server started from a system directory puts it there, but it is also
  // what a rejected value falls back to, so there is nothing better to offer.
  // An empty or blank CACHE_DIR is unset (getEnvString).
  const raw = getEnvString('CACHE_DIR', '');
  if (raw === '') { return DEFAULT_CACHE_DIR; }
  const resolved = path.resolve(raw);

  // Relative paths must resolve within cwd, by path segment (#313). This is
  // about spelling on purpose: it keeps `../` out, and a symlink inside the
  // working directory is something the operator made.
  if (!path.isAbsolute(raw) && !isWithin(process.cwd(), resolved)) {
    console.error(`[WARNING] [config] CACHE_DIR "${raw}" resolves outside project directory. Using default "${DEFAULT_CACHE_DIR}".`);
    return DEFAULT_CACHE_DIR;
  }

  // Both branches. A relative path used to skip this entirely, and with cwd
  // `/` (a container with no WORKDIR, say) `etc/jamf` is `/etc/jamf`.
  const location = realLocation(resolved);
  if (isInSystemDir(location)) {
    console.error(`[WARNING] [config] CACHE_DIR "${raw}" points to a sensitive system directory (${location}). Using default "${DEFAULT_CACHE_DIR}".`);
    return DEFAULT_CACHE_DIR;
  }

  return raw;
}

// ============================================================================
// Config factory
// ============================================================================

/** This package's version, read from its package.json. */
export function packageVersion(): string {
  const require = createRequire(import.meta.url);
  return (require('../../../package.json') as { version: string }).version;
}

/**
 * Create a ServerConfig by reading Node.js environment variables
 * and package.json version.
 */
export function createNodeConfig(): ServerConfig {
  const version = packageVersion();

  return createDefaultConfig({
    version,
    cacheTtl: {
      search: getEnvNumber('CACHE_TTL_SEARCH', 30 * 60 * 1000, CACHE_TTL_MIN, CACHE_TTL_MAX),
      article: getEnvNumber('CACHE_TTL_ARTICLE', 24 * 60 * 60 * 1000, CACHE_TTL_MIN, CACHE_TTL_MAX),
      products: getEnvNumber('CACHE_TTL_PRODUCTS', 7 * 24 * 60 * 60 * 1000, CACHE_TTL_MIN, CACHE_TTL_MAX),
      toc: getEnvNumber('CACHE_TTL_TOC', 24 * 60 * 60 * 1000, CACHE_TTL_MIN, CACHE_TTL_MAX),
    },
    request: {
      timeout: getEnvNumber('REQUEST_TIMEOUT', 15000, 1000, 60000),
      // 0, not 3. The README claimed 3 for years while the client shipped 0;
      // making the knob real is not a reason to also change what it defaults to.
      maxRetries: getEnvNumber('MAX_RETRIES', 0, 0, 10),
      retryDelay: getEnvNumber('RETRY_DELAY', 1000, 100, 30000),
      // 0 keeps parallel fetches parallel. batch_get_articles fans out, and a
      // non-zero default would stagger every one of those requests.
      rateLimitDelay: getEnvNumber('RATE_LIMIT_DELAY', 0, 0, 10000),
      userAgent: getUserAgent(defaultUserAgent(version)),
    },
    cache: {
      maxEntries: getEnvNumber('CACHE_MAX_ENTRIES', 500, 10, 10000),
      dir: getValidatedCacheDir(),
    },
  });
}
