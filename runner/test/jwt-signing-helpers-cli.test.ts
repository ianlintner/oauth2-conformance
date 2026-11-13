/**
 * Black-box CLI self-test for the JWT signing helpers: spawns the real CLI
 * against a local HTTP server and proves (a) a `client-assertion` helper step
 * wires its captured assertion into a later request, and (b) a known-mismatch
 * scenario drives a non-zero exit status. This is the runner-capability-2/3
 * parallel of `runner/test/device-cli.test.ts` and `cli.test.ts`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createPublicKey, verify } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const runnerDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

async function scenarioDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'jwt-'));
  await mkdir(path.join(dir, 'scenarios'), { recursive: true });
  await writeFile(
    path.join(dir, 'scenarios', 'a.yaml'),
    [
      'id: selftest.jwt-assertion-client-auth',
      'requirements: [RFC7523-3.2-assert-client-invalid-client]',
      'profile: extended-grants',
      'status: stable',
      'steps:',
      '  - id: sign',
      '    use: client-assertion',
      '    with: { iss: client-a, sub: client-a, aud: http://127.0.0.1:1/oauth/token, kid: k1 }',
      '    capture: { assertion: body.assertion }',
      '  - id: token',
      '    request:',
      '      method: POST',
      '      path: /oauth/token',
      '      form:',
      '        grant_type: client_credentials',
      '        client_id: client-a',
      '        client_assertion_type: urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      '        client_assertion: "{{assertion}}"',
      '    expect: { status: 200, json: { token_type: Bearer } }',
      '',
    ].join('\n'),
  );
  return path.join(dir, 'scenarios');
}

// A matching SUT verifies the received client_assertion is a well-formed,
// correctly signed ES256 JWT carrying the expected claims, then answers 200.
function matchingServer(): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const form = new URLSearchParams(Buffer.concat(chunks).toString());
        const assertion = form.get('client_assertion') ?? '';
        const [h, pl, sig] = assertion.split('.');
        // Decode header/payload to verify the signature against the embedded jwk.
        let ok = false;
        try {
          const header = JSON.parse(Buffer.from(h!, 'base64url').toString());
          const payload = JSON.parse(Buffer.from(pl!, 'base64url').toString());
          const key = createPublicKey({ key: header.jwk, format: 'jwk' });
          ok = verify('sha256', Buffer.from(`${h}.${pl}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig!, 'base64url'));
          ok = ok && payload.iss === 'client-a' && payload.sub === 'client-a';
        } catch {
          ok = false;
        }
        if (!ok) {
          res.writeHead(401, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid_client' }));
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ token_type: 'Bearer' }));
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }));
  });
}

test('CLI exits 0 when the SUT verifies the helper-signed client assertion (known match)', async () => {
  const { server, url } = await matchingServer();
  try {
    const result = await cli(['run', '--base-url', url, '--scenarios', await scenarioDir()]);
    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /PASS selftest\.jwt-assertion-client-auth/);
  } finally {
    server.close();
  }
});

test('CLI exits 1 when the SUT rejects the helper-signed client assertion (known mismatch)', async () => {
  const server = createServer((_req, res) => {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'invalid_client' }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const result = await cli(['run', '--base-url', url, '--scenarios', await scenarioDir()]);
    assert.equal(result.code, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /FAIL selftest\.jwt-assertion-client-auth/);
  } finally {
    server.close();
  }
});