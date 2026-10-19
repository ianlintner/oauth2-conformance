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
| v0.6 operations | `operations` | Admin API + RBAC + paging + denylist, health/ready/metrics, audit events, social login against a mock IdP, persistence: every single-use/replay guarantee holds across replicas and restarts | `admin_*`, `metrics_*`, `storage_contract_sqlx`, `migrations_postgres`, `integration` |
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

| Implementation | v0.1 | v0.2 | v0.3 | v0.4 | v0.5 | v0.6 | v0.7 |
|---|---|---|---|---|---|---|---|
| Rust (reference) | dev | — | — | — | — | — | — |
| Python | — | — | — | — | — | — | — |
| TypeScript | — | — | — | — | — | — | — |
| Go | — | — | — | — | — | — | — |

`—` not yet claimed · `pass` claimed and passing in CI on main · `dev` passing with recorded deviations.

Rust v0.1 is `dev`: measured manually against a freshly seeded SUT (core run: 33 pass, 0 fail, 8 reference deviations and 2 drafts deferred; see `docs/core-coverage.md`). CI does not yet start a SUT, so it is not `pass`. Python v0.1 is `—`: its repository has no conformance-mode SUT interface yet.

Contract v0.2 (`token-lifecycle`) is delivered: 31 scenarios (25 stable, 6 `reference-deviation`), 12 invariants, and the part-3/3 runner extensions (JWT header/payload captures, `$contains`/`$nonempty`/`$absent` matchers, expect-interpolation) are on `main` (see `docs/token-lifecycle-coverage.md`). Ports may now pin the contract commit and begin the v0.2 milestone; the two owner-gated gaps (`RFC7662-4-expiry-checked`, `RFC9700-2.2.2-public-refresh-rotated-or-bound`) remain documented deferrals rather than blockable failures.

Contract v0.3 (`oidc-basic`) part 3/3 runner extensions delivered: numeric matchers (`$gt`, `$lt`), array membership (`$includes`), `assert` step type with JWT payload `source`, session-mode control on `login-and-authorize` (`none`/`create`/`reuse`), `logout` helper, JWT array/object capture support. Scenarios updated with executable assertions where possible. 13 scenarios (5 stable, 8 draft), 19 invariants, 19 requirements. Remaining draft-to-stable blockers: cross-claim comparison (`iat` < `exp`), signed-token fixture for logout hint, seed with deterministic user claims, and SUT conformance.yaml claiming `oidc-basic`. Rust and Python SUTs do not yet claim `oidc-basic`; full validation requires SUT-side OIDC endpoints.

Contract v0.4 (`extended-grants`) part 2/3 delivered: 51 scenarios (4 stable, 47 draft), 51 invariants, coverage report (docs/extended-grants-coverage.md) and the part 3/3 runner/SUT gap list (docs/extended-grants-gaps.md). Scoped requirements amendments add RFC 8628 slow_down on too-fast polling and RFC 9126 expired request_uri rejection.
