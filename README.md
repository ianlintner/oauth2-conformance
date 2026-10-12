# oauth2-conformance

Language-neutral contract for OAuth2/OIDC authorization servers: a requirements catalog traced to RFC clauses, black-box conformance scenarios, and a single runner that every server implementation must pass.

Implementations: [`rust-oauth2-server`](https://github.com/ianlintner/rust-oauth2-server) (reference), [`python-oauth2-server`](https://github.com/ianlintner/python-oauth2-server), [`typescript-oauth2-server`](https://github.com/ianlintner/typescript-oauth2-server), [`go-oauth2-server`](https://github.com/ianlintner/go-oauth2-server).

**Status:** early bootstrap. This repository contains a requirements catalog (`requirements/`), profiles (`profiles/`), YAML scenarios (`scenarios/`), JSON Schemas for all of them (`schemas/`), a pinned Rust route inventory (`reference/rust-routes.yaml`) and a TypeScript runner (`runner/`) that executes scenarios against a base URL. The `core` profile has stable scenarios; the `pkce` and `hardening` profiles and some imported authorization-code scenarios are `draft` (they need a seeded system under test and have not been validated against any implementation). Draft scenarios are reported as deferred and count neither toward a passing verdict nor toward coverage. No implementation has been run against this suite here, so nothing in this repository claims that any server conforms, and passing it would not imply certification by any standards body.

CI runs the runner's typecheck, lint and tests, validates every data file against `schemas/*.json` (JSON Schema 2020-12 via `ajv`), and gates `core` profile coverage by stable scenarios. See [`docs/architecture-proposal.md`](docs/architecture-proposal.md) and the milestone plan in [`docs/ROADMAP.md`](docs/ROADMAP.md).
