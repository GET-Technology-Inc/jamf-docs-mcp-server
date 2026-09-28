/**
 * Guard: every environment variable the READMEs document must be read by src/.
 *
 * Both READMEs carried a "Request Settings" table of five variables —
 * REQUEST_TIMEOUT, MAX_RETRIES, RETRY_DELAY, RATE_LIMIT_DELAY, USER_AGENT —
 * that did nothing at all. `ServerConfig.request` was declared, parsed from the
 * environment and range-checked, and then read by no module: http-client.ts
 * used its own hardcoded constants, and two of the five had no implementation
 * anywhere in the HTTP path. MAX_RETRIES was documented as defaulting to 3
 * against a shipped default of 0, so the docs were not merely inert but wrong.
 *
 * Nothing caught it because nothing connected the two sides. This connects
 * them by name only: it asks whether each documented name appears somewhere
 * under src/. A variable that is parsed and then not used passes, because
 * the parse is where the name appears, and that was the defect above. Replayed
 * on the tree before #296, when platforms/node/config.ts parsed all five, it
 * passes. So did `CACHE_TTL_TOC`, which the Node server has parsed since the
 * first release and nothing read until 2026-09-28.
 *
 * What this catches is a documented variable src/ never mentions. Whether a
 * value takes effect takes a test that sets it and looks at what it changed:
 * cache-ttl-documented.test.ts is that test for the CACHE_TTL_* variables,
 * and env-vars-take-effect.test.ts for every other one. The latter also
 * checks the other way round: that the server reads no variable the READMEs
 * leave out, when its platform entry starts in either transport and while
 * each tool is called.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { ENV_DOCS as DOCS, documentedEnvVars } from '../helpers/documented-env-vars.js';

const ROOT = path.resolve(__dirname, '../..');

/** Every line of shipped source, concatenated. */
function sourceText(): string {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); }
      else if (entry.name.endsWith('.ts')) { out.push(fs.readFileSync(full, 'utf8')); }
    }
  };
  walk(path.join(ROOT, 'src'));
  return out.join('\n');
}

describe('documented environment variables are actually read', () => {
  const src = sourceText();

  it.each(DOCS)('%s documents at least one variable', doc => {
    // A regex that silently stops matching would make every case below vacuous.
    expect(documentedEnvVars(doc).length).toBeGreaterThan(0);
  });

  it.each(DOCS)('every variable %s documents appears in src/', doc => {
    // Whole-word, not substring: `src.includes('MAX_RETRIES')` is satisfied by
    // http-client's unrelated `DEFAULT_MAX_RETRIES` constant, which would have
    // let the exact variable this guard exists for pass.
    const mentions = (name: string): boolean =>
      new RegExp(`(?<![A-Z0-9_])${name}(?![A-Z0-9_])`).test(src);

    const undocumented = documentedEnvVars(doc).filter(name => !mentions(name));
    expect(
      undocumented,
      `${doc} documents ${JSON.stringify(undocumented)}, which no file under ` +
      'src/ mentions. Either wire the variable up or drop it from the table — ' +
      'a documented knob that does nothing is worse than an undocumented one, ' +
      'because a user who sets it believes it took effect.',
    ).toEqual([]);
  });

  it('both READMEs document the same set', () => {
    const [en, zh] = DOCS.map(documentedEnvVars);
    expect(zh, 'the translated README drifted from README.md').toEqual(en);
  });
});
