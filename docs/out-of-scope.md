# Explicitly out of scope (for now)

Honest boundary for "fully documented". Each item is something a modern server may
ship that the contract deliberately does not yet cover, with a one-line reason.
Per the 2026-10-30 recovery plan (depth before breadth), none of these gets a
profile until existing draft scenarios are stable.

| Item | Spec | Why it is not in the contract |
|---|---|---|
| CIBA (backchannel authentication) | OpenID CIBA Core 1.0 | Needs a poll/ping/push mock authentication device the runner does not have. |
| JARM (JWT-secured authorization response) | OpenID JARM | FAPI 2.0 final dropped it; `iss` (RFC 9207) is the response-integrity mechanism covered here. |
| Token Status Lists | draft-ietf-oauth-status-list | Draft, and no reference implementation to anchor expected behaviour. |
| SD-JWT / SD-JWT VC | RFC 9901 / draft VC | Credential issuance (OpenID4VCI) is a separate product surface. |
| OpenID4VCI / OpenID4VP | OIDF | Same: wallet and verifier roles, not an authorization server core. |
| GNAP | RFC 9635 | Different protocol; not an OAuth 2.0 extension. |
| OAuth 2.1 as a profile | draft-ietf-oauth-v2-1 | Still a draft; mapped clause by clause in `docs/standards-map.md` instead of claimed. |
| Shared Signals / CAEP / RISC | OpenID SSF | Event streams need a receiver mock; revisit after logout requirements are stable. |
| Session Management (`check_session`) | OIDC Session Management 1.0 | Superseded by logout specs and third-party-cookie restrictions; Rust still serves it (inventory G7). |
| Agent identity family: CIMD, ID-JAG, TAC, transaction tokens, workload identity, OBO consent | various drafts | Fast-moving drafts and vendor extensions (inventory G1-G6); candidate future `agents` profile. |
| FAPI 2.0 Message Signing (signed requests/responses/introspection) | FAPI 2.0 Message Signing | Only the Security Profile is mapped; message signing needs JAR/JARM-style fixtures first. |
| FAPI 2.0 client-side requirements (RP behaviour) | FAPI 2.0 Security Profile 5.3.3 | The contract tests servers, not clients or relying parties. |
| Resource-server behaviour beyond metadata and challenges | RFC 9068 section 4 | Contract exercises the AS; RS token validation is not a runnable server contract. |
| mTLS ecosystem details (CA trust, cert rotation) | RFC 8705 | Needs infrastructure beyond HTTP fixtures; only token binding is covered. |
| Dynamic client registration extras (software statements, signed metadata) | RFC 7591 section 2.3 | Rarely deployed; core DCR is covered. |
| Social login providers beyond a mock IdP | n/a | Provider APIs are not a protocol contract (`OPS-4.*` uses a mock). |
| Observability internals (OTel spans, propagation) | n/a | Implementation detail; `OPS-3.3` covers only the observable metrics surface. |
| Admin UI pages, Swagger UI, static assets | n/a | Not protocol surface. |
