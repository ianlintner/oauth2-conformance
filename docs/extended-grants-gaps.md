# extended-grants runner/SUT gaps (draft, part 3/3)

The extended-grants profile ships 51 scenarios and 51 named invariants. All are `draft`; nothing has been validated against a running SUT. They enumerate the concrete runner and SUT features part 3/3 must add before they can promote to stable and produce passing black-box runs. This list is the explicit draft scope for the next card; nothing here is claimed to pass today.

## Runner features (missing today)

1. Device-flow seed client. A `client-dev` OAuth 2.0 client with `client_secret_basic` and the device grant, injected by the seed so the SUT issues a real device_code. Today the SUT only seeds `client-a`/`client-enc` authorization-code clients.
2. Verification-page driver. A step helper that opens `verification_uri`, submits `user_code`, and either approves or denies. Needed for `access-denied`, `approved-success`.
3. Token-poll helper with interval awareness. A step helper that polls `/oauth/token` on an interval and can assert the server enforces `interval` (RFC 8628 slow_down: +5 seconds on and after a slow_down). Also needs SUT clock/time control to make `expired_token` (RFC 8628) and `expired request_uri` (RFC 9126 4) deterministic.
4. Duplicate form-key transport. The runner `form` model is a key→value map and cannot send a repeated parameter. `params-not-repeated` cannot be exercised until a duplicate-key query/body shape exists; the draft is a placeholder.
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
