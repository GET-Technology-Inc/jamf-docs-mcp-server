# Conventions

## Commits and releases

`main` is released automatically by semantic-release using the
conventionalcommits preset (`.releaserc.json`). The commit type decides the
version bump:

| type | bump | appears in CHANGELOG |
|---|---|---|
| `feat:` | minor | Features |
| `fix:` `perf:` `deps:` `refactor:` `style:` `build:` `revert:` | patch | yes |
| `docs:` `ci:` `test:` `chore:` | none | hidden |
| any with `BREAKING CHANGE:` | major | yes |

So the type is a release decision, not a label. A user-visible bug fix committed
as `chore:` ships to nobody.

**Generated, never hand-edited:** `CHANGELOG.md`, and the `version` field in
`package.json` / `package-lock.json`. semantic-release owns them and commits
them itself as `chore(release): x.y.z [skip ci]`.

Commit bodies here tend to be long, and that is deliberate — the reasoning
behind a non-obvious fix is more useful in `git log` than in a PR comment that
outlives its thread. Explain *why*, and record decisions you considered and
rejected so the next person does not re-derive them.

## The generated app bundle

`src/core/apps/generated/app-html.ts` is produced by
`scripts/build-app-ui.mjs` from `app-ui/`, and it is **committed**. Two reasons:
consumers never need esbuild, and Workers has no filesystem to read the HTML
from at runtime.

CI rebuilds it and fails on any difference, so the committed copy can never
drift from its sources. Practically: after touching anything under `app-ui/`,
run `npm run build:app-ui` and commit the result in the same change.
`../skills/app-bundle-rebuild/` has the checks worth running with it.

The build is byte-deterministic. If a rebuild changes the file and you did not
change `app-ui/`, something else is wrong — investigate rather than committing
the diff.

## Lint posture

`eslint.config.js` runs `strictTypeChecked` + `stylisticTypeChecked` with a long
list of additional rules. Two things follow:

- **`test/**/*.ts` has a relaxations block** — `no-explicit-any`, `no-unsafe-*`,
  `no-non-null-assertion`, `complexity`, `max-*` are off there. Test code gets
  more rope than `src/`, on purpose.
- **`scripts/**/*.mjs` gets `disableTypeChecked`** — they are plain ESM with no
  TS project behind them, and the type-aware rules crash rather than degrade.

Rules worth knowing before you fight them:

- `strict-boolean-expressions` is configured with every `allow*` off, so
  `if (str)` and `if (num)` are errors. Rewrite to the comparison that preserves
  the original meaning: `s !== undefined && s !== ''`, not `s !== undefined`.
  `a || b` is not `a ?? b` — the first falls back on `''` and `0`.
- `no-unnecessary-condition` / `no-unnecessary-type-assertion` are only right
  when the declared type is true at runtime. For anything downstream of an FT
  payload it frequently is not. See `../skills/ft-payload-safety/`.
- `promise-function-async` and `require-await` together mean a Promise-returning
  function must be `async` *and* contain an `await`. For a mock standing in for
  an async interface, `async () => await Promise.resolve(x)` satisfies both
  without changing the return type; dropping `async` would hand callers a bare
  value.
- `naming-convention` rejects a leading underscore on variables, while
  `no-unused-vars` requires one to mark something unused. Those conflict for the
  destructure-and-drop idiom, so build the object without the unwanted key
  instead — `omitKey()` in `test/helpers/fixtures.ts`.

`src/core/apps/generated/` is linted too, so the build script's output has to
satisfy the same rules as hand-written code.

## Types

The root config runs `strict` plus `exactOptionalPropertyTypes`,
`noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`,
`noImplicitReturns` and `noFallthroughCasesInSwitch`.

`exactOptionalPropertyTypes` is the one that surprises people: `x?: string` does
**not** accept an explicit `undefined`. If callers legitimately forward an
optional value, declare it `x?: string | undefined` — as
`CreateServerOptions.tools` does.
