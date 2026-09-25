/**
 * Tests for the gate that holds back a release whose package would be
 * byte-identical to the last one (scripts/release-content-gate.mjs).
 *
 * The failure worth guarding is a false "identical": a shipped change that
 * waits, unannounced, for an unrelated release. So most cases here are
 * changes the gate must see. The one difference it must not count is
 * README.md: counting it would have made the first release after this gate
 * went in a badge-only patch (HEAD 621f25d against the registry's 6.0.11,
 * measured 2026-09-25).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  consumerManifest,
  diffPackages,
  isIgnored,
  manifestChanges,
  summarize,
} from '../../scripts/release-content-gate.mjs';

const BASE = {
  name: '@get-technology-inc/jamf-docs-mcp-server',
  version: '6.0.11',
  type: 'module',
  main: 'dist/index.js',
  engines: { node: '>=24' },
  dependencies: { zod: '^4.3.6', cheerio: '^1.0.0' },
  peerDependencies: { '@modelcontextprotocol/server': '^2.0.0' },
  devDependencies: { eslint: '^10.0.0' },
  overrides: { 'brace-expansion': '^5.0.8' },
  scripts: { build: 'tsc', test: 'vitest', prepublishOnly: 'npm run build', postinstall: 'node x.js' },
};

describe('consumerManifest', () => {
  it('drops what never reaches a consumer and keeps the install scripts', () => {
    expect(consumerManifest(BASE)).toEqual({
      dependencies: { cheerio: '^1.0.0', zod: '^4.3.6' },
      engines: { node: '>=24' },
      main: 'dist/index.js',
      name: '@get-technology-inc/jamf-docs-mcp-server',
      peerDependencies: { '@modelcontextprotocol/server': '^2.0.0' },
      scripts: { postinstall: 'node x.js' },
      type: 'module',
    });
  });

  it('keeps the install hooks, and prepare and the uninstall hooks to be safe', () => {
    // Only the install hooks run when a consumer installs from the registry;
    // prepare (git and folder installs) and the uninstall hooks (npm 6) are
    // counted anyway, because counting errs toward releasing.
    const scripts = Object.fromEntries(
      ['preinstall', 'install', 'postinstall', 'prepare', 'preuninstall', 'uninstall', 'postuninstall']
        .map(name => [name, `node ${name}.js`]),
    );
    expect(consumerManifest({ ...BASE, scripts: { ...scripts, lint: 'eslint' } }).scripts).toEqual(scripts);
  });
});

describe('manifestChanges', () => {
  it.each([
    ['version', { version: '6.0.12' }],
    ['devDependencies', { devDependencies: { eslint: '^10.1.0', vitest: '^5.0.1' } }],
    ['overrides', { overrides: { undici: '7.0.0' } }],
    ['a script only this repository runs', { scripts: { ...BASE.scripts, 'test:contract': 'vitest run x', build: 'tsc -b' } }],
  ])('ignores a change to %s', (_what, change) => {
    expect(manifestChanges({ ...BASE, ...change }, BASE)).toEqual([]);
  });

  it('ignores key order, at the top level and inside a field', () => {
    const { name, dependencies, ...rest } = BASE;
    const reordered = { ...rest, dependencies: { cheerio: dependencies.cheerio, zod: dependencies.zod }, name };
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(BASE));
    expect(manifestChanges(reordered, BASE)).toEqual([]);
  });

  it.each([
    ['dependencies', { dependencies: { ...BASE.dependencies, zod: '^4.6.0' } }],
    ['dependencies', { dependencies: { ...BASE.dependencies, undici: '^7.0.0' } }],
    ['peerDependencies', { peerDependencies: { '@modelcontextprotocol/server': '^3.0.0' } }],
    ['engines', { engines: { node: '>=26' } }],
    ['scripts', { scripts: { ...BASE.scripts, postinstall: 'node y.js' } }],
    ['scripts', { scripts: { ...BASE.scripts, preinstall: 'node y.js' } }],
    ['bin', { bin: { 'jamf-docs': 'dist/index.js' } }],
    ['main', { main: 'dist/main.js' }],
  ])('sees a change to %s', (field, change) => {
    expect(manifestChanges({ ...BASE, ...change }, BASE)).toEqual([field]);
  });

  it('sees a field that was removed', () => {
    const rest: Record<string, unknown> = { ...BASE };
    delete rest.peerDependencies;
    expect(manifestChanges(rest, BASE)).toEqual(['peerDependencies']);
  });
});

describe('isIgnored', () => {
  it.each(['README.md', 'readme.md', 'README', 'Readme.markdown'])('does not count %s', file => {
    expect(isIgnored(file)).toBe(true);
  });

  it.each(['LICENSE', 'package.json', 'dist/README.md', 'dist/index.js', 'README.md.js/x'])('counts %s', file => {
    expect(isIgnored(file)).toBe(false);
  });
});

describe('diffPackages', () => {
  let root = '';
  const write = (dir: string, files: Record<string, string | Buffer>): string => {
    const base = path.join(root, dir);
    for (const [file, body] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(base, file)), { recursive: true });
      fs.writeFileSync(path.join(base, file), body);
    }
    return base;
  };
  const pkg = (fields: Record<string, unknown> = {}): string => JSON.stringify({ ...BASE, ...fields }, null, 2);
  const FILES = {
    'LICENSE': 'MIT',
    'README.md': '# readme',
    'dist/index.js': 'export {};\n',
    'dist/core/apps/generated/app-html.js': 'export const html = "<p>";\n',
  };

  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'content-gate-')); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('finds nothing in a package that differs only in version and dev-only fields', () => {
    const head = write('head', { ...FILES, 'package.json': pkg({ version: '6.0.12', devDependencies: { eslint: '^10.1.0' } }) });
    const previous = write('previous', { ...FILES, 'package.json': pkg() });
    expect(diffPackages(head, previous)).toEqual({ counted: [], ignored: [], previousVersion: '6.0.11' });
  });

  it('reports a README-only difference without counting it', () => {
    const head = write('head', { ...FILES, 'README.md': '# readme\n\n[![codecov](badge)]', 'package.json': pkg({ version: '6.0.12' }) });
    const previous = write('previous', { ...FILES, 'package.json': pkg() });
    const result = diffPackages(head, previous);
    expect(result.counted).toEqual([]);
    expect(result.ignored).toEqual(['README.md']);
  });

  it('sees one changed byte in dist', () => {
    const head = write('head', { ...FILES, 'dist/index.js': 'export {};\r', 'package.json': pkg() });
    const previous = write('previous', { ...FILES, 'package.json': pkg() });
    expect(diffPackages(head, previous).counted).toEqual(['dist/index.js']);
  });

  it('compares bytes, not text', () => {
    // Same string once decoded as UTF-8 (both invalid sequences become U+FFFD),
    // different bytes on disk.
    const head = write('head', { ...FILES, 'dist/index.js': Buffer.from([0xff]), 'package.json': pkg() });
    const previous = write('previous', { ...FILES, 'dist/index.js': Buffer.from([0xfe]), 'package.json': pkg() });
    expect(diffPackages(head, previous).counted).toEqual(['dist/index.js']);
  });

  it('sees added and removed files', () => {
    const head = write('head', { ...FILES, 'dist/new.js': '', 'package.json': pkg() });
    const previous = write('previous', { ...FILES, 'dist/old.js': '', 'package.json': pkg() });
    expect(diffPackages(head, previous).counted).toEqual(['dist/new.js (added)', 'dist/old.js (removed)']);
  });

  it('counts a change to LICENSE', () => {
    const head = write('head', { ...FILES, 'LICENSE': 'MIT\n', 'package.json': pkg() });
    const previous = write('previous', { ...FILES, 'package.json': pkg() });
    expect(diffPackages(head, previous).counted).toEqual(['LICENSE']);
  });

  it.each([
    ['a lifecycle script', { scripts: { ...BASE.scripts, postinstall: 'node y.js' } }, 'scripts'],
    ['dependencies', { dependencies: { ...BASE.dependencies, zod: '^4.6.0' } }, 'dependencies'],
    ['peerDependencies', { peerDependencies: { '@modelcontextprotocol/server': '^3.0.0' } }, 'peerDependencies'],
    ['engines', { engines: { node: '>=26' } }, 'engines'],
  ])('sees a change to %s in package.json, and names the field', (_what, change, field) => {
    const head = write('head', { ...FILES, 'package.json': pkg({ version: '6.0.12', ...change }) });
    const previous = write('previous', { ...FILES, 'package.json': pkg() });
    expect(diffPackages(head, previous).counted).toEqual([`package.json (${field})`]);
  });

  it('throws, so the gate fails open, when a side is not an unpacked package', () => {
    const head = write('head', { ...FILES, 'package.json': pkg() });
    const previous = write('previous', { 'dist/index.js': 'export {};\n' });
    expect(() => diffPackages(head, previous)).toThrow(/no package\.json/);
    expect(() => diffPackages(head, path.join(root, 'missing'))).toThrow();
  });
});

describe('summarize', () => {
  it('lists what counts, then what does not', () => {
    const text = summarize({ counted: ['dist/a.js', 'package.json (engines)'], ignored: ['README.md'], previousVersion: '6.0.11' });
    expect(text).toContain('differs from 6.0.11 in 2 path(s)');
    expect(text.indexOf('`dist/a.js`')).toBeLessThan(text.indexOf('`README.md`'));
    expect(text).toContain('does not count');
  });

  it('says identical when nothing counts', () => {
    expect(summarize({ counted: [], ignored: [], previousVersion: '6.0.11' })).toContain('identical to 6.0.11');
  });

  it('caps a long list', () => {
    const counted = Array.from({ length: 60 }, (_, i) => `dist/${i}.js`);
    const text = summarize({ counted, ignored: [], previousVersion: '6.0.11' }, 50);
    expect(text).toContain('…and 10 more');
    expect(text).not.toContain('`dist/59.js`');
  });
});
