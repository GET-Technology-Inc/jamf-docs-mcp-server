---
name: app-bundle-rebuild
description: Rebuilds and validates the committed MCP Apps viewer bundle after changes under app-ui/. Use this skill whenever you edit anything in app-ui/ or scripts/build-app-ui.mjs, whenever CI fails on the "App UI bundle is up to date" step, whenever the viewer renders blank or a host reports a SyntaxError from the ui:// resource, and whenever src/core/apps/generated/app-html.ts appears in a diff. Also use it when changing APP_RESOURCE_URI, the app cache hint, or appToolMeta(), since the bundle's cache identity is derived from its contents and both `_meta` spellings must agree.
---

# Rebuilding the MCP Apps bundle

## What makes this delicate

`src/core/apps/generated/app-html.ts` is a build artifact that is **committed**,
ships inside `dist/`, and is executed by nobody in the test suite — the viewer
runs in a host's sandboxed iframe. That combination is how 4.0.0 shipped a bundle
no browser could parse.

The mechanism is worth knowing, because it is easy to reintroduce.
`scripts/build-app-ui.mjs` inlines the esbuild output into the HTML shell with
`String.prototype.replace`. Given a *replacement string*, `$` patterns in the
replacement are expanded: minified zod emits `` $` `` from its regex builders,
which in a replacement string means "everything before the match", so the entire
HTML prefix was spliced into the middle of the script fifteen times. The document
still looked well-formed — it just contained `<!DOCTYPE html>` halfway through a
function call. The fix is the *function* replacer now in the script; keep it that
way.

## The procedure

```bash
npm run build:app-ui
npx vitest run test/unit/apps/app-html.test.ts
git add src/core/apps/generated/app-html.ts
```

Commit the regenerated file **in the same change** as the `app-ui/` edit. CI
rebuilds and fails on any difference, so a change to the sources without the
regenerated output cannot merge — and the reverse, a regenerated output whose
sources did not change, means something else is wrong.

The build is byte-deterministic. Verify that if you are unsure:

```bash
cp src/core/apps/generated/app-html.ts /tmp/gen.snap
npm run build:app-ui
diff -q /tmp/gen.snap src/core/apps/generated/app-html.ts && echo deterministic
```

## What the tests check, and why

`test/unit/apps/app-html.test.ts` asserts the properties that would have caught
the 4.0.0 breakage and the staleness that followed it:

- **The inlined script parses.** Compiled with `vm.Script`, because "it looks
  like JavaScript" is exactly what was true of the broken bundle.
- **No markup leaked into the script.** Scanned with plain string operations over
  a lower-cased copy rather than regexes — HTML tag syntax has more slack than a
  pattern comfortably expresses (`<SCRIPT>`, `</script >`), and a matcher that
  quietly misses a spelling reports a clean document without having looked at the
  one that matters.
- **The cache identity tracks the contents.** See below.

If you add a check, prefer asserting an invariant over a current value. A test
that pins the byte length or a specific hash needs editing on every legitimate
change, so it gets edited reflexively and stops meaning anything.

## Cache identity

`APP_RESOURCE_URI` is `ui://jamf-docs/app-<hash>.html`, where the hash is
computed in the build script and emitted next to `APP_HTML`. This is not
decoration — it is what makes the resource's 24-hour **public** cache hint safe.

A fixed URI carries no identity for *which* bundle it names, so a host that
fetched it under one release kept serving that copy for the full TTL after the
server deployed a different one. That is what left the unparseable 4.0.0 bundle
alive on hosts for a day after 4.0.1 published the corrected one at the same URI.
With the hash in the URI a changed bundle is a different resource, so the stale
entry is simply never requested again.

Consequences for anything you change here:

- **Compute the hash at build time, not runtime.** Core is compiled for
  Cloudflare Workers, which has no guaranteed `node:crypto`.
- **Keep both `_meta` spellings derived from `APP_RESOURCE_URI`.**
  `appToolMeta()` emits `ui.resourceUri` (current) and `ui/resourceUri` (older
  hosts). If they ever disagree, one population of hosts fetches a URI the
  server no longer serves.
- **Do not hardcode the URI in tests.** Import `APP_RESOURCE_URI`. Two
  assertions in `test/integration/mcp-server.test.ts` held the literal string
  and broke the moment the URI became content-addressed — a failure that says
  nothing about the server and everything about the test.
- **Emit generated values with single quotes.** `src/core/apps/generated/` is
  linted like hand-written code, and `quotes` is `single` with
  `avoidEscape: true`. `APP_HTML` is exempt because it genuinely contains single
  quotes; a bare hex hash is not, so `JSON.stringify(hash)` fails lint.

## Checking the shipped artifact

To inspect what a host would actually receive:

```bash
node -e "
import('./dist/core/apps/generated/app-html.js').then(({ APP_HTML, APP_HTML_HASH }) => {
  console.log('chars:', APP_HTML.length, 'hash:', APP_HTML_HASH);
  const m = APP_HTML.match(/<script type=\"module\">([\s\S]*?)<\/script>/);
  console.log('doctype leaks inside script:', (m[1].match(/<!DOCTYPE/gi) || []).length);
  new (require('node:vm').Script)(m[1]);
  console.log('script compiles');
});"
```

Zero doctype leaks and a clean compile are the two properties that matter. Run
`npm run build` first so `dist/` reflects your change.
