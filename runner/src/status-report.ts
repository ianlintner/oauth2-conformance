/**
 * Status dashboard: data-derived project status.
 *
 * `computeContractStatus` reads the checked-out contract (scenarios,
 * requirements, profiles) and derives per-profile scenario counts and a
 * MUST/MUST-NOT requirement-coverage ratio. `computePortStatus` overlays port
 * conformance manifests (and, optionally, swallowed `RunReport`s) into a
 * per-implementation x profile claim matrix. `renderStatus` renders both into
 * the deterministic markdown that becomes `docs/STATUS.md`.
 *
 * Nothing here invents state: every number is computed from the inputs, which
 * is what lets CI regenerate the document and fail when it has drifted.
 */

import { parse as parseYaml } from 'yaml';
import type { Requirement } from './requirement.js';
import type { Profile } from './profile.js';
import type { Scenario } from './scenario.js';
import type { ScenarioStatus } from './status.js';
import type { ScenarioResult } from './runner.js';

/** Per-profile scenario counts plus requirement coverage. */
export interface ProfileStatus {
  id: string;
  stable: number;
  referenceDeviation: number;
  draft: number;
  /** Scenario statuses still present on disk but not otherwise counted. */
  retired: number;
  /** Non-retired scenarios in this profile. */
  total: number;
  /** MUST / MUST NOT requirements with at least one stable scenario. */
  coveredMust: number;
  /** All MUST / MUST NOT requirements in this profile. */
  totalMust: number;
  /** All requirements (any level) in this profile. */
  requirements: number;
}

export interface ContractStatus {
  profiles: ProfileStatus[];
}

/** Count, per profile, each scenario status present on disk. */
function countScenarios(scenarios: Scenario[]): Map<string, Map<ScenarioStatus, number>> {
  const counts = new Map<string, Map<ScenarioStatus, number>>();
  for (const scenario of scenarios) {
    let byStatus = counts.get(scenario.profile);
    if (byStatus === undefined) {
      byStatus = new Map<ScenarioStatus, number>();
      counts.set(scenario.profile, byStatus);
    }
    byStatus.set(scenario.status, (byStatus.get(scenario.status) ?? 0) + 1);
  }
  return counts;
}

/** Requirement IDs with a stable scenario, keyed by profile. */
function stableRequirementIds(scenarios: Scenario[]): Set<string> {
  const ids = new Set<string>();
  for (const scenario of scenarios) {
    if (scenario.status !== 'stable') continue;
    for (const requirement of scenario.requirements) ids.add(requirement);
  }
  return ids;
}

/** Every profile id that appears on a scenario or requirement (or is declared). */
function allProfileIds(scenarios: Scenario[], requirements: Requirement[], profiles: Profile[]): Set<string> {
  const ids = new Set<string>(profiles.map((profile) => profile.id));
  for (const scenario of scenarios) ids.add(scenario.profile);
  for (const requirement of requirements) ids.add(requirement.profile);
  return ids;
}

/**
 * Derive per-profile status from the checked-out contract. Retired scenarios
 * are counted separately and excluded from `total` (they are historical
 * records, not live fixtures).
 */
export function computeContractStatus(
  scenarios: Scenario[],
  requirements: Requirement[],
  profiles: Profile[] = [],
): ContractStatus {
  const counts = countScenarios(scenarios);
  const stableReqs = stableRequirementIds(scenarios);

  const requirementsByProfile = new Map<string, Requirement[]>();
  for (const requirement of requirements) {
    let list = requirementsByProfile.get(requirement.profile);
    if (list === undefined) {
      list = [];
      requirementsByProfile.set(requirement.profile, list);
    }
    list.push(requirement);
  }

  const result: ProfileStatus[] = [];
  for (const id of allProfileIds(scenarios, requirements, profiles)) {
    const byStatus = counts.get(id) ?? new Map<ScenarioStatus, number>();
    const stable = byStatus.get('stable') ?? 0;
    const draft = byStatus.get('draft') ?? 0;
    const referenceDeviation = byStatus.get('reference-deviation') ?? 0;
    const retired = byStatus.get('retired') ?? 0;

    const profileRequirements = requirementsByProfile.get(id) ?? [];
    const mustRequirements = profileRequirements.filter((requirement) => requirement.level === 'MUST' || requirement.level === 'MUST NOT');
    const coveredMust = mustRequirements.filter((requirement) => stableReqs.has(requirement.id)).length;

    result.push({
      id,
      stable,
      draft,
      referenceDeviation,
      retired,
      total: stable + draft + referenceDeviation,
      coveredMust,
      totalMust: mustRequirements.length,
      requirements: profileRequirements.length,
    });
  }
  result.sort((a, b) => a.id.localeCompare(b.id));

  return { profiles: result };
}

/* ------------------------------------------------------------------------ *
 * Port manifests and reports
 * ------------------------------------------------------------------------ */

export interface Deviation {
  requirement: string;
  reason: string;
  profile?: string;
}

export interface PortManifest {
  implementation: string;
  contract: string;
  profiles: string[];
  deviations: Deviation[];
  snapshot?: { source: string; commit: string };
}

const SNAPSHOT_HEADER = /^# snapshot: ([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)@([0-9a-f]{40})$/;

/**
 * Parse a `conformance.yaml` manifest. Only the fields the dashboard needs
 * (implementation, contract, profiles, deviations) are read; unknown keys are
 * ignored so a port's extra fields cannot break status generation. A manifest
 * without a non-empty `profiles` claim list is rejected.
 */
export function parsePortManifest(text: string): PortManifest {
  const doc: unknown = parseYaml(text);
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) throw new Error('manifest must be a YAML mapping');
  const value = doc as Record<string, unknown>;
  const implementation = value['implementation'];
  const contract = value['contract'];
  const profiles = value['profiles'];
  if (typeof implementation !== 'string' || typeof contract !== 'string') {
    throw new Error('manifest must declare string `implementation` and `contract`');
  }
  if (!Array.isArray(profiles) || profiles.length === 0 || !profiles.every((entry) => typeof entry === 'string')) {
    throw new Error('manifest must declare a non-empty `profiles` list');
  }
  const rawDeviations = value['deviations'] ?? [];
  if (!Array.isArray(rawDeviations)) throw new Error('manifest `deviations` must be a list');
  const deviations: Deviation[] = rawDeviations.map((entry: unknown) => {
    const item = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<string, unknown>;
    if (typeof item['requirement'] !== 'string' || typeof item['reason'] !== 'string') {
      throw new Error('each deviation needs string `requirement` and `reason`');
    }
    return { requirement: item['requirement'], reason: item['reason'] };
  });

  const match = text.split('\n').map((line) => SNAPSHOT_HEADER.exec(line)).find((entry) => entry !== null);
  return {
    implementation,
    contract,
    profiles: profiles as string[],
    deviations,
    ...(match != null ? { snapshot: { source: match[1] as string, commit: match[2] as string } } : {}),
  };
}

/** The subset of a runner `RunReport` the dashboard reads; a full RunReport is assignable. */
export type PortReportResult = Pick<ScenarioResult, 'id' | 'status' | 'outcome' | 'profile'>;

export interface PortReport {
  contract: string;
  implementation: string;
  profile: string;
  results: PortReportResult[];
}

export interface PortCell {
  claimed: boolean;
  /** Undefined when the port claims the profile but no report was supplied. */
  results?: { passed: number; failed: number; deferred: number };
  deviations: string[];
}

export interface PortStatus {
  implementation: string;
  contract: string;
  snapshot?: PortManifest['snapshot'];
  cells: Record<string, PortCell>;
  deviations: Deviation[];
}

/** Normalize a long commit SHA into the short display form used in the matrix. */
function shortSha(sha: string): string {
  return sha.slice(0, 12);
}

/**
 * Overlay port claims and (optionally) swallowed reports into a per-profile
 * claim/results matrix. A deviation is attributed to the profile of the
 * requirement it names (not to a `profile` key many manifests don't carry), so
 * declared deviations surface under the right profile column.
 */
export function computePortStatus(manifest: PortManifest, reports: PortReport[], requirements: Requirement[]): PortStatus {
  const claimSet = new Set(manifest.profiles);
  const deviationProfile = new Map<string, string>();
  for (const requirement of requirements) deviationProfile.set(requirement.id, requirement.profile);

  const cells: Record<string, PortCell> = {};
  for (const profileId of manifest.profiles) cells[profileId] = { claimed: true, deviations: [] };

  const deviations: Deviation[] = manifest.deviations.map((deviation) => {
    const profileId = deviation.profile ?? deviationProfile.get(deviation.requirement);
    return profileId === undefined ? { ...deviation } : { ...deviation, profile: profileId };
  });
  for (const deviation of deviations) {
    const cell = deviation.profile === undefined ? undefined : cells[deviation.profile];
    if (cell !== undefined) cell.deviations.push(deviation.requirement);
  }

  const resultsByScenario = new Map<string, { status: ScenarioStatus; outcome: PortReportResult['outcome']; profile: string }>();
  for (const report of reports) {
    if (report.implementation !== manifest.implementation) continue;
    for (const result of report.results) {
      // Later reports win; duplicate scenario ids collapse to the last one.
      resultsByScenario.set(result.id, { status: result.status, outcome: result.outcome, profile: result.profile });
    }
  }

  for (const result of resultsByScenario.values()) {
    if (!claimSet.has(result.profile)) continue;
    const cell = cells[result.profile];
    if (cell === undefined) continue;
    cell.results ??= { passed: 0, failed: 0, deferred: 0 };
    if (result.status === 'stable') {
      if (result.outcome === 'pass') cell.results.passed += 1;
      else if (result.outcome === 'fail') cell.results.failed += 1;
      else cell.results.deferred += 1;
    } else if (result.outcome === 'deferred') {
      cell.results.deferred += 1;
    }
  }

  return {
    implementation: manifest.implementation,
    contract: manifest.contract,
    ...(manifest.snapshot !== undefined ? { snapshot: manifest.snapshot } : {}),
    cells,
    deviations,
  };
}

function cellText(cell: PortCell): string {
  if (!cell.claimed) return '—';
  const deviationSuffix = cell.deviations.length > 0 ? `; ${cell.deviations.length} deviation${cell.deviations.length === 1 ? '' : 's'}` : '';
  if (cell.results === undefined) return `claimed${deviationSuffix}`;
  const { passed, failed, deferred } = cell.results;
  return `claimed: ${passed} pass / ${failed} fail / ${deferred} deferred${deviationSuffix}`;
}

function percent(numerator: number, denominator: number): string {
  if (denominator === 0) return '0%';
  return `${Math.round((numerator / denominator) * 100)}%`;
}

/** Render the full markdown document for `docs/STATUS.md`. */
export function renderStatus(status: ContractStatus, ports: PortStatus[]): string {
  const lines: string[] = [];
  lines.push('# Conformance status', '');
  lines.push('> Auto-generated from the checked-out contract by `runner/src/cli.ts status`.');
  lines.push('> Do not edit by hand: CI regenerates this file and fails when it is stale.', '');

  lines.push('## Contract', '');
  lines.push('| Profile | Stable | Reference-deviation | Draft | Scenarios | MUST / MUST NOT with a stable scenario | Requirements |');
  lines.push('|---|---|---|---|---|---|---|');

  let totalStable = 0;
  let totalReferenceDeviation = 0;
  let totalDraft = 0;
  let totalScenarios = 0;
  let totalCovered = 0;
  let totalMust = 0;
  let totalRequirements = 0;

  for (const profile of status.profiles) {
    totalStable += profile.stable;
    totalReferenceDeviation += profile.referenceDeviation;
    totalDraft += profile.draft;
    totalScenarios += profile.total;
    totalCovered += profile.coveredMust;
    totalMust += profile.totalMust;
    totalRequirements += profile.requirements;
    lines.push(
      `| \`${profile.id}\` | ${profile.stable} | ${profile.referenceDeviation} | ${profile.draft} | ${profile.total} | ${profile.coveredMust} / ${profile.totalMust} (${percent(profile.coveredMust, profile.totalMust)}) | ${profile.requirements} |`,
    );
  }
  lines.push(
    `| **Total** | **${totalStable}** | **${totalReferenceDeviation}** | **${totalDraft}** | **${totalScenarios}** | **${totalCovered} / ${totalMust} (${percent(totalCovered, totalMust)})** | **${totalRequirements}** |`,
  );

  const retired = status.profiles.filter((profile) => profile.retired > 0);
  if (retired.length > 0) {
    lines.push('');
    lines.push('Retired scenarios are not counted above: `' + retired.map((profile) => `${profile.id} (${profile.retired})`).join('`, `') + '`.');
  }

  if (ports.length > 0) {
    lines.push('', '## Ports', '');
    const orderedProfiles = Array.from(
      new Set(status.profiles.map((profile) => profile.id).concat(...ports.map((port) => Object.keys(port.cells)))),
    );
    lines.push(`| Implementation | Pinned contract | Snapshot | ${orderedProfiles.map((profile) => `\`${profile}\``).join(' | ')} |`);
    lines.push(`|---|---|---|${orderedProfiles.map(() => '---').join('|')}|`);
    for (const port of ports) {
      const snapshot = port.snapshot !== undefined ? `\`${port.snapshot.source}@${shortSha(port.snapshot.commit)}\`` : '—';
      const cells = orderedProfiles.map((profile) => {
        const cell = port.cells[profile];
        return cell === undefined ? '—' : cellText(cell);
      });
      lines.push(`| \`${port.implementation}\` | \`${shortSha(port.contract)}\` | ${snapshot} | ${cells.join(' | ')} |`);
    }

    const deviations = ports.flatMap((port) => port.deviations.map((deviation) => ({ port, deviation })));
    if (deviations.length > 0) {
      lines.push('', '### Declared deviations', '');
      for (const { port, deviation } of deviations) {
        const profile = deviation.profile !== undefined ? ` (\`${deviation.profile}\`)` : '';
        lines.push(`- \`${port.implementation}\` · \`${deviation.requirement}\`${profile}: ${deviation.reason}`);
      }
    }
  }

  return `${lines.join('\n')}\n`;
}