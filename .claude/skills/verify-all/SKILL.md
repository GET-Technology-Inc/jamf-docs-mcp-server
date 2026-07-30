---
name: verify-all
description: Runs every gate CI runs — typecheck for src/app-ui/test, lint, build, generated-bundle drift, and the test suites — capturing each one's real exit status and reporting honestly. Use this skill before committing, before opening or updating a pull request, after applying lint --fix, whenever you are about to claim that checks pass, and whenever CI failed on something that appeared to pass locally. Also use it when you catch yourself about to write `npm run lint | tail; echo $?`, which reports tail's exit code and has already reported a failing lint as a pass in this repo.
---

# Verify everything, honestly

## The failure this prevents

```bash
npm run lint 2>&1 | tail -1; echo $?   # prints 0 even when lint fails
```

`$?` after a pipeline is the *last* command's status. `tail` succeeds at tailing
a failure. This exact form reported a clean lint in this repo while eslint was
erroring, the branch was pushed, and CI caught it instead.

Two habits follow. Capture status **before** any pipe, and treat "I ran it and it
looked fine" as unverified until you have seen a number.

```bash
npm run lint > /dev/null 2>&1; echo $?   # correct
```

## Run it

```bash
.claude/skills/verify-all/scripts/verify.sh          # gates + unit tests
.claude/skills/verify-all/scripts/verify.sh --full   # also integration + e2e
```

Every check reports PASS or FAIL, the script exits non-zero if any failed, and
failures print their last 25 log lines with a path to the full log. Prefer it
over hand-rolling the loop — that is what it is for.

Default mode is what to run before a commit: fast, hermetic, no network.
`--full` additionally needs `dist/` (the script builds it) and network access;
use it before opening a PR that touches `src/core/services/`.

## What it checks, and why each one earns its place

| check | why |
|---|---|
| `typecheck` (src) | the root tsconfig covers only `src/**` |
| `typecheck:app-ui` | `app-ui/` has its own tsconfig; esbuild only strips types, so without this its sources are never checked |
| `typecheck:test` | `test/` has its own tsconfig too — skipped automatically on checkouts predating it |
| `lint` | `src/ test/ app-ui/ scripts/`, including the *generated* bundle |
| `build` | `build:app-ui` then `tsc` |
| app bundle drift | the generated bundle is committed and CI fails on any difference |
| `test:unit` | fast and fully mocked |
| `test:integration`, `test:e2e` | `--full` only; live API |

## Reading the result

A failing gate is a fact about the branch, not a rendering problem. Report it
with the output, fix it, and re-run — do not summarise it away.

Two failures that are legitimately not yours, and how to tell:

- **Integration failures with no network.** Node's fetch ignores `HTTPS_PROXY`;
  `--full` exports the proxy settings when it detects one. If integration still
  fails, check reachability directly before concluding anything:
  `curl -sS -o /dev/null -w '%{http_code}\n' https://learn.jamf.com/api/khub/maps`
- **Pre-existing failures on `main`.** Compare rather than assume. Stash, run the
  same command, unstash, and cite the difference:

  ```bash
  git stash -u && npm run test:integration; git stash pop
  ```

  "It fails on main too" is worth stating only once you have actually run it on
  main. `test/integration/mcp-server.test.ts` in particular cannot see proxy
  settings at all — see `../../docs/testing.md`.

## Before saying a gate passes

Ask yourself which of these you actually did:

- read an exit code, not the tail of some output
- run the gate that covers the files you changed — `typecheck` alone misses
  `test/` and `app-ui/`
- rebuild the app bundle if you touched `app-ui/` or `scripts/`
- run the suite that covers the files you changed, not only the fast one

If a claim in your summary is not backed by one of those, say it is unverified
rather than implying it passed.
