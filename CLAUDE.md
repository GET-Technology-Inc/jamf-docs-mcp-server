# jamf-docs-mcp-server

An MCP server that exposes Jamf's documentation (learn.jamf.com) as tools,
resources and prompts. Upstream is Fluid Topics; everything the server knows
comes from its REST API.

This file is the short version. It covers the things that have actually caused
bugs here, and points at the longer documents for the rest.

## The one thing to internalise

**The Fluid Topics payload types are hopes, not contracts.** Every FT shape —
`FtTocNode`, `FtSearchTopic`, `FtSearchMap`, `FtMapInfo`, `FtTopicInfo` — enters
the codebase through `httpGetJson<T>()` in `src/core/services/ft-client.ts`,
which is a bare cast over `response.json()`. There is no runtime validation
anywhere behind it. A field declared `string` is a field Fluid Topics *usually*
sends.

This has shipped as a user-visible bug twice:

- **4.0.0** declared `FtTopicInfo.title` required. The compiler called a guard
  against a missing title dead code, the guard was deleted, and titleless
  payloads produced articles whose title was `undefined`.
- **4.0.1** fixed that one *and, in the same release,* deleted the equivalent
  guard on `FtTocNode.children` for the same reason. Because Fluid Topics omits
  `children` on leaf nodes rather than sending `[]`, one leaf node made every
  glossary lookup return zero results.

So when a linter or the compiler tells you a check against an FT field is
unnecessary, **ask where the type came from before believing it**. If it came
from a cast over external JSON, the type is the thing that is wrong. The fix is
to make the field optional — which turns the compiler into your ally instead of
your adversary — not to delete the check.

The affected fields are already optional. Keep them that way, and if you add a
new one, add it optional. `.claude/skills/ft-payload-safety/` has the full
procedure.

## Commands

```bash
npm run typecheck          # src/        (tsconfig.json)
npm run typecheck:app-ui   # app-ui/     (its own tsconfig: DOM lib, bundler resolution)
npm run typecheck:test     # test/       (its own tsconfig: see .claude/docs/testing.md)
npm run lint               # src/ test/ app-ui/ scripts/
npm run build              # build:app-ui, then tsc
npm run test:unit          # fast, fully mocked — the one to run while iterating
```

When checking whether a gate passes, **read its exit code directly**:

```bash
npm run lint > /dev/null 2>&1; echo $?     # correct
npm run lint 2>&1 | tail -1; echo $?       # WRONG — this is tail's exit code, always 0
```

That second form has silently reported a failing lint as a pass in this repo.
`.claude/skills/verify-all/` runs every gate correctly and reports honestly.

## Layout

`src/core/` is runtime-agnostic and must stay that way: it is compiled for
Cloudflare Workers as well as Node, so it cannot touch the filesystem and cannot
assume `node:crypto`. Anything platform-specific lives in `src/platforms/node/`
and reaches core through the interfaces in
`src/core/services/interfaces/`.

See `.claude/docs/architecture.md` for the module map, the provider-injection
pattern, and what the Workers constraint rules out in practice.

## Tests

Three suites with different requirements — unit is mocked, integration and e2e
hit the live API and need `dist/` built. `.claude/docs/testing.md` covers all
three, plus the `noUncheckedIndexedAccess` decision for `test/` and why
`test/tsconfig.json` exists at all.

In a cloud session the SessionStart hook prepares everything; locally you need
`npm run build` before integration or e2e.

## Conventions

Commits drive releases through semantic-release with the conventionalcommits
preset — `feat:` is a minor, `fix:` a patch, and `docs:`/`ci:`/`test:`/`chore:`
release nothing. `CHANGELOG.md` and the version in `package.json` are generated;
do not hand-edit them.

`src/core/apps/generated/app-html.ts` is generated *and committed*, and CI fails
if a rebuild changes it. See `.claude/docs/conventions.md` for the full set, and
`.claude/skills/app-bundle-rebuild/` for the procedure after touching `app-ui/`.

## Skills in this repo

| skill | use it when |
|---|---|
| `ft-payload-safety` | adding or changing a field on any `Ft*` type, or a linter calls an FT guard dead |
| `verify-all` | before committing or opening a PR — runs every gate with real exit codes |
| `integration-tests` | running the integration or e2e suites, especially in a cloud session |
| `app-bundle-rebuild` | after any change under `app-ui/` |
