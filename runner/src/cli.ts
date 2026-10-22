/**
 * Conformance runner CLI.
 *
 * Subcommands (each exits non-zero on a real failure so CI can gate on them):
 *   run       execute scenarios against a base URL, write a JSON report
 *   validate  load every data file, proving schemas and cross-references agree
 *   coverage  print the requirement/scenario coverage matrix
 *
 * Ported from typescript-oauth2-server `src/conformance/cli.ts` (@d1999bf).
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadProfiles, loadRequirements, loadScenarios } from './loader.js';
import { buildCoverage, renderCoverage } from './coverage.js';
import { runScenarios, type RunReport } from './runner.js';
import { dpopProof } from './dpop.js';
import { deviceVerify, loginAndAuthorize, logout } from './helpers.js';
import { validateRepository } from './schema-validate.js';
import { parseContractRef } from './manifest.js';

interface ParsedArgs {
  command: string;
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command = 'help', ...rest] = argv;
  const flags: Record<string, string | boolean> = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index] as string;
    if (!token.startsWith('--')) throw new Error(`unexpected argument: ${token}`);
    const name = token.slice(2);
    const next = rest[index + 1];
    if (next === undefined || next.startsWith('--')) {
      flags[name] = true;
    } else {
      flags[name] = next;
      index += 1;
    }
  }
  return { command, flags };
}

function stringFlag(flags: Record<string, string | boolean>, name: string, fallback?: string): string {
  const value = flags[name];
  if (typeof value === 'string') return value;
  if (value === true) throw new Error(`--${name} requires a value`);
  if (fallback !== undefined) return fallback;
  throw new Error(`--${name} is required`);
}

function rootFlag(flags: Record<string, string | boolean>, name = 'root'): string {
  return path.resolve(stringFlag(flags, name, '.'));
}

export function usage(): string {
  return [
    'oauth2-conformance <command> [options]',
    '',
    'Commands:',
    '  run       --base-url URL --scenarios DIR [--requirements DIR] [--profile ID] [--report FILE]',
    '  validate  --scenarios DIR [--requirements DIR] [--profiles DIR]',
    '  validate-schemas  [--root DIR]   JSON Schema 2020-12 check of every data file',
    '  coverage  --scenarios DIR --requirements DIR [--profiles DIR] [--profile ID] [--min PERCENT] [--json]',
    '',
    'Exit codes: 0 success, 1 conformance/validation failure, 2 usage error.',
  ].join('\n');
}

async function commandValidate(flags: Record<string, string | boolean>): Promise<number> {
  const scenarioRoot = rootFlag(flags, 'scenarios');
  const scenarios = await loadScenarios(scenarioRoot);
  const requirements = flags.requirements !== undefined ? await loadRequirements(rootFlag(flags, 'requirements')) : [];
  const profiles = flags.profiles !== undefined ? await loadProfiles(rootFlag(flags, 'profiles')) : [];
  const coverage = buildCoverage(requirements, scenarios, profiles);
  console.log(`scenarios: ${scenarios.length}`);
  console.log(`requirements: ${requirements.length}`);
  console.log(`profiles: ${profiles.length}`);
  if (coverage.dangling.length > 0) {
    console.error(`dangling scenario requirements: ${coverage.dangling.join(', ')}`);
    return 1;
  }
  if (coverage.unknownProfiles.length > 0) {
    console.error(`unknown scenario profiles: ${coverage.unknownProfiles.join(', ')}`);
    return 1;
  }
  console.log('validate: OK');
  return 0;
}

async function commandValidateSchemas(flags: Record<string, string | boolean>): Promise<number> {
  const root = rootFlag(flags);
  const { checked, violations } = await validateRepository(root);
  for (const violation of violations) console.error(`INVALID ${violation.file} (${violation.kind}): ${violation.message}`);
  if (checked === 0) {
    console.error(`validate-schemas: no data files found under ${root}`);
    return 1;
  }
  if (violations.length > 0) return 1;
  console.log(`validate-schemas: OK (${checked} files)`);
  return 0;
}

async function commandCoverage(flags: Record<string, string | boolean>): Promise<number> {
  const scenarios = await loadScenarios(rootFlag(flags, 'scenarios'));
  const requirements = await loadRequirements(rootFlag(flags, 'requirements'));
  const profiles = flags.profiles !== undefined ? await loadProfiles(rootFlag(flags, 'profiles')) : [];
  const report = buildCoverage(requirements, scenarios, profiles, flags.profile !== undefined ? stringFlag(flags, 'profile') : undefined);
  if (flags.json === true) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderCoverage(report));
  }
  const min = flags.min !== undefined ? Number(stringFlag(flags, 'min')) : undefined;
  if (report.dangling.length > 0 || report.unknownProfiles.length > 0) return 1;
  if (min !== undefined && report.coveragePercent < min) {
    console.error(`coverage ${report.coveragePercent}% is below the required ${min}%`);
    return 1;
  }
  return 0;
}

export async function commandRun(flags: Record<string, string | boolean>): Promise<number> {
  const baseUrl = stringFlag(flags, 'base-url');
  const scenarios = await loadScenarios(rootFlag(flags, 'scenarios'));
  const contractRef = parseContractRef(stringFlag(flags, 'contract', '0.1.0'));
  const report: RunReport = await runScenarios(scenarios, {
    baseUrl,
    implementation: stringFlag(flags, 'implementation', 'system-under-test'),
    contract: contractRef.value,
    ...(flags.profile !== undefined ? { profile: stringFlag(flags, 'profile') } : {}),
    helpers: { 'login-and-authorize': loginAndAuthorize, 'logout': logout, 'device-verify': deviceVerify, 'dpop-proof': dpopProof },
  });
  const reportFile = flags.report !== undefined ? path.resolve(stringFlag(flags, 'report')) : undefined;
  if (reportFile !== undefined) {
    await mkdir(path.dirname(reportFile), { recursive: true });
    await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }
  for (const result of report.results) {
    const marker = result.outcome === 'pass' ? 'PASS' : result.outcome === 'deferred' ? 'DEFER' : 'FAIL';
    console.log(`${marker} ${result.id}${result.outcome === 'fail' ? ` (${result.diffs.length} diffs)` : ''}`);
    for (const diff of result.diffs) {
      console.log(`  - ${diff.path}: ${diff.reason} (expected ${JSON.stringify(diff.expected)}, actual ${JSON.stringify(diff.actual)})`);
    }
  }
  console.log(`contract=${contractRef.value} (${contractRef.kind}) executed=${report.executed} passed=${report.passed} failed=${report.failed} deferred=${report.deferred} verdict=${report.verdict}`);
  return report.verdict === 'pass' ? 0 : 1;
}

export async function main(argv: string[]): Promise<number> {
  const { command, flags } = parseArgs(argv);
  switch (command) {
    case 'run':
      return commandRun(flags);
    case 'validate':
      return commandValidate(flags);
    case 'validate-schemas':
      return commandValidateSchemas(flags);
    case 'coverage':
      return commandCoverage(flags);
    case 'help':
    case '--help':
    case '-h':
      console.log(usage());
      return 0;
    default:
      console.error(usage());
      return 2;
  }
}

export async function readReport(file: string): Promise<RunReport> {
  return JSON.parse(await readFile(file, 'utf8')) as RunReport;
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 2;
    },
  );
}
