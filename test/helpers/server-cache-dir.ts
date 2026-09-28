/**
 * A cache directory of its own for each server a test starts from the built
 * entry, so a test run writes nothing into the directory it was started from.
 *
 * Until 2026-09-28 the integration and e2e tests started `dist/index.js`
 * without a CACHE_DIR, so each server kept its cache in the default `.cache`
 * under the working directory: the checkout. Measured that day, one run of
 * the three files that start one (mcp-server.test.ts,
 * toc-resource-addressing.test.ts and e2e/http-transport.test.ts) left 48
 * entries, 2.4 MB, there. Run again 30 s later, the same files took 1.1 s
 * instead of 16.4 s and rewrote none of the 48: suites meant to reach Jamf
 * were answered from the first run's cache, as they would have been until
 * each entry's TTL ran out, 7 days for the maps list.
 *
 * The directory starts with one expired entry in it, which the server's
 * startup sweep deletes. {@link ServerCacheDir.swept} says whether it has,
 * which is how a suite knows its server keeps its cache here and nowhere else.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface ServerCacheDir {
  /**
   * To add to the server's environment: CACHE_DIR, and TMPDIR if it is set.
   *
   * TMPDIR because the directory is under the OS temp directory, which the
   * server accepts as CACHE_DIR by where the server's `os.tmpdir()` is. An
   * MCP SDK stdio transport passes the server only HOME, LOGNAME, PATH,
   * SHELL, TERM and USER, and the server then takes `/tmp` for the temp
   * directory. Until 2026-09-28 that made it reject this one on macOS, under
   * `/var/folders`, as a system directory, and fall back to `.cache` in the
   * working directory. It now finds macOS's per-user temp directory without
   * TMPDIR, but a TMPDIR elsewhere in a system directory, such as `/var/tmp`,
   * still needs passing.
   */
  env: Record<string, string>;
  /** Whether the server has swept the expired entry the directory started with. */
  swept: () => boolean;
  /** Delete the directory, once the server has been closed or sent SIGTERM. */
  remove: () => void;
}

export function serverCacheDir(): ServerCacheDir {
  // Under the OS temp directory, which CACHE_DIR accepts wherever it is.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jamf-docs-server-cache-'));
  // Named as the cache names an entry, so the sweep reads it.
  const expired = path.join(dir, `${'e'.repeat(64)}.json`);
  fs.writeFileSync(expired, JSON.stringify({ data: null, timestamp: 0, ttl: 60_000 }));
  const { TMPDIR } = process.env;
  return {
    env: { CACHE_DIR: dir, ...(TMPDIR !== undefined ? { TMPDIR } : {}) },
    swept: () => !fs.existsSync(expired),
    remove: () => { fs.rmSync(dir, { recursive: true, force: true }); },
  };
}
