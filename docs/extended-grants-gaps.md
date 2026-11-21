# extended-grants runner/SUT gaps (draft, part 3/3)

The extended-grants profile ships 51 scenarios and 51 named invariants. All are `draft`; nothing has been validated against a running SUT. They enumerate the concrete runner and SUT features part 3/3 must add before they can promote to stable and produce passing black-box runs. This list is the explicit draft scope for the next card; nothing here is claimed to pass today.

## Runner features (missing today)

1. Device-flow seed client. A `client-dev` OAuth 2.0 client with `client_secret_basic` and the device grant, injected by the seed so the SUT issues a real device_code. Today the SUT only seeds `client-a`/`client-enc` authorization-code clients.
2. Verification-page driver. A step helper that opens `verification_uri`, submits `user_code`, and either approves or denies. Needed for `access-denied`, `approved-success`.
3. Token-poll helper with interval awareness. A step helper that polls `/oauth/token` on an interval and can assert the server enforces `interval` (RFC 8628 slow_down: +5 seconds on and after a slow_down). Also needs SUT clock/time control to make `expired_token` (RFC 8628) and `expired request_uri` (RFC 9126 4) deterministic.
4. Duplicate form-key transport. ~~The runner `form` model is a key→value map and cannot send a repeated parameter.~~ **Delivered (part 3/3):** `request.form` and `request.query` now accept an ordered `{ name, value }[]` list in addition to a string map, and `encodeForm`/the query builder preserve duplicate keys in order. `params-not-repeated` can now be *sent*; whether it *passes* depends on the SUT rejecting a repeated parameter (see Rust note below).
5. Client-assertion JWT signing. Sign `urn:ietf:params:oauth:client-assertion-type:jwt-bearer` assertions for PAR (`par-jwt-audience`) and grant assertions (RFC 7523), with selectable `iss`/`sub`/`aud`/`exp`/signature so negative claims cases are testable.
6. JAR request-object signing. Emit a signed (and optionally tampered/`alg:none`) request JWT with selectable `iss`/`aud`/`client_id`, plus the "first successful use, then second use" pattern for `request-uri-single-use`.
7. Seeded client JWKs. A client key registered so the SUT can verify private_key_jwt / request-object signatures.

## SUT conformance features (must be claimed by the SUT's conformance manifest)

8. PAR endpoint. `/oauth/par` must be present and the SUT must claim `extended-grants` (PAR + request_uri at `/oauth/authorize`).
9. Dynamic client registration + management. `/connect/register` and the `registration_client_uri` read/update/delete surface (RFC 7591/7592).
10. JAR request objects. Signed request objects at `/oauth/authorize` with audience/policy validation.
11. RAR authorization_details. `authorization_details` in PAR/token requests and introspection, with `authorization_details_types_supported` advertising `payment_initiation`.
12. Token exchange. `urn:ietf:params:oauth:grant-type:token-exchange` with `subject_token`/`actor_token` validation.
13. TLS presentation. The conformance SUT runs on a loopback `http://localhost:8080` issuer, so the RFC-prescribed `https`-scheme REQUIREments (`device-authz-tls`, `par-endpoint-https`, `reg-endpoint-tls`) cannot be observed black-box. These are asserted as metadata-shape only today; a TLS-bound run is a separate environment concern.

## Review follow-ups carried from 2/3

- RFC 8628 too-fast polling (`slow_down`): a scoped requirements amendment added `RFC8628-3.5-slow-down-on-fast-polling` (server must return slow_down when the client polls faster than the advertised interval).
- RFC 9126 expired request_uri: a scoped requirements amendment added `RFC9126-4-par-expired-request-uri-rejected` (section 4: expired request_uri MUST be rejected as invalid).

Both amendments are flagged in the requirement `notes` and listed here so 3/3 keeps them visible.

## Part 3/3 status (v0.4)

Delivered: seeded `client-dev` (gap 1) and the `device-verify` runner helper (gap 2); SUT interface documented in `contract/sut-interface.md` section 3a. Rust reference run: 7 device scenarios promoted to `stable` (approved-success, authorization-pending, response-members, token-request-grant-type, empty-and-unknown-params, discovery-endpoint, authz-tls) and `device.access-denied` recorded as `reference-deviation` (Rust answers 403; RFC 8628 3.5 requires 400). Remaining device drafts: expired-token, slow-down-on-fast-polling (gap 3), repeated-param-rejected (gap 4), unknown-client (Rust deviates, to be triaged). PAR/JAR/RAR/registration/exchange/assertions stay `draft` (gaps 5-13); follow-up cards required.

## Triage against SUT v2 mains (t_e24d6319, contract b762092; rust db8e658, python main)

Promoted to `stable` (passes on Rust and Python): `par.request-uri-single-use` (rewritten: real first use via a pre-established session, then second use rejected 400).

Seed schema: `grant_types` enum now allows `urn:ietf:params:oauth:grant-type:token-exchange`.

Still `draft`, with exact blockers (all verified live):

| Scenario group | Blocker |
|---|---|
| `exchange/*` (5) | Both SUT seed loaders reject `token-exchange` (rust `crates/oauth2-server/src/conformance.rs` `GRANT_TYPES`; python `src/oauth2_server/conformance.py:82` `GRANT_TYPES`), so no exchange client can be seeded. Add a `client-tx` seed client once both land. |
| `registration/*` (3 pass on both) | Pass only with dynamic registration enabled (rust `OAUTH2_DYNAMIC_REGISTRATION_ENABLED=1`; python also `OAUTH2_DYNAMIC_REGISTRATION_ANONYMOUS=true`). Promote once the SUT conformance CI configs set them. |
| `rar/type-required`, `rar/unknown-type-and-fields` | Rust deviation: no `authorization_details` validation (missing `type` and unsupported types accepted at PAR/authorize). Rust fix needed. |
| `par/request-uri-expired`, `device/expired-token` | Rust lacks `/conformance/clock` (404); python has it. Needs Rust test-clock capability. |
| `par/request-uri-forbidden` | Both SUTs accept `request_uri` inside a PAR body (RFC 9126 2.1 MUST NOT). Both need a fix. |
| `par/request-uri-client-bound` | Scenario asserts 400; both SUTs return 401. Requirement says only "rejected"; scenario needs a status matcher change. |
| `jar/alg-none-rejected`, `jar/require-signed` | Pass on python; Rust rejects but with `invalid_request` instead of `invalid_request_object` (RFC 9101 5.2.2) and without parsing when `redirect_uri` is absent. `reference-deviation` candidate. |
| `device/slow-down-on-fast-polling` | Python passes; Rust returns `authorization_pending` instead of `slow_down` (reference-deviation candidate). |
| `assertions/single-jwt` | Seed `client-a` is not allowed jwt-bearer; needs `client-jwt` and runner-signed assertion rewrite. |

New cross-SUT deviation found: both Rust and Python require `response_type` on `/oauth/authorize` when `request_uri` is used (RFC 9126 4 requires only `client_id` + `request_uri`); both also consume the `request_uri` on the unauthenticated pre-login GET, so a login redirect burns it. The single-use scenario works around both.
