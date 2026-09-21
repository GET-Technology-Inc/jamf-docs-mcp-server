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
 * Nothing caught it because nothing connected the two sides. This does.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const DOCS = ['README.md', 'docs/README.zh-TW.md'];

/**
 * Names in the leading cell of a documentation table row, which is how both
 * READMEs list configuration variables. Deliberately not every backticked
 * token: prose mentions Node's own `ERR_MODULE_NOT_FOUND`, which is not ours.
 */
function documentedEnvVars(doc: string): string[] {
  const text = fs.readFileSync(path.join(ROOT, doc), 'utf8');
  return [...new Set(
    [...text.matchAll(/^\| {0,2}`([A-Z][A-Z0-9_]*)` {0,2}\|/gm)].map(m => m[1]),
  )].sort();
}

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
