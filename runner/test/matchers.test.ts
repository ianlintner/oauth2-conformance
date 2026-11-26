/**
 * Tests for the v0.2 token-lifecycle runner extensions:
 *   - JWT header/payload decode captures (`jwt.<var>.<header|payload>.<field>`);
 *   - `$contains`, `$nonempty` and `$absent` matchers inside `expect.json`.
 *
 * These are unit-level: they drive `captureValue`/`compareResponse` directly and
 * also exercise the end-to-end CLI with a mock SUT so false-PASS is impossible.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureValue, compareResponse, type ActualResponse } from '../src/compare.js';

const runnerDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const b64u = (obj: unknown): string => Buffer.from(JSON.stringify(obj)).toString('base64url');
const jwt = (header: unknown, payload: unknown): string => `${b64u(header)}.${b64u(payload)}.sig`;

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

function response(status: number, body: unknown): ActualResponse {
  return { status, headers: { 'content-type': 'application/json' }, body };
}

test('jwt.payload.<claim> decodes the payload of a previously-captured JWT', () => {
  const token = jwt({ alg: 'RS256', typ: 'at+JWT' }, { iss: 'https://sut.example', sub: 'alice', aud: 'resource-a' });
  const scope = new Map<string, string>([['at', token]]);
  assert.equal(captureValue('jwt.at.payload.iss', response(200, {}), scope), 'https://sut.example');
  assert.equal(captureValue('jwt.at.payload.sub', response(200, {}), scope), 'alice');
  assert.equal(captureValue('jwt.at.payload.aud', response(200, {}), scope), 'resource-a');
});

test('jwt.header.<field> decodes the header of a previously-captured JWT', () => {
  const token = jwt({ alg: 'RS256', typ: 'at+JWT' }, { iss: 'https://sut.example' });
  const scope = new Map<string, string>([['at', token]]);
  assert.equal(captureValue('jwt.at.header.alg', response(200, {}), scope), 'RS256');
  assert.equal(captureValue('jwt.at.header.typ', response(200, {}), scope), 'at+JWT');
});

test('jwt capture returns undefined for a missing source variable or malformed token', () => {
  const scope = new Map<string, string>([['at', jwt({ alg: 'RS256' }, {})]]);
  assert.equal(captureValue('jwt.missing.payload.iss', response(200, {}), scope), undefined);
  assert.equal(captureValue('jwt.at.payload.nope', response(200, {}), scope), undefined);
  const bad = new Map<string, string>([['at', 'not-a-jwt']]);
  assert.equal(captureValue('jwt.at.payload.iss', response(200, {}), bad), undefined);
  // No scope at all → undefined rather than throw.
  assert.equal(captureValue('jwt.at.payload.iss', response(200, {})), undefined);
});

test('$ltCapture compares two captured numeric claims (iat < exp) and fails closed', () => {
  const scope = new Map<string, string>([['iat', '1700000000'], ['exp', '1700003600']]);
  const expect = { status: 200, json: { ordering: { $ltCapture: ['iat', 'exp'] } } } as never;
  assert.deepEqual(compareResponse(expect, response(200, { ordering: true }), scope), []);
  // Equal and later values fail; a missing capture fails closed rather than passing.
  const equal = new Map<string, string>([['iat', '1700000000'], ['exp', '1700000000']]);
  assert.equal(compareResponse(expect, response(200, { ordering: true }), equal).length, 1);
  const missing = new Map<string, string>([['iat', '1700000000']]);
  assert.equal(compareResponse(expect, response(200, { ordering: true }), missing).length, 1);
  // A non-numeric capture fails closed too.
  const bad = new Map<string, string>([['iat', '1700000000'], ['exp', 'not-a-number']]);
  assert.equal(compareResponse(expect, response(200, { ordering: true }), bad).length, 1);
  // Reversed comparison ($gtCapture) is covered by its own test below.
});

test('assert-only steps fail closed on a mismatched capture', () => {
  const scope = new Map<string, string>([['iat', '1700000000'], ['exp', '1700000000']]);
  const expect = { status: 200, json: { check: { $ltCapture: ['iat', 'exp'] } } } as never;
  assert.equal(compareResponse(expect, response(200, { check: true }), scope).length, 1);
});

test('$contains matcher passes when the array contains the value, fails otherwise', () => {
  const expect = { status: 200, json: { response_types_supported: { $contains: 'code' } } } as never;
  assert.deepEqual(compareResponse(expect, response(200, { response_types_supported: ['code', 'token'] })), []);
  const diffs = compareResponse(expect, response(200, { response_types_supported: ['token'] }));
  assert.equal(diffs.length, 1);
  assert.match(diffs[0]!.reason, /array does not contain/);
});

test('$contains matcher fails when the member is not an array', () => {
  const expect = { status: 200, json: { grant_types_supported: { $contains: 'client_credentials' } } } as never;
  const diffs = compareResponse(expect, response(200, { grant_types_supported: 'client_credentials' }));
  assert.equal(diffs.length, 1);
  assert.equal(diffs[0]!.reason, 'array does not contain the expected value');
});

test('$nonempty matcher passes for non-empty arrays, strings and objects; fails for empty or scalar values', () => {
  const expect = { status: 200, json: { keys: { $nonempty: true } } } as never;
  assert.deepEqual(compareResponse(expect, response(200, { keys: [{ kid: '1' }] })), []);
  assert.deepEqual(compareResponse(expect, response(200, { keys: 'x' })), []);
  assert.deepEqual(compareResponse(expect, response(200, { keys: { kid: '1' } })), []);
  assert.equal(compareResponse(expect, response(200, { keys: [] })).length, 1);
  assert.equal(compareResponse(expect, response(200, { keys: '' })).length, 1);
  assert.equal(compareResponse(expect, response(200, { keys: {} })).length, 1);
  assert.equal(compareResponse(expect, response(200, { keys: 42 })).length, 1);
});

test('$absent matcher passes when the member is absent, fails when present', () => {
  const expect = { status: 200, json: { access_token: 'x', refresh_token: { $absent: true } } } as never;
  assert.deepEqual(compareResponse(expect, response(200, { access_token: 'x', token_type: 'Bearer' })), []);
  const diffs = compareResponse(expect, response(200, { access_token: 'x', refresh_token: 'r' }));
  assert.equal(diffs.length, 1);
  assert.equal(diffs[0]!.reason, 'unexpected field present');
  assert.equal(diffs[0]!.path, 'refresh_token');
});

test('expect.json interpolates {{var}} string leaves against the capture scope', () => {
  const scope = new Map<string, string>([['iss', 'https://sut.example']]);
  const expect = { status: 200, json: { issuer: '{{iss}}' } } as never;
  assert.deepEqual(compareResponse(expect, response(200, { issuer: 'https://sut.example' }), scope), []);
  // A mismatched value fails.
  assert.equal(compareResponse(expect, response(200, { issuer: 'https://elsewhere' }), scope).length, 1);
  // Literal strings without a reference are untouched.
  const literal = { status: 200, json: { issuer: 'https://sut.example' } } as never;
  assert.deepEqual(compareResponse(literal, response(200, { issuer: 'https://sut.example' }), scope), []);
});

test('expect.headers interpolates {{var}} values against the capture scope', () => {
  const scope = new Map<string, string>([['ct', 'application/json']]);
  const expect = { status: 200, headers: { 'content-type': '{{ct}}' } } as never;
  assert.deepEqual(compareResponse(expect, response(200, {}), scope), []);
});

test('$ltCapture works end-to-end in an assert step with a JWT payload source', async () => {
  const token = jwt({ alg: 'RS256' }, { iat: 1700000000, exp: 1700003600, aud: 'client-a' });
  const server: Server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ access_token: token }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const dir = await mkdtemp(path.join(tmpdir(), 'ltcapture-'));
  await mkdir(path.join(dir, 'scenarios'), { recursive: true });
  await writeFile(
    path.join(dir, 'scenarios', 'a.yaml'),
    [
      'id: matchers.capture-order',
      'requirements: [OIDC-3.1.3.7-iat-exp]',
      'profile: oidc-basic',
      'status: stable',
      'steps:',
      '  - id: token',
      '    request: { method: POST, path: /oauth/token, form: { grant_type: authorization_code } }',
      '    expect: { status: 200 }',
      '    capture:',
      '      idt: body.access_token',
      '      iat: jwt.idt.payload.iat',
      '      exp: jwt.idt.payload.exp',
      '  - id: ordering',
      '    source: jwt.idt.payload',
      '    assert:',
      '      json:',
      '        exp: { $gtCapture: [exp, iat] }',
      '',
    ].join('\n'),
  );
  try {
    const result = await cli(['run', '--base-url', url, '--scenarios', path.join(dir, 'scenarios')]);
    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /PASS matchers\.capture-order/);
  } finally {
    server.close();
  }
});

test('$gtCapture failure diff states the > operator, not <', () => {
  const scope = new Map<string, string>([['exp', '100'], ['iat', '200']]);
  const expect = { status: 200, json: { ordering: { $gtCapture: ['exp', 'iat'] } } } as never;
  const diffs = compareResponse(expect, response(200, { ordering: true }), scope);
  assert.equal(diffs.length, 1);
  assert.equal(diffs[0]?.expected, '$gtCapture exp > iat');
  assert.match(diffs[0]?.reason ?? '', /100 is not > 200/);
});

test('$ltCapture failure diff states the < operator', () => {
  const scope = new Map<string, string>([['iat', '200'], ['exp', '100']]);
  const expect = { status: 200, json: { ordering: { $ltCapture: ['iat', 'exp'] } } } as never;
  const diffs = compareResponse(expect, response(200, { ordering: true }), scope);
  assert.equal(diffs.length, 1);
  assert.equal(diffs[0]?.expected, '$ltCapture iat < exp');
});

test('matchers work end-to-end through the CLI against a mock SUT', async () => {
  const token = jwt({ alg: 'RS256', typ: 'at+JWT' }, { iss: 'https://sut.example' });
  const server: Server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ access_token: token, token_type: 'Bearer', response_types_supported: ['code', 'token'] }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const dir = await mkdtemp(path.join(tmpdir(), 'matchers-'));
  await mkdir(path.join(dir, 'scenarios'), { recursive: true });
  await writeFile(
    path.join(dir, 'scenarios', 'a.yaml'),
    [
      'id: matchers.jwt-iss',
      'requirements: [RFC9068-2.2-required-claims]',
      'profile: token-lifecycle',
      'status: stable',
      'steps:',
      '  - id: token',
      '    request: { method: POST, path: /oauth/token, form: { grant_type: client_credentials } }',
      '    expect:',
      '      status: 200',
      '      json:',
      '        token_type: Bearer',
      '        response_types_supported: { $contains: code }',
      '    capture:',
      '      at: body.access_token',
      '      iss: jwt.at.payload.iss',
      '',
    ].join('\n'),
  );
  try {
    const result = await cli(['run', '--base-url', url, '--scenarios', path.join(dir, 'scenarios')]);
    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /PASS matchers\.jwt-iss/);
  } finally {
    server.close();
  }
});
