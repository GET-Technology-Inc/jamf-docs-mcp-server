/**
 * FileCache in a real directory that also holds files it did not write.
 *
 * On 2026-09-24, v6.0.4 started with `CACHE_DIR=.` in a project root and, before
 * any tool call, its startup sweep (`prune()`, run by `main()` since #253)
 * deleted package.json, tsconfig.json and every other `*.json` there that was
 * not a live cache entry. It logged them as "Cache sweep reclaimed 5 stale
 * entries". In a directory shared with another tool it deleted that tool's
 * state files. cache.test.ts mocks `fs/promises`; this file runs the same
 * three directory-wide operations against a real temp directory, which is
 * where the damage was done.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileCache } from '../../../src/platforms/node/cache.js';
import { createMockLogger } from '../../helpers/mock-context.js';

const HOUR = 60 * 60 * 1000;

/** What was sitting in the directory before the server started. */
const FOREIGN: Record<string, string> = {
  'package.json': '{"name":"someone-elses-project","version":"1.0.0"}\n',
  'tsconfig.json': '{"compilerOptions":{"strict":true}}\n',
  // The worst case: valid JSON in exactly our entry's shape, long expired.
  'other-tool.json': JSON.stringify({ data: 'their state', timestamp: 0, ttl: 1 }),
  'notes.json': '{ not json',
  'README.md': '# not ours\n',
};

const expired = JSON.stringify({ data: 'old', timestamp: Date.now() - 2 * HOUR, ttl: HOUR });
const fresh = JSON.stringify({ data: 'new', timestamp: Date.now(), ttl: HOUR });

/** Files the cache itself wrote, in every state `prune()` distinguishes. */
const OWN = {
  expiredSha256: `${'1'.repeat(64)}.json`,
  // v1.0.0 and v1.1.0 named entries by md5.
  expiredMd5: `${'2'.repeat(32)}.json`,
  corrupt: `${'3'.repeat(64)}.json`,
  fresh: `${'4'.repeat(64)}.json`,
  abandonedWrite: `${'5'.repeat(64)}.json.tmp.99999`,
};

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jamf-docs-cache-'));
  for (const [name, body] of Object.entries(FOREIGN)) {
    fs.writeFileSync(path.join(dir, name), body);
  }
  fs.writeFileSync(path.join(dir, OWN.expiredSha256), expired);
  fs.writeFileSync(path.join(dir, OWN.expiredMd5), expired);
  fs.writeFileSync(path.join(dir, OWN.corrupt), '{"data":');
  fs.writeFileSync(path.join(dir, OWN.fresh), fresh);
  const tmp = path.join(dir, OWN.abandonedWrite);
  fs.writeFileSync(tmp, fresh);
  const twoHoursAgo = new Date(Date.now() - 2 * HOUR);
  fs.utimesSync(tmp, twoHoursAgo, twoHoursAgo);
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Each foreign file that is gone or no longer byte-identical. */
function damagedForeignFiles(): string[] {
  return Object.entries(FOREIGN)
    .filter(([name, body]) => {
      try {
        return fs.readFileSync(path.join(dir, name), 'utf8') !== body;
      } catch {
        return true;
      }
    })
    .map(([name]) => name);
}

describe('FileCache in a directory it shares with other files', () => {
  it('prune() reclaims its own dead files and leaves every other file untouched', async () => {
    const cache = new FileCache({ cacheDir: dir, log: createMockLogger() });

    expect(await cache.prune()).toBe(4);

    expect(damagedForeignFiles()).toEqual([]);
    expect(fs.readdirSync(dir).sort()).toEqual([...Object.keys(FOREIGN), OWN.fresh].sort());
  });

  it('clear() removes everything it wrote and nothing else', async () => {
    const cache = new FileCache({ cacheDir: dir, log: createMockLogger() });

    await cache.clear();

    expect(damagedForeignFiles()).toEqual([]);
    expect(fs.readdirSync(dir).sort()).toEqual(Object.keys(FOREIGN).sort());
  });

  it('stats() counts only its own entries', async () => {
    const cache = new FileCache({ cacheDir: dir, log: createMockLogger() });

    // Four entries (the .tmp write is not one); the five foreign files are not counted.
    expect((await cache.stats()).totalEntries).toBe(4);
  });
});
