/**
 * Dev server for the MCP App viewer.
 *
 *   npm run dev:app-ui   →   http://127.0.0.1:5173
 *
 * Serves two documents. `/harness.html` is a local MCP Apps host (see
 * `app-ui/dev/harness.ts`); `/app.html` is the viewer itself, in the iframe
 * that host embeds.
 *
 * Two things justify a hand-written server over `esbuild --servedir`.
 *
 * The first is that `/app.html` has to be *generated*. The production build
 * inlines the bundle into `app-ui/app.html` because a `ui://` resource is one
 * self-contained document; a dev server wants the same shell with a `<script
 * src>` instead, so the shell is edited in one place and both paths pick the
 * change up. Serving `app-ui/app.html` as a static file would serve a document
 * with no script in it at all.
 *
 * The second is live reload. `fs.watch` on `app-ui/`, and on each file
 * outside it that a bundle is built from, pushes an event down an
 * `EventSource`, and the harness reloads the frame — so the loop is "save,
 * look", with no click and no reconnect. Nothing is written to disk: esbuild
 * rebuilds into memory, which also means an interrupted run leaves no stray
 * `app-ui/dev/*.js` for git to notice.
 */

import { context } from 'esbuild';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { watch } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const uiDir = path.join(repo, 'app-ui');
const devDir = path.join(uiDir, 'dev');

const PORT = Number(process.env.PORT ?? 5173);

/**
 * Two separate builds rather than one multi-entry build.
 *
 * The viewer must be `iife`: it is a `<script type="module">` in production
 * only by accident of how the bundle is inlined, and building it the same way
 * it ships is the point. The harness is `esm` because it imports a JSON file
 * and nothing loads it but a browser.
 *
 * Neither is minified and both carry inline sourcemaps, so a stack trace in
 * the harness log points at a line of `app-ui/app.ts`.
 */
const shared = {
  bundle: true,
  target: 'es2022',
  sourcemap: 'inline',
  write: false,
  logLevel: 'silent',
  // What each build read, for `watchInputs`, by paths from the repo root.
  metafile: true,
  absWorkingDir: repo,
};

const appCtx = await context({
  ...shared,
  entryPoints: [path.join(uiDir, 'app.ts')],
  format: 'iife',
  outfile: 'app.js',
});

const harnessCtx = await context({
  ...shared,
  entryPoints: [path.join(devDir, 'harness.ts')],
  format: 'esm',
  outfile: 'harness.js',
  loader: { '.json': 'json' },
});

/**
 * Rebuild and return the bundle text, or the error as a script that shows it.
 *
 * A build failure must not serve a stale bundle: silently rendering the last
 * good version while the file on disk does not compile is the one dev-server
 * behaviour that actively wastes time. Throwing the message into the page
 * makes the failure the thing you see.
 */
async function bundle(ctx, label) {
  try {
    const result = await ctx.rebuild();
    watchInputs(result.metafile);
    return result.outputFiles[0].text;
  } catch (error) {
    const message = (error.errors ?? [])
      .map((e) => `${e.location?.file ?? label}:${e.location?.line ?? '?'} ${e.text}`)
      .join('\n');
    console.error(`\n✗ ${label}\n${message || error.message}\n`);
    return `document.body.innerHTML = ${JSON.stringify(
      `<pre style="padding:16px;font:12px/1.5 ui-monospace,monospace;color:#a3302a;white-space:pre-wrap">${
        message || error.message
      }</pre>`,
    )};`;
  }
}

/** The viewer's own shell, with the bundle referenced rather than inlined. */
async function appDocument() {
  const shell = await readFile(path.join(uiDir, 'app.html'), 'utf-8');
  return shell.replace(
    '</body>',
    () => '  <script type="module" src="/app.js"></script>\n  </body>',
  );
}

/** Open `EventSource` connections, notified on every rebuild. */
const listeners = new Set();

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const send = (status, type, body) => {
    res.writeHead(status, {
      'content-type': type,
      // The harness reloads the frame itself; a cached bundle would defeat it.
      'cache-control': 'no-store',
    });
    res.end(body);
  };

  void (async () => {
    switch (url.pathname) {
      case '/':
      case '/harness.html':
        return send(200, 'text/html; charset=utf-8', await readFile(path.join(devDir, 'harness.html')));
      case '/app.html':
        return send(200, 'text/html; charset=utf-8', await appDocument());
      case '/app.js':
        return send(200, 'text/javascript; charset=utf-8', await bundle(appCtx, 'app-ui/app.ts'));
      case '/harness.js':
        return send(
          200,
          'text/javascript; charset=utf-8',
          await bundle(harnessCtx, 'app-ui/dev/harness.ts'),
        );
      case '/dev-events': {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-store',
          connection: 'keep-alive',
        });
        res.write('retry: 500\n\n');
        listeners.add(res);
        req.on('close', () => listeners.delete(res));
        return undefined;
      }
      default:
        return send(404, 'text/plain; charset=utf-8', 'not found');
    }
  })().catch((error) => {
    send(500, 'text/plain; charset=utf-8', String(error));
  });
});

// Coalesced because an editor save fires several `fs.watch` events for one
// write, and each one would otherwise reload the frame mid-handshake.
let pending = null;
function reload(changed) {
  clearTimeout(pending);
  pending = setTimeout(() => {
    console.log(`↻ ${changed}`);
    for (const res of listeners) {
      res.write('event: rebuild\ndata: 1\n\n');
    }
  }, 60);
}

watch(uiDir, { recursive: true }, (_event, filename) => {
  if (filename === null || /\.(ts|html|json|css)$/.test(filename) === false) {
    return;
  }
  reload(filename);
});

/** Each directory outside app-ui/ that is watched, and the names in it a build read. */
const watchedOutside = new Map();

/**
 * Watch the files outside app-ui/ that a build read, as app-ui/ is watched.
 *
 * The viewer bundles src/core/constants/locales.ts (app-ui/language.ts,
 * since #377), and until 2026-09-28 an edit to it did not reload the frame.
 * They are read off each build's metafile rather than listed here, so a file
 * the viewer comes to import from src/ is watched from its next build on.
 * node_modules is left out. A file is watched through its directory: an
 * editor that saves by renaming a new file over the old one ends a watch on
 * the file itself.
 */
function watchInputs(metafile) {
  for (const input of Object.keys(metafile?.inputs ?? {})) {
    const file = path.resolve(repo, input);
    if (file.startsWith(`${uiDir}${path.sep}`) || file.split(path.sep).includes('node_modules')) {
      continue;
    }
    const dir = path.dirname(file);
    let names = watchedOutside.get(dir);
    if (names === undefined) {
      const watching = new Set();
      names = watching;
      watchedOutside.set(dir, watching);
      watch(dir, (_event, filename) => {
        if (filename !== null && watching.has(filename)) {
          reload(path.relative(repo, path.join(dir, filename)));
        }
      });
    }
    names.add(path.basename(file));
  }
}

// Built once now, so what they read is watched before a harness asks for them.
await bundle(appCtx, 'app-ui/app.ts');
await bundle(harnessCtx, 'app-ui/dev/harness.ts');

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  Jamf docs viewer — dev harness\n  http://127.0.0.1:${PORT}\n`);
  console.log('  Edit app-ui/, or a file of src/ it bundles, and the frame reloads. Ctrl-C to stop.\n');
});
