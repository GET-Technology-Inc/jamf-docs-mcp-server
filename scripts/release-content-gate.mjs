/**
 * Would a release publish anything a consumer does not already have?
 *
 * release.yml runs this after the build, on two unpacked `npm pack` tarballs:
 * the one HEAD would publish and the one the last release did, downloaded
 * from the registry. Every file is compared byte for byte, with two
 * exceptions:
 *
 * - package.json is compared as a consumer sees it: without `version`,
 *   `devDependencies`, `overrides` (npm applies those to the root project
 *   only, never to a package installed as a dependency) and every script npm
 *   does not run on a consumer's machine, and with key order normalised.
 *
 * - README.md is reported but not counted. It changes what npmjs.com shows,
 *   not what an install does, and counting it makes a release that ships
 *   nothing else: on 2026-09-25, HEAD 621f25d differed from the registry's
 *   6.0.11 only in README.md (the Codecov badge from #326), so the first
 *   Dependabot merge after this gate went in would have published a patch
 *   whose only content was that badge, with notes crediting a bump that
 *   shipped nothing. The README reaches npm with the next release that
 *   changes anything else.
 *
 * Why: 25 of the 67 releases from 3.0.49 (2026-07-29) to 6.0.11 (2026-09-24)
 * published a package byte-identical to the one before it, and 15 of the 47
 * from 2026-08-26 on. Each registry tarball was diffed against the one before
 * it. 19 of the 25 were Dependabot devDependency or lockfile bumps typed
 * `deps:`; the other 6 were human PRs typed fix(ci), fix(deps) or deps that
 * changed only CI config or the lockfile. One of them, 4.1.2, was deployed by
 * jamf-docs-mcp-worker to production as if it carried a glossary fix it did
 * not, and the upgrade had to be redone as 4.1.3.
 *
 * It only ever holds a release back, never forces one: when it says
 * `changed=true`, semantic-release decides exactly as before. Commits it
 * holds stay pending, since semantic-release reads every commit since the
 * last tag, and go out in the notes of the next release that ships
 * something. Any error exits non-zero before `changed=` is printed, and
 * release.yml treats "no answer" as changed.
 *
 * Usage: node scripts/release-content-gate.mjs <head>/package <previous>/package
 *
 * Prints `changed=true` or `changed=false` on stdout, for $GITHUB_OUTPUT, as
 * its very last act. The differing paths go to stderr and, when
 * $GITHUB_STEP_SUMMARY is set, to the job summary.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

/**
 * The scripts npm runs on a consumer's machine when the package is installed
 * or removed. Every other script (build, test, the prepublishOnly this
 * package has) runs only in this repository, so a change to one ships
 * nothing.
 */
export const CONSUMER_SCRIPTS = new Set([
  'preinstall', 'install', 'postinstall', 'prepare',
  'preuninstall', 'uninstall', 'postuninstall',
]);

/** Top-level package.json fields that no consumer's install ever reads. */
const DEV_ONLY_FIELDS = new Set(['version', 'devDependencies', 'overrides']);

/**
 * Files that are reported but never count as a change. npm packs the README
 * at the package root whatever its case or extension, so match it that way.
 */
export function isIgnored(file) {
  return /^readme(\.[^/\\]*)?$/i.test(file);
}

function canonical(value) {
  if (Array.isArray(value)) { return value.map(canonical); }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map(key => [key, canonical(value[key])]),
    );
  }
  return value;
}

/** package.json as a consumer's install sees it, with keys in sorted order. */
export function consumerManifest(pkg) {
  const kept = Object.fromEntries(
    Object.entries(pkg).filter(([field]) => !DEV_ONLY_FIELDS.has(field) && field !== 'scripts'),
  );
  kept.scripts = Object.fromEntries(
    Object.entries(pkg.scripts ?? {}).filter(([name]) => CONSUMER_SCRIPTS.has(name)),
  );
  return canonical(kept);
}

/** The top-level package.json fields whose consumer-facing value differs. */
export function manifestChanges(head, previous) {
  const a = consumerManifest(head);
  const b = consumerManifest(previous);
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .sort()
    .filter(field => JSON.stringify(a[field]) !== JSON.stringify(b[field]));
}

function listFiles(root) {
  const out = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); } else { out.push(path.relative(root, full).split(path.sep).join('/')); }
    }
  };
  walk(root);
  return out.sort();
}

function readManifest(root) {
  const file = path.join(root, 'package.json');
  if (!fs.existsSync(file)) {
    // An empty or half-extracted directory would otherwise compare as
    // "identical" to another one. Throwing keeps the gate open.
    throw new Error(`${root} is not an unpacked package: it has no package.json`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * Compare two unpacked packages.
 *
 * `counted` lists what a consumer would get that it does not have now; the
 * release goes ahead when it is non-empty. `ignored` lists differences that
 * do not count (see isIgnored).
 */
export function diffPackages(head, previous) {
  const headManifest = readManifest(head);
  const previousManifest = readManifest(previous);
  const a = new Set(listFiles(head));
  const b = new Set(listFiles(previous));
  const counted = [];
  const ignored = [];
  for (const file of [...new Set([...a, ...b])].sort()) {
    let entry = null;
    if (!a.has(file) || !b.has(file)) {
      entry = `${file} (${a.has(file) ? 'added' : 'removed'})`;
    } else if (file === 'package.json') {
      const fields = manifestChanges(headManifest, previousManifest);
      if (fields.length > 0) { entry = `package.json (${fields.join(', ')})`; }
    } else if (!fs.readFileSync(path.join(head, file)).equals(fs.readFileSync(path.join(previous, file)))) {
      entry = file;
    }
    if (entry !== null) { (isIgnored(file) ? ignored : counted).push(entry); }
  }
  return { counted, ignored, previousVersion: String(previousManifest.version ?? '') };
}

/** The Markdown the job summary gets; also printed to the log. */
export function summarize({ counted, ignored, previousVersion }, limit = 50) {
  const against = previousVersion === '' ? 'the last release' : previousVersion;
  const list = entries => [
    ...entries.slice(0, limit).map(entry => `- \`${entry}\``),
    ...(entries.length > limit ? [`- …and ${entries.length - limit} more`] : []),
  ];
  const lines = counted.length > 0
    ? [`### Content gate: the package differs from ${against} in ${counted.length} path(s)`, '', ...list(counted)]
    : [`### Content gate: the package is identical to ${against}`];
  if (ignored.length > 0) {
    lines.push('', 'Also differs, but does not count as a change (it reaches npm with the next release that ships something):', '', ...list(ignored));
  }
  return `${lines.join('\n')}\n`;
}

/* c8 ignore start — exercised by release.yml, not by the unit tier */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [head, previous] = process.argv.slice(2);
  if (!head || !previous) {
    console.error('usage: release-content-gate.mjs <head package dir> <previous package dir>');
    process.exit(2);
  }
  const result = diffPackages(head, previous);
  const report = summarize(result);
  console.error(report);
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
  }
  // Last, so that anything above that throws leaves $GITHUB_OUTPUT without a
  // `changed` line, which release.yml reads as "release".
  console.log(`changed=${result.counted.length > 0}`);
}
/* c8 ignore stop */
