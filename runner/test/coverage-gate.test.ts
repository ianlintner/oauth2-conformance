/**
 * Coverage gate self-test.
 *
 * The core profile must never regress below its recorded stable-coverage
 * floor, and the `coverage` CLI must fail a run whose coverage is below a
 * requested minimum (the "no green-by-skip" acceptance gate: removing stable
 * scenarios must turn CI red, not silently lower the bar).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { loadRequirements, loadScenarios, loadProfiles } from '../src/loader.js';
import { buildCoverage } from '../src/coverage.js';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const runnerDir = path.join(repoRoot, 'runner');

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

const requirements = await loadRequirements(path.join(repoRoot, 'requirements'));
const scenarios = await loadScenarios(path.join(repoRoot, 'scenarios'));
const profiles = await loadProfiles(path.join(repoRoot, 'profiles'));
const report = buildCoverage(requirements, scenarios, profiles, 'core');

// The floor must match docs/core-coverage.md. Bump both together when part 3/3
// promotes draft scenarios to stable; never lower it to green a bad PR.
const CORE_STABLE_FLOOR = 30;

test('core profile covers its documented stable floor and has no dangling/unknown references', () => {
  assert.equal(report.unknownProfiles.length, 0, `unknown scenario profiles: ${report.unknownProfiles.join(', ')}`);
  assert.equal(report.dangling.length, 0, `dangling scenario requirements: ${report.dangling.join(', ')}`);
  assert.ok(
    report.coveredRequirements >= CORE_STABLE_FLOOR,
    `core coverage ${report.coveredRequirements}/${report.totalRequirements} dropped below floor ${CORE_STABLE_FLOOR}`,
  );
});

test('every core MUST-NOT and MUST requirement is covered, provisional, or documented', () => {
  // The documented non-coverage set is exactly the MAY / implementation-policy
  // requirements in docs/core-coverage.md; anything else at level MUST or
  // MUST NOT must have at least a stable or draft scenario.
  const documented = new Set([
    'RFC8252-8.12-as-may-block-embedded-user-agent',
    'RFC9700-2.6-http-upgrade-redirect-308',
    'RFC9700-2.6-https-enforcement-disableable',
    'RFC9700-4.13-forwarded-proto-trusted',
    'RFC9700-4.13-forwarded-proto-untrusted',
  ]);
  const uncovered = new Set(report.uncovered);
  const provisional = new Set(report.provisional);
  for (const req of requirements.filter((r) => r.profile === 'core')) {
    if (req.level !== 'MUST' && req.level !== 'MUST NOT') continue;
    const hasAny = !uncovered.has(req.id) || provisional.has(req.id) || documented.has(req.id);
    assert.ok(hasAny, `core ${req.level} requirement ${req.id} has no scenario and no documented reason`);
  }
});

test('coverage CLI fails below --min, proving the gate is not green-by-skip', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cov-'));
  await mkdir(path.join(dir, 'scenarios'), { recursive: true });
  await writeFile(
    path.join(dir, 'scenarios', 'none.yaml'),
    'id: empty.none\nrequirements: [RFC6749-5.1-no-store]\nprofile: core\nstatus: draft\nsteps:\n  - id: token\n    request: { method: POST, path: /oauth/token, form: { grant_type: urn:bogus } }\n    expect: { status: 400 }\n',
  );
  const result = await cli(['coverage', '--scenarios', path.join(dir, 'scenarios'), '--requirements', path.join(repoRoot, 'requirements'), '--profiles', path.join(repoRoot, 'profiles'), '--profile', 'core', '--min', '100']);
  assert.notEqual(result.code, 0, 'coverage --min 100 with only a draft scenario must fail');
});
