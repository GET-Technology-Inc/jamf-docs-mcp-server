/**
 * Regression test: a failed topic-index fetch must not kill the process.
 *
 * `TopicResolver.getTopicIndex` cleaned up its in-flight entry with
 * `promise.finally(() => …)`. That call returns a *second* promise which
 * rejects whenever the first does, and nothing ever handled it — so one failed
 * fetch of a map's topic index became an unhandled rejection, which Node
 * terminates the process on by default. Every caller catching its own rejection
 * did not help: the derived promise is a separate object with its own
 * unhandled state.
 *
 * The symptom was the whole MCP server exiting on a transient upstream 503,
 * with a stack trace pointing at code that looked correctly guarded.
 *
 * This has to run in a child process. An unhandled rejection terminates the
 * *process*, and a test runner intercepts it — inside vitest the bug is
 * invisible, which is part of why it survived. The exit code is the assertion.
 */

import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const run = promisify(execFile);
const FIXTURE = path.resolve(process.cwd(), 'test/helpers/topic-index-failure.ts');

describe('TopicResolver — failed topic-index fetch', { timeout: 60_000 }, () => {
  it('should reject the caller without terminating the process', async () => {
    // execFile rejects on a non-zero exit, which is exactly the failure mode.
    const { stdout } = await run(process.execPath, ['--import', 'tsx', FIXTURE], {
      cwd: process.cwd(),
    });

    const result = JSON.parse(stdout.trim()) as {
      outcomes: string[];
      upstreamCalls: number;
      survived: boolean;
    };

    // Both concurrent callers see the failure — it is reported, not swallowed.
    expect(result.outcomes).toEqual(['rejected', 'rejected']);
    // Deduplicated while in flight: two concurrent callers, one upstream call.
    // Then cleared, so the third attempt reaches upstream again rather than
    // replaying the failure forever.
    expect(result.upstreamCalls).toBe(2);
    expect(result.survived).toBe(true);
  });
});
