/**
 * Node.js platform configuration
 *
 * Reads environment variables and local package.json to build a ServerConfig.
 * All process.env / path / fs access is isolated here.
 */

import * as path from 'path';
import { createRequire } from 'module';
import { createDefaultConfig, defaultUserAgent } from '../../core/config.js';
import type { ServerConfig } from '../../core/config.js';

// ============================================================================
// Range constants (pure values, no env dependency)
// ============================================================================

const CACHE_TTL_MIN = 60_000;
const CACHE_TTL_MAX = 30 * 24 * 60 * 60 * 1000;

// System-sensitive directory prefixes that should not be used as cache directories
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

function getValidatedCacheDir(): string {
  const raw = getEnvString('CACHE_DIR', DEFAULT_CACHE_DIR);
  const resolved = path.resolve(raw);
  const cwd = process.cwd();

  if (path.isAbsolute(raw)) {
    // Reject absolute paths pointing to system-sensitive directories
    const normalizedResolved = resolved.toLowerCase();
    for (const prefix of SENSITIVE_DIR_PREFIXES) {
      if (normalizedResolved === prefix || normalizedResolved.startsWith(`${prefix}/`)) {
        console.error(`[WARNING] [config] CACHE_DIR "${raw}" points to a sensitive system directory. Using default "${DEFAULT_CACHE_DIR}".`);
        return DEFAULT_CACHE_DIR;
      }
    }
  } else if (!isWithin(cwd, resolved)) {
    // Relative paths must resolve within cwd
    console.error(`[WARNING] [config] CACHE_DIR "${raw}" resolves outside project directory. Using default "${DEFAULT_CACHE_DIR}".`);
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
