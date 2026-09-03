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
 * The second is live reload. `fs.watch` on `app-ui/` pushes an event down an
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
watch(uiDir, { recursive: true }, (_event, filename) => {
  if (filename === null || /\.(ts|html|json|css)$/.test(filename) === false) {
    return;
  }
  clearTimeout(pending);
  pending = setTimeout(() => {
    console.log(`↻ ${filename}`);
    for (const res of listeners) {
      res.write('event: rebuild\ndata: 1\n\n');
    }
  }, 60);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  Jamf docs viewer — dev harness\n  http://127.0.0.1:${PORT}\n`);
  console.log('  Edit app-ui/*.ts and the frame reloads. Ctrl-C to stop.\n');
});
