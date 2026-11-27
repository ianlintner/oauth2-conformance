# Social-login harness (§4 scenarios)

The `scenarios/operations/social-login/` scenarios observe only black-box
behaviour: the 302 to the identity provider (never followed by the runner) and
the provider's callback error handling. No live identity provider is contacted
and no real credentials are used.

## Preconditions

The harness gives the SUT one configured provider (`google`, with placeholder
credentials) and leaves a second, supported provider (`github`) unconfigured.
This makes `OPS-4.1-provider-not-configured` deterministic without depending on
a deployment's environment. Implementations that read provider credentials from
a config file instead of the environment must supply an equivalent config:
`google` enabled with dummy values, `github` known but without credentials.

The login step's `set-cookie` response header is replayed on later steps via
the `cookie.first` capture source, which selects the first `name=value` pair
and drops cookie attributes. Each callback scenario therefore carries the real
session created by its own login step.

`OPS-4.4-post-login-redirect-validated` needs a successful code exchange, which
in turn needs a local mock identity provider and configurable provider base
URLs. Those capabilities belong to a later C-06 ticket, so that scenario stays
`draft`.

## Rust reference command

Binary built from `ianlintner/rust-oauth2-server@e75b4cb23bcf5aa4751c4687a96a080ad261364c`
(`origin/main`). Placeholder credential values only:

```sh
OAUTH2_CONFORMANCE_MODE=1 \
OAUTH2_ENV=test \
OAUTH2_DATABASE_URL=sqlite::memory: \
OAUTH2_SERVER_PORT=18083 \
OAUTH2_JWT_SECRET=<test-only> \
OAUTH2_CONFORMANCE_SEED=<this-repo>/examples/seed.yaml \
OAUTH2_GOOGLE_CLIENT_ID=conformance-dummy-client \
OAUTH2_GOOGLE_CLIENT_SECRET=conformance-dummy-secret \
  rust_oauth2_server
```

Then, from `runner/`:

```sh
pnpm conformance run --base-url http://127.0.0.1:18083 \
  --scenarios ../scenarios/operations/social-login \
  --profile operations --implementation rust-oauth2-server \
  --report <scratch>/social-login-report.json
```
