/**
 * Contract section 7.9/7.10: runner-owned storage-fault control and mock IdP.
 * Everything runs against real loopback listeners or real helper invocations;
 * no third-party identity provider or credential is involved.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mockIdpAuthorize, storageFault } from '../src/sut-helpers.js';
import { startMockIdp, type MockIdp } from '../src/mock-idp.js';
import { parseSutConfig } from '../src/sut-runtime.js';
import type { HelperContext } from '../src/runner.js';
import type { ActualResponse } from '../src/compare.js';

const runnerDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function ctx(withArgs: Record<string, unknown>, extra: Partial<HelperContext> = {}): HelperContext {
  return { with: withArgs, scope: new Map(), send: async () => ({ status: 200, headers: {} }), ...extra } as HelperContext;
}

async function listen(server: Server): Promise<{ origin: string; close: () => Promise<void> }> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    origin,
    close: () => new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    }),
  };
}

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

// ---- storage-fault helper --------------------------------------------------

test('storage-fault POSTs the toggle to /conformance/storage-fault', async () => {
  const sent: Array<{ method: string; url: string; headers: Record<string, string>; body?: string }> = [];
  const response: ActualResponse = { status: 200, headers: {}, body: { enabled: true } };
  const result = await storageFault(ctx({ enabled: true }, { send: async (req) => (sent.push(req), response) }));
  assert.equal(result, response);
  assert.deepEqual(sent.map((r) => [r.method, r.url, r.headers['content-type'], r.body]), [
    ['POST', '/conformance/storage-fault', 'application/json', '{"enabled":true}'],
  ]);
});

test('storage-fault honors a path override and interpolated boolean', async () => {
  const sent: Array<{ url: string; body?: string }> = [];
  await storageFault(ctx({ enabled: '{{flag}}', path: '/conformance/v2/storage-fault' }, {
    scope: new Map([['flag', 'false']]),
    send: async (req) => (sent.push(req), { status: 204, headers: {}, body: undefined }),
  }));
  assert.deepEqual(sent.map((r) => [r.url, r.body]), [['/conformance/v2/storage-fault', '{"enabled":false}']]);
});

test('storage-fault refuses malformed input before any request and non-2xx answers', async () => {
  const send = async (): Promise<ActualResponse> => assert.fail('must not send');
  for (const enabled of [undefined, 'yes', ' TRUE ', '0', 1, {}, []]) {
    await assert.rejects(storageFault(ctx(enabled === undefined ? {} : { enabled }, { send })), /storage-fault: with\.enabled/);
  }
  await assert.rejects(storageFault(ctx({ enabled: true, path: 'http://evil/x' }, { send })), /storage-fault: with\.path/);
  await assert.rejects(
    storageFault(ctx({ enabled: true }, { send: async () => ({ status: 404, headers: {}, body: undefined }) })),
    /storage-fault: SUT answered 404/,
  );
});

// ---- mock IdP listener -----------------------------------------------------

test('mock IdP completes an authorize → token → userinfo round trip and refuses replay', async () => {
  const idp: MockIdp = await startMockIdp({ origin: 'http://127.0.0.1:0' });
  try {
    const redirectUri = 'http://127.0.0.1:18083/auth/callback/google';
    const authorize = await fetch(`${idp.origin}/authorize?state=abc&redirect_uri=${encodeURIComponent(redirectUri)}`, { redirect: 'manual' });
    assert.equal(authorize.status, 302);
    const location = new URL(authorize.headers.get('location') ?? '');
    assert.equal(location.origin, 'http://127.0.0.1:18083');
    assert.equal(location.pathname, '/auth/callback/google');
    assert.equal(location.searchParams.get('state'), 'abc');
    const code = location.searchParams.get('code') ?? '';
    assert.match(code, /^mock-code-/);
    assert.equal(idp.issuedCount(), 1);

    const post = async (body: string): Promise<{ status: number; json: Record<string, unknown> }> => {
      const response = await fetch(`${idp.origin}/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
      });
      return { status: response.status, json: (await response.json()) as Record<string, unknown> };
    };
    const form = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
    const exchanged = await post(form.toString());
    assert.equal(exchanged.status, 200, JSON.stringify(exchanged.json));
    assert.equal(exchanged.json.token_type, 'Bearer');

    const replay = await post(form.toString());
    assert.equal(replay.status, 400);
    assert.equal(replay.json.error, 'invalid_grant', 'a code is single use');

    const token = String(exchanged.json.access_token);
    const userinfo = await fetch(`${idp.origin}/userinfo`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(userinfo.status, 200);
    assert.deepEqual(await userinfo.json(), {
      sub: 'conformance-user',
      email: 'conformance@example.test',
      email_verified: true,
      name: 'Conformance User',
    });
    assert.equal((await fetch(`${idp.origin}/userinfo`)).status, 401);
    assert.equal((await fetch(`${idp.origin}/unknown`)).status, 404);
  } finally {
    await idp.close();
  }
});

test('mock IdP rejects off-origin redirects, missing state and wrong PKCE verifiers', async () => {
  const idp: MockIdp = await startMockIdp({ origin: 'http://127.0.0.1:0' });
  try {
    const badRedirect = await fetch(`${idp.origin}/authorize?state=s&redirect_uri=https://attacker.example/cb`, { redirect: 'manual' });
    assert.equal(badRedirect.status, 400, 'no code is issued to an external redirect_uri');
    const missingState = await fetch(`${idp.origin}/authorize?redirect_uri=http://127.0.0.1:1/cb`, { redirect: 'manual' });
    assert.equal(missingState.status, 400);
    assert.equal(idp.issuedCount(), 0);

    const verifier = 'correct-horse-battery-staple';
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const redirectUri = 'http://127.0.0.1:1/cb';
    const authorize = await fetch(`${idp.origin}/authorize?state=s&redirect_uri=${encodeURIComponent(redirectUri)}&code_challenge=${challenge}&code_challenge_method=S256`, { redirect: 'manual' });
    const location = new URL(authorize.headers.get('location') ?? '');
    const code = location.searchParams.get('code') ?? '';
    const post = async (codeVerifier: string): Promise<number> => {
      const response = await fetch(`${idp.origin}/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: codeVerifier }).toString(),
      });
      return response.status;
    };
    assert.equal(await post('wrong-verifier'), 400);
    assert.equal(await post(verifier), 200, 'the code is not consumed by a failed PKCE check');
  } finally {
    await idp.close();
  }
});

test('mock IdP refuses a non-loopback origin', async () => {
  await assert.rejects(startMockIdp({ origin: 'http://192.0.2.1:8080' }), /loopback origin/);
  await assert.rejects(startMockIdp({ origin: 'https://127.0.0.1:8080' }), /loopback origin/);
});

// ---- mock-idp-authorize helper ---------------------------------------------

test('mock-idp-authorize follows the SUT redirect exactly once and returns code + state', async () => {
  const idp: MockIdp = await startMockIdp({ origin: 'http://127.0.0.1:0' });
  try {
    const redirectUri = encodeURIComponent('http://127.0.0.1:18083/auth/callback/google');
    const location = `${idp.origin}/authorize?state=xyz&redirect_uri=${redirectUri}`;
    const result = await mockIdpAuthorize(ctx({ location: '{{login_location}}' }, {
      scope: new Map([['login_location', location]]),
      mockIdp: idp,
    }));
    assert.equal(result.status, 302);
    assert.equal(result.redirect?.query.state, 'xyz');
    assert.match(result.redirect?.query.code ?? '', /^mock-code-/);
    assert.equal(idp.issuedCount(), 1, 'the SUT callback itself was not contacted by the helper');
  } finally {
    await idp.close();
  }
});

test('mock-idp-authorize fails closed when unconfigured or redirected elsewhere', async () => {
  await assert.rejects(mockIdpAuthorize(ctx({ location: 'http://127.0.0.1:1/authorize' })), /no mock IdP configured/);
  const idp: MockIdp = await startMockIdp({ origin: 'http://127.0.0.1:0' });
  try {
    for (const location of ['/authorize', 'not a url', 'https://accounts.google.com/o/oauth2/v2/auth']) {
      await assert.rejects(mockIdpAuthorize(ctx({ location }, { mockIdp: idp })), /mock-idp-authorize:/);
    }
  } finally {
    await idp.close();
  }
});

// ---- config parsing --------------------------------------------------------

test('parseSutConfig accepts a loopback mockIdp origin and rejects bad shapes', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'mockidp-cfg-'));
  const parsed = await parseSutConfig('{"mockIdp":{"origin":"http://127.0.0.1:8098"}}', dir);
  assert.deepEqual(parsed.mockIdp, { origin: 'http://127.0.0.1:8098' });
  for (const text of [
    '{"mockIdp":{"origin":"https://127.0.0.1:8098"}}',
    '{"mockIdp":{"origin":"http://192.0.2.1:8098"}}',
    '{"mockIdp":{"origin":"http://127.0.0.1:8098/authorize"}}',
    '{"mockIdp":{"origin":"http://127.0.0.1:8098","extra":1}}',
    '{"mockIdp":{}}',
  ]) {
    await assert.rejects(parseSutConfig(text, dir), /mockIdp/, text);
  }
});

// ---- CLI black-box wiring --------------------------------------------------

test('CLI runs a social-login round trip through the configured mock IdP', async () => {
  // Reserve a free port, then let the CLI own the listener on it.
  const probe = await listen(createServer());
  const mockOrigin = probe.origin;
  await probe.close();

  let callbackHits = 0;
  const sut = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://sut.invalid');
    if (url.pathname === '/auth/login/google') {
      const callback = 'http://127.0.0.1:1/auth/callback/google';
      const location = `${mockOrigin}/authorize?state=s-1&redirect_uri=${encodeURIComponent(callback)}`;
      res.writeHead(302, { location }).end();
      return;
    }
    if (url.pathname === '/auth/callback/google') {
      callbackHits += 1;
      if (url.searchParams.get('state') !== 's-1' || (url.searchParams.get('code') ?? '') === '') {
        res.statusCode = 400;
      }
      res.end('callback');
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  const dir = await mkdtemp(path.join(tmpdir(), 'mockidp-cli-'));
  const configDir = await mkdtemp(path.join(tmpdir(), 'mockidp-cfg-'));
  const configFile = path.join(configDir, 'sut.yaml');
  await writeFile(configFile, `mockIdp:\n  origin: ${mockOrigin}\n`);
  await writeFile(path.join(dir, 'scenario.yaml'), [
    'id: selftest.social-login.mock-idp',
    'requirements: [OPS-4.1-provider-base-url-configurable]',
    'profile: operations',
    'status: stable',
    'steps:',
    '  - id: login',
    '    request: { method: GET, path: /auth/login/google }',
    '    expect: { status: 302 }',
    '    capture: { state: redirect.query.state, location: header.location }',
    '  - id: idp',
    '    use: mock-idp-authorize',
    '    with: { location: "{{location}}" }',
    '    expect: { status: 302 }',
    '    capture: { code: redirect.query.code }',
    '  - id: callback',
    '    request:',
    '      method: GET',
    '      path: /auth/callback/google',
    '      query: { code: "{{code}}", state: "{{state}}" }',
    '    expect: { status: 200 }',
    '',
  ].join('\n'));
  const bound = await listen(sut);
  try {
    const result = await cli([
      'run', '--base-url', bound.origin, '--scenarios', dir, '--sut-config', configFile, '--only', 'OPS-4.1-provider-base-url-configurable',
    ]);
    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /PASS selftest\.social-login\.mock-idp/);
    assert.equal(callbackHits, 1, 'the runner passed a real synthetic code to the SUT callback');
  } finally {
    await bound.close();
  }
});

test('CLI fails closed when the mock IdP helper is used without --sut-config', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'mockidp-cli-noconfig-'));
  await writeFile(path.join(dir, 'scenario.yaml'), [
    'id: selftest.mock-idp.unconfigured',
    'requirements: [OPS-4.1-provider-base-url-configurable]',
    'profile: operations',
    'status: stable',
    'steps:',
    '  - id: idp',
    '    use: mock-idp-authorize',
    '    with: { location: "http://127.0.0.1:1/authorize" }',
    '    expect: { status: 302 }',
    '',
  ].join('\n'));
  const result = await cli(['run', '--base-url', 'http://127.0.0.1:1', '--scenarios', dir]);
  assert.equal(result.code, 1);
  assert.match(result.stdout + result.stderr, /no mock IdP configured/);
});
