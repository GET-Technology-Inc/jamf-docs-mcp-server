/**
 * Guard: .github/dependabot.yml keeps doing what its comments say.
 *
 * Dependabot accepts any group order, any exclusion list and any commit
 * prefix, so each mistake below shows up weeks later, if at all:
 *
 * - A dependency goes to the first group it matches. Listed after the
 *   dev-dependencies catch-all, app-ui-bundle would lose the minor and patch
 *   bumps of ext-apps, client, server and esbuild to it (they are
 *   devDependencies; zod is not). That splits them from zod again, and puts
 *   a bump that needs a hand-pushed app-html regeneration into the one PR
 *   carrying every other dev update.
 * - esbuild belongs in app-ui-bundle for the same reason, since
 *   scripts/build-app-ui.mjs writes app-html.ts with it. Dropped from the
 *   group, it would still be in the security exclusions, so the case about
 *   those would not notice.
 * - The security group takes every security fix. Without its exclusions, a
 *   security bump to a bundle package would hold unrelated security fixes in
 *   a PR that waits for that regeneration and a maintainer's approval.
 * - A devDependency bump can change what npm publishes: ext-apps and client
 *   are inlined into src/core/apps/generated/app-html.ts. Typed with a commit
 *   type .releaserc.json does not release, such a bump merges green and
 *   publishes nothing.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { loadReleaseRules } from '../../scripts/check-pr-title.mjs';

const ROOT = path.resolve(__dirname, '../..');
const DEPENDABOT_YML = '.github/dependabot.yml';

// dependabot.yml's keys are kebab-case, which naming-convention rejects on a
// declared property. Declared through `Record`, they stay string literals
// (progress.test.ts does the same for `_meta`).
type Group = Partial<
  Record<'applies-to', string> & Record<'patterns' | 'exclude-patterns', string[]>
>;
type CommitMessage = Partial<Record<'prefix' | 'prefix-development', string>>;
type Update = Record<'package-ecosystem', string> &
  Partial<Record<'commit-message', CommitMessage>> &
  Partial<Record<'groups', Record<string, Group | undefined>>>;

const config = yaml.load(
  fs.readFileSync(path.join(ROOT, DEPENDABOT_YML), 'utf8'),
) as { updates: Update[] };

const npm = config.updates.find(update => update['package-ecosystem'] === 'npm');
const groups = npm?.groups ?? {};
/** Group names in file order, which is the order Dependabot matches them in. */
const order = Object.keys(groups);

describe('dependabot.yml npm groups', () => {
  it('has the groups the cases below are about', () => {
    // A rename would otherwise turn every case below into a comparison
    // against -1 or an empty list.
    expect(order).toEqual(
      expect.arrayContaining(['app-ui-bundle', 'dev-dependencies', 'security']),
    );
  });

  it('app-ui-bundle comes before the dev-dependencies catch-all', () => {
    expect(
      order.indexOf('app-ui-bundle'),
      'Dependabot puts a dependency in the first group it matches. Below ' +
      'dev-dependencies, app-ui-bundle would lose its devDependencies to that ' +
      'group: a regeneration-needing bump would block every dev bump that ' +
      'week, and ext-apps would move without zod.',
    ).toBeLessThan(order.indexOf('dev-dependencies'));
  });

  it('app-ui-bundle takes every package scripts/build-app-ui.mjs imports', () => {
    const bundle = groups['app-ui-bundle']?.patterns ?? [];
    const script = fs.readFileSync(path.join(ROOT, 'scripts/build-app-ui.mjs'), 'utf8');
    // Bare specifiers only (node: builtins and relative files are not
    // packages), cut to the package name.
    const packages = [...script.matchAll(/^import\s[^;]*?from\s+'([^']+)'/gm)]
      .map(([, specifier]) => specifier)
      .filter(specifier => !specifier.startsWith('node:') && !specifier.startsWith('.'))
      .map(specifier => specifier.split('/').slice(0, specifier.startsWith('@') ? 2 : 1).join('/'));
    // esbuild today. Empty would mean the regex no longer finds the imports.
    expect(packages.length).toBeGreaterThan(0);

    /** Dependabot's patterns as this file uses them: exact, or a trailing `*`. */
    const matches = (pattern: string, name: string): boolean =>
      pattern.endsWith('*') ? name.startsWith(pattern.slice(0, -1)) : name === pattern;

    expect(
      packages.filter(name => !bundle.some(pattern => matches(pattern, name))),
      'scripts/build-app-ui.mjs writes app-html.ts with these, so a bump that ' +
      'changes what they emit needs the same regeneration as a zod or ext-apps ' +
      'bump. Outside app-ui-bundle, a minor or patch bump goes to ' +
      "dev-dependencies and holds that week's PR, and every dev bump in it, " +
      'until a maintainer regenerates and approves it. Add the package to ' +
      "app-ui-bundle's patterns.",
    ).toEqual([]);
  });

  it('the security group leaves out every package app-ui-bundle regenerates', () => {
    const { security } = groups;
    const bundle = groups['app-ui-bundle']?.patterns ?? [];
    expect(security?.['applies-to']).toBe('security-updates');
    expect(bundle.length).toBeGreaterThan(0);

    const excluded = security?.['exclude-patterns'] ?? [];
    expect(
      bundle.filter(pattern => !excluded.includes(pattern)),
      'A security bump to one of these needs the app-html regeneration, and ' +
      "the push carrying it dismisses the bot's approval. Grouped with the " +
      'other security fixes, it holds all of them until a maintainer gets to ' +
      "it. Add the pattern to the security group's exclude-patterns.",
    ).toEqual([]);
  });
});

describe('a devDependency bump releases', () => {
  it('Dependabot types it with a commit type .releaserc.json releases', () => {
    const message = npm?.['commit-message'] ?? {};
    const prefix = message['prefix-development'] ?? message.prefix ?? '';
    // "deps" becomes "deps: bump ..."; "chore(deps)" would be type chore.
    const type = /^[a-z]+/.exec(prefix)?.[0] ?? '';

    expect(
      loadReleaseRules()[type],
      `devDependency bumps would be typed "${type}", which .releaserc.json does ` +
      'not release. ext-apps and client are devDependencies inlined into the ' +
      'published app-html.ts, so their bumps would merge and never publish ' +
      'until something unrelated did.',
    ).toBeDefined();
  });
});

describe('the guards above run on a PR that could break them', () => {
  interface Step { uses?: string; with?: { filters?: string } }
  const ci = yaml.load(
    fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8'),
  ) as { jobs: Record<string, { steps?: Step[] } | undefined> };

  /** Every string in a paths-filter list, however its entries are nested. */
  function entries(value: unknown): string[] {
    if (typeof value === 'string') { return [value]; }
    if (Array.isArray(value)) { return value.flatMap(entries); }
    return [];
  }

  /** An exact path, or a `dir/**` glob over it. */
  function covers(entry: string, file: string): boolean {
    return entry === file || (entry.endsWith('/**') && file.startsWith(entry.slice(0, -2)));
  }

  it(`ci.yml's paths filter sends a ${DEPENDABOT_YML}-only PR through the unit tier`, () => {
    const filterSteps = Object.values(ci.jobs)
      .flatMap(job => job?.steps ?? [])
      .filter(step => step.uses?.startsWith('dorny/paths-filter') === true);

    // No filter at all would mean every PR runs the unit tier, which is what
    // this asks for; each filter there is has to let the file through.
    for (const step of filterSteps) {
      const filters = yaml.load(step.with?.filters ?? '') as Record<string, unknown> | undefined;
      expect(
        entries(filters?.code).some(entry => covers(entry, DEPENDABOT_YML)),
        `${DEPENDABOT_YML} is not in ci.yml's "code" paths filter, so a PR ` +
        'changing only that file skips the unit tier, and this file first ' +
        'fails on some later, unrelated PR.',
      ).toBe(true);
    }
  });
});
