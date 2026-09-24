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
 *
 * With APP_UI_BUNDLE_DIR set, the script also writes the script it inlines to
 * `$APP_UI_BUNDLE_DIR/app.js` (a relative path resolves against the repo
 * root). ci.yml's Coverage job does that and hands the directory to Codecov's
 * bundle analyzer, which measures files on disk and cannot see a bundle held
 * as a JSON-escaped string inside a .ts module. Same esbuild run, same bytes
 * as the <script> element carries; the generated module is identical either
 * way.
 */

import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const uiDir = path.join(repo, 'app-ui');
const outFile = path.join(repo, 'src', 'core', 'apps', 'generated', 'app-html.ts');

/**
 * Drops the 62 non-English zod locale bundles from the output.
 *
 * `zod/v4/core/index.js` does `export * as locales from "../locales/index.js"`,
 * and that barrel eagerly re-exports every translation zod ships. A namespace
 * re-export is not statically analysable the way a named one is, so nothing
 * tree-shakes them and all 63 land in the bundle — which is inlined verbatim
 * into the `ui://` resource every MCP Apps host has to download through
 * `resources/read` before it can render a single result. (Not into
 * `tools/list`: that carries only the resource's URI.) Without this plugin
 * that is 252 kB of Hebrew, Tamil and Ukrainian validation strings — the
 * script is 632 kB with them and 380 kB without, measured 2026-09-24 on
 * ext-apps 2.0.0, MCP SDK 2.1.0 and zod 4.6.5 — to serve an app whose only
 * zod consumers are ext-apps' and the MCP SDK's own schema parsing.
 *
 * `en.js` is left alone: `zod/v4/classic/schemas.js` imports it directly and
 * registers it as the default on first `ZodType` construction, so it is the
 * locale every message in this app is actually rendered from. The rest are
 * replaced by a factory returning the same shape zod expects, so a caller that
 * did reach for one gets an unhelpful message rather than a crash.
 *
 * The filter has to be a JS RegExp against the *import specifier* (`./ar.js`),
 * and esbuild compiles it with Go's RE2 — no lookahead — hence the importer
 * check in the body rather than a negative match in the pattern.
 */
const dropZodLocales = {
  name: 'drop-zod-locales',
  setup(build) {
    build.onResolve({ filter: /^\.\/[a-zA-Z-]+\.js$/ }, (args) => {
      if (!args.importer.replace(/\\/g, '/').endsWith('zod/v4/locales/index.js')) {
        return null;
      }
      if (args.path === './en.js') {
        return null;
      }
      return { path: args.path, namespace: 'zod-locale-stub' };
    });
    build.onLoad({ filter: /.*/, namespace: 'zod-locale-stub' }, () => ({
      contents: 'export default () => ({ localeError: () => "invalid input" });',
      loader: 'js',
    }));
  },
};

const result = await build({
  entryPoints: [path.join(uiDir, 'app.ts')],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  minify: true,
  legalComments: 'none',
  write: false,
  plugins: [dropZodLocales],
});

const script = result.outputFiles[0].text;
const shell = await readFile(path.join(uiDir, 'app.html'), 'utf-8');

// `</script>` inside the bundle would close the tag early. Escaping the slash
// is inert to the JS parser and keeps the HTML well-formed.
const inlineScript = script.replace(/<\/script>/gi, '<\\/script>');
const scriptTag = `  <script type="module">${inlineScript}</script>\n  </body>`;

// A *function* replacer, not a string one. A replacement string expands `$`
// patterns, and a minified bundle is full of them — `$\`` alone (emitted by
// zod's regex builders) splices the whole document prefix in at every
// occurrence, producing a syntactically invalid script. A function's return
// value is inserted verbatim.
const inlined = shell.replace('</body>', () => scriptTag);

// The `ui://` resource URI is built from this hash, so a host's cache key for
// the bundle changes exactly when the bundle does. Computed here rather than at
// runtime because Workers has no guaranteed node:crypto.
// Hex, so it is emitted with single quotes directly rather than through
// JSON.stringify: the repo lints its own generated file, and `quotes` only
// tolerates double quotes on a string that would otherwise need escaping —
// which APP_HTML above does, and a bare hash does not.
const hash = createHash('sha256').update(inlined, 'utf-8').digest('hex').slice(0, 12);

const module = `/**
 * GENERATED FILE — do not edit.
 *
 * Produced by \`npm run build:app-ui\` from \`app-ui/\`. Edit the sources there
 * and re-run the script; this file is committed so the package builds with
 * \`tsc\` alone.
 */

export const APP_HTML = ${JSON.stringify(inlined)};

/** First 12 hex chars of the SHA-256 of {@link APP_HTML}. */
export const APP_HTML_HASH = '${hash}';
`;

await mkdir(path.dirname(outFile), { recursive: true });
await writeFile(outFile, module, 'utf-8');

const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
console.log(`app-ui → ${path.relative(repo, outFile)} (${kb(inlined.length)} inlined, hash ${hash})`);

// See the header. Only the one file is written, and nothing is deleted: the
// directory comes from the environment, and clearing it first would make a
// mistyped value destructive.
const bundleDir = process.env.APP_UI_BUNDLE_DIR;
if (bundleDir) {
  const bundleFile = path.join(path.resolve(repo, bundleDir), 'app.js');
  await mkdir(path.dirname(bundleFile), { recursive: true });
  await writeFile(bundleFile, inlineScript, 'utf-8');
  console.log(`app-ui → ${path.relative(repo, bundleFile)} (${kb(Buffer.byteLength(inlineScript))} script, for bundle analysis)`);
}
