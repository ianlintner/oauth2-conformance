/**
 * Status dashboard: known fixture -> exact per-profile counts, exact
 * requirement-coverage ratio, port matrix, and a deterministic markdown render.
 *
 * docs/STATUS.md is generated from these functions; CI regenerates it and
 * fails when the checked-in copy differs, so status cannot drift from the data.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeContractStatus,
  computePortStatus,
  parsePortManifest,
  renderStatus,
  type PortReport,
} from '../src/status-report.js';
import type { Scenario } from '../src/scenario.js';
import type { Requirement, RequirementLevel } from '../src/requirement.js';
import type { Profile } from '../src/profile.js';
import type { ScenarioStatus } from '../src/status.js';

function scenario(id: string, profile: string, status: ScenarioStatus, requirements: string[]): Scenario {
  return { id, profile, status, requirements, steps: [] };
}

function requirement(id: string, profile: string, level: RequirementLevel): Requirement {
  return { id, spec: 'RFC 0', clause: '1', level, profile, summary: 'fixture requirement summary', link: 'https://example.test/' };
}

function profile(id: string, requirements: string[]): Profile {
  return { id, title: `Profile ${id}`, requirements };
}

// alpha: 3 stable, 2 draft, 1 reference-deviation, 1 retired.
// beta: only a draft scenario. gamma: requirements, zero scenarios.
const fixtureProfiles = [
  profile('alpha', ['A-1', 'A-2', 'A-3', 'A-4']),
  profile('beta', ['B-1']),
  profile('gamma', ['G-1', 'G-2']),
];
const fixtureRequirements = [
  requirement('A-1', 'alpha', 'MUST'), // covered by a stable scenario
  requirement('A-2', 'alpha', 'MUST NOT'), // only draft scenarios -> not covered
  requirement('A-3', 'alpha', 'SHOULD'), // stable, but not MUST -> excluded from the MUST ratio
  requirement('A-4', 'alpha', 'MUST'), // only reference-deviation/retired -> not covered
  requirement('B-1', 'beta', 'MUST'),
  requirement('G-1', 'gamma', 'MUST'),
  requirement('G-2', 'gamma', 'MAY'),
];
const fixtureScenarios = [
  scenario('alpha.s1', 'alpha', 'stable', ['A-1']),
  scenario('alpha.s2', 'alpha', 'stable', ['A-1', 'A-3']),
  scenario('alpha.s3', 'alpha', 'stable', ['A-3']),
  scenario('alpha.d1', 'alpha', 'draft', ['A-2']),
  scenario('alpha.d2', 'alpha', 'draft', ['A-2']),
  scenario('alpha.r1', 'alpha', 'reference-deviation', ['A-4']),
  scenario('alpha.x1', 'alpha', 'retired', ['A-4']),
  scenario('beta.d1', 'beta', 'draft', ['B-1']),
];

function statusFor(id: string): ReturnType<typeof computeContractStatus>['profiles'][number] {
  const found = computeContractStatus(fixtureScenarios, fixtureRequirements, fixtureProfiles).profiles.find((entry) => entry.id === id);
  assert.ok(found, `profile ${id} missing from status`);
  return found;
}

test('computeContractStatus reports exact per-profile scenario counts (retired excluded from the total)', () => {
  const alpha = statusFor('alpha');
  assert.deepEqual(
    { stable: alpha.stable, referenceDeviation: alpha.referenceDeviation, draft: alpha.draft, retired: alpha.retired, total: alpha.total },
    { stable: 3, referenceDeviation: 1, draft: 2, retired: 1, total: 6 },
  );
  const beta = statusFor('beta');
  assert.deepEqual([beta.stable, beta.referenceDeviation, beta.draft, beta.total], [0, 0, 1, 1]);
  // A profile with requirements but no scenarios is still reported, with zeros.
  const gamma = statusFor('gamma');
  assert.deepEqual([gamma.stable, gamma.referenceDeviation, gamma.draft, gamma.total], [0, 0, 0, 0]);
});

test('requirement coverage counts only MUST / MUST NOT requirements with >=1 stable scenario', () => {
  // alpha MUST/MUST NOT: A-1 (stable), A-2 (draft only), A-4 (reference-deviation only). A-3 is SHOULD.
  assert.deepEqual([statusFor('alpha').coveredMust, statusFor('alpha').totalMust, statusFor('alpha').requirements], [1, 3, 4]);
  assert.deepEqual([statusFor('beta').coveredMust, statusFor('beta').totalMust], [0, 1]);
  assert.deepEqual([statusFor('gamma').coveredMust, statusFor('gamma').totalMust, statusFor('gamma').requirements], [0, 1, 2]);
});

test('a profile that appears only on a scenario or requirement is still reported', () => {
  const status = computeContractStatus(
    [scenario('z.s', 'zeta', 'stable', ['Z-1'])],
    [requirement('Z-1', 'zeta', 'MUST NOT')],
    [],
  );
  assert.deepEqual(status.profiles.map((entry) => [entry.id, entry.stable, entry.coveredMust, entry.totalMust]), [['zeta', 1, 1, 1]]);
});

test('renderStatus writes the exact contract table and a totals row, deterministically', () => {
  const status = computeContractStatus(fixtureScenarios, fixtureRequirements, fixtureProfiles);
  const markdown = renderStatus(status, []);

  assert.ok(markdown.includes('# Conformance status'));
  assert.ok(markdown.includes('| Profile | Stable | Reference-deviation | Draft | Scenarios | MUST / MUST NOT with a stable scenario | Requirements |'));
  assert.ok(markdown.includes('| `alpha` | 3 | 1 | 2 | 6 | 1 / 3 (33%) | 4 |'));
  assert.ok(markdown.includes('| `beta` | 0 | 0 | 1 | 1 | 0 / 1 (0%) | 1 |'));
  assert.ok(markdown.includes('| `gamma` | 0 | 0 | 0 | 0 | 0 / 1 (0%) | 2 |'));
  assert.ok(markdown.includes('| **Total** | **3** | **1** | **3** | **7** | **1 / 5 (20%)** | **7** |'));
  assert.ok(!markdown.includes('## Ports'), 'no ports section without manifests');
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(markdown), 'output must be deterministic (no dates)');
  assert.equal(renderStatus(status, []), markdown);
});

const MANIFEST = `# snapshot: ianlintner/alpha-server@${'a'.repeat(40)}
# comment
implementation: alpha-server
contract: ${'b'.repeat(40)}
profiles: [alpha, beta]
deviations:
  - requirement: A-2
    reason: declared deviation with a long enough reason
`;

test('parsePortManifest reads claims, pin, deviations and the snapshot header', () => {
  const manifest = parsePortManifest(MANIFEST);
  assert.equal(manifest.implementation, 'alpha-server');
  assert.equal(manifest.contract, 'b'.repeat(40));
  assert.deepEqual(manifest.profiles, ['alpha', 'beta']);
  assert.deepEqual(manifest.deviations.map((deviation) => deviation.requirement), ['A-2']);
  assert.deepEqual(manifest.snapshot, { source: 'ianlintner/alpha-server', commit: 'a'.repeat(40) });
});

test('parsePortManifest tolerates a missing deviations list and snapshot header', () => {
  const manifest = parsePortManifest(`implementation: x-server\ncontract: 1.2.3\nprofiles: [alpha]\n`);
  assert.deepEqual(manifest.deviations, []);
  assert.equal(manifest.snapshot, undefined);
});

test('parsePortManifest rejects a manifest with no profile claims', () => {
  assert.throws(() => parsePortManifest('implementation: x\ncontract: 1.0.0\n'), /profiles/);
});

function report(profileId: string, results: PortReport['results'], implementation = 'alpha-server'): PortReport {
  return { contract: 'b'.repeat(40), implementation, profile: profileId, results };
}

test('computePortStatus: unclaimed profiles are not claimed; claimed without a report has no results', () => {
  const port = computePortStatus(parsePortManifest(MANIFEST), [], fixtureRequirements);
  assert.equal(port.cells['alpha']?.claimed, true);
  assert.equal(port.cells['alpha']?.results, undefined);
  assert.equal(port.cells['gamma'], undefined);
  // Deviations resolve to the profile of their requirement.
  assert.deepEqual(port.cells['alpha']?.deviations, ['A-2']);
});

test('computePortStatus ingests reports: stable pass/fail, deferred, later reports win, other implementations ignored', () => {
  const alpha = report('alpha', [
    { id: 'alpha.s1', status: 'stable', outcome: 'pass', profile: 'alpha' },
    { id: 'alpha.s2', status: 'stable', outcome: 'fail', profile: 'alpha' },
    { id: 'alpha.s3', status: 'stable', outcome: 'pass', profile: 'alpha' },
    { id: 'alpha.d1', status: 'draft', outcome: 'deferred', profile: 'alpha' },
    { id: 'alpha.r1', status: 'reference-deviation', outcome: 'deferred', profile: 'alpha' },
    { id: 'alpha.d2', status: 'draft', outcome: 'pass', profile: 'alpha' }, // passing draft: neither stable nor deferred
  ]);
  const wildcard = report('*', [{ id: 'alpha.s2', status: 'stable', outcome: 'pass', profile: 'alpha' }]);
  const other = report('alpha', [{ id: 'alpha.s1', status: 'stable', outcome: 'fail', profile: 'alpha' }], 'someone-else');
  const port = computePortStatus(parsePortManifest(MANIFEST), [alpha, wildcard, other], fixtureRequirements);
  assert.deepEqual(port.cells['alpha']?.results, { passed: 3, failed: 0, deferred: 2 });
});

test('renderStatus renders the port matrix: claim, pin, snapshot, results and the deviation list', () => {
  const status = computeContractStatus(fixtureScenarios, fixtureRequirements, fixtureProfiles);
  const bare = renderStatus(status, [computePortStatus(parsePortManifest(MANIFEST), [], fixtureRequirements)]);
  assert.ok(bare.includes('## Ports'));
  assert.ok(bare.includes('| Implementation | Pinned contract | Snapshot | `alpha` | `beta` |'));
  assert.ok(bare.includes(`| \`alpha-server\` | \`${'b'.repeat(12)}\` | \`ianlintner/alpha-server@${'a'.repeat(12)}\` | claimed; 1 deviation | claimed |`));
  assert.ok(bare.includes('### Declared deviations'));
  assert.ok(bare.includes('`alpha-server` · `A-2` (`alpha`): declared deviation with a long enough reason'));

  const alpha = report('alpha', [
    { id: 'alpha.s1', status: 'stable', outcome: 'pass', profile: 'alpha' },
    { id: 'alpha.s2', status: 'stable', outcome: 'fail', profile: 'alpha' },
    { id: 'alpha.d1', status: 'draft', outcome: 'deferred', profile: 'alpha' },
  ]);
  const withReport = renderStatus(status, [computePortStatus(parsePortManifest(MANIFEST), [alpha], fixtureRequirements)]);
  assert.ok(withReport.includes('claimed: 1 pass / 1 fail / 1 deferred; 1 deviation'));
});
