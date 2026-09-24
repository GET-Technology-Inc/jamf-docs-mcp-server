/**
 * Ports and startup for the tests that run a real HTTP server.
 *
 * Four of those tests used to bind fixed ports, 13579–13582. Two test runs
 * that overlapped on one machine, from two worktrees for example, then failed
 * each other. Measured 2026-09-24 on 6.0.4: when two runs of
 * graceful-shutdown.test.ts were started together, one of the two failed in
 * every pair tried. Nothing named the cause, either. The losing server printed
 * `Port 13581 is already in use` and exited 1. But the launchers read its
 * stderr only for the `running on` line, so the unit test reported a bare
 * "fixture exited early with code 1". The integration and e2e launchers did
 * not listen for the exit at all, so they waited out vitest's 10 s hook
 * timeout.
 *
 * Port 0 would avoid the problem, but these servers cannot use it. The CLI
 * refuses `--port 0` (cli-args.test.ts pins that), and `startHttpServer` logs
 * the port it was given, not the one the OS bound, so a child asked for port
 * 0 has no way to tell the test where it is listening. So the test asks the OS
 * for a free port itself, releases it, and hands it to the child. Something
 * else could take the port in the gap, but macOS does not hand a port it just
 * released to the next caller: it walks its ephemeral range in order (six
 * successive `listen(0)` calls got 60879 through 60884, measured 2026-09-24).
 * And if the port is taken anyway, the error now says so.
 */

import type { ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';

/** The line the Node adapter logs once it is listening. */
const READY = 'running on http://';

/** How much of the child's stderr an error quotes: the end, where the cause is. */
const STDERR_TAIL = 4_000;

/**
 * A port on 127.0.0.1 that nothing was listening on a moment ago.
 *
 * Every server these tests start binds 127.0.0.1 (the adapter's and the CLI's
 * default), so that is where the port is checked.
 */
export async function getFreePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => { resolve(); });
  });
  const address = probe.address();
  await new Promise<void>((resolve) => { probe.close(() => { resolve(); }); });
  if (address === null || typeof address === 'string') {
    throw new Error(`Expected a TCP address from listen(0), got ${String(address)}`);
  }
  return address.port;
}

function tail(text: string): string {
  const trimmed = text.trim();
  if (trimmed === '') {
    return '(nothing)';
  }
  return trimmed.length > STDERR_TAIL ? `…${trimmed.slice(-STDERR_TAIL)}` : trimmed;
}

/**
 * Resolve once `child` logs that it is listening. Otherwise, reject with the
 * child's stderr.
 *
 * The rejection comes as soon as the child ends, and at the latest after
 * `timeoutMs`. It quotes what the child wrote to stderr, which is where the
 * adapter reports a failed bind (`Port N is already in use`). A child that is
 * still running at the deadline is killed, so it does not outlive the test.
 * A caller in a `beforeAll` hook should give the hook a longer timeout than
 * `timeoutMs`. Otherwise vitest's "Hook timed out" arrives first, and it
 * quotes nothing.
 *
 * The child must be spawned with its stderr piped. Once this settles, the
 * stream keeps flowing and later output is discarded, so a chatty child
 * cannot fill the pipe and block.
 */
export async function waitForServerStart(child: ChildProcess, timeoutMs: number): Promise<void> {
  const { stderr } = child;
  if (stderr === null) {
    throw new Error('waitForServerStart needs the child\'s stderr piped: the ready line and any bind error are both written there');
  }

  let output = '';
  await new Promise<void>((resolve, reject) => {
    const settle = (error?: Error): void => {
      clearTimeout(timer);
      stderr.off('data', onData);
      child.off('close', onClose);
      child.off('error', onError);
      if (error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    };

    const onData = (chunk: Buffer): void => {
      output += chunk.toString();
      if (output.includes(READY)) {
        settle();
      }
    };
    // 'close', not 'exit'. Node's docs warn that the child's stdio may still
    // be open when 'exit' fires, so the line naming the cause could be
    // missing from the error. 'close' fires only after the stream has ended.
    const onClose = (code: number | null, signal: NodeJS.Signals | null): void => {
      const how = code === null ? `signal ${String(signal)}` : `code ${String(code)}`;
      settle(new Error(`server process exited with ${how} before it was listening. Its stderr:\n${tail(output)}`));
    };
    const onError = (error: Error): void => { settle(error); };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      settle(new Error(
        `server process did not report it was listening within ${String(timeoutMs)} ms. `
        + `Its stderr so far:\n${tail(output)}`,
      ));
    }, timeoutMs);

    stderr.on('data', onData);
    child.on('close', onClose);
    child.on('error', onError);
  });
}
