# Security-review coverage batch 1

Black-box scenarios added to close holes found by comparing the catalog with a security review of the reference server. All use the seeded clients `client-public`, `client-a`, `client-enc` and `client-cc`; none needs a runner, seed-schema or SUT-contract change.

| Hole | Scenario | Requirement | Level | Status |
|---|---|---|---|---|
| Empty `client_secret` for a public client (HTTP Basic, empty password) at `/oauth/token` | `token-lifecycle.client-auth.empty-secret-token-endpoint` | `RFC6749-2.3.1-empty-secret-not-authentication-policy` (new) | MAY (local hardening policy) | stable |
| Same at `/oauth/introspect` and `/oauth/revoke` | `token-lifecycle.client-auth.empty-secret-introspect-revoke` | same | MAY (local hardening policy) | draft (fails Python) |
| Wrong secret at introspection / revocation changes nothing | `token-lifecycle.introspection.wrong-secret`, `token-lifecycle.revocation.wrong-secret` | `RFC7662-2.1-caller-authentication`, `RFC7009-2.1-client-authentication` | MUST | stable |
| Code replay revokes the first exchange's tokens (client-a, with refresh token) | `token-lifecycle.revocation.code-replay-revokes-tokens` | `RFC9700-2.1.1-code-replay-revokes-tokens` | SHOULD | stable |
| Same, client without the `refresh_token` grant (`client-enc`, access token only) | `token-lifecycle.revocation.code-replay-revokes-access-token-no-refresh-grant` | same | SHOULD | reference-deviation |
| Refresh cannot widen the authorized resource | `resource.indicators.refresh-resource-not-widened` | `RFC8707-refresh-resource-not-widened`, `RFC8707-2.2-resource-subset-of-authorized` | MAY (corrected, see below) | draft |
| `client_credentials` with a non-absolute resource | `resource.indicators.client-credentials-invalid-target-relative` | `RFC8707-2-resource-invalid-target` | SHOULD (corrected) | reference-deviation |
| `client_credentials` with a fragment-carrying resource | `resource.indicators.client-credentials-invalid-target-fragment` | `RFC8707-2-resource-invalid-target` | SHOULD (corrected) | reference-deviation |
| `client_credentials` with an unregistered resource | `resource.indicators.client-credentials-invalid-target-unregistered` | `RFC8707-2-resource-invalid-target` | SHOULD | draft (no seed resource registry) |
| Refresh token and ID token refused as Bearer at UserInfo; ID token inactive at introspection | `hardening.token-kind.refresh-and-id-token-not-bearer` (also runs under `oidc-basic`) | `RFC8725-3.12-cross-jwt-confusion` | MUST | stable |

## Requirement corrections

RFC 8707 section 2.2 leaves acceptable resources to "local policy or configuration" and says refresh/authorization-code policy "may limit" them to those originally granted, and section 2 says the server "should reject" an unacceptable value with `invalid_target`. The catalog had `RFC8707-2.2-resource-subset-of-authorized` (MUST), `RFC8707-refresh-resource-not-widened` (MUST NOT) and `RFC8707-2-resource-invalid-target` (MUST). They are now MAY, MAY and SHOULD, with the clause text in `notes`. The absolute-URI and no-fragment rules are client-side MUSTs on the parameter value; the scenarios assert the server-side rejection.

## Residual

- The empty `client_secret` *form field* variants (`client_id=client-public&client_secret=`) are not expressible: `schemas/scenario.schema.json` requires form values of at least one character. Needs a small schema/runner change to allow an empty string.
- A resource-registry seed field is needed before "resource not registered for this client" can be promoted past draft.
