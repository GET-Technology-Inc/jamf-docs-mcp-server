/**
 * Guard: release.yml releases once a day, holds a release only when it has
 * positively established there is nothing to hold it for, and keeps
 * publishing where npm's trusted publisher expects it.
 *
 * Each way of breaking it is quiet. Delete the schedule and releases stop,
 * with every check green. Make the Release step wait for the content gate to
 * succeed, or drop the gate's continue-on-error, and an npm outage or a
 * script bug becomes a release that never happens. Put continue-on-error on
 * the held day's dry run and a broken release toolchain surfaces only when a
 * real fix has to ship, which is what #230's changelog preset did. Stop the
 * CI check leaving out skipped check runs and every release is held, each
 * day with a green job and a notice. Check out a shallow clone and every
 * tag-based step turns itself off, and the no-op releases come back. And
 * npm accepts OIDC publishing only from the workflow file named in the
 * package's trusted-publisher entry, .github/workflows/release.yml, with
 * `id-token: write`.
 *
 * The conditions are checked two ways: as text, for the specific mistakes
 * above, and by walking a run step by step the way the runner would,
 * evaluating every `if` over the outputs the steps before it left, for each
 * state a run can be in. The CI check's jq filters are run through jq over
 * a real commit's check runs.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

const ROOT = path.resolve(__dirname, '../..');

// The index signature carries the keys with dashes in them, such as
// `continue-on-error`, which the naming convention keeps out of a type.
interface Step {
  [key: string]: unknown;
  id?: string;
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  env?: Record<string, unknown>;
  with?: Record<string, unknown>;
}
interface DispatchInput { type?: string; default?: unknown }

const release = yaml.load(
  fs.readFileSync(path.join(ROOT, '.github/workflows/release.yml'), 'utf8'),
) as {
  on: {
    schedule?: { cron?: string }[];
    push?: Record<string, unknown>;
    workflow_dispatch?: { inputs?: Record<string, DispatchInput | undefined> } | null;
  };
  permissions?: Record<string, string>;
  concurrency?: Record<string, unknown>;
  jobs: { release?: { steps?: Step[] } };
};
const steps = release.jobs.release?.steps ?? [];

// By the command line, not by a mention: other steps' messages name
// semantic-release too.
const commands = (s: Step): string[] => (s.run ?? '').split('\n').map(line => line.trim());
const isDryRun = (s: Step): boolean => commands(s).includes('npx semantic-release --dry-run');
const isPublish = (s: Step): boolean => commands(s).includes('npx semantic-release');

const find = (predicate: (s: Step) => boolean): Step => {
  const step = steps.find(predicate);
  if (step === undefined) { throw new Error(`release.yml has no step matching ${predicate.toString()}`); }
  return step;
};
const byId = (id: string): Step => find(s => s.id === id);
const build = (): Step => find(s => s.run === 'npm run build');
const dryRun = (): Step => find(isDryRun);
const publish = (): Step => find(isPublish);

// ─── A small evaluator for GitHub Actions `if` expressions ─────
//
// Enough of the language for this file: property paths, string literals,
// `!`, `==`, `!=`, `&&`, `||` and parentheses, with the documented coercion
// (strings compare case-insensitively; mixed types compare as numbers, where
// null and '' are 0 and a non-numeric string is NaN). Anything else throws,
// so a condition this cannot read fails the test rather than passing it.

type Value = string | boolean | null;

function toNumber(v: Value): number {
  if (v === null) { return 0; }
  if (typeof v === 'boolean') { return v ? 1 : 0; }
  return v.trim() === '' ? 0 : Number(v);
}

function equals(a: Value, b: Value): boolean {
  if (typeof a === 'string' && typeof b === 'string') { return a.toLowerCase() === b.toLowerCase(); }
  if (typeof a === typeof b) { return a === b; }
  return toNumber(a) === toNumber(b);
}

const truthy = (v: Value): boolean => v !== null && v !== false && v !== '';

function evaluate(expression: string, context: Record<string, Value>): boolean {
  const source = expression.trim().replace(/^\$\{\{([\s\S]*)\}\}$/, '$1');
  const tokens = source.match(/'(?:[^']|'')*'|&&|\|\||==|!=|!|\(|\)|[A-Za-z_][\w.-]*|\S/g) ?? [];
  let at = 0;
  const peek = (): string | undefined => tokens[at];
  const take = (): string => {
    const token = peek();
    if (token === undefined) { throw new Error(`unexpected end of: ${expression}`); }
    at++;
    return token;
  };

  const primary = (): Value => {
    const token = take();
    if (token === '!') { return !truthy(primary()); }
    if (token === '(') {
      const value = or();
      if (take() !== ')') { throw new Error(`unbalanced: ${expression}`); }
      return value;
    }
    if (token.startsWith("'")) { return token.slice(1, -1).replace(/''/g, "'"); }
    if (token === 'true' || token === 'false') { return token === 'true'; }
    if (/^[A-Za-z_]/.test(token) && peek() !== '(') { return context[token] ?? null; }
    throw new Error(`cannot evaluate '${token}' in: ${expression}`);
  };
  const comparison = (): Value => {
    const left = primary();
    const op = peek();
    if (op === '==' || op === '!=') {
      take();
      const right = primary();
      return op === '==' ? equals(left, right) : !equals(left, right);
    }
    return left;
  };
  const and = (): Value => {
    let value = comparison();
    while (peek() === '&&') { take(); const right = comparison(); value = truthy(value) ? right : value; }
    return value;
  };
  const or = (): Value => {
    let value = and();
    while (peek() === '||') { take(); const right = and(); value = truthy(value) ? value : right; }
    return value;
  };

  const result = or();
  if (at !== tokens.length) { throw new Error(`trailing tokens in: ${expression}`); }
  return truthy(result);
}

/**
 * A run in which every step before the one asked about produced its usual
 * output. Missing keys are what the runner gives a step that never ran or
 * never wrote the output: nothing.
 */
const SCHEDULED_DAY: Record<string, Value> = {
  'steps.pending.outputs.any': 'true',
  'steps.pending.outputs.last': 'v6.0.11',
  'steps.ci.outputs.ok': 'true',
  'steps.gate.outputs.changed': 'true',
};
const runs = (step: Step, state: Record<string, Value>): boolean =>
  evaluate(step.if ?? 'true', { ...SCHEDULED_DAY, ...state });

// ─── A whole run, step by step ─────────────────────────────────
//
// Walks release.yml's steps in order, as the runner does. A step without an
// `if` runs; one with an `if` runs when it evaluates true over what the
// steps before it left. The runner puts `success() &&` in front of an `if`
// that names no status function, so once a step fails without
// continue-on-error nothing after it runs, and the job fails. A step that
// runs leaves the outputs the scenario gives it and the outcome 'success' or
// 'failure'; one that does not run leaves no outputs and outcome 'skipped'.

/** A short name for each step, from what it does rather than its title. */
const label = (s: Step): string => {
  if (s.id !== undefined) { return s.id; }
  const uses = s.uses ?? '';
  if (uses.startsWith('actions/checkout@')) { return 'checkout'; }
  if (uses.startsWith('actions/setup-node@')) { return 'setup-node'; }
  if (s.run === 'npm ci') { return 'npm-ci'; }
  if (s.run === 'npm run build') { return 'build'; }
  if (isDryRun(s)) { return 'dry-run'; }
  if ((s.run ?? '').includes('git ls-remote origin refs/heads/main')) { return 'main-moved'; }
  return s.name ?? '(unnamed)';
};

/** The steps the scenarios below say something about, in release.yml's order. */
const WATCHED = ['ci', 'setup-node', 'npm-ci', 'build', 'published', 'gate', 'dry-run', 'release', 'main-moved'];

interface Scenario {
  inputs?: Record<string, boolean>;
  /** Outputs by step id; each replaces what that step writes on an ordinary day. */
  outputs?: Record<string, Record<string, string>>;
  /** Labels of the steps that fail when they run. */
  failing?: string[];
}

/** What an ordinary day's steps write: work pending, CI green, the package changed. */
const ORDINARY_OUTPUTS: Record<string, Record<string, string>> = {
  pending: { any: 'true', last: 'v6.0.11' },
  ci: { ok: 'true' },
  gate: { changed: 'true' },
};

function simulate(scenario: Scenario): { ran: string[]; jobFails: boolean } {
  const context: Record<string, Value> = {};
  for (const [name, value] of Object.entries(scenario.inputs ?? {})) { context[`inputs.${name}`] = value; }
  const outputs = { ...ORDINARY_OUTPUTS, ...scenario.outputs };
  const ran: string[] = [];
  let jobFails = false;
  for (const step of steps) {
    const name = label(step);
    const willRun = !jobFails && evaluate(step.if ?? 'true', context);
    const fails = willRun && (scenario.failing ?? []).includes(name);
    if (step.id !== undefined) {
      context[`steps.${step.id}.outcome`] = willRun ? (fails ? 'failure' : 'success') : 'skipped';
      for (const [key, value] of Object.entries(willRun ? outputs[step.id] ?? {} : {})) {
        context[`steps.${step.id}.outputs.${key}`] = value;
      }
    }
    if (willRun) { ran.push(name); }
    if (fails && step['continue-on-error'] !== true) { jobFails = true; }
  }
  return { ran: ran.filter(name => WATCHED.includes(name)), jobFails };
}

// ─── Triggers and permissions ──────────────────────────────────

describe('release.yml triggers', () => {
  it('runs on a schedule', () => {
    // Without it nothing publishes unless someone remembers to dispatch.
    const crons = (release.on.schedule ?? []).map(entry => entry.cron);
    expect(crons.length).toBeGreaterThan(0);
    for (const cron of crons) { expect(cron).toMatch(/^\S+ \S+ \S+ \S+ \S+$/); }
  });

  it('runs on a push to main only when package.json changes', () => {
    expect(release.on.push).toEqual({ branches: ['main'], paths: ['package.json'] });
  });

  it('can be run by hand, with both overrides off by default', () => {
    const inputs = release.on.workflow_dispatch?.inputs ?? {};
    for (const name of ['skip_content_gate', 'skip_ci_check']) {
      expect(inputs[name], `workflow_dispatch input ${name}`).toMatchObject({ type: 'boolean', default: false });
    }
  });

  it('can mint the OIDC token npm trusted publishing needs, and read check runs', () => {
    expect(release.permissions?.['id-token']).toBe('write');
    expect(release.permissions?.checks).toBe('read');
  });

  it('never cancels a release in progress', () => {
    expect(release.concurrency?.['cancel-in-progress']).toBe(false);
  });
});

// ─── Steps ─────────────────────────────────────────────────────

describe('release.yml steps', () => {
  it('run in order: checkout, pending, CI, build, published, gate, then dry run or release', () => {
    const index = (step: Step): number => steps.indexOf(step);
    const order = [
      find(s => (s.uses ?? '').startsWith('actions/checkout@')),
      byId('pending'),
      byId('ci'),
      build(),
      byId('published'),
      byId('gate'),
    ].map(index);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(new Set(order).size).toBe(order.length);
    expect(index(byId('gate'))).toBeLessThan(index(dryRun()));
    expect(index(byId('gate'))).toBeLessThan(index(publish()));
  });

  it('check out the full history and its tags', () => {
    const checkout = find(s => (s.uses ?? '').startsWith('actions/checkout@'));
    expect(
      checkout.with?.['fetch-depth'],
      'In a depth-1 clone `git describe` finds no tag: every run counts as pending, the published '
        + 'check skips and the gate fails open, so the no-op releases come back without a sound.',
    ).toBe(0);
  });

  it('match the Test legs by prefix, not by the names of today\'s matrix', () => {
    const ci = byId('ci').run ?? '';
    expect(ci).toContain('startswith("Test (Node ")');
    expect(ci).not.toMatch(/\d+\.x/);
  });

  it('leave skipped check runs out of the CI check', () => {
    // A skipped matrix job reports one "Test (Node ${{ matrix.node-version }})"
    // check run, skipped. Before #328 ci.yml's test or test-gate job, whichever
    // did not run, left one on every commit, and a HEAD from that time can
    // still be released.
    expect(
      byId('ci').run,
      'Counted, the skipped placeholder makes every HEAD "red", and every release is held.',
    ).toContain('.conclusion != "skipped"');
  });

  it('fail the job, not open, on a tag npm never got', () => {
    expect(byId('published')['continue-on-error']).toBeUndefined();
  });
});

describe('the content gate fails open', () => {
  it('an erroring gate does not fail the job', () => {
    expect(byId('gate')['continue-on-error']).toBe(true);
  });

  it('the Release step waits only for a positive "unchanged"', () => {
    const condition = publish().if ?? '';
    expect(condition).toContain("steps.gate.outputs.changed != 'false'");
    expect(
      condition,
      'An erroring gate has outcome "failure" and sets no output; the release must still run.',
    ).not.toMatch(/steps\.gate\.(outcome|conclusion)/);
    expect(condition, "`== 'true'` would skip the release whenever the gate errored.").not.toMatch(/changed\s*==\s*'true'/);
  });

  it.each([
    ['says the package changed', { 'steps.gate.outputs.changed': 'true' }],
    ['errored and said nothing', { 'steps.gate.outputs.changed': null }],
    ['was told to stand aside', { 'steps.gate.outputs.changed': 'false', 'inputs.skip_content_gate': true }],
  ])('Release runs when the gate %s', (_what, state) => {
    expect(runs(publish(), state)).toBe(true);
  });

  it('Release is held, and rehearsed instead, only when the gate says unchanged', () => {
    const held = { 'steps.gate.outputs.changed': 'false' };
    expect(runs(publish(), held)).toBe(false);
    expect(runs(dryRun(), held)).toBe(true);
    expect(runs(dryRun(), {})).toBe(false);
    expect(runs(dryRun(), { 'steps.gate.outputs.changed': null })).toBe(false);
    expect(runs(dryRun(), { ...held, 'inputs.skip_content_gate': true })).toBe(false);
  });
});

describe('the CI check holds a release, and can be overridden', () => {
  it.each([
    ['not green', { 'steps.ci.outputs.ok': 'false' }],
    ['skipped because nothing merged', { 'steps.pending.outputs.any': 'false', 'steps.ci.outputs.ok': null }],
  ])('nothing is built or released when CI is %s', (_what, state) => {
    expect(runs(build(), state)).toBe(false);
    expect(runs(publish(), state)).toBe(false);
  });

  it('skip_ci_check releases without it', () => {
    const state = { 'steps.ci.outputs.ok': null, 'inputs.skip_ci_check': true };
    expect(runs(byId('ci'), state)).toBe(false);
    expect(runs(build(), state)).toBe(true);
    expect(runs(publish(), state)).toBe(true);
  });

  it('the CI check runs on a scheduled day, when inputs are empty', () => {
    expect(runs(byId('ci'), {})).toBe(true);
  });
});

describe('the held day\'s dry run', () => {
  it('is not continue-on-error, so a broken release toolchain fails the day it merges', () => {
    expect(dryRun()['continue-on-error']).toBeUndefined();
  });

  it('runs with the Release step\'s environment', () => {
    expect(dryRun().env).toMatchObject(publish().env ?? {});
  });
});

describe('a whole run, step by step', () => {
  const upToGate = ['ci', 'setup-node', 'npm-ci', 'build', 'published', 'gate'];

  it.each<[string, Scenario, string[], boolean]>([
    ['nothing merged since the last tag',
      { outputs: { pending: { any: 'false', last: 'v6.0.11' } } },
      [], false],
    ['the package changed, on a green HEAD',
      {},
      [...upToGate, 'release', 'main-moved'], false],
    ['the package is identical to the last release',
      { outputs: { gate: { changed: 'false' } } },
      [...upToGate, 'dry-run'], false],
    ['identical, and skip_content_gate is set',
      { inputs: { skip_content_gate: true }, outputs: { gate: { changed: 'false' } } },
      [...upToGate, 'release', 'main-moved'], false],
    ['the gate errored, so it fails open',
      { outputs: { gate: {} }, failing: ['gate'] },
      [...upToGate, 'release', 'main-moved'], false],
    ['HEAD\'s Test checks are not green',
      { outputs: { ci: { ok: 'false' } } },
      ['ci'], false],
    ['skip_ci_check is set',
      { inputs: { skip_ci_check: true }, outputs: { ci: {} } },
      ['setup-node', 'npm-ci', 'build', 'published', 'gate', 'release', 'main-moved'], false],
    ['the last tag never reached npm',
      { failing: ['published'] },
      ['ci', 'setup-node', 'npm-ci', 'build', 'published'], true],
    ['there is no release tag yet',
      { outputs: { pending: { any: 'true', last: '' }, gate: {} }, failing: ['gate'] },
      ['ci', 'setup-node', 'npm-ci', 'build', 'gate', 'release', 'main-moved'], false],
    ['a held day\'s dry run fails',
      { outputs: { gate: { changed: 'false' } }, failing: ['dry-run'] },
      [...upToGate, 'dry-run'], true],
    ['the release fails',
      { failing: ['release'] },
      [...upToGate, 'release'], true],
  ])('%s', (_what, scenario, expected, jobFails) => {
    expect(simulate(scenario)).toEqual({ ran: expected, jobFails });
  });
});

// ─── The CI check's filters, run through jq ────────────────────
//
// The step asks `gh api --jq "$legs_filter"` for HEAD's Test legs and hands
// them to `jq -r "$state_filter"`. These run both filters, taken from
// release.yml, through jq. They run wherever jq is installed, and always in
// CI, where ubuntu-latest has it and a missing jq fails them.

const hasJq = spawnSync('jq', ['--version']).status === 0;

function ciFilter(variable: string): string {
  const match = new RegExp(`${variable}='([^']*)'`).exec(byId('ci').run ?? '');
  if (match === null) { throw new Error(`the CI check sets no ${variable}`); }
  return match[1];
}

function jq(filter: string, input: string, raw = false): string {
  const result = spawnSync('jq', [raw ? '-r' : '-c', filter], { input, encoding: 'utf8' });
  if (result.status !== 0) { throw new Error(`jq ${filter} failed: ${result.stderr}`); }
  return result.stdout.trim();
}

interface CheckRun { name: string; status: string; conclusion: string | null; app: { slug: string } }

const ciState = (checkRuns: CheckRun[]): string =>
  jq(ciFilter('state_filter'), jq(ciFilter('legs_filter'), JSON.stringify({ check_runs: checkRuns })), true);

const run = (name: string, conclusion: string | null, status = 'completed', slug = 'github-actions'): CheckRun =>
  ({ name, status, conclusion, app: { slug } });

/** The check runs of 621f25d (#327's merge), as `filter=latest` listed them on 2026-09-25. */
const COMMIT_621F25D: CheckRun[] = [
  run('Codecov Upload', 'success'),
  run('Test (Node ${{ matrix.node-version }})', 'skipped'),
  run('Integration Test', 'success'),
  run('Test (Node 24.x)', 'success'),
  run('Test (Node 26.x)', 'success'),
  run('Security Audit', 'success'),
  run('Coverage', 'success'),
  run('Analyze (javascript-typescript)', 'success'),
  run('Release', 'success'),
  run('Detect Changes', 'success'),
  run('Analyze (javascript-typescript)', 'success'),
];

const withLeg = (name: string, leg: CheckRun): CheckRun[] =>
  COMMIT_621F25D.map(each => (each.name === name ? leg : each));

describe.skipIf(!hasJq && process.env.CI !== 'true')('the CI check\'s filters, through jq', () => {
  it.each<[string, string, CheckRun[]]>([
    ['621f25d as it was, skipped placeholder and all', 'green', COMMIT_621F25D],
    ['a leg failed', 'red', withLeg('Test (Node 26.x)', run('Test (Node 26.x)', 'failure'))],
    ['a leg was cancelled', 'red', withLeg('Test (Node 24.x)', run('Test (Node 24.x)', 'cancelled'))],
    ['a leg is still running', 'running', withLeg('Test (Node 26.x)', run('Test (Node 26.x)', null, 'in_progress'))],
    ['a failed check named like a leg, from another app', 'green', [...COMMIT_621F25D, run('Test (Node 24.x)', 'failure', 'completed', 'some-app')]],
    ['only the skipped placeholder', 'missing', [run('Test (Node ${{ matrix.node-version }})', 'skipped')]],
    ['no Test check, like af20812, a [skip ci] release commit', 'missing',
      [run('Publish to GitHub Packages', 'success'), run('Analyze (javascript-typescript)', 'success')]],
    ['no check runs at all', 'missing', []],
  ])('%s: %s', (_what, expected, checkRuns) => {
    expect(ciState(checkRuns)).toBe(expected);
  });
});

describe('the evaluator itself', () => {
  it.each([
    ["'a' == 'A'", true],
    ["x != 'false'", true],
    ["x == ''", true],
    ['!x', true],
    ["!x && (y == 'true' || z)", false],
    ["'it''s' == 'IT''S'", true],
  ])('%s', (expression, expected) => {
    expect(evaluate(expression, {})).toBe(expected);
  });

  it('refuses what it does not understand', () => {
    expect(() => evaluate('success() && x', {})).toThrow();
  });
});
