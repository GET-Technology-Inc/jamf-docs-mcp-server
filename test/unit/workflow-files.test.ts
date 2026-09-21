/**
 * Guard: every workflow file must parse, and no tracked source may carry an
 * invisible control character.
 *
 * Both halves come from the same incident. `pr-title.yml` was written with a
 * unicode escape for NUL inside a `--jq` expression, and it materialised as a
 * real U+0000 byte, which is illegal in YAML. GitHub accepted the push,
 * created a run attributed to it, and failed with:
 *
 *     This run likely failed because of a workflow file issue.
 *
 * No line, no column, no mention of a control character. The same mistake had
 * put a U+0000 into scripts/check-pr-title.mjs, where it did not fail at all:
 * the script kept working because the CLI check feeding it emitted a real NUL
 * too, so the two agreed and the byte sat in the source unnoticed. That is the
 * worse of the two outcomes, and the reason this looks beyond the workflows.
 *
 * Note this file contains no unicode escapes of its own — the character class
 * below is written as numeric comparisons on purpose, so the guard cannot be
 * broken by the very thing it detects.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

const ROOT = path.resolve(__dirname, '../..');
const WORKFLOW_DIR = path.join(ROOT, '.github/workflows');

const workflows = fs
  .readdirSync(WORKFLOW_DIR)
  .filter(name => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

/** Directories whose tracked text this repository authors by hand. */
const SOURCE_DIRS = ['src', 'test', 'app-ui', 'scripts', '.github'];
const TEXT_EXTENSIONS = new Set(['.ts', '.mts', '.js', '.mjs', '.json', '.yml', '.yaml', '.md']);

/**
 * Index of the first control character nobody types on purpose, or -1.
 *
 * Tab (9), newline (10) and carriage return (13) are the legitimate ones;
 * everything else below 32 is not.
 */
function firstControlCharacter(source: string): number {
  for (let i = 0; i < source.length; i++) {
    const code = source.charCodeAt(i);
    if (code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31)) {
      return i;
    }
  }
  return -1;
}

function textFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') { continue; }
        walk(full);
      } else if (TEXT_EXTENSIONS.has(path.extname(entry.name))) {
        out.push(full);
      }
    }
  };
  walk(path.join(ROOT, dir));
  return out;
}

describe('workflow files', () => {
  it('there are some to check', () => {
    // A glob that silently stopped matching would make every case below vacuous.
    expect(workflows.length).toBeGreaterThan(5);
  });

  it.each(workflows)('%s parses as YAML', name => {
    const source = fs.readFileSync(path.join(WORKFLOW_DIR, name), 'utf8');
    expect(
      () => yaml.load(source),
      `${name} is not valid YAML. GitHub reports this only as "This run likely ` +
      'failed because of a workflow file issue", with no line or reason.',
    ).not.toThrow();
  });

  it.each(workflows)('%s declares a name, a trigger and jobs', name => {
    const parsed = yaml.load(
      fs.readFileSync(path.join(WORKFLOW_DIR, name), 'utf8'),
    ) as Record<string, unknown>;

    const keys = Object.keys(parsed);
    expect(keys).toContain('name');
    expect(keys).toContain('jobs');
    // YAML 1.1 reads a bare `on` as the boolean true, which surfaces as the
    // key "true". Either spelling runs; neither would mean the workflow never
    // fires, which is the failure worth catching.
    expect(keys.includes('on') || keys.includes('true')).toBe(true);
  });
});

describe('no invisible control characters in tracked source', () => {
  it.each(SOURCE_DIRS)('%s/', dir => {
    const offenders = textFiles(dir)
      .map(file => ({ file, source: fs.readFileSync(file, 'utf8') }))
      .map(({ file, source }) => ({ file, source, at: firstControlCharacter(source) }))
      .filter(({ at }) => at >= 0)
      .map(({ file, source, at }) => {
        const line = source.slice(0, at).split('\n').length;
        const code = source.charCodeAt(at).toString(16).padStart(4, '0').toUpperCase();
        return `${path.relative(ROOT, file)}:${line} contains U+${code}`;
      });

    expect(
      offenders,
      'A control character written as a literal escape rather than as the ' +
      'characters the target language should see. In YAML that is a parse ' +
      'error with no diagnostic; in JavaScript it silently works, which is worse.',
    ).toEqual([]);
  });
});
