# token-lifecycle coverage (contract v0.2, part 3/3)

Scenarios live in `scenarios/token-lifecycle/`, invariants in
`invariants/token-lifecycle.yaml`. Every scenario cites requirement ids from
`requirements/*-token-lifecycle.yaml` and the other v0.2 catalogs.

Measured against the Rust reference SUT: 25 stable scenarios pass, 6 are
`reference-deviation` (RFC wins over Rust), 0 fail.

## Runner extensions added in part 3/3

The four runner features this part scoped are implemented and unit-tested
(`runner/test/matchers.test.ts`) plus the schema/validation plumbing:

- JWT header/payload captures — `capture: <name>: jwt.<var>.<header|payload>.<field>`
  decodes a previously-captured JWT and extracts a claim or header field.
- `$contains` matcher — asserts an array member contains a value.
- `$nonempty` matcher — asserts an array member is non-empty.
- `$absent` matcher — asserts a member is absent (the first absence assertion).
- `{{var}}` interpolation inside `expect.json` / `expect.headers` string values,
  so a decoded claim (e.g. `jwt.at.payload.iss`) can be compared against a
  response-observable field (e.g. the metadata `issuer`).

## Reference deviations (RFC wins over Rust)

Each is `status: reference-deviation`: reported, not build-breaking. The RFC
basis, not the SUT behavior, is what the scenario asserts.

| Scenario | Requirement | RFC basis | Rust behavior |
|---|---|---|---|
| token-lifecycle.revocation.cross-client | RFC7009-2.1-token-owned-by-client (MUST) | RFC 7009 2.1: the server verifies the token was issued to the authenticated client and refuses otherwise. | 200, and the token is revoked. |
| token-lifecycle.refresh.no-client-authentication | RFC6749-6-refresh-client-authentication (MUST) | RFC 6749 6: a confidential client authenticates on refresh. | 200 and the token rotates with no authentication. A real defect. |
| token-lifecycle.client-credentials.no-client-auth | RFC6749-4.4.2-cc-client-authenticates (MUST) | RFC 6749 5.2: missing client authentication is invalid_client (401). | 400 invalid_request. |
| token-lifecycle.revocation.refresh-cascades-to-access | RFC7009-2.1-refresh-revocation-cascades (SHOULD) | RFC 7009 2.1: SHOULD invalidate access tokens of the same grant. | Access token stays active. |
| token-lifecycle.jwt.header-typ-and-signature | RFC9068-2.1-jwt-signed, -jwt-alg-none, -typ-header, -rs256-supported | RFC 9068 2.1: the token is signed, `typ` is `at+jwt`, `alg` is not `none`, and RS256 is included. | Signs HS256, so RS256 support is not observed. |
| token-lifecycle.jwt.verifiable-with-jwks | RFC9068-4-verifiable-with-jwks, RFC7517-5-jwks-keys-array | RFC 9068 4 / RFC 7517 5: the token verifies against a key at `jwks_uri`, whose document is a keys array. | Serves `{"keys":[]}` while signing, so no token verifies against it. |

`RFC6749-4.4.2` and `RFC6749-6-refresh-client-authentication` stay covered by
stable wrong-secret scenarios; only the missing-credentials variants deviate.

## MUST / MUST NOT requirements with no scenario

| Requirement | Level | Reason |
|---|---|---|
| RFC7662-4-expiry-checked | MUST | Needs a short-TTL token or a controllable clock. Neither the seed schema nor the runner can produce an expired token. SUT interface change, owner-gated (all ports). |
| RFC9700-2.2.2-public-refresh-rotated-or-bound | MUST | The seed has no public client granted `refresh_token` (client-public is authorization_code only), so no public-client refresh token can be issued. Seed change, owner-gated (all ports). |

## Other uncovered requirements (SHOULD / SHOULD NOT / MAY)

| Requirement | Level | Reason |
|---|---|---|
| RFC7009-2.1-access-revocation-may-cascade | MAY | Optional behavior. |
| RFC8414-2-grant-types-supported, -token-endpoint-auth-methods | MAY | Optional metadata. |
| RFC9068-2.2.3-scope-claim, RFC9068-3-aud-matches-resource | SHOULD | Need JWT payload decode against a granted scope/resource; the token's own `scope`/`aud` claims are captured but not yet asserted inline. |
| RFC7517-4.5-jwks-distinct-kid, -jwks-rollover-overlap | SHOULD / MAY | Need a populated JWKS and key rotation control. |
| RFC6749-1.4-opaque-access-token | MAY | The SUT issues JWTs; opaque mode is not a SUT option. |
| RFC9700-4.14.2-refresh-inactivity-expiry | SHOULD | Needs controllable clock. |
| RFC9700-4.14.2-refresh-revoked-on-security-event | MAY | No SUT security-event trigger. |
| RFC7523-3-client-assertion-* | MAY | No private_key_jwt client in the seed. |

`RFC6749-4.4.3-cc-no-refresh-token` and `RFC7662-2.2-inactive-no-detail` (both
SHOULD NOT) are now asserted with the `$absent` matcher in stable scenarios
(`client-credentials/no-refresh-token.yaml` and
`introspection/inactive-no-detail.yaml`) and are no longer uncovered.

## Invariants

`invariants/token-lifecycle.yaml` names 12 invariants, each against one
requirement. Like the core catalog they are declarative; the runner has no
trace layer yet, so invariants are cited by scenario notes rather than wired
into trace checks (a future architecture-layer task).
