/**
 * Guard tests: the live contract suites must not be in the merge gate.
 *
 * `upstream-contract.yml` has always said so in its own header — "This runs OUT
 * OF BAND (cron) and opens an issue on drift. It is deliberately NOT part of
 * the merge gate — live-API flakiness must never block PRs." The config did not
 * implement it: CI runs `npm run test:integration`, which was
 * `vitest run test/integration`, a directory glob that swept the three
 * `*contracts.test.ts` files straight back in.
 *
 * So a Jamf-side change blocked every unrelated PR. It did: in September 2026
 * Jamf tagged one training video with `product-elevate`, and
 * `searchLabel for 'elevate'` went red on main — a fact about Jamf's tagging,
 * not about this server. The fix was an `--exclude` on that one script.
 *
 * These tests exist because that fix is a string in package.json and a naming
 * convention, and both are easy to break without noticing. A fourth contract
 * suite called `foo-contract.test.ts` (singular) would not match the glob and
 * would rejoin the gate silently, which is the same class of failure the
 * exclusion was added to stop.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');

const {scripts} = (JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  });

/** Files vitest treats as a contract suite, by the naming convention. */
const CONTRACT_GLOB_SUFFIX = 'contracts.test.ts';

function contractFilesOnDisk(): string[] {
  return fs
    .readdirSync(path.join(ROOT, 'test/integration'))
    .filter(name => name.endsWith(CONTRACT_GLOB_SUFFIX))
    .sort();
}

/** The files `test:contract` names, as bare filenames. */
function contractFilesInScript(): string[] {
  return [...(scripts['test:contract'] ?? '').matchAll(/test\/integration\/(\S+\.test\.ts)/g)]
    .map(m => m[1])
    .sort();
}

describe('the contract suites are out of the merge gate', () => {
  it('test:integration excludes them', () => {
    expect(
      scripts['test:integration'],
      'CI runs this script as its merge gate. Without the exclude it runs the ' +
      'live contract suites, so a Jamf-side re-tag blocks every unrelated PR — ' +
      'which contradicts what .github/workflows/upstream-contract.yml states.'
    ).toContain(`--exclude '**/*${CONTRACT_GLOB_SUFFIX}'`);
  });

  it('ci.yml runs the gated script and the cron job runs the contract script', () => {
    const ci = fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');
    const cron = fs.readFileSync(path.join(ROOT, '.github/workflows/upstream-contract.yml'), 'utf8');

    expect(ci).toContain('npm run test:integration');
    expect(
      ci.includes('npm run test:contract'),
      'ci.yml must not run the contract suites: they are the drift detector, ' +
      'and a detector that blocks merges gets widened until it detects nothing.'
    ).toBe(false);
    expect(cron).toContain('npm run test:contract');
  });
});

describe('the contract naming convention is what the exclude relies on', () => {
  it('every *contracts.test.ts file is named in test:contract', () => {
    // The exclude matches on the filename. A suite the glob catches but the
    // cron job does not name would be excluded from BOTH — never run at all.
    const onDisk = contractFilesOnDisk();
    expect(onDisk.length, 'expected the contract suites to exist').toBeGreaterThan(0);

    const orphans = onDisk.filter(f => !contractFilesInScript().includes(f));
    expect(
      orphans,
      `${JSON.stringify(orphans)} match the exclude glob but are not in ` +
      'test:contract, so they run in neither the merge gate nor the cron job. ' +
      'Add them to test:contract.'
    ).toEqual([]);
  });

  it('every file test:contract names matches the exclude glob', () => {
    // The mirror image: a contract suite named `foo-contract.test.ts` is run by
    // the cron job AND by the merge gate, which is the state this all exists to
    // get out of.
    const strays = contractFilesInScript().filter(f => !f.endsWith(CONTRACT_GLOB_SUFFIX));
    expect(
      strays,
      `${JSON.stringify(strays)} are contract suites whose names do not end in ` +
      `"${CONTRACT_GLOB_SUFFIX}", so the exclude in test:integration misses them ` +
      'and they still block PRs. Rename them.'
    ).toEqual([]);
  });
});

describe('the no-network guard is not disabled for the unit tier', () => {
  // test/helpers/no-network.setup.ts turns a missed module mock into a failure
  // instead of a slow pass — it says it exists because that happened three
  // times and "each time the only symptom was a slow test". ALLOW_LIVE_REQUESTS=1
  // switches it off wholesale, and `npm test` used to set it over a bare
  // `vitest run`, which sweeps test/unit too. So the documented pre-PR command
  // ran the whole unit tier with its safety net removed.
  const LIVE_TIERS = ['test/integration', 'test/e2e'];

  it.each(
    Object.entries(scripts).filter(([, cmd]) => cmd.includes('ALLOW_LIVE_REQUESTS=1')),
  )('%s only points ALLOW_LIVE_REQUESTS at a live tier', (name, cmd) => {
    const targets = [...cmd.matchAll(/(?:^|\s)(test\/[\w./-]+)/g)].map(m => m[1]);

    expect(
      targets.length,
      `${name} sets ALLOW_LIVE_REQUESTS=1 but names no path, so it runs every ` +
      'tier — including test/unit — with the no-network guard switched off.',
    ).toBeGreaterThan(0);

    const strays = targets.filter(t => !LIVE_TIERS.some(tier => t.startsWith(tier)));
    expect(
      strays,
      `${name} sets ALLOW_LIVE_REQUESTS=1 over ${JSON.stringify(strays)}, which is ` +
      'outside the tiers that reach live Jamf endpoints on purpose.',
    ).toEqual([]);
  });
});

describe('the guards above actually run on a PR that could break them', () => {
  // Every substantive job in ci.yml is gated on `needs.changes.outputs.code`,
  // so a path the filter does not list skips the whole test tier — including
  // this file. A PR that re-added `npm run test:contract` to ci.yml would then
  // take the test-gate no-op path and the assertion at :60 would never run.
  it('the paths filter lists the workflow files these tests read', () => {
    const ci = fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');
    const filter = ci.slice(ci.indexOf('filters: |'), ci.indexOf('\n  test:'));

    for (const workflow of ['ci.yml', 'upstream-contract.yml']) {
      expect(
        filter,
        `.github/workflows/${workflow} is read by this test file but is not in ` +
        "ci.yml's paths filter, so a PR touching only that workflow skips the " +
        'test job and these guards never run.'
      ).toContain(`.github/workflows/${workflow}`);
    }
  });
});

describe('test:all still means all', () => {
  it('runs the contract tier explicitly, now that test:integration does not', () => {
    expect(
      scripts['test:all'],
      'test:integration no longer covers the contract suites, so test:all has to ' +
      'name them or "all" quietly stopped meaning all.'
    ).toContain('npm run test:contract');
  });
});
