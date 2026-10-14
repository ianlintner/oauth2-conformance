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
import { cp, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { parse } from 'yaml';
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
  for (const name of ['requirement', 'profile', 'scenario', 'seed', 'implementation-manifest', 'invariant']) {
    await writeFile(path.join(root, 'schemas', `${name}.schema.json`), await (await import('node:fs/promises')).readFile(path.join(repoRoot, 'schemas', `${name}.schema.json`)));
  }
  await mkdir(path.join(root, 'scenarios'));
  await writeFile(path.join(root, 'scenarios', 'bad.yaml'), 'id: bad\n');
  const result = await cli(['validate-schemas', '--root', root]);
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /INVALID/);
});

test('schema validation rejects invalid invariants', async () => {
  const validators = await loadValidators(path.join(repoRoot, 'schemas'));
  const good = { id: 'INV-CODE-SINGLE-USE', profile: 'core', summary: 'A code is redeemed once.', requirement: 'RFC6749-4.1.3-code-single-use' };
  assert.deepEqual(checkDocument(validators, 'invariant', [good]), []);
  assert.notEqual(checkDocument(validators, 'invariant', [{ ...good, id: 'not-an-invariant-id' }]).length, 0);
  assert.notEqual(checkDocument(validators, 'invariant', [{ id: good.id, profile: 'core' }]).length, 0);
  assert.notEqual(checkDocument(validators, 'invariant', [{ ...good, extra: true }]).length, 0);
  assert.notEqual(checkDocument(validators, 'invariant', good).length, 0, 'an invariants file is a list');
  assert.notEqual(checkDocument(validators, 'invariant', []).length, 0, 'an invariants file must not be empty');
});

test('validate-schemas validates invariants files: valid passes, malformed fails', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'vsi-'));
  await mkdir(path.join(root, 'schemas'));
  for (const name of ['requirement', 'profile', 'scenario', 'seed', 'implementation-manifest', 'invariant']) {
    await writeFile(path.join(root, 'schemas', `${name}.schema.json`), await readFile(path.join(repoRoot, 'schemas', `${name}.schema.json`)));
  }
  await mkdir(path.join(root, 'invariants'));
  await writeFile(path.join(root, 'invariants', 'core.yaml'), '- id: INV-OK-ONE\n  profile: core\n  summary: Fine invariant.\n  requirement: RFC6749-4.1.3-code-single-use\n');
  const ok = await cli(['validate-schemas', '--root', root]);
  assert.equal(ok.code, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /OK \(1 files\)/, 'the invariants file must be counted as checked');
  await writeFile(path.join(root, 'invariants', 'core.yaml'), '- id: bad id\n  profile: core\n');
  const bad = await cli(['validate-schemas', '--root', root]);
  assert.equal(bad.code, 1, bad.stdout + bad.stderr);
  assert.match(bad.stderr, /INVALID invariants[/\\]core\.yaml/);
});

test('repository invariants/core.yaml is checked by validateRepository', async () => {
  const before = await validateRepository(repoRoot);
  const maskRoot = await mkdtemp(path.join(tmpdir(), 'vrepo-'));
  const mask = (rel: string) => path.join(maskRoot, rel);
  for (const rel of ['schemas', 'requirements', 'profiles', 'scenarios', 'examples', 'invariants']) {
    await cp(path.join(repoRoot, rel), mask(rel), { recursive: true });
  }
  await writeFile(mask('invariants/core.yaml'), '- id: INV-BROKEN\n  profile: core\n');
  const broken = await validateRepository(maskRoot);
  assert.equal(broken.checked, before.checked, 'the same number of files must be checked');
  assert.notEqual(broken.violations.length, 0, 'the malformed invariant must produce a violation');
  assert.ok(
    broken.violations.some((v) => v.file.startsWith('invariants') && v.kind === 'invariant'),
    `expected an invariant violation, got ${JSON.stringify(broken.violations.map((v) => `${v.kind}:${v.file}`))}`,
  );
});

test('coverage --profile scopes the gate to one profile and still fails when it is uncovered', async () => {
  const args = ['coverage', '--scenarios', path.join(repoRoot, 'scenarios'), '--requirements', path.join(repoRoot, 'requirements'), '--profiles', path.join(repoRoot, 'profiles')];
  // Contract v0.1 part 1/3 adds the core catalog before its scenarios (part 2/3
  // restores the 100% gate), so assert the scoped gate wiring only: a floor the
  // profile meets passes, and 100% fails while requirements are uncovered.
  const core = await cli([...args, '--profile', 'core', '--min', '1']);
  assert.equal(core.code, 0, core.stdout + core.stderr);
  const coreFull = await cli([...args, '--profile', 'core', '--min', '100']);
  assert.equal(coreFull.code, 1, 'uncovered core requirements must fail a 100% gate');
  const all = await cli([...args, '--min', '100']);
  assert.equal(all.code, 1, 'draft-only profiles must not count as covered');
});

test('a wrong response header fails the run', async () => {
  const server = createServer((_req, res) => {
    res.writeHead(401, { 'content-type': 'application/json', 'www-authenticate': 'Bearer' });
    res.end(JSON.stringify({ error: 'invalid_client' }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const dir = await scenarios({
      'a.yaml': scenario('fp.header', 'stable', 401).replace('expect: { status: 401,', 'expect: { status: 401, headers: { www-authenticate: Basic },'),
    });
    const result = await cli(['run', '--base-url', url, '--scenarios', dir]);
    assert.equal(result.code, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /FAIL fp\.header/);
    assert.match(result.stdout, /www-authenticate/);
  } finally {
    server.close();
  }
});

test('a wrong claim in the response body fails the run', async () => {
  const { server, url } = await listen(401, { error: 'invalid_request' });
  try {
    const dir = await scenarios({ 'a.yaml': scenario('fp.claim', 'stable', 401) });
    const result = await cli(['run', '--base-url', url, '--scenarios', dir]);
    assert.equal(result.code, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /FAIL fp\.claim/);
    assert.match(result.stdout, /error/);
  } finally {
    server.close();
  }
});

test('a run whose scenarios are all non-stable fails with verdict=fail', async () => {
  const { server, url } = await listen(401, { error: 'invalid_client' });
  try {
    const dir = await scenarios({
      'a.yaml': scenario('fp.draft', 'draft', 401),
      'b.yaml': scenario('fp.deviation', 'reference-deviation', 401),
    });
    const result = await cli(['run', '--base-url', url, '--scenarios', dir]);
    assert.equal(result.code, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /verdict=fail/);
  } finally {
    server.close();
  }
});

test('the Rust route inventory pins the 94 routes of the reference commit', async () => {
  const inventory = parse(await readFile(path.join(repoRoot, 'reference', 'rust-routes.yaml'), 'utf8')) as {
    commit: string;
    routes: { method: string; path: string }[];
  };
  assert.equal(inventory.commit, 'f6206d81848a13dc653aca718002f5c2e78cce61');
  assert.equal(inventory.routes.length, 94);
  const keys = inventory.routes.map((route) => `${route.method} ${route.path}`);
  assert.equal(new Set(keys).size, keys.length, 'routes must be unique');
});
