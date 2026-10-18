# token-lifecycle coverage (contract v0.2, part 2/3)

Scenarios live in `scenarios/token-lifecycle/`, invariants in
`invariants/token-lifecycle.yaml`. Every scenario cites requirement ids from
`requirements/*-token-lifecycle.yaml` and the other v0.2 catalogs. Only runner
features that exist today are used; whatever a scenario needs beyond that is
listed below and the scenario is `draft`.

Measured against the Rust reference SUT: 25 stable scenarios pass, 4 are
deferred (3 reference-deviation, 1 draft that also fails), 0 fail.

## Reference deviations (RFC wins over Rust)

Each is `status: reference-deviation`: reported, not build-breaking. The RFC
basis, not the SUT behavior, is what the scenario asserts.

| Scenario | Requirement | RFC basis | Rust behavior |
|---|---|---|---|
| token-lifecycle.revocation.cross-client | RFC7009-2.1-token-owned-by-client (MUST) | RFC 7009 2.1: the server verifies the token was issued to the authenticated client and refuses otherwise. | 200, and the token is revoked. |
| token-lifecycle.refresh.no-client-authentication | RFC6749-6-refresh-client-authentication (MUST) | RFC 6749 6: a confidential client authenticates on refresh. | 200 and the token rotates with no authentication. A real defect. |
| token-lifecycle.client-credentials.no-client-auth | RFC6749-4.4.2-cc-client-authenticates (MUST) | RFC 6749 5.2: missing client authentication is invalid_client (401). | 400 invalid_request. |
| token-lifecycle.revocation.refresh-cascades-to-access | RFC7009-2.1-refresh-revocation-cascades (SHOULD) | RFC 7009 2.1: SHOULD invalidate access tokens of the same grant. | Access token stays active. |

`RFC6749-4.4.2` and `RFC6749-6-refresh-client-authentication` stay covered by
stable wrong-secret scenarios; only the missing-credentials variants deviate.

## Draft scenarios (runner or SUT feature missing)

| Scenario | Requirements | Missing feature |
|---|---|---|
| token-lifecycle.jwt.claims-match-metadata | RFC9068-2.2-required-claims, RFC9068-4-iss-matches-metadata | Runner capture that decodes a JWT payload (e.g. `jwt.payload.iss`). The draft approximates through introspection, which proves the server's view, not the token's own claims. |
| token-lifecycle.jwt.header-typ-and-signature | RFC9068-2.1-jwt-signed, -jwt-alg-none, -typ-header, -rs256-supported | JWT header decode capture, plus an array-contains matcher for the RS256 requirement. The SUT signs HS256 with typ `at+JWT`; the draft only issues a token. |
| token-lifecycle.jwt.verifiable-with-jwks | RFC9068-4-verifiable-with-jwks, RFC7517-5-jwks-keys-array | Array-nonempty matcher and JWT signature verification. SUT gap too: it serves `{"keys":[]}` while signing, so this fails today. |
| token-lifecycle.jwt.metadata-response-types | RFC8414-2-response-types-supported | Array-contains matcher. Array comparison is exact, so the draft pins the SUT list and would fail a conforming server. |

Part 3/3 should add: JWT header/payload captures, array-contains and
array-nonempty matchers, and an absent-member assertion (also needed for the
two SHOULD NOT invariants below).

## MUST / MUST NOT requirements with no scenario

| Requirement | Level | Reason |
|---|---|---|
| RFC7662-4-expiry-checked | MUST | Needs a short-TTL token or a controllable clock. Neither the seed schema nor the runner can produce an expired token. SUT interface change, owner-gated (all ports). |
| RFC9700-2.2.2-public-refresh-rotated-or-bound | MUST | The seed has no public client granted `refresh_token` (client-public is authorization_code only), so no public-client refresh token can be issued. Seed change, owner-gated (all ports). |

## Other uncovered requirements (SHOULD / SHOULD NOT / MAY)

| Requirement | Level | Reason |
|---|---|---|
| RFC6749-4.4.3-cc-no-refresh-token | SHOULD NOT | Runner can assert presence, not absence, of a member. Invariant INV-CC-NO-REFRESH-TOKEN records it. |
| RFC7662-2.2-inactive-no-detail | SHOULD NOT | Same absence-assertion gap. Invariant INV-INTROSPECT-NO-LEAK-INACTIVE records it. |
| RFC7009-2.1-access-revocation-may-cascade | MAY | Optional behavior. |
| RFC8414-2-grant-types-supported, -token-endpoint-auth-methods | MAY | Optional metadata; array-contains matcher missing anyway. |
| RFC9068-2.2.3-scope-claim, RFC9068-3-aud-matches-resource | SHOULD | Need JWT payload decode (see drafts). |
| RFC7517-4.5-jwks-distinct-kid, -jwks-rollover-overlap | SHOULD / MAY | Need a populated JWKS and key rotation control. |
| RFC6749-1.4-opaque-access-token | MAY | The SUT issues JWTs; opaque mode is not a SUT option. |
| RFC9700-4.14.2-refresh-inactivity-expiry | SHOULD | Needs controllable clock. |
| RFC9700-4.14.2-refresh-revoked-on-security-event | MAY | No SUT security-event trigger. |
| RFC7523-3-client-assertion-* | MAY | No private_key_jwt client in the seed. |

## Invariants

`invariants/token-lifecycle.yaml` names 12 invariants, each against one
requirement. Like the core catalog they are declarative until part 3/3 wires
them into trace checks; scenario notes cite them by id.
