# Rust reference capability inventory

Maps what `ianlintner/rust-oauth2-server` ships to contract requirement IDs, so
every port has a target for everything the reference does.

- Source: `rust-oauth2-server` `origin/main` @ `f95ab2cca98dfe5a2404c99cd29b252c15c2e77c`,
  read with `git show` / `git grep` (no checkout). Route table: `reference/rust-routes.yaml`
  (pinned at f6206d8; the route list was re-checked against `crates/oauth2-server/src/lib.rs` at f95ab2c).
- Compiled by hand from route registration, handler files and the 63 test files
  (`tests/*.rs`, `crates/*/tests/*.rs`); it is **not** machine generated. Re-derive
  when the pinned SHA moves. A capability is "covered" when a requirement ID exists,
  not when a stable scenario exists (see `docs/STATUS.md` for scenario coverage).
- Rows tagged **NEW** are requirements added by contract v0.7 (this slice). Rows tagged
  **GAP** have no requirement; each is classified in the last table.

## 1. Core OAuth2 / OIDC surface

| Rust capability (handler) | Rust tests | Requirement IDs |
|---|---|---|
| `GET /oauth/authorize`, code flow, state, redirect matching (`oauth.rs`) | compliance_rfc6749, rfc_compliance, phase2_rfc_compliance | `RFC6749-*` (rfc6749-core) |
| `POST /oauth/token` code, client_credentials, refresh (`oauth.rs`, `token.rs`) | compliance_rfc6749, conformance_token_lifecycle | `RFC6749-*` (rfc6749-token-lifecycle), `RFC9700-4.14.2-*` |
| PKCE S256, plain rejected (`oauth.rs`) | compliance_rfc7636 | `RFC7636-*` |
| Bearer use, `WWW-Authenticate` (`token.rs`) | compliance_rfc6750 | `RFC6750-*` |
| Introspection, revocation (`token.rs`) | compliance_rfc7662_7009, rfc9700_introspection_pii | `RFC7662-*`, `RFC7009-*` |
| AS metadata, JWKS (`wellknown.rs`) | compliance_rfc8414 | `RFC8414-*`, `RFC7517-5-jwks-keys-array` |
| ID token, UserInfo, nonce, prompt, max_age (`oauth.rs`, `profile.rs`) | compliance_oidc_core | `OIDC-*`, `OIDCDISC-3-userinfo-endpoint` |
| JWT access tokens (`token.rs`) | phase2_rfc_compliance | `RFC9068-*` |
| `iss` in authorization response | compliance_wave* | `RFC9207-2-*`, `RFC9207-2.3-*` |
| PAR `POST /oauth/par` | compliance_wave* | `RFC9126-*` |
| JAR request objects | compliance_wave* | `RFC9101-*` |
| RAR `authorization_details` | compliance_wave* | `RFC9396-*` |
| Device grant (`device.rs`) | rfc8628, device_flow | `RFC8628-*` |
| Token exchange (`token_exchange.rs`) | agent_token_exchange, security_token_exchange_expiry | `RFC8693-*` |
| JWT bearer grant (`jwt_bearer.rs`) | agent_jwt_bearer_grant | `RFC7523-*` |
| DPoP incl. nonce, ath, replay (`dpop*.rs`) | dpop_ath_replay, rfc9700_dpop_nonce | `RFC9449-*` |
| mTLS-bound tokens | rfc9700_compliance | `RFC8705-*` |
| Dynamic client registration + management (`client.rs`) | agent_client_columns | `RFC7591-*`, `RFC7592-*` |
| Native app loopback / private-use scheme | rfc8252_native_apps | `RFC8252-*` |
| BCP: code replay, HTTPS, state, rate limit, jti replay, ROPC/implicit off | rfc9700_* (9 files) | `RFC9700-*` |

## 2. Capabilities the v0.7 catalog adds

| Rust capability | Rust evidence | New requirement IDs |
|---|---|---|
| `resource` parameter on authorize/token, per-client resource registry, `invalid_target` | `oauth.rs:802,1741`, `jwt_bearer.rs:218`, `token_exchange.rs:969`, `admin_resources.rs`, agent_resources_registry | **NEW** `RFC8707-*` (profile `resource`) |
| `/.well-known/oauth-protected-resource[/{id}]` | `lib.rs` route table | **NEW** `RFC9728-*` (`resource`) |
| `application/token-introspection+jwt` response, `typ` header | `token.rs:459-513` | **NEW** `RFC9701-*` (`resource`) |
| `acr_values` honoured on authorize, step-up TAC family | `oauth.rs:495,806,1247`, agent_tac | **NEW** `RFC9470-*` (`resource`) |
| `alg` allow-lists, `typ` checks, `alg none` rejection in verifiers | `jsonwebtoken::Validation` use in `oidc_logout.rs`, `jwt_bearer.rs`, `dpop.rs`; security_http | **NEW** `RFC8725-*` (`hardening`) |
| Key rotation with grace period (`POST /admin/api/keys/rotate`, `grace_period_hours`) | `admin_keys.rs`, admin_extra | **NEW** `RFC7517-*` rotation set (`hardening`); extends existing `RFC7517-4.5-jwks-rollover-overlap` |
| RP-Initiated Logout `GET /oauth/logout`, registered `post_logout_redirect_uri`, `id_token_hint` | `oidc_logout.rs:21-60,263-330,383` | existing `RPINIT-2-logout-id-token-hint-aud`; **NEW** `RPINIT-2-*` (`oidc-basic`) |
| Back-Channel Logout token + POST to `backchannel_logout_uri`, `sid` | `oidc_logout.rs:81-180` | **NEW** `BCL-*` (`oidc-basic`) |
| Front-Channel Logout iframes with `iss`/`sid` | `oidc_logout.rs:183-243` | **NEW** `FCL-*` (`oidc-basic`) |
| Mix-up defence beyond `iss` value | `oauth.rs` redirect handling, `wellknown.rs` | **NEW** `RFC9207-3-*`, `RFC9700-4.4*` (`hardening`) |
| FAPI 2.0 server-side delta (PAR required, 60s codes, sender-constrained only, PS256/ES256/EdDSA) | partly via rfc9700_*, dpop tests | **NEW** `FAPI2-*` (`fapi2`, optional) |

## 3. Operations / admin

| Rust capability | Rust tests | Requirement IDs |
|---|---|---|
| `/health`, `/ready`, `/metrics`, `/events/*` | metrics_wiring, metrics_paved_path_baseline, conformance_mode | `OPS-3.*` |
| Social login callbacks `/auth/login/*`, `/auth/callback/{provider}` | integration | `OPS-4.*` |
| Persistence across replicas/restarts | storage_contract_sqlx, migrations_postgres, mongo_storage, storage_factory | `OPS-5.*` |
| `/admin/api/*`, RBAC, paging, denylist, audit | admin_extra, admin_rbac, admin_paging, admin_denylist_middleware, admin_storage_contract | `ADMIN-*` (profile `admin-api`) |

## 4. Gaps: Rust capability with no requirement

Every remaining Rust capability is listed here with a classification. Nothing is
unexplained.

| # | Rust capability | Evidence | Classification | Disposition |
|---|---|---|---|---|
| G1 | Agent identity: CIMD client metadata documents, `agent_discovery` | agent_cimd_flow (16), agent_discovery (18) | Vendor/draft extension | Out of scope; `docs/out-of-scope.md` |
| G2 | Agent identity: ID-JAG issue/consume, trusted issuers registry | agent_id_jag_issue (19), agent_trusted_issuers (4), `id_jag.rs` | IETF draft | Out of scope |
| G3 | Agent workload identity (SPIFFE-style) | agent_workload_identity (25), `agent_*` | Draft/vendor | Out of scope |
| G4 | Transaction tokens (`txn_token.rs`) | agent_txn_tokens (24) | IETF draft | Out of scope |
| G5 | Transaction Authorization Code, `/oauth/transaction_authorization*` | agent_tac (17), `transaction_authorization.rs` | Vendor extension | Out of scope |
| G6 | OBO consent for delegated agent tokens | agent_obo_consent (10) | Vendor extension | Out of scope |
| G7 | `GET /oauth/check_session` (OIDC Session Management 1.0) | `lib.rs` | Deprecated spec | Out of scope |
| G8 | OpenTelemetry tracing and outbound propagation | otel_* (5 files) | Implementation internals | Not a protocol contract; `OPS-3.3` covers observable metrics only |
| G9 | Password hash algorithm choice | password_hash | Implementation internals | `ADMIN-2.3-user-create-201-password-hashed` covers the observable effect |
| G10 | Opaque vs JWT token format switch | opaque_tokens | Covered | `RFC6749-1.4-opaque-access-token`, `RFC9068-*` |
| G11 | Swagger UI, static assets, `/profile`, `/error` pages | route table | Non-protocol UI | Not contracted |
| G12 | Per-IP rate limiting | rfc9700_rate_limit | Covered, policy-gated | `RFC9700-2.5-*-policy` |
| G13 | Social login providers Okta/Auth0 (503 stub) | route table | Not implemented in reference | Not contracted |
| G14 | `/.well-known/oauth-authorization-server/status` | route table | Vendor endpoint | Not contracted; revisit with `OPS-3.*` |
| G15 | Unit and BDD harness tests (`unit_tests`, `bdd`, `common`) | tests/ | Test infrastructure | Not a capability |

Known reference limits worth tracking (from `wellknown.rs`/`admin_keys.rs` at f95ab2c):
the id token alg list advertises RS256 by default and key rotation defaults to RS256,
so the FAPI2 algorithm requirements (`FAPI2-5.4.1-*`) are expected to fail against the
reference until it gains PS256/ES256/EdDSA. That is a finding to record when scenarios land, not a reason to drop the requirement.

## 5. Residual

- Scenarios for all NEW IDs (requirements only in this slice).
- Re-verify rows in section 2 against exact line numbers when writing scenarios.
- Decide whether G14 and the agent family (G1-G6) deserve a future `agents` profile.
