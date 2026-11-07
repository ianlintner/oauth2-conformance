/**
 * Declared profile membership (profiles/*.yaml requirement lists) drives
 * status counts, coverage scoping and run selection, not only each
 * requirement's canonical profile.
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

test('status counts a reused requirement under every declaring profile', () => {
  const reuser = computeContractStatus(scenarios, requirements, profiles).profiles.find((p) => p.id === 'reuser');
  assert.equal(reuser?.requirements, 1);
  assert.equal(reuser?.totalMust, 1);
  assert.equal(reuser?.coveredMust, 1);
});

test('profile-scoped coverage includes reused requirements and their shared scenarios', () => {
  const report = buildCoverage(requirements, scenarios, profiles, 'reuser');
  assert.deepEqual(report.requirements.map((r) => r.requirement), ['SHARED-1']);
  assert.deepEqual(report.requirements[0]?.stable, ['s-shared']);
});

test('--profile selection admits shared scenarios whose requirements are all declared', () => {
  const ids = selectScenarios(scenarios, { baseUrl: 'x', implementation: 'x', contract: 'x', profile: 'reuser', profileRequirements: ['SHARED-1'] }).map((s) => s.id);
  assert.deepEqual(ids, ['s-shared']);
});
