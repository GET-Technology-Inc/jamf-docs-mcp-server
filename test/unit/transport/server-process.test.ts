/**
 * The start-up wait shared by the tests that run a real HTTP server
 * (test/helpers/server-process.ts).
 *
 * A server that exits is covered in graceful-shutdown.test.ts, against the
 * real adapter on a taken port. This file covers a server that neither
 * listens nor exits. The integration and e2e launchers used to leave that
 * case to vitest, whose "Hook timed out in 10000ms" quotes nothing the
 * server said.
 */

import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';

import { waitForServerStart } from '../../helpers/server-process.js';

describe('waitForServerStart', () => {
  it('quotes the stderr of a server that never starts listening, and stops it', async () => {
    const child = spawn(
      process.execPath,
      ['-e', "process.stderr.write('still booting\\n'); setInterval(() => {}, 1000);"],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    try {
      // The budget only has to outlast Node's own start-up, so that the line
      // above has arrived by the time it runs out.
      await expect(waitForServerStart(child, 2_000)).rejects.toThrow(
        /did not report it was listening within 2000 ms[\s\S]*still booting/,
      );
      // Killed, not left running after the test that started it.
      expect(child.killed).toBe(true);
    } finally {
      child.kill('SIGKILL');
    }
  });
});
