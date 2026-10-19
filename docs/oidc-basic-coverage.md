# oidc-basic coverage (contract v0.3)

Scenarios live in `scenarios/oidc-basic/`, invariants in
`invariants/oidc-basic.yaml`. Every scenario cites requirement ids from
`requirements/oidc-core.yaml` (part 1/3).

## Scenario inventory

| Area | Scenario | Requirements | Status |
|---|---|---|---|
| id-token | with-openid-scope | OIDC-3.1.3.1-id-token-on-openid-scope (MUST) | stable |
| id-token | without-openid-scope | OIDC-3.1.3.1-no-id-token-without-openid-scope (MUST NOT) | stable |
| id-token | iss-matches-discovery | OIDC-2-id-token-compact-jwt, OIDC-2-id-token-iss (MUST) | stable |
| id-token | aud-iat-exp-nonce-claims | OIDC-2-id-token-aud, OIDC-2-id-token-iat-exp, OIDC-3.1.2.1-nonce-echoed (MUST) | draft |
| id-token | scope-claims | OIDC-5.4-id-token-scope-claims (SHOULD) | draft |
| userinfo | sub-matches-id-token | OIDC-2-id-token-sub, OIDC-5.3-userinfo-sub (MUST) | stable |
| userinfo | missing-token-401 | OIDC-5.3-userinfo-missing-token-401 (MUST) | stable |
| userinfo | email-profile-scope-claims | OIDC-5.4-userinfo-email-scope, OIDC-5.4-userinfo-profile-scope (SHOULD) | draft |
| userinfo | rejects-client-credentials-token | OIDC-5.3-userinfo-rejects-client-credentials-token (MAY) | draft |
| prompt | prompt-none-requires-login | OIDC-3.1.2.1-prompt-none-login-required (MUST) | draft |
| prompt | prompt-login-reauthenticates | OIDC-3.1.2.1-prompt-login-reauthenticates (SHOULD) | draft |
| prompt | max-age-and-auth-time | OIDC-3.1.2.1-max-age-reauthenticates, OIDC-3.1.2.1-auth-time-claim (MUST) | draft |
| logout | id-token-hint-aud | RPINIT-2-logout-id-token-hint-aud (MUST) | draft |

Coverage: 7 of 19 requirements `stable`, 12 `draft`, 0 uncovered. Every MUST /
MUST-NOT requirement has at least a draft scenario.

## Part 3/3 runner extensions (completed)

- **Numeric matchers**: `$gt` (greater-than) and `$lt` (less-than) for asserting
  numeric claims like `iat` and `exp` against known bounds.
- **Array/set membership**: `$includes` matcher for asserting `aud` contains a
  specific value whether it's a string or array.
- **Assert step**: a new `assert` step type with no HTTP request, running
  against capture scope variables. Uses `source: jwt.<var>.payload` to decode
  JWT payloads into assertion body (e.g. scope-claims). Supports all existing
  matchers including `$absent`, `$nonempty`, `$contains`, `$includes`, `$gt`,
  `$lt`.
- **Session control**: `login-and-authorize` now accepts `session: none` (fresh
  browser, no cookie), `session: create` (force fresh login), and
  `session: reuse` (must have saved session). Default behavior is cached reuse
  with fallback to fresh login.
- **Logout helper**: `use: logout` with optional `with.id_token_hint` drives
  RP-initiated logout.
- **JWT capture improvements**: `captureValue` now JSON-stringifies JWT array
  and object claims, enabling `aud` array capture and assertion.

## Remaining dependencies for `stable` promotion

| Scenario | Blocker |
|---|---|
| aud-iat-exp-nonce-claims | Needs `iat < exp` (cross-claim comparison, not just bound checks). The `$includes`/`$gt`/`$lt` matchers handle the individual assertions but ordering comparison across two captured values is not yet expressible. |
| scope-claims | Assert syntax is complete; needs a SUT that emits/strips claims by scope to validate. |
| prompt-none-requires-login | `session: none` mode implemented; scenario ready. Needs SUT with `prompt=none` support and a login page that can be detected. |
| prompt-login-reauthenticates | `session: create` forces fresh login; needs a second step comparing auth_time from two distinct sessions. |
| max-age-and-auth-time | `session: create` and numeric matchers implemented; needs `auth_time` claim decode + second-step comparison. |
| email-profile-scope-claims | Needs seed with deterministic user claims (storage-backed). |
| rejects-client-credentials-token | Needs SUT conformance.yaml claiming `oidc-basic` and a seed client_credentials client. |
| logout.id-token-hint-aud | Needs a signed-token fixture (runner signs or SUT provides a test key). |

## Invariants

`invariants/oidc-basic.yaml` names 19 invariants, one per `oidc-basic`
requirement. Like the core and token-lifecycle catalogs they are declarative;
the runner has no trace layer yet, so invariants are cited by scenario notes
rather than wired into trace checks.