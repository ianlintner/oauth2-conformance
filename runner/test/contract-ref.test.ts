/**
 * An implementation manifest pins its contract as either a tagged semver
 * release or an unreleased 40-hex commit on main (ROADMAP.md step 2). These
 * tests prove the pin is validated and classified at two independent gates —
 * the JSON schema and the runner's own parser — and that a malformed or
 * ambiguous ref is rejected rather than accepted syntactically.
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
import { checkDocument, loadValidators } from '../src/schema-validate.js';
import { parseContractRef } from '../src/manifest.js';

const runnerDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(runnerDir, '..');

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

async function listen(status: number, body: unknown): Promise<{ server: Server; url: string }> {
  const server = createServer((_req, res) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

async function scenarioDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'cfr-'));
  await mkdir(path.join(dir, 'scenarios'), { recursive: true });
  await writeFile(
    path.join(dir, 'scenarios', 'a.yaml'),
    [
      'id: cfr.invalid-client',
      'requirements: [RFC6749-5.2-invalid-client]',
      'profile: core',
      'status: stable',
      'steps:',
      '  - id: token',
      '    request: { method: POST, path: /oauth/token, form: { grant_type: client_credentials } }',
      '    expect: { status: 401, json: { error: invalid_client } }',
      '',
    ].join('\n'),
  );
  return path.join(dir, 'scenarios');
}

const COMMIT = 'f6206d81848a13dc653aca718002f5c2e78cce61';

function manifest(contract: unknown): Record<string, unknown> {
  return { implementation: 'example-server', contract, profiles: ['core'] };
}

let validators: Awaited<ReturnType<typeof loadValidators>> | undefined;

test('manifest schema accepts a full 40-hex commit pin and a semver release', async () => {
  validators ??= await loadValidators(path.join(repoRoot, 'schemas'));
  assert.deepEqual(checkDocument(validators, 'manifest', manifest(COMMIT)), []);
  assert.deepEqual(checkDocument(validators, 'manifest', manifest('0.1.0')), []);
});

test('manifest schema rejects malformed or ambiguous contract refs', async () => {
  validators ??= await loadValidators(path.join(repoRoot, 'schemas'));
  for (const bad of ['main', 'f6206d8', 'v0.1.0', '0.1', COMMIT.toUpperCase(), `${COMMIT}0`, COMMIT.replace('a', 'g')]) {
    assert.notEqual(
      checkDocument(validators, 'manifest', manifest(bad)).length,
      0,
      `schema must reject contract ref ${JSON.stringify(bad)}`,
    );
  }
});

test('parseContractRef classifies a version and a commit, and rejects malformed refs', () => {
  assert.deepEqual(parseContractRef('0.1.0'), { kind: 'version', value: '0.1.0' });
  assert.deepEqual(parseContractRef(COMMIT), { kind: 'commit', value: COMMIT });
  for (const bad of ['main', 'f6206d8', 'v0.1.0', '0.1', COMMIT.toUpperCase(), `${COMMIT}0`, '']) {
    assert.throws(() => parseContractRef(bad), /invalid contract reference/, `parseContractRef must reject ${JSON.stringify(bad)}`);
  }
});

test('run --contract accepts a commit pin and records it in the report', async () => {
  const { server, url } = await listen(401, { error: 'invalid_client' });
  try {
    const result = await cli(['run', '--base-url', url, '--scenarios', await scenarioDir(), '--contract', COMMIT]);
    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /PASS cfr\.invalid-client/);
    assert.match(result.stdout, /contract=/);
  } finally {
    server.close();
  }
});

test('run --contract preserves a semver release', async () => {
  const { server, url } = await listen(401, { error: 'invalid_client' });
  try {
    const result = await cli(['run', '--base-url', url, '--scenarios', await scenarioDir(), '--contract', '0.1.0']);
    assert.equal(result.code, 0, result.stdout + result.stderr);
  } finally {
    server.close();
  }
});

test('run --contract rejects a malformed ref with a usage error', async () => {
  const { server, url } = await listen(401, { error: 'invalid_client' });
  try {
    const result = await cli(['run', '--base-url', url, '--scenarios', await scenarioDir(), '--contract', 'main']);
    assert.equal(result.code, 2, result.stdout + result.stderr);
    assert.match(result.stderr, /invalid contract reference/);
  } finally {
    server.close();
  }
});
