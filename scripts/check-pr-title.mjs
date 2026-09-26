/**
 * Fail a PR whose title would throw away a release its commits earned.
 *
 * This repository squash-merges, and a squash keeps only the PR title. Every
 * typed commit message inside the PR is discarded, so the title alone decides
 * what the merge earns when release.yml next runs semantic-release.
 *
 * On 2026-09-21 that lost a release outright. PR #296 carried sixteen commits
 * including a `feat`, was squashed under a title starting `chore:`, and
 * commit-analyzer reported "Analysis of 1 commits complete: no release".
 * Nothing was published; and because `chore` is `hidden: true` in the changelog
 * preset, none of those changes would have appeared in any later release notes
 * either. The failure was silent — CI was entirely green.
 *
 * The rule enforced here is not "every PR must release". A genuine docs or
 * chore PR should release nothing. It is the narrower invariant that was
 * actually broken: a PR title must be at least as strong as the strongest
 * commit inside it.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Release levels, ordered so they can be compared numerically. */
export const LEVEL = { none: 0, patch: 1, minor: 2, major: 3 };

const LEVEL_NAME = Object.fromEntries(
  Object.entries(LEVEL).map(([name, value]) => [value, name]),
);

/**
 * Read `type -> release` out of .releaserc.json rather than restating it.
 *
 * A rule added there but not here would make this guard quietly permissive,
 * which is the same class of drift it exists to catch.
 */
export function loadReleaseRules(root = ROOT) {
  const config = JSON.parse(
    fs.readFileSync(path.join(root, '.releaserc.json'), 'utf8'),
  );
  const analyzer = config.plugins.find(
    plugin => Array.isArray(plugin) && plugin[0] === '@semantic-release/commit-analyzer',
  );
  const rules = analyzer?.[1]?.releaseRules ?? [];
  return Object.fromEntries(
    rules
      .filter(rule => typeof rule.type === 'string' && typeof rule.release === 'string')
      .map(rule => [rule.type, rule.release]),
  );
}

/**
 * Split a conventional-commit header into the parts that decide a release.
 *
 * Returns null for anything that is not one, which is itself a finding: an
 * untyped title releases nothing.
 */
export function parseHeader(header) {
  const match = /^(?<type>[a-z]+)(?<scope>\([^)]*\))?(?<breaking>!)?: .+/.exec(header.trim());
  if (match === null) { return null; }
  return {
    type: match.groups.type,
    breaking: match.groups.breaking === '!',
  };
}

/** The release a single commit or title would produce on its own. */
export function levelOf(message, rules) {
  const header = message.split('\n', 1)[0] ?? '';
  const parsed = parseHeader(header);
  if (parsed === null) { return LEVEL.none; }

  // A `!` marker or a BREAKING CHANGE footer is a major regardless of type.
  if (parsed.breaking || /^BREAKING[ -]CHANGE:/m.test(message)) { return LEVEL.major; }

  return LEVEL[rules[parsed.type] ?? 'none'] ?? LEVEL.none;
}

/**
 * @returns {{ok: boolean, titleLevel: number, commitLevel: number, strongest: string|null, reason: string}}
 */
export function checkPrTitle({ title, commits, rules }) {
  const titleLevel = levelOf(title, rules);

  let commitLevel = LEVEL.none;
  let strongest = null;
  for (const commit of commits) {
    const level = levelOf(commit, rules);
    if (level > commitLevel) {
      commitLevel = level;
      strongest = commit.split('\n', 1)[0] ?? '';
    }
  }

  if (titleLevel >= commitLevel) {
    return { ok: true, titleLevel, commitLevel, strongest, reason: '' };
  }

  return {
    ok: false,
    titleLevel,
    commitLevel,
    strongest,
    reason:
      `This PR contains a ${LEVEL_NAME[commitLevel]}-level change:\n` +
      `    ${strongest}\n\n` +
      `but its title would produce ${titleLevel === LEVEL.none ? 'no release' : `only a ${LEVEL_NAME[titleLevel]}`}:\n` +
      `    ${title}\n\n` +
      'Merging squashes those commits away and keeps only the title, so the\n' +
      'release would be lost silently — CI stays green, and the title is all\n' +
      'semantic-release reads of this PR when it next runs.\n' +
      `Retitle the PR with a type that releases at least a ${LEVEL_NAME[commitLevel]}.`,
  };
}

// ─── CLI ───────────────────────────────────────────────────────

/* c8 ignore start — exercised by ci.yml, not by the unit tier */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const title = process.argv[2] ?? '';

  // JSON, not a delimited stream: commit messages are arbitrary multi-line
  // text, and any separator chosen for them also has to survive being
  // written into the workflow YAML that produces it. The first attempt used
  // a NUL and embedded a real one in both files; GitHub reported nothing
  // more specific than "workflow file issue".
  const raw = fs.readFileSync(0, 'utf8').trim();
  const commits = (raw === '' ? [] : JSON.parse(raw))
    .filter(commit => typeof commit === 'string' && commit.trim() !== '');

  const result = checkPrTitle({ title, commits, rules: loadReleaseRules() });

  if (!result.ok) {
    console.error(`PR title would drop a release\n\n${result.reason}`);
    process.exit(1);
  }
  console.log(`PR title is sufficient (title=${LEVEL_NAME[result.titleLevel]}, commits=${LEVEL_NAME[result.commitLevel]}).`);
}
/* c8 ignore stop */
