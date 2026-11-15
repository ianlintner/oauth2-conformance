/**
 * Runner capability 3/3: SUT interface v2 helpers (test clock, restart hook,
 * multi-instance, mTLS, x5t#S256). Every test runs the real helper against a
 * real local HTTP/HTTPS server; no SUT code is involved.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer as createHttpServer, type IncomingMessage, type Server } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import type { TLSSocket } from 'node:tls';
import type { AddressInfo } from 'node:net';
import { writeFileSync } from 'node:fs';
import { mkdtemp, readFile, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { x5tS256, parseSutConfig, type SutRuntime } from '../src/sut-runtime.js';
import { advanceClock, mtlsRequest, requestOnInstance, sutRestart, x5tThumbprint } from '../src/sut-helpers.js';
import type { HelperContext } from '../src/runner.js';
import type { ActualResponse } from '../src/compare.js';

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`));
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}

async function readBody(req: IncomingMessage): Promise<string> {
  let raw = '';
  for await (const chunk of req) raw += String(chunk);
  return raw;
}

function ctx(withArgs: Record<string, unknown>, extra: Partial<HelperContext> & { sut?: SutRuntime } = {}): HelperContext {
  return { with: withArgs, scope: new Map(), send: async () => ({ status: 200, headers: {} }), ...extra } as HelperContext;
}

// ---- x5t#S256 -------------------------------------------------------------

async function pki(): Promise<{ dir: string; ca: string; clientCert: string; clientKey: string; otherCert: string; otherKey: string; serverCert: string; serverKey: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'pki-'));
  const run = (args: string[]): void => {
    execFileSync('openssl', args, { cwd: dir, stdio: 'pipe' });
  };
  const ca = (name: string): void => {
    run(['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-keyout', `${name}.key`, '-out', `${name}.pem`, '-subj', `/CN=${name}`, '-days', '2', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign']);
  };
  const sign = (name: string, issuer: string, ext: string): void => {
    run(['req', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-keyout', `${name}.key`, '-out', `${name}.csr`, '-subj', `/CN=${name}`]);
    writeFileSync(path.join(dir, `${name}.ext`), ext);
    run(['x509', '-req', '-in', `${name}.csr`, '-CA', `${issuer}.pem`, '-CAkey', `${issuer}.key`, '-CAcreateserial', '-out', `${name}.pem`, '-days', '2', '-extfile', `${name}.ext`]);
  };
  ca('client-ca');
  ca('rogue-ca');
  sign('client-1', 'client-ca', 'extendedKeyUsage=clientAuth\n');
  sign('rogue-1', 'rogue-ca', 'extendedKeyUsage=clientAuth\n');
  sign('server', 'client-ca', 'extendedKeyUsage=serverAuth\nsubjectAltName=IP:127.0.0.1\n');
  const p = (name: string): string => path.join(dir, name);
  return { dir, ca: p('client-ca.pem'), clientCert: p('client-1.pem'), clientKey: p('client-1.key'), otherCert: p('rogue-1.pem'), otherKey: p('rogue-1.key'), serverCert: p('server.pem'), serverKey: p('server.key') };
}

test('x5tS256 equals the openssl DER SHA-256 digest (base64url, no padding)', async () => {
  const files = await pki();
  const expected = execFileSync('sh', ['-c', `openssl x509 -in ${files.clientCert} -outform DER | openssl dgst -sha256 -binary | openssl base64 -A | tr '+/' '-_' | tr -d '='`]).toString();
  const pem = await readFile(files.clientCert, 'utf8');
  assert.equal(x5tS256(pem), expected);
  assert.equal(x5tS256(pem.replace(/\n/g, '\r\n')), expected, 'CRLF-wrapped PEM yields the same thumbprint');
  assert.match(expected, /^[A-Za-z0-9_-]{43}$/);
});

test('x5tS256 rejects input that is not a PEM certificate', () => {
  assert.throws(() => x5tS256('not a cert'), /PEM certificate/);
  assert.throws(() => x5tS256('-----BEGIN CERTIFICATE-----\n!!!\n-----END CERTIFICATE-----'), /PEM certificate/);
});

test('x5t-s256 helper hashes a named configured cert and an interpolated PEM variable', async () => {
  const files = await pki();
  const pem = await readFile(files.clientCert, 'utf8');
  const sut: SutRuntime = { mtls: { baseUrl: 'https://127.0.0.1:1', clients: { c1: { cert: pem, key: 'k' } } } };
  const named = await x5tThumbprint(ctx({ cert: 'c1' }, { sut }));
  assert.equal((named.body as Record<string, string>).x5t_s256, x5tS256(pem));
  const viaVar = await x5tThumbprint(ctx({ pem: '{{certpem}}' }, { scope: new Map([['certpem', pem]]) }));
  assert.equal((viaVar.body as Record<string, string>).x5t_s256, x5tS256(pem));
  await assert.rejects(x5tThumbprint(ctx({ cert: 'nope' }, { sut })), /unknown client certificate/);
  await assert.rejects(x5tThumbprint(ctx({})), /with\.cert or with\.pem/);
});

// ---- advance-clock --------------------------------------------------------

test('advance-clock POSTs a JSON advance_seconds to /conformance/clock and returns the response', async () => {
  const sent: Array<{ method: string; url: string; headers: Record<string, string>; body?: string }> = [];
  const response: ActualResponse = { status: 200, headers: {}, body: { now: 1000 } };
  const result = await advanceClock(ctx({ seconds: 600 }, { send: async (req) => (sent.push(req), response) }));
  assert.equal(result, response);
  assert.deepEqual(sent.map((r) => [r.method, r.url, r.headers['content-type'], r.body]), [['POST', '/conformance/clock', 'application/json', '{"advance_seconds":600}']]);
});

test('advance-clock honors a clockPath override and interpolates variables', async () => {
  const sent: Array<{ url: string; body?: string }> = [];
  await advanceClock(ctx({ seconds: '{{n}}', clockPath: '/conformance/v2/clock' }, { scope: new Map([['n', '45']]), send: async (req) => (sent.push(req), { status: 200, headers: {}, body: undefined }) }));
  assert.equal(sent[0]?.url, '/conformance/v2/clock');
  assert.equal(sent[0]?.body, '{"advance_seconds":45}');
});

test('advance-clock rejects missing, negative, fractional and absurd durations before any request', async () => {
  const send = async (): Promise<ActualResponse> => assert.fail('must not send');
  for (const seconds of [undefined, -1, 1.5, 'abc', 1e9, 86_400 * 366]) {
    await assert.rejects(advanceClock(ctx({ ...(seconds !== undefined ? { seconds } : {}) }, { send })), /advance-clock: with\.seconds/);
  }
});

test('advance-clock fails closed when the SUT does not offer the capability (non-2xx)', async () => {
  await assert.rejects(advanceClock(ctx({ seconds: 5 }, { send: async () => ({ status: 404, headers: {}, body: undefined }) })), /advance-clock: SUT answered 404/);
});

// ---- request-on-instance --------------------------------------------------

test('request-on-instance sends to the named instance only, with form body and headers', async () => {
  const hits: string[] = [];
  const make = async (name: string): Promise<{ server: Server; url: string }> => {
    const server = createHttpServer(async (req, res) => {
      hits.push(`${name} ${req.method} ${req.url} ${req.headers['content-type'] ?? ''} ${await readBody(req)} ${req.headers['x-probe'] ?? ''}`);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ instance: name }));
    });
    return { server, url: await listen(server) };
  };
  const a = await make('a');
  const b = await make('b');
  try {
    const sut: SutRuntime = { instances: { a: a.url, b: b.url } };
    const res = await requestOnInstance(
      ctx(
        { instance: 'b', method: 'POST', path: '/oauth/token', form: { grant_type: 'authorization_code', code: '{{code}}' }, headers: { 'x-probe': '1' } },
        { sut, scope: new Map([['code', 'abc']]) },
      ),
    );
    assert.deepEqual(res.body, { instance: 'b' });
    assert.deepEqual(hits, ['b POST /oauth/token application/x-www-form-urlencoded grant_type=authorization_code&code=abc 1']);
  } finally {
    await close(a.server);
    await close(b.server);
  }
});

test('request-on-instance fails closed on unknown instance, unconfigured runner and non-local path', async () => {
  const sut: SutRuntime = { instances: { a: 'http://127.0.0.1:1' } };
  await assert.rejects(requestOnInstance(ctx({ instance: 'z', path: '/x' }, { sut })), /unknown instance "z"/);
  await assert.rejects(requestOnInstance(ctx({ instance: 'a', path: '/x' })), /no instances configured/);
  await assert.rejects(requestOnInstance(ctx({ instance: 'a', path: 'http://evil/x' }, { sut })), /path must start with \//);
  await assert.rejects(requestOnInstance(ctx({ instance: 'a', path: '//evil/x' }, { sut })), /path must start with \//);
});

// ---- sut-restart ----------------------------------------------------------

async function script(body: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'restart-'));
  const file = path.join(dir, 'restart.sh');
  await writeFile(file, `#!/bin/sh\n${body}\n`);
  await chmod(file, 0o755);
  return file;
}

test('sut-restart runs the harness command with the base URL in env, then waits for readiness', async () => {
  let healthy = true;
  const server = createHttpServer((req, res) => {
    res.statusCode = req.url === '/health' && healthy ? 200 : 503;
    res.end();
  });
  const base = await listen(server);
  const dir = await mkdtemp(path.join(tmpdir(), 'marker-'));
  const marker = path.join(dir, 'ran');
  try {
    const restartCommand = await script(`printf '%s' "$OAUTH2_CONFORMANCE_BASE_URL" > '${marker}'`);
    healthy = false;
    setTimeout(() => (healthy = true), 250);
    const res = await sutRestart(ctx({}, { baseUrl: base, sut: { restart: { command: restartCommand, readyTimeoutMs: 5000, pollIntervalMs: 50 } } }));
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { restarted: true });
    assert.equal(await readFile(marker, 'utf8'), base);
    assert.equal(healthy, true, 'returned only after /health recovered');
  } finally {
    await close(server);
  }
});

test('sut-restart fails when unconfigured, when the command fails, and when readiness never returns', async () => {
  await assert.rejects(sutRestart(ctx({}, { baseUrl: 'http://127.0.0.1:1' })), /no restart command configured/);
  const failing = await script('exit 3');
  await assert.rejects(sutRestart(ctx({}, { baseUrl: 'http://127.0.0.1:1', sut: { restart: { command: failing, readyTimeoutMs: 200, pollIntervalMs: 20 } } })), /restart command failed/);
  const ok = await script('exit 0');
  await assert.rejects(sutRestart(ctx({}, { baseUrl: 'http://127.0.0.1:1', sut: { restart: { command: ok, readyTimeoutMs: 300, pollIntervalMs: 20 } } })), /did not become ready/);
});

// ---- mtls-request ---------------------------------------------------------

test('mtls-request presents the selected client certificate; none/rogue are visible to the SUT', async () => {
  const files = await pki();
  const [serverCert, serverKey, ca, clientCert, clientKey, otherCert, otherKey] = (await Promise.all(
    [files.serverCert, files.serverKey, files.ca, files.clientCert, files.clientKey, files.otherCert, files.otherKey].map((f) => readFile(f, 'utf8')),
  )) as [string, string, string, string, string, string, string];
  const server = createHttpsServer({ cert: serverCert, key: serverKey, ca, requestCert: true, rejectUnauthorized: false }, (req, res) => {
    const socket = req.socket as TLSSocket;
    const peer = socket.getPeerCertificate();
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ authorized: socket.authorized, cn: peer && 'subject' in peer ? peer.subject?.CN ?? null : null, path: req.url }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `https://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const sut: SutRuntime = {
      mtls: { baseUrl, ca, clients: { good: { cert: clientCert, key: clientKey }, rogue: { cert: otherCert, key: otherKey } } },
    };
    const good = await mtlsRequest(ctx({ cert: 'good', method: 'GET', path: '/oauth/token' }, { sut }));
    assert.deepEqual(good.body, { authorized: true, cn: 'client-1', path: '/oauth/token' });
    const rogue = await mtlsRequest(ctx({ cert: 'rogue', method: 'GET', path: '/p' }, { sut }));
    assert.equal((rogue.body as { authorized: boolean }).authorized, false);
    const none = await mtlsRequest(ctx({ method: 'GET', path: '/p' }, { sut }));
    assert.equal((none.body as { cn: string | null }).cn, null);
    assert.equal((none.body as { authorized: boolean }).authorized, false);
    await assert.rejects(mtlsRequest(ctx({ cert: 'missing', path: '/p' }, { sut })), /unknown client certificate "missing"/);
    await assert.rejects(mtlsRequest(ctx({ path: '/p' })), /no mtls listener configured/);
    await assert.rejects(mtlsRequest(ctx({ path: 'https://x/p' }, { sut })), /path must start with \//);
  } finally {
    await close(server);
  }
});

test('mtls-request does not trust the server unless it chains to the configured CA', async () => {
  const files = await pki();
  const [serverCert, serverKey] = await Promise.all([readFile(files.serverCert, 'utf8'), readFile(files.serverKey, 'utf8')]);
  const rogueCa = await readFile(files.otherCert, 'utf8');
  const server = createHttpsServer({ cert: serverCert, key: serverKey }, (_req, res) => res.end('x'));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const sut: SutRuntime = { mtls: { baseUrl: `https://127.0.0.1:${(server.address() as AddressInfo).port}`, ca: rogueCa, clients: {} } };
    await assert.rejects(mtlsRequest(ctx({ path: '/p' }, { sut })));
  } finally {
    await close(server);
  }
});

// ---- config parsing -------------------------------------------------------

test('parseSutConfig resolves relative files and validates every field', async () => {
  const files = await pki();
  const cfg = {
    instances: { a: 'http://127.0.0.1:9001', b: 'http://127.0.0.1:9002' },
    restart: { command: './restart.sh', readyTimeoutMs: 1000 },
    mtls: { baseUrl: 'https://127.0.0.1:9443', caFile: 'client-ca.pem', clients: { c1: { certFile: 'client-1.pem', keyFile: 'client-1.key' } } },
  };
  const runtime = await parseSutConfig(JSON.stringify(cfg), files.dir);
  assert.deepEqual(runtime.instances, cfg.instances);
  assert.equal(runtime.restart?.command, path.join(files.dir, 'restart.sh'));
  assert.equal(runtime.restart?.readyTimeoutMs, 1000);
  assert.equal(runtime.mtls?.clients.c1?.cert, await readFile(files.clientCert, 'utf8'));
  assert.equal(runtime.mtls?.ca, await readFile(files.ca, 'utf8'));
});

test('parseSutConfig rejects unknown keys and malformed instance, mtls and config shapes', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cfg-'));
  await assert.rejects(parseSutConfig('{"surprise":1}', dir), /unknown key "surprise"/);
  await assert.rejects(parseSutConfig('{"instances":{"a":"ftp://x"}}', dir), /instances\.a must be an http\(s\) URL/);
  await assert.rejects(parseSutConfig('{"instances":{"a":"http://x/path"}}', dir), /instances\.a must be an origin/);
  await assert.rejects(parseSutConfig('{"mtls":{"baseUrl":"http://x","clients":{}}}', dir), /mtls\.baseUrl must be an https URL/);
  await assert.rejects(parseSutConfig('[]', dir), /must be an object/);
  assert.deepEqual(await parseSutConfig('{}', dir), {});
});
