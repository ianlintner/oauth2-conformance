# Standards map

Requirement IDs against OAuth 2.1 (draft-ietf-oauth-v2-1, section numbers from -13), RFC 9700
(OAuth 2.0 Security BCP) and the FAPI 2.0 Security Profile (final, section 5.x).
"Hole" means no requirement exists. "Out" means deliberately excluded
(`docs/out-of-scope.md`). Clause numbers for OAuth 2.1 are a best-effort mapping of a
draft and can shift between drafts; RFC 9700 and FAPI 2.0 are final.

## OAuth 2.1 draft

| Section | Topic | Requirement IDs | Status |
|---|---|---|---|
| 2.3.1 | Redirect URI registration, exact match | `RFC6749-3.1.2-*`, `RFC9700-4.4.2-per-client-redirect-exact`, `RFC8252-7.3-*` | covered |
| 2.3.4 | Mix-up prevention | `RFC9207-2-*`, `RFC9207-3-*`, `RFC9700-4.4.2-*` | covered (requirements) |
| 2.4 | Client authentication | `RFC6749-2.3-*`, `RFC7523-3-*` | covered |
| 4.1.1 | PKCE required for code flow | `RFC7636-4.1-code-challenge-required`, `RFC7636-4.2-*` | covered |
| 4.1.2 | Authorization response, `iss` | `RFC9207-2-*` | covered |
| 4.1.3 | Token request, single-use codes | `RFC6749-4.1.3-*`, `RFC9700-2.1.1-*` | covered |
| 4.2 | Client credentials | `RFC6749-4.4.*` | covered |
| 4.3 | Refresh, rotation or sender-constraint for public clients | `RFC9700-2.2.2-*`, `RFC9700-4.14.2-*` | covered |
| 5.1-5.3 | Bearer use, errors, no query-string tokens | `RFC6750-*` | covered; query-string rejection is a **hole** |
| 7.1 | Access token privilege restriction (audience) | `RFC8707-*`, `RFC9068-3-aud-matches-resource` | covered (requirements) |
| 7.5.1-7.5.3 | Code injection, reuse | `RFC9700-4.5-code-replay`, `RFC9700-2.1.1-*`, `RFC7636-*` | covered |
| 7.5.4 | HTTP 307 redirect | `FAPI2-5.3.2.2-no-http-307` | covered (optional profile) |
| 7.9 | CSRF / `state` | `RFC9700-4.7-require-state-*` | covered |
| 7.10 | Clickjacking | none | **hole** (`X-Frame-Options`/CSP on login and consent pages) |
| 7.12 | Open redirection | `RFC6749-3.1.2-*`, `RPINIT-2-post-logout-redirect-*`, `OPS-4.4-post-login-redirect-validated` | covered |
| 7.13 | Transport security | `RFC9700-2.6-*`, `FAPI2-5.2.1-tls-12-bcp195` | covered |
| 7.14.1 | Mix-up defence via issuer identification | `RFC9207-*`, `RFC9700-4.4.2-*` | covered |
| 7.14.2 | Mix-up defence via distinct redirect URIs | `RFC9700-4.4.2.2-per-client-redirect-exact` | covered (weak: exact match only) |
| Removed | Implicit, ROPC | `RFC9700-2.1.2-implicit-grant-rejected-policy`, `RFC9700-2.4-ropc-prohibited` | covered |

## RFC 9700

| Section | Topic | Requirement IDs | Status |
|---|---|---|---|
| 2.1 | Redirect URI validation, code replay, PKCE | `RFC9700-2.1.1-*`, `RFC9700-2.1.2-*`, `RFC7636-*` | covered |
| 2.2 | Token replay prevention (sender-constraint) | `RFC9700-2.2.1-*`, `RFC9700-2.2.2-*`, `RFC9449-*`, `RFC8705-*` | covered |
| 2.3 | Access token privilege restriction (audience / resource) | `RFC8707-*` | covered |
| 2.4 | Resource owner password credentials | `RFC9700-2.4-ropc-prohibited` | covered |
| 2.5 | Client authentication, credential guessing | `RFC9700-2.5-*` | covered |
| 2.6 | TLS | `RFC9700-2.6-*` | covered |
| 4.1 | Insufficient redirect URI validation | `RFC6749-3.1.2-*` | covered |
| 4.2 | Credential leakage via referrer | none | **hole** |
| 4.3 | Credential leakage via browser history | none (single-use codes: `RFC9700-4.5-code-replay`; no browser-history requirement) | **hole** |
| 4.4 | Mix-up | `RFC9207-*`, `RFC9700-4.4.2*` | covered |
| 4.5 | Authorization code injection | `RFC9700-4.5-code-replay`, `RFC7636-*` | covered |
| 4.6 | CSRF | `RFC9700-4.7-require-state-*` | covered |
| 4.9 | Access token leakage at the RS (audience) | `RFC8707-*`, `RFC9728-*` | covered (requirements) |
| 4.10 | Misuse of stolen tokens | `RFC9449-*`, `RFC8705-*` | covered |
| 4.11 | Open redirector | `FAPI2-5.3.2.1-no-open-redirectors` | covered (optional) |
| 4.12 | 307 redirect | `FAPI2-5.3.2.2-no-http-307` | covered (optional) |
| 4.13 | Reverse proxy headers | `RFC9700-4.13-*` | covered |
| 4.14 | Refresh token protection | `RFC9700-4.14.2-*` | covered |
| 4.15 | Client impersonation | `RFC9700-2.5-*` | partial |
| 4.16 | Clickjacking (framing of the authorization page) | none | **hole** |

Plus RFC 8725 (JWT BCP) via `RFC8725-*`, RFC 9068 via `RFC9068-*`, RFC 9470 via `RFC9470-*`.

## FAPI 2.0 Security Profile

| Clause | Topic | Requirement IDs | Status |
|---|---|---|---|
| 5.2.1 | TLS 1.2+, BCP 195 | `FAPI2-5.2.1-tls-12-bcp195` | covered |
| 5.2.3 | No CORS on authorization endpoint | `FAPI2-5.2.3-no-cors-authz-endpoint` | covered |
| 5.3.2.1 | Discovery metadata | `RFC8414-*` | covered |
| 5.3.2.1 | No ROPC | `RFC9700-2.4-ropc-prohibited` | covered |
| 5.3.2.1 | Confidential clients only | `FAPI2-5.3.2.1-confidential-clients-only` | covered |
| 5.3.2.1 | Sender-constrained tokens only (DPoP or mTLS) | `FAPI2-5.3.2.1-only-sender-constrained-tokens`, `RFC9449-*`, `RFC8705-*` | covered |
| 5.3.2.1 | Client authentication methods | `FAPI2-5.3.2.1-client-auth-methods` | covered |
| 5.3.2.1 | No open redirectors | `FAPI2-5.3.2.1-no-open-redirectors` | covered |
| 5.3.2.1 | Issuer as string `aud` | `FAPI2-5.3.2.1-issuer-string-only` | covered |
| 5.3.2.1 | No refresh rotation by default | `FAPI2-5.3.2.1-no-refresh-rotation-default` | covered (conflicts with `RFC9700-4.14.2` rotation; profile-specific, see note) |
| 5.3.2.1 | 60 s code lifetime | `FAPI2-5.3.2.1-code-lifetime-60s` | covered |
| 5.3.2.1 | DPoP code binding | `FAPI2-5.3.2.1-dpop-code-binding` | covered |
| 5.3.2.1 | iat/nbf 0-10 s future | `FAPI2-5.3.2.1-future-iat-window-10s` | covered |
| 5.3.2.2 | `response_type=code` | `RFC6749-4.1.1-response-type-*` | covered |
| 5.3.2.2 | PAR required, client-authenticated | `FAPI2-5.3.2.2-par-required`, `RFC9126-2-par-client-auth` | covered |
| 5.3.2.2 | PKCE S256 | `FAPI2-5.3.2.2-pkce-s256-only`, `RFC7636-*` | covered |
| 5.3.2.2 | `redirect_uri` in PAR | `FAPI2-5.3.2.2-par-redirect-uri-required` | covered |
| 5.3.2.2 | `iss` response parameter | `RFC9207-2-*` | covered |
| 5.3.2.2 | No 307 | `FAPI2-5.3.2.2-no-http-307` | covered |
| 5.3.2.2 | PAR `request_uri` expiry < 600 s | `FAPI2-5.3.2.2-par-request-uri-expiry-600` | covered |
| 5.3.2.2 | OIDC nonce up to 64 chars | `FAPI2-5.3.2.2-oidc-nonce-64` | covered |
| 5.3.2.2 | No `http` redirect URIs | `RFC9700-2.6-no-http-redirect-uri` | covered |
| 5.3.2.2 | Code bound to client (reject if issued to other) | `RFC6749-4.1.3-*` | covered |
| 5.3.2.3 | `sub` returned / OIDC | `OIDC-2-id-token-sub` | covered |
| 5.3.3 | Client requirements | n/a | Out |
| 5.3.4 | Resource server requirements | `RFC6750-*`, `RFC9728-*` | partial: RS behaviour is Out |
| 5.4.1 | PS256 / ES256 / EdDSA only | `FAPI2-5.4.1-signing-algs-ps256-es256-eddsa` | covered |
| 5.4.1 | RSA >= 2048, P-256+ | `FAPI2-5.4.1-rsa-2048-minimum` | covered |
| 5.4.2 / 5.4.3 | JWKS handling, duplicate `kid` | `FAPI2-5.4.2-jwks-no-duplicate-kid`, `RFC7517-4.5-jwks-distinct-kid` | covered |
| Message Signing | Signed requests/responses | none | Out |

Note: `FAPI2-5.3.2.1-no-refresh-rotation-default` is MUST NOT and only gates when
`fapi2` is claimed; the general profile keeps RFC 9700 rotation requirements. Whether the
two can both pass is a policy decision for the claiming implementation.

## Coverage holes found while mapping

1. OAuth 2.1 5.1.1/5.1.2: access tokens in the query string must be rejected. No requirement.
2. OAuth 2.1 7.10 clickjacking headers on login/consent pages. No requirement.
3. RFC 9700 4.2 referrer leakage of codes (`Referrer-Policy`). No requirement.
4. RFC 9700 4.3 credential leakage via browser history. No requirement.
5. RFC 9700 4.16 clickjacking (same gap as item 2).
6. RFC 9700 4.15 client impersonation is only partially covered by client-auth requirements.

These are listed rather than added now to keep this slice bounded; they are the first
candidates for the next catalog slice.
