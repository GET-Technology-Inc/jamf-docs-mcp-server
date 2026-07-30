#!/bin/bash
#
# SessionStart hook — cloud sandbox only.
#
# Prepares a Claude Code on the web session so the test suites can actually run:
# installs dependencies, builds dist/ (the e2e and stdio integration tests spawn
# it), and routes Node's fetch through the sandbox egress proxy.
#
# The proxy step is the non-obvious one. This environment reaches the network
# through an agent proxy advertised in HTTPS_PROXY, and Node 22's built-in fetch
# (undici) does not read that variable — it attempts a direct connection, which
# the egress layer refuses with `503 upstream connect error ... TLS_error`. curl
# reads HTTPS_PROXY and works, which makes the failure look like "the sandbox has
# no network" when it is really "Node ignores the proxy". NODE_USE_ENV_PROXY
# makes fetch honour it; NODE_EXTRA_CA_CERTS trusts the proxy's TLS interception.
#
# Nothing here runs outside a remote session — see the guard below — so a local
# checkout is unaffected.

set -euo pipefail

# Claude Code sets this to "true" only in a remote/web session. On a local
# machine it is unset and the hook is a no-op, which is the whole point: this
# file is committed and therefore loaded everywhere, but must act in one place.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}"

echo "[session-start] remote session — preparing jamf-docs-mcp-server"

# `install` rather than `ci`: the container image is cached after this hook
# completes, and install reuses what is already there instead of deleting
# node_modules first.
if [ -f package.json ]; then
  echo "[session-start] npm install"
  npm install --no-fund --no-audit

  # `install` can rewrite package-lock.json when it disagrees with
  # package.json. That would leave every session starting on a dirty tree, so
  # say so loudly instead of letting it sit in the diff unnoticed.
  if ! git diff --quiet -- package-lock.json 2>/dev/null; then
    echo "[session-start] WARNING: npm install modified package-lock.json —" \
         "it has drifted from package.json. Commit the sync or revert it."
  fi
fi

# dist/ is a test dependency, not just a release artifact: test/e2e spawns
# `node dist/index.js`, and so does the stdio half of test/integration.
echo "[session-start] npm run build"
npm run build

# --- Network: make Node's fetch use the sandbox egress proxy ----------------
#
# Guarded on the CA bundle existing rather than assumed, so this degrades to a
# no-op if the sandbox stops shipping it instead of exporting a path to nothing.
CA_BUNDLE="${CLAUDE_CODE_CA_BUNDLE:-/root/.ccr/ca-bundle.crt}"

if [ -n "${CLAUDE_ENV_FILE:-}" ] && [ -n "${HTTPS_PROXY:-}" ] && [ -r "$CA_BUNDLE" ]; then
  {
    echo "export NODE_USE_ENV_PROXY=1"
    echo "export NODE_EXTRA_CA_CERTS=\"$CA_BUNDLE\""
  } >> "$CLAUDE_ENV_FILE"
  echo "[session-start] fetch routed via \$HTTPS_PROXY (CA: $CA_BUNDLE)"

  # Report reachability rather than assert it — a red integration suite is more
  # confusing than a line here saying upstream was unreachable at startup.
  if NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS="$CA_BUNDLE" \
     node -e "fetch('https://learn.jamf.com/api/khub/maps',{method:'HEAD'})
       .then(r=>{console.log('[session-start] learn.jamf.com reachable (HTTP '+r.status+')');})
       .catch(e=>{console.log('[session-start] learn.jamf.com NOT reachable: '+e.message+' — integration/e2e will fail');})" 2>/dev/null; then
    :
  fi
else
  echo "[session-start] no proxy/CA bundle detected — leaving fetch unconfigured"
fi

echo "[session-start] done"
