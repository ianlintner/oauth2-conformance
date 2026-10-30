# Parity and conformance roadmap

Goal: every implementation — `rust-oauth2-server` (reference), `python-oauth2-server`, `typescript-oauth2-server`, `go-oauth2-server` — passes every profile of this contract, with differences recorded as reviewed deviations rather than discovered in production.

## Milestones

Each milestone is one contract profile. The same milestone names exist on GitHub in all five repositories; every PR that contributes to a profile is assigned to that milestone.

| Milestone | Profile | Specs | Rust reference tests (source material) |
|---|---|---|---|
| v0.1 core | `core` | RFC 6749 authorization code, RFC 7636 PKCE (S256 only), RFC 9207 `iss`, RFC 8252 native redirects, RFC 9700 code replay / state / redirect / HTTPS rules, client authentication, error responses, no implicit/ROPC | `compliance_rfc6749`, `compliance_rfc7636`, `rfc8252_native_apps`, `rfc9700_code_replay`, `rfc9700_require_state`, `rfc9700_https_enforcement`, `security_http` |
| v0.2 token-lifecycle | `token-lifecycle` | Client credentials, refresh rotation and family revocation, RFC 6750 bearer usage, RFC 7009 revocation, RFC 7662 introspection, RFC 8414 metadata, RFC 9068 JWT access tokens, JWKS and key rotation, opaque tokens | `compliance_rfc6750`, `compliance_rfc7662_7009`, `compliance_rfc8414`, `opaque_tokens`, `rfc9700_introspection_pii`, `rfc9700_jti_replay` |
| v0.3 oidc | `oidc-basic` | OIDC Core (ID token, nonce, UserInfo, claims request, hybrid where supported), OIDC Discovery, RP-initiated / front- / back-channel logout; OpenID Foundation suite as external oracle | `compliance_oidc_core`, `rfc_compliance`, `phase2_rfc_compliance` |
| v0.4 extended-grants | `extended-grants` | RFC 8628 device grant, RFC 9126 PAR, RFC 7591/7592 dynamic registration, RFC 9101 JAR, RFC 9396 RAR, RFC 8693 token exchange, RFC 7523 client assertions | `compliance_rfc8628`, `device_flow`, `compliance_wave3`–`wave6`, `security_token_exchange_expiry` |
| v0.5 sender-constrained | `sender-constrained` | RFC 9449 DPoP (ath, nonce, jti replay), RFC 8705 mTLS, remaining RFC 9700 controls, rate limiting | `dpop_ath_replay`, `rfc9700_dpop_nonce`, `rfc9700_rate_limit`, `rfc9700_compliance` |
| v0.6 operations | `operations`, optional `admin-api` | `operations`: health/ready/metrics, social login against a mock IdP, persistence: every single-use/replay guarantee holds across replicas and restarts. `admin-api` (optional): Admin API + RBAC + paging + denylist + audit | `admin_*`, `metrics_*`, `storage_contract_sqlx`, `migrations_postgres`, `integration` |
| v0.7 agent | `agent` | Agent/A2A extensions: token exchange for agents, JWT bearer, OBO consent, workload identity, transaction tokens, trusted issuers, CIMD, resource registry | `agent_*` |
| v1.0 parity | all | All profiles stable; all four implementations pass with only reviewed deviations; behavioral gates adopted from the research spike (model-based, concurrency, differential) | — |

Out of contract scope (implementation choices, not wire behavior): storage engine choice (Postgres/Mongo/SQLite), tracing backend, UI look and feel. Ports may differ there freely.

## Flow per milestone

1. **Contract card** writes requirements (stable IDs, MUST/SHOULD, clause links), scenarios and invariants for the profile, extends the runner/SUT interface only as needed, and validates against Rust and Python. Scenarios that fail on the reference are either a contract bug or a recorded `reference-deviation` with a Rust fix card.
2. When the profile's scenarios are `stable` on `main`, ports may pin that contract **commit** in `conformance.yaml` and start; they do not wait for a tagged release. `contract:` is either a tagged semver (`0.1.0`) or, before that tag exists, the full 40-hex commit SHA on `main` (see `examples/conformance-commit.yaml`). Tagged releases (OCI image, Action, npm) are cut at milestone boundaries with owner approval.
3. **Port cards** (one per implementation per milestone) add the profile to `conformance.yaml` claims and make it pass in CI, or record a reviewed deviation with an `until` milestone. Ports that lack the feature implement it; ports that have it fix whatever the contract finds.
4. A milestone closes when all four implementations claim the profile in CI on `main`.

Ordering: contract milestones are sequential. Ports run in parallel with each other and lag the contract by at most one milestone; within a repository one card runs at a time.

## Gates

- Contract changes, SUT test-mode interfaces, new security behavior, deviations and releases: owner review.
- Routine parity slices under an approved architecture: exact-head Copilot/independent review plus green conformance CI.
- Every PR: green CI on the exact head, completed review, no unresolved threads.

## Status

Status is generated, not hand-edited: see [`STATUS.md`](STATUS.md) for per-profile scenario counts (stable / reference-deviation / draft), MUST / MUST NOT requirement coverage, and the per-implementation x profile claim matrix. CI regenerates it (`pnpm conformance status --root .. --check`) and fails when the checked-in copy is stale.

All four ports (Rust reference, Python, TypeScript, Go) now claim `core`, `token-lifecycle`, `oidc-basic`, `extended-grants` and `sender-constrained` in their `conformance.yaml`, pinned to contract commit `985fef7`, and run the claimed profiles in their own CI. Port claims in `STATUS.md` are read from `docs/ports/*.yaml`, snapshots of each port's `conformance.yaml` on `main` (refresh them when a port bumps its pin). `status --reports DIR` can ingest runner JSON reports for pass/fail/deferred counts, but CI does not yet collect reports from the ports, so those counts stay blank until it does (follow-up).

The milestone notes below describe status **as of each contract milestone**, not current port readiness. For current scenario counts and port claims, use [`STATUS.md`](STATUS.md); claims alone do not establish passing results.

Contract v0.2 (`token-lifecycle`) is delivered: 31 scenarios (25 stable, 6 `reference-deviation`), 12 invariants, and the part-3/3 runner extensions (JWT header/payload captures, `$contains`/`$nonempty`/`$absent` matchers, expect-interpolation) are on `main` (see `docs/token-lifecycle-coverage.md`). Ports may now pin the contract commit and begin the v0.2 milestone; the two owner-gated gaps (`RFC7662-4-expiry-checked`, `RFC9700-2.2.2-public-refresh-rotated-or-bound`) remain documented deferrals rather than blockable failures.

Contract v0.3 (`oidc-basic`) part 3/3 runner extensions delivered: numeric matchers (`$gt`, `$lt`), array membership (`$includes`), `assert` step type with JWT payload `source`, session-mode control on `login-and-authorize` (`none`/`create`/`reuse`), `logout` helper, JWT array/object capture support. Scenarios updated with executable assertions where possible. At that milestone: 13 scenarios (5 stable, 8 draft), 19 invariants, 19 requirements. Then-remaining draft-to-stable blockers included cross-claim comparison (`iat` < `exp`), a signed-token fixture for logout hint, and deterministic user-claim seeding. At the time, Rust and Python did not claim `oidc-basic`; both now do (see [`STATUS.md`](STATUS.md) for current claims).

Contract v0.4 (`extended-grants`) part 2/3 delivered: 51 scenarios (all draft, none yet validated against a SUT), 51 invariants, coverage report (docs/extended-grants-coverage.md) and the part 3/3 runner/SUT gap list (docs/extended-grants-gaps.md). Scoped requirements amendments add RFC 8628 slow_down on too-fast polling and RFC 9126 expired request_uri rejection.

Contract v0.4 (`extended-grants`) part 3/3: `device-verify` helper and seeded `client-dev` delivered. At that milestone Rust measured manually: device 7 stable pass, 1 reference-deviation; the other 43 scenarios remained draft pending clock control, duplicate-key transport and JWT signing helpers (see `docs/extended-grants-gaps.md`). Rust had not yet claimed the profile in CI; it now does (current claims: [`STATUS.md`](STATUS.md)).

Contract v0.5 (`sender-constrained`) part 2/3 delivered: 35 draft scenarios (one per catalogued requirement), 35 `INV-SC-*` invariants, and `docs/sender-constrained-coverage.md` with the runner/SUT gap list (DPoP proof signing, nonce mode, clock control, mTLS transport, step repetition) for part 3/3.

Contract v0.5 (`sender-constrained`) part 3/3: `dpop-proof` runner helper delivered (no SUT interface change). At that milestone Rust measured manually: 7 DPoP scenarios `stable` and passing; 28 remained draft (see `docs/sender-constrained-coverage.md`). Rust had not yet claimed the profile in CI, and Python had no conformance-mode SUT interface. Both now claim `sender-constrained` (see [`STATUS.md`](STATUS.md) for current claims; the dashboard does not yet contain CI run results).
