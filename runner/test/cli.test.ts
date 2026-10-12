/**
 * Black-box CLI self-test: spawns the real CLI process against a local HTTP
 * server, once with a known-matching SUT and once with a known-mismatching one,
 * proving fixture expectations are wired into the process exit status.
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
  const dir = await mkdtemp(path.join(tmpdir(), 'conf-'));
  await mkdir(path.join(dir, 'scenarios'), { recursive: true });
  await writeFile(
    path.join(dir, 'scenarios', 'a.yaml'),
    [
      'id: selftest.invalid-client',
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

test('CLI exits 0 when the SUT matches the scenario (known match)', async () => {
  const { server, url } = await listen(401, { error: 'invalid_client' });
  try {
    const result = await cli(['run', '--base-url', url, '--scenarios', await scenarioDir()]);
    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /PASS selftest\.invalid-client/);
  } finally {
    server.close();
  }
});

test('CLI exits 1 when the SUT mismatches the scenario (known mismatch)', async () => {
  const { server, url } = await listen(200, { access_token: 'x' });
  try {
    const result = await cli(['run', '--base-url', url, '--scenarios', await scenarioDir()]);
    assert.equal(result.code, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /FAIL selftest\.invalid-client/);
  } finally {
    server.close();
  }
});

test('CLI validate passes on the repository data files', async () => {
  const result = await cli([
    'validate',
    '--scenarios', path.join(repoRoot, 'scenarios'),
    '--requirements', path.join(repoRoot, 'requirements'),
    '--profiles', path.join(repoRoot, 'profiles'),
  ]);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /validate: OK/);
});

test('CLI usage error exits 2', async () => {
  const result = await cli(['bogus']);
  assert.equal(result.code, 2);
});
