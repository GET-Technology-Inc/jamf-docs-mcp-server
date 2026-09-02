/**
 * Guard for the two suites that spawn `dist/index.js` as a child process.
 *
 * Those suites do not exercise `src/` at all, so a stale or missing `dist/`
 * makes them fail with assertions that read like product bugs. The observed
 * case: `dist/` predated the MCP Apps viewer, so `resources/list` returned two
 * resources instead of three and the failure surfaced as "expected [...] to
 * include 'ui://jamf-docs/app-<hash>.html'" — indistinguishable from the
 * resource having been dropped from the server. CI always builds first
 * (ci.yml runs `npm run build` before the test steps), so this only bites
 * locally, and it costs a bisect against main to rule out.
 *
 * SCOPE — read before trusting this. `APP_HTML_HASH` is produced by
 * `scripts/build-app-ui.mjs` from the contents of `app-ui/` alone, so this
 * detects exactly one thing: a `dist/` whose app bundle is older than the
 * current `app-ui/`. It is blind to a `dist/` that is stale with respect to
 * `src/core/**`. That is the right trade here — the app bundle is what these
 * two suites actually assert on, and mtime comparison, the only cheap way to
 * catch the wider case, misfires after every checkout and clone. It does mean
 * a green run is not proof that `dist/` matches `src/`.
 */
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { APP_HTML_HASH } from '../../src/core/apps/generated/app-html.js';

const BUILD_HINT = 'Run `npm run build` before this suite (CI does this for you).';

/**
 * Throw with an actionable message unless `dist/` exists and carries the
 * current `app-ui` bundle. Call from `beforeAll` in any suite that spawns dist.
 */
export function requireFreshBuild(): void {
  const root = process.cwd();
  const entry = path.resolve(root, 'dist/index.js');

  if (!existsSync(entry)) {
    throw new Error(`dist/index.js is missing — this suite spawns it. ${BUILD_HINT}`);
  }

  const bundle = path.resolve(root, 'dist/core/apps/generated/app-html.js');
  if (!existsSync(bundle)) {
    throw new Error(`${bundle} is missing, so dist/ predates the MCP Apps viewer. ${BUILD_HINT}`);
  }

  if (!readFileSync(bundle, 'utf8').includes(APP_HTML_HASH)) {
    throw new Error(
      'dist/ carries an older app-ui bundle: it does not contain the current hash ' +
      `${APP_HTML_HASH}. Assertions about the ui:// resource will fail for reasons ` +
      `that have nothing to do with the code under test. ${BUILD_HINT}`
    );
  }
}
