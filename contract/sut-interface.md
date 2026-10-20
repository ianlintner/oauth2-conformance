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
- Verification: after the non-interactive test login (section 3), the runner POSTs `application/x-www-form-urlencoded` `user_code` and `action` (`approve` or `deny`) to the device verification endpoint (default `/oauth/device/verify`) with the session cookie. This is the runner's `device-verify` helper (`with.username`, `with.password`, `with.user_code`, optional `action`, `loginPath`, `verifyPath`). Conformance mode only.
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

Clock control, admin/seed-reload endpoints, social login, sender-constrained tokens. Scenarios needing them stay `draft` until a later milestone extends this contract.
