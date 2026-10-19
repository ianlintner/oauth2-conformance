# oidc-basic coverage (contract v0.3, part 2/3)

Scenarios live in `scenarios/oidc-basic/`, invariants in
`invariants/oidc-basic.yaml`. Every scenario cites requirement ids from
`requirements/oidc-core.yaml` (part 1/3). This part 2/3 catalogues scenarios
and invariants using only existing runner features; scenarios that need a
runner/SUT feature that does not yet exist are `draft` and are listed below,
with the runner change deferred to part 3/3.

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

Coverage: 7 of 19 requirements `stable`, 12 `provisional` (draft), 0
uncovered. Every MUST / MUST-NOT requirement has at least a draft scenario, so
the coverage gate passes (`runner/test/coverage-gate.test.ts`).

## Draft scenarios and the runner/SUT feature they need (part 3/3)

| Scenario | Missing capability |
|---|---|
| id-token.aud-iat-exp-nonce-claims | `aud` may be a string or array and the JWT capture returns `undefined` for an array member, so `aud` membership cannot be asserted; `iat`/`exp` are numeric and the runner has no numeric-ordering matcher; `nonce` echo needs a request-parameter-vs-decoded-claim equality the runner does not express. Needs aud membership, numeric `iat < exp`, and claim-equals-literal matchers. |
| id-token.scope-claims | Asserting "only scope-authorized claims are present" needs claim-set equality/absence against a decoded id_token, which the runner lacks (no claim-key-set matcher). |
| userinfo.email-profile-scope-claims | The conformance seed does not promise storage-backed user claim data; the reference `wellknown::userinfo` gates `email`/`preferred_username` on a successful user storage lookup. Claim presence is non-deterministic against the current contract. Needs a seed with deterministic user claims. |
| userinfo.rejects-client-credentials-token | The reference `conformance.yaml` does not yet claim `oidc-basic`, and the seed's `client-cc` grants no `openid` scope; the SUT's client_credentials-userinfo handling is unconfirmed. Promotable to `stable` after part 3/3 pins the SUT contract. |
| prompt.prompt-none-requires-login | `login-and-authorize` always completes a login when it sees a login-page redirect, so "no active session, do not log in" cannot be expressed. Needs a no-session mode. |
| prompt.prompt-login-reauthenticates | The helper caches one session and silently reuses it, so a reused vs fresh authentication cannot be distinguished. Needs explicit session-state control. |
| prompt.max-age-and-auth-time | Needs session-state control plus a numeric `auth_time` claim decode; the session cache hides whether re-authentication happened. |
| logout.id-token-hint-aud | Needs an id_token_hint signed by the SUT's own key but carrying an unregistered `client_id` as `aud`; the runner has no SUT signing secret and no foreign-aud token fixture. Needs a signed-token fixture. |

## MUST / MUST NOT requirements with no scenario

None. All fourteen MUST / MUST-NOT requirements in the `oidc-basic` profile
have at least a draft scenario.

## Invariants

`invariants/oidc-basic.yaml` names 19 invariants, one per `oidc-basic`
requirement. Like the core and token-lifecycle catalogs they are declarative;
the runner has no trace layer yet, so invariants are cited by scenario notes
rather than wired into trace checks (part 3/3).
