# OAuth2 conformance contract — architecture proposal

Status: proposed, not implemented.

## Problem

Every OAuth2/OIDC server port (`rust-oauth2-server` reference, `python-oauth2-server`, `typescript-oauth2-server`, `go-oauth2-server`, future languages) has to behave the same way on the wire and enforce the same security rules. Today the TypeScript port holds the only fixtures, matrix and runner, and the Go port would copy them. Copies drift, each port re-derives the RFC requirements from Rust tests, and nothing measures whether two ports implement the same contract.

This repository becomes the **single, versioned, language-neutral contract**. A server is conformant to a contract version and profile if and only if the contract's runner passes against it. Implementations are interchangeable; the contract is the product. When the contract changes, each language gets a mechanical "bump and make it pass" task an agent can execute.

## Prior art this follows

- **Black-box protocol suites** (OpenID Foundation conformance suite, Kubernetes conformance/Sonobuoy): one test runner, talks to the system under test (SUT) only over the network, certifies by profile.
- **Data-first shared suites** (JSON-Schema-Test-Suite, Web Platform Tests): test cases are data with stable IDs, reviewed like code, consumed by many implementations.
- **Requirements traceability** (RFC 2119 levels mapped to test IDs): every normative requirement has an ID, every scenario cites the requirements it proves, coverage gaps are computed, not guessed.
- **Contract testing / API description** (OpenAPI): wire shapes are declared once and checked, not re-described per language.

## Design principles

1. **Black box only.** The runner never imports implementation code and never reads its database. Anything it needs (seeded clients, a test user login, clock) goes through a documented SUT interface.
2. **Data over code.** Requirements and scenarios are declarative YAML validated by JSON Schema. Adding a test case should not require touching the runner.
3. **One runner.** Shared semantics (step chaining, normalization, redirect capture, PKCE/DPoP helpers) live in one tested implementation. Ports never re-implement the harness.
4. **Reference-validated.** A scenario is `stable` only after it passes against the pinned Rust reference, or carries a recorded `reference-deviation` where Rust is wrong and the RFC wins. The Python port (`python-oauth2-server`, FastAPI, most feature-complete port, RFC tests ported 1:1 from Rust, shares Rust's SQL schema) is the second validation target: a scenario that passes on Rust but fails on Python, or vice versa, is reviewed before promotion.
5. **No false PASS.** The runner's own CI proves that mismatches, missing setup and all-skipped suites fail with a nonzero exit (lesson from the TS harness, PRs #3/#5).
6. **RFC beats reference.** Where Rust diverges from an RFC, the contract encodes the RFC and records the Rust deviation. Never silently copy unsafe behavior.

## Repository layout

```
requirements/            # normative catalog, one file per spec
  rfc6749.yaml           # REQ ids, level (MUST/SHOULD/MAY), clause, summary, profile, link
  rfc7636.yaml  rfc9700.yaml  rfc9207.yaml  oidc-core.yaml ...
scenarios/               # black-box test cases, grouped by profile
  core/authorization-code/*.yaml
  core/pkce/*.yaml
  ...
profiles/                # profile definitions: which requirements/scenarios each profile includes
  core.yaml  token-lifecycle.yaml  oidc-basic.yaml  device.yaml  par.yaml
  dcr.yaml  dpop.yaml  mtls.yaml  agent.yaml
contract/
  openapi.yaml           # wire contract for profiled endpoints (seeded from Rust crates/oauth2-openapi)
  sut-interface.md       # what every server must expose to be testable (see below)
  implementation-manifest.schema.json
schemas/                 # JSON Schema 2020-12 for requirement, scenario, profile, manifest, report files
runner/                  # the single conformance runner (TypeScript, extracted from typescript-oauth2-server)
reference/               # pinned Rust reference image + seed used by CI
docs/
  PORTING.md             # language-port playbook and lessons learned
  CHANGELOG.md           # contract changes, semver
```

## Formats

**Requirement** (`requirements/rfc7636.yaml`):

```yaml
- id: RFC7636-4.6-S256-VERIFY
  spec: RFC 7636
  clause: "4.6"
  level: MUST
  profile: core
  summary: Token endpoint rejects a code_verifier whose S256 transform does not equal the stored code_challenge.
  link: https://www.rfc-editor.org/rfc/rfc7636#section-4.6
```

RFC text is linked and summarized, not copied wholesale.

**Scenario** (`scenarios/core/pkce/wrong-verifier.yaml`): ordered steps with captures, evolved from the TS fixture format (`request`/`expect`/`bind`).

```yaml
id: core.pkce.wrong-verifier
requirements: [RFC7636-4.6-S256-VERIFY, RFC6749-5.2-INVALID-GRANT]
profile: core
status: stable            # draft | stable | reference-deviation | retired
steps:
  - id: authorize
    use: login-and-authorize          # runner helper: test-user login + /oauth/authorize, captures redirect
    with: { client: public-pkce, pkce: { method: S256, verifier: "{{gen.verifier}}" } }
    capture: { code: redirect.query.code, iss: redirect.query.iss }
  - id: exchange-wrong-verifier
    request:
      method: POST
      path: /oauth/token
      form: { grant_type: authorization_code, code: "{{authorize.code}}",
              client_id: public-pkce, redirect_uri: "{{clients.public-pkce.redirect_uri}}",
              code_verifier: "{{gen.other_verifier}}" }
    expect:
      status: 400
      headers: { cache-control: no-store }
      json: { error: invalid_grant }
```

Expectations assert declared status/headers/claims and JSON-Schema shape; undeclared fields are ignored; only named nondeterministic fields are normalized (TS harness semantics).

**Implementation manifest** (`conformance.yaml`, lives in each port repo):

```yaml
implementation: go-oauth2-server
contract: 0.3.0                 # pinned contract version
profiles: [core]                # profiles claimed; CI fails if any claimed scenario fails
deviations:                     # explicit, reviewed, requirement-scoped
  - requirement: RFC9700-2.1-SENDER-CONSTRAINED
    reason: DPoP profile not yet implemented
    until: 0.5.0
```

## SUT interface (what every server must provide)

The TS fixtures are mostly `deferred` because there was no way to set up state black-box. The contract fixes that with a minimal, test-mode-only interface each port implements:

- Start with a **seed file** (`OAUTH2_CONFORMANCE_SEED=/path/seed.yaml`) declaring clients (confidential/public, redirect URIs, auth methods, scopes), users, issuer and signing keys. Seed schema lives in `schemas/`.
- A **non-interactive test login** usable by the authorization endpoint (e.g. form POST with seeded credentials and a consent auto-approve for seeded clients). Enabled only when conformance mode is on; startup must fail closed if conformance mode is enabled with a production profile.
- Optional **clock control** endpoint for expiry scenarios, otherwise those scenarios use short configured TTLs.
- Health/readiness endpoint the runner waits on.

The Rust reference gets the same interface first (it already has seed-admin env vars); the Python port follows as the second implementation. Each is a scoped PR on its own repository.

## Runner

Extract the reviewed TypeScript harness from `typescript-oauth2-server` (`src/conformance/*`, 72 tests) rather than rewriting it: lower risk, its semantics are already reviewed. Extend it with YAML loading, redirect/`Location` capture, cookie jar sessions, generated PKCE/state/nonce values, requirement coverage and profile selection. Later helpers: DPoP proof signing, mTLS client certs.

Distributed three ways so no port needs a Node toolchain: an OCI image (`ghcr.io/ianlintner/oauth2-conformance:<version>`), a reusable GitHub Action, and an npm package. Output: human summary, JSON report and JUnit XML. Exit nonzero on any failing claimed scenario, any unknown deviation, or an empty run.

## Versioning and change flow

- Semver tags on the contract. New scenario in an existing profile = minor. Tightened expectation or new MUST in a profile = major for that profile. Runner-only fixes = patch.
- Contract CI on every PR: schema validation of all files, requirement↔scenario coverage report, runner unit tests, runner false-PASS self-tests, and a full run against the pinned Rust reference image.
- On release, each port has a mechanical task: bump `contract:` in `conformance.yaml`, run, implement until green or record a reviewed deviation. These become Kanban cards per language from a template in `docs/PORTING.md`.
- A compatibility matrix (implementation × profile × version) is published from the ports' CI reports.

## Behavioral contract (beyond OpenAPI)

OpenAPI only fixes the wire shape: paths, parameters, status codes, body schemas. It cannot say "a code redeems at most once", "replaying a rotated refresh token kills the whole family", or "a revoked token is inactive at introspection". That backend logic is the part ports get wrong, so the contract specifies it in layers, each observable black-box through protocol endpoints (token, introspection, revocation, userinfo, JWKS) rather than by reading the SUT's storage:

1. **Wire shape — OpenAPI.** Response bodies/headers validated against `contract/openapi.yaml`. Necessary, not sufficient.
2. **Example scenarios — hand-written YAML.** Concrete happy and negative paths tied to requirement IDs (above). Readable, reviewable, the primary contract for agents.
3. **Invariants — named properties.** Each security rule is stated once as a property with a requirement ID and an observation recipe, e.g. `INV-CODE-SINGLE-USE`: for any code, at most one token exchange succeeds, and after a second attempt tokens issued from it are inactive at introspection. Invariants are checked across every scenario run and every generated trace, not just in the one scenario that motivated them.
4. **Model-based (stateful property) testing.** A small executable reference model of the abstract server state (clients, codes, token families, consents, revocations, clock) lives in the runner. The runner generates random command sequences (authorize, exchange, refresh, replay, revoke, introspect, advance clock), runs them against the SUT, and checks each response against the model's prediction and the invariants; failures shrink to a minimal reproducing sequence, which can be committed as a new example scenario. Prior art: QuickCheck state-machine testing, `fast-check` model-based commands, Hypothesis stateful testing. Randomized runs use a recorded seed so failures replay deterministically.
5. **Concurrency properties.** Race scenarios issue parallel requests (same code redeemed N times, same refresh token rotated concurrently) and require exactly one success. Catches non-atomic storage that sequential tests miss.
6. **Differential testing.** The same generated sequence runs against the Rust reference and each port (Python first, being the most complete); normalized outcomes must match except for recorded deviations. Disagreement flags either a port bug or a reference bug for review.
7. **External oracles.** For OIDC/FAPI profiles, run the OpenID Foundation's open-source conformance suite (self-hostable) as an additional gate instead of re-encoding everything ourselves. Optional later: a formal model of the core code/refresh state machine (TLA+ or Quint) to model-check invariants and keep the executable model honest.

Not every layer ships at once. Stage 1 ships layers 1–3; the model-based, concurrency and differential layers are a research spike that must first prove they find real bugs (seeded-mutant tests: deliberately broken SUT variants such as non-atomic code redemption must be caught) before becoming a CI gate.

## Port playbook (`docs/PORTING.md`)

Captures what porting taught us, as normative guidance with requirement IDs where applicable: security state (PAR request URIs, DPoP replay/nonce, rate limits, key rotation, events) must live in shared persistence, not process memory, or multi-replica deployments break single-use guarantees (the Python port is pinned to one replica until this is fixed); reject duplicated OAuth parameters before parsing; atomic one-time code redemption; refresh-token family revocation on replay; persist signing keys, never regenerate on restart; fail closed on missing secrets/issuer or insecure production settings; no implicit/ROPC; never claim compliance from endpoint stubs; prove the CLI wires failures into the exit code. Plus the language-port Kanban sequence: architecture approval → CI bootstrap with contract runner → skeleton + SUT interface → profile waves.

## Migration and staging

1. **Contract repo bootstrap:** schemas, requirement + scenario formats, extracted runner with self-tests, CI. Port the existing 5 TS fixtures and the 94-entry Rust route inventory.
2. **Core profile:** requirements catalog for RFC 6749/7636/9207/9700 core and stable scenarios, derived from the Rust tests and the Python port's 1:1 ported RFC tests, validated against Rust and Python once their SUT interfaces land.
3. **Rust reference SUT interface:** seed file + test login on `rust-oauth2-server`; contract CI runs against its image.
4. **Consumers:** Python port adds a `conformance.yaml` manifest and runs the contract in CI alongside its own tests; TypeScript port replaces its in-repo harness with the contract runner; Go port's CI bootstrap consumes the contract instead of vendoring TS fixtures.
5. **Further profiles:** token-lifecycle, oidc-basic, then device/PAR/DCR, DPoP/mTLS, agent, each with negative security scenarios.

## Decisions for owner

1. Repo name `oauth2-conformance`, public, MIT.
2. YAML + JSON Schema for requirements/scenarios/manifests; OpenAPI for wire shapes.
3. Runner extracted from the TS harness (TypeScript), shipped as OCI image + GitHub Action + npm package.
4. Test-mode SUT interface (seed file + non-interactive test login), added to Rust first.
5. Go port's CI bootstrap waits for contract stage 1 instead of vendoring TS fixtures.
6. Behavioral layers: ship OpenAPI + example scenarios + invariants first; run a research spike on model-based, concurrency and differential testing (with mutant SUTs) before making them gates.
