#!/bin/bash
#
# Run every gate CI runs, capture each one's real exit status, and print a
# summary. Exits non-zero if anything failed.
#
# Usage:
#   .claude/skills/verify-all/scripts/verify.sh            # gates + unit tests
#   .claude/skills/verify-all/scripts/verify.sh --full     # also integration + e2e
#
# The point of the script is the exit codes. `npm run lint | tail -1; echo $?`
# reports tail's status, not lint's, and has silently passed a failing lint in
# this repo. Everything below captures status before any pipe.

set -uo pipefail

cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"

FULL=0
[ "${1:-}" = "--full" ] && FULL=1

LOG_DIR="$(mktemp -d)"
FAILED=()
PASSED=()

run() {
  local name="$1"; shift
  local log="$LOG_DIR/${name//[^a-zA-Z0-9]/_}.log"
  if "$@" > "$log" 2>&1; then
    PASSED+=("$name")
    printf '  \033[32mPASS\033[0m  %s\n' "$name"
  else
    FAILED+=("$name|$log")
    printf '  \033[31mFAIL\033[0m  %s\n' "$name"
  fi
}

echo "Gates"
run "typecheck (src)"      npm run typecheck
run "typecheck (app-ui)"   npm run typecheck:app-ui
# Present since test/ came under the gates; skip cleanly on older checkouts.
if npm run 2>/dev/null | grep -q 'typecheck:test'; then
  run "typecheck (test)"   npm run typecheck:test
fi
run "lint"                 npm run lint

echo "Build"
run "build"                npm run build

# The generated app bundle is committed and CI fails on drift, so a rebuild that
# changes it is a failure here too.
echo "Artifacts"
npm run build:app-ui > /dev/null 2>&1 || true
if git diff --quiet -- src/core/apps/generated/app-html.ts; then
  PASSED+=("app bundle up to date"); printf '  \033[32mPASS\033[0m  app bundle up to date\n'
else
  FAILED+=("app bundle up to date|"); printf '  \033[31mFAIL\033[0m  app bundle up to date (rebuild changed it — commit or investigate)\n'
fi

echo "Tests"
run "unit"                 npm run test:unit

if [ "$FULL" -eq 1 ]; then
  # Integration and e2e need dist/ (built above) and network. Node's fetch
  # ignores HTTPS_PROXY, so export the proxy settings when one is in play.
  if [ -n "${HTTPS_PROXY:-}" ] && [ -r "${NODE_EXTRA_CA_CERTS:-/root/.ccr/ca-bundle.crt}" ]; then
    export NODE_USE_ENV_PROXY=1
    export NODE_EXTRA_CA_CERTS="${NODE_EXTRA_CA_CERTS:-/root/.ccr/ca-bundle.crt}"
    echo "  (fetch routed via \$HTTPS_PROXY)"
  fi
  run "integration"        npm run test:integration
  run "e2e"                npm run test:e2e
fi

echo
if [ ${#FAILED[@]} -eq 0 ]; then
  echo "All ${#PASSED[@]} checks passed."
  exit 0
fi

echo "${#FAILED[@]} of $(( ${#PASSED[@]} + ${#FAILED[@]} )) checks FAILED:"
for entry in "${FAILED[@]}"; do
  name="${entry%%|*}"; log="${entry#*|}"
  echo
  echo "--- $name ---"
  [ -n "$log" ] && [ -f "$log" ] && tail -25 "$log"
done
echo
echo "Full logs: $LOG_DIR"
exit 1
