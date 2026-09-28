/**
 * `--port` is a whole number from 1 to 65535, or the server does not start.
 *
 * Until 2026-09-28 it was read with `parseInt`, which stops at the first
 * character that is not a digit. Measured that day on the built entry,
 * `node dist/index.js --transport http --port <value>`: `60737x` listened on
 * 60737 and `60738.9` on 60738, without a word, and `1e3` tried port 1 and
 * stopped on `listen EACCES: permission denied 127.0.0.1:1`, a port nobody
 * asked for. It is now read as #375 reads the numeric environment settings:
 * with `Number`, taken only if it is a whole number, so `1e3` is 1000.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseCliArgs } from '../../../src/transport/index.js';
import { getFreePort, waitForServerStart } from '../../helpers/server-process.js';

const ROOT = path.resolve(__dirname, '../../..');

afterEach(() => {
  vi.restoreAllMocks();
});

/** `parseCliArgs(['--port', value])`, with what it printed and the code it exited with, if it did. */
function parsePort(value: string): { port?: number; exitCode?: number; printed: string[] } {
  const printed: string[] = [];
  vi.spyOn(console, 'error').mockImplementation((line: unknown) => { printed.push(String(line)); });
  let exitCode: number | undefined;
  vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
    exitCode = Number(code);
    throw new Error(`process.exit(${String(code)})`);
  });
  try {
    return { port: parseCliArgs(['--port', value]).port, printed };
  } catch (error) {
    if (exitCode === undefined) { throw error; }
    return { exitCode, printed };
  }
}

describe('--port', () => {
  it.each(['8080x', '3000.9', '8080.5', '1e3x', '80 80', '1_000', '0x', 'Infinity', '', ' '])(
    'refuses %j, which is not a whole number, and says so',
    (value) => {
      const { port, exitCode, printed } = parsePort(value);
      expect(port).toBeUndefined();
      expect(exitCode).toBe(1);
      expect(printed.join('\n')).toContain(`Invalid port: "${value}". Must be a whole number from 1 to 65535.`);
    },
  );

  it.each(['0', '65536', '-1', '1e6'])('refuses %j, which is out of range', (value) => {
    const { exitCode, printed } = parsePort(value);
    expect(exitCode).toBe(1);
    expect(printed.join('\n')).toContain(`Invalid port: "${value}".`);
  });

  it.each([
    ['8080', 8080], ['1e3', 1_000], ['2.5e3', 2_500], ['1', 1], ['65535', 65_535],
    // Refused until 2026-09-28, since `parseInt(value, 10)` read each as 0.
    ['0x1F90', 8080], ['0o17', 15], ['0b11', 3],
  ])(
    'reads %j as %d',
    (value, expected) => {
      const { port, exitCode, printed } = parsePort(value);
      expect(exitCode).toBeUndefined();
      expect(port).toBe(expected);
      expect(printed).toEqual([]);
    },
  );
});

describe('the platform entry, given a --port that is not a whole number', () => {
  it('exits with the error, and listens on nothing', async () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jamf-docs-port-'));
    const value = `${String(await getFreePort())}x`;
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', path.join(ROOT, 'src/index.ts'), '--transport', 'http', '--port', value],
      { cwd: ROOT, env: { ...process.env, CACHE_DIR: cacheDir }, stdio: ['ignore', 'ignore', 'pipe'] },
    );
    try {
      // Until 2026-09-28 it was listening on the port before the `x`.
      await expect(waitForServerStart(child, 20_000))
        .rejects.toThrow(new RegExp(`exited with code 1[\\s\\S]*Invalid port: "${value}"`));
    } finally {
      child.kill('SIGKILL');
      fs.rmSync(cacheDir, { recursive: true, force: true });
    }
  }, 30_000);
});
