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
 * real fix has to ship, which is what #230's changelog preset did. And npm
 * accepts OIDC publishing only from the workflow file named in the package's
 * trusted-publisher entry, .github/workflows/release.yml, with
 * `id-token: write`.
 *
 * The conditions are checked two ways: as text, for the specific mistakes
 * above, and by evaluating each `if` the way the runner would, over the
 * states a run can be in.
 */

import { describe, it, expect } from 'vitest';
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

  it('match the Test legs by prefix, not by the names of today\'s matrix', () => {
    const ci = byId('ci').run ?? '';
    expect(ci).toContain('startswith("Test (Node ")');
    expect(ci).not.toMatch(/\d+\.x/);
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
