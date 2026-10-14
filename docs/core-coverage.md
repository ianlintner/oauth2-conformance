# Core profile coverage register

This file records, per core-profile requirement, whether it has a stable
scenario, a draft scenario awaiting a runner/SUT feature, a reference-deviation
scenario, or a documented non-coverage reason. Regenerate the coverage table
with:

    cd runner && pnpm conformance coverage --scenarios ../scenarios \
      --requirements ../requirements --profiles ../profiles --profile core --min 0

Scenario statuses used by the core profile:

- `stable`: fixture complete and passing against the pinned Rust reference.
  Counts toward the coverage gate.
- `reference-deviation`: fixture complete and RFC-correct, but the Rust
  reference fails it. The RFC wins over Rust, so the scenario is kept, the
  runner defers it (not a failure, not stable coverage) and the justification is
  recorded below. It becomes `stable` when Rust is fixed.
- `draft`: needs a runner/SUT-interface feature or a contract decision.

## Documented non-coverage (no scenario by design)

These requirements carry no scenario because they are either RFC MAYs or
implementation-specific policy, never a server conformance MUST. The runner's
coverage gate is computed over all core requirements, so these remain outside
the stable set and are absent from the CI ratchet.

| Requirement | Level | Reason |
|---|---|---|
| RFC8252-8.12-as-may-block-embedded-user-agent | MAY | The MUST NOT binds native apps, not the server; blocking is optional. |
| RFC9700-2.6-http-upgrade-redirect-308 | MAY | Implementation-specific inbound HTTP-to-HTTPS redirect policy, not an RFC MUST. |
| RFC9700-2.6-https-enforcement-disableable | MAY | Implementation configuration (local development), not an RFC MUST. |
| RFC9700-4.13-forwarded-proto-trusted | MAY | Reverse-proxy policy; RFC covers proxy sanitization, not X-Forwarded-Proto semantics. |
| RFC9700-4.13-forwarded-proto-untrusted | SHOULD | Implementation consequence of section 4.13, not a literal server requirement. |

## Still-uncovered requirements (need an owner-gated extension)

| Requirement | Level | Missing extension |
|---|---|---|
| RFC9207-2.1-iss-form-urlencoded | MUST | An `expect.redirect` raw-Location / form-encoding assertion for the wire form of `iss`. Runner feature, not a SUT change. Folded out of core.authorize.code-issued, which now only asserts the decoded `iss`. |
| RFC9700-2.1.1-code-replay-revokes-tokens | SHOULD | A token-introspection step after the replay (v0.2 token-lifecycle scope). Removed from core.hardening.code-single-use, which asserts rejection only. |

## Draft scenarios

| Scenario | Requirements | Missing feature |
|---|---|---|
| core.authorize.require-state | RFC9700-4.7-require-state-* | Per-client `require_state` flag is not modelled in the seed schema (SUT interface change; owner-gated because all four ports must implement it; see "SUT interface changes" below). |
| core.token.error-no-store | RFC6749-5.1-no-store | Contract decision, see the attribution section below. Demoted from stable: RFC 6749 5.1 states no-store for successful token responses only, so asserting it on errors is not an RFC MUST. |

## Reference deviations (RFC wins over Rust)

Eight scenarios fail against the Rust reference. Seven fail for RFC-grounded
reasons and one (`core.pkce.plain-method-rejected`) enforces local S256-only
policy whose rejection is not an RFC MUST (see the note below). Each is
`status: reference-deviation`; none is demoted to draft.

| Scenario | RFC basis | Rust behavior |
|---|---|---|
| core.authorize.error-redirect-iss, response-type-missing, response-type-unsupported | RFC 6749 4.1.2.1 (error returned by redirect once client_id and redirect_uri validate); RFC 9207 2 (iss on error) | 400 JSON on the authorize endpoint, no redirect. |
| core.pkce.missing-challenge, method-without-challenge | RFC 7636 4.4.1 (when PKCE is required, a missing `code_challenge` yields invalid_request on the redirect) | 400 JSON on the authorize endpoint, no redirect. |
| core.token.basic-auth-success | RFC 6749 2.3.1 (client id and secret MUST be form-urlencoded before Basic encoding) | 401 for the form-urlencoded form; accepts the raw unencoded form. |
| core.token.dual-auth-rejected | RFC 6749 2.3 (clients MUST NOT use more than one authentication method), 5.2 invalid_request | 200 when credentials arrive in both header and body. |

core.pkce.plain-method-rejected is a deliberate exception: rejecting `plain`
altogether is the reference's local S256-only policy (RFC 7636 4.2 makes `plain`
a server MAY to support), not an RFC MUST. It is kept as `reference-deviation`
rather than `stable` because the reference does not itself pass it, and rather
than `draft` because the fixture is a correct conformance check for the profile's
S256-only stance. Its `method-without-challenge` sibling's cited requirement
(RFC7636-4.2-method-without-challenge) does not cover a method sent without a
challenge; the RFC basis is RFC 7636 4.4.1 (missing `code_challenge` when PKCE
is required), listed above.

## Hardening profile

`profiles/hardening.yaml` lists RFC6749-4.1.3-wrong-redirect-uri and
RFC9700-4.5-code-replay (both MUST). Both scenarios are draft (no stable
coverage, 0 stable of 2); `coverage --profile hardening` reports them as
PROVISIONAL ONLY, not uncovered, and `runner/test/coverage-gate.test.ts` fails
if either loses its scenario. They are outside the core profile and not
promoted by this card.

core.token.wrong-redirect-uri is the only scenario for
RFC6749-4.1.3-wrong-redirect-uri. core.token.code-redirect-uri-mismatch cites a
different requirement (RFC6749-4.1.3-redirect-uri-mismatch, core); both stay.

## RFC6749-5.1-no-store attribution

RFC 6749 section 5.1 states the Cache-Control no-store / Pragma no-cache MUST
for responses containing tokens, credentials or other sensitive information,
i.e. success responses. The section 5.2 error example shows the same headers
but states no separate MUST. core.token.success-no-store is the genuine
attribution of the MUST; core.token.error-no-store asserted an error-response
header as an RFC MUST, which the RFC does not say, so it is draft.

Decision for the contract owner: either (a) add a distinct requirement for
error-response cacheability at level SHOULD/policy and re-attribute
error-no-store to it, or (b) accept it as a conservative MUST. Until decided,
Rust omitting Cache-Control on error responses is not an RFC violation.

## Runner and SUT-interface changes (part 3/3)

Landed in this card:

1. Session reuse in `login-and-authorize`: the runner logs in once per user per
   run and replays the session cookie. Runner-only, no SUT interface change.
   Reason: SUTs rate limit logins (the Rust reference answers
   `/auth/login?error=too_many_attempts` after about 8 logins), which made
   `code-exchange-succeeds` and `code-wrong-client-auth` pass alone but fail in
   a full core run. A refused login now fails the scenario with the SUT's
   redirect in the error instead of being mistaken for a code-less
   authorization result.
2. Scenarios needing an authorization code (code-issued, token exchange, PKCE
   verify, code single-use) are promoted to stable; they use `{{code}}`
   capture/interpolation already in the runner.

SUT interface changes (owner-gated; not implemented here):

- `with.loginPath`: the login form path (`/auth/login` on the Rust reference)
  is a scenario parameter, not declared in `contract/sut-interface.md`. Proposed:
  declare the login endpoint and its `username`/`password` fields in the SUT
  contract so all four ports implement the same form.
- `require_state`: a per-client seed setting (`examples/seed.yaml`
  `clients[].require_state`) so core.authorize.require-state can select an
  enforcing client. Every port must implement it.
- No scheme/enforcement toggle exists for HTTP-to-HTTPS upgrade or
  X-Forwarded-Proto behavior; those requirements stay documented non-coverage.

## Validation against the Rust reference

Measured on a freshly started seeded Rust SUT (PR 424), conformance mode, with
the public URL set to `http://localhost:8080` (`OAUTH2_PUBLIC_URL` and
`OAUTH2_SERVER_PUBLIC_BASE_URL` both set) so its issuer equals the seed's
`issuer`; full `conformance run --profile core`:
executed=43 passed=33 failed=0 deferred=10 (8 reference-deviation, 2 draft).
Measure against a fresh SUT per run: a long-lived instance degrades across
repeated runs (SQLite in-memory pool "no such table", login rate limit).

Python port: its repository has no conformance-mode SUT interface (no seed
loader), so core was not run against it; this card comments that on its v0.1
core card.

Stable core coverage is 36/55 = 65.5%. CI gates `--min 65.5` (the recorded
floor, `CORE_STABLE_FLOOR = 36`); `runner/test/coverage-gate.test.ts` proves a
removed stable fixture fails the gate. CI (`runner.yml`) still does not start a
SUT: a SUT job (build the Rust SUT in conformance mode, seed it, run
`conformance run --profile core`) is a follow-up.

Reference-deviation scenarios (listed for the register test):

- core.authorize.error-redirect-iss
- core.authorize.response-type-missing
- core.authorize.response-type-unsupported
- core.pkce.method-without-challenge
- core.pkce.missing-challenge
- core.pkce.plain-method-rejected
- core.token.basic-auth-success
- core.token.dual-auth-rejected

### Citation discrepancy (follow-up, ids unchanged)

`RFC9700-4.5-code-replay` (hardening) cites RFC 9700 section 4.5, which is
"Authorization Code Injection". Code replay rejection is RFC 6749 4.1.2 /
10.5 and RFC 9700 2.1.1 / 4.2.4 (the core scenario already cites 2.1.1). A
separate requirement follow-up should re-cite or re-id it.
