/**
 * Guard: in ci.yml, only the job that talks to Codecov can mint a GitHub OIDC
 * token, and that job runs none of the project's code.
 *
 * `id-token: write` lets every step of a job request an OIDC token, for any
 * audience. #326 granted it to the job that measured coverage, which also ran
 * `npm ci` (the install scripts of every dependency), the whole unit tier and
 * esbuild, so any of those could have asked for one. The work is now split in
 * two: the Test (Node 26.x) leg measures and hands its reports over as an
 * artifact, and codecov-upload, the one job with the permission, sends them.
 *
 * Nothing else holds that split in place, and each way of undoing it looks
 * harmless and stays green: the permission added to the Test job so that it
 * can "just upload", an `npm ci` added to the upload job to get a tool, an
 * action added there that runs one, the artifact unpacked into the checkout,
 * where git reads its config, a second leg handing over an artifact of the
 * same name, a tool fetched at run time ahead of the hand-off. A Codecov
 * upload that fails is continue-on-error by design, so CI would not say
 * anything either.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

const ROOT = path.resolve(__dirname, '../..');

type Permissions = string | Record<string, string | undefined> | undefined;

// The index signatures carry the keys with dashes in them, such as
// `continue-on-error`, which the naming convention keeps out of a type.
interface Step {
  [key: string]: unknown;
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  with?: Record<string, unknown>;
}
interface Job {
  [key: string]: unknown;
  needs?: string | string[];
  if?: string;
  permissions?: Permissions;
  strategy?: { matrix?: Record<string, unknown> };
  steps?: Step[];
}

const ci = yaml.load(
  fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8'),
) as { permissions?: Permissions; jobs: Record<string, Job | undefined> };

const UPLOAD_JOB = 'codecov-upload';
const upload = ci.jobs[UPLOAD_JOB];
/** The job that measures: the Test matrix, whose 26.x leg runs coverage. */
const PRODUCER_JOB = 'test';
const producer = ci.jobs[PRODUCER_JOB];

function grantsIdToken(permissions: Permissions): boolean {
  if (typeof permissions === 'string') {
    return permissions === 'write-all';
  }
  return permissions?.['id-token'] === 'write';
}

function steps(job: Job | undefined): Step[] {
  return job?.steps ?? [];
}

/** `actions/checkout@v7` -> `actions/checkout`. */
function action(step: Step): string | undefined {
  return step.uses?.replace(/@.*$/, '');
}

function talksToCodecov(step: Step): boolean {
  return action(step) === 'codecov/codecov-action' || (step.run ?? '').includes('bundle-analyzer');
}

function jobsWhere(predicate: (job: Job) => boolean): string[] {
  return Object.entries(ci.jobs)
    .filter(([, job]) => job !== undefined && predicate(job))
    .map(([id]) => id)
    .sort();
}

/** A run script as one command per line, with `\` continuations joined. */
function commands(step: Step): string[] {
  return (step.run ?? '').replace(/\\\n\s*/g, ' ').split('\n').map(line => line.trim()).filter(Boolean);
}

describe('ci.yml: only the Codecov Upload job can mint an OIDC token', () => {
  it('the job exists', () => {
    // Renaming it would make every case below vacuous.
    expect(upload, `ci.yml has no job "${UPLOAD_JOB}"`).toBeDefined();
    expect(steps(upload).length).toBeGreaterThan(0);
  });

  it('the workflow-level permissions do not grant id-token', () => {
    expect(
      grantsIdToken(ci.permissions),
      'Every job without a permissions block of its own inherits this one, ' +
      'npm ci, the tests and the builds included.',
    ).toBe(false);
  });

  it(`${UPLOAD_JOB} is the one job granted id-token`, () => {
    expect(
      jobsWhere(job => grantsIdToken(job.permissions)),
      'id-token: write lets every step of a job request an OIDC token for ' +
      'any audience. Grant it only to the job that runs no project code.',
    ).toEqual([UPLOAD_JOB]);
  });

  it(`the ${PRODUCER_JOB} job states contents: read, and nothing more`, () => {
    // It runs npm ci, the tests and esbuild, and it is the job that would
    // look like the natural place to "just upload" from. The block is there
    // to make the missing id-token visible, and a job-level block replaces
    // the workflow's rather than adding to it.
    expect(producer?.permissions).toEqual({ contents: 'read' });
  });

  it(`no job but ${UPLOAD_JOB} talks to Codecov`, () => {
    // A Codecov step anywhere else has no token to upload with, and the
    // obvious repair is to grant that job the permission.
    expect(jobsWhere(job => steps(job).some(talksToCodecov))).toEqual([UPLOAD_JOB]);
  });
});

describe(`${UPLOAD_JOB} runs none of the project's code`, () => {
  // Each action here runs with the token in reach. Adding one is a decision,
  // not a drive-by: extend this list only for an action that runs no code
  // from the checkout or from npm.
  const ALLOWED_ACTIONS = [
    'actions/checkout',
    'actions/download-artifact',
    'actions/setup-node',
    'codecov/codecov-action',
  ];

  it('uses only the actions it needs', () => {
    const others = steps(upload)
      .map(action)
      .filter((uses): uses is string => uses !== undefined && !ALLOWED_ACTIONS.includes(uses));
    expect(others).toEqual([]);
  });

  it('runs no package manager, test runner or node script against the checkout', () => {
    const offenders = steps(upload)
      .flatMap(commands)
      .filter(command => /\b(npx|pnpm|yarn|bunx?|tsx|node|vitest|esbuild|tsc)\b/.test(command));
    expect(
      offenders,
      'Anything run from the checkout runs with the OIDC token in reach. ' +
      'Measure in the Test (Node 26.x) leg and hand the result over in the artifact.',
    ).toEqual([]);
  });

  it('runs npm only to install one tool at an exact version, frozen by date, outside the checkout', () => {
    const npm = steps(upload).flatMap(commands).filter(command => /\bnpm\b/.test(command));
    expect(npm.length, 'expected the bundle analyzer install').toBeGreaterThan(0);

    for (const command of npm) {
      // `npm ci`, `npm install` with no --prefix, `npm run ...`: the project's
      // dependency tree, or its scripts, in the job that holds the token.
      expect(command, 'the only npm subcommand allowed here is install').toMatch(/^npm install\s/);
      expect(command, 'outside the checkout, so its package.json, lockfile and .npmrc play no part')
        .toMatch(/--prefix "\$RUNNER_TEMP\//);
      expect(command).toContain('--ignore-scripts');
      expect(command).toContain('--no-save');
      expect(command, 'the dependencies of the tool are ranges; --before fixes them')
        .toMatch(/--before=\d{4}-\d{2}-\d{2}/);
      expect(command, 'one package at an exact version').toMatch(/\s@?[\w./-]+@\d+\.\d+\.\d+$/);
    }
  });

  it('restores no npm cache', () => {
    // The npm cache is saved by the jobs that run npm ci.
    for (const step of steps(upload).filter(s => action(s) === 'actions/setup-node')) {
      expect(step.with?.cache).toBeUndefined();
      expect(step.with?.['package-manager-cache']).toBe(false);
    }
  });

  it('leaves no credentials in the checkout', () => {
    const checkouts = steps(upload).filter(s => action(s) === 'actions/checkout');
    expect(checkouts.length).toBe(1);
    expect(checkouts[0]?.with?.['persist-credentials']).toBe(false);
  });
});

describe('the hand-off from the Test (Node 26.x) leg to the upload job', () => {
  const publishers = steps(producer).filter(s => action(s) === 'actions/upload-artifact');
  const publish = publishers.at(0);
  const publishIndex = publish === undefined ? -1 : steps(producer).indexOf(publish);
  const download = steps(upload).find(s => action(s) === 'actions/download-artifact');
  const values = producer?.strategy?.matrix?.['node-version'];
  const matrix = Array.isArray(values) ? values.map(String) : [];

  it(`${UPLOAD_JOB} downloads the artifact the ${PRODUCER_JOB} job uploads`, () => {
    expect(publishers.length, `the ${PRODUCER_JOB} job should publish exactly one artifact`).toBe(1);
    expect(download, `${UPLOAD_JOB} downloads no artifact`).toBeDefined();
    // Out of step, the download fails, and continue-on-error keeps that quiet.
    expect(download?.with?.name).toBe(publish?.with?.name);
    expect([upload?.needs].flat()).toContain(PRODUCER_JOB);
  });

  it('exactly one leg of the matrix hands the reports over', () => {
    // A step runs on every leg unless its `if` pins one. Unpinned, both legs
    // upload the same name and whichever finishes last wins (`overwrite`);
    // pinned to a leg the matrix does not run, nothing is uploaded, the
    // download fails, and continue-on-error keeps both quiet.
    const legs = [...(publish?.if ?? '').matchAll(/matrix\.node-version\s*==\s*'([^']*)'/g)].map(m => m[1]);
    expect(legs, `the hand-off's if is ${JSON.stringify(publish?.if)}`).toHaveLength(1);
    expect(matrix, `${JSON.stringify(legs[0])} is not a leg of the matrix`).toContain(legs[0]);
  });

  it('nothing fetched at run time runs in the Test job before the hand-off', () => {
    // npx resolves a tool, and its dependency ranges, from the registry on
    // the day: license-checker@25.0.1 pins itself and none of its ten
    // dependencies. Ahead of the hand-off, whatever it resolves can rewrite
    // the reports that the one job with id-token uploads before they are
    // packed, and the tree the required unit run tests, with no more than
    // the file access every step has. After it, replacing the artifact
    // takes the runner's own artifact token, which no run step is handed;
    // the comment over ci.yml's audit step says what that does and does not
    // stop. npm ci is not in the list: it installs the lockfile. npm audit
    // is, although it only reads advisories, so the two advisory steps stay
    // together.
    const early = steps(producer)
      .slice(0, publishIndex)
      .filter(s => commands(s).some(command => /\b(npx|npm (audit|exec|install|i|dlx)|pnpm dlx|yarn dlx|bunx)\b/.test(command)))
      .map(s => s.name ?? s.run);
    expect(publishIndex, 'expected the hand-off step').toBeGreaterThan(0);
    expect(early).toEqual([]);
  });

  it(`${UPLOAD_JOB} unpacks the artifact outside the checkout, and reads the reports only from there`, () => {
    // Whatever runs in the Test (Node 26.x) leg decides what the artifact
    // holds, and download-artifact writes each zip entry at its own path
    // under the target. Unpacked into the checkout, an entry named
    // .git/config replaces the checkout's own, and the git commands this job
    // runs there (Codecov's CLI, the bundle analyzer, checkout's post step)
    // run what its core.fsmonitor names, with the OIDC token in reach.
    const target = String(download?.with?.path);
    expect(target, 'with no path, download-artifact unpacks into the checkout')
      .toMatch(/^\$\{\{ runner\.temp \}\}\/[\w.-]+$/);

    // Every reader points into that directory. A path left relative to the
    // checkout finds no file there, and the upload fails on a green run.
    const files = steps(upload)
      .filter(s => action(s) === 'codecov/codecov-action')
      .map(s => String(s.with?.files));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(file.startsWith(`${target}/`), `${file} is not under ${target}`).toBe(true);
    }
    const analyzer = steps(upload).flatMap(commands).filter(command => command.includes('.bin/bundle-analyzer'));
    expect(analyzer.length).toBe(1);
    expect(analyzer[0]).toContain(` "${target.replace('${{ runner.temp }}', '$RUNNER_TEMP')}/`);
  });

  it('both sides still run after a failed test', () => {
    // A run whose tests failed is the one Test Analytics exists to report.
    expect(publish?.if).toContain('!cancelled()');
    expect(upload?.if).toContain('!cancelled()');
    expect(upload?.if).toContain(`needs.${PRODUCER_JOB}.result == 'failure'`);
  });

  it(`${UPLOAD_JOB} cannot fail the run`, () => {
    expect(upload?.['continue-on-error']).toBe(true);
    const fatal = steps(upload)
      .filter(s => talksToCodecov(s) || action(s) === 'actions/download-artifact')
      .filter(s => s['continue-on-error'] !== true)
      .map(s => s.name ?? s.uses);
    expect(fatal, 'Codecov must never turn CI red').toEqual([]);
  });
});
