/**
 * Node.js platform configuration
 *
 * Reads environment variables and local package.json to build a ServerConfig.
 * All process.env / path / fs access is isolated here.
 */

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

export function getEnvNumber(
  key: string,
  defaultValue: number,
  min?: number,
  max?: number
): number {
  const value = process.env[key];
  if (value === undefined) {
    return defaultValue;
  }
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    return defaultValue;
  }
  if (min !== undefined && parsed < min) {
    console.error(`[WARNING] [config] ${key}=${parsed} is below minimum ${min}. Using default ${defaultValue}.`);
    return defaultValue;
  }
  if (max !== undefined && parsed > max) {
    console.error(`[WARNING] [config] ${key}=${parsed} exceeds maximum ${max}. Using default ${defaultValue}.`);
    return defaultValue;
  }
  return parsed;
}

function getEnvString(key: string, defaultValue: string): string {
  const value = process.env[key] ?? defaultValue;
  // Strip CRLF characters to prevent HTTP header injection
  return value.replace(/[\r\n]/g, '');
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
 * A directory is dropped if it contains one of the system directories
 * (`TMPDIR=/` or `HOME=/`, say), since it would otherwise cancel the whole
 * list. So is one that is not absolute: `HOME=""` makes `os.homedir()`
 * return `""`, which would resolve to the working directory and exempt it.
 */
function ownDirs(roots: readonly string[]): string[] {
  const dirs = [os.tmpdir()];
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
  // Case-sensitive, so on a case-sensitive filesystem the exemption cannot
  // reach a sibling that differs only in case.
  if (ownDirs(roots).some(dir => isWithin(dir, location))) {
    return false;
  }
  // Case-insensitive, as before: macOS volumes are by default, and
  // `fs.realpathSync('/USR/Local')` there returns the spelling it was given.
  const lower = location.toLowerCase();
  return roots.some(root => isWithin(root.toLowerCase(), lower));
}

function getValidatedCacheDir(): string {
  // The default is not checked. It is relative to the working directory, so a
  // server started from a system directory puts it there, but it is also
  // what a rejected value falls back to, so there is nothing better to offer.
  if (process.env.CACHE_DIR === undefined) { return DEFAULT_CACHE_DIR; }
  const raw = getEnvString('CACHE_DIR', DEFAULT_CACHE_DIR);
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

/**
 * Create a ServerConfig by reading Node.js environment variables
 * and package.json version.
 */
export function createNodeConfig(): ServerConfig {
  const require = createRequire(import.meta.url);
  const pkg = require('../../../package.json') as { version: string };

  return createDefaultConfig({
    version: pkg.version,
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
      userAgent: getEnvString('USER_AGENT', defaultUserAgent(pkg.version)),
    },
    cache: {
      maxEntries: getEnvNumber('CACHE_MAX_ENTRIES', 500, 10, 10000),
      dir: getValidatedCacheDir(),
    },
  });
}
