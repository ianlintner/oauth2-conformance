# Operations §5 persistence harness (multi-instance + restart)

The nine drafts in `scenarios/operations/persistence/` exercise contract
`sut-interface.md` §7.4 (`sut-restart`) and §7.5 (two instances sharing one
store). They are **draft** until a SUT can advertise that topology: the Rust
reference at `e75b4cb23bcf5aa4751c4687a96a080ad261364c` fail-closes conformance
mode to `sqlite::memory:` and therefore cannot share state between processes or
survive a restart. This document records the harness and the evidence.

## Topology

```
port 18083 (instance a) ─┐
                         ├─ one durable store (contract §7.5)
port 18085 (instance b) ─┘

restart.command: examples/restart-rust.sh
```

- `examples/sut-config.multi-instance.yaml` maps `a`/`b` and the restart
  command. The primary base URL still comes from `run --base-url` (a).
- `examples/restart-rust.sh` TERMs the listener on the port parsed from
  `OAUTH2_CONFORMANCE_BASE_URL`, waits for the port to be released, then
  relaunches `$RUST_SUT_BINARY` with the same store/seed/secrets. It exits only
  after the old process has gone; the runner polls `readyPath` after it returns.
- No credentials are stored in the repo: the operator supplies
  `OAUTH2_JWT_SECRET`, `OAUTH2_SEED_PASSWORD`, `OAUTH2_DATABASE_URL` and
  `OAUTH2_CONFORMANCE_SEED` through the environment.

## Starting two Rust instances

```sh
# Throwaway reference worktree (delete afterwards with git worktree remove).
git -C ~/Projects/rust-oauth2-server worktree add "$TMPDIR/rust-persistence-ref" \
  e75b4cb23bcf5aa4751c4687a96a080ad261364c

export OAUTH2_ENV=test OAUTH2_CONFORMANCE_MODE=1
export OAUTH2_SEED_PASSWORD='<operator-supplied>'
export OAUTH2_JWT_SECRET='<operator-supplied, >=32 bytes>'
export OAUTH2_CONFORMANCE_SEED="$PWD/examples/seed.yaml"
export RUST_SUT_BINARY="$HOME/Projects/rust-oauth2-server/target/debug/rust_oauth2_server"

# Instance a.
OAUTH2_DATABASE_URL='sqlite::memory:' OAUTH2_SERVER_PORT=18083 \
  OAUTH2_SERVER_PUBLIC_BASE_URL=http://127.0.0.1:18083 \
  "$RUST_SUT_BINARY"

# Instance b, in a second shell with the same exports, port 18085 and
# OAUTH2_SERVER_PUBLIC_BASE_URL=http://127.0.0.1:18085.
```

Wait for `/health` on both ports before running scenarios. For a real
§7.5 SUT, both instances must be pointed at the **same** store; the in-memory
store above is deliberately process-local so the harness demonstrates the
failure mode.

## Running the drafts

```sh
cd runner
mise exec node@26.8.2 -- pnpm conformance validate-schemas --root ..
mise exec node@26.8.2 -- pnpm conformance validate \
  --scenarios ../scenarios --requirements ../requirements --profiles ../profiles
mise exec node@26.8.2 -- pnpm conformance run \
  --base-url http://127.0.0.1:18083 \
  --scenarios ../scenarios/operations/persistence \
  --sut-config ../examples/sut-config.multi-instance.yaml \
  --report "$TMPDIR/persistence-report.json"
```

The runner uses node@26.8.2 (`mise exec`); the default 26.13.1 does not provide
`tsx`.

## Anti-vacuity controls

A cross-replica scenario that only asserts `400`/`inactive` on instance b will
pass against two isolated stores, because b sees an *unknown* token/code/jti.
Every draft therefore has a positive control:

| Scenario | Positive control |
| --- | --- |
| code-single-use-across-replicas | introspect on b with token from a → `active: true` |
| code-used-survives-restart | introspect after restart with token from before → `active: true` |
| refresh-rotation-across-replicas | rotated token accepted on b → 200 |
| refresh-reuse-revokes-family-across-replicas | introspect on b before reuse → `active: true` |
| revocation-across-replicas | introspect on b before revocation → `active: true` |
| dpop-replay-across-replicas | fresh key+jti proof accepted on b → 200, then same key+jti used on a replayed on b → 400 |
| dpop-replay-survives-restart | introspect after restart with token from before → `active: true` |
| par-request-uri-single-use-across-replicas | code from first authorize exchangeable on b → 200 |
| device-code-single-use-across-replicas | introspect on b with device token from a → `active: true` |

This is why the two drafts that initially "passed" against isolated stores were
reworked before recording results.

## Observed results (two isolated in-memory Rust instances, SHA above)

Command above, fresh a and b on 18083/18085:

```
validate-schemas: OK (279 files)
scenarios: 219 / requirements: 428 / profiles: 11 / validate: OK
executed=9 passed=0 failed=0 deferred=9 verdict=fail
```

Per scenario (`draft` ⇒ deferred, never counted in the verdict):

| Scenario | Result | First failing control |
| --- | --- | --- |
| code-single-use-across-replicas | DEFER | `shared-store-control-on-b.active` false |
| code-used-survives-restart | DEFER | `persisted-state-control.active` false |
| refresh-rotation-across-replicas | DEFER | `rotated-token-accepted-on-b.status` 400 |
| refresh-reuse-revokes-family-across-replicas | DEFER | `shared-store-control-on-b.active` false |
| revocation-across-replicas | DEFER | `shared-store-control-on-b.active` false |
| dpop-replay-across-replicas | DEFER | `replay-on-b.status` 200 (no shared replay record) |
| dpop-replay-survives-restart | DEFER | `persisted-state-control.active` false; replay 200 after restart |
| par-request-uri-single-use-across-replicas | DEFER | `shared-store-control-on-b.status` 400 |
| device-code-single-use-across-replicas | DEFER | `shared-store-control-on-b.active` false |

## Reference blocker (R-06)

Pointing the reference at a shared file store is refused at startup:

```
FATAL: conformance mode refused: it requires OAUTH2_DATABASE_URL=sqlite::memory:
so seeded test credentials are never persisted to a shared or production store
```

This is a deliberate fail-closed guard in
`crates/oauth2-server/src/conformance.rs`, not a harness defect. Promotion of
these scenarios requires a reference change (epic R-06) that allows a shared
durable store in conformance mode without touching production data; until then
the drafts stay `draft` and the operations MUST coverage is unchanged.
