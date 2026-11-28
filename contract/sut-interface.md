# SUT test-mode interface (contract v0.1)

What every server (system under test, SUT) must provide for the runner to exercise the `core` profile black-box. The runner never imports implementation code and never reads the SUT's database. This interface is test-mode only and must not exist in a production configuration.

The Rust reference implements it first, Python second; each is a scoped PR in its own repository. This document is the contract those PRs start from.

## 1. Conformance mode

- Enabled only by an explicit switch: `OAUTH2_CONFORMANCE_MODE=1` together with `OAUTH2_CONFORMANCE_SEED=/path/seed.yaml`.
- Everything below (seed loading, test login, readiness detail) exists only while conformance mode is on. With the mode off, the SUT must expose none of it.

## 2. Seed file

`OAUTH2_CONFORMANCE_SEED` points at a YAML (or JSON) file validated by [`schemas/seed.schema.json`](../schemas/seed.schema.json). Example: [`examples/seed.yaml`](../examples/seed.yaml).

- `issuer`: the issuer identifier the SUT advertises and puts in RFC 9207 `iss`. Must equal the externally reachable base URL the runner uses (no trailing-slash normalization by the SUT).
- `clients`: seeded clients. Confidential clients carry `client_secret` and a `client_secret_basic` or `client_secret_post` auth method; public clients set `public: true`, use method `none` and carry no secret. `redirect_uris` are registered verbatim; the SUT must not rewrite them.
- `users`: seeded resource owners with a username and password for the test login. `auto_approve_clients` lists client IDs for which consent is skipped.
- `signingKeys`: key IDs and algorithms the SUT must provision. The seed carries no private key material; the SUT generates or loads keys itself and publishes the public side.

### 2a. Seeded client JWKs (extended-grants, v0.5)

Additive, optional seed field; a port that does not implement `private_key_jwt` client auth or JAR request objects simply leaves it absent and is unaffected.

- A confidential client using `token_endpoint_auth_method: private_key_jwt` MUST also carry a `jwks` object: a public-only JWK set (RFC 7517) with a `keys` array (each key at minimum a `kty`, optionally `kid` and `alg`). The SUT uses these public keys to verify the client's signed assertions and JAR request objects.
- `jwks` holds **public key material only** — never a `d` (private) parameter. The seed never carries private keys. The runner produces the matching private key per run (its `client-assertion` / `request-object` signing helpers generate an ephemeral key and publish the public side for the scenario to copy into the seed); the SUT never needs, and must never accept, private key material from the seed.
- Keys are clearly labelled synthetic test fixtures and are valid only while conformance mode is on, like every other seeded credential.
- This field is additive: existing seeds without `jwks` remain valid, and `private_key_jwt` / JAR scenarios simply stay `draft` against a SUT that does not support them.

The seed is applied once at startup, before readiness. The runner does not mutate it afterwards. A SUT that cannot apply the seed completely must not become ready.

## 3. Non-interactive test login

The authorization endpoint must be drivable without a browser:

1. The runner sends `GET` on the authorization endpoint with the normal OAuth parameters.
2. If the user is unauthenticated, the SUT answers with its login step. The runner submits the seeded `username` and `password` as an `application/x-www-form-urlencoded` POST to the SUT's login form and keeps the session cookie.
3. For clients in the user's `auto_approve_clients`, consent is granted without a further prompt; for others the SUT shows its consent step, which the runner does not drive in v0.1 (such scenarios are `draft`).
4. The authorization response is the normal redirect to the registered `redirect_uri` (code, `state`, `iss`, or an error); the runner reads the `Location` header and does not follow it.

The test login must not change any protocol behavior the profile tests: error handling, redirect validation, PKCE and `iss` rules apply exactly as in normal operation. Only credential entry and consent are automated.


## 3a. Device-grant verification (extended-grants, v0.4)

Owner-gated SUT interface extension; all ports implementing `extended-grants` must provide it.

- Seed: client `client-dev` (`client_secret_basic`, grant `urn:ietf:params:oauth:grant-type:device_code`, secret `test-only-dev-secret`) is in `examples/seed.yaml`.
- Verification: after the non-interactive test login (section 3), the runner first sends `GET <verifyPath>?user_code=<code>` with the session cookie (a status >= 400 fails the step). It reads every `<input type="hidden" name=".." value="..">` the page emits (values HTML-unescaped), then POSTs `application/x-www-form-urlencoded` those fields plus `user_code` and `action` (`approve` or `deny`) to the device verification endpoint (default `/oauth/device/verify`) with the session cookie. Field names are not predefined: the runner echoes whatever the page provides. If the page has no hidden inputs, the POST carries exactly `user_code` and `action`. This is the runner's `device-verify` helper (`with.username`, `with.password`, `with.user_code`, optional `action`, `loginPath`, `verifyPath`). Conformance mode only.
- Still out of scope (scenarios stay `draft`): SUT clock control (`expired_token`, `slow_down` +5s increase), duplicate form keys, client-assertion/JAR signing, seeded client JWKs.

## 4. Readiness

- `GET /health` (or the SUT's documented equivalent, declared in `conformance.yaml`) returns `200` only after the seed is fully applied and the server accepts OAuth requests; before that it returns non-2xx or refuses connections.
- The runner polls readiness with a bounded timeout and fails the run, not the scenarios, if the SUT never becomes ready.

## 5. Fail-closed rules

- Conformance mode with a production profile (production environment name, production database or secrets config, non-test issuer policy) must abort startup with a clear error. It must never log a warning and continue.
- Missing, unreadable or schema-invalid seed while conformance mode is on: abort startup. No partial seed, no defaults.
- Seeded credentials (`client_secret`, `password`) are accepted only for the seeded identities and only while conformance mode is on; they are never valid in a normal-mode start.
- The test login is not reachable when conformance mode is off, and not reachable for users absent from the seed.
- Test-mode state is process-local to that run: no seed data persisted to a shared or production store.

## 6. Out of scope for v0.1

Clock control, admin/seed-reload endpoints, social login, sender-constrained tokens. Scenarios needing them stay `draft` until a later milestone extends this contract. Clock control, DPoP nonce mode, restart/multi-instance and mTLS are now specified, as optional capabilities, in section 7 (SUT interface v2).

## 7. SUT interface v2: optional capabilities

Additive and owner-gated. A SUT that implements none of this is still a valid v1 SUT; scenarios needing a capability it does not advertise stay `draft`/deferred. **Each capability is independent**: implement and advertise only what you support. Nothing here applies outside conformance mode (section 1); the fail-closed rules of section 5 cover every item below.

### 7.1 Advertisement

`GET /conformance/capabilities` returns `200` JSON validated by [`schemas/sut-capabilities.schema.json`](../schemas/sut-capabilities.schema.json):

```json
{ "interface_version": 2, "capabilities": ["test-clock", "dpop-nonce-mode", "restart", "multi-instance", "mtls", "storage-fault", "provider-base-url-configurable"],
  "mtls": { "base_url": "https://127.0.0.1:8443" },
  "instances": ["http://127.0.0.1:8081", "http://127.0.0.1:8082"] }
```

`mtls` is required exactly when `mtls` is advertised, `instances` (at least two) exactly when `multi-instance` is. With conformance mode off the path is `404`, like every other `/conformance/*` path. `storage-fault` and `provider-base-url-configurable` (sections 7.9 and 7.10) need no companion fields: the former is a SUT control endpoint, the latter is an advertised promise about conformance-mode configuration. The **runner-owned** mock IdP in section 7.10 is harness configuration, not a SUT capability and never an advertisement.

The advertisement tells a **scenario author** which capabilities a SUT claims; it is not enforced by the runner. The runner does not read `/conformance/capabilities` and does not cross-check the advertised `instances`/`mtls.base_url` against `--sut-config`. What the runner actually verifies is narrower: a helper whose harness configuration (`--sut-config`) is absent throws (section 7.7), and `advance-clock` requires a `2xx` from the SUT. Advertised capabilities and harness configuration are two independent claims; a mismatch between them is not detected by the runner. Do not rely on the advertisement alone as proof that a scenario can run or that a capability works.

### 7.2 `test-clock`

- `POST /conformance/clock` with `{"advance_seconds": N}` (integer, `0 <= N <= 31536000`) moves the SUT's notion of "now" forward by `N` seconds, cumulatively, for **every** time-dependent decision: token/code/`device_code`/`request_uri` expiry, `expires_in`-derived values, RFC 8628 polling `interval`/`slow_down`, the DPoP `iat` acceptance window, OIDC `auth_time`/`max_age`. Answers `200` `{"now": <epoch seconds>}`.
- The clock is monotonic: it cannot be set backwards or reset except by restarting the process. Anything else (`N` negative, fractional, missing) is `400`.
- Time moves only when advanced: the SUT clock is real time plus the accumulated offset, so scenarios stay deterministic as long as they advance by amounts well above real elapsed time.
- Issued timestamps (`iat`, `exp`) reflect the advanced clock, and relative lifetimes are computed from it.
- The offset is **process-local**. Runner side, `advance-clock` posts only to the primary `--base-url` (it has no `instance` option), so it advances only that process. Scenarios that combine `test-clock` with `multi-instance` (for example, expiry observed on another instance) are **unsupported**: the instances' clocks would diverge. Such scenarios must not be written or promoted.
- Runner input: `with.seconds` is an integer or a string of ASCII decimal digits (after `{{var}}` interpolation). Blank, whitespace-padded, signed, fractional, or non-decimal values (`1e3`, `0x10`) are rejected before any request is sent.

### 7.3 `dpop-nonce-mode` (RFC 9449 sections 8 and 9)

- `POST /conformance/dpop-nonce` with `{"required": true|false}` toggles server-provided nonces for both the token endpoint and resource requests; answers `200` `{"required": <bool>}`. Default is `false` (no nonce required).
- While `true`, a DPoP proof without a valid `nonce` claim is rejected exactly as RFC 9449 prescribes (`use_dpop_nonce` error at the token endpoint, `WWW-Authenticate: DPoP error="use_dpop_nonce"` at resource servers) with a fresh `DPoP-Nonce` response header; a proof carrying that nonce is accepted. Nonce values are opaque; the runner reads them from the header.

### 7.4 `restart`

- The **harness**, not the SUT, restarts the process. The SUT provides no endpoint; it must keep durable state (codes, grants, tokens, refresh families, replay records) across a restart of its own process, and must be ready (section 4) afterwards with the same seed re-applied idempotently.
- Process-local conformance state is exempt: the test clock offset and the DPoP nonce toggle reset on restart.
- Runner side: `use: sut-restart` runs the program configured in the harness's `--sut-config` (`restart.command`, executed directly without a shell, with `OAUTH2_CONFORMANCE_BASE_URL` in its environment). The command **must return only after the old process has exited**: the runner starts readiness polling after the command exits and does not first observe not-ready, so a command that returns early could let the old process answer `/health`. The runner then polls `restart.readyPath` (default `/health`) until `2xx`. A scenario can never choose the command.

### 7.5 `multi-instance`

- Several SUT processes share one durable store and one seed and are individually addressable at the advertised `instances` origins. The primary `--base-url` is one of them. Process-local state (test clock, DPoP nonce toggle) is per instance and the runner drives it on the primary only; do not combine those with multi-instance assertions. Used for replay across instances and persistence checks.
- Runner side: `use: request-on-instance` with `with.instance` (a name from `--sut-config` `instances`) plus `method`, `path`, `query`, `headers`, and `form` or `json`; values may use `{{var}}`.

### 7.6 `mtls` (RFC 8705)

- The SUT exposes a TLS listener at `mtls.base_url` that **requests but does not require** a client certificate (so a no-cert negative case is observable). Client certificates are validated against the seed's `mtls.client_ca` (a public CA certificate; the seed never carries private keys). Clients with `token_endpoint_auth_method: tls_client_auth` carry `tls_client_auth_subject_dn`; `tls_client_certificate_bound_access_tokens: true` binds issued tokens to the presented certificate via `cnf` `x5t#S256` (the base64url SHA-256 of the DER certificate, no padding).
- The SUT's server certificate and the client certificates/keys are harness-provisioned test fixtures. The runner holds the client private keys (`--sut-config` `mtls.clients`); the runner never writes them to a report and the SUT never receives one.
- Runner side: `use: mtls-request` with `with.cert` (a configured client certificate name; omit to connect without one) plus the same request fields as `request-on-instance`; the server is verified against `mtls.caFile`. `use: x5t-s256` with `with.cert` or `with.pem` returns `{ "x5t_s256": ... }` for comparison with a token's `cnf` claim.

### 7.7 Runner configuration (`--sut-config FILE`, JSON or YAML)

```yaml
instances: { a: http://127.0.0.1:8081, b: http://127.0.0.1:8082 }   # origins only
restart: { command: ./restart.sh, readyPath: /health, readyTimeoutMs: 60000 }
mtls:
  baseUrl: https://127.0.0.1:8443
  caFile: server-ca.pem
  clients: { client-mtls: { certFile: client.pem, keyFile: client.key } }
mockIdp:
  origin: http://127.0.0.1:8098   # runner-owned listener for section 7.10
metrics:
  requestsTotal: oauth2_server_http_requests_total
  requestsByStatusClass: oauth2_server_http_requests_by_class_total
  statusClassLabel: status_class
  successStatusClass: '2xx'
  durationBucket: oauth2_server_http_request_duration_seconds_bucket
  durationCount: oauth2_server_http_request_duration_seconds_count
  failedAuthentications: oauth2_server_oauth_failed_authentications
```

Unknown keys are rejected. Relative paths resolve against the config file's directory. A helper whose capability is not configured in `--sut-config` (`sut-restart`, `request-on-instance`, `mtls-request`) throws, so the scenario fails (stable) or defers (draft) instead of passing vacuously. `advance-clock` itself requires a `2xx` from the SUT and throws otherwise.

The optional `metrics` map supplies Prometheus exposition family names to the operations §3.3 scenarios. The contract defines metric *behaviour* (a status-class counter, a duration histogram, a failed-authentication counter) but not the exported names, so scenarios reference semantic keys as `{{metrics.<key>}}` and each port supplies its own values. Unconfigured keys fail closed as unbound variables; family and label names are validated against Prometheus identifier grammars. See `reference/rust-operations-metrics.yaml` for the Rust reference mapping.

### 7.8 OIDC logout registration and the runner's receiver (oidc-basic)

Additive and optional. Seed clients may carry (public values only; see [`schemas/seed.schema.json`](../schemas/seed.schema.json)): `post_logout_redirect_uris` (array), `backchannel_logout_uri`, `backchannel_logout_session_required`, `frontchannel_logout_uri`, `frontchannel_logout_session_required`. Every URI is `http`/`https` with no fragment. A SUT that applies the seed must either honour these fields or refuse to start; it must not silently drop them. The fixture is [`examples/seed-logout.yaml`](../examples/seed-logout.yaml), kept separate from `examples/seed.yaml` so ports that do not yet accept the fields keep loading the core seed.

- The logout endpoint is `GET /oauth/logout` (`id_token_hint`, `post_logout_redirect_uri`, `state`).
- Back-channel: the SUT POSTs `application/x-www-form-urlencoded` `logout_token=<JWT>` to the client's `backchannel_logout_uri`. The **runner** owns the receiver: `--sut-config` `logoutReceiver: { origin: http://127.0.0.1:8099, path: /backchannel-logout }` (loopback `http` origin only, unknown keys rejected). The runner binds that fixed origin for the run; the seed must register the same URI. `use: read-logout-token` (`with.waitMs`, default 5000, max 60000) returns `{ "logout_token": ... }` for the next captured POST, or throws on timeout. Non-form posts get `415`, posts without `logout_token` get `400`, and neither is ever exposed as evidence. Unconfigured, the helper throws.
- Front-channel: capture the logout page with `capture: { page: text.body }` (new capture source: raw non-JSON response text), then `use: frontchannel-capture` with `with.body: "{{page}}"` returns `{ "iframe_srcs": [...] }` (http(s) iframe `src` values, entities decoded).
- Seed material is synthetic and valid only in conformance mode; the seed never carries private keys.

### 7.9 `storage-fault` (operations §3 readiness)

- `POST /conformance/storage-fault` with `{"enabled": true|false}` makes the SUT's storage health check fail while enabled (`true`) and restores it (`false`); answers `200` `{"enabled": <bool>}`. Default is `false`. Missing, non-boolean or malformed input is `400` and changes nothing.
- The injected failure is observed by the SUT's **own** readiness probe: `GET /ready` (or the documented equivalent declared in `conformance.yaml`) answers `503` with a storage-unhealthy body while the fault is enabled. The runner never fabricates readiness; it only toggles the fault and reads the answer. `GET /health` stays `200` so the runner's restart readiness polling remains usable (section 7.4).
- Conformance mode only: outside it the path is `404`, exactly like the other `/conformance/*` controls. The toggle is process-local and resets on restart (section 7.4). With `multi-instance`, it applies only to the addressed instance.
- Runner side: `use: storage-fault` with `with.enabled` (a boolean, or a `{{var}}` resolving to `true`/`false`) and optional `with.path` (default `/conformance/storage-fault`). A non-boolean value is rejected before any request; a non-2xx answer throws, so a SUT that does not offer the capability cannot make the scenario pass. The capability is a SUT endpoint, not a harness command: this keeps the semantics in the SUT, makes the same scenario portable across all four ports, and avoids letting a harness-side command fake the readiness result.
- Scenarios that enable the fault should disable it in a later step (or rely on process restart) so later scenarios in the same run see a healthy store.

### 7.10 Runner-owned mock IdP (operations §4 social login)

- `--sut-config mockIdp: { origin: http://127.0.0.1:<port> }` binds a **runner-owned, loopback-only** synthetic identity provider for the run. `https`, non-loopback hosts, paths and unknown keys are rejected; the listener is closed when the run ends. No live identity provider is contacted and no real credential is used.
- The runner owns these endpoints (all synthetic, conformance-only):
  - `GET /authorize?state=…&redirect_uri=…[&code_challenge=…&code_challenge_method=S256]` answers `302` to **`redirect_uri` only when it is a loopback `http(s)` URI**, carrying a single-use `code` bound to `state`/`redirect_uri`/optional S256 challenge. Missing `state`, an external `redirect_uri` or an unsupported challenge method is `400` and issues no code.
  - `POST /token` (`application/x-www-form-urlencoded`) with `grant_type=authorization_code`, `code`, optional `redirect_uri` and S256 `code_verifier` answers `200` with a synthetic bearer access token; replayed codes and PKCE mismatches get `400` `invalid_grant`. A failed PKCE check does not consume the code.
  - `GET /userinfo` with the synthetic bearer token answers `200` with synthetic claims (`sub`, `email`, `email_verified`, `name`); missing/invalid tokens get `401`.
- Runner helper `use: mock-idp-authorize` with `with.location` (the SUT's captured login redirect, interpolated) follows **exactly one** redirect with `redirect: 'manual'` and returns the actual `302` response so the scenario captures `redirect.query.code` and `state` and replays the callback itself. It refuses a location that is not an absolute URL on the configured mock IdP origin, and throws when no `mockIdp` is configured. The helper never contacts the SUT callback.
- SUT side: a SUT that advertises `provider-base-url-configurable` accepts conformance-mode configuration pointing a social provider's authorize/token/userinfo base URLs at the configured mock IdP origin, and completes the code exchange against it using only the synthetic values it returns. The provider origin must never be hard-coded to a live provider in conformance mode once this capability is advertised. This is the capability the full round-trip scenario needs; a SUT without it stays `draft`/deferred.

No scenario is promoted by this contract: the SUT-side implementations are separate port work, and a scenario becomes `stable` only after it passes on a SUT that advertises the capability it uses.
