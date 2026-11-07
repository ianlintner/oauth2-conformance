/**
 * Declared profile membership (profiles/*.yaml requirement lists) drives which
 * requirements a profile *lists* and claims, but a scenario is only ever
 * attributed to the profile it is filed under (`scenario.profile`) plus the
 * profiles it explicitly opts into via `profiles`.
 *
 * A profile may cite a requirement whose canonical profile is elsewhere; that
 * records an intent to satisfy it, not evidence that another profile's fixture
 * is compatible. Cross-profile requirement-ID overlap must never pull a
 * scenario into a profile whose authentication/authorization assumptions the
 * fixture does not meet (e.g. FAPI2 forbids the public-client no-PAR exchange
 * that `core.pkce.s256-exchanged` performs, and the `client_secret_basic`
 * authentication that `sender-constrained.dpop.jti-replay` relies on).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCoverage } from '../src/coverage.js';
import { selectScenarios } from '../src/runner.js';
import { computeContractStatus } from '../src/status-report.js';
import type { Profile } from '../src/profile.js';
import type { Requirement } from '../src/requirement.js';
import type { Scenario } from '../src/scenario.js';

const req = (id: string, profile: string): Requirement => ({
  id, spec: 'RFC 0', clause: '1', level: 'MUST', profile, summary: 'fixture requirement summary', link: 'https://example.test/',
});
const requirements = [req('OWN-1', 'owner'), req('SHARED-1', 'owner')];
const profiles: Profile[] = [
  { id: 'owner', title: 'Owner profile', requirements: ['OWN-1', 'SHARED-1'] },
  { id: 'reuser', title: 'Reusing profile', requirements: ['SHARED-1'] },
];
const scenarios: Scenario[] = [
  { id: 's-shared', profile: 'owner', status: 'stable', requirements: ['SHARED-1'], steps: [] },
  { id: 's-own', profile: 'owner', status: 'stable', requirements: ['OWN-1'], steps: [] },
];

test('status lists a reused requirement under every declaring profile, but only a native scenario covers it', () => {
  const reuser = computeContractStatus(scenarios, requirements, profiles).profiles.find((p) => p.id === 'reuser');
  // The reuser profile *declares* SHARED-1, so it is listed and counted among
  // its MUST requirements, but no fixture is filed under `reuser`, so it is
  // not covered.
  assert.equal(reuser?.requirements, 1);
  assert.equal(reuser?.totalMust, 1);
  assert.equal(reuser?.coveredMust, 0);
  const owner = computeContractStatus(scenarios, requirements, profiles).profiles.find((p) => p.id === 'owner');
  assert.equal(owner?.coveredMust, 2);
});

test('profile-scoped coverage attributes only scenarios filed under the profile', () => {
  const report = buildCoverage(requirements, scenarios, profiles, 'reuser');
  assert.deepEqual(report.requirements.map((r) => r.requirement), ['SHARED-1']);
  // `s-shared` is filed under `owner`, so it does not cover SHARED-1 for the
  // reuser profile even though the reuser cites the requirement.
  assert.deepEqual(report.requirements[0]?.stable, []);
  assert.deepEqual(report.requirements[0]?.provisional, []);
  assert.ok(report.uncovered.includes('SHARED-1'));
});

test('--profile selection never admits a scenario without explicit opt-in', () => {
  const ids = selectScenarios(scenarios, { baseUrl: 'x', implementation: 'x', contract: 'x', profile: 'reuser' }).map((s) => s.id);
  assert.deepEqual(ids, []);
});

test('--profile selection admits a scenario that opts into the profile via `profiles`', () => {
  const shared = { ...scenarios[0]!, profiles: ['reuser'] };
  const ids = selectScenarios([shared], { baseUrl: 'x', implementation: 'x', contract: 'x', profile: 'reuser' }).map((s) => s.id);
  assert.deepEqual(ids, ['s-shared']);
});

test('coverage flags an unknown profile in the opt-in `profiles` list, not just the canonical `profile`', () => {
  const shared = { ...scenarios[0]!, profile: 'owner', profiles: ['reuser', 'ghost'] };
  const report = buildCoverage(requirements, [shared], profiles, undefined);
  assert.ok(report.unknownProfiles.includes('ghost'), `expected ghost in unknownProfiles, got ${report.unknownProfiles.join(', ')}`);
  assert.ok(!report.unknownProfiles.includes('reuser'), 'declared reuser profile must not be flagged unknown');
});

test('coverage does not flag a declared opt-in profile as unknown', () => {
  const shared = { ...scenarios[0]!, profile: 'owner', profiles: ['reuser'] };
  const report = buildCoverage(requirements, [shared], profiles, undefined);
  assert.equal(report.unknownProfiles.length, 0, `expected no unknown profiles, got ${report.unknownProfiles.join(', ')}`);
});