/**
 * Guard: the Node versions ci.yml tests, the check names it reports, and the
 * floor package.json promises must agree.
 *
 * ci.yml names Node versions in three kinds of place, and a mistake in any of
 * them fails silently:
 *
 * - `test-gate` is a no-op that publishes the same "Test (Node <version>)"
 *   names as `test` on PRs that skip it, because the ruleset requires those
 *   names. If the two matrices drift apart, some PRs wait forever on a check
 *   that never reports.
 * - Type check, lint and the app-ui bundle check run on one leg only, gated by
 *   `if: matrix.node-version == '<leg>'`. A gate naming a leg the matrix does
 *   not run does not fail: the step is skipped and the job stays green. Moving
 *   the matrix from [20.x, 22.x] to [24.x, 26.x] on 2026-09-24 meant moving
 *   five of these by hand, plus the test-gate matrix.
 * - The lowest leg is the only evidence that the oldest Node `engines` accepts
 *   actually works. If `engines` moves and the matrix does not, or the
 *   reverse, the package promises a runtime nothing tests.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

const ROOT = path.resolve(__dirname, '../..');

interface Step { name?: string; if?: string }
interface Job {
  name?: string;
  if?: string;
  strategy?: { matrix?: Record<string, string[] | undefined> };
  steps?: Step[];
}

const ci = yaml.load(
  fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8'),
) as { jobs: Record<string, Job | undefined> };

const { engines } = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'),
) as { engines: { node: string } };

function legs(job: string): string[] {
  return ci.jobs[job]?.strategy?.matrix?.['node-version'] ?? [];
}

/** `24.x` -> 24. NaN for anything else, which fails the comparisons below. */
function major(leg: string): number {
  const match = /^(\d+)\.x$/.exec(leg);
  return match === null ? Number.NaN : Number(match[1]);
}

/** Every `matrix.node-version == '<leg>'` condition in ci.yml, with where it sits. */
function singleLegGates(): { where: string; leg: string }[] {
  const out: { where: string; leg: string }[] = [];
  for (const [id, job] of Object.entries(ci.jobs)) {
    if (job === undefined) { continue; }
    const conditions = [
      { where: id, condition: job.if },
      ...(job.steps ?? []).map(step => ({ where: `${id} / ${step.name ?? '(unnamed step)'}`, condition: step.if })),
    ];
    for (const { where, condition } of conditions) {
      for (const m of (condition ?? '').matchAll(/matrix\.node-version\s*==\s*'([^']*)'/g)) {
        out.push({ where, leg: m[1] });
      }
    }
  }
  return out;
}

describe('ci.yml Node matrix', () => {
  const tested = legs('test');
  const floor = tested.slice().sort((a, b) => major(a) - major(b))[0];

  it('the test job has a matrix of N.x legs', () => {
    // An empty or renamed matrix would make every case below vacuous.
    expect(tested.length).toBeGreaterThan(0);
    expect(tested.map(major).every(Number.isInteger), JSON.stringify(tested)).toBe(true);
  });

  it('test-gate reports exactly the check names test does', () => {
    expect(ci.jobs['test-gate']?.name).toBe(ci.jobs.test?.name);
    expect(
      legs('test-gate'),
      'The ruleset requires one "Test (Node <version>)" check per leg. A leg ' +
      'only one of test / test-gate lists never reports on the PRs that take ' +
      'the other path, and GitHub waits for it forever.',
    ).toEqual(tested);
  });

  it('every single-leg step runs on the matrix floor', () => {
    const gates = singleLegGates();
    expect(gates.length, 'expected the single-leg steps (type check, lint, ...) to exist').toBeGreaterThan(0);

    const strays = gates.filter(({ leg }) => leg !== floor);
    expect(
      strays,
      `${JSON.stringify(strays)} gate on a leg other than ${floor}. A leg the ` +
      'matrix does not run skips the step without failing it, so the check ' +
      'silently stops happening.',
    ).toEqual([]);
  });

  it('the lowest leg is the floor package.json engines publishes', () => {
    const match = /^>=\s*(\d+)(?:\.\d+){0,2}$/.exec(engines.node);
    expect(match, `engines.node is ${JSON.stringify(engines.node)}, not ">=N"`).not.toBeNull();
    expect(
      major(floor),
      `engines.node is ${engines.node} but the lowest Test leg is ${floor}: ` +
      'the package would promise a Node version CI does not run.',
    ).toBe(Number(match?.[1]));
  });
});
