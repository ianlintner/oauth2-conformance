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
| id-token | aud-iat-exp-nonce-claims | OIDC-2-id-token-aud, OIDC-2-id-token-iat-exp, nonce echo (MUST, see `OIDC-3.1.2.1` in requirements) | stable |
| id-token | scope-claims | OIDC-5.4-id-token-scope-claims (SHOULD) | stable |
| userinfo | sub-matches-id-token | OIDC-2-id-token-sub, OIDC-5.3-userinfo-sub (MUST) | stable |
| userinfo | missing-token-401 | OIDC-5.3-userinfo-missing-token-401 (MUST) | stable |
| userinfo | email-profile-scope-claims | OIDC-5.4-userinfo-email-scope, OIDC-5.4-userinfo-profile-scope (SHOULD) | stable |
| userinfo | rejects-client-credentials-token | OIDC-5.3-userinfo-rejects-client-credentials-token (MAY) | stable |
| prompt | prompt-none-requires-login | OIDC-3.1.2.1-prompt-none-login-required (MUST) | stable |
| prompt | prompt-login-reauthenticates | OIDC-3.1.2.1-prompt-login-reauthenticates (SHOULD) | stable |
| prompt | max-age-and-auth-time | OIDC-3.1.2.1-max-age-reauthenticates, OIDC-3.1.2.1-auth-time-claim (MUST) | draft |
| logout | id-token-hint-aud | RPINIT-2-logout-id-token-hint-aud (MUST) | draft |

Coverage: 11 of 19 requirements `stable`, 2 `draft`, 0 uncovered. Every MUST /
MUST-NOT requirement has at least a draft scenario; the generated `STATUS.md`
reports 13 stable scenarios / 2 draft, and 11/30 (37%) MUST requirements with
a stable scenario (some scenarios cover multiple requirements, and some
requirements have no scenario at all).

## Runner extensions

- **Numeric matchers**: `$gt` (greater-than) and `$lt` (less-than) for asserting
  numeric claims like `iat` and `exp` against known bounds.
- **Cross-capture numeric matchers**: `$gtCapture` / `$ltCapture` compare two
  named captures from the runner scope (e.g. `iat < exp`) without JSONPath
  gymnastics; used by `aud-iat-exp-nonce-claims` and `max-age-and-auth-time`.
- **Array/set membership**: `$includes` matcher for asserting `aud` contains a
  specific value whether it's a string or array.
- **Assert step**: an `assert` step type with no HTTP request, running against
  capture scope variables. Uses `source: jwt.<var>.payload` to decode JWT
  payloads into assertion body. Supports all matchers including `$absent`,
  `$nonempty`, `$contains`, `$includes`, `$gt`, `$lt`, `$gtCapture`, `$ltCapture`.
- **Session control**: `login-and-authorize` accepts `session: none` (fresh
  browser, no cookie), `session: create` (force fresh login), and
  `session: reuse` (must have saved session). Default behavior is cached reuse
  with fallback to fresh login. The helper also follows SUT-provided post-login
  authorize redirects, which is required when the SUT strips one-shot params
  such as `prompt=login` or `max_age=0`.
- **Logout helper**: `use: logout` with optional `with.id_token_hint` drives
  RP-initiated logout.
- **JWT capture improvements**: `captureValue` now JSON-stringifies JWT array
  and object claims, enabling `aud` array capture and assertion.

## Remaining dependencies for `stable` promotion

| Scenario | Blocker |
|---|---|
| max-age-and-auth-time | Both reference SUTs omit `auth_time` when minting an id_token at code redemption, so the claim capture is unbound. Needs SUT-side fix to carry the session's auth_time through the code exchange. |
| logout.id-token-hint-aud | Needs a signed-token fixture (runner signs or SUT provides a test key) for the foreign-audience `id_token_hint`. |

### Cross-SUT note

`prompt-login-reauthenticates` is a two-step reauthentication proof: step 1
establishes a session with a plain authorize, step 2 reuses that cookie with
`prompt=login` and requires a fresh login redirect. A runner test loads the
published scenario against an honest SUT (pass) and a fake SUT that ignores
`prompt=login` (fail), so the scenario can catch the behavior it claims to
check.

Both reference SUTs pass this scenario at candidate head `1efb8ee` (seeded,
fresh process): Python SUT `main@f69d079` and Rust SUT `main@e75b4cb` each
report oidc-basic 15 executed / 13 pass / 0 fail / 2 deferred. The earlier
Rust failure came from putting `prompt=login` in step 1; removing it lets step
1 establish a clean session and step 2 prove reauthentication. No SUT-side
follow-up is needed for this scenario.

## Invariants

`invariants/oidc-basic.yaml` names 19 invariants, one per `oidc-basic`
requirement. Like the core and token-lifecycle catalogs they are declarative;
the runner has no trace layer yet, so invariants are cited by scenario notes
rather than wired into trace checks.
