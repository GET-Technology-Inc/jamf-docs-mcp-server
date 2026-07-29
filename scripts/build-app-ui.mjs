/**
 * Bundles the MCP App UI into a single self-contained HTML document and emits
 * it as a TypeScript module.
 *
 * Two constraints drive this shape:
 *
 * 1. Hosts render `ui://` resources in a sandboxed iframe with a
 *    deny-by-default CSP, so the document has to carry its own JS and CSS —
 *    nothing external will load.
 * 2. The resource is served from Cloudflare Workers as well as Node, and
 *    Workers has no filesystem. Emitting a `.ts` module means the HTML is
 *    embedded in the compiled output and `tsc` alone still builds the package.
 *
 * The generated file is committed, so consumers never need esbuild.
 *
 *   npm run build:app-ui
 */

import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const uiDir = path.join(repo, 'app-ui');
const outFile = path.join(repo, 'src', 'core', 'apps', 'generated', 'app-html.ts');

const result = await build({
  entryPoints: [path.join(uiDir, 'app.ts')],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  minify: true,
  legalComments: 'none',
  write: false,
});

const script = result.outputFiles[0].text;
const shell = await readFile(path.join(uiDir, 'app.html'), 'utf-8');

// `</script>` inside the bundle would close the tag early. Escaping the slash
// is inert to the JS parser and keeps the HTML well-formed.
const scriptTag =
  `  <script type="module">${script.replace(/<\/script>/gi, '<\\/script>')}</script>\n  </body>`;

// A *function* replacer, not a string one. A replacement string expands `$`
// patterns, and a minified bundle is full of them — `$\`` alone (emitted by
// zod's regex builders) splices the whole document prefix in at every
// occurrence, producing a syntactically invalid script. A function's return
// value is inserted verbatim.
const inlined = shell.replace('</body>', () => scriptTag);

const module = `/**
 * GENERATED FILE — do not edit.
 *
 * Produced by \`npm run build:app-ui\` from \`app-ui/\`. Edit the sources there
 * and re-run the script; this file is committed so the package builds with
 * \`tsc\` alone.
 */

export const APP_HTML = ${JSON.stringify(inlined)};
`;

await mkdir(path.dirname(outFile), { recursive: true });
await writeFile(outFile, module, 'utf-8');

const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
console.log(`app-ui → ${path.relative(repo, outFile)} (${kb(inlined.length)} inlined)`);
