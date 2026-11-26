/**
 * SUT interface v2: schema checks for the seed additions and the capability
 * advertisement, plus a black-box CLI self-test proving `--sut-config` and the
 * v2 helpers are wired into the process exit status (known match / known mismatch).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { parse as parseYaml } from 'yaml';

const runnerDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(runnerDir, '..');

async function validator(file: string): Promise<(data: unknown) => boolean> {
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
  (addFormatsModule as unknown as (a: Ajv2020) => void)(ajv);
  return ajv.compile(JSON.parse(await readFile(path.join(repoRoot, 'schemas', file), 'utf8')) as object);
}

const CA_PEM = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n';

async function baseSeed(): Promise<Record<string, unknown>> {
  return parseYaml(await readFile(path.join(repoRoot, 'examples', 'seed.yaml'), 'utf8')) as Record<string, unknown>;
}

test('seed schema accepts a tls_client_auth client and a seeded client CA', async () => {
  const valid = await validator('seed.schema.json');
  const seed = await baseSeed();
  assert.equal(valid(seed), true, 'existing example seed stays valid (additive change)');
  (seed.clients as unknown[]).push({
    client_id: 'client-mtls',
    token_endpoint_auth_method: 'tls_client_auth',
    tls_client_auth_subject_dn: 'CN=client-mtls',
    tls_client_certificate_bound_access_tokens: true,
    redirect_uris: ['https://client.example/callback'],
  });
  seed.mtls = { client_ca: CA_PEM };
  assert.equal(valid(seed), true);
});

test('seed schema accepts OIDC logout registration fields and rejects fragments', async () => {
  const valid = await validator('seed.schema.json');
  const seed = await baseSeed();
  const client = (seed.clients as Record<string, unknown>[])[0] as Record<string, unknown>;
  Object.assign(client, {
    post_logout_redirect_uris: ['https://client.example/logout'],
    backchannel_logout_uri: 'http://127.0.0.1:8099/backchannel-logout',
    backchannel_logout_session_required: true,
    frontchannel_logout_uri: 'http://127.0.0.1:8099/frontchannel',
    frontchannel_logout_session_required: true,
  });
  assert.equal(valid(seed), true);
  for (const field of ['post_logout_redirect_uris', 'backchannel_logout_uri', 'frontchannel_logout_uri'] as const) {
    const bad = structuredClone(seed) as Record<string, unknown>;
    const badClient = (bad.clients as Record<string, unknown>[])[0] as Record<string, unknown>;
    badClient[field] = field === 'post_logout_redirect_uris'
      ? ['https://client.example/logout#fragment']
      : 'javascript:alert(1)';
    assert.equal(valid(bad), false, `${field} must reject a fragment or non-http(s) scheme`);
  }
});

test('seed schema rejects tls_client_auth without a subject DN or with a secret, and a private key in mtls.client_ca', async () => {
  const valid = await validator('seed.schema.json');
  const withClient = async (client: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const seed = await baseSeed();
    (seed.clients as unknown[]).push({ client_id: 'client-mtls', redirect_uris: ['https://c.example/cb'], token_endpoint_auth_method: 'tls_client_auth', ...client });
    return seed;
  };
  assert.equal(valid(await withClient({})), false, 'subject DN is required');
  assert.equal(valid(await withClient({ tls_client_auth_subject_dn: 'CN=x', client_secret: 's' })), false, 'no shared secret on a certificate-authenticated client');
  const keyed = await baseSeed();
  keyed.mtls = { client_ca: `${CA_PEM}-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n` };
  assert.equal(valid(keyed), false, 'seed never carries private key material');
  const notCert = await baseSeed();
  notCert.mtls = { client_ca: 'hello' };
  assert.equal(valid(notCert), false);
});

test('capabilities schema: each capability is independent and its companion fields are enforced', async () => {
  const valid = await validator('sut-capabilities.schema.json');
  assert.equal(valid({ interface_version: 2, capabilities: [] }), true, 'a SUT may advertise nothing');
  assert.equal(valid({ interface_version: 2, capabilities: ['test-clock', 'dpop-nonce-mode', 'restart'] }), true);
  assert.equal(valid({ interface_version: 2, capabilities: ['mtls'], mtls: { base_url: 'https://127.0.0.1:8443' } }), true);
  assert.equal(valid({ interface_version: 2, capabilities: ['multi-instance'], instances: ['http://127.0.0.1:8081', 'http://127.0.0.1:8082'] }), true);
  assert.equal(valid({ interface_version: 2, capabilities: ['mtls'] }), false, 'mtls requires its listener origin');
  assert.equal(valid({ interface_version: 2, capabilities: [], mtls: { base_url: 'https://x' } }), false, 'unadvertised capability details are rejected');
  assert.equal(valid({ interface_version: 2, capabilities: ['multi-instance'], instances: ['http://a'] }), false, 'multi-instance needs two instances');
  assert.equal(valid({ interface_version: 2, capabilities: ['time-travel'] }), false);
  assert.equal(valid({ interface_version: 1, capabilities: [] }), false);
  assert.equal(valid({ interface_version: 2, capabilities: ['restart', 'restart'] }), false);
});

// ---- CLI black-box --------------------------------------------------------

function cli(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], { cwd: runnerDir });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

/** A fake SUT whose `/protected` endpoint only answers 200 once its clock has been advanced >= 600s. */
function clockServer(honorClock: boolean): Promise<{ server: Server; url: string }> {
  let offset = 0;
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c: Buffer) => (raw += c.toString()));
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        if (req.method === 'POST' && req.url === '/conformance/clock') {
          if (!honorClock) {
            res.statusCode = 404;
            res.end('{}');
            return;
          }
          offset += (JSON.parse(raw) as { advance_seconds: number }).advance_seconds;
          res.end(JSON.stringify({ offset }));
          return;
        }
        res.statusCode = offset >= 600 ? 200 : 400;
        res.end(JSON.stringify({ expired: offset >= 600 }));
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }));
  });
}

async function scenarioDir(status: 'stable' | 'draft'): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'sutv2-'));
  await mkdir(path.join(dir, 'scenarios'), { recursive: true });
  await writeFile(
    path.join(dir, 'scenarios', 'a.yaml'),
    [
      'id: selftest.sut-v2-clock',
      'requirements: [RFC8628-3.5-expired-token]',
      'profile: extended-grants',
      `status: ${status}`,
      'steps:',
      '  - id: advance',
      '    use: advance-clock',
      '    with: { seconds: 601 }',
      '    expect: { status: 200 }',
      '  - id: after',
      '    request: { method: GET, path: /protected }',
      '    expect: { status: 200, json: { expired: true } }',
      '',
    ].join('\n'),
  );
  return path.join(dir, 'scenarios');
}

test('CLI exits 0 when the SUT honors advance-clock (known match)', async () => {
  const { server, url } = await clockServer(true);
  try {
    const result = await cli(['run', '--base-url', url, '--scenarios', await scenarioDir('stable')]);
    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /PASS selftest\.sut-v2-clock/);
  } finally {
    server.close();
  }
});

test('CLI exits 1 when the SUT lacks the clock capability, and a draft scenario is only deferred (known mismatch)', async () => {
  const { server, url } = await clockServer(false);
  try {
    const stable = await cli(['run', '--base-url', url, '--scenarios', await scenarioDir('stable')]);
    assert.equal(stable.code, 1, stable.stdout + stable.stderr);
    assert.match(stable.stdout, /FAIL selftest\.sut-v2-clock/);
    assert.match(stable.stdout, /advance-clock: SUT answered 404/);
    const draft = await cli(['run', '--base-url', url, '--scenarios', await scenarioDir('draft')]);
    assert.match(draft.stdout, /DEFER selftest\.sut-v2-clock/);
  } finally {
    server.close();
  }
});

test('CLI fails closed on an unconfigured capability and rejects an invalid --sut-config', async () => {
  const { server, url } = await clockServer(true);
  try {
    const dir = await mkdtemp(path.join(tmpdir(), 'sutv2-'));
    await mkdir(path.join(dir, 'scenarios'), { recursive: true });
    await writeFile(
      path.join(dir, 'scenarios', 'a.yaml'),
      ['id: selftest.sut-v2-restart', 'requirements: [RFC9700-4.5-persistence]', 'profile: extended-grants', 'status: stable', 'steps:', '  - id: restart', '    use: sut-restart', '    expect: { status: 200 }', ''].join('\n'),
    );
    const unconfigured = await cli(['run', '--base-url', url, '--scenarios', path.join(dir, 'scenarios')]);
    assert.equal(unconfigured.code, 1);
    assert.match(unconfigured.stdout, /sut-restart: no restart command configured/);

    const bad = path.join(dir, 'sut.yaml');
    await writeFile(bad, 'surprise: true\n');
    const invalid = await cli(['run', '--base-url', url, '--scenarios', path.join(dir, 'scenarios'), '--sut-config', bad]);
    assert.equal(invalid.code, 2);
    assert.match(invalid.stderr, /unknown key "surprise"/);
  } finally {
    server.close();
  }
});
