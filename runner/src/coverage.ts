/**
 * Requirement / scenario coverage matrix.
 *
 * Ported from typescript-oauth2-server `src/conformance/matrix.ts` (@d1999bf).
 * Reports, per requirement, which scenarios prove it and whether the coverage
 * is sufficient for the requirement's profile. CI uses this to fail a pull
 * request that adds a requirement without a `stable` scenario, or that marks a
 * requirement covered by only `draft`/`reference-deviation` scenarios.
 */

import type { Requirement } from './requirement.js';
import type { Profile } from './profile.js';
import type { Scenario } from './scenario.js';

export interface RequirementCoverage {
  requirement: string;
  profile: string;
  spec: string;
  clause: string;
  level: string;
  summary: string;
  /** Stable scenarios that prove this requirement. */
  stable: string[];
  /** Draft or reference-deviation scenarios that mention it. */
  provisional: string[];
  covered: boolean;
}

export interface CoverageReport {
  requirements: RequirementCoverage[];
  /** Requirement IDs with no scenario at all. */
  uncovered: string[];
  /** Requirement IDs covered only by non-stable scenarios. */
  provisional: string[];
  /** Scenario requirements that reference an unknown requirement ID. */
  dangling: string[];
  /** Scenario IDs whose profile is not a declared profile. */
  unknownProfiles: string[];
  totalRequirements: number;
  coveredRequirements: number;
  coveragePercent: number;
}

export function buildCoverage(
  requirements: Requirement[],
  scenarios: Scenario[],
  profiles: Profile[] = [],
  scopeProfile?: string,
): CoverageReport {
  const byRequirement = new Map<string, RequirementCoverage>();
  for (const requirement of requirements) {
    if (scopeProfile !== undefined && requirement.profile !== scopeProfile) continue;
    byRequirement.set(requirement.id, {
      requirement: requirement.id,
      profile: requirement.profile,
      spec: requirement.spec,
      clause: requirement.clause,
      level: requirement.level,
      summary: requirement.summary,
      stable: [],
      provisional: [],
      covered: false,
    });
  }

  const dangling = new Set<string>();
  const unknownProfiles = new Set<string>();
  const knownProfileIds = new Set(profiles.map((profile) => profile.id));

  for (const scenario of scenarios) {
    if (scopeProfile !== undefined && scenario.profile !== scopeProfile) continue;
    if (profiles.length > 0 && !knownProfileIds.has(scenario.profile)) {
      unknownProfiles.add(scenario.profile);
    }
    for (const id of scenario.requirements) {
      const entry = byRequirement.get(id);
      if (entry === undefined) {
        dangling.add(id);
        continue;
      }
      if (scenario.status === 'stable') entry.stable.push(scenario.id);
      else if (scenario.status !== 'retired') entry.provisional.push(scenario.id);
    }
  }

  const coverage = [...byRequirement.values()];
  for (const entry of coverage) entry.covered = entry.stable.length > 0;
  const uncovered = coverage.filter((entry) => !entry.covered && entry.provisional.length === 0).map((entry) => entry.requirement);
  const provisional = coverage.filter((entry) => !entry.covered && entry.provisional.length > 0).map((entry) => entry.requirement);
  const coveredRequirements = coverage.filter((entry) => entry.covered).length;

  return {
    requirements: coverage,
    uncovered,
    provisional,
    dangling: [...dangling],
    unknownProfiles: [...unknownProfiles],
    totalRequirements: coverage.length,
    coveredRequirements,
    coveragePercent: coverage.length === 0 ? 0 : Math.round((coveredRequirements / coverage.length) * 1000) / 10,
  };
}

/** Human-readable coverage table for CI logs and PR comments. */
export function renderCoverage(report: CoverageReport): string {
  const lines = [
    `Requirement coverage: ${report.coveredRequirements}/${report.totalRequirements} (${report.coveragePercent}%)`,
    '',
    'requirement                     profile        level  stable  provisional',
  ];
  for (const entry of report.requirements) {
    lines.push(
      [
        entry.requirement.padEnd(31),
        entry.profile.padEnd(14),
        entry.level.padEnd(6),
        String(entry.stable.length).padStart(6),
        String(entry.provisional.length).padStart(11),
      ].join(' '),
    );
  }
  if (report.uncovered.length > 0) lines.push('', `UNCOVERED (${report.uncovered.length}): ${report.uncovered.join(', ')}`);
  if (report.provisional.length > 0) lines.push('', `PROVISIONAL ONLY (${report.provisional.length}): ${report.provisional.join(', ')}`);
  if (report.dangling.length > 0) lines.push('', `DANGLING SCENARIO REQUIREMENTS (${report.dangling.length}): ${report.dangling.join(', ')}`);
  if (report.unknownProfiles.length > 0) lines.push('', `UNKNOWN SCENARIO PROFILES (${report.unknownProfiles.length}): ${report.unknownProfiles.join(', ')}`);
  return lines.join('\n');
}
