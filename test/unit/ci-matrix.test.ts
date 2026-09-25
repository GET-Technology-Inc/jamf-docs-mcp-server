/**
 * Guard: the check names ci.yml reports must be the ones the ruleset requires,
 * every leg must run what it claims to, and the Node versions it tests must
 * agree with the floor package.json promises.
 *
 * The ruleset on main requires exactly two checks, "Test (Node 24.x)" and
 * "Test (Node 26.x)", and the two legs of ci.yml's `test` job are what
 * publish them. Everything that blocks a merge (type checks, lint, the app-ui
 * bundle check, build, the unit tier) runs inside those legs, and every way of
 * getting that wrong fails silently:
 *
 * - The job renamed, a leg dropped, or a job-level `if` or `needs` that can
 *   skip it. A required name then never reports (a skipped matrix job
 *   reports "Test (Node ${{ matrix.node-version }})" unexpanded) and every PR
 *   waits for it forever. Another job publishing one of the names can turn
 *   it green on its own.
 * - A step `if` that tests anything but the leg. The step skips, the leg
 *   stays green, and the required check passes with nothing tested. On a
 *   draft of the 2026-09 consolidation, which filtered changed files per
 *   step, one `if:` on the filter step did that to every step at once.
 * - A leg pin naming a version the matrix does not run. The step never runs
 *   and nothing fails. Moving the matrix from [20.x, 22.x] to [24.x, 26.x]
 *   on 2026-09-24 meant moving five of these by hand.
 * - The unit tier moved between steps. It runs plain on 24.x and with
 *   coverage on 26.x; a leg that runs it twice pays for it twice, and a leg
 *   that runs it zero times is a green check over a runtime nothing tested.
 * - The lowest leg is the only evidence that the oldest Node `engines`
 *   accepts actually works. If `engines` moves and the matrix does not, or
 *   the reverse, the package promises a runtime nothing tests.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

const ROOT = path.resolve(__dirname, '../..');
const WORKFLOW_DIR = path.join(ROOT, '.github/workflows');

/**
 * The status checks ruleset 14398002 requires on main, from GitHub Actions.
 * The ruleset lives in the repository settings, not in a file, so this is
 * where the tests record it. Changing the matrix changes these names, and so
 * needs the ruleset changed in step, which only a repository admin can do.
 */
const REQUIRED_CHECKS = ['Test (Node 24.x)', 'Test (Node 26.x)'];

// The index signatures carry the keys with dashes in them, such as
// `continue-on-error`, which the naming convention keeps out of a type.
interface Step {
  [key: string]: unknown;
  name?: string;
  uses?: string;
  run?: string;
  if?: unknown;
  env?: Record<string, unknown>;
}
interface Job {
  [key: string]: unknown;
  name?: string;
  if?: unknown;
  needs?: string | string[];
  strategy?: { matrix?: Record<string, unknown> };
  steps?: Step[];
}
interface Workflow { jobs?: Record<string, Job | undefined> }

function load(file: string): Workflow {
  return yaml.load(fs.readFileSync(path.join(WORKFLOW_DIR, file), 'utf8')) as Workflow;
}

const ci = load('ci.yml') as { jobs: Record<string, Job | undefined> };
const { test } = ci.jobs;
const testSteps = test?.steps ?? [];

const { engines } = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'),
) as { engines: { node: string } };

function legs(job: string): string[] {
  const values = ci.jobs[job]?.strategy?.matrix?.['node-version'];
  return Array.isArray(values) ? values.map(String) : [];
}

/** `24.x` -> 24. NaN for anything else, which fails the comparisons below. */
function major(leg: string): number {
  const match = /^(\d+)\.x$/.exec(leg);
  return match === null ? Number.NaN : Number(match[1]);
}

const LEG_PIN = /matrix\.node-version\s*==\s*'([^']*)'/g;

/** A condition as written. YAML can make one a boolean (`if: false`). */
function text(condition: unknown): string {
  if (condition === undefined) { return ''; }
  return typeof condition === 'string' ? condition : JSON.stringify(condition);
}

/** The legs a condition names in `matrix.node-version == '<leg>'`. */
function pins(condition: unknown): string[] {
  return [...text(condition).matchAll(LEG_PIN)].map(m => m[1]);
}

/**
 * The `&&` terms of a step condition, `${{ }}` stripped and whitespace
 * normalised. `'a' || 'b'` stays one term, and so fails the grammar below.
 */
function terms(condition: unknown): string[] {
  return text(condition)
    .trim()
    .replace(/^\$\{\{([\s\S]*)\}\}$/, '$1')
    .split('&&')
    .map(term => term.trim().replace(/\s+/g, ' '));
}

/**
 * The legs a step of `test` runs on. Its condition is a conjunction of leg
 * pins and `!cancelled()` (the step-condition case below holds it to that),
 * so it runs on every leg when it pins none, on the one leg it pins, and on
 * no leg when it pins two different ones.
 */
function legsOf(step: Step, matrix: string[]): string[] {
  const pinned = [...new Set(pins(step.if))];
  if (pinned.length === 0) { return matrix; }
  return pinned.length === 1 ? matrix.filter(leg => leg === pinned[0]) : [];
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
      for (const leg of pins(condition)) {
        out.push({ where, leg });
      }
    }
  }
  return out;
}

/** A run script as one command per line, with `\` continuations joined. */
function commands(step: Step): string[] {
  return (step.run ?? '').replace(/\\\n\s*/g, ' ').split('\n').map(line => line.trim()).filter(Boolean);
}

/**
 * How many times a command runs the unit tier: the npm scripts that include
 * it (test:unit, test:coverage, test:all, and `npm test`), or vitest itself.
 * Not test:integration, test:contract or test:e2e, which the lookahead
 * excludes.
 */
function unitRuns(command: string): number {
  return (command.match(/\bnpm (?:run )?test(?::unit|:coverage|:all)?(?![\w:-])|\bvitest\b/g) ?? []).length;
}

describe('ci.yml publishes exactly the required checks', () => {
  const tested = legs('test');

  it('the test job has a matrix of N.x legs, and nothing else in it', () => {
    // An empty or renamed matrix would make every case below vacuous, and an
    // `include` or `exclude` adds or removes legs this file cannot see.
    expect(tested.length).toBeGreaterThan(0);
    expect(tested.map(major).every(Number.isInteger), JSON.stringify(tested)).toBe(true);
    expect(Object.keys(test?.strategy?.matrix ?? {})).toEqual(['node-version']);
  });

  it('its names, expanded over the matrix, are the ruleset\'s required checks', () => {
    const names = tested.map(leg => String(test?.name).replace(/\$\{\{\s*matrix\.node-version\s*\}\}/g, leg));
    expect(
      names,
      'The ruleset requires these names and nothing else can report them. A ' +
      'renamed job or a moved leg leaves a required check unreported, and ' +
      'every PR waits for it forever. If the matrix is meant to move, the ' +
      'ruleset has to move with it, and REQUIRED_CHECKS here with both.',
    ).toEqual(REQUIRED_CHECKS);
  });

  it('the test job always runs: no job-level if, no needs', () => {
    expect(
      { if: test?.if, needs: test?.needs },
      'A skipped matrix job reports "Test (Node ${{ matrix.node-version }})" ' +
      'unexpanded, never the names the ruleset requires.',
    ).toEqual({ if: undefined, needs: undefined });
  });

  it('no other job, in any workflow, publishes a "Test (Node ...)" name', () => {
    // A required check is satisfied by any GitHub Actions job of that name.
    // One elsewhere could report green while the real leg never ran.
    const others: string[] = [];
    for (const file of fs.readdirSync(WORKFLOW_DIR).filter(f => /\.ya?ml$/.test(f))) {
      for (const [id, job] of Object.entries(load(file).jobs ?? {})) {
        if (file === 'ci.yml' && id === 'test') { continue; }
        if ((job?.name ?? id).startsWith('Test (Node')) {
          others.push(`${file} / ${id}`);
        }
      }
    }
    expect(others).toEqual([]);
  });
});

describe('each leg runs what it says', () => {
  const tested = legs('test');
  const floor = tested.slice().sort((a, b) => major(a) - major(b))[0];

  it('a step condition in the test job names only its leg, or !cancelled()', () => {
    // Anything else can skip the step on a run where it should have run, and
    // a skipped step leaves the required check green.
    const strays = testSteps
      .filter(step => step.if !== undefined)
      .filter(step => !terms(step.if).every(term => /^matrix\.node-version == '[^']*'$/.test(term) || term === '!cancelled()'))
      .map(step => `${step.name ?? step.uses ?? '(unnamed step)'}: ${text(step.if)}`);
    expect(
      strays,
      'A step of a required check may decide only which leg it runs on (and ' +
      'whether to run after a failure). A condition on the event, the actor, ' +
      'the changed files or another step\'s output can turn the check green ' +
      'with nothing tested.',
    ).toEqual([]);
  });

  it('only the advisory steps may fail without failing the leg', () => {
    // continue-on-error on a checking step is the same silent pass as a
    // skipped one: the step goes red and the required check stays green.
    const advisory = [
      'Build the app-ui bundle for analysis',
      'Hand the reports to the Codecov Upload job',
      'Security audit (production dependencies)',
      'Dependency licences (production)',
    ];
    expect(test?.['continue-on-error']).toBeUndefined();
    const lenient = testSteps
      .filter(step => step['continue-on-error'] !== undefined && step['continue-on-error'] !== false)
      .map(step => step.name ?? step.uses);
    expect(lenient.filter(name => !advisory.includes(String(name)))).toEqual([]);
  });

  it('every single-leg gate names a leg the matrix runs', () => {
    const gates = singleLegGates();
    expect(gates.length, 'expected the single-leg steps (type check, lint, ...) to exist').toBeGreaterThan(0);

    const strays = gates.filter(({ leg }) => !tested.includes(leg));
    expect(
      strays,
      `${JSON.stringify(strays)} gate on a leg the matrix (${tested.join(', ')}) ` +
      'does not run. That skips the step without failing it, so the check ' +
      'silently stops happening.',
    ).toEqual([]);
  });

  it('type checks, lint, bundle freshness and the plain unit run are on the floor', () => {
    for (const name of ['Type check', 'Type check (app-ui)', 'Type check (test)', 'Lint', 'App UI bundle is up to date', 'Unit Test']) {
      const step = testSteps.find(s => s.name === name);
      expect(step, `ci.yml's test job has no step "${name}"`).toBeDefined();
      expect(step === undefined ? [] : legsOf(step, tested), `"${name}" must run on the floor leg ${floor} alone`).toEqual([floor]);
    }
  });

  it('the coverage run, the bundle build for analysis and the hand-off share one leg', () => {
    // The hand-off uploads what the other two wrote. On different legs it
    // finds nothing to upload, and fails quietly under continue-on-error.
    const coverage = testSteps.filter(s => commands(s).some(c => unitRuns(c) > 0 && c.includes('--coverage')));
    const bundle = testSteps.filter(s => s.env?.APP_UI_BUNDLE_DIR !== undefined);
    const handOff = testSteps.filter(s => (s.uses ?? '').startsWith('actions/upload-artifact@'));
    for (const [what, found] of [['coverage run', coverage], ['bundle build', bundle], ['hand-off', handOff]] as const) {
      expect(found.length, `expected one ${what} step in the test job`).toBe(1);
    }
    const where = [coverage[0], bundle[0], handOff[0]].map(step => legsOf(step, tested));
    expect(where[0]).toHaveLength(1);
    expect(where).toEqual([where[0], where[0], where[0]]);
  });

  it('every leg runs the unit tier exactly once', () => {
    // 24.x runs it plain and 26.x with coverage, in place of the plain run.
    // Moving a pin must not leave a leg with no unit run, or with two.
    for (const leg of tested) {
      const runs = testSteps
        .filter(step => legsOf(step, tested).includes(leg))
        .flatMap(step => commands(step).flatMap(c => Array<string>(unitRuns(c)).fill(step.name ?? '(unnamed step)')));
      expect(runs, `leg ${leg}`).toHaveLength(1);
    }
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
