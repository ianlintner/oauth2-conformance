# sender-constrained coverage (contract v0.5 2/3)

35 scenarios, 35 invariants (INV-SC-*). Stable: 0. Draft: 35. Every one of the 35 catalogued requirements (MUST, SHOULD, MAY) has exactly one scenario; no MUST is uncovered. Nothing has been run against a SUT, so all scenarios are draft and none is claimed to pass.

Requests use placeholders such as `{{proof_wrong_typ}}` for DPoP proofs the runner cannot yet produce; they are intent, not executable today.

| scenario | requirements |
|---|---|
| sender-constrained.abuse.invalid-client-401 | RFC6749-5.2-invalid-client-401 |
| sender-constrained.abuse.invalid-client-rate-limited | RFC9700-2.5-invalid-client-rate-limited-policy |
| sender-constrained.abuse.rate-limit-per-client | RFC9700-2.5-rate-limit-per-client-policy |
| sender-constrained.abuse.success-not-counted | RFC9700-2.5-success-not-counted-policy |
| sender-constrained.dpop.ath-matches-token | RFC9449-7.1-ath-matches-token |
| sender-constrained.dpop.ath-mismatch | RFC9449-7.1-ath-mismatch-rejected |
| sender-constrained.dpop.ath-required | RFC9449-7.1-ath-required |
| sender-constrained.dpop.cnf-jkt-binding | RFC9449-6.1-cnf-jkt-binding |
| sender-constrained.dpop.discovery-alg-values | RFC9449-5.1-as-discovery-alg-values |
| sender-constrained.dpop.forged-nonce | RFC9449-8-forged-nonce-use-dpop-nonce |
| sender-constrained.dpop.htm-binding | RFC9449-4-htm-binding |
| sender-constrained.dpop.htu-binding | RFC9449-4.2-htu-binding |
| sender-constrained.dpop.htu-query-ignored | RFC9449-4.2-htu-query-rejected |
| sender-constrained.dpop.iat-stale | RFC9449-4.2-iat-freshness-window |
| sender-constrained.dpop.introspection-token-type | RFC9449-6.2-introspection-token-type-dpop |
| sender-constrained.dpop.jti-replay | RFC9449-4.3-jti-replay-rejected |
| sender-constrained.dpop.jti-required | RFC9449-4.3-jti-required |
| sender-constrained.dpop.jwk-usable-algorithm | RFC9449-4-jwk-usable-algorithm |
| sender-constrained.dpop.nonce-grace | RFC9449-9-nonce-grace-window |
| sender-constrained.dpop.nonce-response-header | RFC9449-8-nonce-response-header |
| sender-constrained.dpop.nonce-retry | RFC9449-8-nonce-retry-succeeds |
| sender-constrained.dpop.replay-cross-instance | RFC9449-11.1-replay-store-cross-instance |
| sender-constrained.dpop.replay-in-memory | RFC9449-11.1-replay-store-in-memory-floor |
| sender-constrained.dpop.replay-restart | RFC9449-11.1-replay-store-restart-safe |
| sender-constrained.dpop.signature-verified | RFC9449-4-proof-signature-verified |
| sender-constrained.dpop.stale-nonce | RFC9449-9-stale-nonce-use-dpop-nonce |
| sender-constrained.dpop.token-sender-constrained | RFC9700-2.2.1-token-sender-constrained |
| sender-constrained.dpop.token-type-dpop | RFC9449-5-token-type-dpop |
| sender-constrained.dpop.typ-header | RFC9449-4-typ-header-dpop-jwt |
| sender-constrained.dpop.use-dpop-nonce | RFC9449-8-use-dpop-nonce-error |
| sender-constrained.dpop.wrong-key | RFC9449-7.2-wrong-key-rejected |
| sender-constrained.mtls.cnf-x5t | RFC8705-3.1-cnf-x5t-binding |
| sender-constrained.mtls.discovery-cert-bound | RFC8705-3.3-discovery-cert-bound-tokens |
| sender-constrained.mtls.resource-cert-must-match | RFC8705-3-resource-cert-must-match |
| sender-constrained.mtls.tls-client-auth-dn | RFC8705-2.1-tls-client-auth-subject-dn |

## Scenario semantics (remediation of review findings on PR #17)

All 35 stay draft; none is stable or counted as MUST coverage. Semantic guards live in `runner/test/sender-constrained-semantics.test.ts`.

- DPoP resource scenarios (ath-matches-token, ath-mismatch, ath-required, wrong-key, token-sender-constrained) obtain a user-bound token with the `openid` scope (login-and-authorize, then authorization_code with a DPoP proof) because `/oauth/userinfo` rejects client_credentials tokens regardless of sender constraint. ath-mismatch, ath-required and wrong-key run a positive control (correctly bound request returns 200) before the mutated request returns 401, so the rejection can only come from the sender constraint.
- token-sender-constrained now also shows a DPoP-bound token is rejected as a plain Bearer, not just issued.
- mtls.resource-cert-must-match is RFC 8705 certificate binding (token bound to client-cert-a, positive control with client-cert-a, 401 with client-cert-b). mtls.tls-client-auth-dn presents client-cert-a as control (200) and client-cert-wrong-dn (401 invalid_client). Both need the `mtls-request` helper, which the runner does not implement: an unknown helper defers the scenario.
- htu-query-ignored is distinct from htu-binding: a matching htu with a query on the request URI is accepted; a mismatching htu with a query is rejected.
- Nonce scenarios assert the DPoP-Nonce response header via `capture` (fails when absent). A non-empty-value matcher for headers is a part 3/3 gap.
- jwk-usable-algorithm has a valid-proof control plus symmetric-alg and private-key-jwk variants. replay-restart and replay-cross-instance use `sut-restart` / `request-on-instance` helpers (declared in the schema for draft use, not implemented).
- abuse.rate-limit-per-client, abuse.success-not-counted and mtls.cnf-x5t were status-200-only. The abuse pair are now explicit placeholders (notes say NOT coverage); cnf-x5t asserts the `cnf.x5t#S256` claim but not the thumbprint value.
- Runner regression: a capturing-fetch test pins that request headers, content-type and the URL-encoded form body reach the SUT; dropping either in the runner fails it.

## Runner/SUT gaps (draft, part 3/3)

Features the drafts need that the runner or SUT lack today; part 3/3 decides which to build. Scenarios per feature:

- no new runner feature needed, but the SUT must claim the sender-constrained profile and has not been run against it (3): abuse.invalid-client-401, dpop.discovery-alg-values, mtls.discovery-cert-bound
- needs step repetition (loop N times) in the runner (3): abuse.invalid-client-rate-limited, abuse.rate-limit-per-client, abuse.success-not-counted
- needs a DPoP proof signing helper (ES256 key with selectable typ/jwk/htm/htu/iat/jti/ath/nonce claims) (26): dpop.ath-matches-token, dpop.ath-mismatch, dpop.ath-required, dpop.cnf-jkt-binding, dpop.forged-nonce, dpop.htm-binding, dpop.htu-binding, dpop.htu-query-ignored, dpop.iat-stale, dpop.introspection-token-type, dpop.jti-replay, dpop.jti-required, dpop.jwk-usable-algorithm, dpop.nonce-grace, dpop.nonce-response-header, dpop.nonce-retry, dpop.replay-cross-instance, dpop.replay-in-memory, dpop.replay-restart, dpop.signature-verified, dpop.stale-nonce, dpop.token-sender-constrained, dpop.token-type-dpop, dpop.typ-header, dpop.use-dpop-nonce, dpop.wrong-key
- needs access-token hash (ath) input to the signing helper (4): dpop.ath-matches-token, dpop.ath-mismatch, dpop.ath-required, dpop.wrong-key
- needs cnf.jkt capture (JWT payload or introspection) and JWK thumbprint computation (1): dpop.cnf-jkt-binding
- the scenario only checks issuance today (1): dpop.cnf-jkt-binding
- needs SUT nonce-required mode (6): dpop.forged-nonce, dpop.nonce-grace, dpop.nonce-response-header, dpop.nonce-retry, dpop.stale-nonce, dpop.use-dpop-nonce
- needs clock control or a backdated-claim mode (3): dpop.iat-stale, dpop.nonce-grace, dpop.stale-nonce
- needs a nonce claim in the signing helper (1): dpop.nonce-retry
- needs a multi-instance SUT deployment and `request-on-instance` helper (1): dpop.replay-cross-instance
- needs a `sut-restart` helper with a persistent replay store (1): dpop.replay-restart
- needs a second ephemeral key in the signing helper (1): dpop.wrong-key
- needs mTLS client-certificate transport in the runner and a seeded client-mtls (3): mtls.cnf-x5t, mtls.resource-cert-must-match, mtls.tls-client-auth-dn
- needs x5t#S256 thumbprint computation (1): mtls.cnf-x5t
- needs two distinct client certificates (1): mtls.resource-cert-must-match
- needs a certificate whose Subject DN differs from the registered one (1): mtls.tls-client-auth-dn

Scenarios with no listed gap (dpop.discovery-alg-values, mtls.discovery-cert-bound, abuse.invalid-client-401) only need the SUT to claim the profile.

Policy note: rate-limit scenarios (RFC9700-2.5-*-policy) are MAY/local policy, not RFC server requirements.

## Part 3/3 status (v0.5)

Delivered (runner-only, **no SUT interface change**): the `dpop-proof` step helper (`runner/src/dpop.ts`). It signs an ES256 DPoP proof with selectable `htm`, `htu`, `typ`, `iat_offset`, `jti`, `omit` (htm/htu/iat/jti), `ath`/`ath_token`, `nonce` and a named ephemeral `key`, and returns `{proof, jkt}` so a scenario captures `body.proof` and sends it in the `DPoP` header. A replay resends the captured variable byte-for-byte. DPoP is plain HTTP, so the SUT needs nothing new.

Rust reference run (conformance mode, seeded with `examples/seed.yaml`, `OAUTH2_SERVER_PUBLIC_BASE_URL=http://localhost:8080`; binary built from the local rust-oauth2-server checkout, whose DPoP handler is unchanged since before main `2adb1ce`): 7 scenarios pass and are promoted to `stable`: dpop.token-type-dpop (positive control), dpop.jti-required, dpop.jti-replay, dpop.htm-binding, dpop.htu-binding, dpop.typ-header, dpop.iat-stale. Each negative scenario differs from the accepted control proof by exactly one property. No Rust failure, so no reference-deviation and no Rust fix card. Rust is not claimed `pass` for v0.5: 28 scenarios stay draft and CI does not yet run this profile.

Python: its repository has no conformance-mode seed loader (the string only appears in its README and CI), so the profile was not run there.

Still draft (need more than `dpop-proof`): user-bound token flows with `ath` and `wrong-key` (need the proof for the resource request built from a captured token and a `jkt` capture; scenario rewrites are a follow-up), nonce scenarios (SUT nonce-required mode, owner-gated), clock control, step repetition, mTLS transport, `sut-restart` / `request-on-instance`.
