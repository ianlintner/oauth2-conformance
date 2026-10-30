# Operations profile surface (contract v0.6)

Normative surface definition for two profiles:

- `operations` (sections 3 to 5): liveness, readiness and metrics, social login
  security, and persistence across replicas and restarts. Requirements are in
  `requirements/operations-runtime.yaml` and `requirements/operations-persistence.yaml`.
- `admin-api` (section 2): the optional admin JSON surface. A server may claim
  `operations` without exposing it. Requirements are in `requirements/admin-api.yaml`.

This document is the clause text the requirements cite (via the `clause` and
`link` fields) and that `profiles/operations.yaml` and `profiles/admin-api.yaml`
list. Within `admin-api`, operational and security properties are MUST; shapes
that only mirror the reference product (exact capability and dashboard keys,
audit action names, the console redirect) are SHOULD.

## 1. Scope and provenance

The operations surface is the wire behavior a server must expose to be operable
and to be verified by the `operations` profile. It is defined by this contract,
not by an RFC: no standard specifies an administrative API. Where a clause
restates behavior that an RFC also requires, the RFC clause is named in the
requirement's `notes`.

**Provenance.** The reference implementation `rust-oauth2-server` was read at
`origin/main` when this catalog was written; the artifacts below are evidence
for the clauses, not authority over them.

| Area | Reference evidence |
|---|---|
| Admin guard and RBAC | `crates/oauth2-actix/src/middleware/admin_guard.rs` |
| Admin JSON API | `crates/oauth2-actix/src/handlers/admin.rs`, `crates/oauth2-actix/src/handlers/admin_extra.rs`, router in `crates/oauth2-server/src/lib.rs` |
| Admin behavior tests | `tests/admin_rbac.rs`, `tests/admin_extra.rs`, `tests/admin_paging.rs`, `tests/admin_denylist_middleware.rs`, `tests/admin_storage_contract.rs` |
| Liveness, readiness, metrics | `crates/oauth2-actix/src/handlers/admin.rs`, `crates/oauth2-observability/src/metrics.rs`, `tests/metrics_wiring.rs`, `tests/metrics_paved_path_baseline.rs` |
| Social login | `crates/oauth2-social-login/src/handlers/auth.rs` |
| Persistence across replicas and restarts | `tests/common/mod.rs` (`run_storage_contract`), `tests/storage_contract_sqlx.rs`, `tests/migrations_postgres.rs`, `tests/integration.rs` |

**Out of scope.** Storage engine choice, tracing backend, dashboard UI framework
and deployment topology are implementation choices, per `docs/ROADMAP.md`.

**Conventions.** Paths are relative to the server base URL. Request and response
bodies are `application/json` unless stated otherwise. `302` is a redirect the
user agent follows. Error bodies are JSON objects with a stable, machine-readable
`error` member.

## 2. Admin API

This section is the optional `admin-api` profile. The admin console is an HTML
surface under `/admin/...`; the JSON API is under `/admin/api/...`. Both sit
behind the same guard.

### 2.1 Authentication and RBAC

- A JSON API request (under `/admin/api`) that presents neither an admin session
  nor an admin bearer token is not served: the server answers `401` with a
  `WWW-Authenticate: Bearer` challenge (RFC 6750 section 3). It does not redirect.
- An unauthenticated request to the HTML console SHOULD be answered with a `302`
  redirect to the login page rather than returning admin content.
- A request that presents an authenticated session without the admin role is
  rejected with `403` and `{"error":"insufficient_permissions"}`.
- A bearer token is admin only when it both carries the `admin` scope and was
  issued to a client the operator has explicitly allow-listed for admin use.
  The allow-list is fail-closed: when it is unset, no bearer token is admin.
- A request that presents a valid bearer token without the `admin` scope is
  rejected with `403` and `{"error":"insufficient_scope"}`.
- A request that presents an invalid or expired bearer token is rejected with
  `401` and `{"error":"invalid_token"}`.
- A request that presents an admin session, or an allow-listed bearer token
  carrying the `admin` scope, reaches the handler.
- The admin session cookie is set with `Secure`, `HttpOnly` and `SameSite=Lax`
  or `SameSite=Strict`. `Secure` may be omitted only for a loopback HTTP
  deployment used in local conformance runs.
- A state-changing request (`POST`, `PUT`, `PATCH`, `DELETE`) authenticated by an
  admin session is rejected with `403` unless it carries a valid CSRF defence:
  an anti-CSRF token, or an `Origin` or `Fetch-Metadata` check proving a
  same-origin request. The error code is implementation-defined. Requests
  authenticated by a bearer token are not ambient credentials and are exempt.

### 2.2 Paging and listing

- Every admin list endpoint returns a page envelope with `items` (the page
  slice), `total` (the unpaged count), `limit` and `offset`.
- The `limit` and `offset` query parameters select the returned slice; the final
  page carries the remainder.
- A list endpoint over an empty collection returns `200` with `items: []` and
  `total: 0`.
- A `search` query parameter filters a listing by name where the resource has
  one.
- A detail endpoint addressed with an unknown id returns `404`.

### 2.3 User administration

`/admin/api/users`

- `POST` creates a user, returns `201` with the created record, and stores the
  submitted password only as a hash.
- A creation missing a required field is rejected with `400`
  `{"error":"invalid_request"}`; a duplicate username is rejected with `409`
  `{"error":"already_exists"}`.
- `PUT /users/{id}` applies only the supplied fields and rejects an unknown id
  with `404`.
- An unrecognised `role` value in an update is rejected with `400`
  `{"error":"invalid_request"}` and the stored role is unchanged. This matches
  `POST /users/{id}/role`; an unknown role is never silently ignored.
- `DELETE /users/{id}` removes the user and revokes that user's tokens.
- `POST /users/{id}/enabled` toggles the enabled flag; disabling revokes that
  user's tokens.
- `POST /users/{id}/role` sets a known role and rejects an unknown role with
  `400` `invalid_request`.
- `POST /users/{id}/password` replaces the stored hash, revokes that user's
  tokens, and rejects a weak password with `400`.

### 2.4 Client administration

`/admin/api/clients`

- `POST` creates a client and returns `201`. A confidential client's secret is
  returned once, in the creation response, and never again; a public client is
  created without a secret.
- A creation with an empty name is rejected with `400`.
- `PUT /clients/{id}` applies only the supplied fields and rejects an unknown id
  with `404`.
- `POST /clients/{id}/enabled` toggles the enabled flag; disabling revokes the
  client's tokens.
- `POST /clients/{id}/regenerate-secret` issues a new secret; the new secret is
  the one that authenticates afterwards. Regenerating a secret for a client that
  has none is rejected with `400` `invalid_request`.

### 2.5 Token administration

`/admin/api/tokens`

- `GET` lists tokens with the section 2.2 envelope; `GET /tokens/{id}` returns
  one token or `404`.
- Token list and detail responses MUST NOT expose raw access or refresh token
  values, client secrets or other credentials. Tokens are identified by an
  opaque id and metadata only.
- `POST /tokens/{id}/revoke` revokes one token.
- `POST /tokens/revoke-by-user` and `POST /tokens/revoke-by-client` revoke every
  token belonging to the named user or client, and affect no other client's or
  user's tokens.

### 2.6 Denylist

`/admin/api/denylist`

- An entry carries `kind`, `value`, an optional `reason`, an optional
  `expires_at`, and the identity of the acting admin.
- `kind` is one of `ip`, `user_id`, `username`, `email`, `client_id`; any other
  value is rejected with `400` `invalid_request`.
- `POST` records an entry and returns `201`. Adding an entry that already exists
  for the same (`kind`, `value`) replaces it rather than creating a duplicate,
  with the latest `reason` winning.
- `DELETE /denylist/{id}` removes the entry.
- A request whose client IP is denylisted is rejected with `403`
  `{"error":"access_denied"}` by middleware, before the handler runs; a request
  whose client IP is not denylisted reaches the handler. An entry whose
  `expires_at` has passed no longer blocks.
- A subject lookup by user id, username, email or client id returns the recorded
  reason; an empty subject value never matches an entry.

### 2.7 Audit log

`/admin/api/audit`

- Admin mutations record the acting admin identity and a stable machine-readable
  action name.
- Action names SHOULD follow the reference vocabulary: `user.create`,
  `user.update`, `user.delete`, `user.enable`, `user.disable`, `user.set_role`,
  `user.reset_password`, `client.create`, `client.update`, `client.enable`,
  `client.disable`, `client.regenerate_secret`, `denylist.add` and
  `denylist.remove`. A port may use other stable names.
- The audit log is listed newest-first with the section 2.2 envelope.
- A failure to write an audit entry MUST emit an error-level log record or
  increment an error metric, so a lost audit entry is observable.
- A failure to write an audit entry SHOULD NOT fail or roll back the admin
  action that triggered it (fail-open). This is a deliberate availability
  trade-off: a deployment that needs fail-closed auditing may reject the action
  instead, provided the failure is still signalled.

### 2.8 Capabilities

`/admin/api/capabilities` SHOULD report which optional admin features the
configured backend supports, as booleans: `events`, `device_flow`,
`key_rotation`, `user_crud`, `client_crud`, `denylist`, `audit_log` and
`bulk_revoke`. The key set mirrors the reference product and is not a MUST.

### 2.9 Dashboard

`/admin/api/dashboard` SHOULD return operator totals, including `total_clients`,
`total_users`, `active_tokens` and `pending_device_codes`. The exact key set is
not fixed.

## 3. Operational endpoints

Liveness, readiness and metrics are reachable without authentication.

### 3.1 Liveness

`/health` returns `200` with a status body identifying the service. It requires
no authentication and does not depend on the storage backend.

### 3.2 Readiness

`/ready` runs the storage backend health check. It returns `200` with
`{"status":"ready","checks":{"database":"ok"}}` when the check passes and `503`
when it fails.

When the server is configured for conformance, the body additionally carries a
`conformance` object reporting the seed state and the signing key identifiers, so
a harness can wait for the seed. It reports counts and identifiers only, never
credentials or key material.

### 3.3 Metrics

`/metrics` returns Prometheus text exposition format (`text/plain;
version=0.0.4`).

- A request counter is exported, labelled by response status class.
- A request duration histogram is observed for every request.
- Failed authentications (bad password, unknown user, bad client secret, bad
  refresh token) increment a dedicated counter.

### 3.4 Event ingest

Support for event ingest is optional and, where the `admin-api` profile is
offered, is reported by `/admin/api/capabilities` (section 2.8). When event ingest is enabled, the server
exposes a health endpoint for its ingest path reporting whether the path is
available.

## 4. Social login

`/auth/login/{provider}` and `/auth/callback/{provider}` implement the
authorization-code flow against an external identity provider used as a mock
identity provider in conformance runs.

### 4.1 Provider configuration

- The set of supported providers is implementation- and deployment-defined;
  the reference implements `google`, `microsoft`, `azure` and `github`.
- Provider endpoints SHOULD be configurable by base URL, so conformance runs
  can exercise the flow against a local mock identity provider without
  third-party credentials. This is a v0.6 contract target, not behavior already
  verified in the Rust reference: its current provider authorization and token
  URLs are hard-coded.
- Initiating login for a known provider with no configured credentials is
  rejected with `provider_not_configured`.

### 4.2 CSRF state binding

- Initiating login records an expected `state` value in the session and redirects
  the user agent to the provider's authorization endpoint with that `state`.
  Where supported by the provider, the redirect also carries a PKCE challenge.
- The callback requires a `state` matching the value recorded in the session. A
  missing `state` is rejected with `access_denied`; a mismatched `state` is
  rejected with `access_denied`.

### 4.3 Provider binding

- A callback whose `provider` path segment differs from the provider recorded in
  the session is rejected with `invalid_request`.
- A callback for a provider the server does not support is rejected with
  `invalid_request`.

### 4.4 Post-login redirect safety

- A post-login redirect target is validated before use; an unsafe target is
  replaced by a default destination rather than followed.

## 5. Persistence across replicas and restarts

Every single-use and replay guarantee the other profiles state for a single
server instance also holds when the deployment runs more than one replica and
when a process restarts. The underlying properties are RFC requirements
(RFC 6749 section 4.1.2 and RFC 9700 section 2.1.1 for authorization codes,
RFC 9700 section 4.14.2 for refresh token rotation, RFC 9449 section 11.1 for
DPoP proof replay); this section states the deployment conditions under which
the profile requires them to be observable.

### 5.1 Authorization codes

An authorization code redeemed on one replica is not redeemable on another, and
a code marked used before a restart is still marked used after it.

### 5.2 Refresh tokens

Refresh token rotation and reuse detection are visible to every replica: a
rotated refresh token is rejected by any replica, and a reused token revokes its
whole token family on every replica.

### 5.3 Revocation

A revocation performed on one replica takes effect on every replica for access
tokens, refresh tokens and introspection results.

### 5.4 Sender-constrained proofs

A DPoP proof consumed on one replica is rejected on every replica, and the replay
cache is not reset by a restart or instance replacement.

### 5.5 Single-use artifacts

Single-use artifacts the server issues - pushed authorization request URIs and
device authorization codes - are consumed exactly once across replicas.

## 6. Differences from current ports

The normative paths here are `/health` for liveness and `/ready` for readiness.
Some current ports differ (for example the Go port serves readiness on `/health`
and liveness on `/healthz`). Port cards should plan the rename; the difference
is a known coverage gap, not a reason to weaken the clause.
