/**
 * Regression tests for false-PASS: a run must never report success unless a
 * stable scenario actually executed and matched, and schema-invalid data must
 * never validate.
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
import { checkDocument, loadValidators, validateRepository } from '../src/schema-validate.js';

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

async function scenarios(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'fp-'));
  await mkdir(path.join(dir, 'scenarios'), { recursive: true });
  for (const [name, content] of Object.entries(files)) await writeFile(path.join(dir, 'scenarios', name), content);
  return path.join(dir, 'scenarios');
}

const scenario = (id: string, status: string, expectStatus: number): string => [
  `id: ${id}`,
  'requirements: [RFC6749-5.2-invalid-client]',
  'profile: core',
  `status: ${status}`,
  'steps:',
  '  - id: token',
  '    request: { method: POST, path: /oauth/token, form: { grant_type: client_credentials } }',
  `    expect: { status: ${expectStatus}, json: { error: invalid_client } }`,
  '',
].join('\n');

test('a run with only draft scenarios does not report success', async () => {
  const { server, url } = await listen(401, { error: 'invalid_client' });
  try {
    const dir = await scenarios({ 'a.yaml': scenario('fp.draft-only', 'draft', 401) });
    const result = await cli(['run', '--base-url', url, '--scenarios', dir]);
    assert.notEqual(result.code, 0, result.stdout + result.stderr);
  } finally {
    server.close();
  }
});

test('an empty scenario directory does not report success', async () => {
  const { server, url } = await listen(401, { error: 'invalid_client' });
  try {
    const dir = await scenarios({});
    const result = await cli(['run', '--base-url', url, '--scenarios', dir]);
    assert.notEqual(result.code, 0, result.stdout + result.stderr);
  } finally {
    server.close();
  }
});

test('a failing draft scenario is deferred and cannot fail or rescue the verdict', async () => {
  const { server, url } = await listen(401, { error: 'invalid_client' });
  try {
    const dir = await scenarios({
      'a.yaml': scenario('fp.stable-pass', 'stable', 401),
      'b.yaml': scenario('fp.draft-fail', 'draft', 200),
    });
    const result = await cli(['run', '--base-url', url, '--scenarios', dir]);
    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /PASS fp\.stable-pass/);
    assert.doesNotMatch(result.stdout, /PASS fp\.draft-fail/);
    assert.match(result.stdout, /DEFER fp\.draft-fail/);
  } finally {
    server.close();
  }
});

test('a failing stable scenario fails the run even beside passing ones', async () => {
  const { server, url } = await listen(401, { error: 'invalid_client' });
  try {
    const dir = await scenarios({
      'a.yaml': scenario('fp.stable-pass', 'stable', 401),
      'b.yaml': scenario('fp.stable-fail', 'stable', 200),
    });
    const result = await cli(['run', '--base-url', url, '--scenarios', dir]);
    assert.equal(result.code, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /FAIL fp\.stable-fail/);
  } finally {
    server.close();
  }
});

test('an unreachable system under test fails the run', async () => {
  const dir = await scenarios({ 'a.yaml': scenario('fp.unreachable', 'stable', 401) });
  const result = await cli(['run', '--base-url', 'http://127.0.0.1:1', '--scenarios', dir]);
  assert.equal(result.code, 1, result.stdout + result.stderr);
});

test('repository data validates against the JSON schemas', async () => {
  const { checked, violations } = await validateRepository(repoRoot);
  assert.deepEqual(violations, []);
  assert.ok(checked > 0);
});

test('schema validation rejects invalid scenarios', async () => {
  const validators = await loadValidators(path.join(repoRoot, 'schemas'));
  assert.notEqual(checkDocument(validators, 'scenario', { id: 'x' }).length, 0);
  assert.notEqual(checkDocument(validators, 'scenario', { id: 'x', requirements: [], profile: 'core', status: 'bogus', steps: [] }).length, 0);
  assert.notEqual(checkDocument(validators, 'requirement', [{ id: 'x' }]).length, 0);
});

test('validate-schemas exits non-zero on an invalid data file', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'vs-'));
  await mkdir(path.join(root, 'schemas'));
  for (const name of ['requirement', 'profile', 'scenario', 'seed', 'implementation-manifest']) {
    await writeFile(path.join(root, 'schemas', `${name}.schema.json`), await (await import('node:fs/promises')).readFile(path.join(repoRoot, 'schemas', `${name}.schema.json`)));
  }
  await mkdir(path.join(root, 'scenarios'));
  await writeFile(path.join(root, 'scenarios', 'bad.yaml'), 'id: bad\n');
  const result = await cli(['validate-schemas', '--root', root]);
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /INVALID/);
});

test('coverage --profile scopes the gate to one profile and still fails when it is uncovered', async () => {
  const args = ['coverage', '--scenarios', path.join(repoRoot, 'scenarios'), '--requirements', path.join(repoRoot, 'requirements'), '--profiles', path.join(repoRoot, 'profiles')];
  const core = await cli([...args, '--profile', 'core', '--min', '100']);
  assert.equal(core.code, 0, core.stdout + core.stderr);
  const all = await cli([...args, '--min', '100']);
  assert.equal(all.code, 1, 'draft-only profiles must not count as covered');
});
