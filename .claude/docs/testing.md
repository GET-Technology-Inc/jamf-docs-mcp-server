# Testing

## Three suites, three sets of requirements

| suite | command | needs | speed |
|---|---|---|---|
| unit | `npm run test:unit` | nothing — fully mocked | seconds |
| integration | `npm run test:integration` | network to learn.jamf.com, `dist/` built | ~30s |
| e2e | `npm run test:e2e` | network, `dist/` built | ~10s |

`npm test` runs all three. While iterating, run `test:unit` — it is the only one
that is both fast and hermetic.

**`dist/` is a test dependency, not just a release artifact.** `test/e2e` spawns
`node dist/index.js`, and the stdio half of `test/integration` does too. A stale
or missing `dist/` shows up as confusing failures rather than as a clear error,
so run `npm run build` first.

## Network: Node's fetch does not read `HTTPS_PROXY`

In an environment that reaches the internet through a proxy — including the
Claude Code cloud sandbox — Node 22's built-in fetch ignores `HTTPS_PROXY` and
attempts a direct connection. Where egress is intercepted, that fails with:

```
503 upstream connect error ... TLS_error:|...:SSL routines:OPENSSL_internal:
```

`curl` reads the variable and succeeds, so the symptom reads as *"this machine
has no network"* when it is really *"Node ignores the proxy"*. Do not conclude
the environment is offline until you have tried:

```bash
export NODE_USE_ENV_PROXY=1
export NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt
```

With those set the integration suite passes 201/201 against the live API. The
SessionStart hook exports them automatically in a cloud session — see
`../hooks/session-start.sh`. `../skills/integration-tests/` has the full runbook.

**One known gap.** `test/integration/mcp-server.test.ts` starts the server
through `StdioClientTransport`, whose default environment allowlist is
`HOME, LOGNAME, PATH, SHELL, TERM, USER`. Proxy variables cannot reach that
child, so those tests fail behind a proxy no matter what the parent exports.
Fixing it means passing `env` explicitly in the transport options.

CI is unaffected: GitHub runners have open egress and the Integration Test job
passes unaided. That job is also `continue-on-error: true`, because it hits a
rate-limited third-party API — so a red integration run does not block a merge.
Read it anyway; it has caught real bugs that had nothing to do with flakiness.

## `test/tsconfig.json`

The root `tsconfig.json` includes only `src/**`, so before this file existed no
test file had ever been type-checked — and eslint's type-aware rules had no
project to consult for `test/`, which is why the `files: ['test/**/*.ts']` block
in `eslint.config.js` had never actually run.

It extends the root config with one deliberate relaxation:

```jsonc
"noUncheckedIndexedAccess": false   // tests only; src/ keeps it on
```

With the flag inherited, `test/` reported 311 errors, **216** of them
`TS2532`/`TS18048` on assertions like `expect(result.content[0].text)` where the
array was built by the test two lines earlier. The flag exists to catch indexing
into data of unknown length; a fixture the test just constructed is not that, and
satisfying it would mean ~216 `!`/`?.` edits that make assertions harder to read
while catching nothing. The remaining 95 were real and are fixed, not suppressed.

The full reasoning lives beside the flag in `test/tsconfig.json`.

## Writing tests here

- **A lint or type fix must never make a test assert less.** If the only way to
  satisfy a rule is to weaken an assertion, leave the rule unsatisfied and say
  so. Deleting a case to get a green gate is strictly worse than the warning.
- **Prove a regression test fails without the fix.** Revert the fix, run the
  test, watch it go red, restore. A test written after the fix that has never
  failed is not yet evidence of anything.
- **Narrow, don't assert past.** `.at(index)` returns `T | undefined` regardless
  of `noUncheckedIndexedAccess`, which keeps a real guard alive where `[index]`
  would let the compiler call it dead. `test/helpers/fixtures.ts` has
  `resourceText()` and `asJsonObject()` for the same reason: they throw with a
  useful message instead of letting `undefined` propagate.
- **Mock at the boundary you mean.** `search-service.test.ts` mocks
  `http-client` rather than `ft-client`, so the real URL construction and request
  body are still exercised.
- **Prefer `createMockContext()`** over hand-rolling a `ServerContext`; it wires
  a working cache, logger, config, maps registry and topic resolver.
