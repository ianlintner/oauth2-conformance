# Core profile coverage register

This file records, per core-profile requirement, whether it has a stable
scenario, a draft scenario awaiting a part-3/3 runner/SUT feature, or a
documented non-coverage reason. It is the source of truth the acceptance gate
flags from; regenerate the coverage table with:

    cd runner && pnpm conformance coverage --scenarios ../scenarios \
      --requirements ../requirements --profiles ../profiles --profile core --min 0

## Documented non-coverage (no scenario by design)

These requirements carry no scenario because they are either RFC MAYs or
implementation-specific policy, never a server conformance MUST. Each reason is
below; the runner's coverage gate is computed over all core requirements, so
these remain outside the stable set and are absent from the CI ratchet.

| Requirement | Level | Reason |
|---|---|---|
| RFC8252-8.12-as-may-block-embedded-user-agent | MAY | The MUST NOT binds native apps, not the server; blocking is optional. |
| RFC9700-2.6-http-upgrade-redirect-308 | MAY | Implementation-specific inbound HTTP-to-HTTPS redirect policy, not an RFC MUST. |
| RFC9700-2.6-https-enforcement-disableable | MAY | Implementation configuration (local development), not an RFC MUST. |
| RFC9700-4.13-forwarded-proto-trusted | MAY | Reverse-proxy policy; RFC covers proxy sanitization, not X-Forwarded-Proto semantics. |
| RFC9700-4.13-forwarded-proto-untrusted | SHOULD | Implementation consequence of §4.13, not a literal server requirement. |

## Draft scenarios awaiting part 3/3 runner/SUT extensions

Each cites the feature it needs and the runner gap. Promote to `stable` when
the listed gap lands (see the part-3/3 card) and the Rust reference (and the
Python port where its interface exists) passes.

| Scenario | Requirements | Missing feature |
|---|---|---|
| core.authorize.code-issued | RFC6749-4.1.2-authorization-code-issued, RFC6749-4.1.2-state-echoed, RFC9207-2-iss-on-success, RFC9207-2.1-iss-form-urlencoded | login-and-authorize short-circuits on the login-page redirect; `with.loginPath` is not in the SUT contract; no raw-location/encoding assertion for the wire form of `iss`. |
| core.token.* (code exchange, PKCE verify) | RFC6749-4.1.3-code-exchange-succeeds / -redirect-uri-mismatch / -invalid-client, RFC7636-4.1-verifier-length / 4.2-s256-supported / 4.3-* / 4.6-s256-verify | Authorization-code acquisition (login-and-authorize short-circuit), then a `{{code}}` interpolation into a token exchange. |
| core.hardening.code-single-use | RFC6749-4.1.3-code-single-use, RFC6749-10.5-code-single-use, RFC9700-2.1.1-code-replay-rejected, RFC9700-2.1.1-code-replay-revokes-tokens | Code acquisition plus a token-introspection revocation check (v0.2 token-lifecycle scope). |
| core.authorize.require-state | RFC9700-4.7-require-state-* | Per-client `require_state` flag is not modelled in the seed schema. |

## Runner gap list (from coding part 2/3; carried into part 3/3)

1. `login-and-authorize` returns the first 3xx, so a SUT that redirects an
   unauthenticated authorize request to its login page is reported as that
   login redirect and credentials are never submitted.
2. `with.loginPath` is not declared by the SUT contract (the Rust reference
   uses `/auth/login`).
3. No `expect.redirect` raw-Location or form-urlencoding assertion, so the
   wire form of `iss` (RFC 9207 §2.1) cannot be checked, only the decoded value.
4. The seed schema has no per-client `require_state` (or equivalent) setting.
5. The runner/seed contract has no scheme/enforcement toggle to model
   HTTP-to-HTTPS upgrade or X-Forwarded-Proto proxy behavior.

None of these are implemented in this card; each is deferred to part 3/3
(t_26ac24c5).
