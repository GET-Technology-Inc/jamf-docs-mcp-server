---
name: integration-tests
description: Runs the integration and e2e suites against the live Fluid Topics API, including the proxy configuration Node needs in a cloud sandbox. Use this skill whenever you want to run test/integration or test/e2e, whenever those suites fail with `TypeError: fetch failed`, `ECONNREFUSED`, or a 503 mentioning `upstream connect error` / `TLS_error`, and whenever you are about to conclude that an environment has no network access because Node could not reach learn.jamf.com. Also use it before claiming a change is verified against real API data rather than mocks, and when deciding whether an integration failure is your change or pre-existing.
---

# Running the live-API suites

## Before concluding "no network"

If Node cannot reach `learn.jamf.com`, check whether it is *Node* that cannot,
rather than the machine:

```bash
curl -sS -o /dev/null -w 'curl: %{http_code}\n' https://learn.jamf.com/api/khub/maps
node -e "fetch('https://learn.jamf.com/api/khub/maps').then(r=>console.log('node:',r.status)).catch(e=>console.log('node FAILED:',e.message))"
```

`curl: 200` with a failing or 503-ing `node` is the signature of a proxied
environment. `curl` reads `HTTPS_PROXY`; **Node 22's built-in fetch does not.**
Undici attempts a direct connection, and where egress is intercepted that comes
back as:

```
503 upstream connect error ... TLS_error:|...:SSL routines:OPENSSL_internal:
```

Which looks exactly like an offline machine, and is not one. This mistake has
already cost a round of wrong conclusions in this repo — an entire suite was
written off as "the sandbox has no network" when it ran fine once Node was
pointed at the proxy.

## Run them

In a cloud session the SessionStart hook has already exported what is needed, so:

```bash
npm run build            # dist/ is a test dependency, not just a release artifact
npm run test:integration
npm run test:e2e
```

If the hook did not run, or you are in some other proxied environment:

```bash
export NODE_USE_ENV_PROXY=1
export NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt
```

`NODE_USE_ENV_PROXY` makes fetch honour `HTTPS_PROXY`; `NODE_EXTRA_CA_CERTS`
trusts the proxy's TLS interception. With both, expect **201/201** integration
and **9/9** e2e. Anything materially short of that is a finding, not weather.

`dist/` matters because `test/e2e` and the stdio half of `test/integration` spawn
`node dist/index.js`. A stale `dist/` produces failures that look like logic
bugs, so build first — or use `verify-all --full`, which builds for you.

## The one suite the proxy cannot reach

`test/integration/mcp-server.test.ts` (63 tests) starts the server through
`StdioClientTransport`, whose default environment allowlist is
`HOME, LOGNAME, PATH, SHELL, TERM, USER`. Proxy variables are not on it, so the
spawned server has no route out no matter what the parent process exports. No
hook or environment variable fixes this from outside.

Confirming that this is the cause, without committing anything, is worth doing
before you blame your change — pass the environment through temporarily:

```ts
transport = new StdioClientTransport({
  command: 'node',
  args: [serverPath],
  env: { ...process.env } as Record<string, string>,
});
```

With that, the file goes to 63/63. Revert it afterwards unless you intend to
propose it as a change, and remember CI does not need it — GitHub runners have
open egress.

## Deciding whether a failure is yours

Integration hits a live, rate-limited third-party API, so some noise is real.
That is not licence to wave failures away — establish the baseline instead of
guessing:

```bash
git stash -u
npm run build && npm run test:integration    # baseline on the unmodified tree
git stash pop
npm run build && npm run test:integration    # with your change
```

Cite the difference. "18 failing before, 16 after, and the two that recovered are
the ones CI flagged" is an argument. "Probably flaky" is not.

Note that CI's Integration Test job is `continue-on-error: true` — it does not
block a merge. Read it anyway; it has caught real bugs in this repo that had
nothing to do with flakiness, including a hardcoded URI that no unit test covered.

## Guarding against confident silence

Two failure modes to watch for in your own reporting:

- **Skip counts moving.** Several tests self-skip on a precondition
  (`if (knownMapId === '') return;`), so a broken earlier step can turn later
  failures into skips and make a run look better. Compare passed *and* skipped
  counts, not just failures.
- **Never having run the suite at all.** If you only ran `test:unit`, say so.
  Unit tests are fully mocked, so they cannot tell you anything about whether a
  change works against real payload shapes — which is precisely where this
  codebase's recurring bugs live.
