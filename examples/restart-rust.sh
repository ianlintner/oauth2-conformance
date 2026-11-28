#!/usr/bin/env bash
# Restart the Rust reference SUT on the base URL supplied by the conformance
# runner (OAUTH2_CONFORMANCE_BASE_URL), on the same shared store, and return
# only once the old process is gone. Readiness polling is the runner's job
# (contract section 7.4). Local harness only; no secrets are stored here.
#
# Required environment:
#   RUST_SUT_BINARY             path to rust_oauth2_server (built from the SHA
#                               recorded in reference/persistence-harness.md)
#   OAUTH2_CONFORMANCE_BASE_URL set by the runner, e.g. http://127.0.0.1:18083
#   OAUTH2_DATABASE_URL         shared durable store URL for BOTH instances
#   OAUTH2_CONFORMANCE_SEED     seed file path
#   OAUTH2_JWT_SECRET           signing secret (never commit it)
#   OAUTH2_SEED_PASSWORD        required by the Rust default configuration
# Optional: OAUTH2_ENV=test, OAUTH2_LOG_FILE (default $TMPDIR/rust-sut.log)
set -euo pipefail

: "${RUST_SUT_BINARY:?RUST_SUT_BINARY must point at the reference binary}"
: "${OAUTH2_CONFORMANCE_BASE_URL:?OAUTH2_CONFORMANCE_BASE_URL is set by the runner}"
: "${OAUTH2_DATABASE_URL:?OAUTH2_DATABASE_URL must name the shared store}"
: "${OAUTH2_CONFORMANCE_SEED:?OAUTH2_CONFORMANCE_SEED must point at the seed file}"
: "${OAUTH2_JWT_SECRET:?OAUTH2_JWT_SECRET must be supplied by the operator}"
: "${OAUTH2_SEED_PASSWORD:?OAUTH2_SEED_PASSWORD must be supplied by the operator}"

base_url="${OAUTH2_CONFORMANCE_BASE_URL%/}"
port="${base_url##*:}"
if ! [[ "$port" =~ ^[0-9]+$ ]]; then
  echo "restart-rust: cannot derive a port from $base_url" >&2
  exit 2
fi

log_file="${OAUTH2_LOG_FILE:-${TMPDIR:-/tmp}/rust-sut-restart.log}"

listeners() {
  fuser -n tcp "$port" 2>/dev/null | tr -cd '0-9 \n' | tr -s ' ' | sed 's/^ //; s/ $//' || true
}

old_pids="$(listeners)"
if [[ -n "$old_pids" ]]; then
  # Target only the process holding this instance's port; instance b stays up.
  kill $old_pids 2>/dev/null || true
  for _ in $(seq 1 200); do
    remaining="$(listeners)"
    [[ -z "$remaining" ]] && break
    sleep 0.05
  done
  remaining="$(listeners)"
  if [[ -n "$remaining" ]]; then
    echo "restart-rust: old process on port $port did not exit (pids: $remaining)" >&2
    exit 3
  fi
fi

# Inherit the shared store, seed and secrets; rebind the same origin. This is a
# conformance-only harness, so pin the guards that make the seed load.
OAUTH2_ENV="${OAUTH2_ENV:-test}" \
OAUTH2_CONFORMANCE_MODE=1 \
OAUTH2_SERVER_PORT="$port" \
OAUTH2_SERVER_PUBLIC_BASE_URL="$base_url" \
  nohup "$RUST_SUT_BINARY" >>"$log_file" 2>&1 < /dev/null &

echo "restart-rust: old pid(s) [${old_pids:-none}] exited; launched pid $! on port $port"
