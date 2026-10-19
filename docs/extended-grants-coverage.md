# extended-grants coverage (contract v0.4 2/3)

51 scenarios, 51 invariants. Stable: 4. Draft: 47.

Draft scenarios document runner/SUT gaps; they are not claimed as passing. See docs/extended-grants-gaps.md for the part 3/3 list.

| scenario | status | requirements |
|---|---|---|
| extended-grants.device.authz-tls | draft | RFC8628-3.1-device-authz-tls |
| extended-grants.device.empty-and-unknown-params | draft | RFC8628-3.1-empty-params-ignored |
| extended-grants.device.repeated-param-rejected | draft | RFC8628-3.1-params-not-repeated |
| extended-grants.device.unknown-client | stable | RFC8628-3.1-unknown-client-rejected |
| extended-grants.device.response-members | draft | RFC8628-3.2-response-members, RFC8628-3.2-interval-positive-integer |
| extended-grants.device.token-request-grant-type | draft | RFC8628-3.4-token-request-grant-type |
| extended-grants.device.authorization-pending | draft | RFC8628-3.5-authorization-pending |
| extended-grants.device.slow-down-on-fast-polling | draft | RFC8628-3.5-slow-down-interval, RFC8628-3.5-slow-down-on-fast-polling |
| extended-grants.device.access-denied | draft | RFC8628-3.5-access-denied |
| extended-grants.device.expired-token | draft | RFC8628-3.5-expired-token |
| extended-grants.device.approved-success | draft | RFC8628-3.5-approved-success |
| extended-grants.device.discovery-endpoint | stable | RFC8628-4-discovery-device-endpoint |
| extended-grants.par.endpoint-form-post | draft | RFC9126-2-par-endpoint-https |
| extended-grants.par.client-auth-required | draft | RFC9126-2-par-client-auth |
| extended-grants.par.jwt-audience | draft | RFC9126-2-par-jwt-audience |
| extended-grants.par.request-uri-forbidden | draft | RFC9126-2.1-par-request-uri-forbidden |
| extended-grants.par.invalid-request-rejected | draft | RFC9126-2.1-par-invalid-request-rejected, RFC9126-2.3-par-error-format |
| extended-grants.par.created-response | draft | RFC9126-2.2-par-created-response, RFC9126-2.2-par-request-uri-unguessable |
| extended-grants.par.request-uri-client-bound | draft | RFC9126-2.2-par-request-uri-client-bound |
| extended-grants.par.request-uri-single-use | draft | RFC9126-2.2-par-request-uri-single-use |
| extended-grants.par.request-uri-expired | draft | RFC9126-4-par-expired-request-uri-rejected |
| extended-grants.par.metadata-endpoint | stable | RFC9126-5-par-metadata-endpoint |
| extended-grants.registration.json-post | draft | RFC7591-3-reg-endpoint-json-post, RFC7591-3-reg-endpoint-tls |
| extended-grants.registration.response-members | draft | RFC7591-3.2.1-reg-response-client-id, RFC7591-3.2.1-reg-secret-expires-at, RFC7591-3.2.1-reg-returns-metadata |
| extended-grants.registration.error-format | draft | RFC7591-3.2.2-reg-error-format |
| extended-grants.registration.management-uri-and-token | draft | RFC7592-3-reg-mgmt-uri-and-token |
| extended-grants.registration.read | draft | RFC7592-2.1-reg-read, RFC7592-2.1-reg-read-invalid-token |
| extended-grants.registration.update | draft | RFC7592-2.2-reg-update-replaces, RFC7592-2.2-reg-update-secret-not-overwritable |
| extended-grants.registration.delete | draft | RFC7592-2.3-reg-delete-204, RFC7592-2.3-reg-delete-invalid-token |
| extended-grants.jar.claims | draft | RFC9101-4-jar-claims |
| extended-grants.jar.signature-verified | draft | RFC9101-6.2-jar-signature-verified, RFC9101-6.2-jar-bad-signature-error |
| extended-grants.jar.only-request-object-params | draft | RFC9101-6.3-jar-only-request-object-params |
| extended-grants.jar.client-id-match | draft | RFC9101-6.3-jar-client-id-match |
| extended-grants.jar.alg-none-rejected | draft | RFC9101-10.5-jar-alg-none-rejected |
| extended-grants.jar.require-signed | draft | RFC9101-10.5-jar-require-signed |
| extended-grants.jar.unsigned-allowed-by-policy | draft | RFC9101-4-jar-unsigned-allowed-by-policy |
| extended-grants.rar.type-required | draft | RFC9396-2-rar-type-required |
| extended-grants.rar.unknown-type-and-fields | draft | RFC9396-5-rar-unknown-type-rejected, RFC9396-5-rar-invalid-fields-rejected |
| extended-grants.rar.token-request-and-response | draft | RFC9396-6-rar-token-request, RFC9396-7-rar-token-response |
| extended-grants.rar.introspection | draft | RFC9396-9.2-rar-introspection |
| extended-grants.rar.metadata | stable | RFC9396-10-rar-metadata |
| extended-grants.exchange.subject-token-required | draft | RFC8693-2.1-tx-grant-type, RFC8693-2.1-tx-subject-token-required |
| extended-grants.exchange.actor-token-type | draft | RFC8693-2.1-tx-actor-token-type |
| extended-grants.exchange.validate-tokens | draft | RFC8693-2.1-tx-validate-tokens |
| extended-grants.exchange.response-members | draft | RFC8693-2.2.1-tx-response-members, RFC8693-2.2.1-tx-scope-when-differs |
| extended-grants.exchange.invalid-target | draft | RFC8693-2.2.2-tx-error-invalid-request, RFC8693-2.2.2-tx-invalid-target |
| extended-grants.assertions.single-jwt | draft | RFC7523-2.2-assert-single-jwt |
| extended-grants.assertions.iss-sub-aud-exp | draft | RFC7523-3-assert-iss-sub, RFC7523-3-assert-aud, RFC7523-3-assert-exp |
| extended-grants.assertions.signature | draft | RFC7523-3-assert-signature |
| extended-grants.assertions.jti-replay | draft | RFC7523-3-assert-jti-replay |
| extended-grants.assertions.error-codes | draft | RFC7523-3.1-assert-grant-invalid-grant, RFC7523-3.2-assert-client-invalid-client |
