/**
 * Black-box proof that bounded step repetition is wired into the CLI process,
 * not just parse-time types: a counting server replays `repeat` N times and the
 * outcome (match/mismatch) flips the exit status.
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

function countingServer(status: number, body: unknown): Promise<{ server: Server; url: string; hits: { count: number } }> {
  const hits = { count: 0 };
  const server = createServer((_req, res) => {
    hits.count += 1;
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, hits });
    });
  });
}

/** A server that returns a per-attempt status, for proving every iteration is asserted. */
function sequencedServer(attempts: Array<{ status: number; body: unknown }>): Promise<{ server: Server; url: string; hits: { count: number } }> {
  const hits = { count: 0 };
  const server = createServer((_req, res) => {
    const attempt = attempts[Math.min(hits.count, attempts.length - 1)]!;
    hits.count += 1;
    res.writeHead(attempt.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(attempt.body));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, hits });
    });
  });
}

async function repeatScenarioDir(count: number, expectStatus: number): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'conf-repeat-'));
  await mkdir(path.join(dir, 'scenarios'), { recursive: true });
  await writeFile(
    path.join(dir, 'scenarios', 'a.yaml'),
    [
      'id: selftest.repeat-invalid-client',
      'requirements: [RFC9700-2.5-invalid-client-rate-limited-policy]',
      'profile: sender-constrained',
      'status: stable',
      'steps:',
      '  - id: exhausted',
      `    repeat: { count: ${count} }`,
      '    request: { method: POST, path: /oauth/token, form: { grant_type: client_credentials } }',
      `    expect: { status: ${expectStatus}, json: { error: invalid_client } }`,
      '',
    ].join('\n'),
  );
  return path.join(dir, 'scenarios');
}

test('CLI replays a repeated step exactly `repeat.count` times (known match)', async () => {
  const count = 10;
  const { server, url, hits } = await countingServer(401, { error: 'invalid_client' });
  try {
    const result = await cli(['run', '--base-url', url, '--scenarios', await repeatScenarioDir(count, 401)]);
    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.equal(hits.count, count, 'the runner must replay the step exactly `repeat.count` times');
    assert.ok(result.stdout.includes('PASS selftest.repeat-invalid-client'), result.stdout);
  } finally {
    server.close();
  }
});

test('CLI exits 1 when a repeated step mismatches on every iteration (known mismatch)', async () => {
  const count = 10;
  const { server, url, hits } = await countingServer(200, { access_token: 'x' });
  try {
    const result = await cli(['run', '--base-url', url, '--scenarios', await repeatScenarioDir(count, 401)]);
    assert.equal(result.code, 1, result.stdout + result.stderr);
    assert.equal(hits.count, count, 'all iterations must still have executed');
    assert.ok(result.stdout.includes('FAIL selftest.repeat-invalid-client'), result.stdout);
  } finally {
    server.close();
  }
});

test('CLI exits 1 when one intermediate iteration mismatches but first and last match', async () => {
  const count = 3;
  // first and last match the expectation (401), only the middle attempt differs.
  const { server, url, hits } = await sequencedServer([
    { status: 401, body: { error: 'invalid_client' } },
    { status: 200, body: { access_token: 'x' } },
    { status: 401, body: { error: 'invalid_client' } },
  ]);
  try {
    const result = await cli(['run', '--base-url', url, '--scenarios', await repeatScenarioDir(count, 401)]);
    assert.equal(result.code, 1, result.stdout + result.stderr);
    assert.equal(hits.count, count, 'every iteration must be sent and asserted, not just the first or last');
    assert.ok(result.stdout.includes('FAIL selftest.repeat-invalid-client'), result.stdout);
  } finally {
    server.close();
  }
});